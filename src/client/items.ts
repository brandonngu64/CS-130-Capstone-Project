export enum ItemKind {
  Gun = 1,
  PenCrossbow = 2134,
}

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

// Some type of yellow so it stands out against the background
// Change later
export const GUN_COLOR = 0xffd700;

export const ITEM_SPAWN_INTERVAL_TICKS = 600;

export const ITEM_PICKUP_RADIUS = 1.0;

// 15 seconds before an uncollected item despawns
export const ITEM_LIFETIME_TICKS = 1050;

export interface WorldItem {
  id: number;
  kind: ItemKind;
  slotIndex: number;
  x: number;
  y: number;
  expiryTick: number;
}