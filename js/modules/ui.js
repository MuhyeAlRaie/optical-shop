/**
 * ui.js — shared UI helpers: toast, modal, nav toggle, formatting.
 */

let toastEl = null;
let toastTimer = null;

export function initUI() {
  // Build toast container lazily
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
  }

  // Wire up mobile nav toggle (present on every page)
  const toggle = document.querySelector('.nav__toggle');
  const links = document.querySelector('.nav__links');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      links.classList.toggle('open');
      const expanded = links.classList.contains('open');
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
  }

  // Mark active nav link
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav__links a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === path) a.classList.add('active');
  });
}

export function toast(message, type = 'default', duration = 2600) {
  if (!toastEl) initUI();
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.className = 'toast show';
  if (type === 'error')   toastEl.classList.add('toast--error');
  if (type === 'success') toastEl.classList.add('toast--success');
  toastTimer = setTimeout(() => { toastEl.classList.remove('show'); }, duration);
}

/**
 * Render a single product card markup.
 * @param {Object} p product
 * @param {string} [ctaLabel='Try On']  primary button label
 */
export function productCardMarkup(p, ctaLabel = 'Try On') {
  const price = `$${p.price.toFixed(2)}`;
  const badge = p.category === 'sunglasses'
    ? '<span class="card__badge card__badge--accent">Sunglasses</span>'
    : '<span class="card__badge">Prescription</span>';
  const stars = '★'.repeat(Math.round(p.rating || 0)) + '☆'.repeat(5 - Math.round(p.rating || 0));

  return `
    <article class="card" data-product-id="${p.id}">
      <div class="card__media">
        ${badge}
        <img src="${p.thumbnail}" alt="${p.name}" loading="lazy" />
      </div>
      <div class="card__body">
        <span class="card__brand">${p.brand}</span>
        <h3 class="card__title">${p.name}</h3>
        <p class="card__desc">${p.description.length > 90 ? p.description.slice(0, 88) + '…' : p.description}</p>
        <div class="rating">${stars} <small>${(p.rating || 0).toFixed(1)}</small></div>
        <div class="card__footer">
          <span class="card__price">${price}</span>
          <div style="display:flex; gap:6px;">
            <a class="btn btn--ghost btn--sm" href="tryon.html?id=${p.id}">${ctaLabel}</a>
          </div>
        </div>
      </div>
    </article>
  `;
}

export function attachCardHandlers(container, onTryOn) {
  if (!container) return;
  container.querySelectorAll('.card').forEach(card => {
    const id = card.dataset.productId;
    const btn = card.querySelector('.btn');
    if (btn) btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (onTryOn) onTryOn(id);
      else window.location.href = `tryon.html?id=${id}`;
    });
    // Click whole card (but not buttons) opens try-on
    card.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      if (onTryOn) onTryOn(id);
      else window.location.href = `tryon.html?id=${id}`;
    });
  });
}

/**
 * Lightweight modal helper.
 * Usage: openModal('<h2>Hello</h2>'); closeModal();
 */
let modalEl = null;
export function openModal(htmlContent) {
  if (!modalEl) {
    modalEl = document.createElement('div');
    modalEl.className = 'modal';
    modalEl.innerHTML = `
      <div class="modal__body">
        <button class="modal__close" aria-label="Close">&times;</button>
        <div class="modal__content"></div>
      </div>`;
    document.body.appendChild(modalEl);
    modalEl.querySelector('.modal__close').addEventListener('click', closeModal);
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  }
  modalEl.querySelector('.modal__content').innerHTML = htmlContent;
  modalEl.classList.add('show');
  document.body.style.overflow = 'hidden';
  return modalEl;
}
export function closeModal() {
  if (!modalEl) return;
  modalEl.classList.remove('show');
  document.body.style.overflow = '';
}
