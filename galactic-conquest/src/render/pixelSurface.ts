/**
 * A 480-wide art-pixel framebuffer drawn with integer coordinates and no
 * anti-aliasing, then handed to the canvas, which the browser scales to the
 * phone with nearest-neighbor filtering.
 */
export const ART_WIDTH = 480;

/** Packs a color for direct Uint32 writes on little-endian hardware. */
export function rgb(r: number, g: number, b: number): number {
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

export class PixelSurface {
  readonly width = ART_WIDTH;
  height = 854;
  private readonly ctx: CanvasRenderingContext2D;
  private image: ImageData;
  private buf: Uint32Array;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2d canvas unavailable');
    this.ctx = ctx;
    this.image = ctx.createImageData(this.width, this.height);
    this.buf = new Uint32Array(this.image.data.buffer);
    this.fit();
  }

  /** Matches the logical height to the phone's aspect ratio. Returns true when it changed. */
  fit(): boolean {
    const cw = this.canvas.clientWidth || this.width;
    const ch = this.canvas.clientHeight || this.height;
    const h = Math.max(320, Math.min(1600, Math.round((this.width * ch) / cw)));
    if (h === this.height && this.canvas.width === this.width && this.canvas.height === h) return false;
    this.height = h;
    this.canvas.width = this.width;
    this.canvas.height = h;
    this.image = this.ctx.createImageData(this.width, h);
    this.buf = new Uint32Array(this.image.data.buffer);
    return true;
  }

  clear(color: number): void {
    this.buf.fill(color);
  }

  px(x: number, y: number, color: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.buf[y * this.width + x] = color;
  }

  rect(x: number, y: number, w: number, h: number, color: number): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    for (let yy = y0; yy < y1; yy++) {
      const row = yy * this.width;
      for (let xx = x0; xx < x1; xx++) this.buf[row + xx] = color;
    }
  }

  rectOutline(x: number, y: number, w: number, h: number, color: number): void {
    this.rect(x, y, w, 1, color);
    this.rect(x, y + h - 1, w, 1, color);
    this.rect(x, y, 1, h, color);
    this.rect(x + w - 1, y, 1, h, color);
  }

  /** Bresenham line. With dash > 0, draws dash pixels on and dash pixels off. */
  line(x0: number, y0: number, x1: number, y1: number, color: number, dash = 0): void {
    let dx = Math.abs(x1 - x0);
    let dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let n = 0;
    for (;;) {
      if (dash === 0 || Math.floor(n / dash) % 2 === 0) this.px(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
      n++;
    }
    void dx;
    void dy;
  }

  disc(cx: number, cy: number, r: number, color: number): void {
    for (let yy = -r; yy <= r; yy++) {
      const half = Math.floor(Math.sqrt(r * r - yy * yy));
      this.rect(cx - half, cy + yy, half * 2 + 1, 1, color);
    }
  }

  ring(cx: number, cy: number, r: number, color: number): void {
    let x = r;
    let y = 0;
    let err = 1 - r;
    while (x >= y) {
      this.px(cx + x, cy + y, color); this.px(cx - x, cy + y, color);
      this.px(cx + x, cy - y, color); this.px(cx - x, cy - y, color);
      this.px(cx + y, cy + x, color); this.px(cx - y, cy + x, color);
      this.px(cx + y, cy - x, color); this.px(cx - y, cy - x, color);
      y++;
      if (err < 0) err += 2 * y + 1;
      else {
        x--;
        err += 2 * (y - x) + 1;
      }
    }
  }

  present(): void {
    this.ctx.putImageData(this.image, 0, 0);
  }
}
