import type { RigidBody } from '@dimforge/rapier2d-compat';
import { AttackKind } from './attacks';
import type { CharacterId } from './constants';
import {
  AIR_DODGES_PER_AIRTIME,
  DEFAULT_CHARACTER_ID,
  SHIELD_MAX_HP,
  SMASH_DEFAULT_WEIGHT,
} from './constants';
import { ItemKind, whipHitboxActive } from './items';
import type { WeaponDefinition } from './items';
import { PLAYER_MAX_HEALTH } from './constants';

type ActiveAttack = {
  kind: AttackKind;
  ticksRemaining: number;
};

type ActiveWeaponAttack = {
  def: WeaponDefinition;
  ticksRemaining: number;
};

export enum MoveState {
  Idle = 0,
  InitialDash = 1,
  DashTurnLock = 2,
  Run = 3,
  Skid = 4,
  Airborne = 5,
}

export class PlayerCharacter {
  public readonly id: string;
  public readonly body: RigidBody;
  public readonly color: number;
  public readonly maxHealth: number;
  public characterId: CharacterId;
  public health: number;
  public facing: number;
  public equippedWeapon: AttackKind;
  public activeAttack: ActiveAttack | null;
  public activeWeaponAttack: ActiveWeaponAttack | null;
  public weaponCooldownTicks: number;
  public dodgeTicksRemaining: number;
  public dodgeCooldownTicks: number;
  public heldItem: ItemKind | null;
  public heldItemExpiryTick: number;
  public gunFireCooldownTicks: number;
  public reloadPending: boolean;
  public reloadPendingOnKill: boolean;
  public knockbackTicksRemaining: number;

  // Stage-out KO state: nonzero means the player is vulnerable to inner-blast ring out.
  public koableTicksRemaining: number;

  // Air dodges remaining in this airtime. Reset to AIR_DODGES_PER_AIRTIME on grounding.
  public airDodgesRemaining: number;

  // Smash-style ground movement state machine
  public moveState: MoveState;
  public moveStateTicks: number;
  public moveDirection: number; // -1 | 0 | 1
  public dashInputCooldownTicks: number;

  // Double jump
  public doubleJumpAvailable: boolean;

  // Shield
  public shieldHp: number;
  public shieldActive: boolean;
  public shieldBlockedSinceRaise: boolean;
  public shieldBrokenLockoutTicks: number;
  public shieldReleaseCooldownTicks: number;

  // Smash-mode damage accumulator (0..SMASH_MAX_DAMAGE_PCT+). Unused in Classic.
  public damagePct: number;
  // SSB-formula weight. Uniform across characters for now.
  public weight: number;
  // True while the player has been launched lethally and is rocketing offstage.
  // While set, inputs are ignored and the collider eventually noclips through stage geometry.
  public inLethalLaunch: boolean;
  // Ticks elapsed since entering inLethalLaunch (used for the noclip delay).
  public lethalLaunchTicks: number;

  constructor(
    id: string,
    body: RigidBody,
    color: number,
    maxHealth = PLAYER_MAX_HEALTH,
    characterId: CharacterId = DEFAULT_CHARACTER_ID,
  ) {
    this.id = id;
    this.body = body;
    this.color = color;
    this.maxHealth = maxHealth;
    this.characterId = characterId;
    this.health = maxHealth;
    this.facing = 1;
    this.equippedWeapon = AttackKind.DefaultPunch;
    this.activeAttack = null;
    this.activeWeaponAttack = null;
    this.weaponCooldownTicks = 0;
    this.dodgeTicksRemaining = 0;
    this.dodgeCooldownTicks = 0;
    this.heldItem = null;
    this.heldItemExpiryTick = 0;
    this.gunFireCooldownTicks = 0;
    this.reloadPending = false;
    this.reloadPendingOnKill = false;
    this.knockbackTicksRemaining = 0;
    this.koableTicksRemaining = 0;
    this.airDodgesRemaining = AIR_DODGES_PER_AIRTIME;

    this.moveState = MoveState.Idle;
    this.moveStateTicks = 0;
    this.moveDirection = 0;
    this.dashInputCooldownTicks = 0;
    this.doubleJumpAvailable = true;
    this.shieldHp = SHIELD_MAX_HP;
    this.shieldActive = false;
    this.shieldBlockedSinceRaise = false;
    this.shieldBrokenLockoutTicks = 0;
    this.shieldReleaseCooldownTicks = 0;
    this.damagePct = 0;
    this.weight = SMASH_DEFAULT_WEIGHT;
    this.inLethalLaunch = false;
    this.lethalLaunchTicks = 0;
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

  isDodging(): boolean {
    return this.dodgeTicksRemaining > 0;
  }

  canDodge(): boolean {
    return this.dodgeCooldownTicks === 0 && this.dodgeTicksRemaining === 0;
  }

  isShieldActive(): boolean {
    return this.shieldActive && this.shieldHp > 0;
  }

  isInvincible(): boolean {
    return this.isDodging() || this.isShieldActive();
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

  canPunch(): boolean {
    return this.heldItem === null;
  }

  canUseWeapon(): boolean {
    return (
      this.heldItem !== null &&
      this.heldItem !== ItemKind.Gun &&
      this.weaponCooldownTicks === 0 &&
      this.activeWeaponAttack === null
    );
  }

  /** True only during the lash frames of an active whip attack. */
  isWhipHitboxActive(): boolean {
    if (!this.activeWeaponAttack) return false;
    return whipHitboxActive(this.activeWeaponAttack.def, this.activeWeaponAttack.ticksRemaining);
  }

  dropItem(): void {
    this.heldItem = null;
    this.heldItemExpiryTick = 0;
    this.gunFireCooldownTicks = 0;
    this.reloadPending = false;
    this.reloadPendingOnKill = false;
    this.activeWeaponAttack = null;
    this.weaponCooldownTicks = 0;
  }

  reset(): void {
    this.health = this.maxHealth;
    this.facing = 1;
    this.equippedWeapon = AttackKind.DefaultPunch;
    this.activeAttack = null;
    this.activeWeaponAttack = null;
    this.weaponCooldownTicks = 0;
    this.dodgeTicksRemaining = 0;
    this.dodgeCooldownTicks = 0;
    this.heldItem = null;
    this.heldItemExpiryTick = 0;
    this.gunFireCooldownTicks = 0;
    this.reloadPending = false;
    this.reloadPendingOnKill = false;
    this.knockbackTicksRemaining = 0;
    this.koableTicksRemaining = 0;
    this.airDodgesRemaining = AIR_DODGES_PER_AIRTIME;

    this.moveState = MoveState.Idle;
    this.moveStateTicks = 0;
    this.moveDirection = 0;
    this.dashInputCooldownTicks = 0;
    this.doubleJumpAvailable = true;
    this.shieldHp = SHIELD_MAX_HP;
    this.shieldActive = false;
    this.shieldBlockedSinceRaise = false;
    this.shieldBrokenLockoutTicks = 0;
    this.shieldReleaseCooldownTicks = 0;
    this.damagePct = 0;
    this.inLethalLaunch = false;
    this.lethalLaunchTicks = 0;
  }
}
