import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';

type SignalMessage =
  | {
      type: 'description';
      description: Record<string, unknown>;
    }
  | {
      type: 'candidate';
      candidate: Record<string, unknown>;
    };

type ClientMessage =
  | {
      type: 'host_room';
      roomId: string;
      peerId: string;
      maxPlayers: number;
      isPublic?: boolean;
      lobbyName?: string;
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
      type: 'list_public_rooms';
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
      virtualPlayerId?: string;
      characterId: string;
    }
  | {
      type: 'lobby_game_mode_select';
      roomId: string;
      peerId: string;
      gameMode: string;
    }
  | {
      type: 'lobby_name_change';
      roomId: string;
      peerId: string;
      name: string;
    }
  | {
      type: 'lobby_map_select';
      roomId: string;
      peerId: string;
      mapId: string;
    }
  | {
      type: 'lobby_random_resolved';
      roomId: string;
      peerId: string;
      mapId: string;
      characters: Record<string, string>;
      splitScreenPeers?: string[];
    }
  | {
      type: 'lobby_rematch';
      roomId: string;
      peerId: string;
      newRoomId: string;
      hostPeerId: string;
    }
  | {
      type: 'lobby_split_screen';
      roomId: string;
      peerId: string;
      localPlayerCount: number;
    };

type ServerMessage =
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
      virtualPlayerId?: string;
      characterId: string;
    }
  | {
      type: 'lobby_game_mode_select';
      roomId: string;
      peerId: string;
      gameMode: string;
    }
  | {
      type: 'lobby_name_change';
      roomId: string;
      peerId: string;
      name: string;
    }
  | {
      type: 'lobby_map_select';
      roomId: string;
      peerId: string;
      mapId: string;
    }
  | {
      type: 'lobby_random_resolved';
      roomId: string;
      peerId: string;
      mapId: string;
      characters: Record<string, string>;
      splitScreenPeers?: string[];
    }
  | {
      type: 'lobby_rematch';
      roomId: string;
      peerId: string;
      newRoomId: string;
      hostPeerId: string;
    }
  | {
      type: 'lobby_split_screen';
      roomId: string;
      peerId: string;
      localPlayerCount: number;
    }
  | {
      type: 'public_rooms_list';
      rooms: PublicRoomSummary[];
    };

type PublicRoomSummary = {
  roomId: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  gameMode: string;
  mapId: string;
};

type Room = {
  roomId: string;
  hostPeerId: string;
  maxPlayers: number;
  hostConnected: boolean;
  isPublic: boolean;
  hostName: string;
  gameMode: string;
  mapId: string;
  members: Set<string>;
  sockets: Map<string, WebSocket>;
  disconnectTimers: Map<string, ReturnType<typeof setTimeout>>;
  broadcastedLeave: Set<string>;
};

const rooms = new Map<string, Room>();
const peerToRoom = new Map<string, string>();
const socketToPeer = new Map<WebSocket, string>();
const hostedRoomByPeer = new Map<string, string>();
const hostCooldownUntil = new Map<string, number>();
const hostCooldownTimers = new Map<string, ReturnType<typeof setTimeout>>();
const HOST_COOLDOWN_MS = 20_000;

const port = Number(process.env.SIGNALING_PORT ?? process.env.PORT ?? '3000');
const host = process.env.HOST ?? '0.0.0.0';
const staticRoot = path.resolve(process.cwd(), 'dist');
const websocketPath = '/ws';
const roomDisconnectGraceMs = Number(
  process.env.ROOM_DISCONNECT_GRACE_MS ?? '7000',
);

const httpServer = createServer((request, response) => {
  void handleHttpRequest(request, response).catch((error) => {
    console.error('HTTP server error:', error);
    if (!response.headersSent) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    }
    response.end('Internal server error.\n');
  });
});

const websocketServer = new WebSocketServer({ noServer: true });

const reportServerError = (error: Error): void => {
  const err = error as NodeJS.ErrnoException;
  if (err.code === 'EACCES') {
    console.error(
      `Failed to start signaling server on ${host}:${port}: permission denied. ` +
        'Check that the port is not already in use and that you have permission to bind it.',
    );
    process.exit(1);
  }

  if (err.code === 'EADDRINUSE') {
    console.error(
      `Failed to start signaling server on ${host}:${port}: address already in use. ` +
        'Stop the process currently using the port or choose a different SIGNALING_PORT.',
    );
    process.exit(1);
  }

  console.error('Signaling server error:', err);
  process.exit(1);
};

httpServer.on('error', reportServerError);
websocketServer.on('error', reportServerError);

httpServer.on('upgrade', (request, socket, head) => {
  const requestUrl = new URL(
    request.url ?? '/',
    `http://${request.headers.host ?? 'localhost'}`,
  );

  if (requestUrl.pathname !== websocketPath) {
    socket.destroy();
    return;
  }

  websocketServer.handleUpgrade(request, socket, head, (client) => {
    websocketServer.emit('connection', client, request);
  });
});

websocketServer.on('connection', (socket) => {
  socket.on('message', (rawData) => {
    const message = parseClientMessage(rawData);
    if (!message) {
      send(socket, {
        type: 'room_error',
        code: 'BAD_MESSAGE',
        message: 'Unable to parse signaling message',
      });
      return;
    }

    switch (message.type) {
      case 'host_room':
        hostRoom(socket, message);
        break;
      case 'join_room':
        joinRoom(socket, message);
        break;
      case 'leave_room':
        leaveRoom(message.peerId, message.roomId);
        break;
      case 'signal':
        relaySignal(socket, message);
        break;
      case 'lobby_ready':
        relayLobbyReady(socket, message);
        break;
      case 'lobby_character_select':
        relayLobbyCharacterSelect(socket, message);
        break;
      case 'lobby_game_mode_select':
        relayLobbyGameModeSelect(socket, message);
        break;
      case 'lobby_name_change':
        relayLobbyNameChange(socket, message);
        break;
      case 'lobby_map_select':
        relayLobbyMapSelect(socket, message);
        break;
      case 'lobby_random_resolved':
        relayLobbyRandomResolved(socket, message);
        break;
      case 'lobby_rematch':
        relayLobbyRematch(socket, message);
        break;
      case 'lobby_split_screen':
        relayLobbySplitScreen(socket, message);
        break;
      case 'list_public_rooms':
        sendPublicRoomsList(socket);
        break;
      default:
        break;
    }
  });

  socket.on('close', () => {
    onSocketClosed(socket);
  });
});

httpServer.listen(port, host, () => {
  console.log(`\nSignaling server listening on ws://${host}:${port}`);
  console.log('Host-relayed star rooms enabled (max 4 players).\n');
});

const shutdown = (): void => {
  console.log('\nShutting down signaling server...');

  websocketServer.clients.forEach((client) => {
    if (client.readyState === client.OPEN || client.readyState === client.CLOSING) {
      client.close(1001, 'Server shutting down');
    }
  });

  websocketServer.close(() => {
    httpServer.close(() => process.exit(0));
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const requestUrl = new URL(
    request.url ?? '/',
    `http://${request.headers.host ?? 'localhost'}`,
  );
  const pathname = path.posix.normalize(requestUrl.pathname);

  if (pathname === websocketPath) {
    response.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('WebSocket endpoint. Use a WebSocket client.\n');
    return;
  }

  const served = await serveStaticRequest(pathname, response);
  if (served) {
    return;
  }

  response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('CS130 signaling server is running.\n');
}

async function serveStaticRequest(
  pathname: string,
  response: ServerResponse,
): Promise<boolean> {
  const indexPath = path.join(staticRoot, 'index.html');

  if (path.extname(pathname)) {
    const assetPath = resolveStaticPath(pathname);
    if (!assetPath || !(await fileExists(assetPath))) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found\n');
      return true;
    }

    await sendFile(assetPath, response, cacheControlForPath(pathname));
    return true;
  }

  if (await fileExists(indexPath)) {
    await sendFile(indexPath, response, 'no-cache');
    return true;
  }

  return false;
}

// Vite emits content-hashed asset filenames under /assets/ (e.g.
// 321GoSequence-0-C8pXkvDk.png), so those bytes are immutable and can be cached
// by the browser indefinitely. Everything else (notably index.html) must be
// revalidated so a new deploy — which points index.html at new hashed URLs — is
// picked up immediately.
function cacheControlForPath(pathname: string): string {
  if (pathname.startsWith('/assets/')) {
    return 'public, max-age=31536000, immutable';
  }
  return 'no-cache';
}

function resolveStaticPath(pathname: string): string | null {
  const relativePath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  const candidate = path.resolve(staticRoot, relativePath);
  const relative = path.relative(staticRoot, candidate);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  return candidate;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

async function sendFile(
  filePath: string,
  response: ServerResponse,
  cacheControl?: string,
): Promise<void> {
  const body = await readFile(filePath);
  const headers: Record<string, string | number> = {
    'content-type': contentTypeForPath(filePath),
    'content-length': body.length,
  };
  if (cacheControl) {
    headers['cache-control'] = cacheControl;
  }
  response.writeHead(200, headers);
  response.end(body);
}

function contentTypeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.ico':
      return 'image/x-icon';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

function hostRoom(
  socket: WebSocket,
  message: Extract<ClientMessage, { type: 'host_room' }>,
): void {
  if (!isValidIdentifier(message.roomId) || !isValidIdentifier(message.peerId)) {
    send(socket, {
      type: 'room_error',
      code: 'INVALID_ID',
      message: 'Room ID and peer ID must be non-empty strings',
    });
    return;
  }

  const normalizedMax = Math.max(2, Math.min(message.maxPlayers, 4));
  const isPublic = message.isPublic === true;
  const hostName = sanitizeHostName(message.lobbyName);

  const existingRoom = rooms.get(message.roomId);
  if (existingRoom && existingRoom.hostPeerId !== message.peerId) {
    send(socket, {
      type: 'room_error',
      code: 'ROOM_EXISTS',
      message: 'Room ID is already in use',
    });
    return;
  }

  // Enforce one-hosted-room-per-peer and the post-disconnect cooldown.
  // Reattach to the same room is always allowed.
  const isReattach = !!existingRoom && existingRoom.hostPeerId === message.peerId;
  if (!isReattach) {
    const otherHosted = hostedRoomByPeer.get(message.peerId);
    if (otherHosted && otherHosted !== message.roomId && rooms.has(otherHosted)) {
      send(socket, {
        type: 'room_error',
        code: 'ALREADY_HOSTING',
        message: 'You are already hosting a room',
      });
      return;
    }

    const cooldownUntil = hostCooldownUntil.get(message.peerId) ?? 0;
    const remainingMs = cooldownUntil - Date.now();
    if (remainingMs > 0) {
      const remainingSec = Math.ceil(remainingMs / 1000);
      send(socket, {
        type: 'room_error',
        code: 'HOST_COOLDOWN',
        message: `Wait ${remainingSec}s before hosting another room`,
      });
      return;
    }
  }

  if (existingRoom && existingRoom.hostPeerId === message.peerId) {
    clearDisconnectTimer(existingRoom, message.peerId);
    existingRoom.hostConnected = true;
    existingRoom.members.add(message.peerId);
    existingRoom.sockets.set(message.peerId, socket);
    peerToRoom.set(message.peerId, existingRoom.roomId);
    socketToPeer.set(socket, message.peerId);

    send(socket, {
      type: 'room_hosted',
      roomId: existingRoom.roomId,
      hostPeerId: existingRoom.hostPeerId,
      members: Array.from(existingRoom.members),
    });

    console.log(`Host reattached to room: ${existingRoom.roomId}`);
    return;
  }

  removePeerFromCurrentRoom(message.peerId);

  const room: Room = {
    roomId: message.roomId,
    hostPeerId: message.peerId,
    maxPlayers: normalizedMax,
    hostConnected: true,
    isPublic,
    hostName,
    gameMode: '',
    mapId: '',
    members: new Set([message.peerId]),
    sockets: new Map([[message.peerId, socket]]),
    disconnectTimers: new Map(),
    broadcastedLeave: new Set(),
  };

  rooms.set(message.roomId, room);
  peerToRoom.set(message.peerId, message.roomId);
  socketToPeer.set(socket, message.peerId);
  hostedRoomByPeer.set(message.peerId, message.roomId);
  clearHostCooldown(message.peerId);

  send(socket, {
    type: 'room_hosted',
    roomId: room.roomId,
    hostPeerId: room.hostPeerId,
    members: Array.from(room.members),
  });

  console.log(
    `Room hosted: ${room.roomId} by ${room.hostPeerId} (public=${isPublic})`,
  );
}

function joinRoom(
  socket: WebSocket,
  message: Extract<ClientMessage, { type: 'join_room' }>,
): void {
  if (!isValidIdentifier(message.roomId) || !isValidIdentifier(message.peerId)) {
    send(socket, {
      type: 'room_error',
      code: 'INVALID_ID',
      message: 'Room ID and peer ID must be non-empty strings',
    });
    return;
  }

  const room = rooms.get(message.roomId);
  if (!room) {
    send(socket, {
      type: 'room_error',
      code: 'ROOM_NOT_FOUND',
      message: 'Room not found',
    });
    return;
  }

  const currentRoomId = peerToRoom.get(message.peerId);
  const isReturningMember =
    currentRoomId === room.roomId && room.members.has(message.peerId);

  if (!isReturningMember && !room.hostConnected) {
    send(socket, {
      type: 'room_error',
      code: 'HOST_OFFLINE',
      message: 'Host is temporarily offline. Try again shortly.',
    });
    return;
  }

  if (!room.members.has(message.peerId) && room.members.size >= room.maxPlayers) {
    send(socket, {
      type: 'room_error',
      code: 'ROOM_FULL',
      message: `Room is full (${room.maxPlayers} players max)`,
    });
    return;
  }

  if (currentRoomId && currentRoomId !== room.roomId) {
    removePeerFromCurrentRoom(message.peerId);
  }

  room.members.add(message.peerId);
  room.sockets.set(message.peerId, socket);
  clearDisconnectTimer(room, message.peerId);
  room.broadcastedLeave.delete(message.peerId);
  peerToRoom.set(message.peerId, room.roomId);
  socketToPeer.set(socket, message.peerId);

  if (message.peerId === room.hostPeerId) {
    room.hostConnected = true;
  }

  send(socket, {
    type: 'room_joined',
    roomId: room.roomId,
    hostPeerId: room.hostPeerId,
    members: Array.from(room.members),
  });

  broadcastToRoom(
    room,
    {
      type: 'peer_joined',
      roomId: room.roomId,
      peerId: message.peerId,
    },
    isReturningMember ? message.peerId : undefined,
  );

  console.log(`Peer joined room ${room.roomId}: ${message.peerId}`);
}

function leaveRoom(peerId: string, roomId: string): void {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  const peerSocket = room.sockets.get(peerId);

  clearDisconnectTimer(room, peerId);

  room.members.delete(peerId);
  room.sockets.delete(peerId);
  peerToRoom.delete(peerId);

  if (peerSocket) {
    socketToPeer.delete(peerSocket);
  }

  if (room.members.size === 0) {
    rooms.delete(roomId);
    if (peerId === room.hostPeerId) {
      releaseHost(peerId);
    }
    console.log(`Room closed: ${roomId}`);
    return;
  }

  if (peerId === room.hostPeerId) {
    room.hostConnected = false;
    for (const [remainingPeerId, remainingSocket] of room.sockets) {
      send(remainingSocket, {
        type: 'room_error',
        code: 'HOST_LEFT',
        message: 'Host disconnected. Room closed.',
      });
      peerToRoom.delete(remainingPeerId);
      socketToPeer.delete(remainingSocket);
    }
    rooms.delete(roomId);
    releaseHost(peerId);
    console.log(`Room closed because host left: ${roomId}`);
    return;
  }

  broadcastToRoom(room, {
    type: 'peer_left',
    roomId,
    peerId,
  });

  console.log(`Peer left room ${roomId}: ${peerId}`);
}

function relaySignal(
  socket: WebSocket,
  message: Extract<ClientMessage, { type: 'signal' }>,
): void {
  const room = rooms.get(message.roomId);
  if (!room) {
    send(socket, {
      type: 'room_error',
      code: 'ROOM_NOT_FOUND',
      message: 'Cannot relay signal: room does not exist',
    });
    return;
  }

  if (
    !room.members.has(message.fromPeerId) ||
    !room.members.has(message.toPeerId)
  ) {
    send(socket, {
      type: 'room_error',
      code: 'NOT_IN_ROOM',
      message: 'Cannot relay signal between peers outside this room',
    });
    return;
  }

  const targetSocket = room.sockets.get(message.toPeerId);
  if (!targetSocket) {
    send(socket, {
      type: 'room_error',
      code: 'TARGET_OFFLINE',
      message: 'Target peer is offline',
    });
    return;
  }

  send(targetSocket, {
    type: 'signal',
    roomId: message.roomId,
    fromPeerId: message.fromPeerId,
    signal: message.signal,
  });
}

function relayLobbyReady(
  socket: WebSocket,
  message: Extract<ClientMessage, { type: 'lobby_ready' }>,
): void {
  const socketPeerId = socketToPeer.get(socket);
  if (!socketPeerId || socketPeerId !== message.peerId) {
    send(socket, {
      type: 'room_error',
      code: 'PEER_MISMATCH',
      message: 'Cannot update lobby readiness for a different peer',
    });
    return;
  }

  const room = rooms.get(message.roomId);
  if (!room) {
    send(socket, {
      type: 'room_error',
      code: 'ROOM_NOT_FOUND',
      message: 'Cannot update lobby: room does not exist',
    });
    return;
  }

  if (!room.members.has(message.peerId)) {
    send(socket, {
      type: 'room_error',
      code: 'NOT_IN_ROOM',
      message: 'Cannot update lobby while outside this room',
    });
    return;
  }

  broadcastToRoom(room, {
    type: 'lobby_ready',
    roomId: message.roomId,
    peerId: message.peerId,
    ready: message.ready,
  });
}

function relayLobbyCharacterSelect(
  socket: WebSocket,
  message: Extract<ClientMessage, { type: 'lobby_character_select' }>,
): void {
  const socketPeerId = socketToPeer.get(socket);
  if (!socketPeerId || socketPeerId !== message.peerId) {
    send(socket, {
      type: 'room_error',
      code: 'PEER_MISMATCH',
      message: 'Cannot update character selection for a different peer',
    });
    return;
  }

  const room = rooms.get(message.roomId);
  if (!room) {
    send(socket, {
      type: 'room_error',
      code: 'ROOM_NOT_FOUND',
      message: 'Cannot update character: room does not exist',
    });
    return;
  }

  if (!room.members.has(message.peerId)) {
    send(socket, {
      type: 'room_error',
      code: 'NOT_IN_ROOM',
      message: 'Cannot update character while outside this room',
    });
    return;
  }

  broadcastToRoom(room, {
    type: 'lobby_character_select',
    roomId: message.roomId,
    peerId: message.peerId,
    virtualPlayerId: message.virtualPlayerId,
    characterId: message.characterId,
  });
}

function relayLobbyGameModeSelect(
  socket: WebSocket,
  message: Extract<ClientMessage, { type: 'lobby_game_mode_select' }>,
): void {
  const socketPeerId = socketToPeer.get(socket);
  if (!socketPeerId || socketPeerId !== message.peerId) {
    send(socket, {
      type: 'room_error',
      code: 'PEER_MISMATCH',
      message: 'Cannot update game mode for a different peer',
    });
    return;
  }

  const room = rooms.get(message.roomId);
  if (!room) {
    send(socket, {
      type: 'room_error',
      code: 'ROOM_NOT_FOUND',
      message: 'Cannot update game mode: room does not exist',
    });
    return;
  }

  if (!room.members.has(message.peerId)) {
    send(socket, {
      type: 'room_error',
      code: 'NOT_IN_ROOM',
      message: 'Cannot update game mode while outside this room',
    });
    return;
  }

  // Only the host is allowed to set the game mode for the room.
  if (message.peerId !== room.hostPeerId) {
    send(socket, {
      type: 'room_error',
      code: 'NOT_HOST',
      message: 'Only the host can change the game mode',
    });
    return;
  }

  room.gameMode = message.gameMode;
  broadcastToRoom(room, {
    type: 'lobby_game_mode_select',
    roomId: message.roomId,
    peerId: message.peerId,
    gameMode: message.gameMode,
  });
}

function relayLobbyNameChange(
  socket: WebSocket,
  message: Extract<ClientMessage, { type: 'lobby_name_change' }>,
): void {
  const socketPeerId = socketToPeer.get(socket);
  if (!socketPeerId || socketPeerId !== message.peerId) {
    send(socket, {
      type: 'room_error',
      code: 'PEER_MISMATCH',
      message: 'Cannot update name for a different peer',
    });
    return;
  }

  const room = rooms.get(message.roomId);
  if (!room || !room.members.has(message.peerId)) {
    return;
  }

  if (message.peerId === room.hostPeerId) {
    room.hostName = sanitizeHostName(message.name);
  }

  broadcastToRoom(room, {
    type: 'lobby_name_change',
    roomId: message.roomId,
    peerId: message.peerId,
    name: message.name,
  });
}

function relayLobbyMapSelect(
  socket: WebSocket,
  message: Extract<ClientMessage, { type: 'lobby_map_select' }>,
): void {
  const socketPeerId = socketToPeer.get(socket);
  if (!socketPeerId || socketPeerId !== message.peerId) {
    send(socket, {
      type: 'room_error',
      code: 'PEER_MISMATCH',
      message: 'Cannot update map for a different peer',
    });
    return;
  }

  const room = rooms.get(message.roomId);
  if (!room || !room.members.has(message.peerId)) {
    return;
  }

  if (message.peerId !== room.hostPeerId) {
    send(socket, {
      type: 'room_error',
      code: 'NOT_HOST',
      message: 'Only the host can change the map',
    });
    return;
  }

  room.mapId = message.mapId;
  broadcastToRoom(room, {
    type: 'lobby_map_select',
    roomId: message.roomId,
    peerId: message.peerId,
    mapId: message.mapId,
  });
}

function relayLobbyRandomResolved(
  socket: WebSocket,
  message: Extract<ClientMessage, { type: 'lobby_random_resolved' }>,
): void {
  const socketPeerId = socketToPeer.get(socket);
  if (!socketPeerId || socketPeerId !== message.peerId) {
    send(socket, {
      type: 'room_error',
      code: 'PEER_MISMATCH',
      message: 'Cannot resolve randoms for a different peer',
    });
    return;
  }

  const room = rooms.get(message.roomId);
  if (!room || !room.members.has(message.peerId)) {
    return;
  }

  if (message.peerId !== room.hostPeerId) {
    send(socket, {
      type: 'room_error',
      code: 'NOT_HOST',
      message: 'Only the host can resolve random selections',
    });
    return;
  }

  broadcastToRoom(room, {
    type: 'lobby_random_resolved',
    roomId: message.roomId,
    peerId: message.peerId,
    mapId: message.mapId,
    characters: message.characters,
    splitScreenPeers: message.splitScreenPeers,
  });
}

function relayLobbyRematch(
  socket: WebSocket,
  message: Extract<ClientMessage, { type: 'lobby_rematch' }>,
): void {
  const socketPeerId = socketToPeer.get(socket);
  if (!socketPeerId || socketPeerId !== message.peerId) {
    send(socket, {
      type: 'room_error',
      code: 'PEER_MISMATCH',
      message: 'Cannot trigger rematch for a different peer',
    });
    return;
  }

  const room = rooms.get(message.roomId);
  if (!room || !room.members.has(message.peerId)) {
    return;
  }

  if (message.peerId !== room.hostPeerId) {
    send(socket, {
      type: 'room_error',
      code: 'NOT_HOST',
      message: 'Only the host can trigger a rematch',
    });
    return;
  }

  broadcastToRoom(room, {
    type: 'lobby_rematch',
    roomId: message.roomId,
    peerId: message.peerId,
    newRoomId: message.newRoomId,
    hostPeerId: message.hostPeerId,
  });
}

function relayLobbySplitScreen(
  socket: WebSocket,
  message: Extract<ClientMessage, { type: 'lobby_split_screen' }>,
): void {
  const socketPeerId = socketToPeer.get(socket);
  if (!socketPeerId || socketPeerId !== message.peerId) {
    send(socket, {
      type: 'room_error',
      code: 'PEER_MISMATCH',
      message: 'Cannot update split-screen state for a different peer',
    });
    return;
  }

  const room = rooms.get(message.roomId);
  if (!room || !room.members.has(message.peerId)) {
    return;
  }

  const clamped = Math.max(1, Math.min(2, Math.floor(message.localPlayerCount)));
  broadcastToRoom(room, {
    type: 'lobby_split_screen',
    roomId: message.roomId,
    peerId: message.peerId,
    localPlayerCount: clamped,
  });
}

function removePeerFromCurrentRoom(peerId: string): void {
  const currentRoom = peerToRoom.get(peerId);
  if (!currentRoom) {
    return;
  }
  leaveRoom(peerId, currentRoom);
}

function scheduleDisconnect(roomId: string, peerId: string): void {
  const room = rooms.get(roomId);
  if (!room || !room.members.has(peerId)) {
    return;
  }

  clearDisconnectTimer(room, peerId);

  const timeoutId = setTimeout(() => {
    finalizeDisconnect(roomId, peerId);
  }, roomDisconnectGraceMs);

  room.disconnectTimers.set(peerId, timeoutId);
}

function clearDisconnectTimer(room: Room, peerId: string): void {
  const timeoutId = room.disconnectTimers.get(peerId);
  if (!timeoutId) {
    return;
  }

  clearTimeout(timeoutId);
  room.disconnectTimers.delete(peerId);
}

function finalizeDisconnect(roomId: string, peerId: string): void {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  room.disconnectTimers.delete(peerId);

  if (!room.members.has(peerId)) {
    return;
  }

  const peerSocket = room.sockets.get(peerId);
  room.members.delete(peerId);
  room.sockets.delete(peerId);
  peerToRoom.delete(peerId);

  if (peerSocket) {
    socketToPeer.delete(peerSocket);
  }

  if (peerId === room.hostPeerId) {
    room.hostConnected = false;

    if (room.members.size === 0) {
      rooms.delete(roomId);
      releaseHost(peerId);
      console.log(`Room closed because host disconnected: ${roomId}`);
      return;
    }

    for (const [remainingPeerId, remainingSocket] of room.sockets) {
      send(remainingSocket, {
        type: 'room_error',
        code: 'HOST_LEFT',
        message: 'Host disconnected. Room closed.',
      });
      peerToRoom.delete(remainingPeerId);
      socketToPeer.delete(remainingSocket);
    }

    rooms.delete(roomId);
    releaseHost(peerId);
    console.log(`Room closed because host disconnected: ${roomId}`);
    return;
  }

  if (!room.broadcastedLeave.has(peerId)) {
    broadcastToRoom(room, { type: 'peer_left', roomId, peerId });
  }
  room.broadcastedLeave.delete(peerId);

  console.log(`Peer disconnected after grace period ${roomId}: ${peerId}`);
}

function broadcastToRoom(
  room: Room,
  message: ServerMessage,
  excludePeerId?: string,
): void {
  for (const [peerId, peerSocket] of room.sockets) {
    if (excludePeerId && peerId === excludePeerId) {
      continue;
    }
    send(peerSocket, message);
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(message));
}

function onSocketClosed(socket: WebSocket): void {
  const peerId = socketToPeer.get(socket);
  if (!peerId) {
    return;
  }

  const roomId = peerToRoom.get(peerId);
  if (!roomId) {
    socketToPeer.delete(socket);
    return;
  }

  const room = rooms.get(roomId);
  if (!room) {
    socketToPeer.delete(socket);
    peerToRoom.delete(peerId);
    return;
  }

  room.sockets.delete(peerId);
  socketToPeer.delete(socket);

  if (peerId === room.hostPeerId) {
    room.hostConnected = false;
  } else if (!room.broadcastedLeave.has(peerId)) {
    room.broadcastedLeave.add(peerId);
    broadcastToRoom(room, { type: 'peer_left', roomId, peerId });
  }

  scheduleDisconnect(roomId, peerId);
}

function parseClientMessage(rawData: RawData): ClientMessage | null {
  const text = rawData.toString();
  try {
    const parsed = JSON.parse(text) as { type?: unknown };
    if (!parsed || typeof parsed.type !== 'string') {
      return null;
    }
    return parsed as ClientMessage;
  } catch {
    return null;
  }
}

function isValidIdentifier(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function sanitizeHostName(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/[\r\n\t]/g, ' ').trim().slice(0, 24);
}

function releaseHost(peerId: string): void {
  hostedRoomByPeer.delete(peerId);
  const until = Date.now() + HOST_COOLDOWN_MS;
  hostCooldownUntil.set(peerId, until);
  clearHostCooldownTimer(peerId);
  const timeoutId = setTimeout(() => {
    hostCooldownUntil.delete(peerId);
    hostCooldownTimers.delete(peerId);
  }, HOST_COOLDOWN_MS);
  hostCooldownTimers.set(peerId, timeoutId);
}

function clearHostCooldown(peerId: string): void {
  hostCooldownUntil.delete(peerId);
  clearHostCooldownTimer(peerId);
}

function clearHostCooldownTimer(peerId: string): void {
  const existing = hostCooldownTimers.get(peerId);
  if (existing) {
    clearTimeout(existing);
    hostCooldownTimers.delete(peerId);
  }
}

function sendPublicRoomsList(socket: WebSocket): void {
  const summaries: PublicRoomSummary[] = [];
  for (const room of rooms.values()) {
    if (!room.isPublic) continue;
    if (!room.hostConnected) continue;
    if (room.members.size >= room.maxPlayers) continue;
    summaries.push({
      roomId: room.roomId,
      hostName: room.hostName,
      playerCount: room.members.size,
      maxPlayers: room.maxPlayers,
      gameMode: room.gameMode,
      mapId: room.mapId,
    });
  }
  send(socket, { type: 'public_rooms_list', rooms: summaries });
}
