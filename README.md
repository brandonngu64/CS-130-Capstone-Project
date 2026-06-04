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

The frontend now connects to the signaling server through the same `/ws` path, and Vite proxies that path to the local server on port `3000`.

Or run each one separately:

```bash
npm run dev:server
npm run dev
```

Default ports:

- Client: `http://localhost:5173`
- Signaling WS: `ws://localhost:5173/ws` in the browser, proxied to `ws://localhost:3000/ws`

## Build

```bash
npm run build
```

This outputs:

- Frontend build in `dist/`
- Signaling server build in `dist-server/`

To run the built app and signaling server from one Node process:

```bash
npm start
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

## Determinism Notes

Simulation runs at fixed tick (`60 Hz`) and avoids random or wall-clock dependent game logic in gameplay state updates. Rollback snapshots serialize full player physical state and input edge state for resimulation consistency.

# AWS Setup

### Notes
- m5.2xlarge, t3 micro and nano were unworkable
- ubuntu
- Security Group Rules:
  - Inbound:
    - Type: HTTP; Port: 80; Source: 0.0.0.0/0 (anywhere)
    - Type: Custom TCP; Port: 5173; Source: 0.0.0.0/0
    - Type: Custom TCP; Port: 3000; Source: 0.0.0.0/0
    - Type: SSH; Port 22; Source: 0.0.0.0/0
    - Type: HTTPS; Port: 443; Source: 0.0.0.0/0
  - Outbound:
    - All Traffic
- Everything else default





# Deployment on AWS

### Setup Node v20
- `sudo apt update`
- `sudo apt install nodejs npm -y`
   ### Upgrade Node Version on AWS:
   - `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash`
   - `source ~/.bashrc`
   - `nvm install 20`
   - `nvm use 20`
   - `nvm alias default 20`

### Import Github Repo
- importing repo via ssh key on remote:
  `git clone git@github.com:username/repository-name.git`
  - `git clone git@github.com:brandonngu64/CS-130-Capstone-Project.git`
  ##### Git Command Notes CLI
  - `git branch -a` show all branches
  - `git switch <BRANCH NAME>`

### Launching
- `npm install`
- `npm run dev:all`
  - starts up server and client: `server`





# Deployment on Local
- can use npm or pnpm
- get node version 20 for vite support
- `npm install`
- `npm run dev:all`





# Making Maps
- Download Tiled from: https://thorbjorn.itch.io/tiled
- Tilemap:
  - Stored in `./src/assets/tilemap`
  - Contains json that has properties of tiles and the image the the tiles map to
- Maps:
  - Stored in `./src/assets/maps`
  - Contains json for assembling the tiles from the tileset into a map
  - Specifications:
    - There are layers of tilemaps that MUST obey specific naming conventions
    - `level_layer` contains collidable objects.
      - `int collision` can be 2 full collision, 1 platform collision, 0 no collision
        - These values are listed in the tile map
    - `background` contains tile to be rendered behind the player and `level_layer`
    - `foreground` contains tiles to be rendered above the player and other layers
    - Do not add more or less layers than this in the map file
      - they must have these specific names
- Other than that learn the software and you should be good to go
- When exporting export to JSON