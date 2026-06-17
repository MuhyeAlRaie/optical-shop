/**
 * scene.js — manages the embedded A-Frame scene for virtual try-on.
 *
 * Responsibilities:
 *  - Build / boot the A-Frame scene with proper lighting & transparent background.
 *  - Procedurally build (or load GLB) glasses models based on the product spec.
 *  - Cache model templates so we never rebuild the same glasses twice.
 *  - Smoothly position / rotate / scale the glasses from MediaPipe head pose.
 *  - Apply manual user offsets (zoom, rotate, raise/lower, prev/next frame).
 *  - Toggle mirroring for live-camera vs. uploaded photo.
 */

/* global AFRAME, THREE */

// ----- A-Frame components must be registered before <a-scene> boots -----
// We register them at module-eval time so that simply importing this script
// is enough; tryon.html imports it before creating the scene.

AFRAME.registerComponent('glasses-rig', {
  schema: {
    // empty for now; pose is updated imperatively via .systems
  },
  init() {
    this.glassesRoot = null;          // group containing current glasses
    this.pose = null;
    this.targetPose = null;
    this.userOffset = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 };
    this.smoothPose = null;           // smoothed pose state
    this.lastTime = performance.now();
    this.bindMethods();
  },
  bindMethods() {
    this.tick = this.tick.bind(this);
  },
  setGlasses(root) {
    if (this.glassesRoot && this.glassesRoot.parentEl) {
      this.glassesRoot.parentEl.removeChild(this.glassesRoot);
    }
    this.glassesRoot = root;
    this.el.appendChild(root);
  },
  setPose(pose) {
    this.targetPose = pose;
    if (!this.smoothPose) this.smoothPose = { ...pose };
  },
  setUserOffset(offset) {
    this.userOffset = { ...this.userOffset, ...offset };
  },
  resetOffset() {
    this.userOffset = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 };
  },
  tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    if (!this.glassesRoot) return;

    // Smoothly approach target pose (exponential smoothing — frame-rate independent)
    if (this.targetPose) {
      const k = 1 - Math.exp(-12 * dt); // ~80ms time constant
      const t = this.targetPose;
      const s = this.smoothPose;
      s.eyeMid     = lerp3(s.eyeMid,     t.eyeMid,     k);
      s.scale      = lerp(s.scale,       t.scale,      k);
      s.roll       = lerp(s.roll,        t.roll,       k);
      s.pitch      = lerp(s.pitch,       t.pitch,      k);
      s.yaw        = lerp(s.yaw,         t.yaw,        k);
      s.frame      = t.frame;
    } else if (this.smoothPose) {
      // decay slowly when face is lost so glasses don't snap
    }
    if (!this.smoothPose) return;

    const pose = this.smoothPose;
    const frame = pose.frame;
    if (!frame) return;

    // ----- Convert pixel-space eye midpoint to A-Frame world coords -----
    // The camera is at origin looking toward -Z. We position glasses at z = -DISTANCE.
    const DISTANCE = 1.0; // 1 metre
    const aspect = frame.width / frame.height;
    const fovDeg = 50;
    const fovRad = fovDeg * Math.PI / 180;
    const halfH = Math.tan(fovRad / 2) * DISTANCE;
    const halfW = halfH * aspect;

    // Normalize eye midpoint: (0..1, 0..1) -> (-1..1, -1..1) where y flipped
    const nx = pose.eyeMid.x / frame.width;
    const ny = pose.eyeMid.y / frame.height;
    const ndcX = (nx * 2 - 1);
    const ndcY = (1 - ny * 2);

    // The glasses should follow the eye midpoint (between the eyes), with the
    // bridge centred on the nose. We offset slightly downward from eye-mid.
    let worldX = ndcX * halfW;
    let worldY = ndcY * halfH;
    let worldZ = -DISTANCE;

    // ----- Scale: convert pixel eye-distance to world units -----
    // Reference: average adult interpupillary distance ~63mm = 0.063 world units.
    // We treat pose.scale (px) as the eye-distance; map px → 0.063 * (px / refPx)
    // refPx ~ 25% of frame width is a normal close-up face.
    const refEyeDistancePx = frame.width * 0.18;
    const baseWorldScale = 0.063 * (pose.scale / refEyeDistancePx);

    // Apply manual user offset
    worldX += this.userOffset.x;
    worldY += this.userOffset.y;
    worldZ += this.userOffset.z;
    const finalScale = baseWorldScale * this.userOffset.scale;

    // ----- Rotation: roll + pitch + yaw + manual offsets -----
    // A-Frame rotation is in degrees, XYZ order.
    // roll  → rotate around Z (head tilt)
    // pitch → rotate around X (nodding)
    // yaw   → rotate around Y (turning)
    const rollDeg  = pose.roll  * 180 / Math.PI + this.userOffset.rz;
    const pitchDeg = pose.pitch * 180 / Math.PI + this.userOffset.rx;
    const yawDeg   = pose.yaw   * 180 / Math.PI + this.userOffset.ry;

    this.glassesRoot.setAttribute('position', `${worldX} ${worldY} ${worldZ}`);
    this.glassesRoot.setAttribute('rotation', `${pitchDeg} ${yawDeg} ${rollDeg}`);
    this.glassesRoot.setAttribute('scale', `${finalScale} ${finalScale} ${finalScale}`);
  }
});

function lerp(a, b, t) { return a + (b - a) * t; }
function lerp3(a, b, t) {
  if (!a) return { ...b };
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

// ============================================================================

const PROCEDURAL_BUILDERS = {
  aviator:   buildAviator,
  wayfarer:  buildWayfarer,
  cateye:    buildCateye,
  round:     buildRound,
  sport:     buildSport,
  oversized: buildOversized,
  rectangle: buildRectangle,
  square:    buildSquare,
  oval:      buildOval,
  browline:  buildBrowline
};

export class TryOnScene {
  /**
   * @param {HTMLElement} container  DOM element to mount the <a-scene> inside
   */
  constructor(container) {
    this.container = container;
    this.sceneEl = null;
    this.cameraEl = null;
    this.rigEl = null;
    this.modelCache = new Map();      // modelKey -> cloned root entity
    this.currentProduct = null;
    this.mirrored = true;             // mirror canvas (matches live camera)
    this._ready = false;
  }

  /** Build the A-Frame scene markup and append it to the container.
   *  We use a wrapper div + appendChild so we do NOT wipe out the existing
   *  children (video, placeholder, hud) of the stage container.
   */
  mount() {
    if (this.sceneEl) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'aframe-wrapper';
    wrapper.style.cssText = 'position:absolute; inset:0; z-index:2; pointer-events:none;';
    wrapper.innerHTML = `
      <a-scene
        embedded
        renderer="alpha: true; antialias: true; physicallyCorrectLights: true; colorManagement: true;"
        background="transparent: true"
        vr-mode-ui="enabled: false"
        device-orientation-permission-ui="enabled: false"
        loading-screen="enabled: false"
        style="width:100%; height:100%; background: transparent; pointer-events:none;">
        <a-assets></a-assets>

        <a-entity light="type: ambient; color: #ffffff; intensity: 0.7"></a-entity>
        <a-entity light="type: directional; color: #ffffff; intensity: 0.9; castShadow: false"
                  position="0.5 1.5 1"></a-entity>
        <a-entity light="type: directional; color: #fff5e0; intensity: 0.45"
                  position="-1 0.3 0.6"></a-entity>

        <a-entity id="rig" glasses-rig></a-entity>

        <a-camera
          position="0 0 0"
          rotation="0 0 0"
          fov="50"
          near="0.05"
          far="100"
          look-controls="enabled: false"
          wasd-controls="enabled: false">
        </a-camera>
      </a-scene>
    `;
    this.container.appendChild(wrapper);
    this.sceneEl = wrapper.querySelector('a-scene');
    this.rigEl = this.sceneEl.querySelector('#rig');
    this.cameraEl = this.sceneEl.querySelector('a-camera');
    // Apply mirroring via CSS (so canvas matches mirrored <video>)
    this.applyMirror();
    return new Promise(resolve => {
      if (this.sceneEl.hasLoaded) {
        this._ready = true;
        resolve();
      } else {
        this.sceneEl.addEventListener('loaded', () => {
          this._ready = true;
          resolve();
        });
      }
    });
  }

  applyMirror() {
    if (!this.sceneEl) return;
    const canvas = this.sceneEl.canvas;
    if (!canvas) return;
    canvas.style.transform = this.mirrored ? 'scaleX(-1)' : 'none';
  }

  setMirrored(m) {
    this.mirrored = m;
    this.applyMirror();
  }

  /**
   * Build (or load) a glasses model from the product spec and mount it on the rig.
   * Real GLB files take precedence: if `product.model` is a path ending in .glb,
   * we load it via gltf-model. Otherwise we build procedurally.
   */
  async setProduct(product) {
    if (!this._ready) await this.mount();
    this.currentProduct = product;

    // Cache key: id (each unique product has unique colors)
    let root = this.modelCache.get(product.id);
    if (!root) {
      root = await this._buildGlasses(product);
      this.modelCache.set(product.id, root);
    }
    // Clone the cached template so we always start from a clean transform.
    const clone = root.cloneNode(true);
    // Need to call initComponents for cloned entities
    this.rigEl.components['glasses-rig'].setGlasses(clone);
    return clone;
  }

  async _buildGlasses(product) {
    // If product.model is a .glb URL, load it.
    if (product.model && /\.glb$/i.test(product.model)) {
      const entity = document.createElement('a-entity');
      entity.setAttribute('gltf-model', `url(${product.model})`);
      await new Promise((resolve) => {
        entity.addEventListener('model-loaded', resolve, { once: true });
        entity.addEventListener('model-error', resolve, { once: true });
      });
      return entity;
    }
    // Otherwise build procedurally from model-type + colors.
    const builder = PROCEDURAL_BUILDERS[product.model] || PROCEDURAL_BUILDERS.rectangle;
    return builder(product);
  }

  /** Push a MediaPipe pose into the rig for smoothing + application. */
  updatePose(pose) {
    if (!this._ready) return;
    const comp = this.rigEl && this.rigEl.components['glasses-rig'];
    if (comp) comp.setPose(pose);
  }

  /** Update manual user offset (zoom, rotate, raise/lower). */
  setUserOffset(partial) {
    const comp = this.rigEl && this.rigEl.components['glasses-rig'];
    if (comp) comp.setUserOffset(partial);
  }

  resetOffset() {
    const comp = this.rigEl && this.rigEl.components['glasses-rig'];
    if (comp) comp.resetOffset();
  }

  /** Inform the scene that the face is lost so it can decay the pose. */
  faceLost() {
    // The rig keeps the last smoothed pose; we could fade out the glasses here.
  }

  /** Get the A-Frame canvas (used by screenshot manager). */
  getCanvas() {
    return this.sceneEl ? this.sceneEl.canvas : null;
  }
}

// ============================================================================
//  Procedural glasses builders
//  All builders return an <a-entity> whose local origin is the bridge of the
//  nose (between the two lenses). Units are in metres; the interpupillary
//  distance is normalised to ~0.063m so models align with the rig's scaler.
// ============================================================================

const IPD = 0.063; // interpupillary distance in metres (canonical)
const FRAME_RADIUS = 0.034;
const LENS_THICKNESS = 0.004;
const TEMPLE_LENGTH = 0.14;

function makeEntity(attrs = {}) {
  const el = document.createElement('a-entity');
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function commonFrame(frameColor, lensColor) {
  // Returns {frameMat, lensMat} as A-Frame material attribute strings.
  return {
    frameMat: `material: color: ${frameColor}; shader: standard; roughness: 0.35; metalness: 0.4;`,
    lensMat:  `material: color: ${lensColor}; shader: standard; roughness: 0.1; metalness: 0.0; opacity: 0.78; transparent: true;`
  };
}

function buildLens(root, side /* -1 left, +1 right */, lensColor, frameColor, lensShape = 'circle', extra = {}) {
  const { frameMat, lensMat } = commonFrame(frameColor, lensColor);
  const cx = side * IPD / 2;

  // Lens (a thin cylinder laid flat, axis along Z)
  const lens = makeEntity({
    geometry: lensShape === 'circle'
      ? `primitive: cylinder; radius: ${FRAME_RADIUS}; height: ${LENS_THICKNESS}; segmentsRadial: 32`
      : `primitive: cylinder; radius: ${FRAME_RADIUS}; height: ${LENS_THICKNESS}; segmentsRadial: 4`,
    position: `${cx} 0 0`,
    rotation: '90 0 0',
    [lensMat.split(':')[0].trim()]: lensMat
  });
  lens.setAttribute('material', lensMat.replace('material: ', ''));
  // Squash for oval/rectangle: use scale
  if (lensShape === 'oval') lens.setAttribute('scale', '1 0.78 1');
  if (lensShape === 'rectangle') {
    lens.setAttribute('geometry', `primitive: box; width: ${FRAME_RADIUS * 2}; height: ${FRAME_RADIUS * 1.6}; depth: ${LENS_THICKNESS}`);
    lens.setAttribute('rotation', '0 0 0');
  }
  if (extra.lensScaleY) lens.setAttribute('scale', `1 ${extra.lensScaleY} 1`);
  root.appendChild(lens);

  // Frame ring around lens (torus)
  const ring = makeEntity({
    geometry: `primitive: torus; radius: ${FRAME_RADIUS}; radiusTubular: 0.004; segmentsTubular: 24; segmentsRadial: 16`,
    position: `${cx} 0 0`,
    rotation: '90 0 0'
  });
  ring.setAttribute('material', frameMat.replace('material: ', ''));
  if (lensShape === 'oval') ring.setAttribute('scale', '1 0.78 1');
  if (lensShape === 'rectangle') {
    ring.setAttribute('geometry', `primitive: torus; radius: ${FRAME_RADIUS * 0.95}; radiusTubular: 0.004; segmentsTubular: 8; segmentsRadial: 4`);
    ring.setAttribute('scale', '1.05 0.85 1');
  }
  if (extra.lensScaleY) ring.setAttribute('scale', `1 ${extra.lensScaleY} 1`);
  root.appendChild(ring);

  // Temple arm (going back, away from face)
  const temple = makeEntity({
    geometry: `primitive: box; width: 0.005; height: 0.005; depth: ${TEMPLE_LENGTH}`,
    position: `${side * (IPD / 2 + FRAME_RADIUS)} 0 ${-TEMPLE_LENGTH / 2 + 0.01}`,
    rotation: '0 0 0'
  });
  temple.setAttribute('material', frameMat.replace('material: ', ''));
  // Slight outward bend
  temple.setAttribute('rotation', `0 ${side * -8} 0`);
  root.appendChild(temple);

  // End piece connecting frame to temple
  const endPiece = makeEntity({
    geometry: `primitive: box; width: 0.008; height: 0.008; depth: 0.018`,
    position: `${side * (IPD / 2 + FRAME_RADIUS * 0.8)} 0 0.005`
  });
  endPiece.setAttribute('material', frameMat.replace('material: ', ''));
  root.appendChild(endPiece);
}

function buildBridge(root, frameColor, style = 'flat') {
  const { frameMat } = commonFrame(frameColor, '#ffffff');
  const bridge = makeEntity({
    geometry: `primitive: box; width: ${IPD * 0.85}; height: 0.006; depth: 0.006`,
    position: '0 0.002 0.005'
  });
  bridge.setAttribute('material', frameMat.replace('material: ', ''));
  root.appendChild(bridge);
  if (style === 'keyhole') {
    const k = makeEntity({
      geometry: 'primitive: box; width: 0.012; height: 0.004; depth: 0.006',
      position: '0 -0.005 0.005'
    });
    k.setAttribute('material', frameMat.replace('material: ', ''));
    root.appendChild(k);
  }
}

function buildAviator(p) {
  const root = makeEntity();
  // Aviator: teardrop shape — we use elongated oval lenses with bottom-heavy
  buildLens(root, -1, p.lensColor, p.modelColor, 'oval', { lensScaleY: 1.25 });
  buildLens(root,  1, p.lensColor, p.modelColor, 'oval', { lensScaleY: 1.25 });
  buildBridge(root, p.modelColor, 'flat');
  return root;
}

function buildWayfarer(p) {
  const root = makeEntity();
  buildLens(root, -1, p.lensColor, p.modelColor, 'rectangle');
  buildLens(root,  1, p.lensColor, p.modelColor, 'rectangle');
  buildBridge(root, p.modelColor, 'flat');
  return root;
}

function buildCateye(p) {
  const root = makeEntity();
  // Slight upward tilt at outer corners — modeled by scaling + rotating each lens
  buildLens(root, -1, p.lensColor, p.modelColor, 'oval', { lensScaleY: 0.72 });
  buildLens(root,  1, p.lensColor, p.modelColor, 'oval', { lensScaleY: 0.72 });
  // Add small decorative brow line
  const { frameMat } = commonFrame(p.modelColor, '#ffffff');
  [-1, 1].forEach(side => {
    const brow = makeEntity({
      geometry: `primitive: box; width: 0.06; height: 0.005; depth: 0.005`,
      position: `${side * IPD / 2} 0.022 0.008`,
      rotation: `0 0 ${side * -10}`
    });
    brow.setAttribute('material', frameMat.replace('material: ', ''));
    root.appendChild(brow);
  });
  buildBridge(root, p.modelColor, 'flat');
  return root;
}

function buildRound(p) {
  const root = makeEntity();
  buildLens(root, -1, p.lensColor, p.modelColor, 'circle');
  buildLens(root,  1, p.lensColor, p.modelColor, 'circle');
  buildBridge(root, p.modelColor, 'keyhole');
  return root;
}

function buildSport(p) {
  // Wraparound: a single wide shield
  const root = makeEntity();
  const { frameMat, lensMat } = commonFrame(p.modelColor, p.lensColor);
  const shield = makeEntity({
    geometry: `primitive: cylinder; radius: 0.075; height: ${LENS_THICKNESS}; segmentsRadial: 32; thetaLength: 70; thetaStart: 35`,
    position: '0 0 0',
    rotation: '90 0 0'
  });
  shield.setAttribute('material', lensMat.replace('material: ', ''));
  shield.setAttribute('scale', '1 0.65 1');
  root.appendChild(shield);
  const frame = makeEntity({
    geometry: `primitive: torus; radius: 0.075; radiusTubular: 0.0035; segmentsTubular: 32; segmentsRadial: 8; thetaLength: 70; thetaStart: 35`,
    position: '0 0 0',
    rotation: '90 0 0'
  });
  frame.setAttribute('material', frameMat.replace('material: ', ''));
  frame.setAttribute('scale', '1 0.65 1');
  root.appendChild(frame);
  buildBridge(root, p.modelColor, 'flat');
  // Temples for sport (curved)
  [-1, 1].forEach(side => {
    const temple = makeEntity({
      geometry: `primitive: box; width: 0.005; height: 0.005; depth: ${TEMPLE_LENGTH}`,
      position: `${side * 0.07} 0 ${-TEMPLE_LENGTH / 2}`,
      rotation: `0 ${side * -20} 0`
    });
    temple.setAttribute('material', frameMat.replace('material: ', ''));
    root.appendChild(temple);
  });
  return root;
}

function buildOversized(p) {
  const root = makeEntity();
  buildLens(root, -1, p.lensColor, p.modelColor, 'rectangle', { lensScaleY: 1.05 });
  buildLens(root,  1, p.lensColor, p.modelColor, 'rectangle', { lensScaleY: 1.05 });
  buildBridge(root, p.modelColor, 'flat');
  return root;
}

function buildRectangle(p) {
  const root = makeEntity();
  buildLens(root, -1, p.lensColor, p.modelColor, 'rectangle');
  buildLens(root,  1, p.lensColor, p.modelColor, 'rectangle');
  buildBridge(root, p.modelColor, 'flat');
  return root;
}

function buildSquare(p) {
  const root = makeEntity();
  buildLens(root, -1, p.lensColor, p.modelColor, 'rectangle');
  buildLens(root,  1, p.lensColor, p.modelColor, 'rectangle');
  buildBridge(root, p.modelColor, 'flat');
  return root;
}

function buildOval(p) {
  const root = makeEntity();
  buildLens(root, -1, p.lensColor, p.modelColor, 'oval');
  buildLens(root,  1, p.lensColor, p.modelColor, 'oval');
  buildBridge(root, p.modelColor, 'flat');
  return root;
}

function buildBrowline(p) {
  const root = makeEntity();
  buildLens(root, -1, p.lensColor, p.modelColor, 'rectangle');
  buildLens(root,  1, p.lensColor, p.modelColor, 'rectangle');
  buildBridge(root, p.modelColor, 'flat');
  // Heavy brow line on top
  const { frameMat } = commonFrame(p.modelColor, '#ffffff');
  [-1, 1].forEach(side => {
    const brow = makeEntity({
      geometry: `primitive: box; width: 0.075; height: 0.008; depth: 0.006`,
      position: `${side * IPD / 2} 0.028 0.005`
    });
    brow.setAttribute('material', frameMat.replace('material: ', ''));
    root.appendChild(brow);
  });
  return root;
}
