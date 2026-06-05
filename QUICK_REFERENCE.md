# Event-Based Architecture - Quick Reference Guide

## 30-Second Overview

**What Changed:** From P2P rollback-netcode to server-authoritative event-based multiplayer
**Why:** Simpler, scalable, better for most games, built-in anti-cheat
**How:** WebSocket communication with event streaming

## Quick Start Commands

```bash
# Install dependencies
npm install

# Start development server
npm run dev:server

# Start dev client (in another terminal)
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

## File Quick Reference

| File | Purpose |
|------|---------|
| `src/shared/GameEvents.ts` | Event type definitions |
| `src/shared/EventUtils.ts` | Event queue, dispatcher, metrics |
| `src/client/LocalInputManager.ts` | Capture keyboard input |
| `src/client/NetworkManager.ts` | WebSocket communication |
| `src/client/ClientGameState.ts` | Synchronize game state |
| `src/client/ClientPredictionSystem.ts` | Prediction & interpolation |
| `src/client/EventBasedMultiplayerApp.ts` | Main client app |
| `src/server/index-new.ts` | WebSocket server |
| `src/server/GameEngine.ts` | Physics & game logic |
| `src/server/RoomManager.ts` | Room management |
| `src/server/GameLogicHelpers.ts` | Game logic utilities |

## Common Tasks

### Add New Event Type

```typescript
// 1. In GameEvents.ts
export interface MyEventEvent extends BaseGameEvent {
  type: 'my_event';
  // ... fields
}

// 2. In GameEngine.ts
case 'condition':
  const event: MyEventEvent = { type: 'my_event', ... };
  this.eventQueue.push(event);

// 3. In ClientGameState.ts
case 'my_event':
  // Process event
  break;

// 4. In GameRenderer.ts (if visual)
// Add rendering logic
```

### Handle Player Input

```typescript
// Client side (already handled)
// - LocalInputManager captures keyboard
// - NetworkManager sends 60 Hz
// - Server receives via WebSocket

// Server side (GameEngine.ts)
processPlayerInput(playerId, tick, actions) {
  const player = this.players.get(playerId);
  if (actions.moveLeft) {
    // Apply movement
  }
}
```

### Debug Network Messages

```typescript
// In browser DevTools:
// 1. Open Network tab
// 2. Filter by "WS"
// 3. Click WebSocket connection
// 4. View "Messages" tab
// 5. Each message is JSON - expandable
```

### Test Event Processing

```typescript
import { ClientGameState } from './ClientGameState';
import { PlayerMovedEvent } from '../shared/GameEvents';

const state = new ClientGameState();
const event: PlayerMovedEvent = {
  type: 'player_moved',
  timestamp: Date.now(),
  tick: 1,
  playerId: 'p1',
  x: 10, y: 20, vx: 5, vy: 0, facing: 1
};

state.processEvent(event);
expect(state.getPlayer('p1')?.x).toBe(10);
```

### Inspect Game State

```typescript
// In browser console
// app.gameState.getCurrentSnapshot()
// Gives you: {
//   tick: 42,
//   players: Map<string, PlayerState>,
//   projectiles: Map<number, ProjectileState>,
//   items: Map<number, ItemState>
// }
```

## Event Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENT SIDE                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Keyboard → LocalInputManager → NetworkManager → WebSocket   │
│                                                               │
│  WebSocket → NetworkManager → ClientGameState → Renderer     │
│                                                               │
└────────────────────────┬────────────────────────────────────┘
                         │ WebSocket
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                         SERVER SIDE                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  WebSocket → GameRoom → GameEngine → Physics Simulation      │
│                                                               │
│  Physics → Generate Events → Broadcast → All Clients        │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Key Classes & Methods

### NetworkManager
```typescript
new NetworkManager(url, roomId, playerId)
  .connect()
  .sendPlayerInput(actions)
  .joinGame(mapId, maxPlayers)
  .onGameEvent(listener)
  .disconnect()
```

### ClientGameState
```typescript
new ClientGameState()
  .processEvent(event)
  .getSnapshot()
  .getPlayer(playerId)
  .getPlayers()
  .reset()
```

### GameEngine (Server)
```typescript
new ServerGameEngine(mapDef)
  .addPlayer(playerId, colorIndex)
  .processPlayerInput(playerId, tick, actions)
  .tick()
  .getPlayers()
```

### GameRoom (Server)
```typescript
new GameRoom(roomId, mapId, maxPlayers, mapDef)
  .addPlayer(playerId, socket)
  .removePlayer(playerId)
  .processPlayerInput(playerId, tick, actions)
  .isStarted()
```

## Network Message Format

### Client → Server (Player Input)
```json
{
  "type": "player_input",
  "roomId": "room_123",
  "playerId": "player_456",
  "data": {
    "tick": 42,
    "actions": {
      "moveLeft": false,
      "moveRight": true,
      "jump": false,
      "duck": false,
      "punch": false,
      "dash": false,
      "shoot": false
    }
  }
}
```

### Server → Client (Game Event)
```json
{
  "type": "game_event",
  "data": {
    "type": "player_moved",
    "timestamp": 1234567890,
    "tick": 42,
    "playerId": "player_456",
    "x": 10.5,
    "y": 20.3,
    "vx": 5.2,
    "vy": 0,
    "facing": 1
  }
}
```

## Debugging Quick Tips

### See All Events
```typescript
const replayer = new EventReplayer();
replayer.startRecording();
// Play game...
console.log(replayer.getRecordedEventCount());
```

### Check Latency
```typescript
const simulator = new NetworkSimulator();
simulator.setLatency(200);
simulator.setPacketLoss(0.1);
simulator.setEnabled(true);
```

### Profile Performance
```typescript
const profiler = new PerformanceProfiler();
profiler.mark('start');
// ... code to profile
profiler.measure('operation', 'start');
console.log(profiler.getReport());
```

### Validate Game State
```typescript
const validator = new GameStateValidator();
const result = validator.validate(snapshot);
if (!result.valid) {
  console.error('State errors:', result.errors);
}
```

## Common Gotchas

❌ **DON'T**: Trust client state
✅ **DO**: Validate everything on server

❌ **DON'T**: Send state updates every frame
✅ **DO**: Send only changed state

❌ **DON'T**: Block on network operations
✅ **DO**: Use async/await and event listeners

❌ **DON'T**: Forget to close WebSocket on disconnect
✅ **DO**: Call networkManager.disconnect()

❌ **DON'T**: Keep old listeners after component unmounts
✅ **DO**: Remove listeners with offGameEvent()

## Performance Targets

- **Input Latency**: <50ms (local prediction)
- **Network Latency**: <200ms (acceptable)
- **Server Tick Rate**: 60 Hz (16.6ms)
- **Bandwidth per Player**: ~10 KB/s
- **Room Capacity**: 4-8 players (adjust for your game)

## File Locations

```
New Event-Based System:
├── src/main-new.ts (entry point)
├── src/client/EventBasedMultiplayerApp.ts
├── src/client/NetworkManager.ts
├── src/client/ClientGameState.ts
├── src/server/index-new.ts
├── src/server/GameEngine.ts
└── src/shared/GameEvents.ts

Deprecated (old rollback system):
├── src/main.ts
├── src/client/MultiplayerApp.ts
├── src/client/RollbackPhysicsGame.ts
└── src/server/index.ts

Documentation:
├── ARCHITECTURE_EVENT_BASED.md
├── ARCHITECTURE_REFACTOR_SUMMARY.md
└── IMPLEMENTATION_GUIDE.md
```

## Useful Links

- [WebSocket MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [RAPIER Physics](https://rapier.rs/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Event-Driven Programming](https://en.wikipedia.org/wiki/Event-driven_architecture)
- [Client-Side Prediction](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html)

## Quick Troubleshooting

**Problem**: Can't connect to server
```
→ Check WebSocket URL in NetworkManager
→ Check server is running (npm run dev:server)
→ Check firewall/proxy isn't blocking WebSockets
```

**Problem**: Game state out of sync
```
→ Check GameStateUpdateEvent is being broadcast
→ Verify ClientGameState.processEvent is being called
→ Check server tick rate is stable
```

**Problem**: Input lag
```
→ Increase input send rate (check TICK_RATE)
→ Check network latency with simulator
→ Enable client-side prediction
→ Check browser performance (DevTools)
```

**Problem**: Memory leak
```
→ Check event listeners are removed (offGameEvent)
→ Verify WebSocket is closed (disconnect)
→ Check game loop is stopped
→ Profile with Chrome DevTools Memory tab
```

---

**Last Updated**: 2024
**Version**: 1.0
**Architecture**: Event-Based Server-Authoritative
