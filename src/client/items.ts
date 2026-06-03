export enum ItemKind {
  Gun = 1,
  EthernetWhip = 2,
  Finals = 3,
}

export type WeaponKind = 'projectile' | 'melee';

export interface WeaponDefinition {
  kind: WeaponKind;
  damage: number;
  cooldownTicks: number;
  // melee only
  hitboxHalfWidth?: number;
  hitboxHalfHeight?: number;
  centerOffsetX?: number;
  centerOffsetY?: number;
  durationTicks?: number;       // how long the active attack state lasts
  // whip phase timing (melee weapons with wind-up)
  windupTicks?: number;
  lashTicks?: number;
  recoilTicks?: number;
  // projectile only
  projectileSpeed?: number;
  projectileLifetimeTicks?: number;
}

export const WEAPON_DEFINITIONS: Partial<Record<ItemKind, WeaponDefinition>> = {
  [ItemKind.EthernetWhip]: {
    kind: 'melee',
    damage: 22,
    cooldownTicks: 40,
    hitboxHalfWidth: 1.8,
    hitboxHalfHeight: 0.2,
    centerOffsetX: 0.45 + 1.8, // PLAYER_HALF_WIDTH + reach
    centerOffsetY: 0.0,
    windupTicks: 10,
    lashTicks: 8,
    recoilTicks: 12,
    get durationTicks() {
      return (this.windupTicks ?? 0) + (this.lashTicks ?? 0) + (this.recoilTicks ?? 0);
    },
  },
  [ItemKind.Finals]: {
    kind: 'projectile',
    damage: 4,
    cooldownTicks: 6,
    projectileSpeed: 32,
    projectileLifetimeTicks: 90,
  },
};

export const FINALS_COLOR = 0xf4a261;

export type WhipPhase = 'windup' | 'lash' | 'recoil';

export function getWhipPhase(def: WeaponDefinition, ticksRemaining: number): WhipPhase {
  const total = def.durationTicks ?? 0;
  const elapsed = total - ticksRemaining;
  if (elapsed < (def.windupTicks ?? 0)) return 'windup';
  if (elapsed < (def.windupTicks ?? 0) + (def.lashTicks ?? 0)) return 'lash';
  return 'recoil';
}

export function whipHitboxActive(def: WeaponDefinition, ticksRemaining: number): boolean {
  return getWhipPhase(def, ticksRemaining) === 'lash';
}

// ─── World item spawning ───────────────────────────────────────────────────

export interface ItemSpawnSlot {
  readonly x: number;
  readonly y: number;
}

export const ITEM_SPAWN_SLOTS: readonly ItemSpawnSlot[] = [
  { x: -8, y: 0.5 },
  { x: 0, y: 0.5 },
  { x: 8, y: 0.5 },
  { x: -5, y: 3.1 },
  { x: 5, y: 3.1 },
  { x: 0, y: 5.4 },
];

export const GUN_COLOR = 0xffd700;
export const WHIP_COLOR = 0xffd700;

export const ITEM_SPAWN_INTERVAL_TICKS = 600;
export const ITEM_PICKUP_RADIUS = 1.0;
export const ITEM_LIFETIME_TICKS = 1050;

export interface WorldItem {
  id: number;
  kind: ItemKind;
  slotIndex: number;
  x: number;
  y: number;
  expiryTick: number;
}