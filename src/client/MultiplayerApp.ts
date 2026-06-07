import * as RAPIER from '@dimforge/rapier2d-compat';
import {
  SessionState,
  Topology,
  WebRTCTransport,
  createSession,
  type InputPredictor,
  type PlayerId,
  type Session,
  type SignalMessage,
  type TickResult,
} from 'rollback-netcode';
import {
  CHARACTER_DISPLAY_NAMES,
  CHARACTER_IDS,
  MAX_PLAYERS,
  TICK_RATE,
  type CharacterId,
  isCharacterId,
} from './constants';
import { defaultCharacterForPlayer, getCharacterPreviewUrl } from './CharacterSprites';
import { GameRenderer } from './GameRenderer';
import type { CameraMode } from './GameRenderer';
import { HealthBarOverlay } from './HealthBarOverlay';
import { MainMenu, type StatusTone } from './MainMenu';
import { LeavingManager } from './LeavingManager';
import { claimPeerId, type PeerIdClaim } from './PeerIdClaim';
import { RollbackPhysicsGame } from './RollbackPhysicsGame';
import { SettingsMenu } from './SettingsMenu';
import { SignalingClient, type ServerToClientMessage } from './SignalingClient';
import { StockHud } from './StockHud';
import { encodeInput } from './input';
import { AVAILABLE_MAPS, DEFAULT_MAP_ID, loadMapDefinition } from './tiledMap';

type DebugCounters = {
  rollbackCount: number;
  rollbackTicks: number;
  desyncCount: number;
  errorCount: number;
};

type InputState = {
  left: boolean;
  right: boolean;
  jump: boolean;
  duck: boolean;
  punch: boolean;
  dash: boolean;
  shoot: boolean;
};

type RecoveryMode = 'host' | 'join';

type RecoveryState = {
  roomId: string;
  hostPeerId: string;
  mode: RecoveryMode;
  mapId: string;
  signalUrl: string;
};

const PEER_ID_STORAGE_KEY = 'cs130-peer-id';
const ROOM_DISCONNECT_GRACE_MS = 10000;
const WEBSOCKET_KEEPALIVE_INTERVAL_MS = 10000;
const WEBSOCKET_KEEPALIVE_TIMEOUT_MS = 10000;
const WEBSOCKET_CONNECTION_TIMEOUT_MS = 10000;
const SIGNALING_RECONNECT_BASE_DELAY_MS = 10000;
const SIGNALING_RECONNECT_MAX_DELAY_MS = 10000;
const SIGNALING_RECONNECT_MAX_ATTEMPTS = 15;
const ROOM_RECOVERY_STORAGE_KEY = 'cs130-room-recovery';
const INPUT_DELAY_STORAGE_KEY = 'cs130-input-delay';
const FORCE_RELAY_STORAGE_KEY = 'cs130-force-relay';
const DEFAULT_INPUT_DELAY_FRAMES = 2;
const MAX_INPUT_DELAY_FRAMES = 6;

const GAME_THEME_URL = new URL('../assets/sounds/game_theme.mp3', import.meta.url).href;
const MENU_THEME_URL = new URL('../assets/sounds/menu.mp3', import.meta.url).href;
const FIGHT_START_SOUND_URL = new URL('../assets/sounds/fight_start.wav', import.meta.url).href;

function requireElement<T extends HTMLElement>(
  parent: ParentNode,
  selector: string,
): T {
  const element = parent.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

function isArrowKey(code: string): boolean {
  return (
    code === 'ArrowLeft' ||
    code === 'ArrowRight' ||
    code === 'ArrowUp' ||
    code === 'ArrowDown'
  );
}

function cameraModeLabel(mode: CameraMode): string {
  switch (mode) {
    case 'follow':
      return 'Follow';
    case 'free':
      return 'Free';
    case 'action':
      return 'Action';
    default:
      return 'Follow';
  }
}

function readStoredPeerId(): string | null {
  try {
    const stored = globalThis.sessionStorage?.getItem(PEER_ID_STORAGE_KEY);
    return stored && stored.trim().length > 0 ? stored.trim() : null;
  } catch {
    return null;
  }
}

function storePeerId(peerId: string): void {
  try {
    globalThis.sessionStorage?.setItem(PEER_ID_STORAGE_KEY, peerId);
    globalThis.localStorage?.removeItem(PEER_ID_STORAGE_KEY);
  } catch {
    // Ignore storage failures and continue with the in-memory peer id.
  }
}

function readStoredRecoveryState(): RecoveryState | null {
  try {
    const raw = globalThis.localStorage?.getItem(ROOM_RECOVERY_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<RecoveryState>;
    if (
      parsed.mode !== 'host' &&
      parsed.mode !== 'join' ||
      typeof parsed.roomId !== 'string' ||
      typeof parsed.hostPeerId !== 'string' ||
      typeof parsed.signalUrl !== 'string'
    ) {
      return null;
    }

    return {
      mapId: typeof parsed.mapId === 'string' ? parsed.mapId : DEFAULT_MAP_ID,
      mode: parsed.mode,
      roomId: parsed.roomId,
      hostPeerId: parsed.hostPeerId,
      signalUrl: parsed.signalUrl,
    };
  } catch {
    return null;
  }
}

function storeRecoveryState(state: RecoveryState): void {
  try {
    globalThis.localStorage?.setItem(ROOM_RECOVERY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures and keep recovery state in memory only.
  }
}

function clearStoredRecoveryState(): void {
  try {
    globalThis.localStorage?.removeItem(ROOM_RECOVERY_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function readStoredInputDelayFrames(): number {
  try {
    const raw = globalThis.localStorage?.getItem(INPUT_DELAY_STORAGE_KEY);
    if (raw === null || raw === undefined) {
      return DEFAULT_INPUT_DELAY_FRAMES;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_INPUT_DELAY_FRAMES;
    }
    return Math.max(0, Math.min(parsed, MAX_INPUT_DELAY_FRAMES));
  } catch {
    return DEFAULT_INPUT_DELAY_FRAMES;
  }
}

function storeInputDelayFrames(frames: number): void {
  try {
    globalThis.localStorage?.setItem(INPUT_DELAY_STORAGE_KEY, String(frames));
  } catch {
    // Ignore storage failures.
  }
}

function readStoredForceRelay(): boolean {
  try {
    return globalThis.localStorage?.getItem(FORCE_RELAY_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function storeForceRelay(enabled: boolean): void {
  try {
    if (enabled) {
      globalThis.localStorage?.setItem(FORCE_RELAY_STORAGE_KEY, '1');
    } else {
      globalThis.localStorage?.removeItem(FORCE_RELAY_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures.
  }
}

function sessionStateLabel(state: SessionState): string {
  switch (state) {
    case SessionState.Disconnected:
      return 'Disconnected';
    case SessionState.Connecting:
      return 'Connecting';
    case SessionState.Lobby:
      return 'Lobby';
    case SessionState.Playing:
      return 'Playing';
    case SessionState.Paused:
      return 'Paused';
    default:
      return 'Unknown';
  }
}

function generateFreshPeerId(): string {
  const cryptoApi = globalThis.crypto;

  if (cryptoApi?.randomUUID) {
    return `peer-${cryptoApi.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }

  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(8);
    cryptoApi.getRandomValues(bytes);
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    return `peer-${hex}`;
  }

  const high = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  const low = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `peer-${high}${low}`;
}

function summarizeIceTransport(report: RTCStatsReport): string | null {
  let nominatedPair: RTCIceCandidatePairStats | null = null;
  for (const stat of report.values()) {
    if (stat.type !== 'candidate-pair') {
      continue;
    }
    const pair = stat as RTCIceCandidatePairStats & { selected?: boolean; nominated?: boolean };
    if (pair.state === 'succeeded' && (pair.selected === true || pair.nominated === true)) {
      nominatedPair = pair;
      break;
    }
  }
  if (!nominatedPair) {
    return null;
  }
  const localId = (nominatedPair as { localCandidateId?: string }).localCandidateId;
  if (!localId) {
    return null;
  }
  const local = report.get(localId) as
    | (RTCStats & { candidateType?: string; protocol?: string })
    | undefined;
  const candidateType = local?.candidateType;
  switch (candidateType) {
    case 'host':
      return 'direct (local network)';
    case 'srflx':
    case 'prflx':
      return 'direct P2P via STUN';
    case 'relay':
      return 'relayed via TURN (extra latency)';
    default:
      return candidateType ? `via ${candidateType}` : null;
  }
}

function makePeerId(): string {
  // Only reuse a stored peer id when we are actively in a recovery flow.
  // sessionStorage is copied by "Duplicate Tab" in Chromium browsers, so
  // unconditional reuse caused the two-browsers-on-one-machine collision.
  const recovery = readStoredRecoveryState();
  if (recovery) {
    const storedPeerId = readStoredPeerId();
    if (storedPeerId) {
      return storedPeerId;
    }
  }

  const peerId = generateFreshPeerId();
  storePeerId(peerId);
  return peerId;
}

class RepeatLastInputPredictor implements InputPredictor<Uint8Array> {
  private readonly lastPredicted = new Map<string, Uint8Array>();

  predict(playerId: string, _tick: number, lastConfirmed: Uint8Array | undefined): Uint8Array {
    if (lastConfirmed && lastConfirmed.length > 0) {
      const copy = new Uint8Array(lastConfirmed);
      this.lastPredicted.set(playerId, copy);
      return copy;
    }

    const previous = this.lastPredicted.get(playerId);
    if (previous) {
      return new Uint8Array(previous);
    }

    return new Uint8Array([0]);
  }
}

export class MultiplayerApp {
  private readonly root: HTMLElement;
  private readonly availableMaps = [...AVAILABLE_MAPS];
  private selectedMapId = DEFAULT_MAP_ID;
  private mapDefinition = loadMapDefinition(this.selectedMapId);
  private readonly viewport: HTMLElement;
  private renderer: GameRenderer;

  private peerId: string;
  private readonly peerIdClaim: PeerIdClaim;
  private readonly mainMenu: MainMenu;
  private readonly settingsMenu: SettingsMenu;
  private readonly stockHud: StockHud;

  private readonly gameHud: HTMLElement;
  private readonly statusBadge: HTMLElement;
  private readonly startGameButton: HTMLButtonElement;
  private readonly lobbyOverlay: HTMLElement;
  private readonly lobbyPlayersList: HTMLElement;
  private readonly lobbyCharacterGrid: HTMLElement;
  private readonly lobbyReadyButton: HTMLButtonElement;
  private readonly lobbyLeaveButton: HTMLButtonElement;
  private readonly lobbyCopyButton: HTMLButtonElement;
  private readonly lobbyRoomIdValue: HTMLElement;
  private readonly lobbyShareUrlValue: HTMLInputElement;
  private readonly leaveButton: HTMLButtonElement;
  private readonly cameraToggleButton: HTMLButtonElement;
  private readonly settingsToggleButton: HTMLButtonElement;
  private readonly healthBarOverlay: HealthBarOverlay;
  private readonly winnerBanner: HTMLElement;
  private readonly winnerBannerTitle: HTMLElement;
  private readonly winnerBannerSubtitle: HTMLElement;
  private readonly roundStartBanner: HTMLElement;
  private readonly gameThemeAudio: HTMLAudioElement;
  private readonly menuThemeAudio: HTMLAudioElement;

  private readonly tickValue: HTMLElement;
  private readonly confirmedTickValue: HTMLElement;
  private readonly rollbackCountValue: HTMLElement;
  private readonly rollbackTicksValue: HTMLElement;
  private readonly desyncCountValue: HTMLElement;
  private readonly peerCountValue: HTMLElement;
  private readonly playerCountValue: HTMLElement;
  private readonly rttValue: HTMLElement;

  private netCountersPanel!: HTMLElement;
  private debugConsolePanel!: HTMLElement;
  private debugConsoleLog!: HTMLElement;
  private toggleNetCountersBtn!: HTMLButtonElement;
  private toggleDebugConsoleBtn!: HTMLButtonElement;

  private signaling: SignalingClient | null = null;
  private transport: WebRTCTransport | null = null;
  private session: Session | null = null;
  private game: RollbackPhysicsGame | null = null;

  private roomId: string | null = null;
  private hostPeerId: string | null = null;
  private readonly lobbyMembers = new Set<string>();
  private readonly lobbyReadyByPeer = new Map<string, boolean>();
  private readonly lobbyCharacterByPeer = new Map<string, CharacterId>();
  private currentShareUrl = '';
  private settingsOpen = false;
  private cameraMode: CameraMode = 'follow';
  private masterVolume = 1;
  private inputDelayFrames = readStoredInputDelayFrames();
  private readonly inputDelayBuffer: Uint8Array[] = [];
  private localTickIndex = 0;
  private forceRelay = readStoredForceRelay();
  private readonly cameraPanInput = {
    left: false,
    right: false,
    up: false,
    down: false,
    zoomin: false,
    zoomout: false,
  };
  private readonly cameraMoveSpeed = 8;

  private readonly inputState: InputState = {
    left: false,
    right: false,
    jump: false,
    duck: false,
    punch: false,
    dash: false,
    shoot: false,
  };

  private readonly debugCounters: DebugCounters = {
    rollbackCount: 0,
    rollbackTicks: 0,
    desyncCount: 0,
    errorCount: 0,
  };

  private recoveryState: RecoveryState | null = null;
  private reconnectTimerId: number | null = null;
  private reconnectAttempt = 0;
  private reconnectingSignaling = false;
  private leavingManager: LeavingManager | null = null;
  private isCleaningUp = false;
  private respawnCameraLocked = false;

  private unsubscribeSignalMessages: (() => void) | null = null;
  private unsubscribeSignalClose: (() => void) | null = null;

  private animationFrameId = 0;
  private fixedStepMs = 1000 / TICK_RATE;
  private lastFrameTimeMs = 0;
  private accumulatedTimeMs = 0;
  private connecting = false;
  private gameThemeStarted = false;
  private menuThemeStarted = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'KeyC') {
      event.preventDefault();
      if (this.isInRoom() || this.connecting) {
        this.toggleCameraMode();
      }
      return;
    }

    if (this.cameraMode === 'free' && isArrowKey(event.code)) {
      event.preventDefault();
      if (event.code === 'ArrowLeft') {
        this.cameraPanInput.left = true;
      } else if (event.code === 'ArrowRight') {
        this.cameraPanInput.right = true;
      } else if (event.code === 'ArrowUp') {
        this.cameraPanInput.up = true;
      } else if (event.code === 'ArrowDown') {
        this.cameraPanInput.down = true;
      }
      return;
    }

    if (this.cameraMode === 'free' && (event.code === 'Minus' || event.code === 'Equal')) {
      event.preventDefault();
      if (event.code === 'Minus') {
        this.cameraPanInput.zoomout = true;
      } else {
        this.cameraPanInput.zoomin = true;
      }
      return;
    }

    if (
      event.code === 'ArrowLeft' ||
      event.code === 'KeyA' ||
      event.code === 'ArrowRight' ||
      event.code === 'KeyD' ||
      event.code === 'ArrowUp' ||
      event.code === 'KeyW' ||
      event.code === 'Space' ||
      event.code === 'ArrowDown' ||
      event.code === 'KeyS' ||
      event.code === 'KeyU' ||
      event.code === 'ShiftLeft' ||
      event.code === 'ShiftRight'
    ) {
      event.preventDefault();
    }

    if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
      this.inputState.left = true;
    }
    if (event.code === 'ArrowRight' || event.code === 'KeyD') {
      this.inputState.right = true;
    }
    if (event.code === 'ArrowUp' || event.code === 'KeyW') {
      this.inputState.jump = true;
    }
    if (event.code === 'ArrowDown' || event.code === 'KeyS') {
      this.inputState.duck = true;
    }
    if (event.code === 'KeyU') {
      this.inputState.punch = true;
    }
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      this.inputState.dash = true;
    }

    if (event.code === 'Escape') {
      this.toggleSettings();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (this.cameraMode === 'free' && isArrowKey(event.code)) {
      if (event.code === 'ArrowLeft') {
        this.cameraPanInput.left = false;
      } else if (event.code === 'ArrowRight') {
        this.cameraPanInput.right = false;
      } else if (event.code === 'ArrowUp') {
        this.cameraPanInput.up = false;
      } else if (event.code === 'ArrowDown') {
        this.cameraPanInput.down = false;
      }
      return;
    }

    if (this.cameraMode === 'free' && (event.code === 'Minus' || event.code === 'Equal')) {
      if (event.code === 'Minus') {
        this.cameraPanInput.zoomout = false;
      } else {
        this.cameraPanInput.zoomin = false;
      }
      return;
    }

    if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
      this.inputState.left = false;
    }
    if (event.code === 'ArrowRight' || event.code === 'KeyD') {
      this.inputState.right = false;
    }
    if (event.code === 'ArrowUp' || event.code === 'KeyW') {
      this.inputState.jump = false;
    }
    if (event.code === 'ArrowDown' || event.code === 'KeyS') {
      this.inputState.duck = false;
    }
    if (event.code === 'KeyU') {
      this.inputState.punch = false;
    }
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      this.inputState.dash = false;
    }
  };

  constructor(root: HTMLElement) {
    this.root = root;
    this.peerId = makePeerId();
    this.peerIdClaim = claimPeerId(this.peerId, () => {
      const replacement = generateFreshPeerId();
      storePeerId(replacement);
      return replacement;
    });

    this.root.innerHTML = this.renderAppTemplate();

    this.viewport = requireElement<HTMLElement>(this.root, '#viewport');
    this.renderer = new GameRenderer(this.viewport, this.mapDefinition);
    this.stockHud = new StockHud(this.viewport);

    this.gameHud = requireElement<HTMLElement>(this.root, '#gameHud');
    this.statusBadge = requireElement<HTMLElement>(this.root, '#statusBadge');
    this.startGameButton = requireElement<HTMLButtonElement>(this.root, '#startGameButton');
    this.lobbyOverlay = requireElement<HTMLElement>(this.root, '#lobbyOverlay');
    this.lobbyPlayersList = requireElement<HTMLElement>(this.root, '#lobbyPlayersList');
    this.lobbyCharacterGrid = requireElement<HTMLElement>(this.root, '#lobbyCharacterGrid');
    this.lobbyReadyButton = requireElement<HTMLButtonElement>(this.root, '#lobbyReadyButton');
    this.lobbyLeaveButton = requireElement<HTMLButtonElement>(this.root, '#lobbyLeaveButton');
    this.lobbyCopyButton = requireElement<HTMLButtonElement>(this.root, '#lobbyCopyButton');
    this.lobbyRoomIdValue = requireElement<HTMLElement>(this.root, '#lobbyRoomIdValue');
    this.lobbyShareUrlValue = requireElement<HTMLInputElement>(this.root, '#lobbyShareUrlValue');
    this.leaveButton = requireElement<HTMLButtonElement>(
      this.root,
      '#leaveButton',
    );
    this.settingsToggleButton = requireElement<HTMLButtonElement>(
      this.root,
      '#settingsToggleButton',
    );
    this.cameraToggleButton = requireElement<HTMLButtonElement>(
      this.root,
      '#cameraModeButton',
    );
    this.healthBarOverlay = new HealthBarOverlay(this.gameHud);

    this.winnerBanner = document.createElement('div');
    this.winnerBanner.className = 'winner-banner';
    this.winnerBanner.dataset.visible = 'false';
    this.winnerBannerTitle = document.createElement('div');
    this.winnerBannerTitle.className = 'winner-banner__title';
    this.winnerBannerSubtitle = document.createElement('div');
    this.winnerBannerSubtitle.className = 'winner-banner__subtitle';
    this.winnerBanner.appendChild(this.winnerBannerTitle);
    this.winnerBanner.appendChild(this.winnerBannerSubtitle);
    this.viewport.appendChild(this.winnerBanner);

    this.roundStartBanner = document.createElement('div');
    this.roundStartBanner.className = 'round-start-banner';
    this.roundStartBanner.dataset.visible = 'false';
    this.viewport.appendChild(this.roundStartBanner);

    this.tickValue = requireElement<HTMLElement>(this.root, '#tickValue');
    this.confirmedTickValue = requireElement<HTMLElement>(
      this.root,
      '#confirmedTickValue',
    );
    this.rollbackCountValue = requireElement<HTMLElement>(
      this.root,
      '#rollbackCountValue',
    );
    this.rollbackTicksValue = requireElement<HTMLElement>(
      this.root,
      '#rollbackTicksValue',
    );
    this.desyncCountValue = requireElement<HTMLElement>(
      this.root,
      '#desyncCountValue',
    );
    this.peerCountValue = requireElement<HTMLElement>(this.root, '#peerCountValue');
    this.playerCountValue = requireElement<HTMLElement>(
      this.root,
      '#playerCountValue',
    );
    this.rttValue = requireElement<HTMLElement>(this.root, '#rttValue');

    this.netCountersPanel = requireElement<HTMLElement>(this.root, '#netCountersPanel');
    this.debugConsolePanel = requireElement<HTMLElement>(this.root, '#debugConsolePanel');
    this.debugConsoleLog = requireElement<HTMLElement>(this.root, '#debugConsoleLog');
    this.toggleNetCountersBtn = requireElement<HTMLButtonElement>(this.root, '#toggleNetCounters');
    this.toggleDebugConsoleBtn = requireElement<HTMLButtonElement>(this.root, '#toggleDebugConsole');

    this.bindDebugToggleButtons();

    this.mainMenu = new MainMenu(this.viewport, {
      onHost: () => {
        void this.handleHostRoom();
      },
      onJoin: () => {
        void this.handleJoinRoom();
      },
      onCopyShareUrl: () => {
        void this.copyShareLink();
      },
      onMapChange: (mapId: string) => {
        this.setSelectedMap(mapId);
      },
      onArenaSideWallsChange: (enabled) => {
        this.applyArenaSideWalls(enabled);
      },
    });

    this.mainMenu.setMaps(this.availableMaps, this.selectedMapId);

    this.settingsMenu = new SettingsMenu(this.viewport, {
      onLeave: () => {
        this.leaveRoom();
      },
      onCopyShareUrl: () => {
        void this.copyShareLink();
      },
      onClose: () => {
        this.settingsOpen = false;
        this.updateUiState();
      },
      onArenaSideWallsChange: (enabled) => {
        this.applyArenaSideWalls(enabled);
      },
      onFullscreenChange: (enabled) => {
        this.toggleFullscreen(enabled);
      },
      onVolumeChange: (volume) => {
        this.setMasterVolume(volume);
      },
      onInputDelayChange: (frames) => {
        this.setInputDelayFrames(frames);
      },
      onForceRelayChange: (enabled) => {
        this.setForceRelay(enabled);
      },
    });

    document.addEventListener('fullscreenchange', this.onFullscreenStateChange);

    this.mainMenu.setPeerId(this.peerId);
    this.mainMenu.setSignalUrl(this.defaultSignalUrl());
    this.settingsMenu.setPeerId(this.peerId);
    this.settingsMenu.setMap(this.getSelectedMapManifest());
    this.settingsMenu.setVolume(this.masterVolume);
    this.settingsMenu.setInputDelay(this.inputDelayFrames);
    this.settingsMenu.setForceRelay(this.forceRelay);

    this.renderer.setCameraMode(this.cameraMode);
    this.updateCameraButton();

    this.leaveButton.addEventListener('click', () => {
      this.leaveRoom();
    });
    this.settingsToggleButton.addEventListener('click', () => {
      this.toggleSettings();
    });
    this.cameraToggleButton.addEventListener('click', () => {
      this.toggleCameraMode();
    });
    this.startGameButton.addEventListener('click', () => {
      this.handleStartGame();
    });
    this.lobbyReadyButton.addEventListener('click', () => {
      this.toggleLocalLobbyReady();
    });
    this.lobbyLeaveButton.addEventListener('click', () => {
      this.leaveRoom();
    });
    this.lobbyCopyButton.addEventListener('click', () => {
      void this.copyShareLink();
    });
    this.lobbyCharacterGrid.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
        '[data-character-id]',
      );
      if (!target || target.disabled) {
        return;
      }
      const characterId = target.dataset.characterId;
      if (characterId && isCharacterId(characterId)) {
        this.selectLocalCharacter(characterId);
      }
    });

    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);

    this.updateUiState();
    this.refreshDebugValues();
    this.setStatus('Initializing Rapier runtime...');

    // Initialize looping audio tracks
    this.gameThemeAudio = new Audio(GAME_THEME_URL);
    this.gameThemeAudio.loop = true;
    this.gameThemeAudio.volume = this.masterVolume * 0.15;

    this.menuThemeAudio = new Audio(MENU_THEME_URL);
    this.menuThemeAudio.loop = true;
    this.menuThemeAudio.volume = this.masterVolume * 0.2;
  }

  async start(): Promise<void> {
    await RAPIER.init();

    // Wait for the peer-id claim arbiter to resolve any duplicate-tab
    // collision before doing anything network-facing.
    const resolvedPeerId = await this.peerIdClaim.resolved;
    if (resolvedPeerId !== this.peerId) {
      this.peerId = resolvedPeerId;
      this.mainMenu.setPeerId(this.peerId);
      this.settingsMenu.setPeerId(this.peerId);
    }

    const currentUrl = new URL(window.location.href);
    const storedRecovery = readStoredRecoveryState();
    const mapId = currentUrl.searchParams.get('map') ?? storedRecovery?.mapId ?? null;
    if (mapId) {
      this.setSelectedMap(mapId);
    }

    if (!this.game) {
      this.game = new RollbackPhysicsGame(this.mapDefinition);
    }

    this.setStatus('Ready. Host a room or join from a shared URL.');
    this.statusBadge.textContent = sessionStateLabel(SessionState.Disconnected);

    this.lastFrameTimeMs = performance.now();
    this.animationFrameId = requestAnimationFrame(this.onFrame);

    let roomId = currentUrl.searchParams.get('room');
    let hostPeer = currentUrl.searchParams.get('host');
    let signalUrl = currentUrl.searchParams.get('signal');

    if (!roomId && storedRecovery) {
      roomId = storedRecovery.roomId;
      hostPeer = storedRecovery.hostPeerId;
      signalUrl = storedRecovery.signalUrl;
    }

    if (roomId && !hostPeer && storedRecovery?.roomId === roomId) {
      hostPeer = storedRecovery.hostPeerId;
    }

    if (roomId) {
      this.mainMenu.setRoomId(roomId);
    }
    if (hostPeer) {
      this.mainMenu.setHostPeerId(hostPeer);
    }
    if (signalUrl) {
      this.mainMenu.setSignalUrl(signalUrl);
    }

    if (roomId && hostPeer) {
      if (hostPeer === this.peerId) {
        this.setStatus('Detected host room URL. Attempting recovery...');
        await this.handleHostRoom(roomId);
      } else {
        this.setStatus('Detected room URL. Attempting to join...');
        await this.handleJoinRoom();
      }
    }
  }

  dispose(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = 0;
    }

    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('fullscreenchange', this.onFullscreenStateChange);

    this.cleanupNetworking();
    this.mainMenu.destroy();
    this.settingsMenu.destroy();
    this.stockHud.destroy();
    this.healthBarOverlay.dispose();
    this.renderer.dispose();

    if (this.game) {
      this.game.reset();
      this.game = null;
    }
  }

  private readonly onFrame = (timestampMs: number): void => {
    const frameDelta = Math.min(100, timestampMs - this.lastFrameTimeMs);
    this.lastFrameTimeMs = timestampMs;
    this.accumulatedTimeMs += frameDelta;

    while (this.accumulatedTimeMs >= this.fixedStepMs) {
      this.tickSimulation();
      this.accumulatedTimeMs -= this.fixedStepMs;
    }

    const isPlaying = this.session?.state === SessionState.Playing;
    if (isPlaying) {
      if (!this.gameThemeStarted) {
        this.gameThemeStarted = true;
        this.menuThemeStarted = false;
        this.menuThemeAudio.pause();
        this.gameThemeAudio.currentTime = 0;
        void this.gameThemeAudio.play().catch((err) => {
          console.warn('Game theme could not play:', err);
        });
      }
    } else {
      if (!this.menuThemeStarted) {
        this.menuThemeStarted = true;
        this.gameThemeStarted = false;
        this.gameThemeAudio.pause();
        this.gameThemeAudio.currentTime = 0;
        void this.menuThemeAudio.play().catch((err) => {
          console.warn('Menu theme could not play:', err);
        });
      }
    }

    if (this.cameraMode === 'free') {
      this.updateFreeCamera(frameDelta / 1000);
    }

    if (this.game) {
      const renderDelaySeconds = this.accumulatedTimeMs / 1000;
      const renderState = this.game.getRenderState(renderDelaySeconds);
      this.renderer.render(renderState, this.peerId);
      if (this.isInRoom() || this.connecting) {
        this.stockHud.update(renderState.players, this.peerId);
      }

      const localPlayer = renderState.players.find(
        (player: { id: string; health: number; maxHealth: number }) =>
          player.id === this.peerId,
      );
      if (localPlayer) {
        this.syncRespawnCamera(localPlayer);
        this.healthBarOverlay.update(localPlayer.health, localPlayer.maxHealth);
      } else {
        this.releaseRespawnCamera();
        this.healthBarOverlay.hide();
      }

      this.updateWinnerBanner(renderState);
      this.updateRoundStartBanner(renderState.roundStartCountdownLabel);
    } else {
      this.winnerBanner.dataset.visible = 'false';
      this.roundStartBanner.dataset.visible = 'false';
    }

    this.refreshDebugValues();
    this.animationFrameId = requestAnimationFrame(this.onFrame);
  };

  private ensureInputDelayBuffer(): void {
    const requiredLength = this.inputDelayFrames + 1;
    if (this.inputDelayBuffer.length === requiredLength) {
      return;
    }
    this.inputDelayBuffer.length = 0;
    for (let i = 0; i < requiredLength; i += 1) {
      this.inputDelayBuffer.push(new Uint8Array([0]));
    }
    this.localTickIndex = 0;
  }

  private getDelayedInput(currentInput: Uint8Array): Uint8Array {
    if (this.inputDelayFrames === 0) {
      return currentInput;
    }
    this.ensureInputDelayBuffer();
    const buf = this.inputDelayBuffer;
    const len = buf.length;
    const writeSlot = this.localTickIndex % len;
    const readSlot = (this.localTickIndex + 1) % len;
    if (buf[writeSlot].length !== currentInput.length) {
      buf[writeSlot] = new Uint8Array(currentInput.length);
    }
    buf[writeSlot].set(currentInput);
    this.localTickIndex += 1;
    return buf[readSlot];
  }

  setInputDelayFrames(frames: number): void {
    const clamped = Math.max(0, Math.min(Math.floor(frames), MAX_INPUT_DELAY_FRAMES));
    if (clamped === this.inputDelayFrames) {
      return;
    }
    this.inputDelayFrames = clamped;
    this.inputDelayBuffer.length = 0;
    this.localTickIndex = 0;
    storeInputDelayFrames(clamped);
  }

  private tickSimulation(): void {
    if (!this.session) {
      return;
    }

    const rawInput = encodeInput(this.inputState);
    const input = this.getDelayedInput(rawInput);

    let tickResult: TickResult;
    const t0 = performance.now();
    try {
      tickResult = this.session.tick(input);
    } catch (error) {
      this.debugCounters.errorCount += 1;
      const msg = error instanceof Error ? error.message : String(error);
      this.setStatus(`Session tick failed: ${msg}`, 'error');
      this.debugLog('ERR', `Session tick failed: ${msg}`, 'error');
      return;
    }

    if (tickResult.rolledBack) {
      this.debugCounters.rollbackCount += 1;
      this.debugCounters.rollbackTicks += tickResult.rollbackTicks ?? 0;
      const elapsed = performance.now() - t0;
      if (elapsed > 50) {
        this.debugLog(
          'ROLLBACK',
          `Slow recalc: ${elapsed.toFixed(1)}ms, ${tickResult.rollbackTicks ?? 0} ticks rolled back`,
          'warn',
        );
      }
    }
  }

  private async handleHostRoom(preferredRoomId?: string): Promise<void> {
    if (this.connecting) {
      return;
    }

    this.connecting = true;
    this.updateUiState();

    try {
      await this.prepareNetworking();
      if (!this.session || !this.signaling) {
        throw new Error('Network stack is not ready');
      }

      const createdRoomId = await this.session.createRoom();
      const roomId = preferredRoomId || createdRoomId;

      if (preferredRoomId && preferredRoomId !== createdRoomId) {
        (this.session as unknown as { _roomId: string | null })._roomId = roomId;
      }

      this.roomId = roomId;
      this.hostPeerId = this.peerId;

      const responsePromise = this.waitForSignalMessage(
        (message) =>
          (message.type === 'room_hosted' && message.roomId === roomId) ||
          message.type === 'room_error',
        7000,
      );

      this.signaling.send({
        type: 'host_room',
        roomId,
        peerId: this.peerId,
        maxPlayers: MAX_PLAYERS,
      });

      const response = await responsePromise;

      if (response.type === 'room_error') {
        throw new Error(response.message);
      }
      if (response.type !== 'room_hosted') {
        throw new Error('Unexpected signaling response while hosting room');
      }

      this.setRoomState(roomId, this.peerId, response.members);
      this.recoveryState = {
        mode: 'host',
        mapId: this.selectedMapId,
        roomId,
        hostPeerId: this.peerId,
        signalUrl: this.getCurrentSignalUrl(),
      };
      storeRecoveryState(this.recoveryState);
      this.setStatus(
        preferredRoomId
          ? `Recovered host room ${roomId}. Waiting in lobby.`
          : `Hosting room ${roomId}. Waiting in lobby for players before start.`,
      );
      this.debugLog('MATCH', `Hosting room ${roomId}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.setStatus(`Unable to host room: ${msg}`, 'error');
      this.debugLog('MATCH', `Host failed: ${msg}`, 'error');
      this.cleanupNetworking();
    } finally {
      this.connecting = false;
      this.updateUiState();
    }
  }

  private async handleJoinRoom(): Promise<void> {
    if (this.connecting) {
      return;
    }

    const roomId = this.mainMenu.getRoomId();
    const hostPeerId = this.mainMenu.getHostPeerId();

    if (!roomId) {
      this.setStatus('Room ID is required to join.', 'error');
      return;
    }

    this.connecting = true;
    this.updateUiState();

    try {
      await this.prepareNetworking();
      if (!this.session || !this.signaling) {
        throw new Error('Network stack is not ready');
      }

      this.roomId = roomId;
      this.hostPeerId = hostPeerId;

      const responsePromise = this.waitForSignalMessage(
        (message) =>
          (message.type === 'room_joined' && message.roomId === roomId) ||
          message.type === 'room_error',
        9000,
      );

      this.signaling.send({
        type: 'join_room',
        roomId,
        peerId: this.peerId,
      });

      const response = await responsePromise;

      if (response.type === 'room_error') {
        throw new Error(response.message);
      }

      if (response.type !== 'room_joined') {
        throw new Error('Unexpected signaling response while joining room');
      }

      const resolvedHostPeer = response.hostPeerId || hostPeerId;
      this.setRoomState(roomId, resolvedHostPeer, response.members);
      this.recoveryState = {
        mode: 'join',
        mapId: this.selectedMapId,
        roomId,
        hostPeerId: resolvedHostPeer,
        signalUrl: this.getCurrentSignalUrl(),
      };
      storeRecoveryState(this.recoveryState);

      await this.session.joinRoom(roomId, resolvedHostPeer);
      this.setStatus(
        `Joined room ${roomId}. Waiting for host to relay and start the session.`,
      );
      this.debugLog('MATCH', `Joined room ${roomId} (host: ${resolvedHostPeer})`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.setStatus(`Unable to join room: ${msg}`, 'error');
      this.debugLog('MATCH', `Join failed: ${msg}`, 'error');
      this.cleanupNetworking();
    } finally {
      this.connecting = false;
      this.updateUiState();
    }
  }

  private async copyShareLink(): Promise<void> {
    const url = this.currentShareUrl;
    if (!url) {
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      this.setStatus('Room URL copied to clipboard.');
    } catch {
      this.setStatus('Clipboard blocked. Please copy the URL manually.', 'error');
    }
  }

  private leaveRoom(): void {
    this.debugLog('DC', `Local player left room ${this.roomId ?? '?'}`);
    this.settingsOpen = false;
    this.cleanupNetworking({ sendLeave: true });
    this.clearCameraInput();
    this.setCameraMode('follow');

    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete('room');
    currentUrl.searchParams.delete('host');
    history.replaceState({}, '', currentUrl.toString());

    this.currentShareUrl = '';
    this.lobbyMembers.clear();
    this.lobbyReadyByPeer.clear();
    this.lobbyCharacterByPeer.clear();
    this.mainMenu.setShareUrl('');
    this.mainMenu.setRoomId('');
    this.mainMenu.setHostPeerId('');
    this.settingsMenu.setShareUrl('');
    this.settingsMenu.setRoomId('');
    this.settingsMenu.setHostPeerId('');
    this.settingsMenu.setMap(this.getSelectedMapManifest());

    this.setStatus('Left room. Host or join another session.');
    this.statusBadge.textContent = sessionStateLabel(SessionState.Disconnected);

    this.debugCounters.rollbackCount = 0;
    this.debugCounters.rollbackTicks = 0;
    this.debugCounters.desyncCount = 0;
    this.debugCounters.errorCount = 0;

    this.game?.reset();
    this.updateUiState();
    this.refreshDebugValues();
  }

  private async prepareNetworking(): Promise<void> {
    this.cleanupNetworking();

    const game = this.game;
    if (!game) {
      throw new Error('Physics runtime is not initialized yet.');
    }

    game.reset();

    this.signaling = new SignalingClient();
    const signalUrl = this.getCurrentSignalUrl();
    await this.signaling.connect(signalUrl);

    this.unsubscribeSignalMessages = this.signaling.onMessage((message) => {
      void this.handleSignalingMessage(message);
    });

    this.unsubscribeSignalClose = this.signaling.onClose(() => {
      if (this.isCleaningUp || this.reconnectingSignaling || this.connecting) {
        return;
      }

      if (this.recoveryState) {
        this.setStatus(
          'Disconnected from signaling server. Attempting room recovery...',
          'error',
        );
        void this.scheduleSignalingRecovery();
        return;
      }

      if (this.session?.state !== SessionState.Disconnected) {
        this.setStatus('Disconnected from signaling server.', 'error');
      }
    });

    this.transport = new WebRTCTransport(this.peerId, {
      rtcConfiguration: {
        iceServers: [
          { urls: 'stun:stun.cloudflare.com:3478' },
          { urls: 'stun:stun.l.google.com:19302' },
          {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject',
          },
        ],
        iceTransportPolicy: this.forceRelay ? 'relay' : 'all',
      },
      maxReconnectAttempts: 5,
      reconnectDelay: 1000,
      keepaliveInterval: WEBSOCKET_KEEPALIVE_INTERVAL_MS,
      keepaliveTimeout: WEBSOCKET_KEEPALIVE_TIMEOUT_MS,
      connectionTimeout: WEBSOCKET_CONNECTION_TIMEOUT_MS,
    });

    this.transport.setSignalingCallbacks({
      onSignal: (targetPeerId: string, signal: SignalMessage) => {
        if (!this.signaling || !this.roomId) {
          return;
        }

        this.signaling.sendSignal(
          this.roomId,
          this.peerId,
          targetPeerId,
          signal,
        );
      },
    });

    this.transport.onError = (peerId, error) => {
      this.setStatus(this.formatTransportError(peerId, error), 'error');
    };

    this.session = createSession({
      game,
      transport: this.transport,
      inputPredictor: new RepeatLastInputPredictor(),
      config: {
        tickRate: TICK_RATE,
        maxPlayers: MAX_PLAYERS,
        topology: Topology.Star,
        hashInterval: TICK_RATE,
        disconnectTimeout: ROOM_DISCONNECT_GRACE_MS,
        snapshotHistorySize: TICK_RATE,
        maxSpeculationTicks: Math.floor(TICK_RATE / 2),
        debug: false,
      },
    });

    this.session.on('stateChange', (nextState) => {
      this.statusBadge.textContent = sessionStateLabel(nextState);
      if (nextState !== SessionState.Lobby) {
        this.lobbyOverlay.dataset.visible = 'false';
      }
      if (nextState === SessionState.Lobby) {
        if (!this.leavingManager) {
          this.leavingManager = new LeavingManager(() => {
            this.setStatus('You were removed from the lobby after tabbing out.');
            this.leaveRoom();
          });
        }
      } else {
        this.leavingManager?.dispose();
        this.leavingManager = null;
      }
      this.updateUiState();
    });

    this.session.on('playerJoined', (player) => {
      this.setStatus(`Player joined: ${player.id}`);
      this.debugLog('JOIN', `Player joined: ${player.id}`);
      this.lobbyMembers.add(player.id);
      this.lobbyReadyByPeer.set(player.id, false);
      this.assignDefaultCharacterIfMissing(player.id);
      this.updateUiState();
      if (player.id !== this.peerId) {
        this.probePeerConnectionType(player.id);
      }
    });

    this.session.on('playerLeft', (player) => {
      this.setStatus(`Player left cleanly: ${player.id}`);
      this.debugLog('DC', `Player left cleanly: ${player.id}`);
      this.lobbyMembers.delete(player.id);
      this.lobbyReadyByPeer.delete(player.id);
      this.lobbyCharacterByPeer.delete(player.id);
      this.updateUiState();
    });

    this.session.on('playerDropped', (playerId) => {
      this.setStatus(`Player disconnected abruptly and was removed: ${playerId}`);
      this.debugLog('DC', `Player dropped (abrupt disconnect): ${playerId}`, 'warn');
      this.lobbyMembers.delete(playerId);
      this.lobbyReadyByPeer.delete(playerId);
      this.lobbyCharacterByPeer.delete(playerId);
      this.updateUiState();
    });

    this.session.on('gameStart', () => {
      this.applyLobbyCharactersToGame();
      this.setStatus('Game started. Rollback simulation is active.');
      const fightStartAudio = new Audio(FIGHT_START_SOUND_URL);
      fightStartAudio.volume = 0.5 * this.masterVolume;
      void fightStartAudio.play().catch((err) => {
        console.warn('Fight start sound could not play:', err);
      });
    });

    this.session.on('desync', (tick, localHash, remoteHash) => {
      this.debugCounters.desyncCount += 1;
      this.setStatus(
        `Desync at tick ${tick}: local=${localHash} remote=${remoteHash}`,
        'error',
      );
      this.debugLog('DESYNC', `Tick ${tick}: local=${localHash} remote=${remoteHash}`, 'error');
    });

    this.session.on('error', (error, context) => {
      this.debugCounters.errorCount += 1;
      this.setStatus(
        `Session error (${context.source}): ${error.message}`,
        'error',
      );
      this.debugLog('ERR', `(${context.source}): ${error.message}`, 'error');
    });

    const sessionOnConnect = this.transport.onConnect;
    const sessionOnDisconnect = this.transport.onDisconnect;

    this.transport.onConnect = (peerId: string) => {
      sessionOnConnect?.(peerId);
      this.setStatus(`WebRTC peer connected: ${peerId}`);
      this.debugLog('ICE', `WebRTC connected to ${peerId}`);
    };

    this.transport.onDisconnect = (peerId: string) => {
      const isHostDroppingPeer =
        this.session?.isHost &&
        this.session.state !== SessionState.Disconnected &&
        peerId !== this.peerId;

      if (isHostDroppingPeer) {
        this.debugLog('DC', `Host dropped peer ${peerId} (will trigger rollback)`, 'warn');
        try {
          const hostSession = this.session;
          if (hostSession) {
            hostSession.dropPlayer(peerId as PlayerId);
          }
        } catch {
          sessionOnDisconnect?.(peerId);
        }
        return;
      }

      this.debugLog('DC', `Disconnected from peer ${peerId}`, 'warn');
      sessionOnDisconnect?.(peerId);
    };

    this.setStatus('Connected to signaling server.');
    this.debugLog('MATCH', 'Connected to signaling server');
    this.statusBadge.textContent = sessionStateLabel(this.session.state);
  }

  private cleanupNetworking(options: { sendLeave?: boolean } = {}): void {
    const { sendLeave = false } = options;

    this.leavingManager?.dispose();
    this.leavingManager = null;

    this.isCleaningUp = true;

    try {
      if (sendLeave && this.signaling && this.roomId) {
        this.signaling.send({
          type: 'leave_room',
          roomId: this.roomId,
          peerId: this.peerId,
        });
      }

      this.clearRecoveryState();
      clearStoredRecoveryState();

      if (this.session) {
        try {
          this.session.leaveRoom();
        } catch {
          // Session may already be disconnected.
        }
        this.session.destroy();
        this.session = null;
      }

      if (this.transport) {
        this.transport.destroy();
        this.transport = null;
      }

      if (this.unsubscribeSignalMessages) {
        this.unsubscribeSignalMessages();
        this.unsubscribeSignalMessages = null;
      }

      if (this.unsubscribeSignalClose) {
        this.unsubscribeSignalClose();
        this.unsubscribeSignalClose = null;
      }

      if (this.signaling) {
        this.signaling.disconnect();
        this.signaling = null;
      }

      this.roomId = null;
      this.hostPeerId = null;
      this.lobbyMembers.clear();
      this.lobbyReadyByPeer.clear();
      this.lobbyCharacterByPeer.clear();
    } finally {
      this.isCleaningUp = false;
    }
  }

  private getCurrentSignalUrl(): string {
    return this.mainMenu.getSignalUrl() || this.defaultSignalUrl();
  }

  private clearRecoveryState(): void {
    if (this.reconnectTimerId !== null) {
      window.clearTimeout(this.reconnectTimerId);
      this.reconnectTimerId = null;
    }

    this.reconnectAttempt = 0;
    this.reconnectingSignaling = false;
    this.recoveryState = null;
    clearStoredRecoveryState();
  }

  private scheduleSignalingRecovery(): void {
    if (!this.recoveryState || this.reconnectTimerId !== null) {
      return;
    }

    if (this.reconnectAttempt >= SIGNALING_RECONNECT_MAX_ATTEMPTS) {
      this.setStatus(
        'Unable to recover the signaling connection automatically.',
        'error',
      );
      this.cleanupNetworking();
      return;
    }

    const attempt = this.reconnectAttempt + 1;
    const delayMs = Math.min(
      SIGNALING_RECONNECT_MAX_DELAY_MS,
      SIGNALING_RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt,
    );

    this.reconnectTimerId = window.setTimeout(() => {
      this.reconnectTimerId = null;
      void this.recoverSignalingConnection(attempt);
    }, delayMs);

    this.reconnectAttempt = attempt;
  }

  private async recoverSignalingConnection(attempt: number): Promise<void> {
    if (!this.signaling || !this.recoveryState) {
      return;
    }

    const recoveryState = this.recoveryState;
    this.reconnectingSignaling = true;

    try {
      this.setStatus(
        `Reconnecting to signaling server (attempt ${attempt})...`,
        'error',
      );

      await this.signaling.connect(recoveryState.signalUrl);

      if (!this.recoveryState) {
        return;
      }

      if (recoveryState.mode === 'host') {
        const responsePromise = this.waitForSignalMessage(
          (message) =>
            (message.type === 'room_hosted' &&
              message.roomId === recoveryState.roomId) ||
            message.type === 'room_error',
          7000,
        );

        this.signaling.send({
          type: 'host_room',
          roomId: recoveryState.roomId,
          peerId: this.peerId,
          maxPlayers: MAX_PLAYERS,
        });

        const response = await responsePromise;
        if (response.type === 'room_error') {
          throw new Error(response.message);
        }
        if (response.type !== 'room_hosted') {
          throw new Error('Unexpected signaling response while recovering host room');
        }

        this.setRoomState(recoveryState.roomId, this.peerId, response.members);
        this.recoveryState = {
          ...recoveryState,
          hostPeerId: this.peerId,
        };
        storeRecoveryState(this.recoveryState);
      } else {
        const responsePromise = this.waitForSignalMessage(
          (message) =>
            (message.type === 'room_joined' &&
              message.roomId === recoveryState.roomId) ||
            message.type === 'room_error',
          7000,
        );

        this.signaling.send({
          type: 'join_room',
          roomId: recoveryState.roomId,
          peerId: this.peerId,
        });

        const response = await responsePromise;
        if (response.type === 'room_error') {
          throw new Error(response.message);
        }

        if (response.type !== 'room_joined') {
          throw new Error('Unexpected signaling response while recovering room');
        }

        const resolvedHostPeer = response.hostPeerId || recoveryState.hostPeerId;
        this.setRoomState(recoveryState.roomId, resolvedHostPeer, response.members);
        this.recoveryState = {
          ...recoveryState,
          hostPeerId: resolvedHostPeer,
        };
        storeRecoveryState(this.recoveryState);
      }

      this.reconnectAttempt = 0;
      this.setStatus('Recovered room connection.');
    } catch (error) {
      if (!this.recoveryState) {
        return;
      }

      this.setStatus(
        `Room recovery failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'error',
      );
      this.scheduleSignalingRecovery();
    } finally {
      this.reconnectingSignaling = false;
    }
  }

  private async handleSignalingMessage(
    message: ServerToClientMessage,
  ): Promise<void> {
    switch (message.type) {
      case 'signal':
        if (!this.transport) {
          return;
        }
        try {
          if (message.signal.type === 'description') {
            await this.transport.handleRemoteDescription(
              message.fromPeerId,
              message.signal.description,
            );
          } else {
            await this.transport.handleRemoteCandidate(
              message.fromPeerId,
              message.signal.candidate,
            );
          }
        } catch (error) {
          this.setStatus(
            `Signal handling failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
            'error',
          );
        }
        break;

      case 'peer_joined':
        this.setStatus(`Peer joined room: ${message.peerId}`);
        this.lobbyMembers.add(message.peerId);
        this.lobbyReadyByPeer.set(message.peerId, false);
        this.assignDefaultCharacterIfMissing(message.peerId);
        this.broadcastLocalCharacterSelection();
        this.broadcastLocalReadyState();
        this.updateUiState();
        break;

      case 'peer_left':
        this.setStatus(`Peer left room: ${message.peerId}`);
        this.lobbyMembers.delete(message.peerId);
        this.lobbyReadyByPeer.delete(message.peerId);
        this.lobbyCharacterByPeer.delete(message.peerId);
        this.updateUiState();
        break;

      case 'room_joined':
        this.hostPeerId = message.hostPeerId;
        this.mainMenu.setHostPeerId(message.hostPeerId);
        this.settingsMenu.setHostPeerId(message.hostPeerId);
        for (const member of message.members) {
          this.lobbyMembers.add(member);
          if (!this.lobbyReadyByPeer.has(member)) {
            this.lobbyReadyByPeer.set(member, false);
          }
          this.assignDefaultCharacterIfMissing(member);
        }
        this.ensureLocalCharacterSelection();
        this.updateUiState();
        break;

      case 'room_hosted':
        for (const member of message.members) {
          this.lobbyMembers.add(member);
          if (!this.lobbyReadyByPeer.has(member)) {
            this.lobbyReadyByPeer.set(member, false);
          }
          this.assignDefaultCharacterIfMissing(member);
        }
        this.ensureLocalCharacterSelection();
        this.updateUiState();
        break;

      case 'lobby_ready':
        this.lobbyReadyByPeer.set(message.peerId, message.ready);
        this.debugLog('LOBBY', `${message.peerId} is ${message.ready ? 'ready' : 'not ready'}`);
        if (!message.ready || !this.areAllLobbyPlayersReady()) {
          const notReady = Array.from(this.lobbyMembers).filter(
            (id) => this.lobbyReadyByPeer.get(id) !== true,
          );
          if (notReady.length > 0) {
            this.debugLog('LOBBY', `Waiting on: ${notReady.join(', ')}`);
          }
        }
        this.updateUiState();
        break;

      case 'lobby_character_select':
        if (isCharacterId(message.characterId)) {
          this.lobbyCharacterByPeer.set(message.peerId, message.characterId);
          this.game?.setCharacterSelection(message.peerId, message.characterId);
        }
        this.updateUiState();
        break;

      case 'room_error':
        this.setStatus(message.message, 'error');
        if (message.code === 'HOST_LEFT' || message.code === 'ROOM_NOT_FOUND') {
          this.cleanupNetworking();
        }
        break;

      default:
        break;
    }
  }

  private waitForSignalMessage(
    predicate: (message: ServerToClientMessage) => boolean,
    timeoutMs: number,
  ): Promise<ServerToClientMessage> {
    if (!this.signaling) {
      return Promise.reject(new Error('Signaling client is not connected'));
    }

    return new Promise<ServerToClientMessage>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        unsubscribe();
        reject(new Error('Timed out waiting for signaling server response'));
      }, timeoutMs);

      const unsubscribe = this.signaling!.onMessage((message) => {
        if (!predicate(message)) {
          return;
        }
        window.clearTimeout(timeoutId);
        unsubscribe();
        resolve(message);
      });
    });
  }

  private setRoomState(roomId: string, hostPeerId: string, members: string[] = []): void {
    this.roomId = roomId;
    this.hostPeerId = hostPeerId;

    this.mainMenu.setRoomId(roomId);
    this.mainMenu.setHostPeerId(hostPeerId);
    this.settingsMenu.setRoomId(roomId);
    this.settingsMenu.setHostPeerId(hostPeerId);
    this.settingsMenu.setMap(this.getSelectedMapManifest());
    this.lobbyMembers.clear();
    if (members.length > 0) {
      for (const member of members) {
        this.lobbyMembers.add(member);
      }
    }
    this.lobbyMembers.add(this.peerId);
    this.seedLobbyMembers();
    this.ensureLocalCharacterSelection();

    this.publishShareUrl(roomId, hostPeerId);
  }

  private publishShareUrl(roomId: string, hostPeerId: string): void {
    const current = new URL(window.location.href);
    current.searchParams.set('room', roomId);
    current.searchParams.set('host', hostPeerId);
    current.searchParams.set('map', this.selectedMapId);

    const signalUrl = this.mainMenu.getSignalUrl();
    if (signalUrl && signalUrl !== this.defaultSignalUrl()) {
      current.searchParams.set('signal', signalUrl);
    } else {
      current.searchParams.delete('signal');
    }

    const url = current.toString();
    history.replaceState({}, '', url);

    this.currentShareUrl = url;
    this.mainMenu.setShareUrl(url);
    this.settingsMenu.setShareUrl(url);
  }

  private refreshDebugValues(): void {
    const currentTick = this.session ? Number(this.session.currentTick) : -1;
    const confirmedTick = this.session ? Number(this.session.confirmedTick) : -1;

    this.tickValue.textContent = String(currentTick);
    this.confirmedTickValue.textContent = String(confirmedTick);
    this.rollbackCountValue.textContent = String(this.debugCounters.rollbackCount);
    this.rollbackTicksValue.textContent = String(this.debugCounters.rollbackTicks);
    this.desyncCountValue.textContent = String(this.debugCounters.desyncCount);

    const peers = this.transport?.connectedPeers.size ?? 0;
    const players = this.session?.players.size ?? 0;

    this.peerCountValue.textContent = String(peers);
    this.playerCountValue.textContent = String(players);

    let rtt = 0;
    if (this.session && this.hostPeerId && this.hostPeerId !== this.peerId) {
      rtt = this.session.getRtt(this.hostPeerId);
    } else if (this.transport?.connectedPeers.size) {
      const metrics = Array.from(this.transport.connectedPeers)
        .map((peerId) => this.transport?.getConnectionMetrics(peerId)?.rtt ?? 0)
        .filter((sample) => sample > 0);
      if (metrics.length > 0) {
        rtt = metrics.reduce((sum, sample) => sum + sample, 0) / metrics.length;
      }
    }

    this.rttValue.textContent = rtt > 0 ? `${Math.round(rtt)} ms` : '-';
  }

  private setStatus(message: string, tone: StatusTone = 'normal'): void {
    this.mainMenu.setStatus(message, tone);
    this.settingsMenu.setStatus(message, tone);
  }

  private bindDebugToggleButtons(): void {
    this.toggleNetCountersBtn.addEventListener('click', () => {
      const visible = this.netCountersPanel.style.display !== 'none';
      this.netCountersPanel.style.display = visible ? 'none' : '';
      this.toggleNetCountersBtn.classList.toggle('active', !visible);
    });
    this.toggleDebugConsoleBtn.addEventListener('click', () => {
      const visible = this.debugConsolePanel.style.display !== 'none';
      this.debugConsolePanel.style.display = visible ? 'none' : '';
      this.toggleDebugConsoleBtn.classList.toggle('active', !visible);
    });
    requireElement<HTMLButtonElement>(this.root, '#debugSettingsBtn').addEventListener('click', () => {
      this.toggleSettings();
    });
  }

  debugLog(tag: string, message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const entry = document.createElement('div');
    entry.className = 'debug-log-entry';
    entry.dataset.level = level;
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    entry.textContent = `[${time}] [${tag}] ${message}`;
    this.debugConsoleLog.appendChild(entry);
    while (this.debugConsoleLog.children.length > 200) {
      this.debugConsoleLog.firstElementChild?.remove();
    }
    this.debugConsoleLog.scrollTop = this.debugConsoleLog.scrollHeight;
  }

  private isInRoom(): boolean {
    return (
      this.session !== null && this.session.state !== SessionState.Disconnected
    );
  }

  private toggleSettings(): void {
    this.settingsOpen = !this.settingsOpen;
    this.updateUiState();
  }

  private applyArenaSideWalls(enabled: boolean): void {

    const wallLabel = enabled ? 'on' : 'off';
    const syncHint = this.isInRoom()
      ? ' All players in the room should use the same setting to avoid desync.'
      : '';
    this.setStatus(`Arena side walls ${wallLabel}.${syncHint}`);
  }

  private toggleFullscreen(enabled: boolean): void {
    if (enabled) {
      if (document.fullscreenElement) {
        return;
      }
      const request = this.viewport.requestFullscreen();
      request.catch((err: Error) => {
        this.setStatus(`Fullscreen request failed: ${err.message}`, 'error');
        this.settingsMenu.setFullscreenEnabled(false);
      });
    } else {
      if (!document.fullscreenElement) {
        return;
      }
      const exit = document.exitFullscreen();
      exit.catch((err: Error) => {
        this.setStatus(`Exit fullscreen failed: ${err.message}`, 'error');
      });
    }
  }

  private readonly onFullscreenStateChange = (): void => {
    const active = document.fullscreenElement !== null;
    this.settingsMenu.setFullscreenEnabled(active);
    // The browser sometimes lags before ResizeObserver fires after
    // exiting fullscreen, so kick the renderer to recompute once the
    // viewport has settled at its new size.
    requestAnimationFrame(() => this.renderer.requestResize());
  };

  private setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    this.gameThemeAudio.volume = this.masterVolume * 0.15;
    this.menuThemeAudio.volume = this.masterVolume * 0.2;
    if (this.game) {
      this.game.setVolume(this.masterVolume);
    }
  }

  setForceRelay(enabled: boolean): void {
    if (enabled === this.forceRelay) {
      return;
    }
    this.forceRelay = enabled;
    storeForceRelay(enabled);
    this.setStatus(
      enabled
        ? 'Force-relay mode enabled. Reconnect to the room for it to take effect.'
        : 'Force-relay mode disabled. Reconnect to the room for it to take effect.',
    );
  }

  private formatTransportError(peerId: string | null, error: Error): string {
    const message = error.message || 'Unknown error';
    const lower = message.toLowerCase();
    const isLikelyIceFailure =
      lower.includes('ice') ||
      lower.includes('connection failed') ||
      lower.includes('timeout') ||
      lower.includes('unreachable');

    if (isLikelyIceFailure) {
      if (this.forceRelay) {
        return (
          `Couldn't reach the relay server${peerId ? ` (${peerId})` : ''}. ` +
          'Check your internet connection or try a different network.'
        );
      }
      return (
        `Couldn't establish a peer connection${peerId ? ` (${peerId})` : ''}. ` +
        'This network (school/office Wi-Fi, symmetric NAT) may be blocking UDP. ' +
        "Try enabling 'Force relay mode' in Settings."
      );
    }

    return `WebRTC transport error${peerId ? ` (${peerId})` : ''}: ${message}`;
  }

  private probePeerConnectionType(peerId: string): void {
    if (!this.transport) {
      return;
    }
    // Give ICE a moment to finalize candidate selection before reading stats.
    window.setTimeout(() => {
      if (!this.transport) {
        return;
      }
      this.transport
        .getConnectionStats(peerId)
        .then((report) => {
          if (!report) {
            return;
          }
          const summary = summarizeIceTransport(report);
          if (summary) {
            this.setStatus(`Connection to ${peerId}: ${summary}`);
            const level = summary.includes('TURN') ? 'warn' : 'info';
            this.debugLog('ICE', `${peerId}: ${summary}`, level);
          }
        })
        .catch(() => {
          // Stats are best-effort; ignore failures.
        });
    }, 750);
  }

  private updateUiState(): void {
    const inRoom = this.isInRoom();
    const inActiveSession = inRoom || this.connecting;

    if (inActiveSession) {
      this.mainMenu.hide();
    } else {
      this.mainMenu.show();
    }

    this.mainMenu.setBusy(this.connecting);
    this.mainMenu.setMapSelectionEnabled(!inActiveSession);
    this.cameraToggleButton.disabled = !inActiveSession;
    this.updateCameraButton();

    const inLobby = inRoom && this.session?.state === SessionState.Lobby;
    const inPlayingSession = inRoom && this.session?.state === SessionState.Playing;

    this.gameHud.dataset.visible = inPlayingSession ? 'true' : 'false';
    this.stockHud.setVisible(inPlayingSession);
    this.leaveButton.disabled = !inRoom || this.connecting;
    this.lobbyOverlay.dataset.visible = inLobby ? 'true' : 'false';
    this.renderCharacterPicker();
    this.renderLobbyPlayers();
    this.lobbyRoomIdValue.textContent = this.roomId ?? '-';
    this.lobbyShareUrlValue.value = this.currentShareUrl;

    const localReady = this.isLocalReadyInLobby();
    this.lobbyReadyButton.textContent = localReady ? 'Unready' : 'Ready';
    this.lobbyReadyButton.disabled = !inLobby;
    this.lobbyLeaveButton.disabled = !inLobby;
    this.lobbyCopyButton.disabled = !inLobby || this.currentShareUrl.length === 0;

    const canStartGame = this.canHostStartGame();
    this.startGameButton.disabled = !canStartGame;
    this.startGameButton.style.display = inLobby && (canStartGame || this.shouldShowHostStartControl())
      ? 'inline-flex'
      : 'none';

    if (this.settingsOpen) {
      this.settingsMenu.show();
    } else {
      this.settingsMenu.hide();
    }
  }

  private setSelectedMap(mapId: string): void {
    if (this.isInRoom() || this.connecting) {
      return;
    }

    const normalizedMapId = mapId.trim();
    if (!normalizedMapId || normalizedMapId === this.selectedMapId) {
      return;
    }

    if (!this.availableMaps.find((entry) => entry.id === normalizedMapId)) {
      return;
    }

    this.selectedMapId = normalizedMapId;
    this.mapDefinition = loadMapDefinition(this.selectedMapId);
    this.mainMenu.setMaps(this.availableMaps, this.selectedMapId);
    this.settingsMenu.setMap(this.getSelectedMapManifest());

    this.renderer.dispose();
    this.renderer = new GameRenderer(this.viewport, this.mapDefinition);
    this.renderer.setCameraMode(this.cameraMode);

    if (this.game) {
      this.game.reset();
      this.game = new RollbackPhysicsGame(this.mapDefinition);
    }
  }

  private defaultSignalUrl(): string {
    const envUrl = import.meta.env.VITE_SIGNALING_URL as string | undefined;
    if (envUrl) return envUrl;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }

  private renderAppTemplate(): string {
    return `
      <div class="app-shell">
        <section id="viewport" class="panel viewport-panel">
          <div id="lobbyOverlay" class="lobby-overlay" data-visible="false">
            <div class="lobby-card">
              <p class="overlay-eyebrow">Lobby</p>
              <h2 class="overlay-title--small">Waiting Room</h2>
              <div class="lobby-character-select">
                <span class="lobby-section-label">Choose Your Character</span>
                <div id="lobbyCharacterGrid" class="lobby-character-grid"></div>
              </div>
              <label>
                <span>Lobby ID</span>
                <output id="lobbyRoomIdValue">-</output>
              </label>
              <label class="share-field">
                <span>Invite URL</span>
                <div>
                  <input id="lobbyShareUrlValue" type="text" readonly placeholder="Host to generate URL" />
                  <button id="lobbyCopyButton" type="button">Copy</button>
                </div>
              </label>
              <div id="lobbyPlayersList" class="lobby-players-list"></div>
              <div class="lobby-actions">
                <button id="lobbyReadyButton" class="action-secondary" type="button">Ready</button>
                <button id="startGameButton" class="action-primary" type="button">Start Game</button>
                <button id="lobbyLeaveButton" class="action-ghost" type="button">Leave Lobby</button>
              </div>
            </div>
          </div>
          <div id="gameHud" class="game-hud" data-visible="false">
            <div class="state-pill">
              <span>Session</span>
              <strong id="statusBadge">Disconnected</strong>
            </div>
            <div class="game-hud-actions">
              <button id="cameraModeButton" class="action-ghost" type="button">Camera: Follow</button>
              <button id="settingsToggleButton" class="action-ghost" type="button">Settings</button>
              <button id="leaveButton" class="action-ghost" type="button">Leave</button>
            </div>
          </div>
        </section>

        <div class="debug-footer">
          <div class="debug-toggle-bar">
            <button id="toggleNetCounters" class="debug-toggle-btn active" type="button">Net Counters</button>
            <button id="toggleDebugConsole" class="debug-toggle-btn active" type="button">Debug Console</button>
            <button id="debugSettingsBtn" class="debug-toggle-btn debug-toggle-btn--right" type="button">Settings</button>
          </div>
          <div class="debug-panels-row">
            <section id="netCountersPanel" class="panel debug-panel">
              <h2>Net Debug Counters</h2>
              <div class="metrics-grid">
                <article><span>Tick</span><strong id="tickValue">-1</strong></article>
                <article><span>Confirmed Tick</span><strong id="confirmedTickValue">-1</strong></article>
                <article><span>Rollbacks</span><strong id="rollbackCountValue">0</strong></article>
                <article><span>Rollback Ticks</span><strong id="rollbackTicksValue">0</strong></article>
                <article><span>Desync Events</span><strong id="desyncCountValue">0</strong></article>
                <article><span>Connected Peers</span><strong id="peerCountValue">0</strong></article>
                <article><span>Players</span><strong id="playerCountValue">0</strong></article>
                <article><span>RTT</span><strong id="rttValue">-</strong></article>
              </div>
            </section>
            <section id="debugConsolePanel" class="panel debug-console-panel">
              <h2>Debug Console</h2>
              <div id="debugConsoleLog" class="debug-console-log"></div>
            </section>
          </div>
        </div>
      </div>
    `;
  }

  private getSelectedMapManifest() {
    return (
      this.availableMaps.find((entry) => entry.id === this.selectedMapId) ?? {
        height: this.mapDefinition.height,
        id: this.selectedMapId,
        name: this.mapDefinition.name,
        width: this.mapDefinition.width,
      }
    );
  }

  private toggleCameraMode(): void {
    const nextMode: CameraMode =
      this.cameraMode === 'follow'
        ? 'free'
        : this.cameraMode === 'free'
          ? 'action'
          : 'follow';
    this.setCameraMode(nextMode);
  }

  private setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    this.renderer.setCameraMode(mode);
    if (mode !== 'free') {
      this.clearCameraInput();
    }
    this.updateCameraButton();
  }

  private clearCameraInput(): void {
    this.cameraPanInput.left = false;
    this.cameraPanInput.right = false;
    this.cameraPanInput.up = false;
    this.cameraPanInput.down = false;
    this.cameraPanInput.zoomin = false;
    this.cameraPanInput.zoomout = false;
  }

  private updateCameraButton(): void {
    this.cameraToggleButton.textContent = `Camera: ${cameraModeLabel(this.cameraMode)}`;
  }

  private updateFreeCamera(deltaSeconds: number): void {
    if (this.cameraMode !== 'free' || deltaSeconds <= 0) {
      return;
    }

    const moveX = (this.cameraPanInput.right ? 1 : 0) - (this.cameraPanInput.left ? 1 : 0);
    const moveY = (this.cameraPanInput.up ? 1 : 0) - (this.cameraPanInput.down ? 1 : 0);

    if (moveX !== 0 || moveY !== 0) {
      this.renderer.panFreeCamera(
        moveX * this.cameraMoveSpeed * deltaSeconds,
        moveY * this.cameraMoveSpeed * deltaSeconds,
      );
    }

    const zoomDir = (this.cameraPanInput.zoomin ? 1 : 0) - (this.cameraPanInput.zoomout ? 1 : 0);
    if (zoomDir !== 0) {
      this.renderer.zoomFreeCamera(zoomDir * 1.5 * deltaSeconds);
    }
  }

  private syncRespawnCamera(localPlayer: { eliminated: boolean; respawning: boolean }): void {
    const shouldLock = this.cameraMode !== 'free' && (localPlayer.eliminated || localPlayer.respawning);

    if (shouldLock) {
      if (!this.respawnCameraLocked) {
        this.renderer.lockCamera();
        this.respawnCameraLocked = true;
      }
      return;
    }

    this.releaseRespawnCamera();
  }

  private releaseRespawnCamera(): void {
    if (!this.respawnCameraLocked) {
      return;
    }

    this.renderer.unlockCamera();
    this.respawnCameraLocked = false;
  }

  private updateWinnerBanner(renderState: { winnerId: string | null; players: { id: string; color: number }[] }): void {
    const winnerId = renderState.winnerId;
    if (winnerId === null) {
      this.winnerBanner.dataset.visible = 'false';
      return;
    }

    const winner = renderState.players.find((player) => player.id === winnerId);
    if (!winner) {
      this.winnerBanner.dataset.visible = 'false';
      return;
    }

    const isLocal = winnerId === this.peerId;
    const colorHex = `#${winner.color.toString(16).padStart(6, '0')}`;
    this.winnerBannerTitle.textContent = isLocal ? 'You Win!' : 'Defeat';
    this.winnerBannerSubtitle.textContent = isLocal
      ? 'Last one standing.'
      : `${this.truncatePeerId(winnerId)} wins the match.`;
    this.winnerBanner.style.setProperty('--winner-color', colorHex);
    this.winnerBanner.dataset.visible = 'true';
  }

  private updateRoundStartBanner(label: string | null): void {
    if (label === null) {
      this.roundStartBanner.dataset.visible = 'false';
      return;
    }

    this.roundStartBanner.textContent = label;
    this.roundStartBanner.dataset.visible = 'true';
  }

  private truncatePeerId(peerId: string): string {
    return peerId.length > 14 ? `${peerId.slice(0, 12)}…` : peerId;
  }

  private handleStartGame(): void {
    if (!this.canHostStartGame() || !this.session || !this.roomId) {
      return;
    }
    this.applyLobbyCharactersToGame();
    const sortedSessionIds = Array.from(this.session.players.keys()).sort();
    this.game?.initializePlayers(sortedSessionIds);
    this.session.start();
    this.setStatus(`Match started in room ${this.roomId}.`);
    this.updateUiState();
  }

  private shouldShowHostStartControl(): boolean {
    return Boolean(
      this.isInRoom() &&
      this.session?.isHost &&
      this.session.state === SessionState.Lobby,
    );
  }

  private canHostStartGame(): boolean {
    if (!this.shouldShowHostStartControl() || !this.session) {
      return false;
    }

    // Allow host to start immediately when alone in lobby.
    if (this.lobbyMembers.size <= 1) {
      return true;
    }

    return this.areAllLobbyPlayersReady();
  }

  private seedLobbyMembers(): void {
    this.lobbyMembers.add(this.peerId);
    if (this.peerId) {
      this.lobbyReadyByPeer.set(this.peerId, false);
    }
    if (!this.session) {
      return;
    }
    for (const playerId of this.session.players.keys()) {
      this.lobbyMembers.add(playerId);
      if (!this.lobbyReadyByPeer.has(playerId)) {
        this.lobbyReadyByPeer.set(playerId, false);
      }
    }
  }

  private toggleLocalLobbyReady(): void {
    if (!this.roomId || !this.signaling || !this.isInRoom() || this.session?.state !== SessionState.Lobby) {
      return;
    }
    const nextReady = !this.isLocalReadyInLobby();
    this.lobbyReadyByPeer.set(this.peerId, nextReady);
    this.debugLog('LOBBY', `Local player is ${nextReady ? 'ready' : 'not ready'}`);
    this.signaling.send({
      type: 'lobby_ready',
      roomId: this.roomId,
      peerId: this.peerId,
      ready: nextReady,
    });
    this.updateUiState();
  }

  private isLocalReadyInLobby(): boolean {
    return this.lobbyReadyByPeer.get(this.peerId) === true;
  }

  private areAllLobbyPlayersReady(): boolean {
    if (this.lobbyMembers.size < 2) {
      return false;
    }
    for (const playerId of this.lobbyMembers) {
      if (this.lobbyReadyByPeer.get(playerId) !== true) {
        return false;
      }
    }
    return true;
  }

  private renderLobbyPlayers(): void {
    if (!this.isInRoom() || this.session?.state !== SessionState.Lobby) {
      this.lobbyPlayersList.innerHTML = '';
      return;
    }

    const ids = Array.from(this.lobbyMembers).sort((a, b) => a.localeCompare(b));
    this.lobbyPlayersList.innerHTML = ids
      .map((playerId) => {
        const ready = this.lobbyReadyByPeer.get(playerId) === true;
        const isHost = playerId === this.hostPeerId;
        const isLocal = playerId === this.peerId;
        const role = isHost ? 'Host' : 'Player';
        const characterId =
          this.lobbyCharacterByPeer.get(playerId) ??
          defaultCharacterForPlayer(playerId, ids);
        const characterName = CHARACTER_DISPLAY_NAMES[characterId];
        return `
          <article class="lobby-player-card" data-ready="${ready ? 'true' : 'false'}">
            <div class="lobby-player-meta">
              <strong>${this.truncatePeerId(playerId)}${isLocal ? ' (You)' : ''}</strong>
              <span>${role} · ${characterName}</span>
            </div>
            <span class="lobby-player-ready">${ready ? 'Ready' : 'Not Ready'}</span>
          </article>
        `;
      })
      .join('');
  }

  private renderCharacterPicker(): void {
    if (!this.isInRoom() || this.session?.state !== SessionState.Lobby) {
      this.lobbyCharacterGrid.innerHTML = '';
      return;
    }

    const sortedMembers = Array.from(this.lobbyMembers).sort((a, b) => a.localeCompare(b));
    const localSelection = this.getLocalCharacterSelection(sortedMembers);

    this.lobbyCharacterGrid.innerHTML = CHARACTER_IDS.map((characterId) => {
      const isSelected = localSelection === characterId;
      const previewUrl = getCharacterPreviewUrl(characterId);

      return `
        <button
          type="button"
          class="lobby-character-option${isSelected ? ' lobby-character-option--selected' : ''}"
          data-character-id="${characterId}"
          aria-pressed="${isSelected ? 'true' : 'false'}"
        >
          <img src="${previewUrl}" alt="${CHARACTER_DISPLAY_NAMES[characterId]} idle sprite" />
          <span class="lobby-character-name">${CHARACTER_DISPLAY_NAMES[characterId]}</span>
        </button>
      `;
    }).join('');
  }

  private getLocalCharacterSelection(sortedMembers: string[]): CharacterId {
    return (
      this.lobbyCharacterByPeer.get(this.peerId) ??
      defaultCharacterForPlayer(this.peerId, sortedMembers)
    );
  }

  private assignDefaultCharacterIfMissing(playerId: string): void {
    if (this.lobbyCharacterByPeer.has(playerId)) {
      return;
    }

    const sortedMembers = Array.from(this.lobbyMembers).sort((a, b) => a.localeCompare(b));
    const defaultCharacter = defaultCharacterForPlayer(playerId, sortedMembers);
    this.lobbyCharacterByPeer.set(playerId, defaultCharacter);
    this.game?.setCharacterSelection(playerId, defaultCharacter);
  }

  private ensureLocalCharacterSelection(): void {
    if (!this.isInRoom()) {
      return;
    }

    if (!this.lobbyCharacterByPeer.has(this.peerId)) {
      this.assignDefaultCharacterIfMissing(this.peerId);
      this.broadcastLocalCharacterSelection();
    }
  }

  private selectLocalCharacter(characterId: CharacterId): void {
    if (!this.roomId || !this.signaling || !this.isInRoom() || this.session?.state !== SessionState.Lobby) {
      return;
    }

    this.lobbyCharacterByPeer.set(this.peerId, characterId);
    this.game?.setCharacterSelection(this.peerId, characterId);
    this.broadcastLocalCharacterSelection();
    this.updateUiState();
  }

  private broadcastLocalCharacterSelection(): void {
    if (!this.roomId || !this.signaling) {
      return;
    }

    const sortedMembers = Array.from(this.lobbyMembers).sort((a, b) => a.localeCompare(b));
    const characterId = this.getLocalCharacterSelection(sortedMembers);
    this.lobbyCharacterByPeer.set(this.peerId, characterId);
    this.game?.setCharacterSelection(this.peerId, characterId);

    this.signaling.send({
      type: 'lobby_character_select',
      roomId: this.roomId,
      peerId: this.peerId,
      characterId,
    });
  }

  private broadcastLocalReadyState(): void {
    if (!this.roomId || !this.signaling) {
      return;
    }
    this.signaling.send({
      type: 'lobby_ready',
      roomId: this.roomId,
      peerId: this.peerId,
      ready: this.isLocalReadyInLobby(),
    });
  }

  private applyLobbyCharactersToGame(): void {
    if (!this.game) {
      return;
    }

    const sortedMembers = Array.from(this.lobbyMembers).sort((a, b) => a.localeCompare(b));
    for (const playerId of sortedMembers) {
      if (!this.lobbyCharacterByPeer.has(playerId)) {
        this.assignDefaultCharacterIfMissing(playerId);
      }
    }

    this.game.applyCharacterSelections(this.lobbyCharacterByPeer);
    this.renderer.preloadCharacterTextures(Array.from(this.lobbyCharacterByPeer.values()));
  }

}