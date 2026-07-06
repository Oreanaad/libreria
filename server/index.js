require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Pool } = require('pg');
const { sendPasswordResetEmail } = require('./mailer');

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
  return { id: user.id, name: user.name, email: user.email, is_admin: !!user.is_admin };
}

async function requireAdmin(req, res, next) {
  try {
    const result = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.userId]);
    if (!result.rows[0] || !result.rows[0].is_admin) {
      return res.status(403).json({ error: 'No tenés permisos de administrador.' });
    }
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor.' });
  }
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
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, is_admin',
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

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Falta el email.' });
  try {
    const result = await pool.query('SELECT id, email FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    const user = result.rows[0];
    let previewUrl = null;
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await pool.query('UPDATE users SET reset_token = $2, reset_token_expires = $3 WHERE id = $1', [user.id, token, expires]);
      const origin = req.get('origin') || 'https://booksflea-propuesta.netlify.app';
      const resetUrl = `${origin}/reset-password.html?token=${token}`;
      const sent = await sendPasswordResetEmail(user.email, resetUrl);
      previewUrl = sent.previewUrl; // testing-only: Ethereal preview link, not a real inbox
    }
    // Same response whether or not the email exists, so we don't leak which emails are registered.
    res.json({ ok: true, message: 'Si el email existe, te enviamos instrucciones para restablecer tu contraseña.', previewUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor al procesar la solicitud.' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Faltan datos.' });
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  try {
    const result = await pool.query(
      'SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > now()',
      [token]
    );
    const user = result.rows[0];
    if (!user) return res.status(400).json({ error: 'El enlace es inválido o venció. Pedí uno nuevo.' });
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'UPDATE users SET password_hash = $2, reset_token = NULL, reset_token_expires = NULL WHERE id = $1',
      [user.id, hash]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor al restablecer la contraseña.' });
  }
});

app.get('/api/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, is_admin FROM users WHERE id = $1', [req.userId]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Usuario no encontrado.' });
    res.json({ user: publicUser(result.rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor.' });
  }
});

// ── BOOKS ──
app.get('/api/books', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM books ORDER BY title ASC');
    res.json({ books: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor al obtener el catálogo.' });
  }
});

app.get('/api/books/:slug', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM books WHERE slug = $1', [req.params.slug]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Libro no encontrado.' });
    res.json({ book: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor.' });
  }
});

app.post('/api/books', authenticate, requireAdmin, async (req, res) => {
  const { slug, title, author, price, cat, img, url, description, stock } = req.body || {};
  if (!slug || !title || !author || typeof price !== 'number' || !cat || !img) {
    return res.status(400).json({ error: 'Faltan datos obligatorios: slug, título, autor, precio, categoría e imagen.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO books (slug, title, author, price, cat, img, url, description, stock)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [slug, title, author, price, cat, img, url || null, description || null, Number.isInteger(stock) ? stock : 0]
    );
    res.json({ book: result.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un libro con ese slug.' });
    console.error(e);
    res.status(500).json({ error: 'Error del servidor al crear el libro.' });
  }
});

app.put('/api/books/:slug', authenticate, requireAdmin, async (req, res) => {
  const { title, author, price, cat, img, url, description, stock } = req.body || {};
  try {
    const result = await pool.query(
      `UPDATE books SET
         title = COALESCE($2, title),
         author = COALESCE($3, author),
         price = COALESCE($4, price),
         cat = COALESCE($5, cat),
         img = COALESCE($6, img),
         url = COALESCE($7, url),
         description = COALESCE($8, description),
         stock = COALESCE($9, stock)
       WHERE slug = $1 RETURNING *`,
      [req.params.slug, title, author, price, cat, img, url, description, stock]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Libro no encontrado.' });
    res.json({ book: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor al actualizar el libro.' });
  }
});

app.delete('/api/books/:slug', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM books WHERE slug = $1 RETURNING slug', [req.params.slug]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Libro no encontrado.' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor al eliminar el libro.' });
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
    // Best-effort stock decrement per purchased item (won't go below 0).
    for (const item of items) {
      if (item.slug) {
        await pool.query(
          'UPDATE books SET stock = GREATEST(stock - $2, 0) WHERE slug = $1',
          [item.slug, item.qty || 1]
        );
      }
    }
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

// ── ADMIN ──
app.get('/api/admin/orders', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.id, o.items, o.total, o.status, o.shipping, o.created_at,
              u.name AS user_name, u.email AS user_email
       FROM orders o JOIN users u ON u.id = o.user_id
       ORDER BY o.created_at DESC`
    );
    res.json({ orders: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor al obtener los pedidos.' });
  }
});

app.put('/api/admin/orders/:id', authenticate, requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  const VALID = ['pendiente', 'confirmado', 'enviado', 'entregado', 'cancelado'];
  if (!VALID.includes(status)) {
    return res.status(400).json({ error: `Estado inválido. Usá uno de: ${VALID.join(', ')}.` });
  }
  try {
    const result = await pool.query(
      'UPDATE orders SET status = $2 WHERE id = $1 RETURNING id, status',
      [req.params.id, status]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Pedido no encontrado.' });
    res.json({ order: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor al actualizar el pedido.' });
  }
});

app.get('/api/admin/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.is_admin, u.created_at,
              COUNT(DISTINCT o.id) AS order_count,
              COALESCE(SUM(o.total), 0) AS total_spent
       FROM users u
       LEFT JOIN orders o ON o.user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );
    res.json({ users: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor al obtener los clientes.' });
  }
});

app.get('/api/admin/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const [orders, revenue, users, lowStock, topBooks] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM orders'),
      pool.query(`SELECT COALESCE(SUM(total), 0) AS revenue FROM orders WHERE status != 'cancelado'`),
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT slug, title, stock FROM books WHERE stock <= 3 ORDER BY stock ASC'),
      pool.query(
        `SELECT item->>'slug' AS slug, item->>'title' AS title,
                SUM((item->>'qty')::int) AS qty_sold
         FROM orders o, jsonb_array_elements(o.items) AS item
         WHERE o.status != 'cancelado'
         GROUP BY item->>'slug', item->>'title'
         ORDER BY qty_sold DESC LIMIT 5`
      ),
    ]);
    res.json({
      order_count: Number(orders.rows[0].count),
      revenue: Number(revenue.rows[0].revenue),
      user_count: Number(users.rows[0].count),
      low_stock: lowStock.rows,
      top_books: topBooks.rows.map(r => ({ ...r, qty_sold: Number(r.qty_sold) })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor al obtener las estadísticas.' });
  }
});

// Only bind a real port for local dev (`node index.js`). When required by
// netlify/functions, this module just exports `app` for serverless-http.
if (require.main === module) {
  app.listen(PORT, () => console.log(`Booksflea API escuchando en http://localhost:${PORT}`));
}

module.exports = app;
