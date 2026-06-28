// ============================================
// MVP Lead Management System - Express Server
// ============================================

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const ExcelJS = require('exceljs');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// REALTIME (Socket.IO) — `io` is created at the bottom (after all routes); these
// helpers are safe no-ops until then. The Mongoose post-hooks below push changes
// to connected clients so managers see updates without reloading.
// ============================================
let io = null;
function rtEmitAll(event, payload = {}) { if (io) io.to('all').emit(event, payload); }
function rtEmitBoss(event, payload = {}) { if (io) io.to('boss').emit(event, payload); }
function rtEmitManager(key, event, payload = {}) { if (io && key) io.to('mgr:' + String(key)).emit(event, payload); }

// Cross-process realtime: a MongoDB change stream catches writes from ANY process
// (this Railway server, the legacy Vercel serverless backend, maintenance scripts) —
// not just this one. Without it, a lead saved by another backend wouldn't reach
// connected admins until the slow fallback poll. Requires a replica set (Atlas has one).
let changeStream = null;
function startChangeStreams() {
  if (!io) return;
  try {
    if (changeStream) { try { changeStream.close(); } catch (e) {} changeStream = null; }
    const stream = mongoose.connection.watch([], { fullDocument: 'updateLookup' });
    changeStream = stream;
    stream.on('change', (change) => {
      const coll = change.ns && change.ns.coll;
      if (coll === 'leads') {
        const id = change.documentKey && change.documentKey._id;
        rtEmitAll('lead:changed', { id: id ? String(id) : null });
      } else if (coll === 'approvals') {
        rtEmitAll('approval:changed', {});
      } else if (coll === 'tasks') {
        const doc = change.fullDocument;
        rtEmitAll('lead:changed', doc && doc.leadId ? { id: String(doc.leadId) } : {});
      }
    });
    stream.on('error', (err) => {
      console.error('⚠️ [CHANGE-STREAM] error; restarting in 3s:', err.message);
      try { stream.close(); } catch (e) {}
      changeStream = null;
      setTimeout(startChangeStreams, 3000);
    });
    console.log('📡 [CHANGE-STREAM] watching leads/approvals/tasks (cross-process realtime)');
  } catch (e) {
    console.error('⚠️ [CHANGE-STREAM] failed to start (replica set required):', e.message);
  }
}

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
    refreshUserCache();
    setInterval(refreshUserCache, 60000); // keep cache fresh (covers edits from another instance)
    // Only the persistent Railway server (run directly) holds sockets and watches the DB.
    // When imported as a module (legacy Vercel serverless), require.main !== module → skip.
    if (require.main === module) startChangeStreams();
  })
  .catch((error) => {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  });

// ============================================
// MONGOOSE SCHEMA
// ============================================

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
  phoneNormalized: {
    type: String,
    default: '',
    index: true
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
// Index updatedAt for the live-sync version endpoint (sorts active leads by updatedAt)
leadSchema.index({ status: 1, updatedAt: -1 });

// Update updatedAt before saving
leadSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Realtime: every lead write pushes a board-change signal to all connected clients.
// Document hooks (save/deleteOne) carry the doc; query hooks (updateOne/findOneAndUpdate)
// may not — we still emit so the client reconciles by refetching (guarantees no lost update).
leadSchema.post('save', function (doc) { if (doc) rtEmitAll('lead:changed', { id: String(doc._id), status: doc.status }); });
leadSchema.post('findOneAndUpdate', function (doc) { if (doc) rtEmitAll('lead:changed', { id: String(doc._id), status: doc.status }); });
leadSchema.post('updateOne', function () { rtEmitAll('lead:changed', {}); });
leadSchema.post('deleteOne', { document: true, query: false }, function (doc) { rtEmitAll('lead:changed', { id: doc ? String(doc._id) : null, removed: true }); });

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

// Realtime: approval create/resolve refreshes the boss queue and notifies the requester.
approvalSchema.post('save', function (doc) {
  if (!doc) return;
  rtEmitBoss('approval:changed', { id: String(doc._id), status: doc.status });
  rtEmitManager(doc.requestedBy, 'approval:changed', { id: String(doc._id), status: doc.status });
});

const Approval = mongoose.model('Approval', approvalSchema);

// ============================================
// ACTIVITY LOG (amoCRM-style per-lead timeline)
// ============================================
const ACTIVITY_TYPE = {
  CREATED: 'created',
  COMMENT: 'comment',
  ASSIGNED: 'assigned',
  CLAIMED: 'claimed',
  STAGE: 'stage_changed',
  CLOSED_WON: 'closed_won',
  CLOSED_LOST: 'closed_lost',
  ARCHIVED: 'archived',
  DELETED: 'deleted',
  TASK_CREATED: 'task_created',
  TASK_DONE: 'task_done',
  TASK_CANCELLED: 'task_cancelled'
};

const activitySchema = new mongoose.Schema({
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  phoneNormalized: { type: String, default: '', index: true },
  type: { type: String, required: true },
  text: { type: String, default: '' },          // free-form comment text
  author: { type: String, default: '' },        // user key: boss/anvar/akbar/davron/system
  authorName: { type: String, default: '' },    // display name
  meta: { type: mongoose.Schema.Types.Mixed, default: {} }, // {fromStage,toStage,dealAmount,label,assignedTo,...}
  createdAt: { type: Date, default: Date.now, index: true }
});
activitySchema.index({ leadId: 1, createdAt: 1 });

const Activity = mongoose.model('Activity', activitySchema);

// ============================================
// TASKS (follow-up / reminders, amoCRM-style "next action")
// ============================================
const TASK_TYPE = { CALL: 'call', MEETING: 'meeting', MEASUREMENT: 'measurement', FOLLOWUP: 'followup', OTHER: 'other' };
const TASK_STATUS = { OPEN: 'open', DONE: 'done', CANCELLED: 'cancelled' };

const taskSchema = new mongoose.Schema({
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  phoneNormalized: { type: String, default: '', index: true }, // denormalized, like Activity — survives lead lifecycle
  type: { type: String, enum: Object.values(TASK_TYPE), default: TASK_TYPE.CALL },
  title: { type: String, default: '' },                 // optional free-form description
  dueAt: { type: Date, required: true, index: true },
  assignee: { type: String, default: '' },              // user key: boss/anvar/akbar/davron
  status: { type: String, enum: Object.values(TASK_STATUS), default: TASK_STATUS.OPEN, index: true },
  createdBy: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
  completedBy: { type: String, default: '' },
  result: { type: String, default: '' }                 // outcome note left on completion
});
taskSchema.index({ status: 1, dueAt: 1 });
taskSchema.index({ assignee: 1, status: 1, dueAt: 1 });

// Realtime: a task change affects its lead's card chip → nudge the board.
taskSchema.post('save', function (doc) { if (doc && doc.leadId) rtEmitAll('lead:changed', { id: String(doc.leadId) }); });

const Task = mongoose.model('Task', taskSchema);

// ============================================
// USERS (per-account auth: username + password, replaces shared role tokens)
// ============================================
const userSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },      // immutable identity used across leads/activities/tasks/approvals
  username: { type: String, required: true, unique: true, index: true }, // login handle (= key)
  passwordHash: { type: String, required: true },
  name: { type: String, default: '' },
  role: { type: String, enum: ['boss', 'call'], default: 'call' },
  active: { type: Boolean, default: true },
  createdBy: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  lastLoginAt: { type: Date, default: null }
});
const User = mongoose.model('User', userSchema);

// In-memory snapshot so per-request auth + display + key-lists need no DB hit. Active keys gate
// access (instant revoke). The name map includes INACTIVE users too, so historical attribution
// on old leads never shows a blank.
async function refreshUserCache() {
  try {
    const users = await User.find({}).select('key name role active').lean();
    if (!users.length) return; // keep defaults as break-glass if the collection is empty
    const names = {}; const active = new Set(); const calls = []; const analytics = [];
    for (const u of users) {
      names[u.key] = u.name || u.key;
      if (u.active) {
        active.add(u.key);
        analytics.push(u.key);
        if (u.role === 'call') calls.push(u.key);
      }
    }
    MANAGER_DISPLAY_NAMES = names;
    activeUserKeys = active;
    CALL_MANAGER_KEYS = calls;
    MANAGER_ANALYTICS_KEYS = analytics;
  } catch (e) {
    console.error('⚠️ [USER-CACHE] refresh failed:', e.message);
  }
}

// Append a timeline entry. Never throws into the request flow (best-effort logging).
async function logActivity(lead, type, { text = '', author = '', authorName = '', meta = {} } = {}) {
  try {
    if (!lead || !lead._id) return;
    await Activity.create({
      leadId: lead._id,
      phoneNormalized: lead.phoneNormalized || normalizePhone(lead.phoneNumber),
      type,
      text: String(text || ''),
      author: String(author || ''),
      authorName: String(authorName || ''),
      meta: meta || {}
    });
  } catch (e) {
    console.error('⚠️ [ACTIVITY] Failed to log activity:', e.message);
  }
}

// Resolve a user's key + display name for activity authorship.
function actorFromUser(user) {
  if (!user) return { author: 'system', authorName: 'System' };
  if (isAppBossUser(user)) {
    const k = getUserIdFromUser(user) || 'boss';
    return { author: k, authorName: MANAGER_DISPLAY_NAMES[k] || 'Boss' };
  }
  const key = user.key || getUserIdFromUser(user) || 'call';
  return { author: key, authorName: MANAGER_DISPLAY_NAMES[key] || key };
}

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

// Per-user accounts live in the `users` collection (see User model below). DEFAULT_USERS is
// only used to (a) seed the in-memory cache before the first DB load and (b) act as a break-glass
// if the collection is empty. 'boss' is the boss identity key; the rest are call managers.
const DEFAULT_USERS = [
  { role: 'boss', key: 'boss', name: 'Boss' },
  { role: 'call', key: 'anvar', name: 'Анвар' },
  { role: 'call', key: 'akbar', name: 'Акбар' },
  { role: 'call', key: 'davron', name: 'Даврон' }
];
// Start from defaults; refreshUserCache() REPLACES these from the DB. Kept as `let` so the rest
// of the app (assignment / analytics / tasks / display) always reads live values.
let CALL_MANAGER_KEYS = DEFAULT_USERS.filter(u => u.role === 'call').map(u => u.key);
let MANAGER_ANALYTICS_KEYS = DEFAULT_USERS.map(u => u.key);
let MANAGER_DISPLAY_NAMES = DEFAULT_USERS.reduce((m, u) => { m[u.key] = u.name; return m; }, {});
let activeUserKeys = new Set(DEFAULT_USERS.map(u => u.key));
function isUserActive(key) { return !!key && activeUserKeys.has(String(key)); }

// --- RBAC: BOSS / MANAGER (call managers) ---
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
    } else {
      // role === 'call' or 'call_manager'
      const key = decoded.key || (role === 'call_manager' ? 'call' : decoded.key);
      const k = key || null;
      const appRole = decoded.appRole === APP_ROLE.MANAGER || decoded.appRole === APP_ROLE.BOSS
        ? decoded.appRole
        : APP_ROLE.MANAGER;
      const userId = decoded.userId != null && String(decoded.userId) !== '' ? String(decoded.userId) : (k || 'call');
      req.user = { role: 'call', key: k, appRole, userId };
    }
    // Per-user revoke: reject if the account is no longer active (instant via the cache).
    const idKey = req.user.role === 'boss' ? req.user.userId : req.user.key;
    if (idKey && !isUserActive(idKey)) {
      return res.status(401).json({ error: 'Account disabled' });
    }
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

// Matching key for "same customer" lookups: digits only, last 9 (UZ local number).
// Makes +998 90 123-45-67, 998901234567, 901234567 all match the same person.
function normalizePhone(raw) {
  const digits = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (!digits) return '';
  return digits.length > 9 ? digits.slice(-9) : digits;
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

// Brute-force guard for admin login. Counts FAILED attempts per IP in a sliding
// window; a successful login clears the counter, so legit users are never blocked.
// In-memory (per process) — effective on the single persistent Railway server.
const LOGIN_RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const LOGIN_MAX_FAILURES = 10;               // failed attempts per IP per window
const loginFailures = new Map();
function loginRecentFailures(ip) {
  const now = Date.now();
  const key = String(ip || 'unknown');
  const hits = (loginFailures.get(key) || []).filter(t => now - t < LOGIN_RATE_WINDOW_MS);
  loginFailures.set(key, hits);
  return hits;
}
function loginRateLimited(ip) {
  return loginRecentFailures(ip).length >= LOGIN_MAX_FAILURES;
}
function recordLoginFailure(ip) {
  const hits = loginRecentFailures(ip);
  hits.push(Date.now());
  loginFailures.set(String(ip || 'unknown'), hits);
  if (loginFailures.size > 5000) loginFailures.clear(); // bound memory
}
function clearLoginFailures(ip) {
  loginFailures.delete(String(ip || 'unknown'));
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
        phoneNormalized: normalizePhone(phoneNumber),
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
        phoneNormalized: normalizePhone(phoneNumber),
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
    await logActivity(lead, ACTIVITY_TYPE.CREATED, {
      author: 'system', authorName: 'Website',
      meta: { source: lead.source }
    });

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
app.post('/api/admin/login', async (req, res) => {
  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
  if (loginRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many login attempts, please try again later' });
  }
  const username = String((req.body && req.body.username) || '').trim().toLowerCase();
  const password = String((req.body && req.body.password) || '');
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  try {
    const user = await User.findOne({ username });
    const ok = !!user && user.active && await bcrypt.compare(password, user.passwordHash || '');
    if (!ok) {
      recordLoginFailure(clientIp);
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    clearLoginFailures(clientIp);
    user.lastLoginAt = new Date();
    await user.save();
    const isBoss = user.role === 'boss';
    const payload = isBoss
      ? { role: 'boss', appRole: APP_ROLE.BOSS, userId: user.key }
      : { role: 'call', key: user.key, appRole: APP_ROLE.MANAGER, userId: user.key };
    const jwtToken = jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
    const response = {
      success: true,
      message: 'Login successful',
      token: jwtToken,
      role: user.role,
      appRole: isBoss ? APP_ROLE.BOSS : APP_ROLE.MANAGER,
      userId: user.key,
      name: user.name
    };
    if (!isBoss) response.key = user.key;
    res.json(response);
  } catch (e) {
    console.error('❌ [LOGIN] error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// USER MANAGEMENT (boss only)
// ============================================
function sanitizeUsername(v) {
  return String(v || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
}
function publicUser(u) {
  return { id: String(u._id), key: u.key, username: u.username, name: u.name, role: u.role, active: u.active, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt };
}

app.get('/api/admin/users', authenticateAdmin, requireBoss, async (req, res) => {
  try {
    const users = await User.find({}).sort({ active: -1, role: 1, username: 1 }).lean();
    res.json({ success: true, users: users.map(publicUser) });
  } catch (e) {
    console.error('❌ [USERS] list:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/users', authenticateAdmin, requireBoss, async (req, res) => {
  try {
    const username = sanitizeUsername(req.body && req.body.username);
    const name = String((req.body && req.body.name) || '').trim();
    const role = (req.body && req.body.role) === 'boss' ? 'boss' : 'call';
    const password = String((req.body && req.body.password) || '');
    if (!username) return res.status(400).json({ error: 'Логин обязателен (a-z, 0-9, . _ -)' });
    if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    const exists = await User.findOne({ $or: [{ username }, { key: username }] }).lean();
    if (exists) return res.status(409).json({ error: 'Такой пользователь уже существует' });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      key: username, username, name: name || username, role, active: true,
      passwordHash, createdBy: getUserIdFromUser(req.user)
    });
    await refreshUserCache();
    res.status(201).json({ success: true, user: publicUser(user) });
  } catch (e) {
    console.error('❌ [USERS] create:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/admin/users/:id', authenticateAdmin, requireBoss, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const isSelf = String(user.key) === String(getUserIdFromUser(req.user));
    const body = req.body || {};

    if (body.name != null) user.name = String(body.name).trim() || user.name;
    if (body.role === 'boss' || body.role === 'call') {
      if (isSelf && body.role !== 'boss') return res.status(400).json({ error: 'Нельзя снять роль boss с самого себя' });
      user.role = body.role;
    }
    if (body.active != null) {
      const nextActive = !!body.active;
      if (isSelf && !nextActive) return res.status(400).json({ error: 'Нельзя отключить свой аккаунт' });
      user.active = nextActive;
    }
    let generatedPassword = null;
    if (body.resetPassword === true) {
      // Boss-initiated reset: generate a new password and return it ONCE to display.
      generatedPassword = crypto.randomBytes(8).toString('base64').replace(/[+/=]/g, '').slice(0, 10);
      user.passwordHash = await bcrypt.hash(generatedPassword, 10);
    } else if (body.password != null) {
      const pw = String(body.password);
      if (pw.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
      user.passwordHash = await bcrypt.hash(pw, 10);
    }
    // Never leave the system without an active boss.
    if (user.role !== 'boss' || !user.active) {
      const otherBoss = await User.findOne({ role: 'boss', active: true, _id: { $ne: user._id } }).select('_id').lean();
      if (!otherBoss) return res.status(400).json({ error: 'Должен остаться хотя бы один активный boss' });
    }
    user.updatedAt = new Date();
    await user.save();
    await refreshUserCache();
    const out = publicUser(user);
    if (generatedPassword) out.newPassword = generatedPassword;
    res.json({ success: true, user: out });
  } catch (e) {
    console.error('❌ [USERS] update:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
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
        phoneNormalized: normalizePhone(phoneNumber),
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
        phoneNormalized: normalizePhone(phoneNumber),
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
    {
      const actor = actorFromUser(req.user);
      await logActivity(lead, ACTIVITY_TYPE.CREATED, { ...actor, meta: { source: lead.source, manual: true } });
    }
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
      .select('name surname fullName doorType measurements length width dobor phoneNumber phoneNormalized priorities label source stage assignedTo isPreparing readyDate createdBy lockedUntil createdAt updatedAt _id')
      .lean();

    // Mark returning customers: active leads whose phone matches a prior closed/archived deal.
    const norms = [...new Set(leads
      .map(l => l.phoneNormalized || normalizePhone(l.phoneNumber))
      .filter(Boolean))];
    const priorCount = {};
    const priorWon = {}; // LTV: sum of prior successfully-closed deal amounts, by phone
    if (norms.length) {
      const priors = await Lead.aggregate([
        { $match: { status: { $in: ['done', 'archived'] }, phoneNormalized: { $in: norms } } },
        { $group: {
          _id: '$phoneNormalized',
          count: { $sum: 1 },
          wonRevenue: { $sum: { $cond: [
            { $and: [{ $eq: ['$status', 'done'] }, { $eq: ['$stage', 'successful'] }, { $gt: ['$dealAmount', 0] }] },
            '$dealAmount', 0
          ] } }
        } }
      ]);
      priors.forEach(p => { priorCount[p._id] = p.count; priorWon[p._id] = p.wonRevenue || 0; });
    }
    // Attach each lead's open-task summary (next due task + count) so cards render the
    // task chip without per-card requests.
    const leadIds = leads.map(l => l._id);
    const openTasksByLead = {};
    if (leadIds.length) {
      const openTasks = await Task.find({ leadId: { $in: leadIds }, status: 'open' })
        .select('leadId type dueAt assignee')
        .sort({ dueAt: 1 })
        .lean();
      openTasks.forEach(t => {
        const k = String(t.leadId);
        (openTasksByLead[k] || (openTasksByLead[k] = [])).push(t);
      });
    }

    const enriched = leads.map(l => {
      const norm = l.phoneNormalized || normalizePhone(l.phoneNumber);
      const count = priorCount[norm] || 0;
      const ltasks = openTasksByLead[String(l._id)] || [];
      const nextTask = ltasks.length
        ? { type: ltasks[0].type, dueAt: ltasks[0].dueAt, assignee: ltasks[0].assignee }
        : null;
      return { ...l, isReturning: count > 0, priorDealsCount: count, priorWonRevenue: priorWon[norm] || 0, nextTask, openTaskCount: ltasks.length };
    });

    res.json({
      success: true,
      leads: enriched
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

    const prevAssigned = lead.assignedTo || null;
    lead.assignedTo = value;
    lead.updatedAt = new Date();
    await lead.save();

    if (prevAssigned !== value) {
      const actor = actorFromUser(req.user);
      await logActivity(lead, ACTIVITY_TYPE.ASSIGNED, {
        ...actor,
        meta: {
          from: prevAssigned,
          to: value,
          toName: value ? (MANAGER_DISPLAY_NAMES[value] || value) : null
        }
      });
    }

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
  return getUserIdFromUser(user) || 'boss';
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
    await logActivity(updated, ACTIVITY_TYPE.CLAIMED, {
      author: key,
      authorName: MANAGER_DISPLAY_NAMES[key] || key,
      meta: { toStage: 'in_progress' }
    });
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
  await logActivity(lead, ACTIVITY_TYPE.CLOSED_WON, {
    author: closedByValue,
    authorName: MANAGER_DISPLAY_NAMES[closedByValue] || closedByValue,
    text: comment != null ? String(comment).trim() : '',
    meta: { dealAmount: lead.dealAmount, label: lead.label }
  });
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

    const prevStage = lead.stage || 'new';

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
      await applyStageSuccessful(lead, amount, comment, closedByValue); // logs CLOSED_WON
    } else {
      await lead.save();
      if (prevStage !== stageValue) {
        const actor = actorFromUser(req.user);
        await logActivity(lead, ACTIVITY_TYPE.STAGE, {
          ...actor,
          meta: {
            fromStage: prevStage,
            toStage: stageValue,
            readyDate: stageValue === 'preparing' && lead.readyDate ? lead.readyDate : undefined
          }
        });
      }
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
    const prevStage = lead.stage || 'new';
    // Update lead status to archived
    lead.status = 'archived';
    lead.closedBy = closedByValue;
    lead.closedAt = new Date();
    lead.label = 'Rejected';
    lead.updatedAt = new Date();

    // Save to MongoDB - this is immediate (not queued) for admin actions
    await lead.save();
    console.log(`✅ [MONGODB] Lead ${id} archived and saved to database`);
    await logActivity(lead, ACTIVITY_TYPE.CLOSED_LOST, {
      author: closedByValue,
      authorName: MANAGER_DISPLAY_NAMES[closedByValue] || closedByValue,
      meta: { fromStage: prevStage, label: lead.label }
    });

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
  const won = trimmedLabel === 'Successful';
  await logActivity(lead, won ? ACTIVITY_TYPE.CLOSED_WON : ACTIVITY_TYPE.CLOSED_LOST, {
    author: closedByValue,
    authorName: MANAGER_DISPLAY_NAMES[closedByValue] || closedByValue,
    text: comment != null ? String(comment).trim() : '',
    meta: { label: trimmedLabel, dealAmount: won ? lead.dealAmount : undefined }
  });
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

// ============================================
// ACTIVITY TIMELINE + CUSTOMER HISTORY (amoCRM-style)
// ============================================

// For leads with no Activity records yet (created before this feature), build a
// virtual timeline from existing fields so old/returning customers still have history.
function synthesizeActivities(lead) {
  const out = [];
  const createdByName = !lead.createdBy || lead.createdBy === 'system'
    ? 'Website'
    : (MANAGER_DISPLAY_NAMES[lead.createdBy] || lead.createdBy);
  out.push({
    _id: 'syn-created-' + lead._id,
    leadId: lead._id,
    type: ACTIVITY_TYPE.CREATED,
    text: '',
    author: lead.createdBy || 'system',
    authorName: createdByName,
    meta: { source: lead.source, synthesized: true },
    createdAt: lead.createdAt
  });
  if (lead.status === 'done' || lead.status === 'archived') {
    const won = lead.status === 'done' && lead.stage === 'successful';
    out.push({
      _id: 'syn-closed-' + lead._id,
      leadId: lead._id,
      type: won ? ACTIVITY_TYPE.CLOSED_WON : ACTIVITY_TYPE.CLOSED_LOST,
      text: lead.comment || '',
      author: lead.closedBy || '',
      authorName: MANAGER_DISPLAY_NAMES[lead.closedBy] || lead.closedBy || '—',
      meta: { label: lead.label, dealAmount: won ? lead.dealAmount : undefined, synthesized: true },
      createdAt: lead.closedAt || lead.updatedAt || lead.createdAt
    });
  } else if (lead.comment && String(lead.comment).trim()) {
    out.push({
      _id: 'syn-comment-' + lead._id,
      leadId: lead._id,
      type: ACTIVITY_TYPE.COMMENT,
      text: lead.comment,
      author: lead.lastEditedBy || '',
      authorName: MANAGER_DISPLAY_NAMES[lead.lastEditedBy] || lead.lastEditedBy || '—',
      meta: { synthesized: true },
      createdAt: lead.commentUpdatedAt || lead.updatedAt || lead.createdAt
    });
  }
  return out;
}

async function getTimeline(lead) {
  const real = await Activity.find({ leadId: lead._id }).sort({ createdAt: 1 }).lean();
  // Merge synthesized anchors (created/closed/legacy-comment) so pre-feature history
  // survives even after the first real activity is added to an old lead.
  const synth = synthesizeActivities(lead);
  const hasType = (t) => real.some(a => a.type === t);
  const merged = [...real];
  for (const s of synth) {
    if (s.type === ACTIVITY_TYPE.CREATED && !hasType(ACTIVITY_TYPE.CREATED)) merged.push(s);
    else if ((s.type === ACTIVITY_TYPE.CLOSED_WON || s.type === ACTIVITY_TYPE.CLOSED_LOST)
      && !hasType(ACTIVITY_TYPE.CLOSED_WON) && !hasType(ACTIVITY_TYPE.CLOSED_LOST)) merged.push(s);
    else if (s.type === ACTIVITY_TYPE.COMMENT && !hasType(ACTIVITY_TYPE.COMMENT)) merged.push(s);
  }
  merged.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return merged;
}

// GET /api/admin/leads/:id/activity — full timeline of one lead
app.get('/api/admin/leads/:id/activity', authenticateAdmin, async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id).lean();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const activities = await getTimeline(lead);
    res.json({ success: true, activities });
  } catch (error) {
    console.error('❌ [ERROR] Error fetching lead activity:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/leads/:id/activity { text } — add a manager comment to the timeline
app.post('/api/admin/leads/:id/activity', authenticateAdmin, async (req, res) => {
  try {
    const text = req.body && req.body.text != null ? String(req.body.text).trim() : '';
    if (!text) return res.status(400).json({ error: 'Comment text is required' });
    if (text.length > 2000) return res.status(400).json({ error: 'Comment is too long' });

    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Boss: any lead. Manager: only leads they are allowed to act on (own / not taken by other).
    if (isAppManagerUser(req.user)) {
      if (isLeadClaimedByOther(lead, req.user) || !canManagerActOnOwnLeadOrBoss(req.user, lead)) {
        return res.status(403).json({ error: 'Недостаточно прав для комментария по этому лиду' });
      }
    }

    const actor = actorFromUser(req.user);
    await logActivity(lead, ACTIVITY_TYPE.COMMENT, { ...actor, text });

    // Keep latest comment on the lead and bump updatedAt so live-sync notices.
    lead.comment = text;
    lead.commentUpdatedAt = new Date();
    lead.lastEditedBy = actor.author;
    lead.updatedAt = new Date();
    await lead.save();

    res.json({ success: true, message: 'Comment added' });
  } catch (error) {
    console.error('❌ [ERROR] Error adding lead comment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// TASK HELPERS + ENDPOINTS
// ============================================
const TASK_ASSIGNEE_KEYS = ['boss', ...CALL_MANAGER_KEYS];

function parseDueAt(value) {
  if (value == null || String(value).trim() === '') return null;
  const s = String(value).trim();
  // date-only (yyyy-mm-dd) → local noon to avoid TZ edge; otherwise parse as full datetime
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s);
  if (isNaN(d.getTime())) return null;
  return d;
}

function sanitizeTaskType(v) {
  const s = String(v || '').trim();
  return Object.values(TASK_TYPE).includes(s) ? s : TASK_TYPE.CALL;
}

// Who is responsible: boss may assign to anyone; manager — always themselves.
function resolveTaskAssignee(user, lead, requested) {
  if (isAppBossUser(user)) {
    const r = String(requested || '').trim();
    if (TASK_ASSIGNEE_KEYS.includes(r)) return r;
    if (lead && lead.assignedTo && CALL_MANAGER_KEYS.includes(String(lead.assignedTo))) return String(lead.assignedTo);
    return 'boss';
  }
  return user.key || 'call';
}

// Manager may manage tasks only on own/claimed lead; boss — any.
function canManageLeadTasks(user, lead) {
  if (isAppBossUser(user)) return true;
  if (!isAppManagerUser(user) || !user.key) return false;
  if (isLeadClaimedByOther(lead, user)) return false;
  return canManagerActOnOwnLeadOrBoss(user, lead);
}

function canCompleteTask(user, task) {
  if (isAppBossUser(user)) return true;
  if (!user || !user.key) return false;
  return String(task.assignee) === String(user.key) || String(task.createdBy) === String(getUserIdFromUser(user));
}

// Touch a lead's updatedAt so the live-sync version endpoint notices task changes.
async function touchLead(leadId) {
  try { await Lead.updateOne({ _id: leadId }, { $set: { updatedAt: new Date() } }); } catch (e) { /* best-effort */ }
}

// POST /api/admin/leads/:id/tasks — create a follow-up task on a lead
app.post('/api/admin/leads/:id/tasks', authenticateAdmin, async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!canManageLeadTasks(req.user, lead)) {
      return res.status(403).json({ error: 'Недостаточно прав для задачи по этому лиду' });
    }
    const dueAt = parseDueAt(req.body && req.body.dueAt);
    if (!dueAt) return res.status(400).json({ error: 'Укажите корректный срок задачи' });
    const type = sanitizeTaskType(req.body && req.body.type);
    const title = req.body && req.body.title != null ? String(req.body.title).trim().slice(0, 500) : '';
    const assignee = resolveTaskAssignee(req.user, lead, req.body && req.body.assignee);
    const actor = actorFromUser(req.user);

    const task = await Task.create({
      leadId: lead._id,
      phoneNormalized: lead.phoneNormalized || normalizePhone(lead.phoneNumber),
      type, title, dueAt, assignee,
      status: TASK_STATUS.OPEN,
      createdBy: actor.author
    });

    await logActivity(lead, ACTIVITY_TYPE.TASK_CREATED, {
      ...actor, text: title,
      meta: { taskId: String(task._id), taskType: type, dueAt, assignee }
    });
    await touchLead(lead._id);

    res.json({ success: true, task });
  } catch (error) {
    console.error('❌ [ERROR] create task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/leads/:id/tasks — all tasks for a lead (open by due asc, then closed)
app.get('/api/admin/leads/:id/tasks', authenticateAdmin, async (req, res) => {
  try {
    const tasks = await Task.find({ leadId: req.params.id }).sort({ status: 1, dueAt: 1 }).lean();
    res.json({ success: true, tasks });
  } catch (error) {
    console.error('❌ [ERROR] list lead tasks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/tasks/:taskId/complete — mark a task done (optional result note)
app.post('/api/admin/tasks/:taskId/complete', authenticateAdmin, async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.status !== TASK_STATUS.OPEN) return res.status(409).json({ error: 'Задача уже закрыта' });
    if (!canCompleteTask(req.user, task)) return res.status(403).json({ error: 'Недостаточно прав' });

    const actor = actorFromUser(req.user);
    const result = req.body && req.body.result != null ? String(req.body.result).trim().slice(0, 1000) : '';
    task.status = TASK_STATUS.DONE;
    task.completedAt = new Date();
    task.completedBy = actor.author;
    task.result = result;
    await task.save();

    const lead = await Lead.findById(task.leadId);
    if (lead) {
      await logActivity(lead, ACTIVITY_TYPE.TASK_DONE, {
        ...actor, text: result,
        meta: { taskId: String(task._id), taskType: task.type }
      });
      await touchLead(lead._id);
    }
    res.json({ success: true, task });
  } catch (error) {
    console.error('❌ [ERROR] complete task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/admin/tasks/:taskId — reschedule / edit an open task
app.patch('/api/admin/tasks/:taskId', authenticateAdmin, async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.status !== TASK_STATUS.OPEN) return res.status(409).json({ error: 'Задача уже закрыта' });
    if (!canCompleteTask(req.user, task)) return res.status(403).json({ error: 'Недостаточно прав' });

    if (req.body && req.body.dueAt != null) {
      const dueAt = parseDueAt(req.body.dueAt);
      if (!dueAt) return res.status(400).json({ error: 'Некорректный срок' });
      task.dueAt = dueAt;
    }
    if (req.body && req.body.type != null) task.type = sanitizeTaskType(req.body.type);
    if (req.body && req.body.title != null) task.title = String(req.body.title).trim().slice(0, 500);
    if (req.body && req.body.assignee != null && isAppBossUser(req.user)) {
      const r = String(req.body.assignee).trim();
      if (TASK_ASSIGNEE_KEYS.includes(r)) task.assignee = r;
    }
    await task.save();
    await touchLead(task.leadId);
    res.json({ success: true, task });
  } catch (error) {
    console.error('❌ [ERROR] edit task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/tasks?scope=mine|all&filter=overdue|today|upcoming|open|done
//   Boss: defaults to all; manager: always own (assignee = key). Joins minimal lead info.
app.get('/api/admin/tasks', authenticateAdmin, async (req, res) => {
  try {
    const boss = isAppBossUser(req.user);
    const scope = String(req.query.scope || (boss ? 'all' : 'mine'));
    const filter = String(req.query.filter || 'open');

    const q = {};
    if (!boss || scope === 'mine') {
      q.assignee = boss ? 'boss' : (req.user.key || '__none__');
    } else if (boss && req.query.assignee) {
      // boss can filter the "all" list down to one manager
      const a = String(req.query.assignee).trim();
      if (TASK_ASSIGNEE_KEYS.includes(a)) q.assignee = a;
    }
    if (filter === 'done') {
      q.status = TASK_STATUS.DONE;
    } else {
      q.status = TASK_STATUS.OPEN;
      const now = new Date();
      const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
      if (filter === 'overdue') q.dueAt = { $lt: now };
      else if (filter === 'today') q.dueAt = { $lte: endToday };
      else if (filter === 'upcoming') q.dueAt = { $gt: endToday };
    }

    const tasks = await Task.find(q).sort({ dueAt: 1 }).limit(500).lean();
    const ids = [...new Set(tasks.map(t => String(t.leadId)))];
    const leads = ids.length
      ? await Lead.find({ _id: { $in: ids } }).select('fullName name surname phoneNumber stage status').lean()
      : [];
    const leadById = {};
    leads.forEach(l => { leadById[String(l._id)] = l; });
    const enriched = tasks.map(t => {
      const l = leadById[String(t.leadId)] || null;
      const leadName = l ? (l.fullName || [l.name, l.surname].filter(Boolean).join(' ').trim() || l.phoneNumber) : '';
      return { ...t, lead: l ? { _id: l._id, name: leadName, phoneNumber: l.phoneNumber, stage: l.stage, status: l.status } : null };
    });
    res.json({ success: true, tasks: enriched });
  } catch (error) {
    console.error('❌ [ERROR] list tasks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/customers/history?phone=...&excludeLeadId=... — prior deals of the same customer
app.get('/api/admin/customers/history', authenticateAdmin, async (req, res) => {
  try {
    const norm = normalizePhone(req.query.phone);
    if (!norm) return res.json({ success: true, leads: [] });
    const exclude = req.query.excludeLeadId;

    let query = { phoneNormalized: norm };
    if (exclude) query._id = { $ne: exclude };
    let leads = await Lead.find(query).sort({ createdAt: -1 }).lean();

    // Legacy fallback: leads created before phoneNormalized was backfilled.
    if (!leads.length) {
      const q2 = { phoneNumber: new RegExp(norm + '$') };
      if (exclude) q2._id = { $ne: exclude };
      leads = await Lead.find(q2).sort({ createdAt: -1 }).lean();
    }

    const out = [];
    for (const l of leads) {
      out.push({
        _id: l._id,
        fullName: l.fullName,
        phoneNumber: l.phoneNumber,
        status: l.status,
        stage: l.stage,
        label: l.label,
        dealAmount: l.dealAmount,
        closedBy: l.closedBy,
        closedByName: MANAGER_DISPLAY_NAMES[l.closedBy] || l.closedBy || null,
        closedAt: l.closedAt,
        createdAt: l.createdAt,
        comment: l.comment,
        activities: await getTimeline(l)
      });
    }
    res.json({ success: true, leads: out });
  } catch (error) {
    console.error('❌ [ERROR] Error fetching customer history:', error);
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

// Lightweight polling endpoint: detect new "new" status clients since given timestamp
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

// GET /api/admin/leads/version — cheap state signature for near-real-time sync.
// Changes when: active-lead count changes (new/closed/deleted), any active lead is
// updated (assignment, stage move, edit), or the pending-approval count changes.
// The client polls this every few seconds and only reloads data when it differs.
app.get('/api/admin/leads/version', authenticateAdmin, async (req, res) => {
  try {
    const [count, latest, pendingApprovals] = await Promise.all([
      Lead.countDocuments({ status: 'new' }),
      Lead.findOne({ status: 'new' }).sort({ updatedAt: -1 }).select('updatedAt').lean(),
      Approval.countDocuments({ status: APPROVAL_STATUS.PENDING })
    ]);
    const latestMs = latest && latest.updatedAt ? new Date(latest.updatedAt).getTime() : 0;
    res.json({
      success: true,
      version: count + ':' + latestMs + ':' + pendingApprovals
    });
  } catch (error) {
    console.error('❌ [ERROR] Error in leads version endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// SERVER START + REALTIME (Socket.IO on the same HTTP server)
// Listens when run directly (Railway: `node server.js`, local: `npm start`).
// When imported as a module (tests / legacy serverless), it does NOT listen —
// the Express `app` is still exported for those callers.
// ============================================

const httpServer = http.createServer(app);

// The same HTTP server upgrades connections to WebSocket. The frontend is served
// from this same origin in production, so CORS only matters for cross-origin dev.
io = new Server(httpServer, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'], credentials: true }
});

// Authenticate every socket with the SAME JWT used for REST (sent in handshake.auth.token).
// Mirrors authenticateAdmin so socket.user matches req.user semantics.
io.use((socket, next) => {
  try {
    const raw = socket.handshake.auth && socket.handshake.auth.token ? String(socket.handshake.auth.token) : '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
    if (!token) return next(new Error('unauthorized'));
    const decoded = jwt.verify(token, JWT_SECRET);
    const role = decoded.role;
    if (!role || !['manager', 'call_manager', 'boss', 'call'].includes(role)) {
      return next(new Error('unauthorized'));
    }
    if (role === 'boss' || role === 'manager') {
      socket.user = { role: 'boss', appRole: APP_ROLE.BOSS, userId: decoded.userId != null ? String(decoded.userId) : 'boss' };
    } else {
      const key = decoded.key || null;
      socket.user = { role: 'call', key, appRole: APP_ROLE.MANAGER, userId: key || 'call' };
    }
    next();
  } catch (e) {
    next(new Error('unauthorized'));
  }
});

// On connect, join broadcast rooms: everyone → 'all'; boss → 'boss'; manager → 'mgr:<key>'.
io.on('connection', (socket) => {
  const u = socket.user || {};
  socket.join('all');
  if (isAppBossUser(u)) socket.join('boss');
  else if (u.key) socket.join('mgr:' + String(u.key));
});

if (require.main === module) {
  httpServer.listen(PORT, () => {
    console.log(`🚀 Server (HTTP + WebSocket) running on http://localhost:${PORT}`);
    console.log(`📡 Realtime: Socket.IO ready (rooms: all / boss / mgr:<key>)`);
    console.log(`📝 Public form: http://localhost:${PORT}/`);
    console.log(`🔐 Admin panel: http://localhost:${PORT}/admin.html`);
    console.log(`✅ Archive: http://localhost:${PORT}/done_calls.html`);
    console.log(`💾 MongoDB: ${mongoose.connection.name || '(connecting…)'} / collection 'leads'`);
  });

  // Graceful shutdown: Railway sends SIGTERM on every redeploy/stop. Close the change
  // stream, sockets, and Mongo cleanly so nothing is cut off mid-write.
  const gracefulShutdown = (signal) => {
    console.log(`\n${signal} received — shutting down gracefully…`);
    const force = setTimeout(() => { console.error('⚠️ Forced exit (cleanup timed out)'); process.exit(1); }, 10000);
    force.unref();
    try { if (changeStream) { changeStream.close(); changeStream = null; } } catch (e) {}
    const closeDb = () => mongoose.connection.close().then(() => process.exit(0)).catch(() => process.exit(0));
    if (io) { try { io.close(closeDb); } catch (e) { closeDb(); } }
    else { httpServer.close(closeDb); }
  };
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

module.exports = app;
