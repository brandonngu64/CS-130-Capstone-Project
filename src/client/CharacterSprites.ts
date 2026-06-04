import {
  CHARACTER_IDS,
  type CharacterId,
  DEFAULT_CHARACTER_ID,
  isCharacterId,
} from './constants';
import { ItemKind, getWhipPhase } from './items';
import type { WeaponDefinition } from './items';

const SPRITE_MODULES = import.meta.glob('../assets/characters/**/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

// Weapon sprites live at assets/weapons/{weaponName}/{frame}.png
// and are shared across all characters.
const WEAPON_SPRITE_MODULES = import.meta.glob('../assets/weapons/**/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const WALK_ANIMATION_FRAME_TICKS = 8;
const WALK_VELOCITY_THRESHOLD = 0.35;

// Maps ItemKind to the weapon's sprite folder name.
// Add new holdable weapons here.
export const WEAPON_SPRITE_NAMES: Partial<Record<ItemKind, string>> = {
  [ItemKind.EthernetWhip]: 'ethernet_whip',
};

export const PUNCH_WEAPON_NAME = 'punch';

// Native punch art is shorter than character sprites; scale relative to body height.
export const PUNCH_SPRITE_HEIGHT_RATIO = 146 / 202;

/** Default punch art: Sahai uses var2; all other characters use var1. */
export function resolvePunchSpriteVariant(characterId: CharacterId): string {
  return characterId === 'sahai' ? 'var2' : 'var1';
}

function spritePath(characterId: CharacterId, frame: string): string {
  return `../assets/characters/${characterId}/${frame}.png`;
}

function weaponSpritePath(weaponName: string, frame: string): string {
  return `../assets/weapons/${weaponName}/${frame}.png`;
}

export function getCharacterSpriteUrl(characterId: CharacterId, frame: string): string {
  const url = SPRITE_MODULES[spritePath(characterId, frame)];
  if (!url) {
    throw new Error(`Missing character sprite: ${characterId}/${frame}.png`);
  }
  return url;
}

export function getWeaponSpriteUrl(weaponName: string, frame: string): string {
  const url = WEAPON_SPRITE_MODULES[weaponSpritePath(weaponName, frame)];
  if (!url) {
    throw new Error(`Missing weapon sprite: ${weaponName}/${frame}.png`);
  }
  return url;
}

export function getCharacterPreviewUrl(characterId: CharacterId): string {
  return getCharacterSpriteUrl(characterId, 'idle_r');
}

/**
 * Resolves the character body frame — the whip is rendered as a separate
 * mesh so the body frame does not change during a whip attack.
 */
export function resolveCharacterFrame(
  facing: number,
  heldItem: ItemKind | null,
  vx: number,
  animTick: number,
): string {
  const direction = facing < 0 ? 'l' : 'r';

  if (heldItem !== null) {
    return `hold_${direction}`;
  }

  if (Math.abs(vx) > WALK_VELOCITY_THRESHOLD) {
    const walkFrame = Math.floor(animTick / WALK_ANIMATION_FRAME_TICKS) % 2 === 0 ? 1 : 2;
    return `walk_${direction}${walkFrame}`;
  }

  return `idle_${direction}`;
}

export function resolveCharacterFrameKey(
  characterId: CharacterId,
  facing: number,
  heldItem: ItemKind | null,
  vx: number,
  animTick: number,
): string {
  const frame = resolveCharacterFrame(facing, heldItem, vx, animTick);
  return `${characterId}:${frame}`;
}

/**
 * Resolves the whip sprite frame name based on the current attack phase.
 * Returns the idle frame when no attack is active (ticksRemaining === 0).
 *
 * Frame files expected at:
 *   assets/weapons/ethernet_whip/idle_r.png
 *   assets/weapons/ethernet_whip/windup_r.png
 *   assets/weapons/ethernet_whip/lash_r.png
 *   assets/weapons/ethernet_whip/recoil_r.png
 *   (and matching _l variants for left-facing)
 */
export function resolveWhipFrame(
  facing: number,
  def: WeaponDefinition,
  ticksRemaining: number,
): string {
  const direction = facing < 0 ? 'l' : 'r';
  if (ticksRemaining > 0) {
    const phase = getWhipPhase(def, ticksRemaining);
    return `${phase}_${direction}`; // e.g. windup_r, lash_l
  }
  return `idle_${direction}`;
}

export function normalizeCharacterId(value: string | null | undefined): CharacterId {
  if (value && isCharacterId(value)) {
    return value;
  }
  return DEFAULT_CHARACTER_ID;
}

export function defaultCharacterForPlayer(playerId: string, sortedPlayerIds: string[]): CharacterId {
  const index = sortedPlayerIds.indexOf(playerId);
  if (index >= 0) {
    return CHARACTER_IDS[index % CHARACTER_IDS.length];
  }

  let hash = 0;
  for (let i = 0; i < playerId.length; i += 1) {
    hash = (hash + playerId.charCodeAt(i) * (i + 1)) >>> 0;
  }
  return CHARACTER_IDS[hash % CHARACTER_IDS.length];
}