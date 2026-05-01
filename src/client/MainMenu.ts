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

export type StatusTone = 'normal' | 'error';

export interface MainMenuCallbacks {
  onHost(): void;
  onJoin(): void;
  onCopyShareUrl(): void;
}

export class MainMenu {
  private readonly element: HTMLElement;
  private readonly peerIdValue: HTMLElement;
  private readonly roomInput: HTMLInputElement;
  private readonly hostInput: HTMLInputElement;
  private readonly signalInput: HTMLInputElement;
  private readonly shareUrlInput: HTMLInputElement;
  private readonly hostButton: HTMLButtonElement;
  private readonly joinButton: HTMLButtonElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly statusText: HTMLElement;

  constructor(parent: HTMLElement, callbacks: MainMenuCallbacks) {
    this.element = document.createElement('div');
    this.element.className = 'overlay-backdrop main-menu';
    this.element.dataset.visible = 'true';
    this.element.innerHTML = MainMenu.template();
    parent.appendChild(this.element);

    this.peerIdValue = getElement<HTMLElement>(this.element, '#mainMenuPeerId');
    this.roomInput = getElement<HTMLInputElement>(
      this.element,
      '#mainMenuRoomInput',
    );
    this.hostInput = getElement<HTMLInputElement>(
      this.element,
      '#mainMenuHostInput',
    );
    this.signalInput = getElement<HTMLInputElement>(
      this.element,
      '#mainMenuSignalInput',
    );
    this.shareUrlInput = getElement<HTMLInputElement>(
      this.element,
      '#mainMenuShareUrl',
    );
    this.hostButton = getElement<HTMLButtonElement>(
      this.element,
      '#mainMenuHostButton',
    );
    this.joinButton = getElement<HTMLButtonElement>(
      this.element,
      '#mainMenuJoinButton',
    );
    this.copyButton = getElement<HTMLButtonElement>(
      this.element,
      '#mainMenuCopyButton',
    );
    this.statusText = getElement<HTMLElement>(this.element, '#mainMenuStatus');

    this.hostButton.addEventListener('click', () => callbacks.onHost());
    this.joinButton.addEventListener('click', () => callbacks.onJoin());
    this.copyButton.addEventListener('click', () => callbacks.onCopyShareUrl());
  }

  show(): void {
    this.element.dataset.visible = 'true';
  }

  hide(): void {
    this.element.dataset.visible = 'false';
  }

  setPeerId(id: string): void {
    this.peerIdValue.textContent = id;
  }

  getRoomId(): string {
    return this.roomInput.value.trim();
  }

  setRoomId(id: string): void {
    this.roomInput.value = id;
  }

  getHostPeerId(): string {
    return this.hostInput.value.trim();
  }

  setHostPeerId(id: string): void {
    this.hostInput.value = id;
  }

  getSignalUrl(): string {
    return this.signalInput.value.trim();
  }

  setSignalUrl(url: string): void {
    this.signalInput.value = url;
  }

  setShareUrl(url: string): void {
    this.shareUrlInput.value = url;
    this.copyButton.disabled = !url;
  }

  setStatus(message: string, tone: StatusTone = 'normal'): void {
    this.statusText.textContent = message;
    this.statusText.dataset.tone = tone;
  }

  setBusy(busy: boolean): void {
    this.hostButton.disabled = busy;
    this.joinButton.disabled = busy;
  }

  destroy(): void {
    this.element.remove();
  }

  private static template(): string {
    return `
      <div class="overlay-card main-menu-card">
        <p class="overlay-eyebrow">CS130 Multiplayer Baseline</p>
        <h1 class="overlay-title">Rollback Jump Arena</h1>
        <p class="overlay-subtitle">A tiny rollback-netcode platforming sandbox.</p>

        <ul class="controls-cheatsheet">
          <li><strong>A</strong> / <strong>&larr;</strong> &mdash; Move left</li>
          <li><strong>D</strong> / <strong>&rarr;</strong> &mdash; Move right</li>
          <li><strong>W</strong> / <strong>&uarr;</strong> / <strong>Space</strong> &mdash; Jump</li>
        </ul>

        <div class="overlay-grid">
          <label>
            <span>Your Peer ID</span>
            <output id="mainMenuPeerId"></output>
          </label>
          <label>
            <span>Room ID</span>
            <input id="mainMenuRoomInput" type="text" placeholder="room-xxxx" />
          </label>
        </div>

        <div class="overlay-actions">
          <button id="mainMenuHostButton" class="action-primary" type="button">Host Game</button>
          <button id="mainMenuJoinButton" class="action-secondary" type="button">Join Game</button>
        </div>

        <label class="share-field">
          <span>Shared Room URL</span>
          <div>
            <input id="mainMenuShareUrl" type="text" readonly placeholder="Host a game to generate" />
            <button id="mainMenuCopyButton" type="button">Copy</button>
          </div>
        </label>

        <details class="overlay-advanced">
          <summary>Advanced</summary>
          <div class="overlay-grid">
            <label>
              <span>Host Peer ID (optional)</span>
              <input id="mainMenuHostInput" type="text" placeholder="auto-resolved by signaling server" />
            </label>
            <label>
              <span>Signaling URL</span>
              <input id="mainMenuSignalInput" type="text" />
            </label>
          </div>
        </details>

        <p id="mainMenuStatus" data-tone="normal" class="overlay-status">Preparing game...</p>
      </div>
    `;
  }
}
