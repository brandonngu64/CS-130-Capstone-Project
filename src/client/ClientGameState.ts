import type { GameEvent } from '../shared/GameEvents';

export interface PlayerState {
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
}

export interface ProjectileState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface ItemState {
  id: number;
  kind: number;
  x: number;
  y: number;
}

export interface GameSnapshot {
  tick: number;
  players: Map<string, PlayerState>;
  projectiles: Map<number, ProjectileState>;
  items: Map<number, ItemState>;
}

export class ClientGameState {
  private currentSnapshot: GameSnapshot = {
    tick: 0,
    players: new Map(),
    projectiles: new Map(),
    items: new Map(),
  };

  private previousSnapshot: GameSnapshot = {
    tick: 0,
    players: new Map(),
    projectiles: new Map(),
    items: new Map(),
  };

  private predictedPlayers = new Map<string, PlayerState>();

  processEvent(event: GameEvent): void {
    switch (event.type) {
      case 'player_spawned': {
        const player: PlayerState = {
          id: event.playerId,
          x: event.x,
          y: event.y,
          vx: 0,
          vy: 0,
          health: 100,
          maxHealth: 100,
          stocks: 3,
          facing: 1,
          eliminated: false,
          color: event.color,
          heldItem: null,
        };
        this.currentSnapshot.players.set(event.playerId, player);
        break;
      }

      case 'player_moved': {
        const player = this.currentSnapshot.players.get(event.playerId);
        if (player) {
          player.x = event.x;
          player.y = event.y;
          player.vx = event.vx;
          player.vy = event.vy;
          player.facing = event.facing;
        }
        break;
      }

      case 'player_damaged': {
        const player = this.currentSnapshot.players.get(event.playerId);
        if (player) {
          player.health = event.currentHealth;
        }
        break;
      }

      case 'player_died': {
        const player = this.currentSnapshot.players.get(event.playerId);
        if (player) {
          player.stocks = event.stocks;
          player.eliminated = event.stocks <= 0;
        }
        break;
      }

      case 'player_respawned': {
        const player = this.currentSnapshot.players.get(event.playerId);
        if (player) {
          player.x = event.x;
          player.y = event.y;
          player.eliminated = false;
        }
        break;
      }

      case 'projectile_created': {
        const projectile: ProjectileState = {
          id: event.projectileId,
          x: event.x,
          y: event.y,
          vx: event.vx,
          vy: event.vy,
        };
        this.currentSnapshot.projectiles.set(event.projectileId, projectile);
        break;
      }

      case 'projectile_destroyed': {
        this.currentSnapshot.projectiles.delete(event.projectileId);
        break;
      }

      case 'item_spawned': {
        const item: ItemState = {
          id: event.itemId,
          kind: event.itemKind,
          x: event.x,
          y: event.y,
        };
        this.currentSnapshot.items.set(event.itemId, item);
        break;
      }

      case 'item_picked_up': {
        this.currentSnapshot.items.delete(event.itemId);
        break;
      }

      case 'game_state_update': {
        // Full state snapshot from server - use this as the source of truth
        this.previousSnapshot = JSON.parse(JSON.stringify(this.currentSnapshot));
        this.currentSnapshot.tick = event.tick;

        // Update players
        this.currentSnapshot.players.clear();
        for (const playerData of event.players) {
          this.currentSnapshot.players.set(playerData.id, {
            id: playerData.id,
            x: playerData.x,
            y: playerData.y,
            vx: playerData.vx,
            vy: playerData.vy,
            health: playerData.health,
            maxHealth: playerData.maxHealth,
            stocks: playerData.stocks,
            facing: playerData.facing,
            eliminated: playerData.eliminated,
            color: playerData.color,
            heldItem: playerData.heldItem,
          });
        }

        // Update projectiles
        this.currentSnapshot.projectiles.clear();
        for (const projectileData of event.projectiles) {
          this.currentSnapshot.projectiles.set(projectileData.id, {
            id: projectileData.id,
            x: projectileData.x,
            y: projectileData.y,
            vx: projectileData.vx,
            vy: projectileData.vy,
          });
        }

        // Update items
        this.currentSnapshot.items.clear();
        for (const itemData of event.items) {
          this.currentSnapshot.items.set(itemData.id, {
            id: itemData.id,
            kind: itemData.kind,
            x: itemData.x,
            y: itemData.y,
          });
        }

        break;
      }
    }
  }

  getCurrentSnapshot(): GameSnapshot {
    return this.currentSnapshot;
  }

  getPlayer(playerId: string): PlayerState | null {
    return this.currentSnapshot.players.get(playerId) ?? null;
  }

  getPlayers(): PlayerState[] {
    return Array.from(this.currentSnapshot.players.values());
  }

  getProjectiles(): ProjectileState[] {
    return Array.from(this.currentSnapshot.projectiles.values());
  }

  getItems(): ItemState[] {
    return Array.from(this.currentSnapshot.items.values());
  }

  getTick(): number {
    return this.currentSnapshot.tick;
  }

  // Client-side prediction: interpolate between snapshots for smoother visuals
  getInterpolatedPlayerPosition(
    playerId: string,
    localTime: number,
  ): { x: number; y: number } | null {
    const player = this.currentSnapshot.players.get(playerId);
    if (!player) {
      return null;
    }

    // If we have velocity data, we can use it for better prediction
    // For now, just return current position
    return { x: player.x, y: player.y };
  }

  reset(): void {
    this.currentSnapshot = {
      tick: 0,
      players: new Map(),
      projectiles: new Map(),
      items: new Map(),
    };
    this.previousSnapshot = {
      tick: 0,
      players: new Map(),
      projectiles: new Map(),
      items: new Map(),
    };
    this.predictedPlayers.clear();
  }
}
