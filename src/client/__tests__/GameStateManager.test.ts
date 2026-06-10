import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STOCKS,
  RESPAWN_DELAY_TICKS,
  RESPAWN_FLASH_TICKS,
} from '../constants';
import { GameStateManager } from '../GameStateManager';

function createManagerWithPlayers(playerIds: string[]): GameStateManager {
  const manager = new GameStateManager();
  for (const playerId of playerIds) {
    manager.ensurePlayer(playerId);
  }
  return manager;
}

function advanceTicks(manager: GameStateManager, ticks: number): string[] {
  const respawnedIds: string[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    respawnedIds.push(...manager.advanceTimers());
  }
  return respawnedIds;
}

describe('player state initialization and cleanup', () => {
  it('creates new players with default stocks and active timers', () => {
    const manager = createManagerWithPlayers(['alice']);

    expect(manager.getSnapshot('alice')).toEqual({
      stocks: DEFAULT_STOCKS,
      respawnTicksRemaining: 0,
      respawnFlashTicksRemaining: 0,
    });
    expect(manager.canReceiveInput('alice')).toBe(true);
    expect(manager.canTakeDamage('alice')).toBe(true);
    expect(manager.getRenderInfo('alice')).toEqual({
      stocks: DEFAULT_STOCKS,
      eliminated: false,
      respawning: false,
      respawnFlashTicksRemaining: 0,
    });
  });

  it('does not reset an existing player when ensurePlayer is called again', () => {
    const manager = createManagerWithPlayers(['alice']);
    manager.startRespawn('alice');
    manager.ensurePlayer('alice');

    expect(manager.getSnapshot('alice')).toEqual({
      stocks: DEFAULT_STOCKS - 1,
      respawnTicksRemaining: RESPAWN_DELAY_TICKS,
      respawnFlashTicksRemaining: 0,
    });
  });

  it('treats unknown players as eliminated and unable to act', () => {
    const manager = new GameStateManager();

    expect(manager.getSnapshot('missing')).toBeNull();
    expect(manager.canReceiveInput('missing')).toBe(false);
    expect(manager.canTakeDamage('missing')).toBe(false);
    expect(manager.getRenderInfo('missing')).toEqual({
      stocks: 0,
      eliminated: true,
      respawning: false,
      respawnFlashTicksRemaining: 0,
    });
  });

  it('removes individual players and clears all match state', () => {
    const manager = createManagerWithPlayers(['alice', 'bob']);

    manager.removePlayer('alice');
    expect(manager.getSnapshot('alice')).toBeNull();
    expect(manager.getSnapshot('bob')).not.toBeNull();

    manager.clear();
    expect(manager.getSnapshot('bob')).toBeNull();
  });
});

describe('respawn and damage lifecycle', () => {
  it('starts a respawn after a non-final stock loss', () => {
    const manager = createManagerWithPlayers(['alice']);

    expect(manager.startRespawn('alice')).toBe(true);
    expect(manager.getSnapshot('alice')).toEqual({
      stocks: DEFAULT_STOCKS - 1,
      respawnTicksRemaining: RESPAWN_DELAY_TICKS,
      respawnFlashTicksRemaining: 0,
    });
    expect(manager.canReceiveInput('alice')).toBe(false);
    expect(manager.canTakeDamage('alice')).toBe(false);
    expect(manager.getRenderInfo('alice')).toMatchObject({
      stocks: DEFAULT_STOCKS - 1,
      eliminated: false,
      respawning: true,
    });
  });

  it('rejects respawn starts for unknown, eliminated, or already-respawning players', () => {
    const manager = createManagerWithPlayers(['alice']);

    expect(manager.startRespawn('missing')).toBe(false);
    expect(manager.startRespawn('alice')).toBe(true);
    expect(manager.startRespawn('alice')).toBe(false);

    advanceTicks(manager, RESPAWN_DELAY_TICKS);
    manager.startRespawn('alice');
    advanceTicks(manager, RESPAWN_DELAY_TICKS);

    expect(manager.startRespawn('alice')).toBe(false);
    expect(manager.getRenderInfo('alice')).toMatchObject({ eliminated: true, respawning: false });
  });

  it('emits a respawn event only when the respawn timer reaches zero', () => {
    const manager = createManagerWithPlayers(['alice']);
    manager.startRespawn('alice');

    expect(advanceTicks(manager, RESPAWN_DELAY_TICKS - 1)).toEqual([]);
    expect(manager.getSnapshot('alice')).toMatchObject({ respawnTicksRemaining: 1 });

    expect(manager.advanceTimers()).toEqual(['alice']);
    expect(manager.getSnapshot('alice')).toEqual({
      stocks: DEFAULT_STOCKS - 1,
      respawnTicksRemaining: 0,
      respawnFlashTicksRemaining: RESPAWN_FLASH_TICKS,
    });
  });

  it('blocks damage during respawn flash while allowing input after respawn', () => {
    const manager = createManagerWithPlayers(['alice']);
    manager.startRespawn('alice');
    advanceTicks(manager, RESPAWN_DELAY_TICKS);

    expect(manager.canReceiveInput('alice')).toBe(true);
    expect(manager.canTakeDamage('alice')).toBe(false);

    advanceTicks(manager, RESPAWN_FLASH_TICKS);

    expect(manager.getSnapshot('alice')).toMatchObject({ respawnFlashTicksRemaining: 0 });
    expect(manager.canReceiveInput('alice')).toBe(true);
    expect(manager.canTakeDamage('alice')).toBe(true);
  });

  it('can force a living player back into active state without restoring stocks', () => {
    const manager = createManagerWithPlayers(['alice']);
    manager.startRespawn('alice');

    manager.resetRespawnState('alice');

    expect(manager.getSnapshot('alice')).toEqual({
      stocks: DEFAULT_STOCKS - 1,
      respawnTicksRemaining: 0,
      respawnFlashTicksRemaining: 0,
    });
    expect(manager.canTakeDamage('alice')).toBe(true);
  });

  it('does not reset timers for unknown or eliminated players', () => {
    const manager = createManagerWithPlayers(['alice']);
    manager.startRespawn('alice');
    advanceTicks(manager, RESPAWN_DELAY_TICKS);
    manager.startRespawn('alice');
    advanceTicks(manager, RESPAWN_DELAY_TICKS);
    manager.startRespawn('alice');

    manager.resetRespawnState('missing');
    manager.resetRespawnState('alice');

    expect(manager.getSnapshot('alice')).toEqual({
      stocks: 0,
      respawnTicksRemaining: 0,
      respawnFlashTicksRemaining: 0,
    });
  });
});

describe('winner detection', () => {
  it('returns null while there are zero or multiple living active players', () => {
    const manager = createManagerWithPlayers(['alice', 'bob']);

    expect(manager.getWinnerId([])).toBeNull();
    expect(manager.getWinnerId(['alice', 'bob'])).toBeNull();
    expect(manager.getWinnerId(['missing'])).toBeNull();
  });

  it('returns the only active player with stocks remaining', () => {
    const manager = createManagerWithPlayers(['alice', 'bob']);

    for (let stockLoss = 0; stockLoss < DEFAULT_STOCKS; stockLoss += 1) {
      manager.startRespawn('bob');
      advanceTicks(manager, RESPAWN_DELAY_TICKS);
    }

    expect(manager.getWinnerId(['alice', 'bob'])).toBe('alice');
  });
});

describe('rollback match state serialization', () => {
  it('reports a stable byte size for each serialized player', () => {
    expect(new GameStateManager().matchBytesPerPlayer()).toBe(5);
  });

  it('writes and reads player state snapshots using little-endian timers', () => {
    const source = createManagerWithPlayers(['alice']);
    source.startRespawn('alice');
    advanceTicks(source, 7);

    const buffer = new ArrayBuffer(source.matchBytesPerPlayer());
    const view = new DataView(buffer);

    expect(source.writePlayer(view, 0, 'alice')).toBe(5);
    expect(view.getUint8(0)).toBe(DEFAULT_STOCKS - 1);
    expect(view.getUint16(1, true)).toBe(RESPAWN_DELAY_TICKS - 7);
    expect(view.getUint16(3, true)).toBe(0);

    const restored = new GameStateManager();
    expect(restored.readPlayer(view, 0, 'alice')).toBe(5);
    expect(restored.getSnapshot('alice')).toEqual(source.getSnapshot('alice'));
  });

  it('serializes multiple players at caller-provided offsets', () => {
    const source = createManagerWithPlayers(['alice', 'bob']);
    source.startRespawn('alice');
    advanceTicks(source, RESPAWN_DELAY_TICKS);
    source.startRespawn('bob');

    const bytesPerPlayer = source.matchBytesPerPlayer();
    const buffer = new ArrayBuffer(bytesPerPlayer * 2);
    const view = new DataView(buffer);
    let offset = 0;

    offset = source.writePlayer(view, offset, 'alice');
    offset = source.writePlayer(view, offset, 'bob');

    const restored = new GameStateManager();
    offset = 0;
    offset = restored.readPlayer(view, offset, 'alice');
    offset = restored.readPlayer(view, offset, 'bob');

    expect(offset).toBe(bytesPerPlayer * 2);
    expect(restored.getSnapshot('alice')).toEqual(source.getSnapshot('alice'));
    expect(restored.getSnapshot('bob')).toEqual(source.getSnapshot('bob'));
  });

  it('throws when writing a player that has no match state', () => {
    const manager = new GameStateManager();
    const view = new DataView(new ArrayBuffer(manager.matchBytesPerPlayer()));

    expect(() => manager.writePlayer(view, 0, 'missing')).toThrow(
      'Missing match state for missing',
    );
  });
});