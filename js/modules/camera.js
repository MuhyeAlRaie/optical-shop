/**
 * camera.js — wraps getUserMedia + photo upload + capture.
 * Exposes a small event-based API.
 */

export class CameraManager {
  constructor() {
    this.stream = null;
    this.video = null;        // <video> element bound for live preview
    this.facingMode = 'user'; // 'user' (front) | 'environment' (rear)
    this.active = false;
    this.mode = null;         // 'camera' | 'photo'
    this.photoImage = null;   // HTMLImageElement when mode === 'photo'
    this.photoCanvas = null;  // Off-screen canvas with the uploaded photo
    this._listeners = new Map();
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

  /** Bind a <video> element for live preview. */
  attachVideo(videoEl) {
    this.video = videoEl;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute('autoplay', '');
    this.video.setAttribute('muted', '');
  }

  async startCamera(facingMode = this.facingMode) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera API not supported in this browser.');
    }
    this.stopCamera();
    this.facingMode = facingMode;
    const constraints = {
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      // Retry without facingMode constraint (e.g., desktops without orientation)
      this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    if (!this.video) {
      throw new Error('No video element bound. Call attachVideo() first.');
    }
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {/* autoplay can be flaky */});
    this.active = true;
    this.mode = 'camera';
    this.photoImage = null;
    this.photoCanvas = null;
    this._emit('started', { mode: this.mode, facingMode: this.facingMode });
    return this;
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.video) {
      try { this.video.srcObject = null; } catch (e) {}
    }
    this.active = false;
    if (this.mode === 'camera') {
      this._emit('stopped');
    }
  }

  async switchCamera() {
    if (!this.active || this.mode !== 'camera') {
      throw new Error('Camera not active.');
    }
    const next = this.facingMode === 'user' ? 'environment' : 'user';
    return this.startCamera(next);
  }

  /**
   * Load an image file (File or URL) and use it as the static backdrop
   * instead of a live camera feed.
   */
  async loadPhoto(fileOrUrl) {
    let url;
    let revoke = false;
    if (typeof fileOrUrl === 'string') {
      url = fileOrUrl;
    } else if (fileOrUrl instanceof File) {
      url = URL.createObjectURL(fileOrUrl);
      revoke = true;
    } else {
      throw new Error('loadPhoto expects a File or URL string.');
    }
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not load image.'));
      i.crossOrigin = 'anonymous';
      i.src = url;
    });
    // Draw to canvas so we can read pixels for MediaPipe
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);

    this.stopCamera();
    this.photoImage = img;
    this.photoCanvas = c;
    this.mode = 'photo';
    this.active = true;
    this._emit('started', { mode: this.mode });
    if (revoke) URL.revokeObjectURL(url);
    return this;
  }

  /** Capture the current frame (live or photo) as a canvas + ImageBitmap. */
  async captureFrame() {
    if (!this.active) return null;
    if (this.mode === 'photo') {
      // Return a fresh copy
      const c = document.createElement('canvas');
      c.width = this.photoCanvas.width;
      c.height = this.photoCanvas.height;
      c.getContext('2d').drawImage(this.photoCanvas, 0, 0);
      return { canvas: c, width: c.width, height: c.height, source: 'photo' };
    }
    // Live camera
    const v = this.video;
    if (!v.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    // Un-mirror for analysis (video element is mirrored via CSS but pixels aren't)
    ctx.save();
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0, c.width, c.height);
    ctx.restore();
    return { canvas: c, width: c.width, height: c.height, source: 'camera' };
  }

  isActive() { return this.active; }
  getMode() { return this.mode; }
}
