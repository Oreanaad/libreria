// One-off script: seeds the `books` table from books-data.js (the original
// static catalog scraped from booksflea.com). Run once per database:
//   DATABASE_URL=... node server/seed-books.js   (for Neon/production)
//   node server/seed-books.js                    (for local bookstore db)
//
// Stock defaults to 15 units for every title — a placeholder starting
// inventory, not a real count. Adjust real quantities from the admin panel.
require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : new Pool({ database: process.env.PGDATABASE || 'bookstore' });

const DEFAULT_STOCK = 15;

async function main() {
  const src = fs.readFileSync(path.join(__dirname, '../books-data.js'), 'utf-8');
  const match = src.match(/const BOOKS_DATA = (\[[\s\S]*?\n\]);/);
  if (!match) throw new Error('Could not find BOOKS_DATA in books-data.js');
  // eslint-disable-next-line no-eval
  const BOOKS_DATA = eval(match[1]);

  for (const b of BOOKS_DATA) {
    await pool.query(
      `INSERT INTO books (slug, title, author, price, cat, img, url, description, stock)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (slug) DO UPDATE SET
         title = $2, author = $3, price = $4, cat = $5, img = $6, url = $7, description = $8`,
      [b.slug, b.title, b.author, b.price, b.cat, b.img, b.url, b.desc, DEFAULT_STOCK]
    );
    console.log('seeded:', b.slug);
  }
  console.log(`Done — ${BOOKS_DATA.length} books seeded/updated.`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
