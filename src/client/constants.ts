export const TICK_RATE = 60;
export const FIXED_STEP_SECONDS = 1 / TICK_RATE;

export const MAX_PLAYERS = 4;

export const BLAST_ZONE_UP_OFFSET = 6;
export const BLAST_ZONE_DOWN_OFFSET = 6;
export const BLAST_ZONE_SIDE_OFFSET = 6;
export const FLOOR_Y = 0;

export const PLAYER_HALF_WIDTH = 0.45;
export const PLAYER_HALF_HEIGHT = 0.9;
export const PLAYER_MAX_HEALTH = 100;

export const MOVE_SPEED = 10;
export const JUMP_SPEED = 16;
export const DASH_SPEED = 20;
export const DASH_DURATION_TICKS = 20;
export const DASH_COOLDOWN_TICKS = 50;
export const GRAVITY_Y = -40;

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
export const RESPAWN_DELAY_TICKS = 120;
export const RESPAWN_FLASH_TICKS = TICK_RATE * 3;

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