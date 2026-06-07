export class LeavingManager {
  private kickTimerId: number | null = null;
  private disposed = false;

  constructor(
    private readonly onKick: () => void,
    private readonly kickDelayMs = 7000,
  ) {
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('pagehide', this.onPageHide);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelTimer();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('pagehide', this.onPageHide);
  }

  private onVisibilityChange = (): void => {
    if (this.disposed) return;
    if (document.visibilityState === 'hidden') {
      this.kickTimerId = window.setTimeout(() => {
        this.kickTimerId = null;
        if (!this.disposed) this.onKick();
      }, this.kickDelayMs);
    } else {
      this.cancelTimer();
    }
  };

  private onPageHide = (): void => {
    if (!this.disposed) this.onKick();
  };

  private cancelTimer(): void {
    if (this.kickTimerId !== null) {
      window.clearTimeout(this.kickTimerId);
      this.kickTimerId = null;
    }
  }
}
