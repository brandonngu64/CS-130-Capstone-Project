import { NetworkManager } from './NetworkManager';
import { ClientGameState, type GameSnapshot } from './ClientGameState';
import { InputManager, type InputState } from './LocalInputManager';
import { GameRenderer } from './GameRenderer';
import { MainMenu, type StatusTone } from './MainMenu';
import { SettingsMenu } from './SettingsMenu';
import { StockHud } from './StockHud';
import { HealthBarOverlay } from './HealthBarOverlay';
import { TICK_RATE } from './constants';
import type { GameEvent } from '../shared/GameEvents';

interface AppState {
  currentScreen:
    | 'menu'
    | 'settings'
    | 'loading'
    | 'game'
    | 'game_ended'
    | 'disconnected';
  roomId: string;
  playerId: string;
  mapId: string;
  maxPlayers: number;
  playerIds: string[];
}

export class EventBasedMultiplayerApp {
  private appState: AppState = {
    currentScreen: 'menu',
    roomId: '',
    playerId: '',
    mapId: 'office',
    maxPlayers: 4,
    playerIds: [],
  };

  private networkManager: NetworkManager | null = null;
  private gameState: ClientGameState = new ClientGameState();
  private inputManager: InputManager = new InputManager();
  private renderer: GameRenderer;
  private mainMenu: MainMenu;
  private settingsMenu: SettingsMenu;
  private stockHud: StockHud;
  private healthBarOverlay: HealthBarOverlay;
  private gameLoopId: number | null = null;
  private lastInputSendTime = 0;
  private inputSendInterval = 1000 / TICK_RATE;

  constructor(canvasSelector: string) {
    // Initialize UI components
    const canvas = document.querySelector<HTMLCanvasElement>(canvasSelector);
    if (!canvas) {
      throw new Error(`Canvas element not found: ${canvasSelector}`);
    }

    this.renderer = new GameRenderer(canvas);
    this.mainMenu = new MainMenu();
    this.settingsMenu = new SettingsMenu();
    this.stockHud = new StockHud();
    this.healthBarOverlay = new HealthBarOverlay();

    // Setup event listeners
    this.mainMenu.onHostGame(() => this.handleHostGame());
    this.mainMenu.onJoinGame((roomId) => this.handleJoinGame(roomId));
    this.mainMenu.onSettings(() => this.showSettings());

    this.settingsMenu.onBack(() => this.showMenu());

    // Generate unique player ID
    this.appState.playerId = this.generatePlayerId();

    // Show main menu initially
    this.showMenu();
  }

  private generatePlayerId(): string {
    return `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateRoomId(): string {
    return `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private handleHostGame(): void {
    this.appState.roomId = this.generateRoomId();
    this.appState.maxPlayers = 4;
    this.startConnecting();
  }

  private handleJoinGame(roomId: string): void {
    this.appState.roomId = roomId;
    this.appState.maxPlayers = 4;
    this.startConnecting();
  }

  private startConnecting(): void {
    this.appState.currentScreen = 'loading';
    this.mainMenu.hide();

    const serverUrl = this.getServerUrl();
    this.networkManager = new NetworkManager(serverUrl, this.appState.roomId, this.appState.playerId);

    this.networkManager.onGameEvent((event) => this.handleGameEvent(event));
    this.networkManager.onConnectionStateChanged((connected) =>
      this.handleConnectionStateChanged(connected),
    );

    this.networkManager
      .connect()
      .then(() => {
        this.networkManager!.joinGame(this.appState.mapId, this.appState.maxPlayers);
        this.appState.currentScreen = 'game';
        this.startGameLoop();
      })
      .catch((error) => {
        console.error('Failed to connect:', error);
        this.appState.currentScreen = 'disconnected';
        this.mainMenu.setStatus(`Connection failed: ${error.message}`, 'error');
        this.mainMenu.show();
      });
  }

  private handleGameEvent(event: GameEvent): void {
    // Process the event with our game state
    this.gameState.processEvent(event);

    // Update UI based on event
    if (event.type === 'game_started' || event.type === 'match_reset') {
      this.appState.playerIds = (event as any).playerIds || [];
    }

    if (event.type === 'player_left' || event.type === 'player_joined') {
      this.appState.currentScreen = 'game';
    }

    if (event.type === 'game_ended') {
      this.appState.currentScreen = 'game_ended';
      const reason = (event as any).reason;
      this.mainMenu.setStatus(`Game ended: ${reason}`, 'info');
    }
  }

  private handleConnectionStateChanged(connected: boolean): void {
    if (!connected) {
      this.appState.currentScreen = 'disconnected';
      this.mainMenu.setStatus('Disconnected from server', 'error');
      this.mainMenu.show();
      this.stopGameLoop();
    }
  }

  private getServerUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws`;
  }

  private startGameLoop(): void {
    if (this.gameLoopId !== null) {
      cancelAnimationFrame(this.gameLoopId);
    }

    const gameLoop = (timestamp: number) => {
      this.update(timestamp);
      this.render();
      this.gameLoopId = requestAnimationFrame(gameLoop);
    };

    this.gameLoopId = requestAnimationFrame(gameLoop);
  }

  private stopGameLoop(): void {
    if (this.gameLoopId !== null) {
      cancelAnimationFrame(this.gameLoopId);
      this.gameLoopId = null;
    }
  }

  private update(timestamp: number): void {
    if (this.appState.currentScreen !== 'game') {
      return;
    }

    // Collect and send input at fixed rate
    if (timestamp - this.lastInputSendTime >= this.inputSendInterval) {
      const input = this.inputManager.getCurrentInput();
      if (this.networkManager) {
        this.networkManager.sendPlayerInput(input as Record<string, boolean>);
      }
      this.lastInputSendTime = timestamp;
    }
  }

  private render(): void {
    const snapshot = this.gameState.getCurrentSnapshot();

    switch (this.appState.currentScreen) {
      case 'game': {
        this.renderGame(snapshot);
        break;
      }

      case 'menu':
      case 'loading':
      case 'disconnected':
      case 'game_ended':
        // Menu renders itself
        break;
    }
  }

  private renderGame(snapshot: GameSnapshot): void {
    const canvas = this.renderer.getCanvas();
    if (!canvas) {
      return;
    }

    // Convert game state to render state
    const renderState = {
      players: snapshot.players.values(),
      projectiles: snapshot.projectiles.values(),
      items: snapshot.items.values(),
    };

    this.renderer.render(renderState);

    // Update HUD
    const localPlayer = snapshot.players.get(this.appState.playerId);
    if (localPlayer) {
      this.stockHud.updatePlayerStocks(this.appState.playerId, localPlayer.stocks);
      this.healthBarOverlay.updateHealth(localPlayer.health, localPlayer.maxHealth);
    }

    // Update stock display for all players
    for (const player of snapshot.players.values()) {
      this.stockHud.updatePlayerStocks(player.id, player.stocks);
    }
  }

  private showMenu(): void {
    this.appState.currentScreen = 'menu';
    this.mainMenu.show();
    this.stopGameLoop();
  }

  private showSettings(): void {
    this.appState.currentScreen = 'settings';
    this.mainMenu.hide();
    this.settingsMenu.show();
  }

  public async initialize(): Promise<void> {
    // Setup any necessary initialization
    try {
      // Check if we can connect to the server
      const testUrl = this.getServerUrl();
      // Connection test will happen when user tries to join
    } catch (error) {
      console.error('Initialization failed:', error);
    }
  }

  public destroy(): void {
    this.stopGameLoop();
    this.inputManager.reset();
    this.gameState.reset();

    if (this.networkManager) {
      this.networkManager.leaveGame();
      this.networkManager.disconnect();
      this.networkManager = null;
    }

    this.renderer.dispose();
    this.mainMenu.destroy();
    this.settingsMenu.destroy();
  }
}

// Export for use in main.ts
export function createMultiplayerApp(canvasSelector: string): EventBasedMultiplayerApp {
  return new EventBasedMultiplayerApp(canvasSelector);
}
