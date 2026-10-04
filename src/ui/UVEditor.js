// UVEditor.js
// 2D UV Texture Map Viewport with interactive brush painting and UV Wireframe Overlay

export class UVEditor {
  constructor(canvas, compositor) {
    this.canvas = canvas;
    this.compositor = compositor;
    this.ctx = this.canvas.getContext("2d");

    this.showWireframe = true;
    this.activeMeshGeometry = null;

    // Pan & Zoom
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };

    this.render = this.render.bind(this);
    this.setupEvents();
  }

  setGeometry(geometry) {
    this.activeMeshGeometry = geometry;
    this.render();
  }

  setupEvents() {
    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      this.zoom = Math.max(0.2, Math.min(5.0, this.zoom * zoomFactor));
      this.render();
    });

    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    this.canvas.width = parent.clientWidth;
    this.canvas.height = parent.clientHeight;
    this.render();
  }

  render() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w === 0 || h === 0) return;

    this.ctx.clearRect(0, 0, w, h);

    this.ctx.save();
    this.ctx.translate(w / 2 + this.panX, h / 2 + this.panY);
    this.ctx.scale(this.zoom, this.zoom);

    // Center square texture in viewport
    const displaySize = Math.min(w, h) * 0.85;
    const half = displaySize / 2;

    // Draw checkerboard background
    this.ctx.fillStyle = "#18181a";
    this.ctx.fillRect(-half, -half, displaySize, displaySize);

    // Draw composite texture
    this.ctx.drawImage(this.compositor.baseColorCanvas, -half, -half, displaySize, displaySize);

    // Draw UV Wireframe Overlay
    if (this.showWireframe && this.activeMeshGeometry) {
      this.drawUVWireframe(-half, -half, displaySize);
    }

    // Border
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    this.ctx.lineWidth = 1 / this.zoom;
    this.ctx.strokeRect(-half, -half, displaySize, displaySize);

    this.ctx.restore();
  }

  drawUVWireframe(originX, originY, size) {
    const geo = this.activeMeshGeometry;
    if (!geo || !geo.attributes.uv) return;

    const uvs = geo.attributes.uv;
    const indices = geo.index;

    this.ctx.save();
    this.ctx.strokeStyle = "rgba(100, 210, 255, 0.4)";
    this.ctx.lineWidth = 1 / this.zoom;

    if (indices) {
      this.ctx.beginPath();
      for (let i = 0; i < indices.count; i += 3) {
        const i0 = indices.getX(i);
        const i1 = indices.getX(i + 1);
        const i2 = indices.getX(i + 2);

        const u0 = originX + uvs.getX(i0) * size;
        const v0 = originY + (1 - uvs.getY(i0)) * size;

        const u1 = originX + uvs.getX(i1) * size;
        const v1 = originY + (1 - uvs.getY(i1)) * size;

        const u2 = originX + uvs.getX(i2) * size;
        const v2 = originY + (1 - uvs.getY(i2)) * size;

        this.ctx.moveTo(u0, v0);
        this.ctx.lineTo(u1, v1);
        this.ctx.lineTo(u2, v2);
        this.ctx.closePath();
      }
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  screenToUV(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const w = this.canvas.width;
    const h = this.canvas.height;
    const displaySize = Math.min(w, h) * 0.85;

    // Inverse transform
    const transX = (x - (w / 2 + this.panX)) / this.zoom;
    const transY = (y - (h / 2 + this.panY)) / this.zoom;

    const half = displaySize / 2;
    const u = (transX + half) / displaySize;
    const v = (transY + half) / displaySize;

    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
      return { u, v: 1 - v }; // Standard UV coordinates
    }
    return null;
  }
}
