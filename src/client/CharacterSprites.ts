import {
  CHARACTER_IDS,
  type CharacterId,
  DEFAULT_CHARACTER_ID,
  isCharacterId,
} from './constants';
import { ItemKind, WEAPON_SPRITE_CONFIG, getWhipPhase } from './items';
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
  [ItemKind.Finals]: 'paper_stack',
  [ItemKind.PenCrossbow]: 'pen_crossbow',
  [ItemKind.BinaryBeam]: 'binary_beam',
};

/** Held finals weapon art at assets/weapons/paper_stack/paper_stack.png */
export const PAPER_STACK_HOLD_FRAME = 'paper_stack';

/** Source pixel size of paper_stack.png (used before texture decode). */
export const PAPER_STACK_TEXTURE_PIXELS = { width: 198, height: 78 } as const;

/** Finals projectile art at assets/weapons/paper_stack/paper_sheet.png */
export const PAPER_STACK_PROJECTILE_FRAME = 'paper_sheet';

/** Held pen crossbow art at assets/weapons/pen_crossbow/idle.png */
export const PEN_CROSSBOW_HOLD_FRAME = 'idle';

/** Pen crossbow fire pose at assets/weapons/pen_crossbow/firing.png */
export const PEN_CROSSBOW_FIRING_FRAME = 'firing';

/** Pen crossbow projectile art at assets/weapons/pen_crossbow/bolt.png */
export const PEN_CROSSBOW_PROJECTILE_FRAME = 'bolt';

/** Source pixel size of idle.png (used before texture decode). */
export const PEN_CROSSBOW_TEXTURE_PIXELS = { width: 202, height: 142 } as const;

/** Transparent padding below visible pixels / texture height (per frame). */
export const ETHERNET_WHIP_BOTTOM_INSET: Readonly<Record<string, number>> = {
  idle: 19 / 218,
  attack1: 81 / 295,
  attack2: 117 / 310,
};

export function getEthernetWhipBottomInset(frame: string): number {
  return ETHERNET_WHIP_BOTTOM_INSET[frame] ?? ETHERNET_WHIP_BOTTOM_INSET.idle;
}

export const PUNCH_WEAPON_NAME = 'punch';

/** Reference character body height in pixels (idle/hold art). */
export const CHARACTER_SPRITE_PIXEL_HEIGHT = 202;

// Native punch art is shorter than character sprites; scale relative to body height.
export const PUNCH_SPRITE_HEIGHT_RATIO = 146 / CHARACTER_SPRITE_PIXEL_HEIGHT;

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
 * Returns idle when no attack is active (ticksRemaining === 0).
 * Facing is applied via mesh scale in the renderer.
 *
 * Frame files at assets/weapons/ethernet_whip/:
 *   idle.png, attack1.png, attack2.png
 */
export function resolveHeldWeaponFrame(
  heldItem: ItemKind,
  def: WeaponDefinition | undefined,
  ticksRemaining: number,
  gunFireCooldownTicks = 0,
): string {
  const configFrame = WEAPON_SPRITE_CONFIG[heldItem]?.heldFrame;
  if (configFrame) {
    return configFrame;
  }
  if (heldItem === ItemKind.Finals) {
    return PAPER_STACK_HOLD_FRAME;
  }
  if (heldItem === ItemKind.PenCrossbow) {
    return gunFireCooldownTicks > 0 ? PEN_CROSSBOW_FIRING_FRAME : PEN_CROSSBOW_HOLD_FRAME;
  }
  if (!def) {
    throw new Error(`Missing weapon definition for held item ${heldItem}`);
  }
  return resolveWhipFrame(def, ticksRemaining);
}

export function resolveWhipFrame(
  def: WeaponDefinition,
  ticksRemaining: number,
): string {
  if (ticksRemaining <= 0) {
    return 'idle';
  }
  const phase = getWhipPhase(def, ticksRemaining);
  if (phase === 'lash') {
    return 'attack2';
  }
  return 'attack1';
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
