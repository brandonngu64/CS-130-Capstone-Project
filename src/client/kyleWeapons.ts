import * as THREE from 'three';
import { BULLET_DAMAGE, BULLET_SPEED, GUN_FIRE_COOLDOWN_TICKS } from './constants';
import { ItemKind } from './items';

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

export const GunWeapon: K_Weapon = {
  kind: ItemKind.Gun,
  damage: BULLET_DAMAGE,
  ammo: 6,
  fireRate: GUN_FIRE_COOLDOWN_TICKS,

  projectileSpeed: BULLET_SPEED,
  projectileSprite: projectileSprite.Banana,
  projectileType: ProjectileType.Bullet,
  projectileGravity: 0,

  reloadOnHit: false,
  reloadOnKill: false,

  laserSight: false,
  cookable: false,
};

export const PenCrossbow: K_Weapon = {
  kind: ItemKind.PenCrossbow,
  damage: 80,
  ammo: 1,
  fireRate: 0.1,

  projectileSpeed: 100,
  projectileSprite: projectileSprite.Pencil,
  projectileType: ProjectileType.Bullet,
  projectileGravity: 0,

  reloadOnHit: true,
  reloadOnKill: false,

  laserSight: true,
  cookable: false,
};

export const WEAPON_DEFINITIONS: Readonly<Record<ItemKind, K_Weapon>> = {
  [ItemKind.Gun]: GunWeapon,
  [ItemKind.PenCrossbow]: PenCrossbow,
};

export function K_getWeaponDefinition(kind: ItemKind): K_Weapon {
  const weapon = WEAPON_DEFINITIONS[kind];
  if (!weapon) {
    throw new Error(`Unknown weapon kind: ${kind}`);
  }
  return weapon;
}

const DEFAULT_PROJECTILE_WIDTH = 0.35;
const DEFAULT_PROJECTILE_HEIGHT = 0.14;
const DEFAULT_ITEM_WIDTH = 0.5;
const DEFAULT_ITEM_HEIGHT = 0.25;

function createGenericItemMesh(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(DEFAULT_ITEM_WIDTH, DEFAULT_ITEM_HEIGHT, 0.25);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    roughness: 0.3,
    metalness: 0.7,
    emissive: new THREE.Color(0xffd700),
    emissiveIntensity: 0.15,
  });
  return new THREE.Mesh(geometry, material);
}

function createGenericProjectileMesh(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(DEFAULT_PROJECTILE_WIDTH, DEFAULT_PROJECTILE_HEIGHT, 0.16);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffe066,
    roughness: 0.2,
    metalness: 0.5,
    emissive: new THREE.Color(0xffe066),
    emissiveIntensity: 0.6,
  });
  return new THREE.Mesh(geometry, material);
}

function createGenericGunMesh(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(0.35, 0.35, 0.18);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    roughness: 0.3,
    metalness: 0.8,
    emissive: new THREE.Color(0xffd700),
    emissiveIntensity: 0.3,
  });
  return new THREE.Mesh(geometry, material);
}

export function K_createWeaponMesh(kind: ItemKind, textureLoader: THREE.TextureLoader): THREE.Mesh {
  // Refactor note: weapon-specific visual meshes were removed. All weapons currently reuse the
  // legacy generic gun mesh path until a dedicated visual is intentionally added back.
  void kind;
  void textureLoader;
  return createGenericGunMesh();
}

export function K_createDroppedItemMesh(kind: ItemKind, textureLoader: THREE.TextureLoader): THREE.Mesh {
  // Refactor note: dropped crossbow mesh override removed so dropped weapons share old generic visuals.
  void kind;
  void textureLoader;
  return createGenericItemMesh();
}

export function K_createProjectileMesh(kind: ItemKind, textureLoader: THREE.TextureLoader): THREE.Mesh {
  // Refactor note: crossbow projectile texture mesh removed; projectiles now use the existing generic mesh.
  // If a future weapon needs a custom projectile visual, add it here with a dedicated helper function.
  void kind;
  void textureLoader;
  return createGenericProjectileMesh();
}

/*
 * Guide: adding a new weapon with minimal renderer changes
 * 1) Add a new entry in `K_Weapon` definitions (`WEAPON_DEFINITIONS`) with gameplay values only.
 * 2) Reuse generic meshes by default through:
 *    - `K_createWeaponMesh`
 *    - `K_createDroppedItemMesh`
 *    - `K_createProjectileMesh`
 * 3) Only add custom mesh helpers when required for readability/game feel, and keep fallbacks to generic meshes.
 * 4) Keep all exported `K_` function names/signatures unchanged to avoid integration interference.
 */

export function K_renderLaserSight(x: number, y: number, facing: number, length = 100): THREE.Line {
  const points = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(length, 0, 0),
  ];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color: 0xff5555, opacity: 0.2, transparent: true });
  const line = new THREE.Line(geometry, material);
  line.position.set(x, y, 0.75);
  line.rotation.z = facing === -1 ? Math.PI : 0;
  line.frustumCulled = false;
  return line;
}
