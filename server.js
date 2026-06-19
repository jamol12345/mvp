// ============================================
// MVP Lead Management System - Express Server
// ============================================

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const path = require('path');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS first (before any other middleware) so it always runs in Vercel serverless.
const defaultCorsOrigins = [
  'http://localhost:5173',
  'https://crm-kukcha.vercel.app',
  'https://mvp-kokcha.netlify.app',
  'https://api.kukcha-eshiklari.uz'
];
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean)
  : defaultCorsOrigins;

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// ============================================
// MIDDLEWARE
// ============================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (HTML, CSS)
app.use(express.static(path.join(__dirname, 'public')));

// Health check: no DB dependency, always available (for Vercel/probes)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Public doors catalog (no auth) — same data as /api/doors on Vercel (see api/doors.js)
const doors = require('./data/doors');
app.get('/api/doors', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
  res.json(doors);
});

// Friendly route for done calls (matches /done_calls navigation)
app.get('/done_calls', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'done_calls.html'));
});

// ============================================
// MONGODB CONNECTION
// ============================================

// MongoDB connection string must be provided via environment variables
// Example: mongodb://localhost:27017/leads or mongodb+srv://user:pass@cluster.mongodb.net/leads
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not set');
  process.exit(1);
}

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
  })
  .catch((error) => {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  });

// ============================================
// MONGOOSE SCHEMA
// ============================================

const PRIORITY_OPTIONS = ['Quality', 'Design', 'Production Time', 'Price', 'Warranty'];
const PRIORITY_OPTIONS_NEW = ['Качество и надежность', 'Цена', 'Дизайн и стиль', 'Гарантии и сервис', 'Надежность и безопасность'];
const LABEL_OPTIONS = ['New Client', 'Call Back', 'Successful', 'Rejected'];
const STAGE_OPTIONS = ['new', 'in_progress', 'thinking', 'successful', 'preparing'];
const SOURCE_OPTIONS = ['instagram', 'telegram', 'word_of_mouth', 'website', 'manual'];

const leadSchema = new mongoose.Schema({
  name: {
    type: String,
    default: ''
  },
  surname: {
    type: String,
    default: ''
  },
  fullName: {
    type: String,
    default: ''
  },
  doorType: {
    type: String,
    default: ''
  },
  measurements: {
    type: String,
    default: ''
  },
  length: {
    type: Number,
    default: 0
  },
  width: {
    type: Number,
    default: 0
  },
  isPreparing: {
    type: Boolean,
    default: false
  },
  readyDate: {
    type: Date,
    default: null
  },
  dobor: {
    type: String,
    default: ''
  },
  phoneNumber: {
    type: String,
    required: true
  },
  priorities: {
    type: [String],
    default: []
  },
  label: {
    type: String,
    enum: LABEL_OPTIONS,
    default: 'New Client'
  },
  source: {
    type: String,
    enum: SOURCE_OPTIONS,
    default: 'website'
  },
  language: {
    type: String,
    enum: ['ru', 'uz'],
    default: 'ru'
  },
  closedBy: {
    type: String,
    default: ''
  },
  closedAt: {
    type: Date
  },
  lastEditedBy: {
    type: String,
    default: ''
  },
  commentUpdatedAt: {
    type: Date
  },
  status: {
    type: String,
    enum: ['new', 'done', 'archived'],
    default: 'new'
  },
  stage: {
    type: String,
    default: 'new'
  },
  comment: {
    type: String,
    default: ''
  },
  dealAmount: {
    type: Number,
    default: 0
  },
  assignedTo: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: String,
    default: null
  },
  lockedUntil: {
    type: Date,
    default: null
  }
});

// Index createdAt for efficient polling by timestamp
leadSchema.index({ createdAt: 1 });

// Update updatedAt before saving
leadSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Mongoose model: 'Lead' -> MongoDB collection: 'leads' (lowercase, pluralized)
// Database: Extracted from MONGODB_URI (e.g., 'leads' or default database)
// Collection: 'leads' (Mongoose automatically pluralizes model name)
// To check data manually: Open MongoDB Compass, connect to your cluster,
// navigate to the database (from connection string), find 'leads' collection
const Lead = mongoose.model('Lead', leadSchema);

const APPROVAL_TYPE = { DELETE: 'DELETE', CLOSE: 'CLOSE' };
const APPROVAL_STATUS = { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' };

const approvalSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: [APPROVAL_TYPE.DELETE, APPROVAL_TYPE.CLOSE],
    required: true
  },
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true,
    index: true
  },
  requestedBy: { type: String, required: true, index: true },
  status: {
    type: String,
    enum: [APPROVAL_STATUS.PENDING, APPROVAL_STATUS.APPROVED, APPROVAL_STATUS.REJECTED],
    default: APPROVAL_STATUS.PENDING,
    index: true
  },
  createdAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date, default: null, index: true },
  deleteMode: { type: String, enum: ['archive', 'hard'], default: 'archive' },
  closeDealAmount: { type: Number, default: null },
  closeComment: { type: String, default: '' },
  isStageClose: { type: Boolean, default: false },
  doneLabel: { type: String, default: null }
});

approvalSchema.index({ leadId: 1, status: 1, type: 1 });

const Approval = mongoose.model('Approval', approvalSchema);

// ============================================
// PRIORITIES HELPERS
// ============================================

function sanitizePriorities(input) {
  if (!Array.isArray(input)) return [];
  const filtered = input
    .map(item => String(item).trim())
    .filter(item => PRIORITY_OPTIONS_NEW.includes(item));
  const unique = [];
  filtered.forEach(item => {
    if (!unique.includes(item)) unique.push(item);
  });
  return unique;
}

function validatePrioritiesExactlyTwo(priorities) {
  if (!Array.isArray(priorities) || priorities.length !== 2) return null;
  const trimmed = priorities.map(p => String(p).trim()).filter(Boolean);
  if (trimmed.length !== 2) return null;
  const valid = trimmed.every(p => PRIORITY_OPTIONS_NEW.includes(p));
  if (!valid) return null;
  return [...new Set(trimmed)].length === 2 ? trimmed : null;
}

function sanitizeSource(input) {
  if (!input) return '';
  const value = String(input).trim();
  return SOURCE_OPTIONS.includes(value) ? value : '';
}

function sanitizeLanguage(input) {
  if (!input) return 'ru';
  const value = String(input).trim();
  return value === 'ru' || value === 'uz' ? value : 'ru';
}

// ============================================
// AUTHENTICATION & ROLES
// ============================================

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET is not set');
  process.exit(1);
}

// Static USERS: Boss + Call Managers (tokens from env). Vercel dashboard must use exact names: BOSS_TOKEN, CALL_ANVAR_TOKEN, CALL_AKBAR_TOKEN, CALL_DAVRON_TOKEN.
const trimEnv = (v) => String(v || '').trim();
const USERS = [
  { role: 'boss', name: 'Boss', token: trimEnv(process.env.BOSS_TOKEN || process.env.MANAGER_TOKEN) },
  { role: 'call', key: 'anvar', name: 'Анвар', token: trimEnv(process.env.CALL_ANVAR_TOKEN) },
  { role: 'call', key: 'akbar', name: 'Акбар', token: trimEnv(process.env.CALL_AKBAR_TOKEN) },
  { role: 'call', key: 'davron', name: 'Даврон', token: trimEnv(process.env.CALL_DAVRON_TOKEN) }
];
const CALL_MANAGER_KEYS = ['anvar', 'akbar', 'davron'];
const MANAGER_ANALYTICS_KEYS = ['boss', 'anvar', 'akbar', 'davron'];
const MANAGER_DISPLAY_NAMES = { boss: 'Boss', anvar: 'Анвар', akbar: 'Акбар', davron: 'Даврон' };

// Fail fast if any login token is missing (Vercel: set these in Settings → Environment Variables)
const missingTokens = USERS.filter(u => !u.token).map(u => u.name);
if (missingTokens.length) {
  console.warn('⚠️  Missing login token(s) for:', missingTokens.join(', '));
}

// --- RBAC: BOSS (boss token) / MANAGER (call managers) ---
const APP_ROLE = { BOSS: 'BOSS', MANAGER: 'MANAGER' };
const PENDING_MSG_RU = 'Ожидает подтверждения';
const WEBSITE_CLAIM_LOCK_MS = 5000;
const ERR_WAIT_CLAIM_LOCK_RU = 'Подождите 5 секунд';
const ERR_LEAD_TAKEN_RU = 'Лид уже забрал другой менеджер';
const ERR_MUST_CLAIM_RU = 'Сначала возьмите лид в работу (перенесите в «В работе»)';

function isUnclaimed(lead) {
  return !lead || lead.assignedTo == null || String(lead.assignedTo).trim() === '';
}

function isLeadClaimedByOther(lead, user) {
  if (isUnclaimed(lead) || isAppBossUser(user)) return false;
  if (!isAppManagerUser(user) || !user.key) return false;
  return String(lead.assignedTo) !== String(user.key);
}

function isAppBossUser(user) {
  if (!user) return false;
  if (user.appRole === APP_ROLE.BOSS) return true;
  if (user.role === 'boss') return true;
  if (user.role === 'manager') return true; // legacy JWT
  return false;
}

function isAppManagerUser(user) {
  if (!user) return false;
  if (user.appRole === APP_ROLE.MANAGER) return true;
  if (user.role === 'call' || user.role === 'call_manager') return true;
  return false;
}

function getUserIdFromUser(user) {
  if (!user) return null;
  if (user.userId) return String(user.userId);
  if (user.role === 'boss' || user.role === 'manager') return 'boss';
  if (user.key) return String(user.key);
  return null;
}

/** Manager may change pipeline on this lead: boss always; call — only own claimed leads (not unclaimed, not other’s). */
function canMovePipeline(user, lead) {
  if (!lead || lead.status !== 'new') return false;
  if (isAppBossUser(user)) return true;
  if (!isAppManagerUser(user) || !user.key) return false;
  if (isUnclaimed(lead)) return false;
  return String(lead.assignedTo) === String(user.key);
}

/** For closing/archiving/approval: manager may act only on own lead. Boss: always. */
function canManagerActOnOwnLeadOrBoss(user, lead) {
  if (isAppBossUser(user)) return true;
  if (!isAppManagerUser(user) || !user.key) return false;
  if (isUnclaimed(lead)) return false;
  return String(lead.assignedTo) === String(user.key);
}

function canManagerRequestDelete(lead, user) {
  const uid = getUserIdFromUser(user);
  if (!uid || !lead) return false;
  if (lead.createdBy == null || lead.createdBy === '') {
    return false; // only boss can hard-delete or legacy; managers must not by rule
  }
  return String(lead.createdBy) === String(uid);
}

// Middleware: verify JWT and attach user (role, key, appRole, userId) to request
const authenticateAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const role = decoded.role;
    // Accept new roles (boss, call) and legacy (manager -> boss, call_manager -> call)
    if (!role || !['manager', 'call_manager', 'boss', 'call'].includes(role)) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
    if (role === 'boss' || role === 'manager') {
      const appRole = decoded.appRole === APP_ROLE.BOSS || decoded.appRole === APP_ROLE.MANAGER
        ? decoded.appRole
        : APP_ROLE.BOSS;
      const userId = decoded.userId != null && String(decoded.userId) !== '' ? String(decoded.userId) : 'boss';
      req.user = { role: 'boss', appRole, userId };
      return next();
    }
    // role === 'call' or 'call_manager'
    const key = decoded.key || (role === 'call_manager' ? 'call' : decoded.key);
    const k = key || null;
    const appRole = decoded.appRole === APP_ROLE.MANAGER || decoded.appRole === APP_ROLE.BOSS
      ? decoded.appRole
      : APP_ROLE.MANAGER;
    const userId = decoded.userId != null && String(decoded.userId) !== '' ? String(decoded.userId) : (k || 'call');
    req.user = { role: 'call', key: k, appRole, userId };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

// Middleware: require boss role (403 if call manager)
const requireBoss = (req, res, next) => {
  if (req.user && isAppBossUser(req.user)) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden: Boss access required' });
};

// Legacy: analytics and similar — boss (and some routes still use the name "manager")
const requireManager = requireBoss;

// ============================================
// PUBLIC API ENDPOINTS
// ============================================

function parseReadyDateFromBody(value) {
  if (value == null || String(value).trim() === '') return null;
  const s = String(value).trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s);
  if (isNaN(d.getTime())) return null;
  return d;
}

// Validate a phone number: keep an optional leading '+' and digits only; require 9–15 digits.
// Returns the cleaned string, or null if it does not look like a real phone number.
function validatePhoneNumber(raw) {
  const trimmed = String(raw == null ? '' : raw).trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[\s\-()]/g, '');
  if (!/^\+?\d{9,15}$/.test(cleaned)) return null;
  return cleaned;
}

// Best-effort in-memory rate limiter (per client IP). On serverless this only
// catches bursts that hit the same warm instance; the duplicate-phone check
// below is the durable guard. Together they stop simple flood/double-submit spam.
const PUBLIC_RATE_WINDOW_MS = 60 * 1000;
const PUBLIC_RATE_MAX = 8; // max public lead submissions per IP per minute
const publicRateHits = new Map();
function publicLeadRateLimited(ip) {
  const now = Date.now();
  const key = String(ip || 'unknown');
  const hits = (publicRateHits.get(key) || []).filter(t => now - t < PUBLIC_RATE_WINDOW_MS);
  hits.push(now);
  publicRateHits.set(key, hits);
  if (publicRateHits.size > 5000) publicRateHits.clear(); // bound memory
  return hits.length > PUBLIC_RATE_MAX;
}

// POST /api/leads - Public endpoint to submit lead form
// New contract: { fullName?, phone|phoneNumber, priorities } — phone required; fullName optional.
// Legacy contract: full door/measurements + length/width + exactly 2 priorities (unchanged).
app.post('/api/leads', async (req, res) => {
  try {
    const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
    if (publicLeadRateLimited(clientIp)) {
      return res.status(429).json({ error: 'Too many requests, please try again later' });
    }

    const body = req.body || {};
    const phoneRaw = (body.phone != null ? body.phone : body.phoneNumber);
    const phoneNumber = validatePhoneNumber(phoneRaw);
    if (!phoneNumber) {
      return res.status(400).json({
        error: 'A valid phone number is required'
      });
    }

    // Durable anti-spam: reject the same phone submitted again within 60s
    const recentDuplicate = await Lead.findOne({
      phoneNumber,
      status: 'new',
      createdAt: { $gt: new Date(Date.now() - 60 * 1000) }
    }).select('_id').lean();
    if (recentDuplicate) {
      return res.status(429).json({ error: 'This number was just submitted, please wait a moment' });
    }

    const languageValue = sanitizeLanguage(body.language);

    const legacyLen = body.length != null ? Number(body.length) : NaN;
    const legacyWid = body.width != null ? Number(body.width) : NaN;
    const hasLegacyShape =
      body.doorType &&
      String(body.doorType).trim() !== '' &&
      body.measurements != null &&
      String(body.measurements).trim() !== '' &&
      Number.isFinite(legacyLen) && legacyLen > 0 &&
      Number.isFinite(legacyWid) && legacyWid > 0;

    let leadData;

    if (hasLegacyShape) {
      const { fullName, doorType, measurements, priorities, length, width, dobor } = body;
      if (!fullName || !doorType || !measurements) {
        return res.status(400).json({
          error: 'Missing required fields: fullName, doorType, measurements, phoneNumber'
        });
      }

      const lengthNum = length != null ? Number(length) : NaN;
      const widthNum = width != null ? Number(width) : NaN;
      if (typeof lengthNum !== 'number' || isNaN(lengthNum) || lengthNum <= 0 || typeof widthNum !== 'number' || isNaN(widthNum) || widthNum <= 0) {
        return res.status(400).json({
          error: 'length and width are required and must be greater than 0'
        });
      }

      const doborValue = dobor != null ? String(dobor).trim() : '';

      const prioritiesArray = validatePrioritiesExactlyTwo(priorities);
      if (!prioritiesArray) {
        return res.status(400).json({ error: 'priorities must be an array of exactly 2 values from the allowed list' });
      }

      leadData = {
        fullName: fullName.trim(),
        doorType: doorType.trim(),
        measurements: String(measurements).trim(),
        length: lengthNum,
        width: widthNum,
        dobor: doborValue,
        phoneNumber,
        priorities: prioritiesArray,
        name: '',
        surname: '',
        status: 'new',
        label: 'New Client',
        source: 'website',
        language: languageValue,
        isPreparing: false,
        readyDate: null,
        createdBy: 'system',
        assignedTo: null,
        lockedUntil: new Date(Date.now() + WEBSITE_CLAIM_LOCK_MS),
        createdAt: new Date(),
        updatedAt: new Date()
      };
    } else {
      const fullNameVal = body.fullName != null ? String(body.fullName).trim() : '';
      const prioritiesArray = sanitizePriorities(body.priorities);

      leadData = {
        fullName: fullNameVal,
        doorType: '',
        measurements: '',
        length: 0,
        width: 0,
        dobor: '',
        phoneNumber,
        priorities: prioritiesArray,
        name: '',
        surname: '',
        status: 'new',
        label: 'New Client',
        source: 'website',
        language: languageValue,
        isPreparing: false,
        readyDate: null,
        createdBy: 'system',
        assignedTo: null,
        lockedUntil: new Date(Date.now() + WEBSITE_CLAIM_LOCK_MS),
        createdAt: new Date(),
        updatedAt: new Date()
      };
    }

    const lead = new Lead(leadData);
    await lead.save();
    console.log(`✅ [MONGODB] Lead submitted: ${lead.fullName || lead.phoneNumber}`);

    res.status(201).json({
      success: true,
      message: 'Lead submitted successfully'
    });
  } catch (error) {
    console.error('❌ [ERROR] Error processing lead request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// ADMIN API ENDPOINTS
// ============================================

// POST /api/admin/login - Admin login (returns JWT with role, name, key for call)
app.post('/api/admin/login', (req, res) => {
  const incomingToken = String(req.body.token || '').trim();
  if (!incomingToken) {
    return res.status(400).json({ error: 'Token is required' });
  }
  const user = USERS.find(u => u.token && u.token === incomingToken);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
  const payload = user.role === 'boss'
    ? { role: 'boss', appRole: APP_ROLE.BOSS, userId: 'boss' }
    : { role: 'call', key: user.key, appRole: APP_ROLE.MANAGER, userId: user.key };
  const jwtToken = jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
  const response = {
    success: true,
    message: 'Login successful',
    token: jwtToken,
    role: user.role,
    appRole: user.role === 'boss' ? APP_ROLE.BOSS : APP_ROLE.MANAGER,
    userId: user.role === 'boss' ? 'boss' : user.key,
    name: user.name
  };
  if (user.role === 'call') {
    response.key = user.key;
  }
  res.json(response);
});

// POST /api/admin/leads - Add client manually (Boss and managers)
// New payload: { fullName?, phone|phoneNumber, priorities?, source } — phone + source required.
// Legacy: full door + measurements + length/width + exactly 2 priorities (unchanged).
app.post('/api/admin/leads', authenticateAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const phoneRaw = body.phone != null ? body.phone : body.phoneNumber;
    const phoneNumber = validatePhoneNumber(phoneRaw);
    if (!phoneNumber) {
      return res.status(400).json({ error: 'A valid phone number is required' });
    }

    const legacyLen = body.length != null ? Number(body.length) : NaN;
    const legacyWid = body.width != null ? Number(body.width) : NaN;
    const hasLegacyShape =
      body.doorType &&
      String(body.doorType).trim() !== '' &&
      body.measurements != null &&
      String(body.measurements).trim() !== '' &&
      Number.isFinite(legacyLen) && legacyLen > 0 &&
      Number.isFinite(legacyWid) && legacyWid > 0;

    let lead;

    if (hasLegacyShape) {
      const { fullName, doorType, measurements, priorities, length, width, dobor, source } = body;
      if (!fullName || !doorType || !measurements) {
        return res.status(400).json({
          error: 'Missing required fields: fullName, doorType, measurements, phoneNumber'
        });
      }
      const lengthNum = length != null ? Number(length) : NaN;
      const widthNum = width != null ? Number(width) : NaN;
      if (typeof lengthNum !== 'number' || isNaN(lengthNum) || lengthNum <= 0 || typeof widthNum !== 'number' || isNaN(widthNum) || widthNum <= 0) {
        return res.status(400).json({
          error: 'length and width are required and must be greater than 0'
        });
      }
      const doborValue = dobor != null ? String(dobor).trim() : '';
      const sourceValue = sanitizeSource(source);
      if (!sourceValue || sourceValue === 'website') {
        return res.status(400).json({ error: 'Source is required' });
      }
      const prioritiesArray = validatePrioritiesExactlyTwo(priorities);
      if (!prioritiesArray) {
        return res.status(400).json({ error: 'priorities must be an array of exactly 2 values from the allowed list' });
      }
      lead = new Lead({
        fullName: fullName.trim(),
        doorType: doorType.trim(),
        measurements: String(measurements).trim(),
        length: lengthNum,
        width: widthNum,
        dobor: doborValue,
        phoneNumber,
        priorities: prioritiesArray,
        name: '',
        surname: '',
        status: 'new',
        label: 'New Client',
        source: sourceValue,
        isPreparing: false,
        readyDate: null
      });
    } else {
      const sourceValue = sanitizeSource(body.source);
      if (!sourceValue || sourceValue === 'website') {
        return res.status(400).json({ error: 'Source is required' });
      }
      const fullNameVal = body.fullName != null ? String(body.fullName).trim() : '';
      const prioritiesArray = sanitizePriorities(body.priorities);
      lead = new Lead({
        fullName: fullNameVal,
        doorType: '',
        measurements: '',
        length: 0,
        width: 0,
        dobor: '',
        phoneNumber,
        priorities: prioritiesArray,
        name: '',
        surname: '',
        status: 'new',
        label: 'New Client',
        source: sourceValue,
        language: 'ru',
        isPreparing: false,
        readyDate: null
      });
    }

    const creatorId = getUserIdFromUser(req.user);
    if (isAppManagerUser(req.user) && req.user.key) {
      const k = String(req.user.key);
      lead.createdBy = k;
      lead.assignedTo = k;
      lead.lockedUntil = null;
    } else if (isAppBossUser(req.user) && creatorId) {
      lead.createdBy = creatorId;
      lead.assignedTo = null;
      lead.lockedUntil = null;
    } else if (creatorId) {
      lead.createdBy = creatorId;
    }
    await lead.save();
    console.log(`✅ [MONGODB] Lead added by manager: ${lead.fullName || lead.phoneNumber}`);
    res.status(201).json({ success: true, message: 'Client added', lead });
  } catch (error) {
    console.error('❌ [ERROR] Error adding lead:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/leads — all active (new) leads for every authenticated user
app.get('/api/admin/leads', authenticateAdmin, async (req, res) => {
  try {
    const query = { status: 'new' };
    const leads = await Lead.find(query)
      .sort({ createdAt: -1 })
      .select('name surname fullName doorType measurements length width dobor phoneNumber priorities label source stage assignedTo isPreparing readyDate createdBy lockedUntil createdAt updatedAt _id');

    res.json({
      success: true,
      leads
    });
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/admin/leads/:id/assign - Assign lead to call manager (Boss only)
app.patch('/api/admin/leads/:id/assign', authenticateAdmin, requireBoss, async (req, res) => {
  try {
    const { id } = req.params;
    const { assignedTo } = req.body;
    const value = (assignedTo && CALL_MANAGER_KEYS.includes(String(assignedTo))) ? String(assignedTo) : null;

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    if (lead.status !== 'new') {
      return res.status(400).json({ error: 'Only active leads can be assigned' });
    }

    lead.assignedTo = value;
    lead.updatedAt = new Date();
    await lead.save();

    res.json({
      success: true,
      message: 'Assignment updated',
      lead
    });
  } catch (error) {
    console.error('❌ [ERROR] Error updating lead assignment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function closedByFromRequestUser(user) {
  if (isAppManagerUser(user) && user.key) return user.key;
  return 'boss';
}

/**
 * Atomic claim: only when lead is unassigned, lock passed, target stage in_progress.
 * One findOneAndUpdate with query conditions — no race.
 */
async function tryAtomicallyClaimInProgress(leadId, user) {
  if (!isAppManagerUser(user) || !user.key) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  const now = new Date();
  const key = String(user.key);
  const filter = {
    _id: leadId,
    status: 'new',
    assignedTo: null,
    $or: [
      { lockedUntil: null },
      { lockedUntil: { $exists: false } },
      { lockedUntil: { $lte: now } }
    ]
  };
  const updated = await Lead.findOneAndUpdate(
    filter,
    {
      $set: {
        assignedTo: key,
        stage: 'in_progress',
        updatedAt: now,
        lockedUntil: null
      }
    },
    { new: true }
  );
  if (updated) {
    return { ok: true, lead: updated };
  }
  const current = await Lead.findById(leadId);
  if (!current) {
    return { ok: false, status: 404, error: 'Lead not found' };
  }
  if (current.assignedTo && String(current.assignedTo) !== key) {
    return { ok: false, status: 409, error: ERR_LEAD_TAKEN_RU };
  }
  if (current.lockedUntil && current.lockedUntil > now) {
    return { ok: false, status: 400, error: ERR_WAIT_CLAIM_LOCK_RU };
  }
  return { ok: false, status: 409, error: ERR_LEAD_TAKEN_RU };
}

async function applyStageSuccessful(lead, dealAmount, comment, closedByValue) {
  if (lead.stage === 'preparing') {
    lead.isPreparing = false;
    lead.readyDate = null;
  }
  lead.stage = 'successful';
  lead.status = 'done';
  lead.closedAt = new Date();
  lead.closedBy = closedByValue;
  lead.label = 'Successful';
  const amount = dealAmount != null ? Number(dealAmount) : NaN;
  if (typeof amount === 'number' && !isNaN(amount) && amount > 0) {
    lead.dealAmount = amount;
  }
  if (comment != null && String(comment).trim() !== '') {
    lead.comment = String(comment).trim();
    lead.commentUpdatedAt = new Date();
    lead.lastEditedBy = closedByValue;
  }
  lead.updatedAt = new Date();
  await lead.save();
}

// PATCH /api/admin/leads/:id/stage - Update lead stage (claim in_progress = atomic; manager "successful" → approval)
app.patch('/api/admin/leads/:id/stage', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { stage, comment, dealAmount, readyDate } = req.body;
    const stageValue = typeof stage === 'string' ? stage.trim() : '';
    if (!STAGE_OPTIONS.includes(stageValue)) {
      return res.status(400).json({ error: 'Invalid stage' });
    }

    if (stageValue === 'successful') {
      const amount = dealAmount != null ? Number(dealAmount) : NaN;
      if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: 'dealAmount is required and must be greater than 0' });
      }
    }

    if (stageValue === 'preparing') {
      const rd = parseReadyDateFromBody(readyDate);
      if (!rd) {
        return res.status(400).json({ error: 'readyDate is required for preparing stage' });
      }
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    if (lead.status !== 'new') {
      return res.status(400).json({ error: 'Only active leads can be moved' });
    }

    if (isAppManagerUser(req.user) && isLeadClaimedByOther(lead, req.user)) {
      return res.status(403).json({ error: 'Недостаточно прав для изменения воронки по этому лиду' });
    }

    if (isAppManagerUser(req.user) && isUnclaimed(lead)) {
      if (stageValue !== 'in_progress') {
        return res.status(400).json({ error: ERR_MUST_CLAIM_RU });
      }
      const claim = await tryAtomicallyClaimInProgress(lead._id, req.user);
      if (claim.ok && claim.lead) {
        return res.json({
          success: true,
          message: 'Stage updated',
          lead: claim.lead
        });
      }
      return res.status(claim.status || 409).json({ error: claim.error || ERR_LEAD_TAKEN_RU });
    }

    if (!canMovePipeline(req.user, lead)) {
      return res.status(403).json({ error: 'Недостаточно прав для изменения воронки по этому лиду' });
    }

    const closedByValue = closedByFromRequestUser(req.user);
    const wantsSuccessClose = stageValue === 'successful' && isAppManagerUser(req.user);
    if (wantsSuccessClose) {
      const amount = dealAmount != null ? Number(dealAmount) : NaN;
      const existing = await Approval.findOne({
        leadId: lead._id,
        type: APPROVAL_TYPE.CLOSE,
        status: APPROVAL_STATUS.PENDING
      });
      if (existing) {
        return res.json({
          success: true,
          pending: true,
          message: PENDING_MSG_RU
        });
      }
      const approval = new Approval({
        type: APPROVAL_TYPE.CLOSE,
        leadId: lead._id,
        requestedBy: getUserIdFromUser(req.user),
        status: APPROVAL_STATUS.PENDING,
        closeDealAmount: amount,
        closeComment: comment != null && String(comment).trim() !== '' ? String(comment).trim() : '',
        isStageClose: true
      });
      await approval.save();
      return res.json({
        success: true,
        pending: true,
        message: PENDING_MSG_RU,
        approval: { id: String(approval._id) }
      });
    }

    if (lead.stage === 'preparing' && stageValue !== 'preparing') {
      lead.isPreparing = false;
      lead.readyDate = null;
    }

    lead.stage = stageValue;
    lead.updatedAt = new Date();

    if (stageValue === 'preparing') {
      const rd = parseReadyDateFromBody(readyDate);
      lead.readyDate = rd;
      lead.isPreparing = true;
    }

    if (stageValue === 'successful') {
      const amount = dealAmount != null ? Number(dealAmount) : NaN;
      await applyStageSuccessful(lead, amount, comment, closedByValue);
    } else {
      await lead.save();
    }

    const fresh = await Lead.findById(id);
    res.json({
      success: true,
      message: 'Stage updated',
      lead: fresh || lead
    });
  } catch (error) {
    console.error('❌ [ERROR] Error updating lead stage:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/admin/leads/:id/preparing-date - Update ready date for preparing leads (Protected)
app.patch('/api/admin/leads/:id/preparing-date', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { readyDate } = req.body;

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    if (lead.status !== 'new') {
      return res.status(400).json({ error: 'Only active leads can be updated' });
    }
    if (lead.stage !== 'preparing') {
      return res.status(400).json({ error: 'Lead is not in preparing stage' });
    }
    if (isAppManagerUser(req.user) && isLeadClaimedByOther(lead, req.user)) {
      return res.status(403).json({ error: 'Недостаточно прав для изменения воронки по этому лиду' });
    }
    if (!canMovePipeline(req.user, lead)) {
      return res.status(403).json({ error: 'Недостаточно прав для изменения воронки по этому лиду' });
    }

    const rd = parseReadyDateFromBody(readyDate);
    if (!rd) {
      return res.status(400).json({ error: 'readyDate is required' });
    }

    lead.readyDate = rd;
    lead.isPreparing = true;
    lead.updatedAt = new Date();
    await lead.save();

    res.json({
      success: true,
      message: 'Ready date updated',
      lead
    });
  } catch (error) {
    console.error('❌ [ERROR] Error updating preparing date:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/leads/:id/done - Mark lead as done with comment (Protected)
app.post('/api/admin/leads/:id/done', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { comment, label } = req.body;
    const trimmedLabel = label ? String(label).trim() : '';
    if (!LABEL_OPTIONS.includes(trimmedLabel) || trimmedLabel === 'New Client') {
      return res.status(400).json({ error: 'Label is required' });
    }

    const lead = await Lead.findById(id);

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    if (lead.status !== 'new') {
      return res.status(400).json({ error: 'Only active leads can be closed' });
    }
    if (isAppManagerUser(req.user) && isLeadClaimedByOther(lead, req.user)) {
      return res.status(403).json({ error: 'Недостаточно прав для закрытия по этому лиду' });
    }
    if (!canManagerActOnOwnLeadOrBoss(req.user, lead)) {
      return res.status(403).json({ error: 'Недостаточно прав для закрытия по этому лиду' });
    }

    const managerCloseApproval = isAppManagerUser(req.user) && trimmedLabel === 'Successful';
    if (managerCloseApproval) {
      const existing = await Approval.findOne({
        leadId: lead._id,
        type: APPROVAL_TYPE.CLOSE,
        status: APPROVAL_STATUS.PENDING
      });
      if (existing) {
        return res.json({
          success: true,
          pending: true,
          message: PENDING_MSG_RU
        });
      }
      const approval = new Approval({
        type: APPROVAL_TYPE.CLOSE,
        leadId: lead._id,
        requestedBy: getUserIdFromUser(req.user),
        status: APPROVAL_STATUS.PENDING,
        closeDealAmount: null,
        closeComment: comment != null && String(comment).trim() !== '' ? String(comment).trim() : '',
        isStageClose: false,
        doneLabel: 'Successful'
      });
      await approval.save();
      return res.json({
        success: true,
        pending: true,
        message: PENDING_MSG_RU,
        approval: { id: String(approval._id) }
      });
    }

    const closedByValue = closedByFromRequestUser(req.user);
    // Update lead status and comment
    lead.status = 'done';
    lead.closedBy = closedByValue;
    lead.closedAt = new Date();
    lead.label = trimmedLabel;
    lead.updatedAt = new Date();
    if (comment) {
      lead.comment = comment.trim();
      lead.commentUpdatedAt = new Date();
      lead.lastEditedBy = closedByValue;
    }

    // Save to MongoDB - this is immediate (not queued) for admin actions
    await lead.save();
    console.log(`✅ [MONGODB] Lead ${id} marked as done and saved to database`);

    res.json({
      success: true,
      message: 'Lead marked as done',
      lead
    });
  } catch (error) {
    console.error('❌ [ERROR] Error updating lead:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/leads/:id/not - Archive lead (Protected)
app.post('/api/admin/leads/:id/not', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const lead = await Lead.findById(id);

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    if (lead.status !== 'new') {
      return res.status(400).json({ error: 'Only active leads can be archived' });
    }
    if (isAppManagerUser(req.user) && isLeadClaimedByOther(lead, req.user)) {
      return res.status(403).json({ error: 'Недостаточно прав для архивации по этому лиду' });
    }
    if (!canManagerActOnOwnLeadOrBoss(req.user, lead)) {
      return res.status(403).json({ error: 'Недостаточно прав для архивации по этому лиду' });
    }

    if (isAppManagerUser(req.user)) {
      const existing = await Approval.findOne({
        leadId: lead._id,
        type: APPROVAL_TYPE.DELETE,
        status: APPROVAL_STATUS.PENDING
      });
      if (existing) {
        return res.json({
          success: true,
          pending: true,
          message: PENDING_MSG_RU
        });
      }
      const approval = new Approval({
        type: APPROVAL_TYPE.DELETE,
        leadId: lead._id,
        requestedBy: getUserIdFromUser(req.user),
        status: APPROVAL_STATUS.PENDING,
        deleteMode: 'archive'
      });
      await approval.save();
      return res.json({
        success: true,
        pending: true,
        message: PENDING_MSG_RU,
        approval: { id: String(approval._id) }
      });
    }

    const closedByValue = closedByFromRequestUser(req.user);
    // Update lead status to archived
    lead.status = 'archived';
    lead.closedBy = closedByValue;
    lead.closedAt = new Date();
    lead.label = 'Rejected';
    lead.updatedAt = new Date();
    
    // Save to MongoDB - this is immediate (not queued) for admin actions
    await lead.save();
    console.log(`✅ [MONGODB] Lead ${id} archived and saved to database`);

    res.json({
      success: true,
      message: 'Lead archived',
      lead
    });
  } catch (error) {
    console.error('❌ [ERROR] Error archiving lead:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function applyDoneLabel(lead, trimmedLabel, comment, dealAmount, closedByValue) {
  lead.status = 'done';
  lead.closedBy = closedByValue;
  lead.closedAt = new Date();
  lead.label = trimmedLabel;
  lead.updatedAt = new Date();
  if (comment && String(comment).trim() !== '') {
    const c = String(comment).trim();
    lead.comment = c;
    lead.commentUpdatedAt = new Date();
    lead.lastEditedBy = closedByValue;
  }
  if (trimmedLabel === 'Successful' && dealAmount != null) {
    const a = Number(dealAmount);
    if (typeof a === 'number' && !isNaN(a) && a > 0) {
      lead.dealAmount = a;
    }
  }
  await lead.save();
}

// DELETE /api/admin/leads/:id — boss: immediate; manager: approval (own leads only) or 403
app.delete('/api/admin/leads/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (isAppBossUser(req.user)) {
      if (lead.status === 'archived' || lead.status === 'done') {
        return res.status(400).json({ error: 'Lead is not active' });
      }
      await lead.deleteOne();
      return res.json({ success: true, message: 'Lead deleted' });
    }

    if (!isAppManagerUser(req.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (lead.status !== 'new') {
      return res.status(400).json({ error: 'Only active leads can be deleted' });
    }
    if (isLeadClaimedByOther(lead, req.user)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    if (!canManagerRequestDelete(lead, req.user)) {
      return res.status(403).json({ error: 'Можно удалить только лид, созданный вами' });
    }
    if (!canManagerActOnOwnLeadOrBoss(req.user, lead)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }

    const existing = await Approval.findOne({
      leadId: lead._id,
      type: APPROVAL_TYPE.DELETE,
      status: APPROVAL_STATUS.PENDING
    });
    if (existing) {
      return res.json({
        success: true,
        pending: true,
        message: PENDING_MSG_RU
      });
    }
    const approval = new Approval({
      type: APPROVAL_TYPE.DELETE,
      leadId: lead._id,
      requestedBy: getUserIdFromUser(req.user),
      status: APPROVAL_STATUS.PENDING,
      deleteMode: 'hard'
    });
    await approval.save();
    return res.json({
      success: true,
      pending: true,
      message: PENDING_MSG_RU,
      approval: { id: String(approval._id) }
    });
  } catch (error) {
    console.error('❌ [ERROR] Error deleting lead:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/approvals — pending requests (boss only)
app.get('/api/admin/approvals', authenticateAdmin, requireBoss, async (req, res) => {
  try {
    const approvals = await Approval.find({ status: APPROVAL_STATUS.PENDING })
      .sort({ createdAt: -1 })
      .lean();
    const leadIds = [...new Set(approvals.map(a => a.leadId).filter(Boolean))];
    const leads = leadIds.length
      ? await Lead.find({ _id: { $in: leadIds } })
      .select('name surname fullName phoneNumber stage status label dealAmount assignedTo _id')
      : [];
    const leadMap = new Map(leads.map(l => [String(l._id), l]));
    const enriched = approvals.map(a => ({
      ...a,
      lead: leadMap.get(String(a.leadId)) || null
    }));
    res.json({ success: true, approvals: enriched });
  } catch (e) {
    console.error('❌ [ERROR] List approvals:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/approvals/mine — PENDING approvals requested by current manager (hide those leads from pipeline)
app.get('/api/admin/approvals/mine', authenticateAdmin, async (req, res) => {
  try {
    if (isAppBossUser(req.user)) {
      return res.json({ success: true, pending: [] });
    }
    const uid = getUserIdFromUser(req.user);
    if (!uid) {
      return res.json({ success: true, pending: [] });
    }
    const list = await Approval.find({ requestedBy: uid, status: APPROVAL_STATUS.PENDING })
      .sort({ createdAt: -1 })
      .lean();
    const leadIds = [...new Set(list.map(a => a.leadId).filter(Boolean))];
    const leads = leadIds.length
      ? await Lead.find({ _id: { $in: leadIds } })
        .select('name surname fullName phoneNumber _id')
      : [];
    const leadMap = new Map(leads.map(l => [String(l._id), l]));
    const pending = list.map(a => ({
      ...a,
      lead: leadMap.get(String(a.leadId)) || null
    }));
    res.json({ success: true, pending });
  } catch (e) {
    console.error('❌ [ERROR] approvals/mine', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/approval-feed?since=ISO — resolved APPROVE/REJECT for manager (notifications)
app.get('/api/admin/approval-feed', authenticateAdmin, async (req, res) => {
  try {
    if (isAppBossUser(req.user)) {
      return res.json({ success: true, events: [], serverTime: new Date().toISOString() });
    }
    const uid = getUserIdFromUser(req.user);
    if (!uid) {
      return res.json({ success: true, events: [], serverTime: new Date().toISOString() });
    }
    let since = new Date(0);
    if (req.query.since) {
      const d = new Date(String(req.query.since));
      if (!isNaN(d.getTime())) since = d;
    }
    const events = await Approval.find({
      requestedBy: uid,
      status: { $in: [APPROVAL_STATUS.APPROVED, APPROVAL_STATUS.REJECTED] },
      resolvedAt: { $ne: null, $gt: since }
    })
      .sort({ resolvedAt: -1 })
      .limit(30)
      .lean();
    res.json({ success: true, events, serverTime: new Date().toISOString() });
  } catch (e) {
    console.error('❌ [ERROR] approval-feed', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/approvals/:id/resolve { decision: 'approve' | 'reject' } — boss only
app.post('/api/admin/approvals/:id/resolve', authenticateAdmin, requireBoss, async (req, res) => {
  try {
    const { id } = req.params;
    const decision = req.body && req.body.decision != null ? String(req.body.decision).trim() : '';
    if (decision !== 'approve' && decision !== 'reject') {
      return res.status(400).json({ error: 'decision must be approve or reject' });
    }
    const approval = await Approval.findById(id);
    if (!approval) {
      return res.status(404).json({ error: 'Approval not found' });
    }
    if (approval.status !== APPROVAL_STATUS.PENDING) {
      return res.status(400).json({ error: 'Запрос уже обработан' });
    }
    if (decision === 'reject') {
      approval.status = APPROVAL_STATUS.REJECTED;
      approval.resolvedAt = new Date();
      await approval.save();
      return res.json({ success: true, approval, message: 'Rejected' });
    }
    if (approval.type === APPROVAL_TYPE.DELETE) {
      const lead = await Lead.findById(approval.leadId);
      if (lead) {
        if (approval.deleteMode === 'hard') {
          await lead.deleteOne();
        } else {
          lead.status = 'archived';
          lead.label = 'Rejected';
          lead.closedBy = approval.requestedBy;
          lead.closedAt = new Date();
          lead.updatedAt = new Date();
          await lead.save();
        }
      }
      approval.status = APPROVAL_STATUS.APPROVED;
      approval.resolvedAt = new Date();
      await approval.save();
      return res.json({ success: true, approval, message: 'Approved' });
    }
    if (approval.type === APPROVAL_TYPE.CLOSE) {
      const lead = await Lead.findById(approval.leadId);
      if (!lead) {
        approval.status = APPROVAL_STATUS.APPROVED;
        approval.resolvedAt = new Date();
        await approval.save();
        return res.json({ success: true, approval, message: 'Lead missing; request closed' });
      }
      if (approval.isStageClose) {
        const by = approval.requestedBy;
        if (lead.status !== 'new') {
          approval.status = APPROVAL_STATUS.REJECTED;
          approval.resolvedAt = new Date();
          await approval.save();
          return res.status(400).json({ error: 'Лид уже обработан' });
        }
        const amt = approval.closeDealAmount != null ? Number(approval.closeDealAmount) : NaN;
        if (typeof amt !== 'number' || isNaN(amt) || amt <= 0) {
          approval.status = APPROVAL_STATUS.REJECTED;
          approval.resolvedAt = new Date();
          await approval.save();
          return res.status(400).json({ error: 'Некорректная сумма в заявке' });
        }
        await applyStageSuccessful(lead, amt, approval.closeComment, by);
      } else {
        if (lead.status !== 'new') {
          approval.status = APPROVAL_STATUS.REJECTED;
          approval.resolvedAt = new Date();
          await approval.save();
          return res.status(400).json({ error: 'Лид уже обработан' });
        }
        const dl = approval.doneLabel && String(approval.doneLabel).trim() !== ''
          ? String(approval.doneLabel).trim()
          : 'Successful';
        if (!LABEL_OPTIONS.includes(dl) || dl === 'New Client') {
          approval.status = APPROVAL_STATUS.REJECTED;
          approval.resolvedAt = new Date();
          await approval.save();
          return res.status(400).json({ error: 'Invalid label' });
        }
        await applyDoneLabel(
          lead,
          dl,
          approval.closeComment,
          approval.closeDealAmount,
          approval.requestedBy
        );
      }
      approval.status = APPROVAL_STATUS.APPROVED;
      approval.resolvedAt = new Date();
      await approval.save();
      return res.json({ success: true, approval, message: 'Approved' });
    }
    return res.status(500).json({ error: 'Unknown approval type' });
  } catch (e) {
    console.error('❌ [ERROR] resolve approval', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/done-calls - Get all leads with status "done" (Protected)
// Optional query: dateFrom, dateTo (ISO) — filter by closedAt
app.get('/api/admin/done-calls', authenticateAdmin, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const filter = { status: { $in: ['done', 'archived'] } };

    if (dateFrom || dateTo) {
      const andConditions = [];
      if (dateFrom) {
        const from = new Date(dateFrom);
        if (!isNaN(from.getTime())) andConditions.push({ closedAt: { $gte: from } });
      }
      if (dateTo) {
        const to = new Date(dateTo);
        if (!isNaN(to.getTime())) andConditions.push({ closedAt: { $lte: to } });
      }
      if (andConditions.length) filter.$and = andConditions;
    }

    const leads = await Lead.find(filter)
      .sort({ updatedAt: -1 })
      .select('name surname fullName doorType measurements length width dobor phoneNumber priorities comment createdAt updatedAt closedBy closedAt label source lastEditedBy commentUpdatedAt status _id');

    console.log(`📊 [API] Returning ${leads.length} completed lead(s) for done-calls archive`);

    res.json({
      success: true,
      leads
    });
  } catch (error) {
    console.error('❌ [ERROR] Error fetching done-calls:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/archive/export - Export archive to Excel (Protected, optional date filter)
app.get('/api/admin/archive/export', authenticateAdmin, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const filter = { status: { $in: ['done', 'archived'] } };

    if (dateFrom || dateTo) {
      filter.$and = [];
      const dateField = 'closedAt';
      if (dateFrom) {
        const from = new Date(dateFrom);
        if (!isNaN(from.getTime())) filter.$and.push({ [dateField]: { $gte: from } });
      }
      if (dateTo) {
        const to = new Date(dateTo);
        if (!isNaN(to.getTime())) filter.$and.push({ [dateField]: { $lte: to } });
      }
      if (filter.$and.length === 0) delete filter.$and;
    }

    const leads = await Lead.find(filter)
      .sort({ updatedAt: -1 })
      .select('name surname fullName doorType measurements length width dobor phoneNumber priorities comment createdAt updatedAt closedBy closedAt label source _id')
      .lean();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Archive', { views: [{ state: 'frozen', ySplit: 1 }] });

    // --- Result analytics section (top) ---
    const successfulCount = leads.filter(l => (l.label || '') === 'Successful').length;
    const callBackCount = leads.filter(l => (l.label || '') === 'Call Back').length;
    const rejectedCount = leads.filter(l => (l.label || '') === 'Rejected').length;

    sheet.getCell('A1').value = 'Result';
    sheet.getCell('A1').font = { bold: true, size: 12 };
    sheet.getCell('A1').border = { bottom: { style: 'medium' } };
    sheet.getRow(1).height = 20;

    sheet.getCell('A2').value = 'Successful:';
    sheet.getCell('B2').value = successfulCount;
    sheet.getCell('A3').value = 'Call Back:';
    sheet.getCell('B3').value = callBackCount;
    sheet.getCell('A4').value = 'Rejected:';
    sheet.getCell('B4').value = rejectedCount;

    const resultEndRow = 4;
    sheet.getRow(resultEndRow + 1).getCell(1).value = '';

    // Human-readable helpers for export
    const closedByDisplay = (role) => {
      if (role === 'manager' || role === 'boss') return 'Boss Manager';
      if (role === 'call_manager' || role === 'call') return 'Call Manager';
      return role || '—';
    };
    const sourceDisplay = (src) => {
      const map = { instagram: 'Instagram', telegram: 'Telegram', word_of_mouth: 'Sarafan', website: 'Website' };
      return map[src] || src || '—';
    };

    // --- Main data table: header row (spec order) ---
    // FIO, Phone, Date added to archive (closedAt), Comment, Who left comment, Case result, Client source
    const headerRowIndex = resultEndRow + 2;
    const headers = ['Client full name (FIO)', 'Phone number', 'Date added to archive', 'Comment', 'Who left the comment', 'Case result', 'Client source'];
    headers.forEach((h, i) => {
      const cell = sheet.getRow(headerRowIndex).getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
      cell.alignment = { vertical: 'middle' };
    });
    sheet.getRow(headerRowIndex).height = 22;

    const caseResultColIndex = 6; // 1-based: Case result

    leads.forEach((lead, idx) => {
      const rowIndex = headerRowIndex + 1 + idx;
      const row = sheet.getRow(rowIndex);
      const fullName = lead.fullName || [lead.name, lead.surname].filter(Boolean).join(' ').trim() || '—';
      const closedAt = lead.closedAt || lead.updatedAt || lead.createdAt;
      const closedAtStr = closedAt ? new Date(closedAt).toLocaleString() : '—';

      row.getCell(1).value = fullName;
      row.getCell(2).value = lead.phoneNumber || '—';
      row.getCell(3).value = closedAtStr;
      row.getCell(4).value = lead.comment || '';
      row.getCell(5).value = closedByDisplay(lead.closedBy);
      row.getCell(6).value = lead.label || 'New Client';
      row.getCell(7).value = sourceDisplay(lead.source);

      // Case result cell only: conditional background
      const caseResultCell = row.getCell(caseResultColIndex);
      const label = (lead.label || '').trim();
      if (label === 'Successful') {
        caseResultCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF90EE90' } };
        caseResultCell.font = { color: { argb: 'FF000000' } };
      } else if (label === 'Call Back') {
        caseResultCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
        caseResultCell.font = { color: { argb: 'FF000000' } };
      } else if (label === 'Rejected') {
        caseResultCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6B6B' } };
        caseResultCell.font = { color: { argb: 'FF000000' } };
      }
    });

    // Column widths for readability
    [28, 16, 20, 36, 18, 14, 14].forEach((w, i) => {
      sheet.getColumn(i + 1).width = w;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = 'archive-export.xlsx';
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`
    });
    res.send(buffer);
  } catch (error) {
    console.error('❌ [ERROR] Archive Excel export:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/leads/:id/comment - Update archived lead comment (Protected)
app.post('/api/admin/leads/:id/comment', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body;

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (lead.status === 'new') {
      return res.status(400).json({ error: 'Only archived leads can be edited' });
    }

    if (req.user.role === 'call' && (lead.lastEditedBy === 'manager' || lead.lastEditedBy === 'boss')) {
      return res.status(403).json({ error: 'Forbidden: Manager has locked this comment' });
    }

    lead.comment = comment ? comment.trim() : '';
    lead.commentUpdatedAt = new Date();
    lead.lastEditedBy = req.user.role;
    lead.updatedAt = new Date();

    await lead.save();

    res.json({
      success: true,
      message: 'Comment updated',
      lead
    });
  } catch (error) {
    console.error('❌ [ERROR] Error updating archive comment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/analytics/priorities - Count only new priorities (Manager only)
app.get('/api/admin/analytics/priorities', authenticateAdmin, requireManager, async (req, res) => {
  try {
    const pipeline = [
      { $unwind: '$priorities' },
      { $match: { priorities: { $in: PRIORITY_OPTIONS_NEW } } },
      {
        $group: {
          _id: '$priorities',
          count: { $sum: 1 }
        }
      }
    ];

    const raw = await Lead.aggregate(pipeline);

    const result = {};
    PRIORITY_OPTIONS_NEW.forEach(p => { result[p] = 0; });
    raw.forEach(item => {
      result[item._id] = item.count;
    });

    res.json({
      success: true,
      priorities: result
    });
  } catch (error) {
    console.error('❌ [ERROR] Error fetching priority analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/analytics/financial - Revenue and conversion (Manager only)
app.get('/api/admin/analytics/financial', authenticateAdmin, requireManager, async (req, res) => {
  try {
    const totalLeads = await Lead.countDocuments();

    const financial = await Lead.aggregate([
      {
        $match: {
          status: 'done',
          $or: [{ stage: 'successful' }, { label: 'Successful' }],
          dealAmount: { $gt: 0 }
        }
      },
      {
        $group: {
          _id: null,
          successfulDealsCount: { $sum: 1 },
          totalRevenue: { $sum: '$dealAmount' }
        }
      }
    ]);

    const result = financial[0] || { successfulDealsCount: 0, totalRevenue: 0 };
    res.json({
      success: true,
      totalLeads,
      successfulDealsCount: result.successfulDealsCount,
      totalRevenue: result.totalRevenue
    });
  } catch (error) {
    console.error('❌ [ERROR] Error fetching financial analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/analytics/managers - Per-manager stats (Boss: all; Call: own only)
app.get('/api/admin/analytics/managers', authenticateAdmin, async (req, res) => {
  try {
    const keysToReturn = req.user.role === 'call' && req.user.key
      ? [req.user.key]
      : MANAGER_ANALYTICS_KEYS;

    const pipeline = [
      { $match: { status: 'done', closedBy: { $in: keysToReturn } } },
      {
        $group: {
          _id: '$closedBy',
          successfulDealsCount: { $sum: { $cond: [{ $and: [{ $eq: ['$stage', 'successful'] }, { $gt: ['$dealAmount', 0] }] }, 1, 0] } },
          totalRevenue: { $sum: { $cond: [{ $and: [{ $eq: ['$stage', 'successful'] }, { $gt: ['$dealAmount', 0] }] }, '$dealAmount', 0] } },
          totalClosed: { $sum: 1 }
        }
      }
    ];
    const raw = await Lead.aggregate(pipeline);
    const byKey = {};
    raw.forEach(item => {
      byKey[item._id] = item;
    });

    const managers = keysToReturn.map(key => {
      const row = byKey[key] || { successfulDealsCount: 0, totalRevenue: 0, totalClosed: 0 };
      const successfulDeals = row.successfulDealsCount || 0;
      const revenue = row.totalRevenue || 0;
      const totalClosed = row.totalClosed || 0;
      const averageDeal = successfulDeals > 0 ? revenue / successfulDeals : 0;
      const conversionPct = totalClosed > 0 ? (successfulDeals / totalClosed) * 100 : 0;
      return {
        key,
        name: MANAGER_DISPLAY_NAMES[key] || key,
        successfulDeals,
        revenue,
        averageDeal,
        conversionPct
      };
    });

    res.json({ success: true, managers });
  } catch (error) {
    console.error('❌ [ERROR] Error fetching manager analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/analytics/funnel - Pipeline funnel: cumulative reach per stage,
// stage-to-stage conversion, biggest leak, stalled leads, pipeline value (Boss only).
// Query: ?period=today|week|month|all (default all) — filters the lead cohort by createdAt.
const FUNNEL_STALE_DAYS = 3;
const FUNNEL_PERIODS = ['today', 'week', 'month', 'all'];
// Uzbekistan has no DST; fixed UTC+5 so "today" matches the client's calendar day.
const UZ_OFFSET_MS = 5 * 60 * 60 * 1000;
const funnelPeriodStart = (period) => {
  const now = Date.now();
  if (period === 'today') {
    const uz = new Date(now + UZ_OFFSET_MS);
    const uzMidnight = Date.UTC(uz.getUTCFullYear(), uz.getUTCMonth(), uz.getUTCDate());
    return new Date(uzMidnight - UZ_OFFSET_MS);
  }
  if (period === 'week') return new Date(now - 7 * 24 * 60 * 60 * 1000);
  if (period === 'month') return new Date(now - 30 * 24 * 60 * 60 * 1000);
  return null; // 'all'
};
app.get('/api/admin/analytics/funnel', authenticateAdmin, requireManager, async (req, res) => {
  try {
    // Stage order defines the funnel; legacy/unknown stages collapse to 'new'.
    const order = STAGE_OPTIONS; // ['new','in_progress','thinking','successful','preparing']
    const rankOf = (stage) => {
      const i = order.indexOf(stage);
      return i === -1 ? 0 : i;
    };
    const labels = {
      new: 'Новые',
      in_progress: 'В работе',
      thinking: 'Думают',
      successful: 'Успешные',
      preparing: 'Подготовка'
    };

    // Period cohort filter (by createdAt), reused across every aggregation below.
    const period = FUNNEL_PERIODS.includes(req.query.period) ? req.query.period : 'all';
    const start = funnelPeriodStart(period);
    const createdFilter = start ? { createdAt: { $gte: start } } : {};

    // Count non-archived leads grouped by (status, stage). Small datasets -> cheap.
    const grouped = await Lead.aggregate([
      { $match: { status: { $in: ['new', 'done'] }, ...createdFilter } },
      { $group: { _id: { status: '$status', stage: '$stage' }, count: { $sum: 1 } } }
    ]);

    // current[stageRank] = active (status:new) leads sitting AT that stage right now.
    // finalRankCount[rank] = leads (active OR done) whose furthest-known stage == rank.
    const finalRankCount = order.map(() => 0);
    const currentByRank = order.map(() => 0);
    let totalLeads = 0;
    grouped.forEach(({ _id, count }) => {
      const r = rankOf(_id.stage);
      finalRankCount[r] += count;
      totalLeads += count;
      if (_id.status === 'new') currentByRank[r] += count;
    });

    // reached[r] = how many leads got AT LEAST to stage r (cumulative from the top rank down).
    const reached = order.map(() => 0);
    for (let r = order.length - 1; r >= 0; r--) {
      reached[r] = finalRankCount[r] + (r + 1 < order.length ? reached[r + 1] : 0);
    }

    // Stalled active leads per current stage (no update in FUNNEL_STALE_DAYS).
    const staleCutoff = new Date(Date.now() - FUNNEL_STALE_DAYS * 24 * 60 * 60 * 1000);
    const stalledRaw = await Lead.aggregate([
      { $match: { status: 'new', updatedAt: { $lt: staleCutoff }, ...createdFilter } },
      { $group: { _id: '$stage', count: { $sum: 1 } } }
    ]);
    const stalledByRank = order.map(() => 0);
    stalledRaw.forEach(({ _id, count }) => { stalledByRank[rankOf(_id)] += count; });

    const stages = order.map((key, r) => {
      const prevReached = r === 0 ? reached[0] : reached[r - 1];
      const conversionFromPrev = r === 0
        ? 100
        : (prevReached > 0 ? (reached[r] / prevReached) * 100 : 0);
      return {
        key,
        label: labels[key] || key,
        current: currentByRank[r],
        reached: reached[r],
        conversionFromPrev: Math.round(conversionFromPrev * 10) / 10,
        stalled: stalledByRank[r]
      };
    });

    // Biggest leak = consecutive transition with the largest absolute drop in reach.
    let biggestLeak = null;
    for (let r = 1; r < order.length; r++) {
      const drop = reached[r - 1] - reached[r];
      const dropPct = reached[r - 1] > 0 ? (drop / reached[r - 1]) * 100 : 0;
      if (drop > 0 && (!biggestLeak || drop > biggestLeak.drop)) {
        biggestLeak = {
          fromStage: order[r - 1],
          fromLabel: labels[order[r - 1]],
          toStage: order[r],
          toLabel: labels[order[r]],
          drop,
          dropPct: Math.round(dropPct * 10) / 10
        };
      }
    }

    // Won deals + pipeline value (open deals already carrying a dealAmount).
    const [wonAgg, pipelineAgg] = await Promise.all([
      Lead.aggregate([
        { $match: { status: 'done', stage: 'successful', dealAmount: { $gt: 0 }, ...createdFilter } },
        { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$dealAmount' } } }
      ]),
      Lead.aggregate([
        { $match: { status: 'new', stage: { $in: ['successful', 'preparing'] }, dealAmount: { $gt: 0 }, ...createdFilter } },
        { $group: { _id: null, value: { $sum: '$dealAmount' } } }
      ])
    ]);
    const won = wonAgg[0] || { count: 0, revenue: 0 };
    const pipelineValue = pipelineAgg[0] ? pipelineAgg[0].value : 0;

    // Overall conversion: won / everyone who entered the funnel.
    const overallConversion = totalLeads > 0
      ? Math.round((won.count / totalLeads) * 1000) / 10
      : 0;

    res.json({
      success: true,
      period,
      totalLeads,
      staleDays: FUNNEL_STALE_DAYS,
      stages,
      biggestLeak,
      won: { count: won.count, revenue: won.revenue },
      pipelineValue,
      overallConversion
    });
  } catch (error) {
    console.error('❌ [ERROR] Error fetching funnel analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Lightweight polling endpoint: detect new "new" status clients since given timestamp detect new "new" status clients since given timestamp
// Query params:
//   since: ISO timestamp string representing last seen createdAt
// Response:
//   { success, newClients, latestCreatedAt }
app.get('/api/admin/leads/poll', authenticateAdmin, async (req, res) => {
  try {
    const { since } = req.query;

    let sinceDate;
    if (since) {
      const parsed = new Date(since);
      if (isNaN(parsed.getTime())) {
        // Invalid timestamp -> treat as "now" to avoid counting historical data
        sinceDate = new Date();
      } else {
        sinceDate = parsed;
      }
    } else {
      // No timestamp provided -> treat as "now"
      sinceDate = new Date();
    }

    const match = {
      status: 'new',
      createdAt: { $gt: sinceDate }
    };

    const [newClients, latest] = await Promise.all([
      Lead.countDocuments(match),
      Lead.findOne(match).sort({ createdAt: -1 }).select('createdAt').lean()
    ]);

    res.json({
      success: true,
      newClients,
      latestCreatedAt: latest ? latest.createdAt.toISOString() : null
    });
  } catch (error) {
    console.error('❌ [ERROR] Error in leads poll endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// SERVER START (LOCAL ONLY — do not listen when deployed to Vercel)
// ============================================

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📝 Public form: http://localhost:${PORT}/`);
    console.log(`🔐 Admin panel: http://localhost:${PORT}/admin.html`);
    console.log(`✅ Done calls archive: http://localhost:${PORT}/done_calls.html`);
    console.log(`\n💾 MongoDB Info:`);
    console.log(`   Database: ${mongoose.connection.name || 'Will be set on connection'}`);
    console.log(`   Collection: 'leads'`);
    console.log(`   Check data in MongoDB Compass using your connection string\n`);
  });
}

module.exports = app;
