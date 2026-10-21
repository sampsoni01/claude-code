import { ART_WIDTH, type PixelSurface } from './pixelSurface';

/** World scale per zoom step. Boxes and lines are always drawn in whole art pixels, so any scale stays crisp. */
export const ZOOMS = [0.4, 0.6, 1, 2] as const;

export class Camera {
  /** World point shown at the centre of the screen. */
  x = 0;
  y = 0;
  zoomIndex = 0;

  get zoom(): number {
    return ZOOMS[this.zoomIndex] as number;
  }

  worldToScreen(wx: number, wy: number, surface: PixelSurface): { x: number; y: number } {
    return {
      x: Math.round((wx - this.x) * this.zoom + ART_WIDTH / 2),
      y: Math.round((wy - this.y) * this.zoom + surface.height / 2),
    };
  }

  screenToWorld(sx: number, sy: number, surface: PixelSurface): { x: number; y: number } {
    return {
      x: this.x + (sx - ART_WIDTH / 2) / this.zoom,
      y: this.y + (sy - surface.height / 2) / this.zoom,
    };
  }

  /** Pans by a screen-space delta in art pixels. */
  pan(dx: number, dy: number): void {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
  }

  /** Changes zoom while keeping the world point under (sx, sy) in place. */
  setZoom(index: number, sx: number, sy: number, surface: PixelSurface): boolean {
    const next = Math.max(0, Math.min(ZOOMS.length - 1, index));
    if (next === this.zoomIndex) return false;
    const before = this.screenToWorld(sx, sy, surface);
    this.zoomIndex = next;
    const after = this.screenToWorld(sx, sy, surface);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    return true;
  }

  /** Keeps the view over the galaxy, with a margin of world units. */
  clampTo(width: number, height: number, margin: number): void {
    this.x = Math.max(-margin, Math.min(width + margin, this.x));
    this.y = Math.max(-margin, Math.min(height + margin, this.y));
  }
}
