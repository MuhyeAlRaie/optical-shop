/**
 * tryon.js — orchestrates the Virtual Try-On page.
 *
 * Wires together:
 *   - productLoader (load product from URL ?id=…)
 *   - scene.js      (A-Frame mount + glasses rig)
 *   - camera.js     (live camera / uploaded photo)
 *   - mediapipe.js  (face landmark tracking → pose)
 *   - screenshot.js (compose + PNG download)
 *   - ui.js         (toasts, nav)
 */

import { getProducts, getProductById, formatPrice, ratingStars } from './modules/productLoader.js';
import { initUI, toast, openModal, closeModal } from './modules/ui.js';
import { CameraManager } from './modules/camera.js';
import { MediaPipeFaceTracker } from './modules/mediapipe.js';
import { TryOnScene } from './modules/scene.js';
import { ScreenshotManager } from './modules/screenshot.js';

// ----- State -----
const state = {
  products: [],
  currentIndex: 0,
  scene: null,
  camera: new CameraManager(),
  tracker: new MediaPipeFaceTracker(),
  screenshot: null,
  userOffset: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 },
  fps: 0,
  fpsCounter: 0,
  fpsLastTs: performance.now()
};

// ----- DOM refs -----
const els = {
  stage:        document.getElementById('tryonStage'),
  video:        document.getElementById('videoFeed'),
  photoOverlay: document.getElementById('photoOverlay'),
  placeholder:  document.getElementById('stagePlaceholder'),
  fileInput:    document.getElementById('fileInput'),
  trackingChip: document.getElementById('trackingChip'),
  fpsChip:      document.getElementById('fpsChip'),
  fpsLabel:     document.getElementById('fpsLabel'),
  stageStatus:  document.getElementById('stageStatus'),
  stageStatusText: document.getElementById('stageStatusText'),
  modelStatus:  document.getElementById('modelStatus'),
  // current product
  currentImg:   document.getElementById('currentImg'),
  currentName:  document.getElementById('currentName'),
  currentMeta:  document.getElementById('currentMeta'),
  // model list
  modelList:    document.getElementById('modelList'),
  // controls
  btnPrev:      document.getElementById('btnPrevFrame'),
  btnNext:      document.getElementById('btnNextFrame'),
  btnZoomIn:    document.getElementById('btnZoomIn'),
  btnZoomOut:   document.getElementById('btnZoomOut'),
  btnRotL:      document.getElementById('btnRotateLeft'),
  btnRotR:      document.getElementById('btnRotateRight'),
  btnRaise:     document.getElementById('btnRaise'),
  btnLower:     document.getElementById('btnLower'),
  btnReset:     document.getElementById('btnReset'),
  // camera
  btnOpenCam:   document.getElementById('btnOpenCam'),
  btnCloseCam:  document.getElementById('btnCloseCam'),
  btnSwitchCam: document.getElementById('btnSwitchCam'),
  btnUpload:    document.getElementById('btnUpload'),
  btnCapture:   document.getElementById('btnCapture'),
  btnSave:      document.getElementById('btnSave'),
  quickStartCam: document.getElementById('quickStartCam'),
  quickUpload:   document.getElementById('quickUpload')
};

// =================================================================
//  Boot
// =================================================================

async function boot() {
  initUI();
  setStatus('Booting…');

  // 1) Load products
  try {
    state.products = await getProducts();
  } catch (err) {
    console.error(err);
    toast('Failed to load product catalog.', 'error', 5000);
    return;
  }

  // Pre-populate model list thumbnails
  renderModelList();

  // 2) Determine initial product from URL ?id=…
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  let initial = state.products[0];
  if (id) {
    const found = state.products.find(p => p.id === id);
    if (found) {
      initial = found;
      state.currentIndex = state.products.indexOf(found);
    }
  }

  // 3) Mount A-Frame scene
  try {
    state.scene = new TryOnScene(els.stage);
    await state.scene.mount();
  } catch (err) {
    console.error('Scene mount error:', err);
    toast('Could not initialise 3D renderer.', 'error', 5000);
    return;
  }

  // 4) Wire camera + tracker
  state.camera.attachVideo(els.video);
  state.screenshot = new ScreenshotManager({
    camera: state.camera,
    scene: state.scene,
    mirror: true
  });

  // Tracker events
  state.tracker.on('status', (s) => {
    const map = {
      'loading-wasm':  'Loading MediaPipe WASM…',
      'loading-model': 'Loading face model…',
      'ready':         'Tracker ready'
    };
    if (s.stage === 'ready') {
      setStatus('Face tracker ready', '#2f7d5b');
    } else {
      setStatus(map[s.stage] || s.stage);
    }
  });
  state.tracker.on('pose', (pose) => {
    state.scene.updatePose(pose);
    setTracking(true);
    bumpFps();
  });
  state.tracker.on('lost', () => {
    setTracking(false);
  });
  state.tracker.on('error', (e) => {
    console.error('Tracker error:', e);
  });

  // 5) Apply initial product
  await selectProduct(initial);

  // 6) Wire all controls
  wireControls();

  setStatus('Idle — open camera or upload a photo');
}

// =================================================================
//  Product management
// =================================================================

function renderModelList() {
  els.modelList.innerHTML = state.products.map((p, i) => `
    <div class="tryon__model-item ${i === state.currentIndex ? 'active' : ''}" data-idx="${i}" title="${p.name}">
      <img src="${p.thumbnail}" alt="${p.name}" loading="lazy" />
    </div>
  `).join('');
  els.modelList.querySelectorAll('.tryon__model-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx, 10);
      if (!isNaN(idx)) selectProduct(state.products[idx]);
    });
  });
}

async function selectProduct(product) {
  const idx = state.products.indexOf(product);
  if (idx >= 0) state.currentIndex = idx;

  els.currentImg.src = product.thumbnail;
  els.currentImg.alt = product.name;
  els.currentName.textContent = product.name;
  els.currentMeta.textContent = `${product.brand} · ${formatPrice(product.price, product.currency)}`;

  // Highlight in model list
  els.modelList.querySelectorAll('.tryon__model-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.idx, 10) === state.currentIndex);
  });

  // Push to A-Frame scene
  try {
    await state.scene.setProduct(product);
  } catch (err) {
    console.error(err);
    toast('Could not load 3D model for this frame.', 'error');
  }
}

function nextProduct(delta) {
  const n = state.products.length;
  if (!n) return;
  state.currentIndex = (state.currentIndex + delta + n) % n;
  selectProduct(state.products[state.currentIndex]);
}

// =================================================================
//  Camera & photo
// =================================================================

async function startCamera() {
  try {
    setStatus('Requesting camera…');
    els.placeholder.classList.add('hidden');
    els.photoOverlay.classList.add('hidden');
    await state.camera.startCamera('user');
    state.scene.setMirrored(true);
    state.screenshot.mirror = true;
    els.video.style.display = '';
    setStatus('Camera live', '#2f7d5b');
    toast('Camera live', 'success', 1600);
    await startTracking();
  } catch (err) {
    console.error(err);
    setStatus('Camera error', '#c0392b');
    let msg = 'Could not access camera.';
    if (err && err.name === 'NotAllowedError') msg = 'Camera permission denied.';
    else if (err && err.name === 'NotFoundError') msg = 'No camera found on this device.';
    toast(msg, 'error', 4000);
    els.placeholder.classList.remove('hidden');
  }
}

function stopCamera() {
  state.camera.stopCamera();
  state.tracker.stop();
  els.video.style.display = 'none';
  els.photoOverlay.classList.add('hidden');
  els.placeholder.classList.remove('hidden');
  setTracking(false);
  els.fpsChip.style.visibility = 'hidden';
  setStatus('Camera closed');
  toast('Camera closed', 'default', 1400);
}

async function switchCamera() {
  try {
    if (!state.camera.isActive() || state.camera.getMode() !== 'camera') {
      toast('Camera is not active.', 'default', 1800);
      return;
    }
    await state.camera.switchCamera();
    toast(`Switched to ${state.camera.facingMode === 'user' ? 'front' : 'rear'} camera`, 'default', 1600);
  } catch (err) {
    console.error(err);
    toast('Could not switch camera.', 'error');
  }
}

function triggerUpload() {
  els.fileInput.click();
}

async function handleFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    setStatus('Loading photo…');
    els.placeholder.classList.add('hidden');
    els.video.style.display = 'none';
    await state.camera.loadPhoto(file);
    // Show photo overlay
    els.photoOverlay.src = URL.createObjectURL(file);
    els.photoOverlay.classList.remove('hidden');
    state.scene.setMirrored(false);
    state.screenshot.mirror = false;
    setStatus('Photo loaded', '#2f7d5b');
    toast('Photo loaded', 'success', 1600);
    await startTracking();
  } catch (err) {
    console.error(err);
    setStatus('Photo error', '#c0392b');
    toast('Could not load this image.', 'error');
    els.placeholder.classList.remove('hidden');
  } finally {
    els.fileInput.value = '';
  }
}

async function startTracking() {
  try {
    await state.tracker.start(() => state.camera.captureFrame());
    setStatus(state.camera.getMode() === 'camera' ? 'Tracking active' : 'Analysing photo', '#2f7d5b');
  } catch (err) {
    console.error(err);
    setStatus('Tracker init failed', '#c0392b');
    toast('Could not start face tracker. Check your connection and try again.', 'error', 5000);
  }
}

// =================================================================
//  Manual controls
// =================================================================

function offset(delta) {
  Object.assign(state.userOffset, delta);
  state.scene.setUserOffset(state.userOffset);
}

function resetOffset() {
  state.userOffset = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 };
  state.scene.resetOffset();
  toast('Position reset', 'default', 1200);
}

// =================================================================
//  Screenshot
// =================================================================

async function captureStill() {
  if (!state.camera.isActive()) {
    toast('Open camera or upload a photo first.', 'default', 2200);
    return;
  }
  try {
    const canvas = await state.screenshot.captureStill();
    // Show preview modal
    const dataUrl = canvas.toDataURL('image/png');
    showCapturePreview(dataUrl);
  } catch (err) {
    console.error(err);
    toast('Capture failed.', 'error');
  }
}

async function saveImage() {
  if (!state.camera.isActive()) {
    toast('Open camera or upload a photo first.', 'default', 2200);
    return;
  }
  try {
    setStatus('Saving…');
    const r = await state.screenshot.captureAndDownload(`lumea-tryon-${Date.now()}.png`);
    setStatus('Saved', '#2f7d5b');
    toast(`Saved ${r.name}`, 'success', 2200);
  } catch (err) {
    console.error(err);
    setStatus('Save failed', '#c0392b');
    toast('Could not save image.', 'error');
  }
}

function showCapturePreview(dataUrl) {
  const html = `
    <div style="text-align:center;">
      <h3 style="margin-top:0;">Capture preview</h3>
      <img src="${dataUrl}" alt="Try-on capture" style="max-width:100%; border-radius:8px; box-shadow: 0 8px 24px rgba(0,0,0,0.18);" />
      <p style="color:var(--color-muted); margin-top:12px; font-size:0.88rem;">Looks good? Download as PNG.</p>
      <div style="display:flex; gap:8px; justify-content:center; margin-top:16px;">
        <a class="btn btn--primary" href="${dataUrl}" download="lumea-tryon-${Date.now()}.png">Download PNG</a>
        <button class="btn btn--ghost" id="closePreview">Close</button>
      </div>
    </div>
  `;
  openModal(html);
  document.getElementById('closePreview').addEventListener('click', closeModal);
}

// =================================================================
//  UI helpers
// =================================================================

function setStatus(text, color) {
  if (els.modelStatus) {
    els.modelStatus.textContent = text;
    els.modelStatus.style.background = color || '#1a1a1a';
    els.modelStatus.style.color = '#fff';
    els.modelStatus.style.opacity = '1';
  }
}

function setTracking(active) {
  const dot = els.trackingChip.querySelector('.dot');
  const label = els.trackingChip.querySelector('span:last-child');
  if (active) {
    dot.classList.remove('dot--off');
    label.textContent = 'Tracking: live';
    els.fpsChip.style.visibility = '';
    els.stageStatus.style.display = '';
    els.stageStatusText.textContent = 'Face detected';
  } else {
    dot.classList.add('dot--off');
    label.textContent = 'Tracking: searching…';
    els.fpsChip.style.visibility = 'hidden';
    els.stageStatusText.textContent = 'Searching for face…';
  }
}

function bumpFps() {
  state.fpsCounter++;
  const now = performance.now();
  if (now - state.fpsLastTs >= 1000) {
    state.fps = state.fpsCounter;
    state.fpsCounter = 0;
    state.fpsLastTs = now;
    els.fpsLabel.textContent = `${state.fps} FPS`;
  }
}

// =================================================================
//  Wire controls
// =================================================================

function wireControls() {
  els.btnPrev.addEventListener('click', () => nextProduct(-1));
  els.btnNext.addEventListener('click', () => nextProduct(+1));

  els.btnZoomIn.addEventListener('click', () => offset({ scale: state.userOffset.scale * 1.08 }));
  els.btnZoomOut.addEventListener('click', () => offset({ scale: state.userOffset.scale / 1.08 }));

  els.btnRotL.addEventListener('click', () => offset({ rz: state.userOffset.rz - 5 }));
  els.btnRotR.addEventListener('click', () => offset({ rz: state.userOffset.rz + 5 }));

  els.btnRaise.addEventListener('click', () => offset({ y: state.userOffset.y + 0.01 }));
  els.btnLower.addEventListener('click', () => offset({ y: state.userOffset.y - 0.01 }));

  els.btnReset.addEventListener('click', resetOffset);

  els.btnOpenCam.addEventListener('click', startCamera);
  els.btnCloseCam.addEventListener('click', stopCamera);
  els.btnSwitchCam.addEventListener('click', switchCamera);
  els.btnUpload.addEventListener('click', triggerUpload);
  els.btnCapture.addEventListener('click', captureStill);
  els.btnSave.addEventListener('click', saveImage);

  els.quickStartCam.addEventListener('click', startCamera);
  els.quickUpload.addEventListener('click', triggerUpload);

  els.fileInput.addEventListener('change', handleFile);

  // Keyboard shortcuts (desktop)
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.key) {
      case 'ArrowLeft':  nextProduct(-1); break;
      case 'ArrowRight': nextProduct(+1); break;
      case '+': case '=': offset({ scale: state.userOffset.scale * 1.08 }); break;
      case '-': offset({ scale: state.userOffset.scale / 1.08 }); break;
      case 'r': case 'R': resetOffset(); break;
    }
  });
}

// Start the app
boot();
