import type { MapManifest } from './tiledMap';
import type { StatusTone } from './MainMenu';

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

export interface SettingsMenuCallbacks {
  onLeave(): void;
  onCopyShareUrl(): void;
  onClose(): void;
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
    this.statusText = getElement<HTMLElement>(
      this.element,
      '#settingsMenuStatus',
    );

    this.leaveButton.addEventListener('click', () => callbacks.onLeave());
    this.copyButton.addEventListener('click', () => callbacks.onCopyShareUrl());
    this.closeButton.addEventListener('click', () => callbacks.onClose());

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

        <button id="settingsMenuLeaveButton" class="action-danger" type="button">Leave Room</button>

        <p id="settingsMenuStatus" data-tone="normal" class="overlay-status"></p>
      </div>
    `;
  }
}
