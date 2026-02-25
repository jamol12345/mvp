// ============================================
// MVP Lead Management System - Express Server
// ============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const path = require('path');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// MIDDLEWARE
// ============================================

// Parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Enable CORS for frontend deployments.
// If CORS_ORIGIN is set, it can be a single origin or a comma-separated list.
const defaultCorsOrigins = [
  'https://mvp-kokcha.netlify.app',
  'https://api.kukcha-eshiklari.uz'
];
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim()).filter(Boolean)
  : defaultCorsOrigins;

app.use(cors({
  origin: corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Serve static files (HTML, CSS)
app.use(express.static(path.join(__dirname, 'public')));

// Health check: no DB dependency, always available (for Vercel/probes)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
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
const STAGE_OPTIONS = ['new', 'in_progress', 'thinking', 'successful', 'rejected'];
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
    required: true,
    default: 0
  },
  width: {
    type: Number,
    required: true,
    default: 0
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
  return unique.slice(0, 2);
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

// Static USERS: Boss + Call Managers (tokens from env)
const USERS = [
  { role: 'boss', name: 'Boss', token: process.env.BOSS_TOKEN || process.env.MANAGER_TOKEN || '' },
  { role: 'call', key: 'anvar', name: 'Анвар', token: process.env.CALL_ANVAR_TOKEN || '' },
  { role: 'call', key: 'akbar', name: 'Акбар', token: process.env.CALL_AKBAR_TOKEN || '' },
  { role: 'call', key: 'davron', name: 'Даврон', token: process.env.CALL_DAVRON_TOKEN || '' }
];
const CALL_MANAGER_KEYS = ['anvar', 'akbar', 'davron'];
const MANAGER_ANALYTICS_KEYS = ['boss', 'anvar', 'akbar', 'davron'];
const MANAGER_DISPLAY_NAMES = { boss: 'Boss', anvar: 'Анвар', akbar: 'Акбар', davron: 'Даврон' };

// Middleware: verify JWT and attach user (role, key?) to request
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
      req.user = { role: 'boss' };
      return next();
    }
    // role === 'call' or 'call_manager'
    const key = decoded.key || (role === 'call_manager' ? 'call' : decoded.key);
    req.user = { role: 'call', key: key || null };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

// Middleware: require boss role (403 if call manager)
const requireBoss = (req, res, next) => {
  if (req.user && req.user.role === 'boss') {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden: Boss access required' });
};

// Legacy alias for routes that already use requireManager
const requireManager = requireBoss;

// ============================================
// PUBLIC API ENDPOINTS
// ============================================

// POST /api/leads - Public endpoint to submit lead form
app.post('/api/leads', async (req, res) => {
  try {
    const { fullName, doorType, measurements, phoneNumber, priorities, priority, language, length, width, dobor } = req.body;

    if (!fullName || !doorType || !measurements || !phoneNumber) {
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

    const languageValue = sanitizeLanguage(language);

    const leadData = {
      fullName: fullName.trim(),
      doorType: doorType.trim(),
      measurements: measurements.trim(),
      length: lengthNum,
      width: widthNum,
      dobor: doborValue,
      phoneNumber: phoneNumber.trim(),
      priorities: prioritiesArray,
      name: '',
      surname: '',
      status: 'new',
      label: 'New Client',
      source: 'website',
      language: languageValue,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const lead = new Lead(leadData);
    await lead.save();
    console.log(`✅ [MONGODB] Lead submitted: ${lead.fullName}`);

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
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }
  const trimmed = token.trim();
  const user = USERS.find(u => u.token && u.token.trim() === trimmed);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
  const payload = user.role === 'boss' ? { role: 'boss' } : { role: 'call', key: user.key };
  const jwtToken = jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' });
  const response = {
    success: true,
    message: 'Login successful',
    token: jwtToken,
    role: user.role,
    name: user.name
  };
  if (user.role === 'call') {
    response.key = user.key;
  }
  res.json(response);
});

// POST /api/admin/leads - Add client manually (Manager only)
app.post('/api/admin/leads', authenticateAdmin, requireManager, async (req, res) => {
  try {
    const { fullName, doorType, measurements, phoneNumber, priorities, priority, source, length, width, dobor } = req.body;
    if (!fullName || !doorType || !measurements || !phoneNumber) {
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
    const lead = new Lead({
      fullName: fullName.trim(),
      doorType: doorType.trim(),
      measurements: measurements.trim(),
      length: lengthNum,
      width: widthNum,
      dobor: doborValue,
      phoneNumber: phoneNumber.trim(),
      priorities: prioritiesArray,
      name: '',
      surname: '',
      status: 'new',
      label: 'New Client',
      source: sourceValue
    });
    await lead.save();
    console.log(`✅ [MONGODB] Lead added by manager: ${lead.fullName}`);
    res.status(201).json({ success: true, message: 'Client added', lead });
  } catch (error) {
    console.error('❌ [ERROR] Error adding lead:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/leads - Get leads with status "new" (Boss: all; Call: only assignedTo === key)
app.get('/api/admin/leads', authenticateAdmin, async (req, res) => {
  try {
    const query = { status: 'new' };
    if (req.user.role === 'call' && req.user.key) {
      query.assignedTo = req.user.key;
    }
    const leads = await Lead.find(query)
      .sort({ createdAt: -1 })
      .select('name surname fullName doorType measurements length width dobor phoneNumber priorities label source stage assignedTo createdAt _id');

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

// PATCH /api/admin/leads/:id/stage - Update lead stage (Protected; both roles can move cards)
app.patch('/api/admin/leads/:id/stage', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { stage, comment, dealAmount } = req.body;
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

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    if (lead.status !== 'new') {
      return res.status(400).json({ error: 'Only active leads can be moved' });
    }

    lead.stage = stageValue;
    lead.updatedAt = new Date();
    const closedByValue = req.user.role === 'call' ? req.user.key : 'boss';
    if (stageValue === 'successful' || stageValue === 'rejected') {
      lead.status = 'done';
      lead.closedAt = new Date();
      lead.closedBy = closedByValue;
      lead.label = stageValue === 'successful' ? 'Successful' : 'Rejected';
      if (stageValue === 'successful') {
        const amount = dealAmount != null ? Number(dealAmount) : NaN;
        if (typeof amount === 'number' && !isNaN(amount) && amount > 0) {
          lead.dealAmount = amount;
        }
        if (comment != null && String(comment).trim() !== '') {
          lead.comment = String(comment).trim();
          lead.commentUpdatedAt = new Date();
          lead.lastEditedBy = closedByValue;
        }
      }
    }
    await lead.save();

    res.json({
      success: true,
      message: 'Stage updated',
      lead
    });
  } catch (error) {
    console.error('❌ [ERROR] Error updating lead stage:', error);
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

    const closedByValue = req.user.role === 'call' ? req.user.key : 'boss';
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

    const closedByValue = req.user.role === 'call' ? req.user.key : 'boss';
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
// SERVER START (LOCAL) + SERVERLESS EXPORT
// ============================================

if (require.main === module) {
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
