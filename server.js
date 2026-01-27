// ============================================
// MVP Lead Management System - Express Server
// ============================================

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// MIDDLEWARE
// ============================================

// Parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (HTML, CSS)
app.use(express.static('public'));

// ============================================
// MONGODB CONNECTION
// ============================================

// TODO: Replace 'YOUR_MONGODB_CONNECTION_STRING' with your actual MongoDB URI
// Example: mongodb://localhost:27017/leads or mongodb+srv://user:pass@cluster.mongodb.net/leads
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://zhamal2k04:12345@cluster0.ek0f7zz.mongodb.net/?appName=Cluster0';

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

const leadSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  surname: {
    type: String,
    required: true
  },
  phoneNumber: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['new', 'done', 'archived'],
    default: 'new'
  },
  comment: {
    type: String,
    default: ''
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
// DELAYED SAVE QUEUE SYSTEM
// ============================================

// In-memory queue to buffer incoming leads
// This prevents one-to-one heavy MongoDB writes during high traffic
const leadsQueue = [];

// Background worker: Process queue every 4 seconds
// This batches inserts to MongoDB, reducing write load
const QUEUE_PROCESS_INTERVAL = 4000; // 4 seconds

// Background worker function: Batch insert queued leads to MongoDB
async function processLeadsQueue() {
  if (leadsQueue.length === 0) {
    return; // Nothing to process
  }

  // Copy current queue and clear it immediately
  const batch = [...leadsQueue];
  leadsQueue.length = 0;

  console.log(`📦 [QUEUE] Processing batch of ${batch.length} lead(s)...`);

  try {
    // Batch insert using insertMany for better performance
    const result = await Lead.insertMany(batch, { ordered: false });
    console.log(`✅ [MONGODB] Successfully saved ${result.length} lead(s) to database`);
    console.log(`   Collection: 'leads' | Database: ${mongoose.connection.name}`);
  } catch (error) {
    console.error('❌ [MONGODB] Error saving batch to database:', error);
    // In production, you might want to re-queue failed items or log to a dead-letter queue
  }
}

// Start background worker
setInterval(processLeadsQueue, QUEUE_PROCESS_INTERVAL);
console.log(`🔄 [QUEUE] Background worker started (processing every ${QUEUE_PROCESS_INTERVAL/1000}s)`);

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================

// Middleware to verify admin token
const authenticateAdmin = (req, res, next) => {
  // Get token from Authorization header
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  // Extract token (format: "Bearer TOKEN" or just "TOKEN")
  const token = authHeader.startsWith('Bearer ') 
    ? authHeader.slice(7) 
    : authHeader;

  // TODO: Replace 'YOUR_ADMIN_TOKEN' with your actual admin token in .env file
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '995f313ae663bfc5b935dddba3abe931fd042eb7e82bea633f984553427188b3';

  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }

  next();
};

// ============================================
// PUBLIC API ENDPOINTS
// ============================================

// POST /api/leads - Public endpoint to submit lead form
// Uses delayed save: Data is queued and saved in batches by background worker
app.post('/api/leads', async (req, res) => {
  try {
    const { name, surname, phoneNumber } = req.body;

    // Validate required fields
    if (!name || !surname || !phoneNumber) {
      return res.status(400).json({ 
        error: 'Missing required fields: name, surname, phoneNumber' 
      });
    }

    // Create lead data object (not a Mongoose document yet)
    const leadData = {
      name: name.trim(),
      surname: surname.trim(),
      phoneNumber: phoneNumber.trim(),
      status: 'new',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Add to queue instead of saving immediately
    leadsQueue.push(leadData);
    console.log(`📥 [QUEUE] Lead received and queued: ${leadData.name} ${leadData.surname} (Queue size: ${leadsQueue.length})`);

    // Respond immediately to user (data will be saved by background worker)
    res.status(201).json({ 
      success: true, 
      message: 'Lead submitted successfully',
      note: 'Your information has been received and will be processed shortly'
    });
  } catch (error) {
    console.error('❌ [ERROR] Error processing lead request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// ADMIN API ENDPOINTS
// ============================================

// POST /api/admin/login - Admin login endpoint
app.post('/api/admin/login', (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  // TODO: Replace 'YOUR_ADMIN_TOKEN' with your actual admin token in .env file
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '995f313ae663bfc5b935dddba3abe931fd042eb7e82bea633f984553427188b3';

  if (token === ADMIN_TOKEN) {
    res.json({ 
      success: true, 
      message: 'Login successful',
      token: ADMIN_TOKEN // Return token for client to store
    });
  } else {
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
});

// GET /api/admin/leads - Get all leads with status "new" (Protected)
app.get('/api/admin/leads', authenticateAdmin, async (req, res) => {
  try {
    const leads = await Lead.find({ status: 'new' })
      .sort({ createdAt: -1 }) // Most recent first
      .select('name surname phoneNumber createdAt _id');

    res.json({ 
      success: true, 
      leads 
    });
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/leads/:id/done - Mark lead as done with comment (Protected)
app.post('/api/admin/leads/:id/done', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body;

    const lead = await Lead.findById(id);

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Update lead status and comment
    lead.status = 'done';
    lead.updatedAt = new Date();
    if (comment) {
      lead.comment = comment.trim();
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

    // Update lead status to archived
    lead.status = 'archived';
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
// Returns completed deals for the done_calls archive page
app.get('/api/admin/done-calls', authenticateAdmin, async (req, res) => {
  try {
    const leads = await Lead.find({ status: 'done' })
      .sort({ updatedAt: -1 }) // Most recently closed first
      .select('name surname phoneNumber comment createdAt updatedAt _id');

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

// ============================================
// SERVER START
// ============================================

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
