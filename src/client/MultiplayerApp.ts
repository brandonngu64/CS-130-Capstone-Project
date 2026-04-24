import * as RAPIER from '@dimforge/rapier2d-compat';
import {
  SessionState,
  Topology,
  WebRTCTransport,
  createSession,
  type InputPredictor,
  type Session,
  type SignalMessage,
  type TickResult,
} from 'rollback-netcode';
import { MAX_PLAYERS, TICK_RATE } from './constants';
import { GameRenderer } from './GameRenderer';
import { RollbackPhysicsGame } from './RollbackPhysicsGame';
import { SignalingClient, type ServerToClientMessage } from './SignalingClient';
import { encodeInput } from './input';

type StatusTone = 'normal' | 'error';

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
};

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
  const cryptoApi = globalThis.crypto;

  if (cryptoApi?.randomUUID) {
    return `peer-${cryptoApi.randomUUID().slice(0, 8)}`;
  }

  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(4);
    cryptoApi.getRandomValues(bytes);
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 8);
    return `peer-${hex}`;
  }

  const fallback = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0');
  return `peer-${fallback}`;
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
  private readonly renderer: GameRenderer;

  private readonly peerId: string;
  private readonly statusBadge: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly peerIdValue: HTMLElement;
  private readonly shareUrlInput: HTMLInputElement;
  private readonly roomInput: HTMLInputElement;
  private readonly hostInput: HTMLInputElement;
  private readonly signalInput: HTMLInputElement;
  private readonly hostButton: HTMLButtonElement;
  private readonly joinButton: HTMLButtonElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly leaveButton: HTMLButtonElement;

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

  private readonly inputState: InputState = {
    left: false,
    right: false,
    jump: false,
  };

  private readonly debugCounters: DebugCounters = {
    rollbackCount: 0,
    rollbackTicks: 0,
    desyncCount: 0,
    errorCount: 0,
  };

  private unsubscribeSignalMessages: (() => void) | null = null;
  private unsubscribeSignalClose: (() => void) | null = null;

  private animationFrameId = 0;
  private fixedStepMs = 1000 / TICK_RATE;
  private lastFrameTimeMs = 0;
  private accumulatedTimeMs = 0;
  private connecting = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (
      event.code === 'ArrowLeft' ||
      event.code === 'KeyA' ||
      event.code === 'ArrowRight' ||
      event.code === 'KeyD' ||
      event.code === 'ArrowUp' ||
      event.code === 'KeyW' ||
      event.code === 'Space'
    ) {
      event.preventDefault();
    }

    if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
      this.inputState.left = true;
    }
    if (event.code === 'ArrowRight' || event.code === 'KeyD') {
      this.inputState.right = true;
    }
    if (
      event.code === 'ArrowUp' ||
      event.code === 'KeyW' ||
      event.code === 'Space'
    ) {
      this.inputState.jump = true;
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
      this.inputState.left = false;
    }
    if (event.code === 'ArrowRight' || event.code === 'KeyD') {
      this.inputState.right = false;
    }
    if (
      event.code === 'ArrowUp' ||
      event.code === 'KeyW' ||
      event.code === 'Space'
    ) {
      this.inputState.jump = false;
    }
  };

  constructor(root: HTMLElement) {
    this.root = root;
    this.peerId = makePeerId();

    this.root.innerHTML = this.renderAppTemplate();

    const viewport = requireElement<HTMLElement>(this.root, '#viewport');
    this.renderer = new GameRenderer(viewport);

    this.statusBadge = requireElement<HTMLElement>(this.root, '#statusBadge');
    this.statusText = requireElement<HTMLElement>(this.root, '#statusText');
    this.peerIdValue = requireElement<HTMLElement>(this.root, '#peerIdValue');
    this.shareUrlInput = requireElement<HTMLInputElement>(this.root, '#shareUrl');
    this.roomInput = requireElement<HTMLInputElement>(this.root, '#roomInput');
    this.hostInput = requireElement<HTMLInputElement>(this.root, '#hostInput');
    this.signalInput = requireElement<HTMLInputElement>(this.root, '#signalInput');
    this.hostButton = requireElement<HTMLButtonElement>(this.root, '#hostButton');
    this.joinButton = requireElement<HTMLButtonElement>(this.root, '#joinButton');
    this.copyButton = requireElement<HTMLButtonElement>(this.root, '#copyButton');
    this.leaveButton = requireElement<HTMLButtonElement>(this.root, '#leaveButton');

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

    this.peerIdValue.textContent = this.peerId;
    this.signalInput.value = this.defaultSignalUrl();

    this.hostButton.addEventListener('click', () => {
      void this.handleHostRoom();
    });
    this.joinButton.addEventListener('click', () => {
      void this.handleJoinRoom();
    });
    this.copyButton.addEventListener('click', () => {
      void this.copyShareLink();
    });
    this.leaveButton.addEventListener('click', () => {
      this.leaveRoom();
    });

    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);

    this.updateButtons();
    this.refreshDebugValues();
    this.setStatus('Initializing Rapier runtime...');
  }

  async start(): Promise<void> {
    await RAPIER.init();

    if (!this.game) {
      this.game = new RollbackPhysicsGame();
    }

    this.setStatus('Ready. Host a room or join from a shared URL.');
    this.statusBadge.textContent = sessionStateLabel(SessionState.Disconnected);

    this.lastFrameTimeMs = performance.now();
    this.animationFrameId = requestAnimationFrame(this.onFrame);

    const currentUrl = new URL(window.location.href);
    const roomId = currentUrl.searchParams.get('room');
    const hostPeer = currentUrl.searchParams.get('host');
    const signalUrl = currentUrl.searchParams.get('signal');

    if (roomId) {
      this.roomInput.value = roomId;
    }
    if (hostPeer) {
      this.hostInput.value = hostPeer;
    }
    if (signalUrl) {
      this.signalInput.value = signalUrl;
    }

    if (roomId && hostPeer) {
      this.setStatus('Detected room URL. Attempting to join...');
      await this.handleJoinRoom();
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

    if (this.game) {
      this.renderer.render(this.game.getRenderState(), this.peerId);
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

  private async handleHostRoom(): Promise<void> {
    if (this.connecting) {
      return;
    }

    this.connecting = true;
    this.updateButtons();

    try {
      await this.prepareNetworking();
      if (!this.session || !this.signaling) {
        throw new Error('Network stack is not ready');
      }

      const createdRoomId = await this.session.createRoom();
      this.roomId = createdRoomId;
      this.hostPeerId = this.peerId;

      this.signaling.send({
        type: 'host_room',
        roomId: createdRoomId,
        peerId: this.peerId,
        maxPlayers: MAX_PLAYERS,
      });

      const response = await this.waitForSignalMessage(
        (message) =>
          (message.type === 'room_hosted' && message.roomId === createdRoomId) ||
          message.type === 'room_error',
        7000,
      );

      if (response.type === 'room_error') {
        throw new Error(response.message);
      }

      this.roomInput.value = createdRoomId;
      this.hostInput.value = this.peerId;
      this.setShareUrl(createdRoomId, this.peerId);

      this.session.start();
      this.setStatus(`Hosting room ${createdRoomId}. Share the join URL.`);
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
      this.updateButtons();
    }
  }

  private async handleJoinRoom(): Promise<void> {
    if (this.connecting) {
      return;
    }

    const roomId = this.roomInput.value.trim();
    const hostPeerId = this.hostInput.value.trim();

    if (!roomId || !hostPeerId) {
      this.setStatus('Room ID and host peer ID are required to join.', 'error');
      return;
    }

    this.connecting = true;
    this.updateButtons();

    try {
      await this.prepareNetworking();
      if (!this.session || !this.signaling) {
        throw new Error('Network stack is not ready');
      }

      this.roomId = roomId;
      this.hostPeerId = hostPeerId;

      this.signaling.send({
        type: 'join_room',
        roomId,
        peerId: this.peerId,
      });

      const response = await this.waitForSignalMessage(
        (message) =>
          (message.type === 'room_joined' && message.roomId === roomId) ||
          message.type === 'room_error',
        9000,
      );

      if (response.type === 'room_error') {
        throw new Error(response.message);
      }

      if (response.type !== 'room_joined') {
        throw new Error('Unexpected signaling response while joining room');
      }

      const resolvedHostPeer = response.hostPeerId || hostPeerId;
      this.hostPeerId = resolvedHostPeer;
      this.hostInput.value = resolvedHostPeer;

      await this.session.joinRoom(roomId, resolvedHostPeer);
      this.setShareUrl(roomId, resolvedHostPeer);
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
      this.updateButtons();
    }
  }

  private async copyShareLink(): Promise<void> {
    const url = this.shareUrlInput.value.trim();
    if (!url) {
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      this.setStatus('Room URL copied to clipboard.');
    } catch {
      this.shareUrlInput.select();
      this.setStatus('Clipboard blocked. URL selected for manual copy.', 'error');
    }
  }

  private leaveRoom(): void {
    this.cleanupNetworking();

    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete('room');
    currentUrl.searchParams.delete('host');
    history.replaceState({}, '', currentUrl.toString());

    this.shareUrlInput.value = '';
    this.roomInput.value = '';
    this.hostInput.value = '';

    this.setStatus('Left room. Host or join another session.');
    this.statusBadge.textContent = sessionStateLabel(SessionState.Disconnected);

    this.debugCounters.rollbackCount = 0;
    this.debugCounters.rollbackTicks = 0;
    this.debugCounters.desyncCount = 0;
    this.debugCounters.errorCount = 0;

    this.game?.reset();
    this.updateButtons();
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
    await this.signaling.connect(this.signalInput.value.trim() || this.defaultSignalUrl());

    this.unsubscribeSignalMessages = this.signaling.onMessage((message) => {
      void this.handleSignalingMessage(message);
    });

    this.unsubscribeSignalClose = this.signaling.onClose(() => {
      if (this.session?.state !== SessionState.Disconnected) {
        this.setStatus('Disconnected from signaling server.', 'error');
      }
    });

    this.transport = new WebRTCTransport(this.peerId, {
      rtcConfiguration: {
        iceServers: [
          { urls: 'stun:stun.cloudflare.com:3478' },
          { urls: 'stun:stun.l.google.com:19302' },
        ],
      },
      connectionTimeout: 20000,
    });

    this.transport.setSignalingCallbacks({
      onSignal: (targetPeerId: string, signal: SignalMessage) => {
        if (!this.signaling || !this.roomId) {
          return;
        }

        this.signaling.send({
          type: 'signal',
          roomId: this.roomId,
          fromPeerId: this.peerId,
          toPeerId: targetPeerId,
          signal,
        });
      },
    });

    this.session = createSession({
      game,
      transport: this.transport,
      inputPredictor: new RepeatLastInputPredictor(),
      config: {
        tickRate: TICK_RATE,
        maxPlayers: MAX_PLAYERS,
        topology: Topology.Star,
        hashInterval: TICK_RATE,
        snapshotHistorySize: TICK_RATE * 4,
        maxSpeculationTicks: TICK_RATE * 2,
        debug: false,
      },
    });

    this.session.on('stateChange', (nextState) => {
      this.statusBadge.textContent = sessionStateLabel(nextState);
    });

    this.session.on('playerJoined', (player) => {
      this.setStatus(`Player joined: ${player.id}`);
    });

    this.session.on('playerLeft', (player) => {
      this.setStatus(`Player left: ${player.id}`);
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

    this.setStatus('Connected to signaling server.');
    this.statusBadge.textContent = sessionStateLabel(this.session.state);
  }

  private cleanupNetworking(): void {
    if (this.signaling && this.roomId) {
      this.signaling.send({
        type: 'leave_room',
        roomId: this.roomId,
        peerId: this.peerId,
      });
    }

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
        this.hostInput.value = message.hostPeerId;
        break;

      case 'room_hosted':
        break;

      case 'room_error':
        this.setStatus(message.message, 'error');
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

  private setShareUrl(roomId: string, hostPeerId: string): void {
    const current = new URL(window.location.href);
    current.searchParams.set('room', roomId);
    current.searchParams.set('host', hostPeerId);

    const signalUrl = this.signalInput.value.trim();
    if (signalUrl && signalUrl !== this.defaultSignalUrl()) {
      current.searchParams.set('signal', signalUrl);
    } else {
      current.searchParams.delete('signal');
    }

    history.replaceState({}, '', current.toString());
    this.shareUrlInput.value = current.toString();
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
    this.statusText.textContent = message;
    this.statusText.dataset.tone = tone;
  }

  private updateButtons(): void {
    const inRoom =
      this.session !== null && this.session.state !== SessionState.Disconnected;

    this.hostButton.disabled = this.connecting || inRoom;
    this.joinButton.disabled = this.connecting || inRoom;
    this.leaveButton.disabled = this.connecting || !inRoom;
    this.copyButton.disabled = !this.shareUrlInput.value;
  }

  private defaultSignalUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.hostname}:3000`;
  }

  private renderAppTemplate(): string {
    return `
      <div class="app-shell">
        <header class="topbar">
          <div>
            <p class="eyebrow">CS130 Multiplayer Baseline</p>
            <h1>Rollback Jump Arena</h1>
          </div>
          <div class="state-pill">
            <span>Session</span>
            <strong id="statusBadge">Disconnected</strong>
          </div>
        </header>

        <section class="panel controls-panel">
          <div class="controls-grid">
            <label>
              <span>Peer ID</span>
              <output id="peerIdValue"></output>
            </label>
            <label>
              <span>Signaling URL</span>
              <input id="signalInput" type="text" />
            </label>
            <label>
              <span>Room ID</span>
              <input id="roomInput" type="text" placeholder="room-xxxx" />
            </label>
            <label>
              <span>Host Peer ID</span>
              <input id="hostInput" type="text" placeholder="peer-xxxx" />
            </label>
          </div>

          <div class="actions-row">
            <button id="hostButton" class="action-primary" type="button">Host Room</button>
            <button id="joinButton" class="action-secondary" type="button">Join Room</button>
            <button id="leaveButton" class="action-ghost" type="button">Leave</button>
          </div>

          <label class="share-field">
            <span>Shared Room URL</span>
            <div>
              <input id="shareUrl" type="text" readonly />
              <button id="copyButton" type="button">Copy</button>
            </div>
          </label>

          <p id="statusText" data-tone="normal">Preparing game...</p>
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
          <p class="controls-hint">Controls: A/D or Arrow keys to move, W/Up/Space to jump.</p>
        </section>

        <section id="viewport" class="panel viewport-panel"></section>
      </div>
    `;
  }
}
