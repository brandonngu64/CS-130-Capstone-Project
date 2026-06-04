import type { SignalMessage } from 'rollback-netcode';

export type ClientToServerMessage =
  | {
      type: 'host_room';
      roomId: string;
      peerId: string;
      maxPlayers: number;
    }
  | {
      type: 'join_room';
      roomId: string;
      peerId: string;
    }
  | {
      type: 'leave_room';
      roomId: string;
      peerId: string;
    }
  | {
      type: 'signal';
      roomId: string;
      fromPeerId: string;
      toPeerId: string;
      signal: SignalMessage;
    }
  | {
      type: 'lobby_ready';
      roomId: string;
      peerId: string;
      ready: boolean;
    }
  | {
      type: 'lobby_character_select';
      roomId: string;
      peerId: string;
      characterId: string;
    };

export type ServerToClientMessage =
  | {
      type: 'room_hosted';
      roomId: string;
      hostPeerId: string;
      members: string[];
    }
  | {
      type: 'room_joined';
      roomId: string;
      hostPeerId: string;
      members: string[];
    }
  | {
      type: 'peer_joined';
      roomId: string;
      peerId: string;
    }
  | {
      type: 'peer_left';
      roomId: string;
      peerId: string;
    }
  | {
      type: 'signal';
      roomId: string;
      fromPeerId: string;
      signal: SignalMessage;
    }
  | {
      type: 'room_error';
      code: string;
      message: string;
    }
  | {
      type: 'lobby_ready';
      roomId: string;
      peerId: string;
      ready: boolean;
    }
  | {
      type: 'lobby_character_select';
      roomId: string;
      peerId: string;
      characterId: string;
    };

export class SignalingClient {
  private socket: WebSocket | null = null;
  private readonly messageHandlers = new Set<
    (message: ServerToClientMessage) => void
  >();
  private readonly closeHandlers = new Set<(event: CloseEvent) => void>();

  async connect(url: string): Promise<void> {
    if (this.socket) {
      this.disconnect();
    }

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;

      const timeoutId = window.setTimeout(() => {
        socket.close();
        reject(new Error('Timed out while connecting to signaling server'));
      }, 8000);

      socket.addEventListener('open', () => {
        clearTimeout(timeoutId);
        resolve();
      });

      socket.addEventListener('error', () => {
        clearTimeout(timeoutId);
        reject(new Error('Failed to connect to signaling server'));
      });

      socket.addEventListener('message', (event) => {
        const parsed = this.safeParseMessage(event.data);
        if (!parsed) {
          return;
        }
        for (const handler of this.messageHandlers) {
          handler(parsed);
        }
      });

      socket.addEventListener('close', (event) => {
        for (const handler of this.closeHandlers) {
          handler(event);
        }
      });
    });
  }

  send(message: ClientToServerMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  sendSignal(
    roomId: string,
    fromPeerId: string,
    toPeerId: string,
    signal: SignalMessage,
  ): void {
    this.send({
      type: 'signal',
      roomId,
      fromPeerId,
      toPeerId,
      signal,
    });
  }

  onMessage(handler: (message: ServerToClientMessage) => void): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onClose(handler: (event: CloseEvent) => void): () => void {
    this.closeHandlers.add(handler);
    return () => {
      this.closeHandlers.delete(handler);
    };
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  private safeParseMessage(raw: unknown): ServerToClientMessage | null {
    if (typeof raw !== 'string') {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as { type?: unknown };
      if (typeof parsed?.type !== 'string') {
        return null;
      }
      return parsed as ServerToClientMessage;
    } catch {
      return null;
    }
  }
}
