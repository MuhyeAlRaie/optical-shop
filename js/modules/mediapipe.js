/**
 * mediapipe.js — wraps MediaPipe Tasks-Vision FaceLandmarker.
 *
 * Loads the WASM bundle + model from CDN, runs detection in a requestAnimationFrame
 * loop, and emits head-pose events the A-Frame scene can consume.
 *
 * References:
 *  - https://developers.google.com/mediapipe/solutions/vision/face_landmarker
 */

const TASKS_VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
// FaceLandmarker model (lite variant — small + fast for live try-on)
const FACE_LANDMARKER_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let _vision = null;       // cached TasksVision module
let _visionPromise = null;
let _landmarker = null;   // cached FaceLandmarker instance

async function loadTasksVision() {
  if (_vision) return _vision;
  if (_visionPromise) return _visionPromise;
  _visionPromise = import(TASKS_VISION_URL)
    .then(mod => {
      // The ESM bundle exports { FaceLandmarker, FilesetResolver, DrawingUtils, ... }
      if (!mod.FaceLandmarker || !mod.FilesetResolver) {
        throw new Error('Tasks-Vision module loaded but expected exports were not found.');
      }
      _vision = mod;
      return mod;
    })
    .catch(err => {
      _visionPromise = null;
      throw err;
    });
  return _visionPromise;
}

export class MediaPipeFaceTracker {
  constructor() {
    this.running = false;
    this._rafId = null;
    this._lastResult = null;
    this._listeners = new Map();
    this._lastVideoTime = -1;
    this._sourceCanvas = null;   // canvas used for detection (re-used)
    this._sourceCtx = null;
    this._frameProvider = null;  // function returning {canvas, width, height, source}
  }

  on(evt, fn) {
    if (!this._listeners.has(evt)) this._listeners.set(evt, []);
    this._listeners.get(evt).push(fn);
    return () => this.off(evt, fn);
  }
  off(evt, fn) {
    const arr = this._listeners.get(evt);
    if (arr) {
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    }
  }
  _emit(evt, payload) {
    (this._listeners.get(evt) || []).forEach(fn => {
      try { fn(payload); } catch (e) { console.error(e); }
    });
  }

  /** Initialise the FaceLandmarker model. Safe to call multiple times. */
  async init() {
    if (_landmarker) return _landmarker;
    this._emit('status', { stage: 'loading-wasm' });
    const vision = await loadTasksVision();
    this._emit('status', { stage: 'loading-model' });

    const filesetResolver = await vision.FilesetResolver.forVisionTasks(WASM_URL);
    // Older API used FaceLandmarker.createFromOptions(vision, {...});
    // Newer API uses FaceLandmarker.createForVideo() or FaceLandmarker.createFromOptions().
    const FaceLandmarkerCtor = vision.FaceLandmarker;
    _landmarker = await FaceLandmarkerCtor.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: FACE_LANDMARKER_MODEL,
        delegate: 'GPU' // prefer GPU; will fall back automatically on failure
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true
    });
    this._emit('status', { stage: 'ready' });
    return _landmarker;
  }

  /**
   * Begin tracking. `frameProvider` is an async function returning
   * {canvas, width, height, source} (typically CameraManager.captureFrame()).
   */
  async start(frameProvider) {
    await this.init();
    this._frameProvider = frameProvider;
    if (this.running) return;
    this.running = true;
    this._loop();
  }

  stop() {
    this.running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  async _loop() {
    if (!this.running) return;
    try {
      const frame = await this._frameProvider();
      if (frame && frame.canvas) {
        this._detect(frame);
      }
    } catch (e) {
      this._emit('error', e);
    }
    this._rafId = requestAnimationFrame(() => this._loop());
  }

  _detect(frame) {
    if (!_landmarker) return;
    const canvas = frame.canvas;
    // Use performance.now() as video time; MediaPipe only uses it for de-dup.
    const now = performance.now();
    if (now === this._lastVideoTime) return; // identical frame — skip
    this._lastVideoTime = now;

    let result;
    try {
      result = _landmarker.detectForVideo(canvas, now);
    } catch (e) {
      this._emit('error', e);
      return;
    }
    if (!result || !result.faceLandmarks || result.faceLandmarks.length === 0) {
      if (this._lastResult) {
        this._lastResult = null;
        this._emit('lost');
      }
      return;
    }

    const landmarks = result.faceLandmarks[0]; // array of {x, y, z} normalized
    const w = frame.width;
    const h = frame.height;

    // --- Key landmarks (MediaPipe Face Mesh canonical indices) ---
    // Left eye outer corner (subject's right, viewer's left)
    const L_EYE_OUTER = landmarks[33];
    // Right eye outer corner (subject's left, viewer's right)
    const R_EYE_OUTER = landmarks[263];
    // Left eye inner corner
    const L_EYE_INNER = landmarks[133];
    // Right eye inner corner
    const R_EYE_INNER = landmarks[362];
    // Nose bridge top (between eyes)
    const NOSE_BRIDGE = landmarks[168];
    // Nose tip
    const NOSE_TIP = landmarks[1];
    // Chin
    const CHIN = landmarks[152];
    // Forehead
    const FOREHEAD = landmarks[10];

    // Convert normalized -> pixel coordinates
    const toPx = (lm) => ({ x: lm.x * w, y: lm.y * h, z: lm.z * w });

    const lEye = toPx(L_EYE_OUTER);
    const rEye = toPx(R_EYE_OUTER);
    const lEyeIn = toPx(L_EYE_INNER);
    const rEyeIn = toPx(R_EYE_INNER);
    const noseBridge = toPx(NOSE_BRIDGE);
    const noseTip = toPx(NOSE_TIP);
    const chin = toPx(CHIN);
    const forehead = toPx(FOREHEAD);

    // Eye centers (averaged)
    const leftEyeCenter = {
      x: (lEye.x + lEyeIn.x) / 2,
      y: (lEye.y + lEyeIn.y) / 2,
      z: (lEye.z + lEyeIn.z) / 2
    };
    const rightEyeCenter = {
      x: (rEye.x + rEyeIn.x) / 2,
      y: (rEye.y + rEyeIn.y) / 2,
      z: (rEye.z + rEyeIn.z) / 2
    };
    const eyeMid = {
      x: (leftEyeCenter.x + rightEyeCenter.x) / 2,
      y: (leftEyeCenter.y + rightEyeCenter.y) / 2,
      z: (leftEyeCenter.z + rightEyeCenter.z) / 2
    };

    const dx = rightEyeCenter.x - leftEyeCenter.x;
    const dy = rightEyeCenter.y - leftEyeCenter.y;
    const dz = rightEyeCenter.z - leftEyeCenter.z;
    const eyeDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Roll = rotation around z-axis (forward tilt of head sideways)
    // Derived from angle between the eye line and the horizontal axis.
    const roll = Math.atan2(dy, dx);

    // Yaw = rotation around y-axis (turning head left/right).
    // When yaw increases, the nose moves horizontally away from the eye midpoint.
    // Use the horizontal offset of nose tip vs eye midpoint, normalized by eye distance.
    const noseOffsetX = (noseTip.x - eyeMid.x) / Math.max(eyeDistance, 1);
    // Clamp to reasonable range then convert to radians.
    const yaw = Math.atan(noseOffsetX);

    // Pitch = rotation around x-axis (nodding up/down).
    // Approximate by vertical offset of nose tip vs eye midpoint, relative to face height.
    const faceHeight = Math.abs(chin.y - forehead.y);
    const noseOffsetY = (noseTip.y - eyeMid.y) / Math.max(faceHeight, 1);
    // The nose naturally sits below the eyes; subtract that baseline (~0.45) and clamp.
    const pitch = Math.atan((noseOffsetY - 0.45) * 1.2);

    // Face width / scale (in pixels). We use eye distance as the canonical scale.
    const scale = eyeDistance;

    // Optionally use the facial transformation matrix (more accurate head pose)
    // provided by MediaPipe. The matrix is row-major 4x4.
    let matrix = null;
    if (result.facialTransformationMatrixes && result.facialTransformationMatrixes.length > 0) {
      matrix = result.facialTransformationMatrixes[0].data;
    }

    const pose = {
      landmarks: { lEye, rEye, lEyeIn, rEyeIn, noseBridge, noseTip, chin, forehead },
      leftEyeCenter, rightEyeCenter, eyeMid,
      noseBridge, noseTip,
      eyeDistance,
      faceHeight,
      scale,
      roll, yaw, pitch,  // radians
      matrix,
      frame: { width: w, height: h, source: frame.source }
    };

    this._lastResult = pose;
    this._emit('pose', pose);
  }

  getLastPose() { return this._lastResult; }
}
