export const TICK_RATE = 60;
export const FIXED_STEP_SECONDS = 1 / TICK_RATE;

export const MAX_PLAYERS = 4;

export const ARENA_HALF_WIDTH = 12;
export const FLOOR_Y = 0;

export const PLAYER_HALF_WIDTH = 0.45;
export const PLAYER_HALF_HEIGHT = 0.9;
export const PLAYER_SPAWN_Y = 6;
export const PLAYER_MAX_HEALTH = 100;

export const MOVE_SPEED = 7;
export const JUMP_SPEED = 15;
export const DASH_SPEED = 18;
export const DASH_DURATION_TICKS = 8;
export const DASH_COOLDOWN_TICKS = 45;
export const GRAVITY_Y = -28;

export const BULLET_SPEED = 28;
export const BULLET_LIFETIME_TICKS = 120;
export const BULLET_HALF_WIDTH  = 0.15;
export const BULLET_HALF_HEIGHT = 0.08;
export const BULLET_COLOR = 0xffe066;
export const BULLET_ID_MAX = 255;
export const GUN_FIRE_COOLDOWN_TICKS = 15;

export const PLAYER_COLOR_PALETTE = [
  0xe76f51,
  0x2a9d8f,
  0xf4a261,
  0x457b9d,
  0x8ab17d,
  0xe9c46a,
];

export const DEFAULT_STOCKS = 3;
export const RESPAWN_DELAY_TICKS = 120;
export const BLAST_ZONE_BOTTOM = FLOOR_Y - 4;
export const BLAST_ZONE_SIDE_MARGIN = 1.5;
export const OFF_STAGE_Y = -50;
