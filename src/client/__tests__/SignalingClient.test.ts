import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SignalingClient, type ServerToClientMessage } from '../SignalingClient';

type FakeWebSocketEventMap = {
  close: CloseEvent;
  error: Event;
  message: MessageEvent;
  open: Event;
};

type FakeWebSocketListener<T extends keyof FakeWebSocketEventMap> = (
  event: FakeWebSocketEventMap[T],
) => void;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly sentMessages: string[] = [];
  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;

  private readonly listeners: {
    [K in keyof FakeWebSocketEventMap]: Set<FakeWebSocketListener<K>>;
  } = {
    close: new Set(),
    error: new Set(),
    message: new Set(),
    open: new Set(),
  };

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener<T extends keyof FakeWebSocketEventMap>(
    type: T,
    listener: FakeWebSocketListener<T>,
  ): void {
    this.listeners[type].add(listener);
  }

  send(message: string): void {
    this.sentMessages.push(message);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch('close', { code: 1000 } as CloseEvent);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch('open', new Event('open'));
  }

  fail(): void {
    this.dispatch('error', new Event('error'));
  }

  receive(data: unknown): void {
    this.dispatch('message', { data } as MessageEvent);
  }

  private dispatch<T extends keyof FakeWebSocketEventMap>(
    type: T,
    event: FakeWebSocketEventMap[T],
  ): void {
    for (const listener of this.listeners[type]) {
      listener(event);
    }
  }
}

const originalWebSocket = globalThis.WebSocket;
const originalWindow = globalThis.window;

function latestSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (!socket) {
    throw new Error('Expected a FakeWebSocket instance to be created.');
  }
  return socket;
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.useRealTimers();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalWebSocket) {
    vi.stubGlobal('WebSocket', originalWebSocket);
  }
  if (originalWindow) {
    vi.stubGlobal('window', originalWindow);
  }
});

describe('signaling connection lifecycle', () => {
  it('connects to the requested websocket URL after the socket opens', async () => {
    const client = new SignalingClient();
    const connection = client.connect('ws://example.test/ws');

    expect(latestSocket().url).toBe('ws://example.test/ws');
    latestSocket().open();

    await expect(connection).resolves.toBeUndefined();
  });

  it('rejects the connection attempt when the socket reports an error', async () => {
    const client = new SignalingClient();
    const connection = client.connect('ws://example.test/ws');

    latestSocket().fail();

    await expect(connection).rejects.toThrow('Failed to connect to signaling server');
  });

  it('closes an existing socket before reconnecting', async () => {
    const client = new SignalingClient();
    const firstConnection = client.connect('ws://example.test/first');
    const firstSocket = latestSocket();
    firstSocket.open();
    await firstConnection;

    const secondConnection = client.connect('ws://example.test/second');
    const secondSocket = latestSocket();
    secondSocket.open();
    await secondConnection;

    expect(firstSocket.readyState).toBe(FakeWebSocket.CLOSED);
    expect(secondSocket.url).toBe('ws://example.test/second');
  });

  it('notifies registered close handlers and supports unsubscribing them', async () => {
    const client = new SignalingClient();
    const closeHandler = vi.fn();
    const unsubscribe = client.onClose(closeHandler);
    const connection = client.connect('ws://example.test/ws');
    latestSocket().open();
    await connection;

    latestSocket().close();
    unsubscribe();
    latestSocket().close();

    expect(closeHandler).toHaveBeenCalledTimes(1);
    expect(closeHandler.mock.calls[0][0]).toMatchObject({ code: 1000 });
  });
});

describe('signaling message receive behavior', () => {
  it('delivers valid server messages to all registered handlers', async () => {
    const client = new SignalingClient();
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    client.onMessage(firstHandler);
    client.onMessage(secondHandler);
    const connection = client.connect('ws://example.test/ws');
    latestSocket().open();
    await connection;

    const message: ServerToClientMessage = {
      type: 'room_hosted',
      roomId: 'room-1',
      hostPeerId: 'host',
      members: ['host'],
    };
    latestSocket().receive(JSON.stringify(message));

    expect(firstHandler).toHaveBeenCalledWith(message);
    expect(secondHandler).toHaveBeenCalledWith(message);
  });

  it('ignores malformed messages, non-string payloads, and JSON without a type', async () => {
    const client = new SignalingClient();
    const handler = vi.fn();
    client.onMessage(handler);
    const connection = client.connect('ws://example.test/ws');
    latestSocket().open();
    await connection;

    latestSocket().receive('{bad json');
    latestSocket().receive(JSON.stringify({ roomId: 'room-1' }));
    latestSocket().receive({ type: 'room_hosted' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('stops delivering messages to unsubscribed handlers', async () => {
    const client = new SignalingClient();
    const keptHandler = vi.fn();
    const removedHandler = vi.fn();
    client.onMessage(keptHandler);
    const unsubscribe = client.onMessage(removedHandler);
    unsubscribe();
    const connection = client.connect('ws://example.test/ws');
    latestSocket().open();
    await connection;

    latestSocket().receive(JSON.stringify({ type: 'peer_left', roomId: 'room-1', peerId: 'guest' }));

    expect(keptHandler).toHaveBeenCalledTimes(1);
    expect(removedHandler).not.toHaveBeenCalled();
  });
});

describe('signaling send behavior', () => {
  it('serializes client messages when the socket is open', async () => {
    const client = new SignalingClient();
    const connection = client.connect('ws://example.test/ws');
    latestSocket().open();
    await connection;

    client.send({ type: 'host_room', roomId: 'room-1', peerId: 'host', maxPlayers: 4 });

    expect(latestSocket().sentMessages).toEqual([
      JSON.stringify({ type: 'host_room', roomId: 'room-1', peerId: 'host', maxPlayers: 4 }),
    ]);
  });

  it('builds signal relay messages with source and target peer ids', async () => {
    const client = new SignalingClient();
    const connection = client.connect('ws://example.test/ws');
    latestSocket().open();
    await connection;

    client.sendSignal('room-1', 'host', 'guest', {
      type: 'candidate',
      candidate: { candidate: 'candidate-value' },
    });

    expect(JSON.parse(latestSocket().sentMessages[0])).toEqual({
      type: 'signal',
      roomId: 'room-1',
      fromPeerId: 'host',
      toPeerId: 'guest',
      signal: {
        type: 'candidate',
        candidate: { candidate: 'candidate-value' },
      },
    });
  });

  it('does not send when disconnected or before the socket opens', () => {
    const client = new SignalingClient();

    client.send({ type: 'join_room', roomId: 'room-1', peerId: 'guest' });
    const connection = client.connect('ws://example.test/ws');
    client.send({ type: 'join_room', roomId: 'room-1', peerId: 'guest' });

    expect(latestSocket().sentMessages).toEqual([]);
    latestSocket().fail();
    void connection.catch(() => undefined);
  });

  it('disconnect closes the socket and prevents future sends', async () => {
    const client = new SignalingClient();
    const connection = client.connect('ws://example.test/ws');
    latestSocket().open();
    await connection;

    client.disconnect();
    client.send({ type: 'join_room', roomId: 'room-1', peerId: 'guest' });

    expect(latestSocket().readyState).toBe(FakeWebSocket.CLOSED);
    expect(latestSocket().sentMessages).toEqual([]);
  });
});