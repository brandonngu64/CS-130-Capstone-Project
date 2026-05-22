export class HealthBarOverlay {
  private readonly root: HTMLElement;
  private readonly label: HTMLElement;
  private readonly value: HTMLElement;
  private readonly track: HTMLElement;
  private readonly fill: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'health-bar';
    this.root.dataset.visible = 'false';

    this.label = document.createElement('div');
    this.label.className = 'health-bar__label';
    this.label.innerHTML = '<span class="health-bar__title">Health</span><span class="health-bar__value">0 / 0</span>';

    this.value = this.label.querySelector('.health-bar__value') as HTMLElement;
    this.track = document.createElement('div');
    this.track.className = 'health-bar__track';

    this.fill = document.createElement('div');
    this.fill.className = 'health-bar__fill';
    this.fill.dataset.low = 'false';
    this.track.appendChild(this.fill);

    this.root.appendChild(this.label);
    this.root.appendChild(this.track);
    parent.appendChild(this.root);
  }

  update(health: number, maxHealth: number): void {
    const safeMax = Math.max(1, maxHealth);
    const safeHealth = Math.max(0, Math.min(health, safeMax));
    const ratio = safeHealth / safeMax;

    this.value.textContent = `${safeHealth} / ${safeMax}`;
    this.fill.style.width = `${ratio * 100}%`;
    this.fill.dataset.low = ratio < 0.33 ? 'true' : 'false';
    this.root.dataset.visible = 'true';
  }

  hide(): void {
    this.root.dataset.visible = 'false';
  }

  dispose(): void {
    if (this.root.parentElement) {
      this.root.parentElement.removeChild(this.root);
    }
  }
}
