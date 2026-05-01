export const TICK_RATE = 60;
export const FIXED_STEP_SECONDS = 1 / TICK_RATE;

export const MAX_PLAYERS = 4;

export const ARENA_HALF_WIDTH = 12;
export const FLOOR_Y = 0;

export const PLAYER_HALF_WIDTH = 0.45;
export const PLAYER_HALF_HEIGHT = 0.9;
export const PLAYER_SPAWN_Y = 6;

export const MOVE_SPEED = 7;
export const JUMP_SPEED = 15;
export const GRAVITY_Y = -28;

export const PLAYER_COLOR_PALETTE = [
  0xe76f51,
  0x2a9d8f,
  0xf4a261,
  0x457b9d,
  0x8ab17d,
  0xe9c46a,
];

export interface PlatformDefinition {
  centerX: number;
  centerY: number;
  halfWidth: number;
  halfHeight: number;
}

// Battlefield-style layout: two lower side platforms and a higher center platform.
export const PLATFORMS: readonly PlatformDefinition[] = [
  { centerX: -5, centerY: 2.6, halfWidth: 1.8, halfHeight: 0.18 },
  { centerX: 5, centerY: 2.6, halfWidth: 1.8, halfHeight: 0.18 },
  { centerX: 0, centerY: 5.0, halfWidth: 1.8, halfHeight: 0.18 },
];

export const PLATFORM_COLOR = 0x6c7a89;
