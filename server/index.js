require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 3001;

// Local dev: connects to the local `bookstore` Postgres by socket/user.
// Production (Netlify): DATABASE_URL points at the hosted Neon instance,
// which requires SSL.
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : new Pool({ database: process.env.PGDATABASE || 'bookstore' });

const app = express();
app.use(cors());
app.use(express.json());

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}

function signToken(user) {
  return jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

// ── AUTH ──
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Faltan datos: nombre, email y contraseña son obligatorios.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  }
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name.trim(), email.toLowerCase().trim(), hash]
    );
    const user = result.rows[0];
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor al crear la cuenta.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Faltan datos: email y contraseña son obligatorios.' });
  }
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor al iniciar sesión.' });
  }
});

app.get('/api/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [req.userId]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Usuario no encontrado.' });
    res.json({ user: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor.' });
  }
});

// ── ORDERS ──
app.get('/api/orders', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, items, total, status, shipping, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
      [req.userId]
    );
    res.json({ orders: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor al obtener los pedidos.' });
  }
});

app.post('/api/orders', authenticate, async (req, res) => {
  const { items, total, shipping } = req.body || {};
  if (!Array.isArray(items) || !items.length || typeof total !== 'number') {
    return res.status(400).json({ error: 'Pedido inválido.' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO orders (user_id, items, total, shipping) VALUES ($1, $2, $3, $4) RETURNING id, items, total, status, shipping, created_at',
      [req.userId, JSON.stringify(items), total, shipping ? JSON.stringify(shipping) : null]
    );
    res.json({ order: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor al guardar el pedido.' });
  }
});

// ── REVIEWS ──
app.get('/api/reviews/mine', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, book_slug, book_title, rating, comment, created_at FROM reviews WHERE user_id = $1 ORDER BY created_at DESC',
      [req.userId]
    );
    res.json({ reviews: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor al obtener tus reseñas.' });
  }
});

app.get('/api/reviews/summary', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT book_slug, ROUND(AVG(rating)::numeric, 1) AS avg_rating, COUNT(*) AS count
       FROM reviews GROUP BY book_slug`
    );
    const summary = {};
    result.rows.forEach(r => { summary[r.book_slug] = { avg: Number(r.avg_rating), count: Number(r.count) }; });
    res.json({ summary });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor al obtener el resumen de reseñas.' });
  }
});

app.get('/api/reviews/book/:slug', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.rating, r.comment, r.created_at, u.name AS user_name
       FROM reviews r JOIN users u ON u.id = r.user_id
       WHERE r.book_slug = $1 ORDER BY r.created_at DESC`,
      [req.params.slug]
    );
    res.json({ reviews: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor al obtener las reseñas.' });
  }
});

app.post('/api/reviews', authenticate, async (req, res) => {
  const { book_slug, book_title, rating, comment } = req.body || {};
  if (!book_slug || !book_title || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Reseña inválida: falta el libro o la calificación (1 a 5).' });
  }
  try {
    // Only allow reviewing books the client actually bought.
    const owns = await pool.query(
      `SELECT 1 FROM orders WHERE user_id = $1 AND items @> $2::jsonb LIMIT 1`,
      [req.userId, JSON.stringify([{ slug: book_slug }])]
    );
    if (!owns.rows.length) {
      return res.status(403).json({ error: 'Solo podés reseñar libros que hayas comprado.' });
    }
    const result = await pool.query(
      `INSERT INTO reviews (user_id, book_slug, book_title, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, book_slug) DO UPDATE SET rating = $4, comment = $5, created_at = now()
       RETURNING id, book_slug, book_title, rating, comment, created_at`,
      [req.userId, book_slug, book_title, rating, comment || null]
    );
    res.json({ review: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor al guardar la reseña.' });
  }
});

// Only bind a real port for local dev (`node index.js`). When required by
// netlify/functions, this module just exports `app` for serverless-http.
if (require.main === module) {
  app.listen(PORT, () => console.log(`Booksflea API escuchando en http://localhost:${PORT}`));
}

module.exports = app;
