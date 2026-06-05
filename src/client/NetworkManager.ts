import type { GameEvent, ClientMessage, ServerMessage } from '../shared/GameEvents';

type NetworkEventListener = (event: GameEvent) => void;
type ConnectionStateListener = (connected: boolean) => void;

export class NetworkManager {
  private socket: WebSocket | null = null;
  private url: string;
  private roomId: string;
  private playerId: string;
  private connected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private currentTick = 0;

  private eventListeners = new Set<NetworkEventListener>();
  private connectionListeners = new Set<ConnectionStateListener>();

  constructor(url: string, roomId: string, playerId: string) {
    this.url = url;
    this.roomId = roomId;
    this.playerId = playerId;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.socket = new WebSocket(this.url);

        this.socket.onopen = () => {
          console.log('Connected to server');
          this.connected = true;
          this.reconnectAttempts = 0;
          this.setupHeartbeat();
          this.notifyConnectionListeners(true);
          resolve();
        };

        this.socket.onmessage = (event) => {
          this.handleServerMessage(event.data);
        };

        this.socket.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.handleConnectionError();
          reject(new Error('Failed to connect to server'));
        };

        this.socket.onclose = () => {
          console.log('Disconnected from server');
          this.connected = false;
          this.clearHeartbeat();
          this.notifyConnectionListeners(false);
          this.attemptReconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.connected = false;
    this.clearHeartbeat();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private handleConnectionError(): void {
    this.connected = false;
    this.clearHeartbeat();
    this.notifyConnectionListeners(false);
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);

    console.log(`Attempting to reconnect in ${delay}ms...`);
    this.reconnectTimeout = setTimeout(() => {
      this.connect().catch((error) => {
        console.error('Reconnection failed:', error);
      });
    }, delay);
  }

  private setupHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this.sendMessage({
        type: 'ping',
        roomId: this.roomId,
        playerId: this.playerId,
      });
    }, 30000); // Every 30 seconds
  }

  private clearHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private handleServerMessage(rawData: string): void {
    try {
      const message = JSON.parse(rawData) as ServerMessage;

      switch (message.type) {
        case 'game_event': {
          const gameEvent = message.data as GameEvent;
          this.currentTick = gameEvent.tick;
          this.notifyEventListeners(gameEvent);
          break;
        }

        case 'full_state_snapshot': {
          const gameEvent = message.data as GameEvent;
          this.currentTick = gameEvent.tick;
          this.notifyEventListeners(gameEvent);
          break;
        }

        case 'acknowledgment': {
          const ack = message.data as any;
          if (!ack.success) {
            console.error('Server error:', ack.error);
          }
          break;
        }

        case 'pong': {
          // Heartbeat response
          break;
        }
      }
    } catch (error) {
      console.error('Error parsing server message:', error);
    }
  }

  sendPlayerInput(actions: Record<string, boolean>): void {
    if (!this.connected || !this.socket) {
      return;
    }

    const message: ClientMessage = {
      type: 'player_input',
      roomId: this.roomId,
      playerId: this.playerId,
      data: {
        tick: this.currentTick,
        actions,
      },
    };

    this.sendMessage(message);
  }

  joinGame(mapId: string, maxPlayers: number): void {
    if (!this.connected || !this.socket) {
      return;
    }

    const message: ClientMessage = {
      type: 'join_game',
      roomId: this.roomId,
      playerId: this.playerId,
      data: { mapId, maxPlayers },
    };

    this.sendMessage(message);
  }

  leaveGame(): void {
    if (!this.connected || !this.socket) {
      return;
    }

    const message: ClientMessage = {
      type: 'leave_game',
      roomId: this.roomId,
      playerId: this.playerId,
    };

    this.sendMessage(message);
  }

  private sendMessage(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('Not connected to server');
      return;
    }

    try {
      this.socket.send(JSON.stringify(message));
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }

  onGameEvent(listener: NetworkEventListener): void {
    this.eventListeners.add(listener);
  }

  offGameEvent(listener: NetworkEventListener): void {
    this.eventListeners.delete(listener);
  }

  private notifyEventListeners(event: GameEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  onConnectionStateChanged(listener: ConnectionStateListener): void {
    this.connectionListeners.add(listener);
  }

  offConnectionStateChanged(listener: ConnectionStateListener): void {
    this.connectionListeners.delete(listener);
  }

  private notifyConnectionListeners(connected: boolean): void {
    for (const listener of this.connectionListeners) {
      listener(connected);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getCurrentTick(): number {
    return this.currentTick;
  }
}
