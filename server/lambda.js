// Wraps the Express app (server/index.js) for Netlify Functions.
// Lives inside server/ so it resolves server/node_modules naturally.
const serverless = require('serverless-http');
const app = require('./index.js');

module.exports.handler = serverless(app);
