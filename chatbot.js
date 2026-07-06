/* Flea — the Booksflea recommendation chatbot.
   Self-contained: injects its own styles and DOM, so any page just needs
   <script src="auth.js"></script> (for fetchBooks/API_BASE) followed by
   <script src="chatbot.js"></script>. Matches free-text or category taps
   against the real `books` table (title/author/description/category) —
   no external AI, no API keys, no per-message cost.
*/
(function () {

const CATS = [
  { slug: 'fantasia', label: 'Fantasía', icon: '🐉' },
  { slug: 'novela', label: 'Novela y romance', icon: '💌' },
  { slug: 'dibujo', label: 'Dibujo y coloring', icon: '🎨' },
  { slug: 'arte', label: 'Arte', icon: '🖌️' },
  { slug: 'infantil', label: 'Infantil', icon: '🧸' },
  { slug: 'autoayuda-y-espiritualidad', label: 'Autoayuda', icon: '🌿' },
  { slug: 'anatomia', label: 'Anatomía', icon: '🧠' },
  { slug: 'ficcion-historica', label: 'Ficción histórica', icon: '🏛️' },
  { slug: 'entretenimiento', label: 'Entretenimiento', icon: '🧩' }
];

const CATEGORY_KEYWORDS = {
  fantasia: ['fantasia','fantasía','dragon','dragones','magia','magico','mágico','epica','épica','reino','reinos','hada','hadas','fae'],
  novela: ['novela','romance','romantico','romántico','amor','pareja','drama','narrativa'],
  dibujo: ['dibujo','dibujar','colorear','coloring','pintar','crayones'],
  arte: ['arte','ilustracion','ilustración','diseño','disenio'],
  infantil: ['infantil','ninos','niños','ninas','niñas','chicos','chicas','cuento','cuentos'],
  'autoayuda-y-espiritualidad': ['autoayuda','espiritualidad','motivacion','motivación','mindfulness','crecimiento','sanar','bienestar','positivo'],
  anatomia: ['anatomia','anatomía','medicina','cuerpo','medico','médico','estudiante de medicina'],
  'ficcion-historica': ['historia','historico','histórico','historica','histórica','guerra','roma','emperador','cesar','césar'],
  entretenimiento: ['juego','juegos','rompecabezas','acertijo','acertijos','misterio','pasatiempo']
};

function normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Common connector words — excluded from free-text overlap scoring so a
// query like "algo para sanar" doesn't match every book whose description
// happens to contain "para".
const STOPWORDS = new Set(['para','que','con','los','las','del','una','uno','unos','unas','como','esta','este','estos','estas','tiene','tienen','sobre','entre','desde','hasta','pero','todo','toda','todos','todas','soy','muy','mas','más','algo','quiero','busco','tipo','libro','libros']);

function scoreBook(book, queryNorm, queryWords) {
  let score = 0;
  Object.entries(CATEGORY_KEYWORDS).forEach(([cat, words]) => {
    const hit = words.some(w => queryNorm.includes(normalize(w)));
    if (hit && book.cat === cat) score += 6;
  });
  // Title/author word matches are a much more specific signal than a
  // generic category keyword (e.g. "harry potter" should outrank any
  // book merely tagged the same category), so they're weighted higher.
  const titleHay = normalize(book.title);
  const authorHay = normalize(book.author);
  const descHay = normalize(book.desc || '');
  queryWords.forEach(w => {
    if (w.length <= 3 || STOPWORDS.has(w)) return;
    if (titleHay.includes(w)) score += 5;
    else if (authorHay.includes(w)) score += 4;
    else if (descHay.includes(w)) score += 2;
  });
  if (score > 0 && book.stock > 0) score += 1;
  return score;
}

function findMatches(books, query, exclude) {
  const queryNorm = normalize(query);
  const queryWords = queryNorm.split(/\s+/).filter(Boolean);
  return books
    .filter(b => !exclude.has(b.slug))
    .map(b => ({ book: b, score: scoreBook(b, queryNorm, queryWords) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(r => r.book);
}

function byCategory(books, catSlug, exclude) {
  return books
    .filter(b => b.cat === catSlug && !exclude.has(b.slug))
    .sort((a, b) => (b.stock > 0) - (a.stock > 0));
}

const STYLE = `
.flea-btn{position:fixed;bottom:96px;right:24px;z-index:9992;width:58px;height:58px;border-radius:50%;background:linear-gradient(135deg,#8A6A35,#B8894B);display:flex;align-items:center;justify-content:center;box-shadow:0 6px 22px rgba(184,134,62,.45);border:none;cursor:pointer;transition:transform .3s,box-shadow .3s;font-size:1.5rem}
.flea-btn:hover{transform:scale(1.08);box-shadow:0 10px 30px rgba(184,134,62,.6)}
.flea-panel{position:fixed;bottom:96px;right:24px;z-index:9993;width:380px;max-width:92vw;height:min(600px,78vh);background:#FEFDFB;border-radius:20px;box-shadow:0 24px 70px rgba(28,22,16,.3);display:flex;flex-direction:column;overflow:hidden;opacity:0;visibility:hidden;transform:translateY(16px) scale(.98);transition:opacity .25s,visibility .25s,transform .25s;font-family:'Inter',sans-serif}
.flea-panel.open{opacity:1;visibility:visible;transform:translateY(0) scale(1)}
.flea-head{background:linear-gradient(135deg,#8A6A35,#B8894B);color:#fff;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.flea-head-title{font-family:'Fraunces',serif;font-weight:600;font-size:1.05rem}
.flea-head-sub{font-size:.72rem;opacity:.85;margin-top:1px}
.flea-close{background:rgba(255,255,255,.2);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:.9rem;display:flex;align-items:center;justify-content:center}
.flea-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;background:#FEFDFB}
.flea-msg{max-width:86%;padding:10px 14px;border-radius:14px;font-size:.85rem;line-height:1.5}
.flea-msg.bot{background:#F3E9D7;color:#2E2820;align-self:flex-start;border-bottom-left-radius:4px}
.flea-msg.user{background:#B8863E;color:#fff;align-self:flex-end;border-bottom-right-radius:4px}
.flea-chips{display:flex;flex-wrap:wrap;gap:8px}
.flea-chip{background:#fff;border:1px solid rgba(184,134,62,.35);color:#2B2216;padding:7px 13px;border-radius:100px;font-size:.78rem;font-weight:600;cursor:pointer;transition:all .2s;font-family:'Inter',sans-serif}
.flea-chip:hover{border-color:#B8863E;color:#B8863E}
.flea-card{background:#fff;border:1px solid rgba(184,134,62,.24);border-radius:14px;padding:12px;display:flex;gap:10px;align-self:stretch}
.flea-card img{width:46px;height:64px;object-fit:cover;border-radius:6px;flex-shrink:0}
.flea-card-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.flea-card-title{font-family:'Fraunces',serif;font-weight:600;font-size:.85rem;color:#2B2216;line-height:1.3}
.flea-card-author{font-size:.72rem;color:#746754}
.flea-card-price{font-family:'Fraunces',serif;font-weight:700;font-size:.9rem;color:#2B2216;margin-top:2px}
.flea-card-actions{display:flex;gap:6px;margin-top:6px}
.flea-card-actions a,.flea-card-actions button{font-size:.7rem;font-weight:700;border-radius:100px;padding:5px 10px;cursor:pointer;font-family:'Inter',sans-serif;text-decoration:none;border:none}
.flea-card-add{background:#B8863E;color:#fff}
.flea-card-detail{background:none;border:1px solid rgba(184,134,62,.35)!important;color:#2B2216}
.flea-foot{padding:12px;border-top:1px solid rgba(184,134,62,.2);display:flex;gap:8px;flex-shrink:0;background:#FEFDFB}
.flea-input{flex:1;background:#F3E9D7;border:1px solid rgba(184,134,62,.24);border-radius:100px;padding:10px 16px;font-size:.85rem;outline:none;font-family:'Inter',sans-serif}
.flea-input:focus{border-color:#B8863E}
.flea-send{background:#B8863E;color:#fff;border:none;width:38px;height:38px;border-radius:50%;cursor:pointer;flex-shrink:0;font-size:1rem}
.flea-badge{position:absolute;top:-2px;right:-2px;background:#a8402a;color:#fff;font-size:.62rem;font-weight:800;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center}
@media(max-width:480px){
  .flea-panel{right:12px;left:12px;width:auto;bottom:88px}
  .flea-btn{right:16px;bottom:88px}
}
`;

let books = null;
let bookIdx = null;
let opened = false;
let lastResults = [];
let lastOffset = 0;
const shown = new Set();

async function ensureBooks() {
  if (books) return books;
  books = await fetchBooks();
  bookIdx = Object.fromEntries(books.map(b => [b.slug, b]));
  return books;
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function scrollToBottom(body) { body.scrollTop = body.scrollHeight; }

function addBotText(body, text) {
  const msg = el('div', 'flea-msg bot', text);
  body.appendChild(msg);
  scrollToBottom(body);
  return msg;
}

function addUserText(body, text) {
  const msg = el('div', 'flea-msg user', escapeHtml(text));
  body.appendChild(msg);
  scrollToBottom(body);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function addChips(body, chips, onPick) {
  const wrap = el('div', 'flea-chips');
  chips.forEach(c => {
    const btn = el('button', 'flea-chip', c.label);
    btn.type = 'button';
    btn.addEventListener('click', () => onPick(c));
    wrap.appendChild(btn);
  });
  body.appendChild(wrap);
  scrollToBottom(body);
  return wrap;
}

function addBookCards(body, list) {
  list.forEach(b => {
    shown.add(b.slug);
    const card = el('div', 'flea-card');
    card.innerHTML = `
      <img src="${b.img}" alt="${escapeHtml(b.title)}">
      <div class="flea-card-info">
        <div class="flea-card-title">${escapeHtml(b.title)}</div>
        <div class="flea-card-author">${escapeHtml(b.author)}</div>
        <div class="flea-card-price">$${b.price}${b.stock <= 0 ? ' · Agotado' : ''}</div>
        <div class="flea-card-actions">
          <a class="flea-card-detail" href="libro.html?slug=${b.slug}">Ver detalle</a>
          ${b.stock > 0 ? `<button type="button" class="flea-card-add" data-slug="${b.slug}">Añadir 🛒</button>` : ''}
        </div>
      </div>`;
    const addBtn = card.querySelector('.flea-card-add');
    if (addBtn) addBtn.addEventListener('click', () => { if (typeof addToCart === 'function') addToCart(b); });
    body.appendChild(card);
  });
  scrollToBottom(body);
}

function renderResultsFollowup(body, hasMore) {
  const chips = [];
  if (hasMore) chips.push({ label: 'Ver más opciones', action: 'more' });
  chips.push({ label: 'Buscar otra cosa', action: 'reset' });
  chips.push({ label: 'Ver catálogo completo', action: 'catalog' });
  addChips(body, chips, c => {
    if (c.action === 'more') showMore(body);
    else if (c.action === 'reset') showIntro(body, true);
    else if (c.action === 'catalog') location.href = 'catalogo.html';
  });
}

function showMore(body) {
  const next = lastResults.slice(lastOffset, lastOffset + 3);
  if (!next.length) {
    addBotText(body, 'Eso es todo lo que tengo para esa búsqueda. ¿Probamos con otra idea?');
    renderResultsFollowup(body, false);
    return;
  }
  lastOffset += next.length;
  addBotText(body, 'Dale, estas también te pueden gustar:');
  addBookCards(body, next);
  renderResultsFollowup(body, lastOffset < lastResults.length);
}

async function handleQuery(body, query) {
  await ensureBooks();
  const results = findMatches(books, query, new Set());
  if (!results.length) {
    addBotText(body, 'No encontré nada que matchee bien con eso 😕. Podés escribirnos directo por WhatsApp y te ayudamos a mano, o probá con otra categoría.');
    const chips = [{ label: 'Escribir por WhatsApp', action: 'wa' }, { label: 'Ver categorías', action: 'reset' }];
    addChips(body, chips, c => {
      if (c.action === 'wa') window.open(`https://wa.me/584145962337?text=${encodeURIComponent('Hola Booksflea 👋 Busco: ' + query)}`, '_blank');
      else showIntro(body, true);
    });
    return;
  }
  lastResults = results;
  lastOffset = Math.min(3, results.length);
  shown.clear();
  addBotText(body, `Encontré ${results.length === 1 ? 'esta opción' : 'estas opciones'} para vos:`);
  addBookCards(body, results.slice(0, 3));
  renderResultsFollowup(body, lastOffset < lastResults.length);
}

async function handleCategory(body, cat) {
  await ensureBooks();
  const results = byCategory(books, cat.slug, new Set());
  if (!results.length) {
    addBotText(body, `Por ahora no tengo títulos de ${cat.label.toLowerCase()} disponibles.`);
    renderResultsFollowup(body, false);
    return;
  }
  lastResults = results;
  lastOffset = Math.min(3, results.length);
  shown.clear();
  addBotText(body, `${cat.icon} Estos son los de ${cat.label.toLowerCase()} que tenemos:`);
  addBookCards(body, results.slice(0, 3));
  renderResultsFollowup(body, lastOffset < lastResults.length);
}

function showIntro(body, isReset) {
  if (isReset) body.innerHTML = '';
  addBotText(body, isReset
    ? '¡Dale! Contame qué tenés ganas de leer, o elegí una categoría:'
    : 'Hola, soy Flea 📖 tu asistente para encontrar tu próximo libro favorito. Contame qué te gustaría leer (un género, un ánimo, hasta "algo como tal libro") o elegí una categoría:');
  addChips(body, CATS.map(c => ({ label: `${c.icon} ${c.label}`, cat: c })), c => {
    addUserText(body, c.label);
    handleCategory(body, c.cat);
  });
}

function buildPanel() {
  const panel = el('div', 'flea-panel');
  panel.id = 'fleaPanel';
  panel.innerHTML = `
    <div class="flea-head">
      <div>
        <div class="flea-head-title">Flea 📖</div>
        <div class="flea-head-sub">Tu asistente para encontrar libros</div>
      </div>
      <button type="button" class="flea-close" id="fleaClose" aria-label="Cerrar">✕</button>
    </div>
    <div class="flea-body" id="fleaBody"></div>
    <form class="flea-foot" id="fleaForm">
      <input type="text" class="flea-input" id="fleaInput" placeholder="Ej: fantasía con romance..." autocomplete="off">
      <button type="submit" class="flea-send" aria-label="Enviar">➤</button>
    </form>`;
  document.body.appendChild(panel);

  const body = panel.querySelector('#fleaBody');
  panel.querySelector('#fleaClose').addEventListener('click', closePanel);
  panel.querySelector('#fleaForm').addEventListener('submit', e => {
    e.preventDefault();
    const input = panel.querySelector('#fleaInput');
    const val = input.value.trim();
    if (!val) return;
    addUserText(body, val);
    input.value = '';
    handleQuery(body, val);
  });

  showIntro(body, false);
  return panel;
}

let panelEl = null;
function openPanel() {
  if (!panelEl) panelEl = buildPanel();
  panelEl.classList.add('open');
  opened = true;
}
function closePanel() {
  if (panelEl) panelEl.classList.remove('open');
}

function init() {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const btn = el('button', 'flea-btn', '📚');
  btn.type = 'button';
  btn.id = 'fleaBtn';
  btn.setAttribute('aria-label', 'Asistente de libros');
  btn.addEventListener('click', () => {
    if (panelEl && panelEl.classList.contains('open')) closePanel();
    else openPanel();
  });
  document.body.appendChild(btn);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
