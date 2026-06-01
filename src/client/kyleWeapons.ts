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
  fireRate: 10,

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

const CROSSBOW_TEXTURE_URL = new URL('../assets/k_weapon_sprites/Crossbow.png', import.meta.url).href;
const CROSSBOW_PROJECTILE_TEXTURE_URL = new URL('../assets/k_weapon_sprites/fountainPenProj.png', import.meta.url).href;

const DEFAULT_PROJECTILE_WIDTH = 0.35;
const DEFAULT_PROJECTILE_HEIGHT = 0.14;
const DEFAULT_ITEM_WIDTH = 0.5;
const DEFAULT_ITEM_HEIGHT = 0.25;
const CROSSBOW_WEAPON_WIDTH = 0.7;
const CROSSBOW_WEAPON_HEIGHT = 0.25;
const CROSSBOW_PROJECTILE_WIDTH = 0.6;
const CROSSBOW_PROJECTILE_HEIGHT = 0.16;

function createCrossbowMesh(textureLoader: THREE.TextureLoader): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(CROSSBOW_WEAPON_WIDTH, CROSSBOW_WEAPON_HEIGHT);
  const texture = textureLoader.load(CROSSBOW_TEXTURE_URL);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1;
  return mesh;
}

function createDroppedCrossbowMesh(textureLoader: THREE.TextureLoader): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(DEFAULT_ITEM_WIDTH, DEFAULT_ITEM_HEIGHT);
  const texture = textureLoader.load(CROSSBOW_TEXTURE_URL);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1;
  return mesh;
}

function createCrossbowProjectileMesh(textureLoader: THREE.TextureLoader): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(CROSSBOW_PROJECTILE_WIDTH, CROSSBOW_PROJECTILE_HEIGHT);
  const texture = textureLoader.load(CROSSBOW_PROJECTILE_TEXTURE_URL);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1;
  return mesh;
}

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
  if (kind === ItemKind.PenCrossbow) {
    return createCrossbowMesh(textureLoader);
  }
  return createGenericGunMesh();
}

export function K_createDroppedItemMesh(kind: ItemKind, textureLoader: THREE.TextureLoader): THREE.Mesh {
  if (kind === ItemKind.PenCrossbow) {
    return createDroppedCrossbowMesh(textureLoader);
  }
  return createGenericItemMesh();
}

export function K_createProjectileMesh(kind: ItemKind, textureLoader: THREE.TextureLoader): THREE.Mesh {
  if (kind === ItemKind.PenCrossbow) {
    return createCrossbowProjectileMesh(textureLoader);
  }
  return createGenericProjectileMesh();
}

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
