import { describe, expect, it } from 'vitest';

import {
  ETHERNET_WHIP_BOTTOM_INSET,
  PEN_CROSSBOW_FIRING_FRAME,
  PEN_CROSSBOW_HOLD_FRAME,
  defaultCharacterForPlayer,
  getCharacterPreviewUrl,
  getCharacterSpriteUrl,
  getEthernetWhipBottomInset,
  getWeaponSpriteUrl,
  normalizeCharacterId,
  resolveCharacterFrame,
  resolveCharacterFrameKey,
  resolveHeldWeaponFrame,
  resolvePunchSpriteVariant,
  resolveWhipFrame,
} from '../CharacterSprites';
import { CHARACTER_IDS, DEFAULT_CHARACTER_ID, isCharacterId } from '../constants';
import { ItemKind, WEAPON_DEFINITIONS } from '../items';

describe('character body frame selection', () => {
  it.each([
    [1, 'idle_r'],
    [0, 'idle_r'],
    [-1, 'idle_l'],
  ] as const)('uses facing %s for idle frame %s', (facing, expectedFrame) => {
    expect(resolveCharacterFrame(facing, null, 0, 0)).toBe(expectedFrame);
  });

  it('switches to hold frames whenever a character has an item', () => {
    expect(resolveCharacterFrame(1, ItemKind.Finals, 0, 0)).toBe('hold_r');
    expect(resolveCharacterFrame(-1, ItemKind.EthernetWhip, 99, 50)).toBe('hold_l');
  });

  it('alternates walk frames after crossing the velocity threshold', () => {
    expect(resolveCharacterFrame(1, null, 0.35, 0)).toBe('idle_r');
    expect(resolveCharacterFrame(1, null, 0.36, 0)).toBe('walk_r1');
    expect(resolveCharacterFrame(1, null, 0.36, 10)).toBe('walk_r2');
    expect(resolveCharacterFrame(-1, null, -0.36, 20)).toBe('walk_l1');
  });

  it('includes character id and resolved frame in frame cache keys', () => {
    expect(resolveCharacterFrameKey('sahai', -1, null, -1, 10)).toBe('sahai:walk_l2');
  });
});

describe('weapon and punch frame selection', () => {
  const ethernetWhip = WEAPON_DEFINITIONS[ItemKind.EthernetWhip];

  if (!ethernetWhip) {
    throw new Error('Ethernet whip definition is required for sprite frame tests.');
  }

  it('uses the special Sahai punch sprite variant only for Sahai', () => {
    expect(resolvePunchSpriteVariant('sahai')).toBe('var2');
    expect(resolvePunchSpriteVariant('eggert')).toBe('var1');
    expect(resolvePunchSpriteVariant('nachenburg')).toBe('var1');
  });

  it.each([
    [14, 'attack1'],
    [10, 'attack2'],
    [5, 'attack1'],
    [0, 'idle'],
  ] as const)('resolves %s whip ticks remaining to %s', (ticksRemaining, expectedFrame) => {
    expect(resolveWhipFrame(ethernetWhip, ticksRemaining)).toBe(expectedFrame);
    expect(resolveHeldWeaponFrame(ItemKind.EthernetWhip, ethernetWhip, ticksRemaining)).toBe(
      expectedFrame,
    );
  });

  it('resolves non-whip held weapon frames from item-specific rules', () => {
    expect(resolveHeldWeaponFrame(ItemKind.Finals, undefined, 0)).toBe('paper_stack');
    expect(resolveHeldWeaponFrame(ItemKind.BinaryBeam, undefined, 0)).toBe('gpu');
    expect(resolveHeldWeaponFrame(ItemKind.PenCrossbow, undefined, 0, 0)).toBe(
      PEN_CROSSBOW_HOLD_FRAME,
    );
    expect(resolveHeldWeaponFrame(ItemKind.PenCrossbow, undefined, 0, 3)).toBe(
      PEN_CROSSBOW_FIRING_FRAME,
    );
  });

  it('throws when a held item has no sprite rule or weapon definition', () => {
    expect(() => resolveHeldWeaponFrame(ItemKind.Gun, undefined, 0)).toThrow(
      'Missing weapon definition for held item 1',
    );
  });

  it('falls back to idle bottom inset for unknown whip frames', () => {
    expect(getEthernetWhipBottomInset('attack2')).toBe(ETHERNET_WHIP_BOTTOM_INSET.attack2);
    expect(getEthernetWhipBottomInset('missing')).toBe(ETHERNET_WHIP_BOTTOM_INSET.idle);
  });
});

describe('sprite asset resolution', () => {
  it('resolves existing character and weapon sprite URLs', () => {
    expect(getCharacterSpriteUrl('eggert', 'idle_r')).toContain('/src/assets/characters/eggert/idle_r.png');
    expect(getCharacterPreviewUrl('sahai')).toContain('/src/assets/characters/sahai/idle_r.png');
    expect(getWeaponSpriteUrl('paper_stack', 'paper_stack')).toContain(
      '/src/assets/weapons/paper_stack/paper_stack.png',
    );
  });

  it('throws clear errors for missing sprite assets', () => {
    expect(() => getCharacterSpriteUrl('eggert', 'missing')).toThrow(
      'Missing character sprite: eggert/missing.png',
    );
    expect(() => getWeaponSpriteUrl('paper_stack', 'missing')).toThrow(
      'Missing weapon sprite: paper_stack/missing.png',
    );
  });
});

describe('character id normalization and assignment', () => {
  it('normalizes missing or invalid character ids to the default character', () => {
    expect(normalizeCharacterId('smallberg')).toBe('smallberg');
    expect(normalizeCharacterId('Smallberg')).toBe(DEFAULT_CHARACTER_ID);
    expect(normalizeCharacterId(null)).toBe(DEFAULT_CHARACTER_ID);
    expect(normalizeCharacterId(undefined)).toBe(DEFAULT_CHARACTER_ID);
  });

  it('assigns characters by sorted player order and wraps long rosters', () => {
    const sortedPlayerIds = ['a', 'b', 'c', 'd', 'e'];

    expect(defaultCharacterForPlayer('a', sortedPlayerIds)).toBe('eggert');
    expect(defaultCharacterForPlayer('d', sortedPlayerIds)).toBe('smallberg');
    expect(defaultCharacterForPlayer('e', sortedPlayerIds)).toBe('eggert');
  });

  it('assigns a stable valid fallback character for players missing from the sorted list', () => {
    const assigned = defaultCharacterForPlayer('late-joiner', ['host']);

    expect(isCharacterId(assigned)).toBe(true);
    expect(defaultCharacterForPlayer('late-joiner', ['host'])).toBe(assigned);
    expect(CHARACTER_IDS).toContain(assigned);
  });
});