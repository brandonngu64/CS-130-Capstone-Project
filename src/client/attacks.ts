import { PLAYER_HALF_WIDTH } from './constants';

/** Placeholder sprite color for the default punch hitbox. */
export const PUNCH_PLACEHOLDER_COLOR = 0xffffff;

/** Attack kinds map to equipped weapons; default punch is always available. */
export enum AttackKind {
  DefaultPunch = 1,
}

export interface AttackDefinition {
  kind: AttackKind;
  durationTicks: number;
  hitboxHalfWidth: number;
  hitboxHalfHeight: number;
  centerOffsetX: number;
  centerOffsetY: number;
  spriteColor: number;
}

const ATTACK_DEFINITIONS: Record<AttackKind, AttackDefinition> = {
  [AttackKind.DefaultPunch]: {
    kind: AttackKind.DefaultPunch,
    durationTicks: 8,
    hitboxHalfWidth: 0.8,
    hitboxHalfHeight: 0.25,
    centerOffsetX: PLAYER_HALF_WIDTH + 0.8,
    centerOffsetY: 0.1,
    spriteColor: PUNCH_PLACEHOLDER_COLOR,
  },
};

export function getAttackDefinition(kind: AttackKind): AttackDefinition {
  const definition = ATTACK_DEFINITIONS[kind];
  if (!definition) {
    throw new Error(`Unknown attack kind: ${kind}`);
  }
  return definition;
}

/** Resolves the attack for a player's current weapon (default punch for now). */
export function getEquippedAttack(weapon: AttackKind = AttackKind.DefaultPunch): AttackDefinition {
  return getAttackDefinition(weapon);
}
