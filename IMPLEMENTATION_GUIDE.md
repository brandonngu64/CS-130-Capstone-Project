# Event-Based Multiplayer Architecture - Implementation Guide

## Quick Start

### 1. Start the Server

```bash
npm run dev:server
# or for development with watch
npm run dev:all
```

The server will run on `http://localhost:3000` with WebSocket at `ws://localhost:3000/ws`.

### 2. Access the Client

```bash
npm run dev
```

Navigate to `http://localhost:5173` (Vite dev server).

### 3. Create/Join a Game

1. Click "Host Game" to create a new room
2. Copy the room ID and share it with others
3. Others click "Join Game" and enter the room ID
4. Once 2+ players are in a room, the game starts automatically

## File Structure

```
src/
├── shared/
│   ├── GameEvents.ts          # Event type definitions
│   ├── EventUtils.ts          # Event utilities (queue, dispatcher, etc.)
│   └── DebugTools.ts          # Debugging utilities
├── client/
│   ├── LocalInputManager.ts   # Keyboard input capture
│   ├── NetworkManager.ts      # WebSocket communication
│   ├── ClientGameState.ts     # Game state synchronization
│   ├── ClientPredictionSystem.ts  # Lag compensation & prediction
│   ├── EventBasedMultiplayerApp.ts # Main app orchestrator
│   ├── GameRenderer.ts        # Canvas rendering (existing)
│   ├── GameStateManager.ts    # (will be deprecated)
│   └── RollbackPhysicsGame.ts # (will be deprecated)
├── server/
│   ├── index-new.ts           # WebSocket server entry point
│   ├── GameEngine.ts          # Physics & game logic
│   ├── RoomManager.ts         # Room management
│   ├── GameLogicHelpers.ts    # Utilities for game logic
│   └── index.ts               # (old signaling server)
└── main-new.ts                # New client entry point
```

## Core Concepts

### 1. Events

All game state changes are communicated as events:

```typescript
// Example: Player moves
const event: PlayerMovedEvent = {
  type: 'player_moved',
  timestamp: Date.now(),
  tick: 42,
  playerId: 'player_123',
  x: 10.5,
  y: 20.3,
  vx: 5.2,
  vy: 0,
  facing: 1
};
```

### 2. Input Loop

Client sends input at fixed rate:
```
Keyboard → LocalInputManager → NetworkManager → Server
```

### 3. Simulation Loop

Server runs physics at 60 Hz:
```
Receive Input → Apply to GameEngine → Generate Events → Broadcast to Clients
```

### 4. Update Loop

Client receives events and renders:
```
WebSocket ← Events → ClientGameState → Renderer
```

## Adding New Features

### Example: Add a Special Attack

#### Step 1: Define Event Type

In `GameEvents.ts`:
```typescript
export interface PlayerSpecialAttackEvent extends BaseGameEvent {
  type: 'player_special_attack';
  playerId: string;
  x: number;
  y: number;
  damage: number;
}

export type GameEvent = /* ... */ | PlayerSpecialAttackEvent;
```

#### Step 2: Add to Server Logic

In `GameEngine.ts`:
```typescript
private handleSpecialAttack(player: ServerPlayerState): void {
  const translation = player.body.translation();
  
  // Game logic here...
  
  const event: PlayerSpecialAttackEvent = {
    type: 'player_special_attack',
    timestamp: Date.now(),
    tick: this.tickCount,
    playerId: player.id,
    x: translation.x,
    y: translation.y,
    damage: 50
  };
  this.eventQueue.push(event);
}
```

Then add to `processPlayerInput`:
```typescript
if (actions.specialAttack) {
  this.handleSpecialAttack(player);
}
```

#### Step 3: Add Client Processing

In `ClientGameState.ts`:
```typescript
case 'player_special_attack': {
  // Update local state
  console.log(`Special attack from ${event.playerId}`);
  break;
}
```

#### Step 4: Add to Input Manager

In `LocalInputManager.ts`:
```typescript
this.currentInput.specialAttack = this.keysPressed.has('KeyQ');
```

#### Step 5: Add Input to Protocol

In `NetworkManager.ts` - the `sendPlayerInput` method already sends all actions, just update the protocol to include the new action field.

## Network Messages

### Client to Server

```typescript
{
  type: 'player_input',
  roomId: 'room_123',
  playerId: 'player_456',
  data: {
    tick: 42,
    actions: {
      moveLeft: false,
      moveRight: true,
      jump: false,
      // ... etc
    }
  }
}
```

### Server to Client

```typescript
{
  type: 'game_event',
  data: {
    // Any GameEvent type
  }
}
```

## Performance Tips

### 1. Reduce Event Frequency

Don't emit event every tick for every entity. Use delta updates:
```typescript
if (player.x !== lastX || player.y !== lastY) {
  emitEvent(playerMovedEvent);
}
```

### 2. Batch Updates

Combine multiple related events into a single message when possible.

### 3. Use Full Snapshots

Every 5 ticks, emit `GameStateUpdateEvent` for full consistency:
```typescript
if (this.tickCount % 5 === 0) {
  this.emitGameStateSnapshot();
}
```

### 4. Monitor Network

Check bandwidth usage:
- Per player: ~50 bytes input per tick at 60 Hz = 3 KB/s
- Per player: ~100-500 bytes output per tick = 6-30 KB/s

## Debugging

### Enable Debug Mode

```typescript
const app = new EventBasedMultiplayerApp('canvas#game');
// Debug utilities available from app instance
```

### Using Debug Utilities

```typescript
import { DebugConsole, EventReplayer, NetworkSimulator } from './shared/DebugTools';

// Record events for replay
const replayer = new EventReplayer();
replayer.startRecording();
// ... play game
const json = replayer.exportEvents();

// Simulate network conditions
const simulator = new NetworkSimulator();
simulator.setLatency(200); // 200ms latency
simulator.setPacketLoss(0.1); // 10% packet loss
simulator.setEnabled(true);
```

### Event Inspection

Use browser DevTools to inspect WebSocket messages:
1. Open DevTools → Network tab
2. Filter by "WS" (WebSocket)
3. Click the connection
4. View Messages tab to see events

## Testing

### Testing Checklist

- [ ] Host game creates room
- [ ] Join game finds existing room  
- [ ] Player input sends to server
- [ ] Events broadcast to all players
- [ ] Game state stays synchronized
- [ ] Reconnection works after disconnect
- [ ] Multiple games run independently
- [ ] Room cleanup on player disconnect

### Automated Testing

Create test files in `src/test/`:

```typescript
import { ClientGameState } from '../client/ClientGameState';
import { PlayerMovedEvent } from '../shared/GameEvents';

test('ClientGameState processes PlayerMovedEvent', () => {
  const state = new ClientGameState();
  
  const event: PlayerMovedEvent = {
    type: 'player_moved',
    timestamp: Date.now(),
    tick: 1,
    playerId: 'player_1',
    x: 10,
    y: 20,
    vx: 5,
    vy: 0,
    facing: 1
  };
  
  state.processEvent(event);
  
  const player = state.getPlayer('player_1');
  expect(player?.x).toBe(10);
  expect(player?.y).toBe(20);
});
```

## Troubleshooting

### Issue: "Cannot find module GameEvents"

**Solution**: Make sure you're importing from the correct path:
```typescript
import type { GameEvent } from '../shared/GameEvents';
```

### Issue: Players seeing different state

**Check**:
1. Are events being broadcast to all players?
2. Is server tick rate consistent?
3. Are full snapshots being sent periodically?

### Issue: Input lag

**Solutions**:
1. Increase input send rate (check `TICK_RATE`)
2. Use client-side prediction for local player
3. Check network latency in DevTools

### Issue: Memory leaks

**Check**:
1. Event listeners being removed properly
2. WebSocket connections closed on disconnect
3. Game state cleared when leaving game

## Migration from Rollback Netcode

If migrating existing code:

### Old Code
```typescript
import { MultiplayerApp } from './MultiplayerApp';
const app = new MultiplayerApp(session, canvas);
```

### New Code
```typescript
import { EventBasedMultiplayerApp } from './EventBasedMultiplayerApp';
const app = new EventBasedMultiplayerApp('canvas#game');
await app.initialize();
```

### Key Differences

| Aspect | Rollback | Event-Based |
|--------|----------|-------------|
| Network | P2P WebRTC | Client-Server WebSocket |
| Authority | Distributed | Server |
| Consistency | Frame-perfect | Eventual |
| Complexity | High | Low |
| Lag tolerance | Low | High |
| Scalability | Limited | Excellent |
| Anti-cheat | Difficult | Built-in |

## API Reference

### NetworkManager

```typescript
const nm = new NetworkManager(url, roomId, playerId);

await nm.connect();
nm.sendPlayerInput(actions);
nm.joinGame(mapId, maxPlayers);
nm.onGameEvent(listener);
nm.disconnect();
```

### ClientGameState

```typescript
const gs = new ClientGameState();

gs.processEvent(event);
gs.getSnapshot();
gs.getPlayer(playerId);
gs.getPlayers();
gs.getTick();
gs.reset();
```

### LocalInputManager

```typescript
const im = new InputManager();

im.getCurrentInput();
im.setKeyPressed(code, pressed);
im.isKeyPressed(code);
im.reset();
```

### GameEngine (Server)

```typescript
const engine = new ServerGameEngine(mapDef);

engine.addPlayer(playerId, colorIndex);
engine.processPlayerInput(playerId, tick, actions);
engine.tick();
engine.getPlayers();
```

## Resources

- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [RAPIER Physics](https://rapier.rs/)
- [Event-Driven Architecture](https://en.wikipedia.org/wiki/Event-driven_architecture)
- [Client-Side Prediction](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html)

## Support

For issues or questions:
1. Check the ARCHITECTURE_EVENT_BASED.md document
2. Review debug logs in browser console
3. Inspect network messages in DevTools
4. Check server logs in terminal
