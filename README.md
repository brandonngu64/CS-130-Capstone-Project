# CS130 Final Project 2 - Multiplayer Rollback Baseline

This project implements the approved multiplayer baseline:

- Vite + TypeScript frontend
- ThreeJS orthographic 2D rendering
- Rapier2D physics (ground at y=0, box players)
- rollback-netcode with WebRTC peer networking
- Host-relayed star topology (up to 4 players)
- In-project signaling server (WebSocket)
- Shared room URL join flow
- Gameplay scope: movement + jump only

## Tech Overview

- Client runtime: [src/main.ts](src/main.ts)
- Multiplayer orchestration/UI: [src/client/MultiplayerApp.ts](src/client/MultiplayerApp.ts)
- Deterministic simulation: [src/client/RollbackPhysicsGame.ts](src/client/RollbackPhysicsGame.ts)
- Rendering: [src/client/GameRenderer.ts](src/client/GameRenderer.ts)
- Signaling server: [src/server/index.ts](src/server/index.ts)

## Install

```bash
npm install
```

## Run (Dev)

Start signaling server + Vite dev server together:

```bash
npm run dev:all
```

Or run each one separately:

```bash
npm run dev:server
npm run dev
```

Default ports:

- Client: `http://localhost:5173`
- Signaling WS: `ws://localhost:3000`

## Build

```bash
npm run build
```

This outputs:

- Frontend build in `dist/`
- Signaling server build in `dist-server/`

To run the built signaling server:

```bash
npm run start:server
```

## Test / Type Validation

```bash
npm test
```

Current test command runs TypeScript checks for client + server:

```bash
npm run typecheck
```

## Gameplay Controls

- Move left: `A` or `Left Arrow`
- Move right: `D` or `Right Arrow`
- Jump: `W`, `Up Arrow`, or `Space`

## Shared Room URL Flow

1. Open the app and click **Host Room**.
2. Click **Copy** next to **Shared Room URL**.
3. Send that URL to other players.
4. Joiners open the URL, auto-fill room details, and auto-attempt join.

The URL includes room metadata in query params (`room`, `host`, optional `signal`).

## Local Verification Steps

1. Run `npm run dev:all`.
2. Open one browser tab and host a room.
3. Copy room URL and open it in 1-3 additional tabs or browsers.
4. Verify:
   - Up to 4 players connect.
   - Each player appears as a colored box.
   - Movement/jump are visible across peers.
   - Net debug counters update (`tick`, `confirmed tick`, `rollbacks`, `peers`, `players`, `RTT`).

## Cross-Network Verification Steps

1. Deploy signaling server on a reachable host (or tunnel port `3000` with a public URL).
2. Set **Signaling URL** to that public `ws://` or `wss://` endpoint.
3. Host a room and share the generated room URL with remote players.
4. Verify from different networks:
   - Joiners can connect to host room.
   - Star topology behavior works with host relaying game traffic.
   - Rollback counters remain active under latency.

Notes:

- For HTTPS client pages, use secure WebSocket (`wss://`) signaling.
- WebRTC across restrictive NATs may require TURN servers in addition to STUN.

## Determinism Notes

Simulation runs at fixed tick (`60 Hz`) and avoids random or wall-clock dependent game logic in gameplay state updates. Rollback snapshots serialize full player physical state and input edge state for resimulation consistency.
