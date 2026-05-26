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
  readArenaSideWallsEnabled,
  writeArenaSideWallsEnabled,
} from './arenaOptions';
import { MAX_PLAYERS, TICK_RATE } from './constants';
import { GameRenderer } from './GameRenderer';
import type { CameraMode } from './GameRenderer';
import { HealthBarOverlay } from './HealthBarOverlay';
import { MainMenu, type StatusTone } from './MainMenu';
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

function makePeerId(): string {
  const storedPeerId = readStoredPeerId();
  if (storedPeerId) {
    return storedPeerId;
  }

  const cryptoApi = globalThis.crypto;
  let peerId = '';

  if (cryptoApi?.randomUUID) {
    peerId = `peer-${cryptoApi.randomUUID().slice(0, 8)}`;
  } else if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(4);
    cryptoApi.getRandomValues(bytes);
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 8);
    peerId = `peer-${hex}`;
  } else {
    const fallback = Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0');
    peerId = `peer-${fallback}`;
  }

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

  private readonly peerId: string;
  private readonly mainMenu: MainMenu;
  private readonly settingsMenu: SettingsMenu;
  private readonly stockHud: StockHud;

  private readonly gameHud: HTMLElement;
  private readonly statusBadge: HTMLElement;
  private readonly leaveButton: HTMLButtonElement;
  private readonly cameraToggleButton: HTMLButtonElement;
  private readonly settingsToggleButton: HTMLButtonElement;
  private readonly healthBarOverlay: HealthBarOverlay;

  private readonly tickValue: HTMLElement;
  private readonly confirmedTickValue: HTMLElement;
  private readonly rollbackCountValue: HTMLElement;
  private readonly rollbackTicksValue: HTMLElement;
  private readonly desyncCountValue: HTMLElement;
  private readonly peerCountValue: HTMLElement;
  private readonly playerCountValue: HTMLElement;
  private readonly rttValue: HTMLElement;

  private signaling: SignalingClient | null = null;
  private transport: WebRTCTransport | null = null;
  private session: Session | null = null;
  private game: RollbackPhysicsGame | null = null;

  private roomId: string | null = null;
  private hostPeerId: string | null = null;
  private currentShareUrl = '';
  private settingsOpen = false;
  private cameraMode: CameraMode = 'follow';
  private readonly cameraPanInput = {
    left: false,
    right: false,
    up: false,
    down: false,
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
  private isCleaningUp = false;

  private unsubscribeSignalMessages: (() => void) | null = null;
  private unsubscribeSignalClose: (() => void) | null = null;

  private animationFrameId = 0;
  private fixedStepMs = 1000 / TICK_RATE;
  private lastFrameTimeMs = 0;
  private accumulatedTimeMs = 0;
  private connecting = false;

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
      event.code === 'KeyI' ||
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
    if (event.code === 'KeyI') {
      this.inputState.shoot = true;
    }
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      this.inputState.dash = true;
    }

    if (event.code === 'Escape' && this.isInRoom()) {
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
    if (event.code === 'KeyI') {
      this.inputState.shoot = false;
    }
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      this.inputState.dash = false;
    }
  };

  constructor(root: HTMLElement) {
    this.root = root;
    this.peerId = makePeerId();

    this.root.innerHTML = this.renderAppTemplate();

    this.viewport = requireElement<HTMLElement>(this.root, '#viewport');
    this.renderer = new GameRenderer(this.viewport, this.mapDefinition);
    this.stockHud = new StockHud(this.viewport);

    this.gameHud = requireElement<HTMLElement>(this.root, '#gameHud');
    this.statusBadge = requireElement<HTMLElement>(this.root, '#statusBadge');
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
    });

    this.syncArenaSideWallsUi(readArenaSideWallsEnabled());

    this.mainMenu.setPeerId(this.peerId);
    this.mainMenu.setSignalUrl(this.defaultSignalUrl());
    this.settingsMenu.setPeerId(this.peerId);
    this.settingsMenu.setMap(this.getSelectedMapManifest());

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

    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);

    this.updateUiState();
    this.refreshDebugValues();
    this.setStatus('Initializing Rapier runtime...');
  }

  async start(): Promise<void> {
    await RAPIER.init();

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

    if (this.cameraMode === 'free') {
      this.updateFreeCamera(frameDelta / 1000);
    }

    if (this.game) {
      const renderState = this.game.getRenderState();
      this.renderer.render(renderState, this.peerId);
      if (this.isInRoom() || this.connecting) {
        this.stockHud.update(renderState.players, this.peerId);
      }

      const localPlayer = renderState.players.find(
        (player: { id: string; health: number; maxHealth: number }) =>
          player.id === this.peerId,
      );
      if (localPlayer) {
        this.healthBarOverlay.update(localPlayer.health, localPlayer.maxHealth);
      } else {
        this.healthBarOverlay.hide();
      }
    }

    this.refreshDebugValues();
    this.animationFrameId = requestAnimationFrame(this.onFrame);
  };

  private tickSimulation(): void {
    if (!this.session) {
      return;
    }

    const input = encodeInput(this.inputState);

    let tickResult: TickResult;
    try {
      tickResult = this.session.tick(input);
    } catch (error) {
      this.debugCounters.errorCount += 1;
      this.setStatus(
        `Session tick failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'error',
      );
      return;
    }

    if (tickResult.rolledBack) {
      this.debugCounters.rollbackCount += 1;
      this.debugCounters.rollbackTicks += tickResult.rollbackTicks ?? 0;
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

      this.setRoomState(roomId, this.peerId);
      this.recoveryState = {
        mode: 'host',
        mapId: this.selectedMapId,
        roomId,
        hostPeerId: this.peerId,
        signalUrl: this.getCurrentSignalUrl(),
      };
      storeRecoveryState(this.recoveryState);
      this.session.start();
      this.setStatus(
        preferredRoomId
          ? `Recovered host room ${roomId}.`
          : `Hosting room ${roomId}. Open Settings or share the URL to invite players.`,
      );
    } catch (error) {
      this.setStatus(
        `Unable to host room: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'error',
      );
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
      this.setRoomState(roomId, resolvedHostPeer);
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
    } catch (error) {
      this.setStatus(
        `Unable to join room: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'error',
      );
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
    this.settingsOpen = false;
    this.cleanupNetworking({ sendLeave: true });
    this.clearCameraInput();
    this.setCameraMode('follow');

    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete('room');
    currentUrl.searchParams.delete('host');
    history.replaceState({}, '', currentUrl.toString());

    this.currentShareUrl = '';
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
      this.setStatus(
        `WebRTC transport error${peerId ? ` (${peerId})` : ''}: ${error.message}`,
        'error',
      );
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
        snapshotHistorySize: TICK_RATE * 4,
        maxSpeculationTicks: TICK_RATE * 2,
        debug: false,
      },
    });

    this.session.on('stateChange', (nextState) => {
      this.statusBadge.textContent = sessionStateLabel(nextState);
      this.updateUiState();
    });

    this.session.on('playerJoined', (player) => {
      this.setStatus(`Player joined: ${player.id}`);
    });

    this.session.on('playerLeft', (player) => {
      this.setStatus(`Player left cleanly: ${player.id}`);
    });

    this.session.on('playerDropped', (playerId) => {
      this.setStatus(`Player disconnected abruptly and was removed: ${playerId}`);
    });

    this.session.on('gameStart', () => {
      this.setStatus('Game started. Rollback simulation is active.');
    });

    this.session.on('desync', (tick, localHash, remoteHash) => {
      this.debugCounters.desyncCount += 1;
      this.setStatus(
        `Desync at tick ${tick}: local=${localHash} remote=${remoteHash}`,
        'error',
      );
    });

    this.session.on('error', (error, context) => {
      this.debugCounters.errorCount += 1;
      this.setStatus(
        `Session error (${context.source}): ${error.message}`,
        'error',
      );
    });

    const sessionOnConnect = this.transport.onConnect;
    const sessionOnDisconnect = this.transport.onDisconnect;

    this.transport.onConnect = (peerId: string) => {
      sessionOnConnect?.(peerId);
      this.setStatus(`WebRTC peer connected: ${peerId}`);
    };

    this.transport.onDisconnect = (peerId: string) => {
      const isHostDroppingPeer =
        this.session?.isHost &&
        this.session.state !== SessionState.Disconnected &&
        peerId !== this.peerId;

      if (isHostDroppingPeer) {
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

      sessionOnDisconnect?.(peerId);
    };

    this.setStatus('Connected to signaling server.');
    this.statusBadge.textContent = sessionStateLabel(this.session.state);
  }

  private cleanupNetworking(options: { sendLeave?: boolean } = {}): void {
    const { sendLeave = false } = options;

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

        this.setRoomState(recoveryState.roomId, this.peerId);
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
        this.setRoomState(recoveryState.roomId, resolvedHostPeer);
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
        break;

      case 'peer_left':
        this.setStatus(`Peer left room: ${message.peerId}`);
        break;

      case 'room_joined':
        this.hostPeerId = message.hostPeerId;
        this.mainMenu.setHostPeerId(message.hostPeerId);
        this.settingsMenu.setHostPeerId(message.hostPeerId);
        break;

      case 'room_hosted':
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

  private setRoomState(roomId: string, hostPeerId: string): void {
    this.roomId = roomId;
    this.hostPeerId = hostPeerId;

    this.mainMenu.setRoomId(roomId);
    this.mainMenu.setHostPeerId(hostPeerId);
    this.settingsMenu.setRoomId(roomId);
    this.settingsMenu.setHostPeerId(hostPeerId);
    this.settingsMenu.setMap(this.getSelectedMapManifest());

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

  private isInRoom(): boolean {
    return (
      this.session !== null && this.session.state !== SessionState.Disconnected
    );
  }

  private toggleSettings(): void {
    if (!this.isInRoom() && !this.connecting) {
      return;
    }
    this.settingsOpen = !this.settingsOpen;
    this.updateUiState();
  }

  private syncArenaSideWallsUi(enabled: boolean): void {
    this.mainMenu.setArenaSideWallsEnabled(enabled);
    this.settingsMenu.setArenaSideWallsEnabled(enabled);
  }

  private applyArenaSideWalls(enabled: boolean): void {
    writeArenaSideWallsEnabled(enabled);
    this.syncArenaSideWallsUi(enabled);
    this.game?.setSideWallsEnabled(enabled);
    this.renderer.setSideWallsEnabled(enabled);

    const wallLabel = enabled ? 'on' : 'off';
    const syncHint = this.isInRoom()
      ? ' All players in the room should use the same setting to avoid desync.'
      : '';
    this.setStatus(`Arena side walls ${wallLabel}.${syncHint}`);
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

    this.gameHud.dataset.visible = inActiveSession ? 'true' : 'false';
    this.stockHud.setVisible(inActiveSession);
    this.leaveButton.disabled = !inRoom || this.connecting;

    if (this.settingsOpen && inActiveSession) {
      this.settingsMenu.show();
    } else {
      this.settingsMenu.hide();
      if (!inActiveSession) {
        this.settingsOpen = false;
      }
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

        <section class="panel debug-panel">
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

    if (moveX === 0 && moveY === 0) {
      return;
    }

    this.renderer.panFreeCamera(
      moveX * this.cameraMoveSpeed * deltaSeconds,
      moveY * this.cameraMoveSpeed * deltaSeconds,
    );
  }
}
