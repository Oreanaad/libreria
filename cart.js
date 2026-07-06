/* Shared cart logic — used by index.html and catalogo.html.
   Persists in localStorage so it survives navigation between pages. */
const CART_KEY = 'bf-cart';
const CART_WA_NUMBER = '584145962337';

function getCart(){
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
  catch(e){ return []; }
}

function saveCart(cart){
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartUI();
}

function addToCart(book){
  const cart = getCart();
  const existing = cart.find(i => i.title === book.title);
  if (existing) existing.qty += 1;
  else cart.push({ title: book.title, author: book.author, price: book.price, img: book.img, url: book.url, qty: 1 });
  saveCart(cart);
  openCart();
}

function removeFromCart(title){
  saveCart(getCart().filter(i => i.title !== title));
}

function changeQty(title, delta){
  const cart = getCart();
  const item = cart.find(i => i.title === title);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) return saveCart(cart.filter(i => i.title !== title));
  saveCart(cart);
}

function cartTotal(cart){ return cart.reduce((s,i) => s + i.price * i.qty, 0); }
function cartCount(cart){ return cart.reduce((s,i) => s + i.qty, 0); }

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function updateCartUI(){
  const cart = getCart();

  const badge = document.getElementById('cartBadge');
  if (badge) {
    const count = cartCount(cart);
    badge.textContent = count;
    badge.style.display = count ? 'flex' : 'none';
  }

  const itemsEl = document.getElementById('cartItems');
  if (!itemsEl) return;

  if (cart.length === 0) {
    itemsEl.innerHTML = `<div class="cart-empty"><span>🛒</span>Tu carrito está vacío.<br>Agregá libros desde el catálogo.</div>`;
  } else {
    itemsEl.innerHTML = cart.map(i => `
      <div class="cart-item">
        <img src="${i.img}" alt="${escapeHtml(i.title)}">
        <div class="cart-item-info">
          <div class="cart-item-title">${escapeHtml(i.title)}</div>
          <div class="cart-item-author">${escapeHtml(i.author)}</div>
          <div class="cart-item-qty">
            <button data-qty="-1" data-title="${escapeHtml(i.title)}" aria-label="Restar">−</button>
            <span>${i.qty}</span>
            <button data-qty="1" data-title="${escapeHtml(i.title)}" aria-label="Sumar">+</button>
          </div>
        </div>
        <div class="cart-item-right">
          <div class="cart-item-price">$${i.price * i.qty}</div>
          <button class="cart-item-remove" data-remove="${escapeHtml(i.title)}">Quitar</button>
        </div>
      </div>`).join('');

    itemsEl.querySelectorAll('[data-qty]').forEach(btn => {
      btn.addEventListener('click', () => changeQty(btn.dataset.title, Number(btn.dataset.qty)));
    });
    itemsEl.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => removeFromCart(btn.dataset.remove));
    });
  }

  const subtotalEl = document.getElementById('cartSubtotal');
  if (subtotalEl) subtotalEl.textContent = `$${cartTotal(cart)}`;

  const checkoutBtn = document.getElementById('cartCheckout');
  if (checkoutBtn) {
    if (cart.length === 0) {
      checkoutBtn.classList.add('disabled');
      checkoutBtn.removeAttribute('href');
    } else {
      checkoutBtn.classList.remove('disabled');
      const lines = cart.map((i, idx) => `${idx + 1}. *${i.title}*${i.qty > 1 ? ` (x${i.qty})` : ''} — $${i.price * i.qty}`).join('\n');
      const text = `Hola Booksflea 👋 Quiero comprar:\n\n${lines}\n\nTotal: $${cartTotal(cart)}\n\n¡Gracias!`;
      checkoutBtn.href = `https://wa.me/${CART_WA_NUMBER}?text=${encodeURIComponent(text)}`;
    }
  }
}

function openCart(){
  const drawer = document.getElementById('cartDrawer');
  const overlay = document.getElementById('cartOverlay');
  if (!drawer) return;
  drawer.classList.add('open');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCart(){
  const drawer = document.getElementById('cartDrawer');
  const overlay = document.getElementById('cartOverlay');
  if (!drawer) return;
  drawer.classList.remove('open');
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('DOMContentLoaded', () => {
  updateCartUI();
  const cartBtn = document.getElementById('cartBtn');
  const cartClose = document.getElementById('cartClose');
  const cartOverlay = document.getElementById('cartOverlay');
  if (cartBtn) cartBtn.addEventListener('click', openCart);
  if (cartClose) cartClose.addEventListener('click', closeCart);
  if (cartOverlay) cartOverlay.addEventListener('click', closeCart);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCart(); });
});

// keep the badge in sync if the cart is changed from another tab/page
window.addEventListener('storage', e => { if (e.key === CART_KEY) updateCartUI(); });
