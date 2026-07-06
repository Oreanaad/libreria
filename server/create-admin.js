// One-off script: creates (or promotes) an admin account.
// Usage:
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... ADMIN_NAME=... node server/create-admin.js        (local)
//   DATABASE_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node server/create-admin.js      (Neon/production)
require('dotenv').config({ path: __dirname + '/.env' });
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : new Pool({ database: process.env.PGDATABASE || 'bookstore' });

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || 'Booksflea Admin';
  if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD env vars.');

  const hash = await bcrypt.hash(password, 10);
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length) {
    await pool.query('UPDATE users SET is_admin = true, password_hash = $2 WHERE email = $1', [email, hash]);
    console.log(`Promoted existing user to admin: ${email}`);
  } else {
    await pool.query(
      'INSERT INTO users (name, email, password_hash, is_admin) VALUES ($1, $2, $3, true)',
      [name, email, hash]
    );
    console.log(`Created new admin account: ${email}`);
  }
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
