import {
  DEFAULT_STOCKS,
  MAX_STOCKS,
  MIN_STOCKS,
  RESPAWN_FLASH_TICKS,
  RESPAWN_DELAY_TICKS,
} from './constants';

/** Per-player match data kept in sync across rollback. */
export type PlayerMatchState = {
  stocks: number;
  /** 0 = in play; >0 = dead and counting down to respawn. */
  respawnTicksRemaining: number;
  /** 0 = normal; >0 = flashing after a respawn. */
  respawnFlashTicksRemaining: number;
};

export type PlayerMatchSnapshot = {
  stocks: number;
  respawnTicksRemaining: number;
  respawnFlashTicksRemaining: number;
};

export type MatchRenderInfo = {
  stocks: number;
  eliminated: boolean;
  respawning: boolean;
  respawnFlashTicksRemaining: number;
};

const MATCH_BYTES_PER_PLAYER = 5; // uint8 stocks + uint16 respawn ticks + uint16 flash ticks

export class GameStateManager {
  private readonly byPlayer = new Map<string, PlayerMatchState>();
  private startingStocks: number = DEFAULT_STOCKS;

  setStartingStocks(stocks: number): void {
    const clamped = Math.max(MIN_STOCKS, Math.min(MAX_STOCKS, Math.floor(stocks)));
    this.startingStocks = clamped;
  }

  getStartingStocks(): number {
    return this.startingStocks;
  }

  ensurePlayer(playerId: string): void {
    if (!this.byPlayer.has(playerId)) {
      this.byPlayer.set(playerId, {
        stocks: this.startingStocks,
        respawnTicksRemaining: 0,
        respawnFlashTicksRemaining: 0,
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

  /** True while the player still has stocks remaining, even if currently respawning. */
  isInMatch(playerId: string): boolean {
    const state = this.byPlayer.get(playerId);
    return !!state && state.stocks > 0;
  }

  /** False while respawn invulnerability flash is active. */
  canTakeDamage(playerId: string): boolean {
    const state = this.byPlayer.get(playerId);
    if (!state) {
      return false;
    }
    return (
      state.stocks > 0
      && state.respawnTicksRemaining === 0
      && state.respawnFlashTicksRemaining === 0
    );
  }

  startRespawn(playerId: string): boolean {
    const state = this.byPlayer.get(playerId);
    if (!state || state.stocks === 0 || state.respawnTicksRemaining > 0) {
      return false;
    }

    state.stocks = Math.max(0, state.stocks - 1);
    state.respawnFlashTicksRemaining = 0;
    if (state.stocks > 0) {
      state.respawnTicksRemaining = RESPAWN_DELAY_TICKS;
      return true;
    }

    state.respawnTicksRemaining = 0;
    return false;
  }

  advanceTimers(): string[] {
    const respawnedIds: string[] = [];

    for (const [playerId, state] of this.byPlayer) {
      if (state.respawnTicksRemaining > 0) {
        state.respawnTicksRemaining -= 1;
        if (state.respawnTicksRemaining === 0 && state.stocks > 0) {
          state.respawnFlashTicksRemaining = RESPAWN_FLASH_TICKS;
          respawnedIds.push(playerId);
        }
        continue;
      }

      if (state.respawnFlashTicksRemaining > 0) {
        state.respawnFlashTicksRemaining -= 1;
      }
    }

    return respawnedIds;
  }

  getSnapshot(playerId: string): PlayerMatchSnapshot | null {
    const state = this.byPlayer.get(playerId);
    if (!state) {
      return null;
    }
    return {
      stocks: state.stocks,
      respawnTicksRemaining: state.respawnTicksRemaining,
      respawnFlashTicksRemaining: state.respawnFlashTicksRemaining,
    };
  }

  getRenderInfo(playerId: string): MatchRenderInfo {
    const state = this.byPlayer.get(playerId);
    if (!state) {
      return {
        stocks: 0,
        eliminated: true,
        respawning: false,
        respawnFlashTicksRemaining: 0,
      };
    }
    return {
      stocks: state.stocks,
      eliminated: state.stocks === 0,
      respawning: state.respawnTicksRemaining > 0,
      respawnFlashTicksRemaining: state.respawnFlashTicksRemaining,
    };
  }

  /** Keeps stocks intact but forces the player back into an active in-play state. */
  resetRespawnState(playerId: string): void {
    const state = this.byPlayer.get(playerId);
    if (!state || state.stocks === 0) {
      return;
    }
    state.respawnTicksRemaining = 0;
    state.respawnFlashTicksRemaining = 0;
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
    view.setUint16(offset + 3, state.respawnFlashTicksRemaining, true);
    return offset + MATCH_BYTES_PER_PLAYER;
  }

  readPlayer(
    view: DataView,
    offset: number,
    playerId: string,
  ): number {
    const stocks = view.getUint8(offset);
    const respawnTicksRemaining = view.getUint16(offset + 1, true);
    const respawnFlashTicksRemaining = view.getUint16(offset + 3, true);
    this.byPlayer.set(playerId, {
      stocks,
      respawnTicksRemaining,
      respawnFlashTicksRemaining,
    });
    return offset + MATCH_BYTES_PER_PLAYER;
  }
}
