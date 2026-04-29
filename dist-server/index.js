import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
const rooms = new Map();
const peerToRoom = new Map();
const socketToPeer = new Map();
const port = Number(process.env.SIGNALING_PORT ?? process.env.PORT ?? '3000');
const host = process.env.HOST ?? '0.0.0.0';
const httpServer = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('CS130 signaling server is running.\n');
});
const websocketServer = new WebSocketServer({ server: httpServer });
const reportServerError = (error) => {
    const err = error;
    if (err.code === 'EACCES') {
        console.error(`Failed to start signaling server on ${host}:${port}: permission denied. ` +
            'Check that the port is not already in use and that you have permission to bind it.');
        process.exit(1);
    }
    if (err.code === 'EADDRINUSE') {
        console.error(`Failed to start signaling server on ${host}:${port}: address already in use. ` +
            'Stop the process currently using the port or choose a different SIGNALING_PORT.');
        process.exit(1);
    }
    console.error('Signaling server error:', err);
    process.exit(1);
};
httpServer.on('error', reportServerError);
websocketServer.on('error', reportServerError);
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
            default:
                break;
        }
    });
    socket.on('close', () => {
        const peerId = socketToPeer.get(socket);
        if (!peerId) {
            return;
        }
        const roomId = peerToRoom.get(peerId);
        if (roomId) {
            leaveRoom(peerId, roomId);
        }
        socketToPeer.delete(socket);
    });
});
httpServer.listen(port, host, () => {
    console.log(`\nSignaling server listening on ws://${host}:${port}`);
    console.log('Host-relayed star rooms enabled (max 4 players).\n');
});
process.on('SIGINT', () => {
    console.log('\nShutting down signaling server...');
    websocketServer.close();
    httpServer.close(() => process.exit(0));
});
function hostRoom(socket, message) {
    if (!isValidIdentifier(message.roomId) || !isValidIdentifier(message.peerId)) {
        send(socket, {
            type: 'room_error',
            code: 'INVALID_ID',
            message: 'Room ID and peer ID must be non-empty strings',
        });
        return;
    }
    const normalizedMax = Math.max(2, Math.min(message.maxPlayers, 4));
    const existingRoom = rooms.get(message.roomId);
    if (existingRoom && existingRoom.hostPeerId !== message.peerId) {
        send(socket, {
            type: 'room_error',
            code: 'ROOM_EXISTS',
            message: 'Room ID is already in use',
        });
        return;
    }
    removePeerFromCurrentRoom(message.peerId);
    const room = {
        roomId: message.roomId,
        hostPeerId: message.peerId,
        maxPlayers: normalizedMax,
        members: new Set([message.peerId]),
        sockets: new Map([[message.peerId, socket]]),
    };
    rooms.set(message.roomId, room);
    peerToRoom.set(message.peerId, message.roomId);
    socketToPeer.set(socket, message.peerId);
    send(socket, {
        type: 'room_hosted',
        roomId: room.roomId,
        hostPeerId: room.hostPeerId,
        members: Array.from(room.members),
    });
    console.log(`Room hosted: ${room.roomId} by ${room.hostPeerId}`);
}
function joinRoom(socket, message) {
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
    if (!room.members.has(message.peerId) && room.members.size >= room.maxPlayers) {
        send(socket, {
            type: 'room_error',
            code: 'ROOM_FULL',
            message: `Room is full (${room.maxPlayers} players max)`,
        });
        return;
    }
    removePeerFromCurrentRoom(message.peerId);
    room.members.add(message.peerId);
    room.sockets.set(message.peerId, socket);
    peerToRoom.set(message.peerId, room.roomId);
    socketToPeer.set(socket, message.peerId);
    send(socket, {
        type: 'room_joined',
        roomId: room.roomId,
        hostPeerId: room.hostPeerId,
        members: Array.from(room.members),
    });
    broadcastToRoom(room, {
        type: 'peer_joined',
        roomId: room.roomId,
        peerId: message.peerId,
    }, message.peerId);
    console.log(`Peer joined room ${room.roomId}: ${message.peerId}`);
}
function leaveRoom(peerId, roomId) {
    const room = rooms.get(roomId);
    if (!room) {
        return;
    }
    const peerSocket = room.sockets.get(peerId);
    room.members.delete(peerId);
    room.sockets.delete(peerId);
    peerToRoom.delete(peerId);
    if (peerSocket) {
        socketToPeer.delete(peerSocket);
    }
    if (room.members.size === 0) {
        rooms.delete(roomId);
        console.log(`Room closed: ${roomId}`);
        return;
    }
    if (peerId === room.hostPeerId) {
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
function relaySignal(socket, message) {
    const room = rooms.get(message.roomId);
    if (!room) {
        send(socket, {
            type: 'room_error',
            code: 'ROOM_NOT_FOUND',
            message: 'Cannot relay signal: room does not exist',
        });
        return;
    }
    if (!room.members.has(message.fromPeerId) ||
        !room.members.has(message.toPeerId)) {
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
function removePeerFromCurrentRoom(peerId) {
    const currentRoom = peerToRoom.get(peerId);
    if (!currentRoom) {
        return;
    }
    leaveRoom(peerId, currentRoom);
}
function broadcastToRoom(room, message, excludePeerId) {
    for (const [peerId, peerSocket] of room.sockets) {
        if (excludePeerId && peerId === excludePeerId) {
            continue;
        }
        send(peerSocket, message);
    }
}
function send(socket, message) {
    if (socket.readyState !== socket.OPEN) {
        return;
    }
    socket.send(JSON.stringify(message));
}
function parseClientMessage(rawData) {
    const text = rawData.toString();
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed.type !== 'string') {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
function isValidIdentifier(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
