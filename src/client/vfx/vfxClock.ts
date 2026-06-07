// Locks all VFX advancement to 60 logical frames per real second, regardless of
// the monitor's refresh rate. Driven once per render frame from MultiplayerApp.
// Skips render frames that are too close together; doubles up when the window
// stalls. Capped delta prevents catastrophic catch-up after a long pause.
export class VFXClock {
  static readonly TARGET_FPS = 60;
  static readonly FRAME_INTERVAL_MS = 1000 / VFXClock.TARGET_FPS;
  private static readonly MAX_VIRTUAL_DELTA_S = 0.1; // cap at 6 frames per call

  private accumulatorMs = 0;

  // Returns "virtual seconds" the VFX layer should advance this render frame.
  // 0 means: not enough real time has passed for a new logical frame, skip update.
  tick(realDeltaMs: number): number {
    this.accumulatorMs += Math.max(0, realDeltaMs);
    if (this.accumulatorMs < VFXClock.FRAME_INTERVAL_MS) return 0;
    const wholeFrames = Math.floor(this.accumulatorMs / VFXClock.FRAME_INTERVAL_MS);
    this.accumulatorMs -= wholeFrames * VFXClock.FRAME_INTERVAL_MS;
    return Math.min(
      wholeFrames / VFXClock.TARGET_FPS,
      VFXClock.MAX_VIRTUAL_DELTA_S,
    );
  }

  reset(): void {
    this.accumulatorMs = 0;
  }
}
