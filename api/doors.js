/**
 * Vercel serverless: GET /api/doors
 * Same as: import doors from '../data/doors.js'; export default (req, res) => res.status(200).json(doors);
 * (CommonJS here because data/doors.js and the rest of the app use require() — keeps one module system.)
 */
const doors = require('../data/doors');

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://crm-kukcha.vercel.app',
  'https://kokscha-doors.vercel.app',
  'https://mvp-kokcha.netlify.app',
  'https://api.kukcha-eshiklari.uz'
];

module.exports = (req, res) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  return res.status(200).json(doors);
};
