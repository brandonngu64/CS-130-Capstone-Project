import type * as RAPIER from '@dimforge/rapier2d-compat';
import {
  ARENA_HALF_WIDTH,
  BLAST_ZONE_BOTTOM,
  BLAST_ZONE_SIDE_MARGIN,
  DEFAULT_STOCKS,
  OFF_STAGE_Y,
  PLAYER_SPAWN_Y,
  RESPAWN_DELAY_TICKS,
} from './constants';

/** Per-player match data kept in sync across rollback. */
export type PlayerMatchState = {
  stocks: number;
  /** 0 = in play; >0 = dead and counting down to respawn. */
  respawnTicksRemaining: number;
};

export type PlayerMatchSnapshot = {
  stocks: number;
  respawnTicksRemaining: number;
};

export type MatchRenderInfo = {
  stocks: number;
  eliminated: boolean;
  respawning: boolean;
};

const MATCH_BYTES_PER_PLAYER = 3; // uint8 stocks + uint16 respawn ticks

export class GameStateManager {
  private readonly byPlayer = new Map<string, PlayerMatchState>();

  ensurePlayer(playerId: string): void {
    if (!this.byPlayer.has(playerId)) {
      this.byPlayer.set(playerId, {
        stocks: DEFAULT_STOCKS,
        respawnTicksRemaining: 0,
      });
    }
  }

  removePlayer(playerId: string): void {
    this.byPlayer.delete(playerId);
  }

  clear(): void {
    this.byPlayer.clear();
  }

  canReceiveInput(playerId: string): boolean {
    const state = this.byPlayer.get(playerId);
    if (!state) {
      return false;
    }
    return state.stocks > 0 && state.respawnTicksRemaining === 0;
  }

  getSnapshot(playerId: string): PlayerMatchSnapshot | null {
    const state = this.byPlayer.get(playerId);
    if (!state) {
      return null;
    }
    return {
      stocks: state.stocks,
      respawnTicksRemaining: state.respawnTicksRemaining,
    };
  }

  getRenderInfo(playerId: string): MatchRenderInfo {
    const state = this.byPlayer.get(playerId);
    if (!state) {
      return { stocks: 0, eliminated: true, respawning: false };
    }
    return {
      stocks: state.stocks,
      eliminated: state.stocks === 0,
      respawning: state.respawnTicksRemaining > 0,
    };
  }

  /** Id with stocks remaining, if exactly one; otherwise null (ongoing or tie). */
  getWinnerId(activePlayerIds: string[]): string | null {
    const alive = activePlayerIds.filter((id) => {
      const state = this.byPlayer.get(id);
      return state && state.stocks > 0;
    });
    if (alive.length === 1) {
      return alive[0];
    }
    return null;
  }

  /**
   * After physics: detect blast-zone KOs and start respawn or elimination.
   */
  checkBlastZone(
    players: Map<string, { body: RAPIER.RigidBody }>,
    spawnXForPlayer: (playerId: string) => number,
  ): void {
    const sideLimit = ARENA_HALF_WIDTH + BLAST_ZONE_SIDE_MARGIN;

    for (const [playerId, { body }] of players) {
      const state = this.byPlayer.get(playerId);
      if (!state || state.stocks === 0 || state.respawnTicksRemaining > 0) {
        continue;
      }

      const { x, y } = body.translation();
      if (y < BLAST_ZONE_BOTTOM || Math.abs(x) > sideLimit) {
        this.onDeath(playerId, body, spawnXForPlayer);
      }
    }
  }

  /**
   * Each tick: count down respawn timers and place players back on stage.
   */
  tickRespawn(
    players: Map<string, { body: RAPIER.RigidBody }>,
    spawnXForPlayer: (playerId: string) => number,
  ): void {
    for (const [playerId, { body }] of players) {
      const state = this.byPlayer.get(playerId);
      if (!state || state.respawnTicksRemaining <= 0) {
        continue;
      }

      state.respawnTicksRemaining -= 1;
      if (state.respawnTicksRemaining > 0) {
        continue;
      }

      body.setTranslation(
        { x: spawnXForPlayer(playerId), y: PLAYER_SPAWN_Y },
        true,
      );
      body.setLinvel({ x: 0, y: 0 }, true);
    }
  }

  matchBytesPerPlayer(): number {
    return MATCH_BYTES_PER_PLAYER;
  }

  writePlayer(
    view: DataView,
    offset: number,
    playerId: string,
  ): number {
    const state = this.byPlayer.get(playerId);
    if (!state) {
      throw new Error(`Missing match state for ${playerId}`);
    }
    view.setUint8(offset, state.stocks);
    view.setUint16(offset + 1, state.respawnTicksRemaining, true);
    return offset + MATCH_BYTES_PER_PLAYER;
  }

  readPlayer(
    view: DataView,
    offset: number,
    playerId: string,
  ): number {
    const stocks = view.getUint8(offset);
    const respawnTicksRemaining = view.getUint16(offset + 1, true);
    this.byPlayer.set(playerId, { stocks, respawnTicksRemaining });
    return offset + MATCH_BYTES_PER_PLAYER;
  }

  private onDeath(
    playerId: string,
    body: RAPIER.RigidBody,
    spawnXForPlayer: (playerId: string) => number,
  ): void {
    const state = this.byPlayer.get(playerId);
    if (!state) {
      return;
    }

    state.stocks -= 1;

    if (state.stocks > 0) {
      state.respawnTicksRemaining = RESPAWN_DELAY_TICKS;
      body.setTranslation({ x: spawnXForPlayer(playerId), y: OFF_STAGE_Y }, true);
      body.setLinvel({ x: 0, y: 0 }, true);
      return;
    }

    state.respawnTicksRemaining = 0;
    body.setTranslation({ x: spawnXForPlayer(playerId), y: OFF_STAGE_Y }, true);
    body.setLinvel({ x: 0, y: 0 }, true);
  }
}
