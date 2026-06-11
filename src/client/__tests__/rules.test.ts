import { describe, expect, it } from 'vitest';

import { getAttackDefinition, getEquippedAttack, AttackKind } from '../attacks';
import {
  CHARACTER_IDS,
  characterIdFromIndex,
  characterIdToIndex,
  isCharacterId,
  PLAYER_HALF_WIDTH,
} from '../constants';
import { InputBits, decodeInputBits, encodeInput, type InputState } from '../input';
import { ItemKind, WEAPON_DEFINITIONS, getWhipPhase, whipHitboxActive } from '../items';

const emptyInput: InputState = {
  left: false,
  right: false,
  jump: false,
  duck: false,
  punch: false,
  dodge: false,
  shield: false,
};

describe('input bit packing', () => {
  it('encodes no pressed controls as zero bits', () => {
    expect(decodeInputBits(encodeInput(emptyInput))).toBe(0);
  });

  it.each([
    ['left', InputBits.Left],
    ['right', InputBits.Right],
    ['jump', InputBits.Jump],
    ['duck', InputBits.Duck],
    ['punch', InputBits.Punch],
    ['dodge', InputBits.Dodge],
    ['shield', InputBits.Shield],
  ] as const)('sets only the %s bit when that control is pressed', (control, expectedBit) => {
    expect(decodeInputBits(encodeInput({ ...emptyInput, [control]: true }))).toBe(expectedBit);
  });

  it('combines simultaneous controls into one deterministic byte', () => {
    const encoded = encodeInput({
      left: true,
      right: true,
      jump: false,
      duck: true,
      punch: true,
      dodge: false,
      shield: false,
    });

    expect(decodeInputBits(encoded)).toBe(
      InputBits.Left | InputBits.Right | InputBits.Duck | InputBits.Punch,
    );
  });

  it('encodes every supported control without overflowing one byte', () => {
    const encoded = encodeInput({
      left: true,
      right: true,
      jump: true,
      duck: true,
      punch: true,
      dodge: true,
      shield: true,
    });

    expect(encoded).toHaveLength(1);
    expect(decodeInputBits(encoded)).toBe(
      InputBits.Left |
        InputBits.Right |
        InputBits.Jump |
        InputBits.Duck |
        InputBits.Punch |
        InputBits.Dodge |
        InputBits.Shield,
    );
  });

  it('treats missing or empty rollback input as neutral input', () => {
    expect(decodeInputBits(undefined)).toBe(0);
    expect(decodeInputBits(new Uint8Array())).toBe(0);
  });
});

describe('character id helpers', () => {
  it('accepts every configured character id and rejects unknown ids', () => {
    for (const characterId of CHARACTER_IDS) {
      expect(isCharacterId(characterId)).toBe(true);
    }

    expect(isCharacterId('unknown')).toBe(false);
    expect(isCharacterId('Eggert')).toBe(false);
  });

  it('maps character ids to their configured indexes', () => {
    expect(characterIdToIndex('eggert')).toBe(0);
    expect(characterIdToIndex('nachenburg')).toBe(1);
    expect(characterIdToIndex('sahai')).toBe(2);
    expect(characterIdToIndex('smallberg')).toBe(3);
  });

  it('wraps positive and negative indexes into the character roster', () => {
    expect(characterIdFromIndex(0)).toBe('eggert');
    expect(characterIdFromIndex(CHARACTER_IDS.length)).toBe('eggert');
    expect(characterIdFromIndex(CHARACTER_IDS.length + 1)).toBe('nachenburg');
    expect(characterIdFromIndex(-1)).toBe('smallberg');
    expect(characterIdFromIndex(-CHARACTER_IDS.length)).toBe('eggert');
  });
});

describe('attack definitions', () => {
  it('returns the default punch definition with the expected hitbox and damage values', () => {
    const punch = getAttackDefinition(AttackKind.DefaultPunch);

    expect(punch).toMatchObject({
      kind: AttackKind.DefaultPunch,
      durationTicks: 8,
      damage: 15,
      hitboxHalfWidth: 0.8,
      hitboxHalfHeight: 0.25,
      centerOffsetY: 0.1,
    });
    expect(punch.centerOffsetX).toBeCloseTo(PLAYER_HALF_WIDTH + punch.hitboxHalfWidth);
  });

  it('uses default punch when no equipped attack is supplied', () => {
    expect(getEquippedAttack()).toBe(getAttackDefinition(AttackKind.DefaultPunch));
  });

  it('throws for an unknown attack kind instead of returning an invalid definition', () => {
    expect(() => getAttackDefinition(999 as AttackKind)).toThrow('Unknown attack kind: 999');
  });
});

describe('weapon phase helpers', () => {
  const ethernetWhip = WEAPON_DEFINITIONS[ItemKind.EthernetWhip];

  if (!ethernetWhip) {
    throw new Error('Ethernet whip definition is required for weapon phase tests.');
  }

  it('computes ethernet whip duration from windup, lash, and recoil timing', () => {
    expect(ethernetWhip.durationTicks).toBe(14);
  });

  it.each([
    [14, 'windup'],
    [11, 'windup'],
    [10, 'lash'],
    [6, 'lash'],
    [5, 'recoil'],
    [1, 'recoil'],
  ] as const)('reports %s ticks remaining as %s phase', (ticksRemaining, expectedPhase) => {
    expect(getWhipPhase(ethernetWhip, ticksRemaining)).toBe(expectedPhase);
  });

  it('activates the whip hitbox only during the lash phase', () => {
    expect(whipHitboxActive(ethernetWhip, 14)).toBe(false);
    expect(whipHitboxActive(ethernetWhip, 10)).toBe(true);
    expect(whipHitboxActive(ethernetWhip, 6)).toBe(true);
    expect(whipHitboxActive(ethernetWhip, 5)).toBe(false);
  });

  it('falls back to recoil for elapsed time beyond the configured duration', () => {
    expect(getWhipPhase(ethernetWhip, 0)).toBe('recoil');
    expect(whipHitboxActive(ethernetWhip, 0)).toBe(false);
  });
});