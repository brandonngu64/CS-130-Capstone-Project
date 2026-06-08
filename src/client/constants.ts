export const TICK_RATE = 60;
export const FIXED_STEP_SECONDS = 1 / TICK_RATE;

export const MAX_PLAYERS = 4;

// Tile size in world units. Maps in tiledMap.ts use 1-unit tiles.
export const TILE_SIZE = 1;

// Inner ("KO") blast zone: players in the KOable state who cross this are rung out.
export const KO_BLAST_TILES_UP = 10;
export const KO_BLAST_TILES_DOWN = 10;
export const KO_BLAST_TILES_SIDE = 10;

// Outer ("fallback") blast zone: always elims, regardless of KO state.
export const FALLBACK_BLAST_TILES_UP = 17;
export const FALLBACK_BLAST_TILES_DOWN = 17;
export const FALLBACK_BLAST_TILES_SIDE = 17;

// Back-compat aliases (in world units) for any callers not yet migrated.
export const BLAST_ZONE_UP_OFFSET = KO_BLAST_TILES_UP * TILE_SIZE;
export const BLAST_ZONE_DOWN_OFFSET = KO_BLAST_TILES_DOWN * TILE_SIZE;
export const BLAST_ZONE_SIDE_OFFSET = KO_BLAST_TILES_SIDE * TILE_SIZE;
export const FLOOR_Y = 0;

export const PLAYER_HALF_WIDTH = 0.45;
export const PLAYER_HALF_HEIGHT = 0.9;
export const PLAYER_MAX_HEALTH = 100;

// MOVE_SPEED is now the airborne horizontal control speed only.
// Ground horizontal speed is driven by the dash/run state machine below.
export const MOVE_SPEED = 13;
export const JUMP_SPEED = 16;
export const GRAVITY_Y = -40;

// Smash-style ground movement state machine
export const INITIAL_DASH_SPEED = 13;
export const INITIAL_DASH_TICKS = 1;
export const DASH_TURN_LOCK_TICKS = 1;
export const RUN_SPEED = 13;
export const SKID_TICKS = 1;
export const DASH_INPUT_COOLDOWN_TICKS = 1;

// Double jump
export const DOUBLE_JUMP_SPEED = 18;

// Dodge (Shift button — was the old "dash"; now grants i-frames)
export const DODGE_SPEED = 26;
export const DODGE_DURATION_TICKS = 10;
export const DODGE_COOLDOWN_TICKS = 50;

// Air dodge — separate tuning values for mid-air recovery.
export const AIR_DODGE_SPEED = 30;
export const AIR_DODGE_DURATION_TICKS = 5;
export const AIR_DODGE_COOLDOWN_TICKS = 30;
export const AIR_DODGES_PER_AIRTIME = 1;

// Shield
export const SHIELD_MAX_HP = 100;
export const SHIELD_DRAIN_PER_TICK = 35 / TICK_RATE;
export const SHIELD_RECHARGE_PER_TICK = 5 / TICK_RATE;
export const SHIELD_BROKEN_LOCKOUT_TICKS = 10 * TICK_RATE;
export const SHIELD_RELEASE_COOLDOWN_TICKS = 15;

export const BULLET_SPEED = 28;
export const BULLET_LIFETIME_TICKS = 120;
export const BULLET_HALF_WIDTH  = 0.15;
export const BULLET_HALF_HEIGHT = 0.08;
export const BULLET_COLOR = 0xffe066;
export const BULLET_ID_MAX = 255;
export const BULLET_DAMAGE = 10;
export const GUN_FIRE_COOLDOWN_TICKS = 15;
export const PEN_CROSSBOW_FIRE_COOLDOWN_TICKS = 24;
export const PEN_CROSSBOW_BOLT_SPEED = 50;

export const PLAYER_COLOR_PALETTE = [
  0xe92626,
  0x445edd,
  0xf6db35,
  0x4bd64b,
];

export const DEFAULT_STOCKS = 3;
export const MIN_STOCKS = 1;
export const MAX_STOCKS = 9;
export const RESPAWN_DELAY_TICKS = 120;
export const RESPAWN_FLASH_TICKS = TICK_RATE * 3;

// Time a player stays vulnerable to inner-blast ring out after taking damage.
export const KOABLE_DURATION_TICKS = TICK_RATE * 3; 

export const CHARACTER_IDS = ['eggert', 'nachenburg', 'sahai', 'smallberg'] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];
export const DEFAULT_CHARACTER_ID: CharacterId = 'eggert';

export const CHARACTER_DISPLAY_NAMES: Record<CharacterId, string> = {
  eggert: 'Eggert',
  nachenburg: 'Nachenburg',
  sahai: 'Sahai',
  smallberg: 'Smallberg',
};

export function isCharacterId(value: string): value is CharacterId {
  return (CHARACTER_IDS as readonly string[]).includes(value);
}

export function characterIdToIndex(characterId: CharacterId): number {
  return CHARACTER_IDS.indexOf(characterId);
}

export function characterIdFromIndex(index: number): CharacterId {
  const normalized = ((index % CHARACTER_IDS.length) + CHARACTER_IDS.length) % CHARACTER_IDS.length;
  return CHARACTER_IDS[normalized];
}