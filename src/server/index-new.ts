import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { RoomManager } from './RoomManager';
import type { ClientMessage, ServerMessage } from '../shared/GameEvents';

// Map definitions would be loaded here
const mapDefinitions = new Map();

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const staticRoot = path.resolve(process.cwd(), 'dist');

const httpServer = createServer(async (request, response) => {
  await handleHttpRequest(request, response).catch((error) => {
    console.error('HTTP server error:', error);
    response.writeHead(500, { 'Content-Type': 'text/plain' });
    response.end('Internal Server Error');
  });
});

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const urlPath = new URL(request.url ?? '/', `http://${request.headers.host}`).pathname;

  if (urlPath === '/') {
    const indexPath = path.join(staticRoot, 'index.html');
    try {
      const indexContents = await readFile(indexPath, 'utf8');
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(indexContents);
    } catch (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('Not Found');
    }
    return;
  }

  try {
    const filePath = path.join(staticRoot, urlPath);
    const fileStat = await stat(filePath);

    if (fileStat.isFile()) {
      const fileContents = await readFile(filePath);
      const contentType = getContentType(filePath);
      response.writeHead(200, { 'Content-Type': contentType });
      response.end(fileContents);
    } else {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('Not Found');
    }
  } catch (error) {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('Not Found');
  }
}

function getContentType(filePath: string): string {
  const ext = path.extname(filePath);
  switch (ext) {
    case '.js':
      return 'application/javascript';
    case '.css':
      return 'text/css';
    case '.json':
      return 'application/json';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.wasm':
      return 'application/wasm';
    default:
      return 'application/octet-stream';
  }
}

const roomManager = new RoomManager(mapDefinitions);
const clientRooms = new Map<WebSocket, string>(); // Track which room each client is in

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (socket: WebSocket) => {
  console.log('Client connected');

  socket.on('message', async (rawMessage: unknown) => {
    try {
      const message = JSON.parse(String(rawMessage)) as ClientMessage;
      await handleClientMessage(socket, message);
    } catch (error) {
      console.error('Error handling client message:', error);
      sendErrorMessage(socket, 'Invalid message format');
    }
  });

  socket.on('close', () => {
    console.log('Client disconnected');
    const roomId = clientRooms.get(socket);
    if (roomId) {
      const room = roomManager.getRoom(roomId);
      if (room) {
        const playerId = room.getPlayerId(socket);
        if (playerId) {
          room.removePlayer(playerId);
          broadcastToRoom(room, {
            type: 'player_left',
            data: { playerId },
          });

          if (room.isEmpty()) {
            roomManager.deleteRoom(roomId);
          }
        }
      }
      clientRooms.delete(socket);
    }
  });

  socket.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  // Send initial ping to verify connection
  socket.send(JSON.stringify({ type: 'pong', data: { message: 'Connected to server' } }));
});

async function handleClientMessage(socket: WebSocket, message: ClientMessage): Promise<void> {
  const { type, roomId, playerId } = message;

  switch (type) {
    case 'join_game': {
      const { mapId, maxPlayers } = message.data as any;

      // Check if room exists, if not create it
      let room = roomManager.getRoom(roomId);
      if (!room) {
        room = roomManager.createRoom(roomId, mapId, maxPlayers);
        if (!room) {
          sendErrorMessage(socket, 'Failed to create room');
          return;
        }
      }

      // Add player to room
      if (!room.addPlayer(playerId, socket)) {
        sendErrorMessage(socket, 'Failed to join room');
        return;
      }

      clientRooms.set(socket, roomId);

      // Send acknowledgment
      socket.send(
        JSON.stringify({
          type: 'acknowledgment',
          data: {
            success: true,
            roomId,
            playerId,
            playerIds: room.getAllPlayerIds(),
          },
        } as ServerMessage),
      );

      // Broadcast player joined event
      broadcastToRoom(room, {
        type: 'player_joined',
        data: { playerId, playerCount: room.getPlayerCount() },
      });

      break;
    }

    case 'player_input': {
      const { tick, actions } = message.data as any;
      const roomId = clientRooms.get(socket);

      if (!roomId) {
        return;
      }

      const room = roomManager.getRoom(roomId);
      if (!room) {
        return;
      }

      room.processPlayerInput(playerId, tick, actions);
      break;
    }

    case 'leave_game': {
      const room = roomManager.getRoom(roomId);
      if (room) {
        room.removePlayer(playerId);
        clientRooms.delete(socket);

        broadcastToRoom(room, {
          type: 'player_left',
          data: { playerId, playerCount: room.getPlayerCount() },
        });

        if (room.isEmpty()) {
          roomManager.deleteRoom(roomId);
        }
      }
      break;
    }

    case 'ping': {
      socket.send(
        JSON.stringify({
          type: 'pong',
          data: { timestamp: Date.now() },
        } as ServerMessage),
      );
      break;
    }
  }
}

function broadcastToRoom(room: any, message: ServerMessage): void {
  const roomId = room.getRoomId();
  for (const client of wss.clients) {
    if (clientRooms.get(client) === roomId && client.readyState === 1) {
      client.send(JSON.stringify(message));
    }
  }
}

function sendErrorMessage(socket: WebSocket, error: string): void {
  socket.send(
    JSON.stringify({
      type: 'acknowledgment',
      data: { success: false, error },
    } as ServerMessage),
  );
}

// Cleanup task
setInterval(() => {
  roomManager.cleanup();
}, 60000); // Run every minute

httpServer.listen(port, host, () => {
  console.log(`Server running at http://${host}:${port}`);
});
