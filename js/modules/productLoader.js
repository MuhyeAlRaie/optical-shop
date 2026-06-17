/**
 * productLoader.js
 * Loads /assets/products.json once, caches the result, and exposes
 * filtering / search helpers. Uses ES6 module syntax.
 */

const PRODUCTS_URL = 'assets/products.json';

let _cache = null;
let _cachePromise = null;

export async function loadProducts(force = false) {
  if (_cache && !force) return _cache;
  if (_cachePromise && !force) return _cachePromise;
  _cachePromise = fetch(PRODUCTS_URL, { cache: 'no-cache' })
    .then(r => {
      if (!r.ok) throw new Error(`Failed to load products.json (HTTP ${r.status})`);
      return r.json();
    })
    .then(data => {
      _cache = data;
      return data;
    })
    .catch(err => {
      _cachePromise = null;
      throw err;
    });
  return _cachePromise;
}

export async function getProducts() {
  const data = await loadProducts();
  return data.products;
}

export async function getCategories() {
  const data = await loadProducts();
  return data.categories;
}

export async function getProductById(id) {
  const products = await getProducts();
  return products.find(p => p.id === id) || null;
}

/**
 * Filter products by category, gender and search string.
 * @param {Object} opts
 * @param {string[]} [opts.categories]  e.g. ['sunglasses', 'prescription']
 * @param {string[]} [opts.genders]     e.g. ['men', 'women', 'unisex']
 * @param {string}   [opts.search]
 * @param {string}   [opts.sort]        'price-asc' | 'price-desc' | 'rating' | 'name'
 */
export async function filterProducts(opts = {}) {
  let products = await getProducts();

  if (opts.categories && opts.categories.length) {
    products = products.filter(p => opts.categories.includes(p.category));
  }
  if (opts.genders && opts.genders.length) {
    products = products.filter(p => opts.genders.includes(p.gender));
  }
  if (opts.search && opts.search.trim()) {
    const q = opts.search.trim().toLowerCase();
    products = products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.brand.toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }

  switch (opts.sort) {
    case 'price-asc':  products = [...products].sort((a, b) => a.price - b.price); break;
    case 'price-desc': products = [...products].sort((a, b) => b.price - a.price); break;
    case 'rating':     products = [...products].sort((a, b) => (b.rating || 0) - (a.rating || 0)); break;
    case 'name':       products = [...products].sort((a, b) => a.name.localeCompare(b.name)); break;
  }

  return products;
}

export function formatPrice(price, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(price);
  } catch (e) {
    return `$${price.toFixed(2)}`;
  }
}

export function ratingStars(rating) {
  const full = Math.round(rating);
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}
