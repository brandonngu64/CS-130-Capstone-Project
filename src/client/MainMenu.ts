import type { PublicRoomSummary } from './SignalingClient';
import type { MapManifest } from './tiledMap';

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
  onHostPublic(): void;
  onHostPrivate(): void;
  onJoin(): void;
  onJoinPublicRoom(roomId: string): void;
  onBrowsePublic(): void;
  onCopyShareUrl(): void;
  onMapChange(mapId: string): void;
  onArenaSideWallsChange(enabled: boolean): void;
}

const REFRESH_RATE_LIMIT_MS = 2000;

export class MainMenu {
  private readonly element: HTMLElement;
  private readonly peerIdValue: HTMLElement;
  private readonly mapSelect: HTMLSelectElement;
  private readonly roomInput: HTMLInputElement;
  private readonly hostInput: HTMLInputElement;
  private readonly signalInput: HTMLInputElement;
  private readonly shareUrlInput: HTMLInputElement;
  private readonly hostPublicButton: HTMLButtonElement;
  private readonly hostPrivateButton: HTMLButtonElement;
  private readonly joinButton: HTMLButtonElement;
  private readonly browseButton: HTMLButtonElement;
  private readonly browseBackButton: HTMLButtonElement;
  private readonly browseRefreshButton: HTMLButtonElement;
  private readonly browseListEl: HTMLElement;
  private readonly browseStatusEl: HTMLElement;
  private readonly menuView: HTMLElement;
  private readonly browseView: HTMLElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly sideWallsToggle: HTMLInputElement;
  private readonly statusText: HTMLElement;
  private readonly callbacks: MainMenuCallbacks;

  private lastRefreshAt = 0;
  private refreshReenableTimer: number | null = null;

  constructor(parent: HTMLElement, callbacks: MainMenuCallbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement('div');
    this.element.className = 'overlay-backdrop main-menu';
    this.element.dataset.visible = 'true';
    this.element.innerHTML = MainMenu.template();
    parent.appendChild(this.element);

    this.peerIdValue = getElement<HTMLElement>(this.element, '#mainMenuPeerId');
    this.mapSelect = getElement<HTMLSelectElement>(this.element, '#mainMenuMapSelect');
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
    this.hostPublicButton = getElement<HTMLButtonElement>(
      this.element,
      '#mainMenuHostPublicButton',
    );
    this.hostPrivateButton = getElement<HTMLButtonElement>(
      this.element,
      '#mainMenuHostPrivateButton',
    );
    this.joinButton = getElement<HTMLButtonElement>(
      this.element,
      '#mainMenuJoinButton',
    );
    this.browseButton = getElement<HTMLButtonElement>(
      this.element,
      '#mainMenuBrowseButton',
    );
    this.browseBackButton = getElement<HTMLButtonElement>(
      this.element,
      '#mainMenuBrowseBackButton',
    );
    this.browseRefreshButton = getElement<HTMLButtonElement>(
      this.element,
      '#mainMenuBrowseRefreshButton',
    );
    this.browseListEl = getElement<HTMLElement>(
      this.element,
      '#mainMenuBrowseList',
    );
    this.browseStatusEl = getElement<HTMLElement>(
      this.element,
      '#mainMenuBrowseStatus',
    );
    this.menuView = getElement<HTMLElement>(this.element, '#mainMenuView');
    this.browseView = getElement<HTMLElement>(this.element, '#mainMenuBrowseView');
    this.copyButton = getElement<HTMLButtonElement>(
      this.element,
      '#mainMenuCopyButton',
    );
    this.statusText = getElement<HTMLElement>(this.element, '#mainMenuStatus');
    this.sideWallsToggle = getElement<HTMLInputElement>(
      this.element,
      '#mainMenuSideWallsToggle',
    );

    this.hostPublicButton.addEventListener('click', () => callbacks.onHostPublic());
    this.hostPrivateButton.addEventListener('click', () => callbacks.onHostPrivate());
    this.joinButton.addEventListener('click', () => callbacks.onJoin());
    this.browseButton.addEventListener('click', () => this.openBrowse());
    this.browseBackButton.addEventListener('click', () => this.closeBrowse());
    this.browseRefreshButton.addEventListener('click', () => this.requestRefresh());
    this.copyButton.addEventListener('click', () => callbacks.onCopyShareUrl());
    this.mapSelect.addEventListener('change', () => {
      callbacks.onMapChange(this.mapSelect.value);
    });

    this.sideWallsToggle.addEventListener('change', () => {
      callbacks.onArenaSideWallsChange(this.sideWallsToggle.checked);
    });

    this.setBrowseView(false);
    this.renderRooms([]);
  }

  show(): void {
    this.element.dataset.visible = 'true';
  }

  hide(): void {
    this.element.dataset.visible = 'false';
    this.setBrowseView(false);
  }

  setPeerId(id: string): void {
    this.peerIdValue.textContent = id;
  }

  setMaps(maps: MapManifest[], selectedMapId: string): void {
    this.mapSelect.innerHTML = '';

    for (const map of maps) {
      const option = document.createElement('option');
      option.value = map.id;
      option.textContent = map.name;
      this.mapSelect.appendChild(option);
    }

    this.mapSelect.value = selectedMapId;
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
    this.hostPublicButton.disabled = busy;
    this.hostPrivateButton.disabled = busy;
    this.joinButton.disabled = busy;
    this.browseButton.disabled = busy;
  }

  setMapSelectionEnabled(enabled: boolean): void {
    this.mapSelect.disabled = !enabled;
  }

  setArenaSideWallsEnabled(enabled: boolean): void {
    this.sideWallsToggle.checked = enabled;
  }

  setPublicRooms(rooms: PublicRoomSummary[]): void {
    this.renderRooms(rooms);
    if (rooms.length === 0) {
      this.browseStatusEl.textContent = 'No public games right now. Be the first!';
    } else {
      this.browseStatusEl.textContent = `${rooms.length} public game${rooms.length === 1 ? '' : 's'} available.`;
    }
    this.browseStatusEl.dataset.tone = 'normal';
  }

  setBrowseStatus(message: string, tone: StatusTone = 'normal'): void {
    this.browseStatusEl.textContent = message;
    this.browseStatusEl.dataset.tone = tone;
  }

  destroy(): void {
    if (this.refreshReenableTimer !== null) {
      window.clearTimeout(this.refreshReenableTimer);
      this.refreshReenableTimer = null;
    }
    this.element.remove();
  }

  private openBrowse(): void {
    this.setBrowseView(true);
    this.callbacks.onBrowsePublic();
    this.requestRefresh();
  }

  private closeBrowse(): void {
    this.setBrowseView(false);
  }

  private setBrowseView(showBrowse: boolean): void {
    this.menuView.dataset.visible = showBrowse ? 'false' : 'true';
    this.browseView.dataset.visible = showBrowse ? 'true' : 'false';
  }

  // Client-side rate limit: at most one server query per REFRESH_RATE_LIMIT_MS.
  private requestRefresh(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefreshAt;
    if (elapsed < REFRESH_RATE_LIMIT_MS) {
      return;
    }
    this.lastRefreshAt = now;
    this.callbacks.onBrowsePublic();
    this.browseRefreshButton.disabled = true;
    if (this.refreshReenableTimer !== null) {
      window.clearTimeout(this.refreshReenableTimer);
    }
    this.refreshReenableTimer = window.setTimeout(() => {
      this.browseRefreshButton.disabled = false;
      this.refreshReenableTimer = null;
    }, REFRESH_RATE_LIMIT_MS);
  }

  private renderRooms(rooms: PublicRoomSummary[]): void {
    this.browseListEl.innerHTML = '';
    for (const room of rooms) {
      const row = document.createElement('div');
      row.className = 'browse-row';

      const info = document.createElement('div');
      info.className = 'browse-row-info';

      const name = document.createElement('strong');
      name.textContent = room.hostName || room.roomId;
      info.appendChild(name);

      const meta = document.createElement('span');
      const parts: string[] = [`${room.playerCount}/${room.maxPlayers}`];
      if (room.gameMode) parts.push(room.gameMode);
      if (room.mapId) parts.push(room.mapId);
      meta.textContent = parts.join(' · ');
      info.appendChild(meta);

      const joinBtn = document.createElement('button');
      joinBtn.type = 'button';
      joinBtn.className = 'action-secondary';
      joinBtn.textContent = 'Join';
      joinBtn.addEventListener('click', () => {
        this.callbacks.onJoinPublicRoom(room.roomId);
      });

      row.appendChild(info);
      row.appendChild(joinBtn);
      this.browseListEl.appendChild(row);
    }
  }

  private static template(): string {
    return `
      <div class="overlay-card main-menu-card">
        <div id="mainMenuView" data-visible="true">
          <p class="overlay-eyebrow">CS130 - Project Group 9</p>
          <h1 class="overlay-title">Academic Arena</h1>
          <p class="overlay-subtitle">Multiplayer Platform Fighting Game</p>

          <ul class="controls-cheatsheet">
            <li><strong>A</strong> / <strong>&larr;</strong> &mdash; Move left</li>
            <li><strong>D</strong> / <strong>&rarr;</strong> &mdash; Move right</li>
            <li><strong>W</strong> / <strong>&uarr;</strong> / <strong>Space</strong> &mdash; Jump</li>
            <li><strong>S</strong> / <strong>&darr;</strong> &mdash; Duck / drop through platforms</li>
          </ul>

          <div class="overlay-grid">
            <label>
              <span>Your Peer ID</span>
              <output id="mainMenuPeerId"></output>
            </label>
            <label>
              <span>Map</span>
              <select id="mainMenuMapSelect"></select>
            </label>
            <label>
              <span>Room ID</span>
              <input id="mainMenuRoomInput" type="text" placeholder="room-xxxx" />
            </label>
          </div>

          <div class="overlay-actions">
            <button id="mainMenuHostPublicButton" class="action-primary" type="button">Host Public Game</button>
            <button id="mainMenuHostPrivateButton" class="action-primary" type="button">Host Private Game</button>
            <button id="mainMenuJoinButton" class="action-secondary" type="button">Join Game</button>
            <button id="mainMenuBrowseButton" class="action-secondary" type="button">Browse Public Games</button>
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
              <label class="toggle-field">
                <input id="mainMenuSideWallsToggle" type="checkbox" />
                <span>Arena side walls (blocks walking off stage)</span>
              </label>
            </div>
          </details>

          <p id="mainMenuStatus" data-tone="normal" class="overlay-status">Preparing game...</p>
        </div>

        <div id="mainMenuBrowseView" data-visible="false">
          <h1 class="overlay-title">Public Games</h1>
          <p id="mainMenuBrowseStatus" data-tone="normal" class="overlay-status">Loading...</p>
          <div id="mainMenuBrowseList" class="browse-list"></div>
          <div class="overlay-actions">
            <button id="mainMenuBrowseRefreshButton" class="action-secondary" type="button">Refresh</button>
            <button id="mainMenuBrowseBackButton" class="action-secondary" type="button">Back</button>
          </div>
        </div>
      </div>
    `;
  }
}
