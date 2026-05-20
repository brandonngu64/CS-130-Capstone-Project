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

- For HTTPS client pages, use secure WebSocket (`wss://`) signaling. The app now defaults to same-origin `/ws` and only needs `VITE_SIGNALING_URL` if you want to override that.
- WebRTC across restrictive NATs may require TURN servers in addition to STUN.
- Short network drops no longer tear down a room immediately. The client persists its peer id locally, retries signaling reconnects, and the server keeps rooms alive for a 15 second grace window before finalizing a disconnect.
- If the host reloads the shared room URL, the app now tries to reattach to the existing room instead of joining it as a guest.
- If a guest closes the tab or loses the browser abruptly, the host now drops that player from the rollback session immediately so the remaining players keep ticking.

## AWS Deployment

This project can run on a single AWS EC2 instance without Vercel.

Recommended setup:

1. Launch one small EC2 instance and open ports `22`, `80`, and `443` in the security group.
2. Install Node.js, clone the repo, run `npm install`, then `npm run build`.
3. Start the production server with `npm start`.
4. Put Caddy or Nginx in front of Node if you want HTTPS. Proxy the public site to the Node process and forward `/ws` to the same process.
5. Leave `VITE_SIGNALING_URL` unset unless you intentionally host signaling somewhere else.

With this setup, the browser talks to one public origin, the signaling socket lives at `/ws`, and the app no longer depends on a separate Vercel-hosted websocket endpoint.

### Port Workflow

Think about AWS ports in two layers:

- AWS security group rules control what can reach the EC2 instance from the internet. These are inbound rules.
- The Node process and reverse proxy listen on local ports inside the instance.

Recommended port layout:

- `22/tcp` inbound: SSH for admin access from your own IP only.
- `80/tcp` inbound: HTTP entry point for Caddy or Nginx.
- `443/tcp` inbound: HTTPS entry point for Caddy or Nginx.
- `3000/tcp` inbound: usually not exposed publicly if Caddy/Nginx is proxying to Node locally.

Outbound traffic is usually left open by default. That lets the instance reach package registries, STUN/TURN servers, and other external services.

### What Proxying Means

Without a proxy, the browser would talk directly to Node on `http://your-host:3000` or `ws://your-host:3000/ws`.

With Caddy or Nginx in front, the browser talks to ports `80`/`443` instead. The proxy receives the public request and forwards it to Node on `127.0.0.1:3000`.

For example:

- Browser requests `https://your-domain.com/`
- Caddy/Nginx receives that request on port `443`
- Caddy/Nginx forwards it to Node on `http://127.0.0.1:3000/`
- Node serves the built frontend from `dist/`

For websocket traffic:

- Browser opens `wss://your-domain.com/ws`
- Caddy/Nginx forwards the websocket upgrade to Node on `127.0.0.1:3000/ws`
- The signaling server handles the socket connection

This is called a reverse proxy because the proxy sits in front of your app and relays incoming traffic into it.

### Example Production Flow

1. Build the app with `npm run build`.
2. Start Node with `npm start` so it listens on port `3000` locally.
3. Run Caddy or Nginx so the public site is exposed on `80`/`443`.
4. Keep the Node port private to the instance.
5. Share the public HTTPS URL with players.

### Important Constraint

This setup solves the frontend/signaling hosting split, but it does not remove WebRTC NAT traversal issues. Some networks still need TURN to connect reliably.

### Cheapest Free Setup

If you do not want to buy a domain yet, skip Caddy and Nginx and run the app directly on port `3000`.

On an Ubuntu EC2 instance:

```bash
sudo apt update
sudo apt install -y git curl build-essential

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

git clone <YOUR_REPO_URL>
cd CS-130-Capstone-Project
npm install
npm run build
npm start
```

Then open inbound port `3000/tcp` in the EC2 security group and visit:

```text
http://YOUR_EC2_PUBLIC_DNS:3000
```

The app will load the frontend from the same process and use the matching websocket endpoint at `/ws` automatically.

To keep it running after you close SSH, use a systemd service:

```bash
sudo tee /etc/systemd/system/cs130.service >/dev/null <<'EOF'
[Unit]
Description=CS130 multiplayer server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/CS-130-Capstone-Project
Environment=HOST=0.0.0.0
Environment=PORT=3000
ExecStart=/usr/bin/npm start
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable cs130
sudo systemctl start cs130
sudo systemctl status cs130
```

## AWS Deployment

This project can run on a single AWS EC2 instance without Vercel.

Recommended setup:

1. Launch one small EC2 instance and open ports `22`, `80`, and `443` in the security group.
2. Install Node.js, clone the repo, run `npm install`, then `npm run build`.
3. Start the production server with `npm start`.
4. Put Caddy or Nginx in front of Node if you want HTTPS. Proxy the public site to the Node process and forward `/ws` to the same process.
5. Leave `VITE_SIGNALING_URL` unset unless you intentionally host signaling somewhere else.

With this setup, the browser talks to one public origin, the signaling socket lives at `/ws`, and the app no longer depends on a separate Vercel-hosted websocket endpoint.

### Port Workflow

Think about AWS ports in two layers:

- AWS security group rules control what can reach the EC2 instance from the internet. These are inbound rules.
- The Node process and reverse proxy listen on local ports inside the instance.

Recommended port layout:

- `22/tcp` inbound: SSH for admin access from your own IP only.
- `80/tcp` inbound: HTTP entry point for Caddy or Nginx.
- `443/tcp` inbound: HTTPS entry point for Caddy or Nginx.
- `3000/tcp` inbound: usually not exposed publicly if Caddy/Nginx is proxying to Node locally.

Outbound traffic is usually left open by default. That lets the instance reach package registries, STUN/TURN servers, and other external services.

### What Proxying Means

Without a proxy, the browser would talk directly to Node on `http://your-host:3000` or `ws://your-host:3000/ws`.

With Caddy or Nginx in front, the browser talks to ports `80`/`443` instead. The proxy receives the public request and forwards it to Node on `127.0.0.1:3000`.

For example:

- Browser requests `https://your-domain.com/`
- Caddy/Nginx receives that request on port `443`
- Caddy/Nginx forwards it to Node on `http://127.0.0.1:3000/`
- Node serves the built frontend from `dist/`

For websocket traffic:

- Browser opens `wss://your-domain.com/ws`
- Caddy/Nginx forwards the websocket upgrade to Node on `127.0.0.1:3000/ws`
- The signaling server handles the socket connection

This is called a reverse proxy because the proxy sits in front of your app and relays incoming traffic into it.

### Example Production Flow

1. Build the app with `npm run build`.
2. Start Node with `npm start` so it listens on port `3000` locally.
3. Run Caddy or Nginx so the public site is exposed on `80`/`443`.
4. Keep the Node port private to the instance.
5. Share the public HTTPS URL with players.

### Important Constraint

This setup solves the frontend/signaling hosting split, but it does not remove WebRTC NAT traversal issues. Some networks still need TURN to connect reliably.

### Cheapest Free Setup

If you do not want to buy a domain yet, skip Caddy and Nginx and run the app directly on port `3000`.

On an Ubuntu EC2 instance:

```bash
sudo apt update
sudo apt install -y git curl build-essential

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

git clone <YOUR_REPO_URL>
cd CS-130-Capstone-Project
npm install
npm run build
npm start
```

Then open inbound port `3000/tcp` in the EC2 security group and visit:

```text
http://YOUR_EC2_PUBLIC_DNS:3000
```

The app will load the frontend from the same process and use the matching websocket endpoint at `/ws` automatically.

To keep it running after you close SSH, use a systemd service:

```bash
sudo tee /etc/systemd/system/cs130.service >/dev/null <<'EOF'
[Unit]
Description=CS130 multiplayer server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/CS-130-Capstone-Project
Environment=HOST=0.0.0.0
Environment=PORT=3000
ExecStart=/usr/bin/npm start
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable cs130
sudo systemctl start cs130
sudo systemctl status cs130
```

## Determinism Notes

Simulation runs at fixed tick (`60 Hz`) and avoids random or wall-clock dependent game logic in gameplay state updates. Rollback snapshots serialize full player physical state and input edge state for resimulation consistency.

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
