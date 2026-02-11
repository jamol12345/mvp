// Vercel serverless: export Express app as handler. Do not call app.listen().
const app = require('../server');

module.exports = app;
