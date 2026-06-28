/**
 * One-time migration: create the initial per-user accounts (boss/anvar/akbar/davron)
 * in the `users` collection with generated passwords. Idempotent — skips users that
 * already exist. Plaintext passwords are written ONLY to SEED-CREDENTIALS.txt
 * (gitignored) so they never hit stdout/git.
 *
 * Run once locally BEFORE deploying the username/password backend:
 *   node scripts/seed-users.cjs
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULTS = [
  { key: 'boss', name: 'Boss', role: 'boss' },
  { key: 'anvar', name: 'Анвар', role: 'call' },
  { key: 'akbar', name: 'Акбар', role: 'call' },
  { key: 'davron', name: 'Даврон', role: 'call' }
];

const userSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  username: { type: String, required: true, unique: true, index: true },
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

function genPassword() {
  // 12 url-safe chars — strong enough as an initial password the user changes later.
  return crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12);
}

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI is not set'); process.exit(1); }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const created = [];
  const skipped = [];
  for (const d of DEFAULTS) {
    const existing = await User.findOne({ $or: [{ key: d.key }, { username: d.key }] }).lean();
    if (existing) { skipped.push(d.key); continue; }
    const password = genPassword();
    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({
      key: d.key, username: d.key, name: d.name, role: d.role,
      active: true, passwordHash, createdBy: 'seed'
    });
    created.push({ ...d, password });
  }

  if (created.length) {
    const lines = [];
    lines.push('CRM — initial account credentials');
    lines.push('Generated: ' + new Date().toISOString());
    lines.push('IMPORTANT: change these passwords after first login. Do NOT commit this file.');
    lines.push('');
    for (const c of created) {
      lines.push(`${c.name}  [${c.role}]   login: ${c.key}   password: ${c.password}`);
    }
    lines.push('');
    const outPath = path.join(__dirname, '..', 'SEED-CREDENTIALS.txt');
    fs.writeFileSync(outPath, lines.join('\n'), { mode: 0o600 });
    console.log(`\n✅ Created ${created.length} account(s). Passwords written to: ${outPath}`);
    console.log('   Users created:', created.map(c => c.key).join(', '));
  } else {
    console.log('\nNo new accounts created.');
  }
  if (skipped.length) console.log('   Skipped (already exist):', skipped.join(', '));

  await mongoose.connection.close();
  process.exit(0);
})().catch((e) => { console.error('Seed failed:', e); process.exit(1); });
