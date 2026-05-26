const ARENA_SIDE_WALLS_STORAGE_KEY = 'cs130-arena-side-walls';

/** Default off so blast-zone / stock testing is easy without walking off stage. */
export const DEFAULT_ARENA_SIDE_WALLS = false;

export function readArenaSideWallsEnabled(): boolean {
  try {
    const stored = globalThis.localStorage?.getItem(ARENA_SIDE_WALLS_STORAGE_KEY);
    if (stored === null) {
      return DEFAULT_ARENA_SIDE_WALLS;
    }
    return stored === '1' || stored === 'true';
  } catch {
    return DEFAULT_ARENA_SIDE_WALLS;
  }
}

export function writeArenaSideWallsEnabled(enabled: boolean): void {
  try {
    globalThis.localStorage?.setItem(
      ARENA_SIDE_WALLS_STORAGE_KEY,
      enabled ? '1' : '0',
    );
  } catch {
    // Ignore storage failures.
  }
}
