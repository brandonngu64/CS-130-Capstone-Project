import {ItemKind} from "./items";
import Three from "three";

export enum projectileSprite {
    Pencil = 2462,
    Banana = 2463,
}

export enum ProjectileType {
    Bullet = 1,
    Explosive = 2,
    None = -1,
}

export interface K_Weapon {
  readonly kind: ItemKind;
  readonly damage: number;
  readonly ammo: number;
  readonly fireRate: number;

  readonly projectileSpeed: number;
  readonly projectileSprite: projectileSprite;
  readonly projectileType: ProjectileType;
  readonly projectileGravity: number;

  readonly reloadOnHit: boolean;
  readonly reloadOnKill: boolean;

  readonly laserSight: boolean;
  readonly cookable: boolean;
}

export const PenCrossbow: K_Weapon = {
    kind: ItemKind.PenCrossbow,
    damage: 80,
    ammo: 1,
    fireRate: 1,

    projectileSpeed: 100,
    projectileSprite: projectileSprite.Pencil,
    projectileType: ProjectileType.Bullet,
    projectileGravity: 0,

    reloadOnHit: true,
    reloadOnKill: false,

    laserSight: true,
    cookable: false,
};

export void renderLaserSight
