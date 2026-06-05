import { ServerGameEngine } from './GameEngine';
import type { GameEvent } from '../shared/GameEvents';
import type { TiledMapDefinition } from '../client/tiledMap';
import type { WebSocket } from 'ws';

interface RoomPlayer {
  playerId: string;
  socket: WebSocket;
  colorIndex: number;
  connected: boolean;
}

export class GameRoom {
  private roomId: string;
  private mapId: string;
  private maxPlayers: number;
  private players = new Map<string, RoomPlayer>();
  private engine: ServerGameEngine;
  private started = false;
  private tickInterval: NodeJS.Timeout | null = null;
  private readonly TICK_RATE = 60; // 60 ticks per second

  constructor(
    roomId: string,
    mapId: string,
    maxPlayers: number,
    mapDefinition: TiledMapDefinition,
  ) {
    this.roomId = roomId;
    this.mapId = mapId;
    this.maxPlayers = maxPlayers;
    this.engine = new ServerGameEngine(mapDefinition);
  }

  getRoomId(): string {
    return this.roomId;
  }

  getMapId(): string {
    return this.mapId;
  }

  getMaxPlayers(): number {
    return this.maxPlayers;
  }

  getPlayerCount(): number {
    return this.players.size;
  }

  addPlayer(playerId: string, socket: WebSocket): boolean {
    if (this.players.has(playerId)) {
      return false;
    }

    if (this.players.size >= this.maxPlayers) {
      return false;
    }

    const colorIndex = this.players.size;
    const player: RoomPlayer = {
      playerId,
      socket,
      colorIndex,
      connected: true,
    };

    this.players.set(playerId, player);
    this.engine.addPlayer(playerId, colorIndex);

    // Start game if we have enough players
    if (this.players.size >= 2 && !this.started) {
      this.startGame();
    }

    return true;
  }

  removePlayer(playerId: string): boolean {
    if (!this.players.has(playerId)) {
      return false;
    }

    this.players.delete(playerId);
    this.engine.removePlayer(playerId);

    // Stop game if not enough players
    if (this.players.size < 2 && this.started) {
      this.stopGame();
    }

    return true;
  }

  private startGame(): void {
    this.started = true;
    const tickMs = 1000 / this.TICK_RATE;

    this.tickInterval = setInterval(() => {
      this.gameTick();
    }, tickMs);
  }

  private stopGame(): void {
    this.started = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  private gameTick(): void {
    const events = this.engine.tick();

    // Broadcast events to all connected players
    for (const event of events) {
      this.broadcastEvent(event);
    }
  }

  private broadcastEvent(event: GameEvent): void {
    const message = JSON.stringify({
      type: 'game_event',
      data: event,
    });

    for (const player of this.players.values()) {
      if (player.connected && player.socket.readyState === 1) {
        // WebSocket.OPEN = 1
        player.socket.send(message);
      }
    }
  }

  processPlayerInput(
    playerId: string,
    tick: number,
    actions: Record<string, boolean>,
  ): void {
    this.engine.processPlayerInput(playerId, tick, {
      moveLeft: Boolean(actions.moveLeft),
      moveRight: Boolean(actions.moveRight),
      jump: Boolean(actions.jump),
      duck: Boolean(actions.duck),
      punch: Boolean(actions.punch),
      dash: Boolean(actions.dash),
      shoot: Boolean(actions.shoot),
    });
  }

  getPlayerId(socket: WebSocket): string | null {
    for (const [playerId, player] of this.players) {
      if (player.socket === socket) {
        return playerId;
      }
    }
    return null;
  }

  getPlayer(playerId: string): RoomPlayer | null {
    return this.players.get(playerId) ?? null;
  }

  hasPlayer(playerId: string): boolean {
    return this.players.has(playerId);
  }

  isEmpty(): boolean {
    return this.players.size === 0;
  }

  isStarted(): boolean {
    return this.started;
  }

  getAllPlayerIds(): string[] {
    return Array.from(this.players.keys());
  }

  destroy(): void {
    this.stopGame();
    this.players.clear();
  }
}

export class RoomManager {
  private rooms = new Map<string, GameRoom>();
  private readonly mapDefinitions: Map<string, unknown>;

  constructor(mapDefinitions: Map<string, unknown>) {
    this.mapDefinitions = mapDefinitions;
  }

  createRoom(
    roomId: string,
    mapId: string,
    maxPlayers: number,
  ): GameRoom | null {
    if (this.rooms.has(roomId)) {
      return null;
    }

    const mapDef = this.mapDefinitions.get(mapId);
    if (!mapDef) {
      return null;
    }

    const room = new GameRoom(roomId, mapId, maxPlayers, mapDef as any);
    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId: string): GameRoom | null {
    return this.rooms.get(roomId) ?? null;
  }

  deleteRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.destroy();
      this.rooms.delete(roomId);
    }
  }

  getAllRoomIds(): string[] {
    return Array.from(this.rooms.keys());
  }

  cleanup(): void {
    for (const room of this.rooms.values()) {
      if (room.isEmpty()) {
        room.destroy();
      }
    }
  }
}
