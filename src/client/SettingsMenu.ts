import type { MapManifest } from './tiledMap';
import type { StatusTone } from './MainMenu';
import {
  INPUT_SCHEMES,
  isInputSchemeId,
  type InputScheme,
  type InputSchemeId,
} from './inputSchemes';

function getElement<T extends HTMLElement>(
  parent: ParentNode,
  selector: string,
): T {
  const element = parent.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface SettingsMenuCallbacks {
  onLeave(): void;
  onCopyShareUrl(): void;
  onClose(): void;
  onArenaSideWallsChange(enabled: boolean): void;
  onFullscreenChange(enabled: boolean): void;
  onVolumeChange(volume: number): void;
  onInputDelayChange(frames: number): void;
  onForceRelayChange(enabled: boolean): void;
  onInputSchemeChange(id: InputSchemeId): void;
}

export class SettingsMenu {
  private readonly element: HTMLElement;
  private readonly peerIdValue: HTMLElement;
  private readonly roomIdValue: HTMLElement;
  private readonly hostPeerIdValue: HTMLElement;
  private readonly mapNameValue: HTMLElement;
  private readonly mapSizeValue: HTMLElement;
  private readonly shareUrlInput: HTMLInputElement;
  private readonly leaveButton: HTMLButtonElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly sideWallsToggle: HTMLInputElement;
  private readonly fullscreenToggle: HTMLInputElement;
  private readonly volumeSlider: HTMLInputElement;
  private readonly volumeValue: HTMLElement;
  private readonly inputDelaySelect: HTMLSelectElement;
  private readonly forceRelayToggle: HTMLInputElement;
  private readonly inputSchemeSelect: HTMLSelectElement;
  private readonly inputBindingsList: HTMLElement;
  private readonly statusText: HTMLElement;

  constructor(parent: HTMLElement, callbacks: SettingsMenuCallbacks) {
    this.element = document.createElement('div');
    this.element.className = 'overlay-backdrop settings-menu';
    this.element.dataset.visible = 'false';
    this.element.innerHTML = SettingsMenu.template();
    parent.appendChild(this.element);

    this.peerIdValue = getElement<HTMLElement>(
      this.element,
      '#settingsMenuPeerId',
    );
    this.roomIdValue = getElement<HTMLElement>(
      this.element,
      '#settingsMenuRoomId',
    );
    this.hostPeerIdValue = getElement<HTMLElement>(
      this.element,
      '#settingsMenuHostId',
    );
    this.mapNameValue = getElement<HTMLElement>(this.element, '#settingsMenuMapName');
    this.mapSizeValue = getElement<HTMLElement>(this.element, '#settingsMenuMapSize');
    this.shareUrlInput = getElement<HTMLInputElement>(
      this.element,
      '#settingsMenuShareUrl',
    );
    this.leaveButton = getElement<HTMLButtonElement>(
      this.element,
      '#settingsMenuLeaveButton',
    );
    this.copyButton = getElement<HTMLButtonElement>(
      this.element,
      '#settingsMenuCopyButton',
    );
    this.closeButton = getElement<HTMLButtonElement>(
      this.element,
      '#settingsMenuCloseButton',
    );
    this.volumeSlider = getElement<HTMLInputElement>(
      this.element,
      '#settingsMenuVolumeSlider',
    );
    this.volumeValue = getElement<HTMLElement>(
      this.element,
      '#settingsMenuVolumeValue',
    );
    this.statusText = getElement<HTMLElement>(
      this.element,
      '#settingsMenuStatus',
    );
    this.sideWallsToggle = getElement<HTMLInputElement>(
      this.element,
      '#settingsMenuSideWallsToggle',
    );
    this.fullscreenToggle = getElement<HTMLInputElement>(
      this.element,
      '#settingsMenuFullscreenToggle',
    );
    this.inputDelaySelect = getElement<HTMLSelectElement>(
      this.element,
      '#settingsMenuInputDelaySelect',
    );
    this.forceRelayToggle = getElement<HTMLInputElement>(
      this.element,
      '#settingsMenuForceRelayToggle',
    );
    this.inputSchemeSelect = getElement<HTMLSelectElement>(
      this.element,
      '#settingsMenuInputSchemeSelect',
    );
    this.inputBindingsList = getElement<HTMLElement>(
      this.element,
      '#settingsMenuInputBindings',
    );

    this.leaveButton.addEventListener('click', () => callbacks.onLeave());
    this.copyButton.addEventListener('click', () => callbacks.onCopyShareUrl());
    this.closeButton.addEventListener('click', () => callbacks.onClose());
    this.sideWallsToggle.addEventListener('change', () => {
      callbacks.onArenaSideWallsChange(this.sideWallsToggle.checked);
    });
    this.fullscreenToggle.addEventListener('change', () => {
      callbacks.onFullscreenChange(this.fullscreenToggle.checked);
    });
    this.volumeSlider.addEventListener('input', () => {
      const volume = Number(this.volumeSlider.value) / 100;
      this.volumeValue.textContent = `${this.volumeSlider.value}%`;
      callbacks.onVolumeChange(volume);
    });
    this.inputDelaySelect.addEventListener('change', () => {
      const frames = Number.parseInt(this.inputDelaySelect.value, 10);
      if (Number.isFinite(frames)) {
        callbacks.onInputDelayChange(frames);
      }
    });
    this.forceRelayToggle.addEventListener('change', () => {
      callbacks.onForceRelayChange(this.forceRelayToggle.checked);
    });
    this.inputSchemeSelect.addEventListener('change', () => {
      const value = this.inputSchemeSelect.value;
      if (isInputSchemeId(value)) {
        callbacks.onInputSchemeChange(value);
      }
    });

    this.element.addEventListener('click', (event) => {
      if (event.target === this.element) {
        callbacks.onClose();
      }
    });
  }

  show(): void {
    this.element.dataset.visible = 'true';
  }

  hide(): void {
    this.element.dataset.visible = 'false';
  }

  isVisible(): boolean {
    return this.element.dataset.visible === 'true';
  }

  setPeerId(id: string): void {
    this.peerIdValue.textContent = id || '-';
  }

  setRoomId(id: string): void {
    this.roomIdValue.textContent = id || '-';
  }

  setHostPeerId(id: string): void {
    this.hostPeerIdValue.textContent = id || '-';
  }

  setMap(map: MapManifest): void {
    this.mapNameValue.textContent = map.name || '-';
    this.mapSizeValue.textContent = `${map.width} x ${map.height}`;
  }

  setShareUrl(url: string): void {
    this.shareUrlInput.value = url;
    this.copyButton.disabled = !url;
  }

  setStatus(message: string, tone: StatusTone = 'normal'): void {
    this.statusText.textContent = message;
    this.statusText.dataset.tone = tone;
  }

  setArenaSideWallsEnabled(enabled: boolean): void {
    this.sideWallsToggle.checked = enabled;
  }

  setFullscreenEnabled(enabled: boolean): void {
    this.fullscreenToggle.checked = enabled;
  }

  setVolume(volume: number): void {
    const normalizedVolume = Math.max(0, Math.min(1, volume));
    const percent = Math.round(normalizedVolume * 100);
    this.volumeSlider.value = String(percent);
    this.volumeValue.textContent = `${percent}%`;
  }

  setInputDelay(frames: number): void {
    this.inputDelaySelect.value = String(Math.max(0, Math.floor(frames)));
  }

  setForceRelay(enabled: boolean): void {
    this.forceRelayToggle.checked = enabled;
  }

  setInputScheme(scheme: InputScheme): void {
    this.inputSchemeSelect.value = scheme.id;
    this.renderInputBindings(scheme);
  }

  private renderInputBindings(scheme: InputScheme): void {
    const rows = scheme.bindings
      .map(
        (row) =>
          `<div class="input-bindings-row"><span class="input-bindings-action">${escapeHtml(row.action)}</span><span class="input-bindings-key">${escapeHtml(row.key)}</span></div>`,
      )
      .join('');
    this.inputBindingsList.innerHTML = rows;
  }

  destroy(): void {
    this.element.remove();
  }

  private static template(): string {
    return `
      <div class="overlay-card settings-menu-card" role="dialog" aria-label="Settings">
        <button id="settingsMenuCloseButton" class="overlay-close" type="button" aria-label="Close">&times;</button>
        <h2 class="overlay-title overlay-title--small">Settings</h2>

        <div class="overlay-grid">
          <label>
            <span>Your Peer ID</span>
            <output id="settingsMenuPeerId">-</output>
          </label>
          <label>
            <span>Room ID</span>
            <output id="settingsMenuRoomId">-</output>
          </label>
          <label>
            <span>Host Peer ID</span>
            <output id="settingsMenuHostId">-</output>
          </label>
          <label>
            <span>Selected Map</span>
            <output id="settingsMenuMapName">-</output>
          </label>
          <label>
            <span>Map Size</span>
            <output id="settingsMenuMapSize">-</output>
          </label>
        </div>

        <label class="share-field">
          <span>Shared Room URL</span>
          <div>
            <input id="settingsMenuShareUrl" type="text" readonly />
            <button id="settingsMenuCopyButton" type="button">Copy</button>
          </div>
        </label>

        <label class="toggle-field">
          <input id="settingsMenuSideWallsToggle" type="checkbox" />
          <span>Arena side walls (blocks walking off stage)</span>
        </label>

        <label class="toggle-field">
          <input id="settingsMenuFullscreenToggle" type="checkbox" />
          <span>Fullscreen mode</span>
        </label>

        <label class="range-field">
          <span>Master Volume <output id="settingsMenuVolumeValue">100%</output></span>
          <input id="settingsMenuVolumeSlider" type="range" min="0" max="100" step="1" value="100" />
        </label>

        <label class="select-field">
          <span>Input delay (frames)</span>
          <select id="settingsMenuInputDelaySelect">
            <option value="0">0 (lowest latency, most rollback)</option>
            <option value="1">1</option>
            <option value="2" selected>2 (recommended)</option>
            <option value="3">3</option>
            <option value="4">4</option>
          </select>
        </label>

        <label class="select-field">
          <span>Input scheme</span>
          <select id="settingsMenuInputSchemeSelect">
            ${Object.values(INPUT_SCHEMES)
              .map(
                (scheme) =>
                  `<option value="${escapeHtml(scheme.id)}">${escapeHtml(scheme.displayName)}</option>`,
              )
              .join('')}
          </select>
        </label>

        <div class="input-bindings" id="settingsMenuInputBindings"></div>

        <label class="toggle-field">
          <input id="settingsMenuForceRelayToggle" type="checkbox" />
          <span>Force relay mode (TURN-only; use on restrictive networks). Takes effect on next room join.</span>
        </label>

        <button id="settingsMenuLeaveButton" class="action-danger" type="button">Leave Room</button>

        <p id="settingsMenuStatus" data-tone="normal" class="overlay-status"></p>
      </div>
    `;
  }
}
