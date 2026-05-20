import type { RigidBody } from '@dimforge/rapier2d-compat';
import { PLAYER_MAX_HEALTH } from './constants';

export class PlayerCharacter {
  public readonly id: string;
  public readonly body: RigidBody;
  public readonly color: number;
  public readonly maxHealth: number;
  public health: number;
  public readonly inventory = new Set<string>();

  constructor(
    id: string,
    body: RigidBody,
    color: number,
    maxHealth = PLAYER_MAX_HEALTH,
  ) {
    this.id = id;
    this.body = body;
    this.color = color;
    this.maxHealth = maxHealth;
    this.health = maxHealth;
  }

  takeDamage(amount: number): number {
    const nextHealth = Math.max(0, this.health - Math.max(0, amount));
    this.health = nextHealth;
    return this.health;
  }

  heal(amount: number): number {
    const nextHealth = Math.min(this.maxHealth, this.health + Math.max(0, amount));
    this.health = nextHealth;
    return this.health;
  }

  isAlive(): boolean {
    return this.health > 0;
  }

  isDead(): boolean {
    return !this.isAlive();
  }

  addItem(item: string): boolean {
    const hadItem = this.inventory.has(item);
    this.inventory.add(item);
    return !hadItem;
  }

  removeItem(item: string): boolean {
    return this.inventory.delete(item);
  }

  hasItem(item: string): boolean {
    return this.inventory.has(item);
  }

  clearInventory(): void {
    this.inventory.clear();
  }

  reset(): void {
    this.health = this.maxHealth;
    this.inventory.clear();
  }

  get inventoryItems(): string[] {
    return Array.from(this.inventory);
  }
}
