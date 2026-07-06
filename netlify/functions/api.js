// Thin re-export so Netlify's bundler picks this up as the function entry
// point, while the actual Express app + serverless-http wrapping lives in
// server/lambda.js (kept there so it resolves server/node_modules).
module.exports = require('../../server/lambda.js');
