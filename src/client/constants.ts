export const TICK_RATE = 60;
export const FIXED_STEP_SECONDS = 1 / TICK_RATE;

export const MAX_PLAYERS = 4;

// Tile size in world units. Maps in tiledMap.ts use 1-unit tiles.
export const TILE_SIZE = 1;

// Outer ("fallback") blast zone: always elims, regardless of KO state.
// Inner ("KO") blast zone: players in the KOable state who cross this are rung out.
export const FALLBACK_BLAST_TILES_UP = 35;
export const KO_BLAST_TILES_UP = 25;

export const FALLBACK_BLAST_TILES_DOWN = 25;
export const KO_BLAST_TILES_DOWN = 20;

export const FALLBACK_BLAST_TILES_SIDE = 27;
export const KO_BLAST_TILES_SIDE = 20;

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

// Delay after a winner is declared before all players are returned to the
// in-room character-select lobby for a rematch.
export const POST_MATCH_DELAY_MS = 5000;

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

// Sentinel used in the lobby for "pick a random character on match start".
// Resolved by the host into a real CharacterId immediately before the match.
export const RANDOM_CHARACTER_SELECTION = 'random' as const;
export type RandomCharacterSelection = typeof RANDOM_CHARACTER_SELECTION;
export type LobbyCharacterSelection = CharacterId | RandomCharacterSelection;

export function isLobbyCharacterSelection(value: string): value is LobbyCharacterSelection {
  return value === RANDOM_CHARACTER_SELECTION || isCharacterId(value);
}

// Sentinel for "pick a random map on match start". The host resolves and
// broadcasts the final map id before calling session.start().
export const RANDOM_MAP_SELECTION = 'random' as const;
export type RandomMapSelection = typeof RANDOM_MAP_SELECTION;

export const LOBBY_NAME_MAX_LENGTH = 16;

export function characterIdToIndex(characterId: CharacterId): number {
  return CHARACTER_IDS.indexOf(characterId);
}

export function characterIdFromIndex(index: number): CharacterId {
  const normalized = ((index % CHARACTER_IDS.length) + CHARACTER_IDS.length) % CHARACTER_IDS.length;
  return CHARACTER_IDS[normalized];
}

// ─── Game modes ─────────────────────────────────────────────────────────────
export const GAME_MODES = ['classic', 'smash'] as const;
export type GameMode = (typeof GAME_MODES)[number];
export const DEFAULT_GAME_MODE: GameMode = 'classic';
export const GAME_MODE_DISPLAY_NAMES: Record<GameMode, string> = {
  classic: 'Classic',
  smash: 'Smash',
};
export function isGameMode(value: string): value is GameMode {
  return (GAME_MODES as readonly string[]).includes(value);
}

// ─── Smash-mode tuning (tweak here) ─────────────────────────────────────────
// Damage accumulator threshold above which the next hit is lethal.
export const SMASH_MAX_DAMAGE_PCT = 300;
// Uniform character weight used in the SSB knockback formula.
export const SMASH_DEFAULT_WEIGHT = 100;
// Per-weapon "b" term in the SSB knockback formula. Override on individual
// AttackDefinition / WeaponDefinition entries to retune a specific weapon.
export const SMASH_DEFAULT_BASE_KNOCKBACK = 10;
// Launch angle in degrees if a weapon doesn't specify its own.
export const SMASH_DEFAULT_LAUNCH_ANGLE_DEG = 45;
// "b" term used by the default punch (no-weapon melee). Tweak independently
// of SMASH_DEFAULT_BASE_KNOCKBACK so the bare-hands punch can be tuned to a
// different feel than equipped weapons.
export const PUNCH_BASE_KNOCKBACK = 20;
// Launch angle for the default punch.
export const PUNCH_LAUNCH_ANGLE_DEG = 45;
// Ticks between consecutive punches. 60 ticks = 1s at TICK_RATE=60, so 90 ≈ 1.5s.
export const PUNCH_COOLDOWN_TICKS = 30;
// "+18" hitstun-bias constant from the SSB knockback formula.
export const SMASH_KB_HITSTUN_BIAS = 18;
// "*1.4" growth multiplier from the SSB knockback formula.
export const SMASH_KB_GROWTH_MULT = 1.4;
// Global output scale on every Smash-mode knockback. Reduce this (e.g. 0.1)
// to dial back KB everywhere at once without touching the formula constants.
// Plays the role of the "r" (other-scalers) term in the SSB formula.
export const SMASH_KB_OUTPUT_SCALE = 0.25;
// Multiplier applied to a victim's knockback once they cross SMASH_MAX_DAMAGE_PCT.
export const SMASH_KB_LETHAL_MULTIPLIER = 1000;
// Collider restitution applied during the lethal-launch state.
export const SMASH_KB_LETHAL_RESTITUTION = 1.0;
// Ticks after entering the lethal-launch state before the victim noclips
// through stage geometry until reaching a blast zone.
export const SMASH_LETHAL_NOCLIP_DELAY_TICKS = TICK_RATE * 0.5;

// ─── Smash-mode knockback shaping ───────────────────────────────────────────
// Layered on top of the SSB cos/sin angle decomposition so vertical launches
// can be tamed without nerfing horizontal.
export const SMASH_KB_HORIZONTAL_MULT = 1.0;
export const SMASH_KB_VERTICAL_MULT = 0.6;

// After the strict hitstun window ends, the victim enters a "launch recovery"
// glide phase. Inputs are accepted (DI), but the airborne move-state machine
// doesn't clobber vx; we lerp toward input speed and bleed velocity per tick.
export const SMASH_LAUNCH_RECOVERY_TICKS = 30;
// Per-tick multiplicative decay on horizontal velocity during glide.
export const SMASH_LAUNCH_HORIZONTAL_DRAG = 0.96;
// Per-tick multiplicative decay on vertical velocity during glide (on top of gravity).
export const SMASH_LAUNCH_VERTICAL_DRAG = 0.985;
// Max per-tick change in vx the player can induce via DI during glide.
export const SMASH_LAUNCH_AIR_CONTROL = 1.2;

// ─── Dust VFX ───────────────────────────────────────────────────────────────
// Shared
export const DUST_POOL_SIZE = 256;
export const DUST_Z = 0.34;
export const DUST_GRAVITY = -6;
export const DUST_DRAG = 0.92;
export const DUST_END_SCALE = 1.6;
export const DUST_BASE_ALPHA = 0.85;

// Scuff (running on ground)
export const DUST_SCUFF_MIN_SPEED = 4;
export const DUST_SCUFF_EMIT_INTERVAL_TICKS = 4;
export const DUST_SCUFF_PARTICLES_PER_BURST = 2;
export const DUST_SCUFF_LIFETIME_SEC = 0.35;
export const DUST_SCUFF_SIZE = 0.35;
export const DUST_SCUFF_SIZE_JITTER = 0.12;
export const DUST_SCUFF_DRIFT_X = 3.0;
export const DUST_SCUFF_DRIFT_X_JITTER = 1.5;
export const DUST_SCUFF_DRIFT_Y = 1.5;
export const DUST_SCUFF_DRIFT_Y_JITTER = 0.8;
export const DUST_SCUFF_SPAWN_OFFSET_X = 0.25;
export const DUST_SCUFF_SPAWN_Y_JITTER = 0.05;

// Landing ring (airborne → grounded)
export const DUST_LANDING_PARTICLES = 14;
export const DUST_LANDING_LIFETIME_SEC = 0.55;
export const DUST_LANDING_SIZE = 0.45;
export const DUST_LANDING_SIZE_JITTER = 0.15;
export const DUST_LANDING_SPEED = 4.0;
export const DUST_LANDING_SPEED_JITTER = 1.2;
// Smaller range = flatter, more horizontal fan. ~40° = ±20° from horizontal.
export const DUST_LANDING_RING_ANGLE_RANGE_DEG = 40;
export const DUST_LANDING_REF_VY = 14;
export const DUST_LANDING_MIN_VY = 2;
export const DUST_LANDING_UPWARD_BIAS = 0.4;