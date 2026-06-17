/**
 * screenshot.js — composites the camera/photo backdrop with the A-Frame
 * rendered glasses canvas, exports as PNG.
 *
 * Everything happens locally — no server, no cloud.
 */

export class ScreenshotManager {
  /**
   * @param {Object} deps
   * @param {import('./camera.js').CameraManager} deps.camera
   * @param {import('./scene.js').TryOnScene} deps.scene
   * @param {boolean} [deps.mirror=true] mirror output (matches live camera)
   */
  constructor({ camera, scene, mirror = true }) {
    this.camera = camera;
    this.scene = scene;
    this.mirror = mirror;
  }

  /**
   * Compose the final image. Returns a HTMLCanvasElement.
   */
  async compose() {
    const cameraCanvas = await this._getCameraCanvas();
    const glassesCanvas = this.scene.getCanvas();
    if (!cameraCanvas) throw new Error('No backdrop frame available.');

    const W = cameraCanvas.width;
    const H = cameraCanvas.height;
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d');

    // 1) Draw camera backdrop
    if (this.mirror) {
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(cameraCanvas, 0, 0, W, H);
      ctx.restore();
    } else {
      ctx.drawImage(cameraCanvas, 0, 0, W, H);
    }

    // 2) Draw A-Frame glasses on top (preserving its internal mirroring).
    // The A-Frame canvas may already be CSS-mirrored to match the live video.
    // We replicate the same transform when drawing to the output canvas so the
    // screenshot looks identical to what the user sees on screen.
    if (glassesCanvas) {
      if (this.mirror) {
        ctx.save();
        ctx.translate(W, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(glassesCanvas, 0, 0, W, H);
        ctx.restore();
      } else {
        ctx.drawImage(glassesCanvas, 0, 0, W, H);
      }
    }
    return out;
  }

  async _getCameraCanvas() {
    if (!this.camera.isActive()) return null;
    const frame = await this.camera.captureFrame();
    return frame ? frame.canvas : null;
  }

  /**
   * Capture + trigger a PNG download.
   * @param {string} [filename]
   */
  async captureAndDownload(filename) {
    const canvas = await this.compose();
    const dataUrl = canvas.toDataURL('image/png');
    const name = filename || `tryon-${Date.now()}.png`;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return { dataUrl, name, width: canvas.width, height: canvas.height };
  }

  /**
   * Capture a still frame from the camera (used by "Capture Photo" button).
   * The returned canvas includes the glasses overlay.
   */
  async captureStill() {
    return this.compose();
  }
}
