/**
 * home.js — Home page controller.
 * Loads products, renders featured sections + categories, wires up card clicks.
 */

import { getProducts, getCategories } from './modules/productLoader.js';
import { initUI, toast, productCardMarkup, attachCardHandlers } from './modules/ui.js';

async function renderHome() {
  initUI();
  try {
    const [products, categories] = await Promise.all([getProducts(), getCategories()]);

    // Featured sunglasses (top 4 by rating)
    const sunglasses = products
      .filter(p => p.category === 'sunglasses')
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 4);
    const featuredSG = document.getElementById('featuredSunglasses');
    if (featuredSG) {
      featuredSG.innerHTML = sunglasses.map(p => productCardMarkup(p)).join('');
    }

    // Featured prescription (top 4 by rating)
    const prescription = products
      .filter(p => p.category === 'prescription')
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 4);
    const featuredRX = document.getElementById('featuredPrescription');
    if (featuredRX) {
      featuredRX.innerHTML = prescription.map(p => productCardMarkup(p)).join('');
    }

    attachCardHandlers(featuredSG);
    attachCardHandlers(featuredRX);

    // Categories
    const catGrid = document.getElementById('categoriesGrid');
    if (catGrid) {
      catGrid.innerHTML = categories.map(c => `
        <a class="category" href="catalog.html?category=${c.id}">
          <div class="category__icon">
            ${c.icon === 'sun' ? sunIcon() : eyeIcon()}
          </div>
          <h3 class="category__title">${c.name}</h3>
          <p class="category__desc">${c.description}</p>
          <span class="category__link">
            Explore collection
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
          </span>
        </a>
      `).join('');
    }
  } catch (err) {
    console.error('Home render error:', err);
    toast('Could not load products. Check your connection and refresh.', 'error', 4000);
  }
}

function sunIcon() {
  return `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#b8893f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`;
}
function eyeIcon() {
  return `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#b8893f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
}

renderHome();
