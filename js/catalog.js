/**
 * catalog.js — Catalog page controller.
 * Reads URL params for initial filter, drives filter UI, search, sort, grid.
 */

import { filterProducts, getProducts } from './modules/productLoader.js';
import { initUI, toast, productCardMarkup, attachCardHandlers } from './modules/ui.js';

const state = {
  categories: [],
  genders: [],
  brands: [],
  search: '',
  sort: ''
};

function readUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const cat = params.get('category');
  const gender = params.get('gender');
  const q = params.get('q');
  if (cat) {
    state.categories = [cat];
    const cb = document.querySelector(`input[name="category"][value="${cat}"]`);
    if (cb) cb.checked = true;
  }
  if (gender) {
    state.genders = [gender];
    const cb = document.querySelector(`input[name="gender"][value="${gender}"]`);
    if (cb) cb.checked = true;
  }
  if (q) {
    state.search = q;
    document.getElementById('searchInput').value = q;
  }
}

async function render() {
  const grid = document.getElementById('productGrid');
  const empty = document.getElementById('emptyState');
  const count = document.getElementById('resultCount');
  grid.innerHTML = '';
  empty.classList.add('hidden');

  let products;
  try {
    products = await filterProducts({
      categories: state.categories,
      genders: state.genders,
      search: state.search,
      sort: state.sort
    });
    // Brand filter applied locally (brands derived from full list)
    if (state.brands.length) {
      products = products.filter(p => state.brands.includes(p.brand));
    }
  } catch (err) {
    console.error(err);
    toast('Could not load products.', 'error');
    return;
  }

  count.textContent = `${products.length} frame${products.length === 1 ? '' : 's'} found`;

  if (products.length === 0) {
    empty.classList.remove('hidden');
    return;
  }

  grid.innerHTML = products.map(p => productCardMarkup(p, 'Try On')).join('');
  attachCardHandlers(grid, (id) => {
    window.location.href = `tryon.html?id=${id}`;
  });
}

async function buildBrandFilters() {
  const products = await getProducts();
  const brands = [...new Set(products.map(p => p.brand))].sort();
  const wrap = document.getElementById('brandFilters');
  wrap.innerHTML = brands.map(b => `
    <label class="filter-option"><input type="checkbox" name="brand" value="${b}" /> ${b}</label>
  `).join('');
  wrap.querySelectorAll('input[name="brand"]').forEach(cb => {
    cb.addEventListener('change', () => {
      state.brands = Array.from(document.querySelectorAll('input[name="brand"]:checked')).map(i => i.value);
      render();
    });
  });
}

function wireEvents() {
  // Categories
  document.querySelectorAll('input[name="category"]').forEach(cb => {
    cb.addEventListener('change', () => {
      state.categories = Array.from(document.querySelectorAll('input[name="category"]:checked')).map(i => i.value);
      render();
    });
  });
  // Genders
  document.querySelectorAll('input[name="gender"]').forEach(cb => {
    cb.addEventListener('change', () => {
      state.genders = Array.from(document.querySelectorAll('input[name="gender"]:checked')).map(i => i.value);
      render();
    });
  });

  // Search (debounced)
  let t;
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.search = e.target.value;
      render();
    }, 220);
  });

  // Sort
  document.getElementById('sortSelect').addEventListener('change', (e) => {
    state.sort = e.target.value;
    render();
  });

  // Clear filters
  const clearAll = () => {
    state.categories = [];
    state.genders = [];
    state.brands = [];
    state.search = '';
    state.sort = '';
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.getElementById('searchInput').value = '';
    document.getElementById('sortSelect').value = '';
    render();
  };
  document.getElementById('clearFilters').addEventListener('click', clearAll);
  document.getElementById('emptyClear').addEventListener('click', clearAll);

  // Mobile filters toggle
  document.getElementById('filtersToggle').addEventListener('click', () => {
    document.getElementById('filtersPanel').classList.toggle('open');
  });
}

async function boot() {
  initUI();
  readUrlParams();
  await buildBrandFilters();
  wireEvents();
  await render();
}

boot();
