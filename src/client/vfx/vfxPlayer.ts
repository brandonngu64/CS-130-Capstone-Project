import type { VFXAsset, FrameData } from './assetLoader';

export type VFXPlayerOptions = {
  fps?: number;
  loop?: boolean;
};

// Pure animation state. No DOM, no Three.js. Output adapters read currentFrame.
export class VFXPlayer {
  readonly asset: VFXAsset;
  private readonly fps: number;
  private readonly loop: boolean;
  private accumulator = 0; // in animation frames (float)
  private frameIndex = 0;
  private done = false;

  constructor(asset: VFXAsset, opts: VFXPlayerOptions = {}) {
    this.asset = asset;
    this.fps = opts.fps ?? 60;
    this.loop = opts.loop ?? false;
  }

  // Advance by real (virtual) time. Called from the render loop with
  // deltaSeconds produced by VFXClock.
  advance(deltaSeconds: number): void {
    if (this.done || deltaSeconds <= 0) return;
    this.accumulator += deltaSeconds * this.fps;
    const next = Math.floor(this.accumulator);
    const total = this.asset.frames.length;
    if (this.loop) {
      this.frameIndex = ((next % total) + total) % total;
    } else if (next >= total - 1) {
      this.frameIndex = total - 1;
      this.done = true;
    } else if (next > this.frameIndex) {
      this.frameIndex = next;
    }
  }

  // Direct frame mapping for sources that already own the timeline (e.g. the
  // countdown is driven by a game-tick countdown, not by VFXClock).
  setProgress(elapsedSeconds: number, fps: number, frameOffset = 0): void {
    const total = this.asset.frames.length;
    if (total === 0) return;
    const raw = Math.floor(elapsedSeconds * fps) + frameOffset;
    this.frameIndex = Math.min(Math.max(raw, 0), total - 1);
    this.accumulator = this.frameIndex;
    this.done = this.frameIndex >= total - 1;
  }

  get currentFrame(): FrameData {
    return this.asset.frames[this.frameIndex];
  }

  get currentFrameIndex(): number {
    return this.frameIndex;
  }

  isDone(): boolean {
    return this.done;
  }

  reset(): void {
    this.accumulator = 0;
    this.frameIndex = 0;
    this.done = false;
  }

  // Pool plumbing: mark as finished so the pool can reclaim this slot.
  markDone(): void {
    this.done = true;
    this.frameIndex = Math.max(this.asset.frames.length - 1, 0);
  }
}
