import { VFXPlayer } from './vfxPlayer';

// 2D output adapter. Draws current frame into a hidden design-resolution
// canvas (1920×1080), then blits to the visible target canvas with
// aspect-fit letterbox. This is what makes trimmed frames render at the
// correct position within the design rect — the old CountdownVFXRenderer
// stretched every trimmed frame to fill the visible canvas.
export class VFXCanvasOverlay {
  readonly player: VFXPlayer;
  private readonly target: HTMLCanvasElement;
  private readonly targetCtx: CanvasRenderingContext2D;
  private readonly designCanvas: HTMLCanvasElement;
  private readonly designCtx: CanvasRenderingContext2D;
  private lastFrameIndex = -1;
  private lastTargetW = 0;
  private lastTargetH = 0;

  constructor(player: VFXPlayer, target: HTMLCanvasElement) {
    this.player = player;
    this.target = target;
    const tctx = target.getContext('2d');
    if (!tctx) throw new Error('VFXCanvasOverlay: target canvas has no 2d context');
    this.targetCtx = tctx;

    this.designCanvas = document.createElement('canvas');
    this.designCanvas.width = player.asset.designSize.w;
    this.designCanvas.height = player.asset.designSize.h;
    const dctx = this.designCanvas.getContext('2d');
    if (!dctx) throw new Error('VFXCanvasOverlay: design canvas has no 2d context');
    this.designCtx = dctx;
  }

  update(): void {
    const idx = this.player.currentFrameIndex;
    const w = this.target.width;
    const h = this.target.height;

    const frameChanged = idx !== this.lastFrameIndex;
    const sizeChanged = w !== this.lastTargetW || h !== this.lastTargetH;
    if (!frameChanged && !sizeChanged) return;
    this.lastFrameIndex = idx;
    this.lastTargetW = w;
    this.lastTargetH = h;

    if (frameChanged) this.drawDesignFrame();
    this.blitToTarget();
  }

  private drawDesignFrame(): void {
    const f = this.player.currentFrame;
    if (!f) return;
    const atlas = this.player.asset.atlases[f.atlasIndex];
    if (!atlas) return;

    const ctx = this.designCtx;
    ctx.clearRect(0, 0, this.designCanvas.width, this.designCanvas.height);

    if (!f.rotated) {
      ctx.drawImage(
        atlas,
        f.frame.x, f.frame.y, f.frame.w, f.frame.h,
        f.spriteSourceSize.x, f.spriteSourceSize.y, f.spriteSourceSize.w, f.spriteSourceSize.h,
      );
    } else {
      const cx = f.spriteSourceSize.x + f.spriteSourceSize.w / 2;
      const cy = f.spriteSourceSize.y + f.spriteSourceSize.h / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(
        atlas,
        f.frame.x, f.frame.y, f.frame.w, f.frame.h,
        -f.frame.h / 2, -f.frame.w / 2, f.frame.h, f.frame.w,
      );
      ctx.restore();
    }
  }

  private blitToTarget(): void {
    const tctx = this.targetCtx;
    const tw = this.target.width;
    const th = this.target.height;
    tctx.clearRect(0, 0, tw, th);
    if (tw === 0 || th === 0) return;

    // Aspect-fit (letterbox) so trim-correct frames keep their proportions.
    const dW = this.designCanvas.width;
    const dH = this.designCanvas.height;
    const scale = Math.min(tw / dW, th / dH);
    const drawW = dW * scale;
    const drawH = dH * scale;
    const dx = (tw - drawW) / 2;
    const dy = (th - drawH) / 2;
    tctx.drawImage(this.designCanvas, dx, dy, drawW, drawH);
  }

  // Forces a re-draw on next update() — used when the target canvas is
  // resized externally or when the player resets to frame 0.
  invalidate(): void {
    this.lastFrameIndex = -1;
    this.lastTargetW = 0;
    this.lastTargetH = 0;
  }

  dispose(): void {
    this.designCanvas.width = 0;
    this.designCanvas.height = 0;
  }
}
