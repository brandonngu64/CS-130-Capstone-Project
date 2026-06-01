import type { RigidBody } from '@dimforge/rapier2d-compat';
import { AttackKind } from './attacks';
import { ItemKind } from './items';
import { PLAYER_MAX_HEALTH } from './constants';

type ActiveAttack = {
  kind: AttackKind;
  ticksRemaining: number;
};

export class PlayerCharacter {
  public readonly id: string;
  public readonly body: RigidBody;
  public readonly color: number;
  public readonly maxHealth: number;
  public health: number;
  public facing: number;
  public equippedWeapon: AttackKind;
  public activeAttack: ActiveAttack | null;
  public dashTicksRemaining: number;
  public dashCooldownTicks: number;
  public heldItem: ItemKind | null;
  public heldItemExpiryTick: number;
  public gunFireCooldownTicks: number;
  public reloadPending: boolean;
  public reloadPendingOnKill: boolean;

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
    this.facing = 1;
    this.equippedWeapon = AttackKind.DefaultPunch;
    this.activeAttack = null;
    this.dashTicksRemaining = 0;
    this.dashCooldownTicks = 0;
    this.heldItem = null;
    this.heldItemExpiryTick = 0;
    this.gunFireCooldownTicks = 0;
    this.reloadPending = false;
    this.reloadPendingOnKill = false;
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

  isAttacking(): boolean {
    return this.activeAttack !== null;
  }

  isDashing(): boolean {
    return this.dashTicksRemaining > 0;
  }

  canDash(): boolean {
    return this.dashCooldownTicks === 0 && this.dashTicksRemaining === 0;
  }

  hasItem(): boolean {
    return this.heldItem !== null;
  }

  canShoot(): boolean {
    return (
      (this.heldItem === ItemKind.Gun || this.heldItem === ItemKind.PenCrossbow)
      && !this.reloadPending
    );
  }

  // make it so you can only punch if you don't have a weapon equipped
  canPunch(): boolean {
    return this.heldItem !== ItemKind.Gun && this.heldItem !== ItemKind.PenCrossbow;
  }

  dropItem(): void {
    this.heldItem = null;
    this.heldItemExpiryTick = 0;
    this.gunFireCooldownTicks = 0;
    this.reloadPending = false;
    this.reloadPendingOnKill = false;
  }

  reset(): void {
    this.health = this.maxHealth;
    this.facing = 1;
    this.activeAttack = null;
    this.dashTicksRemaining = 0;
    this.dashCooldownTicks = 0;
    this.heldItem = null;
    this.heldItemExpiryTick = 0;
    this.gunFireCooldownTicks = 0;
    this.reloadPending = false;
    this.reloadPendingOnKill = false;
  }
}