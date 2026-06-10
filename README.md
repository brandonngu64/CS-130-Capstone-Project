# CS130 Final Project - Multiplayer Rollback Platform Fighter
## Tech Overview
- Vite + TypeScript frontend
- ThreeJS orthographic 2D camera
- Rapier2D physics engine
- Rollback netcode up to 4 players
- Tiled Map Editor
- TexturePacker

## Quick File Guide
- Client runtime: [src/main.ts](src/main.ts)
- Multiplayer orchestration/UI: [src/client/MultiplayerApp.ts](src/client/MultiplayerApp.ts)
- Deterministic simulation: [src/client/RollbackPhysicsGame.ts](src/client/RollbackPhysicsGame.ts)
- Rendering: [src/client/GameRenderer.ts](src/client/GameRenderer.ts)
- Signaling server: [src/server/index.ts](src/server/index.ts)

## Default ports:
- Client: `http://localhost:5173`
- Signaling WS: `ws://localhost:5173/ws` in the browser, proxied to `ws://localhost:3000/ws`

## Gameplay Controls (Default):
- `WASD` movement, `w` jump
- `u` punch/shoot
- `i` block
- `L Shift` dash
- More Control Scheme in the settings menu

## Shared Room URL
1. Open the app and click **Host Room**.
2. Click **Copy** next to **Shared Room URL**.
   - Note that this does not work in HTTP, same as `crtl-c`
   - Just take from the address bar 
3. Send that URL to other players.
4. Will join the game if there are enough players

## "Couch" Co-op / "Split Screen"
- You can also play with up to 2 players on one "tab".
- Works for clients and host
- Since it is a platform fighter the action camera is always focused on all players.
  #### Controls Player 1
  - `WASD` movement
  - `e` shoot
  - `q` block
  - `L Shift` dash
  #### Controls Player 2
  - $\uarr \darr \rarr \larr$ movement
  - `R Shift` shoot
  - `?` block
  - `R CRTL` dash
  
## Gamemodes
- Classic: Start at 100%. Going to zero means you die.
- Smash: Start at 0%. Taking damage will knock you back, like smash.
  - This mode is more fun :)

## Misc General Notes
- Using the Room/Lobby ID can also used to join the game
- The first time sound adjustment menu can be seen again if you set `cs130-first-run-seen` to 0
  - `dev tools` $\rarr$ `Application` $\rarr$ `Local storage` $\rarr$ `cs130-first-run-seen`

# AWS
We used AWS for deployment and testing. Had free credits left over.
Here is what we used to get our server running:

### Instance Settings
- m5.2xlarge
  - Probably overkill, but it worked great during test
- ubuntu
- Security Group Rules:
  - Inbound:
    - Type: HTTP; Port: 80; Source: 0.0.0.0/0 (anywhere)
    - Type: Custom TCP; Port: 5173; Source: 0.0.0.0/0
    - Type: Custom UDP; Port: 5173; Source: 0.0.0.0/0
    - Type: Custom TCP; Port: 3000; Source: 0.0.0.0/0
    - Type: SSH; Port 22; Source: 0.0.0.0/0
    - Type: HTTPS; Port: 443; Source: 0.0.0.0/0
  - Outbound:
    - All Traffic
- Everything else default





## Deployment on AWS

#### Setup Node v20
- `sudo apt update`
- `sudo apt install nodejs npm -y`
   ###### Upgrade Node Version on AWS:
   - `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash`
   - `source ~/.bashrc`
   - `nvm install 20`
   - `nvm use 20`
   - `nvm alias default 20`

#### Import Github Repo to your Instance
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





# Development on Local
- can use npm
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