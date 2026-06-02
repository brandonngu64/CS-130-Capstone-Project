import {
  CHARACTER_IDS,
  type CharacterId,
  DEFAULT_CHARACTER_ID,
  isCharacterId,
} from './constants';
import type { ItemKind } from './items';

const SPRITE_MODULES = import.meta.glob('../assets/characters/**/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const WALK_ANIMATION_FRAME_TICKS = 8;
const WALK_VELOCITY_THRESHOLD = 0.35;

function spritePath(characterId: CharacterId, frame: string): string {
  return `../assets/characters/${characterId}/${frame}.png`;
}

export function getCharacterSpriteUrl(characterId: CharacterId, frame: string): string {
  const url = SPRITE_MODULES[spritePath(characterId, frame)];
  if (!url) {
    throw new Error(`Missing character sprite: ${characterId}/${frame}.png`);
  }
  return url;
}

export function getCharacterPreviewUrl(characterId: CharacterId): string {
  return getCharacterSpriteUrl(characterId, 'idle_r');
}

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
