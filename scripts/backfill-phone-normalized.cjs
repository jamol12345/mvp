// One-time backfill: set phoneNormalized on all existing leads.
// Safe & idempotent — only writes the derived field; re-running changes nothing.
// Usage: node scripts/backfill-phone-normalized.cjs
require('dotenv').config();
const mongoose = require('mongoose');

function normalizePhone(raw) {
  const digits = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (!digits) return '';
  return digits.length > 9 ? digits.slice(-9) : digits;
}

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI missing'); process.exit(1); }
  await mongoose.connect(uri);
  const Lead = mongoose.connection.collection('leads');

  const cursor = Lead.find({}, { projection: { phoneNumber: 1, phoneNormalized: 1 } });
  let scanned = 0, updated = 0;
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    scanned++;
    const norm = normalizePhone(doc.phoneNumber);
    if (norm && doc.phoneNormalized !== norm) {
      await Lead.updateOne({ _id: doc._id }, { $set: { phoneNormalized: norm } });
      updated++;
    }
  }
  console.log(`✅ Backfill done. Scanned ${scanned}, updated ${updated}.`);
  await mongoose.disconnect();
  process.exit(0);
})().catch(e => { console.error('❌ Backfill failed:', e); process.exit(1); });
