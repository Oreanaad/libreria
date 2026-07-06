// Shared auth helper — used by index.html, catalogo.html, libro.html,
// login.html, mi-cuenta.html and cart.js.
// Backend: server/index.js (Express + Postgres), served locally at :3001
// during development, or via Netlify Functions (/api/*) once deployed.
const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'http://localhost:3001/api'
  : '/api';

const AUTH_TOKEN_KEY = 'bf-token';
const AUTH_USER_KEY = 'bf-user';

function getToken() { return localStorage.getItem(AUTH_TOKEN_KEY); }
function getUser() {
  try { return JSON.parse(localStorage.getItem(AUTH_USER_KEY)); }
  catch (e) { return null; }
}
function isLoggedIn() { return !!getToken(); }

function setSession(token, user) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

function logout() {
  clearSession();
  location.href = 'index.html';
}

// Fetch wrapper that attaches the auth token and throws with the server's
// error message on failure, so callers can just show err.message.
async function authFetch(path, options = {}) {
  const token = getToken();
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, Object.assign({}, options, { headers }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ocurrió un error inesperado.');
  return data;
}

// Updates any nav auth link (#authLink) on the page to reflect session state.
function updateAuthNav() {
  document.querySelectorAll('.auth-link').forEach(link => {
    if (isLoggedIn()) {
      const user = getUser();
      link.textContent = user && user.name ? user.name.split(' ')[0] : 'Mi cuenta';
      link.href = 'mi-cuenta.html';
    } else {
      link.textContent = 'Iniciar sesión';
      link.href = 'login.html';
    }
  });
}

document.addEventListener('DOMContentLoaded', updateAuthNav);
