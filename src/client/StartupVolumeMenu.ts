// First-time welcome screen. Shows three volume sliders (Master / SFX / Music)
// so a brand-new visitor isn't blasted by menu music at default levels.
// Dismissed by a single CONTINUE button; suppression is handled by the caller.

export interface StartupVolumeMenuCallbacks {
  onMasterVolumeChange(volume: number): void;
  onSfxVolumeChange(volume: number): void;
  onMusicVolumeChange(volume: number): void;
  onDismiss(): void;
}

export interface StartupVolumes {
  master: number;
  sfx: number;
  music: number;
}

function getElement<T extends HTMLElement>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

function pct(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 100);
}

export class StartupVolumeMenu {
  private readonly element: HTMLElement;

  constructor(parent: HTMLElement, initial: StartupVolumes, callbacks: StartupVolumeMenuCallbacks) {
    const masterPct = pct(initial.master);
    const sfxPct = pct(initial.sfx);
    const musicPct = pct(initial.music);

    this.element = document.createElement('div');
    this.element.className = 'overlay-backdrop startup-volume-menu';
    this.element.dataset.visible = 'true';
    this.element.innerHTML = `
      <div class="overlay-card startup-volume-card" role="dialog" aria-label="Welcome">
        <h2 class="overlay-title">Welcome</h2>
        <p class="startup-volume-subtitle">Set your volume before you begin.</p>

        <label class="range-field">
          <span>Master Volume <output id="startupVolumeMasterValue">${masterPct}%</output></span>
          <input id="startupVolumeMasterSlider" type="range" min="0" max="100" step="1" value="${masterPct}" />
        </label>

        <label class="range-field">
          <span>SFX Volume <output id="startupVolumeSfxValue">${sfxPct}%</output></span>
          <input id="startupVolumeSfxSlider" type="range" min="0" max="100" step="1" value="${sfxPct}" />
        </label>

        <label class="range-field">
          <span>Music Volume <output id="startupVolumeMusicValue">${musicPct}%</output></span>
          <input id="startupVolumeMusicSlider" type="range" min="0" max="100" step="1" value="${musicPct}" />
        </label>

        <button id="startupVolumeContinue" class="startup-volume-continue" type="button">Continue</button>
      </div>
    `;
    parent.appendChild(this.element);

    const wire = (
      sliderId: string,
      valueId: string,
      cb: (v: number) => void,
    ): void => {
      const slider = getElement<HTMLInputElement>(this.element, sliderId);
      const value = getElement<HTMLElement>(this.element, valueId);
      slider.addEventListener('input', () => {
        value.textContent = `${slider.value}%`;
        cb(Number(slider.value) / 100);
      });
    };

    wire('#startupVolumeMasterSlider', '#startupVolumeMasterValue', callbacks.onMasterVolumeChange);
    wire('#startupVolumeSfxSlider', '#startupVolumeSfxValue', callbacks.onSfxVolumeChange);
    wire('#startupVolumeMusicSlider', '#startupVolumeMusicValue', callbacks.onMusicVolumeChange);

    const continueButton = getElement<HTMLButtonElement>(this.element, '#startupVolumeContinue');
    continueButton.addEventListener('click', () => callbacks.onDismiss());
  }

  show(): void {
    this.element.dataset.visible = 'true';
  }

  hide(): void {
    this.element.dataset.visible = 'false';
  }

  destroy(): void {
    this.element.remove();
  }
}
