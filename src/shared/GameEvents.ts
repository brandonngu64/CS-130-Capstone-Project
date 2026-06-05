/**
 * Shared game event types for client-server communication.
 * This replaces the rollback-netcode architecture with an event-based system.
 */

export type GameEventType =
  | 'player_spawned'
  | 'player_moved'
  | 'player_jumped'
  | 'player_attacked'
  | 'player_damaged'
  | 'player_died'
  | 'player_respawned'
  | 'player_dashed'
  | 'player_shot'
  | 'projectile_created'
  | 'projectile_destroyed'
  | 'item_spawned'
  | 'item_picked_up'
  | 'item_dropped'
  | 'game_state_update'
  | 'game_started'
  | 'game_ended'
  | 'player_joined'
  | 'player_left'
  | 'match_reset';

export interface BaseGameEvent {
  type: GameEventType;
  timestamp: number;
  tick: number;
}

export interface PlayerSpawnedEvent extends BaseGameEvent {
  type: 'player_spawned';
  playerId: string;
  x: number;
  y: number;
  color: number;
}

export interface PlayerMovedEvent extends BaseGameEvent {
  type: 'player_moved';
  playerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
}

export interface PlayerJumpedEvent extends BaseGameEvent {
  type: 'player_jumped';
  playerId: string;
}

export interface PlayerAttackedEvent extends BaseGameEvent {
  type: 'player_attacked';
  playerId: string;
  attackKind: number;
  x: number;
  y: number;
  width: number;
  height: number;
  damage: number;
}

export interface PlayerDamagedEvent extends BaseGameEvent {
  type: 'player_damaged';
  playerId: string;
  damageAmount: number;
  currentHealth: number;
  sourcePlayerId?: string;
}

export interface PlayerDiedEvent extends BaseGameEvent {
  type: 'player_died';
  playerId: string;
  stocks: number;
}

export interface PlayerRespawnedEvent extends BaseGameEvent {
  type: 'player_respawned';
  playerId: string;
  x: number;
  y: number;
}

export interface PlayerDashedEvent extends BaseGameEvent {
  type: 'player_dashed';
  playerId: string;
  direction: number;
}

export interface PlayerShotEvent extends BaseGameEvent {
  type: 'player_shot';
  playerId: string;
  x: number;
  y: number;
}

export interface ProjectileCreatedEvent extends BaseGameEvent {
  type: 'projectile_created';
  projectileId: number;
  ownerPlayerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
}

export interface ProjectileDestroyedEvent extends BaseGameEvent {
  type: 'projectile_destroyed';
  projectileId: number;
  reason: 'expired' | 'hit' | 'out_of_bounds';
}

export interface ItemSpawnedEvent extends BaseGameEvent {
  type: 'item_spawned';
  itemId: number;
  itemKind: number;
  x: number;
  y: number;
}

export interface ItemPickedUpEvent extends BaseGameEvent {
  type: 'item_picked_up';
  itemId: number;
  playerId: string;
}

export interface ItemDroppedEvent extends BaseGameEvent {
  type: 'item_dropped';
  playerId: string;
  itemId: number;
  x: number;
  y: number;
}

export interface GameStateUpdateEvent extends BaseGameEvent {
  type: 'game_state_update';
  players: {
    id: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    health: number;
    maxHealth: number;
    stocks: number;
    facing: number;
    eliminated: boolean;
    color: number;
    heldItem: number | null;
  }[];
  projectiles: {
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
  }[];
  items: {
    id: number;
    kind: number;
    x: number;
    y: number;
  }[];
}

export interface GameStartedEvent extends BaseGameEvent {
  type: 'game_started';
  mapId: string;
  playerIds: string[];
}

export interface GameEndedEvent extends BaseGameEvent {
  type: 'game_ended';
  winner?: string;
  reason: 'all_players_eliminated' | 'disconnected' | 'manual';
}

export interface PlayerJoinedEvent extends BaseGameEvent {
  type: 'player_joined';
  playerId: string;
  playerCount: number;
}

export interface PlayerLeftEvent extends BaseGameEvent {
  type: 'player_left';
  playerId: string;
  playerCount: number;
}

export interface MatchResetEvent extends BaseGameEvent {
  type: 'match_reset';
  mapId: string;
}

export type GameEvent =
  | PlayerSpawnedEvent
  | PlayerMovedEvent
  | PlayerJumpedEvent
  | PlayerAttackedEvent
  | PlayerDamagedEvent
  | PlayerDiedEvent
  | PlayerRespawnedEvent
  | PlayerDashedEvent
  | PlayerShotEvent
  | ProjectileCreatedEvent
  | ProjectileDestroyedEvent
  | ItemSpawnedEvent
  | ItemPickedUpEvent
  | ItemDroppedEvent
  | GameStateUpdateEvent
  | GameStartedEvent
  | GameEndedEvent
  | PlayerJoinedEvent
  | PlayerLeftEvent
  | MatchResetEvent;

// Input events from client to server
export interface PlayerInputEvent {
  type: 'player_input';
  playerId: string;
  tick: number;
  actions: {
    moveLeft: boolean;
    moveRight: boolean;
    jump: boolean;
    duck: boolean;
    punch: boolean;
    dash: boolean;
    shoot: boolean;
  };
}

// Message types for WebSocket communication
export interface ClientMessage {
  type: 'join_game' | 'player_input' | 'leave_game' | 'ping';
  roomId: string;
  playerId: string;
  data?: unknown;
}

export interface ServerMessage {
  type: 'game_event' | 'full_state_snapshot' | 'acknowledgment' | 'pong';
  roomId: string;
  data: unknown;
}
