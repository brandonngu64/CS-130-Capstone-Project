# Event-Based Server-Authoritative Multiplayer Architecture

## Overview

This document describes the new event-based, server-authoritative architecture that replaces the previous rollback-netcode (GGPO) system. This architecture is more suitable for real-time multiplayer games with moderate latency tolerance.

## Architecture Layers

### 1. Client Layer

#### `LocalInputManager`
- **Purpose**: Captures keyboard input from the player
- **Responsibilities**:
  - Track pressed keys
  - Update input state (move, jump, attack, etc.)
  - Prevent default browser behavior for game keys
- **Usage**:
```typescript
const inputManager = new InputManager();
const currentInput = inputManager.getCurrentInput();
// { moveLeft: true, moveRight: false, jump: true, ... }
```

#### `NetworkManager`
- **Purpose**: Handles all communication with the server
- **Responsibilities**:
  - Establish WebSocket connection
  - Send player input at fixed rate (60 Hz)
  - Receive and parse game events
  - Handle reconnection with exponential backoff
  - Heartbeat/keepalive messaging
- **Key Methods**:
  - `connect()`: Establish server connection
  - `sendPlayerInput(actions)`: Send input to server
  - `onGameEvent(listener)`: Register event listener
  - `onConnectionStateChanged(listener)`: Monitor connection
- **Events Sent to Server**: `PlayerInputEvent`
- **Events Received from Server**: All `GameEvent` types

#### `ClientGameState`
- **Purpose**: Maintains synchronized game state on the client
- **Responsibilities**:
  - Process incoming events from server
  - Update local game snapshot
  - Provide current state for rendering
  - Handle client-side prediction (optional)
  - Interpolation for smooth motion
- **State Structure**:
```typescript
interface GameSnapshot {
  tick: number;
  players: Map<string, PlayerState>;
  projectiles: Map<number, ProjectileState>;
  items: Map<number, ItemState>;
}
```

#### `EventBasedMultiplayerApp`
- **Purpose**: Main application orchestrator
- **Responsibilities**:
  - Coordinate between NetworkManager, ClientGameState, and Renderer
  - Handle game loop
  - Manage UI state (menu, settings, game, etc.)
  - Process events and update visuals
- **Game Loop**: Runs at requestAnimationFrame rate (~60 FPS)

### 2. Server Layer

#### `GameEngine` (Server-side)
- **Purpose**: Authoritative game logic and physics simulation
- **Responsibilities**:
  - Run physics simulation (RAPIER) at 60 Hz
  - Process player input
  - Check collisions and interactions
  - Generate game events
  - Manage all entity state (source of truth)
- **Input**: `PlayerInputEvent` from clients
- **Output**: `GameEvent` stream to all clients

#### `GameRoom`
- **Purpose**: Encapsulates a multiplayer session
- **Responsibilities**:
  - Manage players in the room
  - Start/stop game simulation
  - Broadcast events to all connected players
  - Handle player join/leave
  - Track room state (started, ended, etc.)

#### `RoomManager`
- **Purpose**: Manages all active game rooms
- **Responsibilities**:
  - Create new rooms
  - Lookup rooms by ID
  - Clean up empty rooms
  - Manage map definitions

### 3. Network Communication

#### Message Types

**Client → Server:**
```typescript
{
  type: 'player_input',
  roomId: string,
  playerId: string,
  data: {
    tick: number,
    actions: {
      moveLeft, moveRight, jump, duck,
      punch, dash, shoot
    }
  }
}
```

**Server → Client (Events):**
```typescript
{
  type: 'game_event',
  data: GameEvent
}
```

#### Event Types

Core event types defined in `GameEvents.ts`:

**Entity Events:**
- `PlayerSpawnedEvent`: Player enters the game
- `PlayerMovedEvent`: Player position/velocity update
- `PlayerDamagedEvent`: Player takes damage
- `PlayerDiedEvent`: Player eliminated
- `PlayerRespawnedEvent`: Player respawns
- `ProjectileCreatedEvent`: Projectile fired
- `ProjectileDestroyedEvent`: Projectile hit/expired
- `ItemSpawnedEvent`: Item appears
- `ItemPickedUpEvent`: Player grabs item

**State Events:**
- `GameStateUpdateEvent`: Full state snapshot (periodic)
- `GameStartedEvent`: Match begins
- `GameEndedEvent`: Match ends

**Room Events:**
- `PlayerJoinedEvent`: Player joined room
- `PlayerLeftEvent`: Player left room
- `MatchResetEvent`: Match restarted

## Data Flow

### Client Input → Server

```
User Input
    ↓
LocalInputManager (keyboard capture)
    ↓
InputState { moveLeft, jump, ... }
    ↓
EventBasedMultiplayerApp (fixed 60 Hz interval)
    ↓
NetworkManager.sendPlayerInput()
    ↓
WebSocket send PlayerInputEvent
    ↓
Server WebSocket handler
```

### Server Simulation → Client Update

```
Server GameEngine.tick()
    ↓
Physics simulation (RAPIER)
    ↓
Generate GameEvents (PlayerMovedEvent, etc.)
    ↓
Every 5 ticks: Generate GameStateUpdateEvent
    ↓
Broadcast events to all players
    ↓
WebSocket send GameEvent
    ↓
Client WebSocket handler
    ↓
NetworkManager receives message
    ↓
Fire onGameEvent listeners
    ↓
EventBasedMultiplayerApp.handleGameEvent()
    ↓
ClientGameState.processEvent()
    ↓
Update game snapshot
    ↓
Next render frame reads snapshot
    ↓
GameRenderer renders to canvas
```

## State Synchronization Strategy

### Server as Source of Truth

- **Server maintains the authoritative state**
- All entities (players, projectiles, items) are managed only on the server
- Client state is a view/replica of server state
- Server-side validation of all inputs

### Eventual Consistency

- Events propagate at network speed (~50-200 ms typical)
- Clients may be slightly out of sync temporarily
- Server state eventually propagates to all clients
- Periodic full snapshots ensure consistency

### Client-Side Prediction (Optional)

- Clients can predict their own movement based on input
- When server state arrives, reconcile with prediction
- Smooths out network latency from client perspective

### Interpolation

- Use velocity data from events to smoothly animate between frames
- Keeps visual representation smooth even with discrete updates

## Connection Management

### Lifecycle

1. **Menu**: Not connected
2. **Connecting**: Establishing WebSocket to server
3. **Connected**: Ready to receive events
4. **In Game**: Actively playing, sending/receiving events
5. **Disconnected**: Connection lost, attempting reconnect

### Reconnection Strategy

- Exponential backoff: 1s, 2s, 4s, 8s, ..., max 30s
- Max 10 reconnection attempts
- Automatic reconnect on disconnect
- User can manually reconnect from UI

### Heartbeat

- Ping sent every 30 seconds
- Server responds with pong
- Detects dead connections before timeout

## Game Loop

### Client-Side Game Loop

```
requestAnimationFrame(loop):
  Update phase:
    - Collect current input
    - If 16.6ms elapsed (60 Hz): send to server
  Render phase:
    - Read current snapshot from ClientGameState
    - Render to canvas
```

### Server-Side Game Loop

```
Every 16.6ms (60 Hz):
  for each room:
    Process buffered player inputs
    Run physics simulation
    Check collisions/interactions
    Generate events
    Broadcast to all players in room
```

## Extensibility

### Adding a New Game Mechanic

1. **Define Event Type** (GameEvents.ts):
```typescript
export interface PlayerSpecialEvent extends BaseGameEvent {
  type: 'player_special';
  playerId: string;
  effectData: any;
}

export type GameEvent = /* ... existing types ... */ | PlayerSpecialEvent;
```

2. **Implement Server-Side Logic** (ServerGameEngine.ts):
```typescript
private handlePlayerSpecial(player: ServerPlayerState): void {
  // Game logic here
  const event: PlayerSpecialEvent = {
    type: 'player_special',
    timestamp: Date.now(),
    tick: this.tickCount,
    playerId: player.id,
    effectData: { ... }
  };
  this.eventQueue.push(event);
}
```

3. **Process on Client** (ClientGameState.ts):
```typescript
case 'player_special': {
  // Update local state based on event
  const player = this.currentSnapshot.players.get(event.playerId);
  if (player) {
    // Apply effects
  }
  break;
}
```

4. **Render** (GameRenderer.ts):
```typescript
// Add rendering logic for the new effect
```

## Comparison with Rollback Netcode

### Rollback Netcode (GGPO)
- ❌ P2P peer connections
- ❌ Complex state rollback logic
- ❌ Deterministic frame-perfect simulation
- ❌ Requires careful network state encoding
- ✅ Low latency for competitive play
- ✅ No server dependency

### Event-Based Server-Authoritative (This System)
- ✅ Simple client-server architecture
- ✅ Clear separation of concerns
- ✅ Easy to debug and extend
- ✅ Built-in anti-cheat
- ✅ Scales to many players
- ✅ Events provide audit trail
- ✅ Simpler to understand and maintain
- ❌ Requires server infrastructure
- ❌ ~50-200ms latency added to actions

## Performance Considerations

### Network Optimization

- Player input: ~50 bytes per client per tick
- At 60 Hz, 4 players: ~12 KB/s upload
- Events: Variable size, typically ~100-500 bytes
- At 60 Hz, 4 players: ~24-120 KB/s download

### Server Scalability

- Per room: 1 physics world (RAPIER instance)
- Independent rooms don't block each other
- Can shard rooms across multiple servers
- Horizontal scaling via load balancer

### Client Performance

- WebSocket light on CPU vs P2P WebRTC
- Canvas rendering (most expensive operation)
- ClientGameState is O(n) where n = number of entities

## Security Considerations

### Input Validation

- Server validates all player input
- Check that actions are legal for current state
- Prevent cheating (teleporting, infinite health, etc.)

### Rate Limiting

- Rate limit input from clients
- Prevent bot attacks
- Detect unusual input patterns

### Server Authority

- Never trust client state
- All collisions calculated on server
- All damage applied on server
- Server decides winners/outcomes

## Debugging

### Tools

- **Browser DevTools**: WebSocket message inspection
- **Server Logs**: Game state changes, input processing
- **Event Replay**: Record and replay event sequence
- **Network Monitoring**: Latency, packet loss, bandwidth

### Common Issues

**Issue**: Entities jittering
- **Cause**: Network latency or dropped frames
- **Solution**: Increase interpolation window, add prediction

**Issue**: Input lag
- **Cause**: High server latency or input send rate too low
- **Solution**: Increase input send rate (up to tick rate)

**Issue**: Desync between clients
- **Cause**: Event not delivered, or processing order differs
- **Solution**: Rely on periodic full snapshot (GameStateUpdateEvent)

## Migration Guide

### From Rollback Netcode to Event-Based

**Before**: Replace `MultiplayerApp` with `EventBasedMultiplayerApp`
```typescript
// OLD
const app = new MultiplayerApp(session, canvas);

// NEW
const app = new EventBasedMultiplayerApp('canvas#game');
await app.initialize();
```

**Update Server**: Replace signaling server with GameEngine/RoomManager
```typescript
// OLD: WebRTC signaling server
// NEW: Full WebSocket game server with GameEngine
```

**Adapt Rendering**: Update GameRenderer if needed
- Input: GameSnapshot instead of render state from rollback lib
- Output: Same - canvas rendering

## Future Enhancements

1. **Spectator Mode**: Send readonly event stream to observers
2. **Replays**: Record events for later playback
3. **Cloud Saving**: Archive event streams
4. **Lag Compensation**: Lead target prediction
5. **Bandwidth Optimization**: Event compression, delta updates
6. **Multi-Server**: Load balancing and federation
7. **AI Players**: Server-side bot logic
8. **Matchmaking**: Player rating and skill-based matching
