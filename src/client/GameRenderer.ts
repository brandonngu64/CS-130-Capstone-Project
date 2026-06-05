import * as THREE from 'three';
import {
  CHARACTER_SPRITE_PIXEL_HEIGHT,
  getCharacterSpriteUrl,
  getWeaponSpriteUrl,
  BINARY_BEAM_HOLD_FRAME,
  BINARY_BEAM_PROJECTILE_FRAME,
  PEN_CROSSBOW_HOLD_FRAME,
  PEN_CROSSBOW_PROJECTILE_FRAME,
  PEN_CROSSBOW_TEXTURE_PIXELS,
  PAPER_STACK_HOLD_FRAME,
  PAPER_STACK_PROJECTILE_FRAME,
  PAPER_STACK_TEXTURE_PIXELS,
  PUNCH_SPRITE_HEIGHT_RATIO,
  PUNCH_WEAPON_NAME,
  resolveCharacterFrame,
  resolveCharacterFrameKey,
  resolveHeldWeaponFrame,
  resolvePunchSpriteVariant,
  getEthernetWhipBottomInset,
  WEAPON_SPRITE_NAMES,
} from './CharacterSprites';
import { PLAYER_HALF_HEIGHT, PLAYER_HALF_WIDTH, RESPAWN_FLASH_TICKS } from './constants';
import {
  K_createDroppedItemMesh,
  K_createProjectileMesh,
  K_createWeaponMesh,
  K_renderLaserSight,
} from './kyleWeapons';
import { GUN_COLOR, ItemKind, WEAPON_DEFINITIONS, WEAPON_SPRITE_CONFIG } from './items';
import type { RenderState } from './RollbackPhysicsGame';
import type { MapTileInstance, TiledMapDefinition, UvRect } from './tiledMap';

const CAMERA_MARGIN = 1.5;

function usesKyleGenericHeldMesh(kind: ItemKind): boolean {
  return kind === ItemKind.Gun;
}

function usesKyleGenericProjectileMesh(kind: ItemKind): boolean {
  return kind === ItemKind.Gun;
}

export type CameraMode = 'follow' | 'free' | 'action';

type CachedTileMaterial = {
  material: THREE.MeshBasicMaterial;
  texture: THREE.Texture;
};

type CachedSpriteTexture = {
  texture: THREE.Texture;
  aspectRatio: number;
  pixelWidth: number;
  pixelHeight: number;
};

type PlayerSpriteMesh = {
  mesh: THREE.Mesh;
  lastFrameKey: string;
};

type WeaponSpriteMesh = {
  mesh: THREE.Mesh;
  lastFrameKey: string;
};

type AttackSpriteMesh = {
  mesh: THREE.Mesh;
  lastFrameKey: string;
};

type BulletSpriteMesh = {
  mesh: THREE.Mesh;
  lastFrameKey: string;
  kind: ItemKind;
};

// Size of a collectible item sitting on the ground
const ITEM_GUN_WIDTH  = 0.5;
const ITEM_GUN_HEIGHT = 0.25;
const ITEM_GUN_DEPTH  = 0.25;
const WHIP_ITEM_Y_OFFSET = -0.28;

const BULLET_W = 0.3;
const BULLET_H = 0.16;
const BULLET_D = 0.16;

// Whip art: handle near bottom-left of texture (facing-right unmirrored art).
const WHIP_HANDLE_TEXTURE_X = -0.35;
const WHIP_HANDLE_TEXTURE_Y = -0.15;
// Target grip point on the hold pose (from player centre).
const WHIP_HAND_OFFSET_X = PLAYER_HALF_WIDTH * 0.72;
const WHIP_HAND_OFFSET_Y = PLAYER_HALF_HEIGHT * 0.06;

// Finals paper stack held near the character's hand.
const PAPER_STACK_HAND_OFFSET_X = PLAYER_HALF_WIDTH * 0.62;
const PAPER_STACK_HAND_OFFSET_Y = PLAYER_HALF_HEIGHT * 0.08;
const PAPER_STACK_UNIFORM_SCALE = 0.78;
const PAPER_STACK_WIDTH_SCALE = 1;
/** Uniform scale on paper_sheet projectile (preserves PNG aspect). */
const PAPER_SHEET_SCALE = 1;
const PAPER_STACK_ITEM_Y_OFFSET = -0.22;

// Pen crossbow held near the character's hand (kyle weapon sprite path).
const PEN_CROSSBOW_HAND_OFFSET_X = PLAYER_HALF_WIDTH * 0.62;
const PEN_CROSSBOW_HAND_OFFSET_Y = PLAYER_HALF_HEIGHT * 0.08;
const PEN_CROSSBOW_UNIFORM_SCALE = 0.78;
const PEN_CROSSBOW_WIDTH_SCALE = 1;
/** Uniform scale on bolt projectile (preserves PNG aspect). */
const PEN_CROSSBOW_BOLT_SCALE = 1.2;
const PEN_CROSSBOW_ITEM_Y_OFFSET = -0.22;
const BINARY_BEAM_HAND_OFFSET_X = PLAYER_HALF_WIDTH * 1.0;
const BINARY_BEAM_HAND_OFFSET_Y = PLAYER_HALF_HEIGHT * 0.15;

function resolveWhipHoldPosition(
  playerX: number,
  playerY: number,
  facing: number,
  displayWidth: number,
  displayHeight: number,
): { x: number; y: number } {
  return {
    x: playerX + facing * (
      WHIP_HAND_OFFSET_X - WHIP_HANDLE_TEXTURE_X * displayWidth
    ),
    y: playerY + WHIP_HAND_OFFSET_Y - WHIP_HANDLE_TEXTURE_Y * displayHeight,
  };
}

/** Bottom corner on the side toward the player (matches mirrored plane scale). */
function whipNearPlayerCornerOffset(
  facing: number,
  displayWidth: number,
  displayHeight: number,
): { x: number; y: number } {
  return {
    x: -facing * displayWidth * 0.5,
    y: -displayHeight * 0.5,
  };
}

function whipNearPlayerCorner(
  meshX: number,
  meshY: number,
  facing: number,
  displayWidth: number,
  displayHeight: number,
): { x: number; y: number } {
  const offset = whipNearPlayerCornerOffset(facing, displayWidth, displayHeight);
  return { x: meshX + offset.x, y: meshY + offset.y };
}

/** World Y of the lowest visible pixel row in the texture. */
function whipVisibleBottomY(
  meshY: number,
  displayHeight: number,
  bottomInsetRatio: number,
): number {
  return meshY + displayHeight * (bottomInsetRatio - 0.5);
}

function resolveWhipMeshPosition(
  idleNearCornerX: number,
  idleVisibleBottomY: number,
  facing: number,
  frameWidth: number,
  frameHeight: number,
  frameBottomInset: number,
): { x: number; y: number } {
  return {
    x: idleNearCornerX + facing * frameWidth * 0.5,
    y: idleVisibleBottomY - frameHeight * (frameBottomInset - 0.5),
  };
}

function resolvePaperStackHoldPosition(
  playerX: number,
  playerY: number,
  facing: number,
  displayWidth: number,
): { x: number; y: number } {
  return {
    x: playerX + facing * (PAPER_STACK_HAND_OFFSET_X + displayWidth * 0.5),
    y: playerY + PAPER_STACK_HAND_OFFSET_Y,
  };
}

function resolvePenCrossbowHoldPosition(
  playerX: number,
  playerY: number,
  facing: number,
  displayWidth: number,
): { x: number; y: number } {
  return {
    x: playerX + facing * (PEN_CROSSBOW_HAND_OFFSET_X + displayWidth * 0.5),
    y: playerY + PEN_CROSSBOW_HAND_OFFSET_Y,
  };
}

function resolveBinaryBeamHoldPosition(
  playerX: number,
  playerY: number,
  facing: number,
  displayWidth: number,
): { x: number; y: number } {
  return {
    x: playerX + facing * (BINARY_BEAM_HAND_OFFSET_X + displayWidth * 0.5),
    y: playerY + BINARY_BEAM_HAND_OFFSET_Y,
  };
}

export class GameRenderer {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly container: HTMLElement;
  private readonly playerMeshes = new Map<string, PlayerSpriteMesh>();
  private readonly weaponSpriteMeshes = new Map<string, WeaponSpriteMesh>();
  private readonly mapMeshes: THREE.Mesh[] = [];
  private readonly materialCache = new Map<string, CachedTileMaterial>();
  private readonly spriteTextureCache = new Map<string, CachedSpriteTexture>();
  private readonly backdropMesh: THREE.Mesh;
  private readonly mapBounds: TiledMapDefinition['bounds'];
  private readonly baseViewHeight: number;
  private baseViewWidth = 0;
  private readonly freeCameraTarget = new THREE.Vector2();
  private freeCameraZoom = 1;
  private readonly cameraTarget = new THREE.Vector2();
  private cameraMode: CameraMode = 'follow';
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly attackMeshes = new Map<string, AttackSpriteMesh>();
  private readonly itemMeshes = new Map<number, THREE.Mesh>();
  private readonly bulletMeshes = new Map<number, BulletSpriteMesh>();
  private readonly kyleBulletMeshes = new Map<number, THREE.Mesh>();
  private readonly weaponMeshes = new Map<string, THREE.Mesh>();
  private readonly laserSightMeshes = new Map<string, THREE.Line>();
  private cameraLockTarget: THREE.Vector2 | null = null;
  private readonly resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, map: TiledMapDefinition) {
    this.container = container;
    this.mapBounds = map.bounds;
    this.baseViewHeight = this.computeBaseViewHeight(map.bounds.height);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x131924);

    this.camera = new THREE.OrthographicCamera(-12, 12, 10, -2, 0.1, 100);
    this.camera.position.set(0, 0, 12);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.style.imageRendering = 'pixelated';

    this.container.appendChild(this.renderer.domElement);

    this.setupLighting();
    this.backdropMesh = this.setupBackdrop(map);
    this.setupMapMeshes(map);

    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    this.resizeObserver.observe(this.container);
    this.resize();
  }

  render(state: RenderState, localPlayerId: string): void {
    // --- Players ---
    const activeIds = new Set(state.players.map((player: RenderState['players'][number]) => player.id));

    for (const player of state.players) {
      let playerSprite = this.playerMeshes.get(player.id);
      if (!playerSprite) {
        playerSprite = this.createPlayerSpriteMesh();
        this.scene.add(playerSprite.mesh);
        this.playerMeshes.set(player.id, playerSprite);
      }

      const frame = resolveCharacterFrame(
        player.facing,
        player.heldItem,
        player.vx,
        state.animTick,
      );
      const frameKey = resolveCharacterFrameKey(
        player.characterId,
        player.facing,
        player.heldItem,
        player.vx,
        state.animTick,
      );

      const cachedSprite = this.getCachedSpriteTexture(player.characterId, frame);
      if (playerSprite.lastFrameKey !== frameKey) {
        const previousMaterial = playerSprite.mesh.material as THREE.MeshBasicMaterial;
        previousMaterial.dispose();
        playerSprite.mesh.material = this.createPlayerSpriteMaterial(cachedSprite.texture);
        playerSprite.lastFrameKey = frameKey;
      }

      const aspectRatio = this.resolveSpriteAspectRatio(cachedSprite);
      const displayHeight = player.height;
      const displayWidth = displayHeight * aspectRatio;
      playerSprite.mesh.scale.set(displayWidth, displayHeight, 1);

      playerSprite.mesh.visible = true;
      playerSprite.mesh.position.set(player.x, player.y, 0.35);

      const material = playerSprite.mesh.material as THREE.MeshBasicMaterial;

      if (player.respawnFlashTicksRemaining > 0) {
        const flashStep = Math.max(1, Math.floor(RESPAWN_FLASH_TICKS / 24));
        const flashVisible = Math.floor(player.respawnFlashTicksRemaining / flashStep) % 2 === 0;
        material.opacity = flashVisible ? 1 : 0.22;
      } else if (player.respawning) {
        material.opacity = 0.18;
      } else {
        material.opacity = 1;
      }

      const isTransparent = material.opacity < 1;
      material.transparent = isTransparent;
      material.depthWrite = !isTransparent;
    }

    for (const player of state.players) {
      const weapon = this.weaponMeshes.get(player.id);
      const laser = this.laserSightMeshes.get(player.id);
      const heldItem = player.heldItem;

      if (heldItem === null || !usesKyleGenericHeldMesh(heldItem)) {
        if (weapon) {
          this.scene.remove(weapon);
          weapon.geometry.dispose();
          (weapon.material as THREE.Material).dispose();
          this.weaponMeshes.delete(player.id);
        }
      } else {
        if (!weapon || weapon.userData.kind !== heldItem) {
          if (weapon) {
            this.scene.remove(weapon);
            weapon.geometry.dispose();
            (weapon.material as THREE.Material).dispose();
            this.weaponMeshes.delete(player.id);
          }
          const nextWeapon = K_createWeaponMesh(heldItem, this.textureLoader);
          nextWeapon.userData.kind = heldItem;
          this.scene.add(nextWeapon);
          this.weaponMeshes.set(player.id, nextWeapon);
        }

        const currentWeapon = this.weaponMeshes.get(player.id);
        if (currentWeapon) {
          currentWeapon.position.set(player.x + player.facing * 0.55, player.y + 0.2, 0.7);
          currentWeapon.visible = true;
        }
      }

      if (heldItem !== ItemKind.PenCrossbow) {
        if (laser) {
          this.scene.remove(laser);
          laser.geometry.dispose();
          (laser.material as THREE.Material).dispose();
          this.laserSightMeshes.delete(player.id);
        }
        continue;
      }

      let currentLaser = laser;
      if (!currentLaser) {
        currentLaser = K_renderLaserSight(player.x, player.y + 0.1, player.facing);
        this.scene.add(currentLaser);
        this.laserSightMeshes.set(player.id, currentLaser);
      }
      currentLaser.position.set(player.x + player.facing * 0.55, player.y + 0.2, 0.30);
      currentLaser.rotation.z = player.facing === -1 ? Math.PI : 0;
      currentLaser.visible = true;
    }
    for (const [id, playerSprite] of this.playerMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(playerSprite.mesh);
        playerSprite.mesh.geometry.dispose();
        this.playerMeshes.delete(id);
      }
    }

    // --- Weapon sprites (whip etc.) ---
    for (const player of state.players) {
      const weaponName = player.heldItem !== null
        ? WEAPON_SPRITE_NAMES[player.heldItem]
        : undefined;

      if (!weaponName) {
        // Remove stale weapon mesh if player no longer holds a sprite-weapon
        const stale = this.weaponSpriteMeshes.get(player.id);
        if (stale) {
          this.scene.remove(stale.mesh);
          stale.mesh.geometry.dispose();
          (stale.mesh.material as THREE.MeshBasicMaterial).dispose();
          this.weaponSpriteMeshes.delete(player.id);
        }
        continue;
      }

      const heldItem = player.heldItem;
      if (heldItem === null) {
        continue;
      }
      const def = WEAPON_DEFINITIONS[heldItem];
      if (heldItem !== ItemKind.PenCrossbow && !def) {
        continue;
      }

      const ticksRemaining = player.activeWeaponAttack?.ticksRemaining ?? 0;
      const weaponFrame = resolveHeldWeaponFrame(
        heldItem,
        def,
        ticksRemaining,
        player.gunFireCooldownTicks,
      );
      const weaponFrameKey = `${player.id}:${weaponName}:${weaponFrame}`;

      let weaponSprite = this.weaponSpriteMeshes.get(player.id);
      if (!weaponSprite) {
        weaponSprite = this.createWeaponSpriteMesh();
        this.scene.add(weaponSprite.mesh);
        this.weaponSpriteMeshes.set(player.id, weaponSprite);
      }

      if (weaponSprite.lastFrameKey !== weaponFrameKey) {
        const cachedTex = this.getWeaponSpriteTexture(weaponName, weaponFrame);
        const prev = weaponSprite.mesh.material as THREE.MeshBasicMaterial;
        prev.dispose();
        weaponSprite.mesh.material = this.createPlayerSpriteMaterial(cachedTex.texture);
        weaponSprite.lastFrameKey = weaponFrameKey;
      }

      let whipPos: { x: number; y: number };
      if (heldItem === ItemKind.EthernetWhip) {
        const idleSize = this.resolveWhipDisplaySize(weaponName, 'idle', player.height);
        const frameSize = this.resolveWhipDisplaySize(weaponName, weaponFrame, player.height);

        weaponSprite.mesh.scale.set(
          frameSize.displayWidth * player.facing,
          frameSize.displayHeight,
          1,
        );
        const idleAnchor = resolveWhipHoldPosition(
          player.x,
          player.y,
          player.facing,
          idleSize.displayWidth,
          idleSize.displayHeight,
        );
        const idleNearCorner = whipNearPlayerCorner(
          idleAnchor.x,
          idleAnchor.y,
          player.facing,
          idleSize.displayWidth,
          idleSize.displayHeight,
        );
        const idleVisibleBottom = whipVisibleBottomY(
          idleAnchor.y,
          idleSize.displayHeight,
          getEthernetWhipBottomInset('idle'),
        );
        whipPos = resolveWhipMeshPosition(
          idleNearCorner.x,
          idleVisibleBottom,
          player.facing,
          frameSize.displayWidth,
          frameSize.displayHeight,
          getEthernetWhipBottomInset(weaponFrame),
        );
      } else if (heldItem === ItemKind.BinaryBeam) {
        const spriteConfig = WEAPON_SPRITE_CONFIG[ItemKind.BinaryBeam];
        const cachedTex = this.getWeaponSpriteTexture(weaponName, BINARY_BEAM_HOLD_FRAME);
        const aspect = this.resolveSpriteAspectRatio(cachedTex);
        const displayHeight = spriteConfig?.pickupDisplayHeight ?? 0.52;
        const displayWidth = displayHeight * aspect;
        weaponSprite.mesh.scale.set(displayWidth * player.facing, displayHeight, 1);
        whipPos = resolveBinaryBeamHoldPosition(
          player.x,
          player.y,
          player.facing,
          displayWidth,
        );
      } else if (heldItem === ItemKind.Finals) {
        const frameSize = this.applyPaperStackMeshScale(weaponSprite.mesh, weaponName);
        weaponSprite.mesh.scale.x = frameSize.displayWidth;
        whipPos = resolvePaperStackHoldPosition(
          player.x,
          player.y,
          player.facing,
          frameSize.displayWidth,
        );
      } else if (heldItem === ItemKind.PenCrossbow) {
        const frameSize = this.applyPenCrossbowMeshScale(weaponSprite.mesh, weaponName);
        weaponSprite.mesh.scale.x = frameSize.displayWidth * player.facing;
        whipPos = resolvePenCrossbowHoldPosition(
          player.x,
          player.y,
          player.facing,
          frameSize.displayWidth,
        );
      } else {
        throw new Error(`Unhandled sprite weapon: ${heldItem}`);
      }

      weaponSprite.mesh.position.set(whipPos.x, whipPos.y, 0.36);

      // Match player opacity during respawn flash
      const playerMesh = this.playerMeshes.get(player.id);
      const playerOpacity = playerMesh
        ? (playerMesh.mesh.material as THREE.MeshBasicMaterial).opacity
        : 1;
      const wMat = weaponSprite.mesh.material as THREE.MeshBasicMaterial;
      wMat.opacity = playerOpacity;
      wMat.transparent = playerOpacity < 1;
      wMat.depthWrite = playerOpacity >= 1;
    }

    // Clean up weapon meshes for players who left
    for (const [id, weaponSprite] of this.weaponSpriteMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(weaponSprite.mesh);
        weaponSprite.mesh.geometry.dispose();
        (weaponSprite.mesh.material as THREE.MeshBasicMaterial).dispose();
        this.weaponSpriteMeshes.delete(id);
      }
    }

    // --- Attacks ---
    const activeAttackIds = new Set(state.attacks.map((attack: RenderState['attacks'][number]) => attack.id));

    for (const attack of state.attacks) {
      const variant = resolvePunchSpriteVariant(attack.characterId);
      const frameKey = `${attack.id}:${variant}`;

      let attackSprite = this.attackMeshes.get(attack.id);
      if (!attackSprite) {
        attackSprite = this.createAttackSpriteMesh();
        this.scene.add(attackSprite.mesh);
        this.attackMeshes.set(attack.id, attackSprite);
      }

      if (attackSprite.lastFrameKey !== frameKey) {
        const cachedTex = this.getWeaponSpriteTexture(PUNCH_WEAPON_NAME, variant);
        const prev = attackSprite.mesh.material as THREE.MeshBasicMaterial;
        prev.dispose();
        attackSprite.mesh.material = this.createPlayerSpriteMaterial(cachedTex.texture);
        attackSprite.lastFrameKey = frameKey;
      }

      const cachedTex = this.getWeaponSpriteTexture(PUNCH_WEAPON_NAME, variant);
      const aspect = this.resolveSpriteAspectRatio(cachedTex);
      const displayHeight = attack.displayHeight * PUNCH_SPRITE_HEIGHT_RATIO;
      const displayWidth = displayHeight * aspect;

      attackSprite.mesh.scale.set(displayWidth * attack.facing, displayHeight, 1);

      const playerId = attack.id.slice(0, -'-attack'.length);
      const player = state.players.find((p) => p.id === playerId);
      const spriteX = player
        ? player.x + attack.facing * (
          this.resolveCharacterVisualHalfWidth(player, state.animTick) + displayWidth * 0.5
        )
        : attack.x;
      attackSprite.mesh.position.set(spriteX, attack.y, 0.5);

      const playerMesh = this.playerMeshes.get(playerId);
      const playerOpacity = playerMesh
        ? (playerMesh.mesh.material as THREE.MeshBasicMaterial).opacity
        : 1;
      const attackMaterial = attackSprite.mesh.material as THREE.MeshBasicMaterial;
      attackMaterial.opacity = playerOpacity;
      attackMaterial.transparent = playerOpacity < 1;
      attackMaterial.depthWrite = playerOpacity >= 1;
    }

    for (const [id, attackSprite] of this.attackMeshes) {
      if (!activeAttackIds.has(id)) {
        this.scene.remove(attackSprite.mesh);
        attackSprite.mesh.geometry.dispose();
        (attackSprite.mesh.material as THREE.MeshBasicMaterial).dispose();
        this.attackMeshes.delete(id);
      }
    }

    // --- Items ---
    const activeItemIds = new Set(state.items.map((item: RenderState['items'][number]) => item.id));

    for (const item of state.items) {
      let mesh = this.itemMeshes.get(item.id);
      if (!mesh) {
        mesh = usesKyleGenericProjectileMesh(item.kind)
          ? K_createDroppedItemMesh(item.kind, this.textureLoader)
          : this.createItemMesh(item.kind);
        this.scene.add(mesh);
        this.itemMeshes.set(item.id, mesh);
      }

      if (item.kind === ItemKind.Finals) {
        const weaponName = WEAPON_SPRITE_NAMES[ItemKind.Finals];
        if (!weaponName) {
          throw new Error('Missing weapon sprite name for Finals');
        }
        const cached = this.getWeaponSpriteTexture(weaponName, PAPER_STACK_HOLD_FRAME);
        const frameSize = this.applyPaperStackMeshScale(mesh, weaponName);
        const material = mesh.material as THREE.MeshBasicMaterial;
        if (material.map !== cached.texture) {
          material.map = cached.texture;
          material.needsUpdate = true;
        }
        material.visible = true;
        mesh.visible = true;
        mesh.userData.itemCenterLift = (
          frameSize.displayHeight * 0.5 - ITEM_GUN_HEIGHT * 0.5 + PAPER_STACK_ITEM_Y_OFFSET
        );
      } else if (item.kind === ItemKind.PenCrossbow) {
        const weaponName = WEAPON_SPRITE_NAMES[ItemKind.PenCrossbow];
        if (!weaponName) {
          throw new Error('Missing weapon sprite name for PenCrossbow');
        }
        const cached = this.getWeaponSpriteTexture(weaponName, PEN_CROSSBOW_HOLD_FRAME);
        const frameSize = this.applyPenCrossbowMeshScale(mesh, weaponName);
        const material = mesh.material as THREE.MeshBasicMaterial;
        if (material.map !== cached.texture) {
          material.map = cached.texture;
          material.needsUpdate = true;
        }
        material.visible = true;
        mesh.visible = true;
        mesh.userData.itemCenterLift = (
          frameSize.displayHeight * 0.5 - ITEM_GUN_HEIGHT * 0.5 + PEN_CROSSBOW_ITEM_Y_OFFSET
        );
      } else if (item.kind === ItemKind.BinaryBeam) {
        const weaponName = WEAPON_SPRITE_NAMES[ItemKind.BinaryBeam];
        const pickupFrame = WEAPON_SPRITE_CONFIG[ItemKind.BinaryBeam]?.pickupFrame ?? BINARY_BEAM_HOLD_FRAME;
        if (!weaponName) {
          throw new Error('Missing weapon sprite name for BinaryBeam');
        }
        const cached = this.getWeaponSpriteTexture(weaponName, pickupFrame);
        const material = mesh.material as THREE.MeshBasicMaterial;
        if (material.map !== cached.texture) {
          material.map = cached.texture;
          material.needsUpdate = true;
        }
        const aspect = this.resolveSpriteAspectRatio(cached);
        const displayHeight = WEAPON_SPRITE_CONFIG[ItemKind.BinaryBeam]?.pickupDisplayHeight ?? 0.52;
        const displayWidth = displayHeight * aspect;
        mesh.scale.set(displayWidth, displayHeight, 1);
        material.visible = true;
        mesh.visible = true;
        mesh.userData.itemCenterLift = displayHeight * 0.5 - ITEM_GUN_HEIGHT * 0.5;
      }

      // Bob gently up and down so items are easy to spot
      const bob = Math.sin(Date.now() / 400) * 0.08;
      const centerLift = (mesh.userData.itemCenterLift as number | undefined) ?? 0;
      mesh.position.set(item.x, item.y + bob + centerLift, 0.35);
    }

    for (const [id, mesh] of this.itemMeshes) {
      if (!activeItemIds.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.itemMeshes.delete(id);
      }
    }

    // --- Bullets ---
    const activeBulletIds = new Set(state.bullets.map((bullet: RenderState['bullets'][number]) => bullet.id));

    for (const bullet of state.bullets) {
      if (usesKyleGenericProjectileMesh(bullet.kind)) {
        let mesh = this.kyleBulletMeshes.get(bullet.id);
        if (!mesh) {
          mesh = K_createProjectileMesh(bullet.kind, this.textureLoader);
          this.scene.add(mesh);
          this.kyleBulletMeshes.set(bullet.id, mesh);
        }
        mesh.position.set(bullet.x, bullet.y, 0.35);
        continue;
      }

      let bulletSprite = this.bulletMeshes.get(bullet.id);
      if (!bulletSprite) {
        bulletSprite = this.createBulletMesh(bullet.kind);
        this.scene.add(bulletSprite.mesh);
        this.bulletMeshes.set(bullet.id, bulletSprite);
      }

      if (bullet.kind === ItemKind.Finals) {
        const weaponName = WEAPON_SPRITE_NAMES[ItemKind.Finals];
        if (!weaponName) {
          throw new Error('Missing weapon sprite name for Finals');
        }
        const frameKey = `${bullet.id}:${PAPER_STACK_PROJECTILE_FRAME}`;
        if (bulletSprite.lastFrameKey !== frameKey) {
          const cachedTex = this.getWeaponSpriteTexture(weaponName, PAPER_STACK_PROJECTILE_FRAME);
          const prev = bulletSprite.mesh.material as THREE.MeshBasicMaterial;
          prev.dispose();
          bulletSprite.mesh.material = this.createPlayerSpriteMaterial(cachedTex.texture);
          bulletSprite.lastFrameKey = frameKey;
        }

        const stackSize = this.resolvePaperStackDisplaySize(weaponName);
        const sheetSize = this.resolvePaperSheetDisplaySize(weaponName, stackSize.displayWidth);
        bulletSprite.mesh.scale.set(
          sheetSize.displayWidth,
          sheetSize.displayHeight,
          1,
        );
        bulletSprite.mesh.rotation.z = 0;
      } else if (bullet.kind === ItemKind.PenCrossbow) {
        const weaponName = WEAPON_SPRITE_NAMES[ItemKind.PenCrossbow];
        if (!weaponName) {
          throw new Error('Missing weapon sprite name for PenCrossbow');
        }
        const frameKey = `${bullet.id}:${PEN_CROSSBOW_PROJECTILE_FRAME}`;
        if (bulletSprite.lastFrameKey !== frameKey) {
          const cachedTex = this.getWeaponSpriteTexture(weaponName, PEN_CROSSBOW_PROJECTILE_FRAME);
          const prev = bulletSprite.mesh.material as THREE.MeshBasicMaterial;
          prev.dispose();
          bulletSprite.mesh.material = this.createPlayerSpriteMaterial(cachedTex.texture);
          bulletSprite.lastFrameKey = frameKey;
        }

        const crossbowSize = this.resolvePenCrossbowDisplaySize(weaponName);
        const boltSize = this.resolvePenCrossbowBoltDisplaySize(weaponName, crossbowSize.displayWidth);
        bulletSprite.mesh.scale.set(
          boltSize.displayWidth * bullet.facing,
          boltSize.displayHeight,
          1,
        );
        bulletSprite.mesh.rotation.z = 0;
      } else if (bullet.kind === ItemKind.BinaryBeam) {
        const weaponName = WEAPON_SPRITE_NAMES[ItemKind.BinaryBeam];
        const projectileFrame = WEAPON_SPRITE_CONFIG[ItemKind.BinaryBeam]?.projectileFrame ?? BINARY_BEAM_PROJECTILE_FRAME;
        if (!weaponName) {
          throw new Error('Missing weapon sprite name for BinaryBeam');
        }
        const frameKey = `${bullet.id}:${projectileFrame}`;
        if (bulletSprite.lastFrameKey !== frameKey) {
          const cachedTex = this.getWeaponSpriteTexture(weaponName, projectileFrame);
          const prev = bulletSprite.mesh.material as THREE.MeshBasicMaterial;
          prev.dispose();
          bulletSprite.mesh.material = this.createPlayerSpriteMaterial(cachedTex.texture);
          bulletSprite.lastFrameKey = frameKey;
        }

        const spriteConfig = WEAPON_SPRITE_CONFIG[ItemKind.BinaryBeam];
        const aspect = this.resolveSpriteAspectRatio(this.getWeaponSpriteTexture(weaponName, projectileFrame));
        const scaleXMult = spriteConfig?.projectileScaleX ?? 1;
        const scaleYMult = spriteConfig?.projectileScaleY ?? 1;
        const displayHeight = 0.35;
        const displayWidth = displayHeight * aspect;
        bulletSprite.mesh.scale.set(displayWidth * scaleXMult * bullet.facing, displayHeight * scaleYMult, 1);
        bulletSprite.mesh.rotation.z = 0;
      }

      bulletSprite.mesh.position.set(bullet.x, bullet.y, 0.35);
    }

    for (const [id, bulletSprite] of this.bulletMeshes) {
      if (!activeBulletIds.has(id)) {
        this.scene.remove(bulletSprite.mesh);
        bulletSprite.mesh.geometry.dispose();
        (bulletSprite.mesh.material as THREE.Material).dispose();
        this.bulletMeshes.delete(id);
      }
    }

    for (const [id, mesh] of this.kyleBulletMeshes) {
      if (!activeBulletIds.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.kyleBulletMeshes.delete(id);
      }
    }

    this.updateCamera(state, localPlayerId);
    this.renderer.render(this.scene, this.camera);
  }

  setCameraMode(mode: CameraMode): void {
    if (this.cameraMode === mode) {
      return;
    }

    this.cameraMode = mode;
    if (mode === 'free') {
      this.freeCameraTarget.set(this.camera.position.x, this.camera.position.y);
      this.freeCameraZoom = this.camera.zoom;
    }
  }

  lockCamera(): void {
    if (!this.cameraLockTarget) {
      this.cameraLockTarget = new THREE.Vector2();
    }

    this.cameraLockTarget.set(this.camera.position.x, this.camera.position.y);
  }

  unlockCamera(): void {
    this.cameraLockTarget = null;
  }

  panFreeCamera(deltaX: number, deltaY: number): void {
    if (this.cameraMode !== 'free') {
      return;
    }

    this.freeCameraTarget.x += deltaX;
    this.freeCameraTarget.y += deltaY;
    this.clampFreeCameraTarget();
  }

  zoomFreeCamera(delta: number): void {
    if (this.cameraMode !== 'free') {
      return;
    }

    this.freeCameraZoom = THREE.MathUtils.clamp(this.freeCameraZoom + delta, 0.4, 3);
  }

  dispose(): void {
    this.resizeObserver.disconnect();

    for (const [, playerSprite] of this.playerMeshes) {
      this.scene.remove(playerSprite.mesh);
      playerSprite.mesh.geometry.dispose();
      (playerSprite.mesh.material as THREE.MeshBasicMaterial).dispose();
    }
    this.playerMeshes.clear();

    for (const [, weaponSprite] of this.weaponSpriteMeshes) {
      this.scene.remove(weaponSprite.mesh);
      weaponSprite.mesh.geometry.dispose();
      (weaponSprite.mesh.material as THREE.MeshBasicMaterial).dispose();
    }
    this.weaponSpriteMeshes.clear();

    this.scene.remove(this.backdropMesh);
    this.backdropMesh.geometry.dispose();
    (this.backdropMesh.material as THREE.MeshBasicMaterial).dispose();

    for (const mesh of this.mapMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.MeshBasicMaterial).dispose();
    }
    this.mapMeshes.length = 0;

    for (const cachedMaterial of this.materialCache.values()) {
      cachedMaterial.material.dispose();
      cachedMaterial.texture.dispose();
    }
    this.materialCache.clear();

    for (const cachedSprite of this.spriteTextureCache.values()) {
      cachedSprite.texture.dispose();
    }
    this.spriteTextureCache.clear();

    for (const [, attackSprite] of this.attackMeshes) {
      this.scene.remove(attackSprite.mesh);
      attackSprite.mesh.geometry.dispose();
      (attackSprite.mesh.material as THREE.MeshBasicMaterial).dispose();
    }
    this.attackMeshes.clear();

    for (const [, mesh] of this.itemMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.itemMeshes.clear();

    for (const [, bulletSprite] of this.bulletMeshes) {
      this.scene.remove(bulletSprite.mesh);
      bulletSprite.mesh.geometry.dispose();
      (bulletSprite.mesh.material as THREE.Material).dispose();
    }
    this.bulletMeshes.clear();

    for (const [, mesh] of this.kyleBulletMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.kyleBulletMeshes.clear();

    for (const [, mesh] of this.weaponMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.MeshStandardMaterial).dispose();
    }
    this.weaponMeshes.clear();

    for (const [, laser] of this.laserSightMeshes) {
      this.scene.remove(laser);
      laser.geometry.dispose();
      (laser.material as THREE.Material).dispose();
    }
    this.laserSightMeshes.clear();

    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  private setupLighting(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xfff0d8, 0.8);
    keyLight.position.set(8, 12, 10);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x9ad7ff, 0.45);
    fillLight.position.set(-10, 8, 6);
    this.scene.add(fillLight);
  }

  private setupBackdrop(map: TiledMapDefinition): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(map.bounds.width + 12, map.bounds.height + 12);
    const material = new THREE.MeshBasicMaterial({ color: 0x131924 });
    const backdrop = new THREE.Mesh(geometry, material);
    backdrop.position.set(0, 0, -2);
    this.scene.add(backdrop);
    return backdrop;
  }

  private setupMapMeshes(map: TiledMapDefinition): void {
    for (const layer of map.layers) {
      if (!layer.renderVisible) {
        continue;
      }

      for (const tile of layer.tiles) {
        if (!tile.renderVisible) {
          continue;
        }

        const mesh = new THREE.Mesh(this.createTileGeometry(tile.uv), this.getTileMaterial(tile));
        mesh.position.set(tile.x, tile.y, tile.z);
        mesh.renderOrder = tile.layerIndex;
        this.scene.add(mesh);
        this.mapMeshes.push(mesh);
      }
    }
  }

  private createTileGeometry(uv: UvRect): THREE.PlaneGeometry {
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(
        [uv.u0, uv.v1, uv.u1, uv.v1, uv.u0, uv.v0, uv.u1, uv.v0],
        2,
      ),
    );
    return geometry;
  }

  private getTileMaterial(tile: MapTileInstance): THREE.MeshBasicMaterial {
    const tintColor = tile.tintColor ?? 0xffffff;
    const spriteAlphaTest = 0.1;
    const cacheKey = `${tile.atlasUrl}|${tintColor}|${tile.opacity}`;
    const cachedMaterial = this.materialCache.get(cacheKey);
    if (cachedMaterial) {
      return cachedMaterial.material;
    }

    const texture = this.textureLoader.load(tile.atlasUrl);
    this.configurePixelTexture(texture);

    const isOpaque = tile.opacity >= 1;

    const material = new THREE.MeshBasicMaterial({
      alphaTest: spriteAlphaTest,
      color: tintColor,
      map: texture,
      opacity: tile.opacity,
      depthWrite: isOpaque,
      side: THREE.DoubleSide,
      transparent: !isOpaque,
    });

    this.materialCache.set(cacheKey, { material, texture });
    return material;
  }

  private configurePixelTexture(texture: THREE.Texture): void {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    texture.onUpdate = () => {
      const webglTexture = this.getWebGLTexture(texture);
      if (!webglTexture) {
        return;
      }

      const gl = this.renderer.getContext();
      gl.bindTexture(gl.TEXTURE_2D, webglTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
    };
  }

  private getWebGLTexture(texture: THREE.Texture): WebGLTexture | null {
    const rendererWithInternals = this.renderer as unknown as {
      properties?: {
        get(value: THREE.Texture): { __webglTexture?: WebGLTexture } | undefined;
      };
    };

    return rendererWithInternals.properties?.get(texture)?.__webglTexture ?? null;
  }

  private updateCamera(state: RenderState, localPlayerId: string): void {
    const target = this.getCameraTarget(state, localPlayerId);
    const targetZoom = this.getTargetZoom(state);

    const zoomLerp = this.cameraMode === 'action' ? 0.12 : 0.16;

    if (this.cameraMode === 'follow') {
      this.camera.position.x = target.x;
      this.camera.position.y = target.y;
    } else {
      const followLerp = this.cameraMode === 'action' ? 0.22 : 0.28;
      this.camera.position.x = THREE.MathUtils.lerp(
        this.camera.position.x,
        target.x,
        followLerp,
      );
      this.camera.position.y = THREE.MathUtils.lerp(
        this.camera.position.y,
        target.y,
        followLerp,
      );
    }
    this.camera.position.z = 12;
    this.camera.zoom = THREE.MathUtils.lerp(this.camera.zoom, targetZoom, zoomLerp);
    if (this.cameraMode === 'free') {
      this.snapCameraToPixelGrid();
    }
    this.camera.updateProjectionMatrix();
  }

  private getCameraTarget(state: RenderState, localPlayerId: string): THREE.Vector2 {
    if (this.cameraLockTarget) {
      return this.cameraTarget.set(this.cameraLockTarget.x, this.cameraLockTarget.y);
    }

    if (this.cameraMode === 'free') {
      return this.cameraTarget.set(this.freeCameraTarget.x, this.freeCameraTarget.y);
    }

    if (state.players.length === 0) {
      return this.cameraTarget.set(0, 0);
    }

    if (this.cameraMode === 'follow') {
      const localPlayer = state.players.find(
        (player: RenderState['players'][number]) => player.id === localPlayerId,
      );
      if (localPlayer) {
        return this.cameraTarget.set(localPlayer.x, localPlayer.y);
      }
    }

    const bounds = this.getPlayerBounds(state.players);
    if (!bounds) {
      return this.cameraTarget.set(0, 0);
    }

    return this.cameraTarget.set(bounds.centerX, bounds.centerY);
  }

  private getTargetZoom(state: RenderState): number {
    if (this.cameraMode === 'free') {
      return this.freeCameraZoom;
    }

    if (this.cameraMode !== 'action') {
      return 1;
    }

    const bounds = this.getPlayerBounds(state.players);
    if (!bounds) {
      return 1;
    }

    const fitWidth = Math.max(bounds.width + CAMERA_MARGIN * 2, 6);
    const fitHeight = Math.max(bounds.height + CAMERA_MARGIN * 2, 4);
    const zoom = Math.min(
      this.baseViewWidth / fitWidth,
      this.baseViewHeight / fitHeight,
    );

    if (!Number.isFinite(zoom) || zoom <= 0) {
      return 1;
    }

    return THREE.MathUtils.clamp(zoom, 0.75, 2.5);
  }

  private getPlayerBounds(
    players: RenderState['players'],
  ): { centerX: number; centerY: number; height: number; width: number } | null {
    if (players.length === 0) {
      return null;
    }

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const player of players) {
      minX = Math.min(minX, player.x - player.width * 0.5);
      maxX = Math.max(maxX, player.x + player.width * 0.5);
      minY = Math.min(minY, player.y - player.height * 0.5);
      maxY = Math.max(maxY, player.y + player.height * 0.5);
    }

    return {
      centerX: (minX + maxX) * 0.5,
      centerY: (minY + maxY) * 0.5,
      height: maxY - minY,
      width: maxX - minX,
    };
  }

  private clampFreeCameraTarget(): void {
    const minX = this.mapBounds.minX;
    const maxX = this.mapBounds.maxX;
    const minY = this.mapBounds.minY;
    const maxY = this.mapBounds.maxY;

    this.freeCameraTarget.x = Math.min(Math.max(this.freeCameraTarget.x, minX), maxX);
    this.freeCameraTarget.y = Math.min(Math.max(this.freeCameraTarget.y, minY), maxY);
  }

  private computeBaseViewHeight(mapHeight: number): number {
    return Math.min(Math.max(mapHeight * 0.65, 8), 10);
  }

  private snapCameraToPixelGrid(): void {
    const canvasWidth = this.renderer.domElement.width;
    const canvasHeight = this.renderer.domElement.height;

    if (canvasWidth === 0 || canvasHeight === 0) {
      return;
    }

    const visibleWidth = (this.camera.right - this.camera.left) / this.camera.zoom;
    const visibleHeight = (this.camera.top - this.camera.bottom) / this.camera.zoom;
    const worldUnitsPerPixelX = visibleWidth / canvasWidth;
    const worldUnitsPerPixelY = visibleHeight / canvasHeight;

    if (worldUnitsPerPixelX > 0) {
      this.camera.position.x =
        Math.round(this.camera.position.x / worldUnitsPerPixelX) * worldUnitsPerPixelX;
    }

    if (worldUnitsPerPixelY > 0) {
      this.camera.position.y =
        Math.round(this.camera.position.y / worldUnitsPerPixelY) * worldUnitsPerPixelY;
    }
  }

  private createPlayerSpriteMesh(): PlayerSpriteMesh {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      visible: false,
      toneMapped: false,
    });
    return {
      mesh: new THREE.Mesh(geometry, material),
      lastFrameKey: '',
    };
  }

  private createWeaponSpriteMesh(): WeaponSpriteMesh {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      alphaTest: 0.1,
      transparent: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    return {
      mesh: new THREE.Mesh(geometry, material),
      lastFrameKey: '',
    };
  }

  private createPlayerSpriteMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      alphaTest: 0.1,
      color: 0xffffff,
      depthWrite: true,
      map: texture,
      side: THREE.DoubleSide,
      toneMapped: false,
      transparent: false,
    });
  }

  private getCachedSpriteTexture(
    characterId: RenderState['players'][number]['characterId'],
    frame: string,
  ): CachedSpriteTexture {
    const cacheKey = `${characterId}:${frame}`;
    const cached = this.spriteTextureCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const texture = this.textureLoader.load(getCharacterSpriteUrl(characterId, frame));
    this.configurePixelTexture(texture);

    const entry = this.createCachedSpriteTexture(texture);
    this.spriteTextureCache.set(cacheKey, entry);
    return entry;
  }

  private getWeaponSpriteTexture(weaponName: string, frame: string): CachedSpriteTexture {
    const cacheKey = `weapon:${weaponName}:${frame}`;
    const cached = this.spriteTextureCache.get(cacheKey);
    if (cached) return cached;

    const texture = this.textureLoader.load(getWeaponSpriteUrl(weaponName, frame));
    this.configurePixelTexture(texture);

    const entry = this.createCachedSpriteTexture(texture);
    this.spriteTextureCache.set(cacheKey, entry);
    return entry;
  }

  /**
   * Sizes paper_stack from PNG pixels using character sprite pixel-to-world mapping.
   * Height keeps native aspect; width is scaled down so the stack is not overly wide.
   */
  private resolvePaperStackDisplaySize(
    _weaponName: string,
  ): { displayWidth: number; displayHeight: number } {
    const worldPerPixel = (
      (PLAYER_HALF_HEIGHT * 2) / CHARACTER_SPRITE_PIXEL_HEIGHT
    ) * PAPER_STACK_UNIFORM_SCALE;
    return {
      displayWidth: PAPER_STACK_TEXTURE_PIXELS.width * worldPerPixel * PAPER_STACK_WIDTH_SCALE,
      displayHeight: PAPER_STACK_TEXTURE_PIXELS.height * worldPerPixel,
    };
  }

  private applyPaperStackMeshScale(
    mesh: THREE.Mesh,
    weaponName: string,
  ): { displayWidth: number; displayHeight: number } {
    const frameSize = this.resolvePaperStackDisplaySize(weaponName);
    mesh.scale.set(frameSize.displayWidth, frameSize.displayHeight, 1);
    return frameSize;
  }

  /** Projectile sized from paper_stack width, paper_sheet aspect, then uniform scale. */
  private resolvePaperSheetDisplaySize(
    weaponName: string,
    stackDisplayWidth: number,
  ): { displayWidth: number; displayHeight: number } {
    const cached = this.getWeaponSpriteTexture(weaponName, PAPER_STACK_PROJECTILE_FRAME);
    const aspect = this.resolveSpriteAspectRatio(cached);
    const displayWidth = stackDisplayWidth * PAPER_SHEET_SCALE;
    const displayHeight = aspect > 0 ? displayWidth / aspect : displayWidth;
    return { displayWidth, displayHeight };
  }

  private resolvePenCrossbowDisplaySize(
    _weaponName: string,
  ): { displayWidth: number; displayHeight: number } {
    const worldPerPixel = (
      (PLAYER_HALF_HEIGHT * 2) / CHARACTER_SPRITE_PIXEL_HEIGHT
    ) * PEN_CROSSBOW_UNIFORM_SCALE;
    return {
      displayWidth: PEN_CROSSBOW_TEXTURE_PIXELS.width * worldPerPixel * PEN_CROSSBOW_WIDTH_SCALE,
      displayHeight: PEN_CROSSBOW_TEXTURE_PIXELS.height * worldPerPixel,
    };
  }

  private applyPenCrossbowMeshScale(
    mesh: THREE.Mesh,
    weaponName: string,
  ): { displayWidth: number; displayHeight: number } {
    const frameSize = this.resolvePenCrossbowDisplaySize(weaponName);
    mesh.scale.set(frameSize.displayWidth, frameSize.displayHeight, 1);
    return frameSize;
  }

  /** Projectile sized from crossbow width, bolt aspect, then uniform scale. */
  private resolvePenCrossbowBoltDisplaySize(
    weaponName: string,
    crossbowDisplayWidth: number,
  ): { displayWidth: number; displayHeight: number } {
    const cached = this.getWeaponSpriteTexture(weaponName, PEN_CROSSBOW_PROJECTILE_FRAME);
    const aspect = this.resolveSpriteAspectRatio(cached);
    const displayWidth = crossbowDisplayWidth * PEN_CROSSBOW_BOLT_SCALE;
    const displayHeight = aspect > 0 ? displayWidth / aspect : displayWidth;
    return { displayWidth, displayHeight };
  }

  /** Idle-sized in world units; attack frames scale by source pixel size vs idle. */
  private resolveWhipDisplaySize(
    weaponName: string,
    frame: string,
    playerHeight: number,
  ): { displayWidth: number; displayHeight: number } {
    const idleCached = this.getWeaponSpriteTexture(weaponName, 'idle');
    const frameCached = this.getWeaponSpriteTexture(weaponName, frame);
    const idlePixelHeight = idleCached.pixelHeight > 0
      ? idleCached.pixelHeight
      : this.readTexturePixelSize(idleCached.texture).height;
    const framePixelHeight = frameCached.pixelHeight > 0
      ? frameCached.pixelHeight
      : this.readTexturePixelSize(frameCached.texture).height;
    const pixelScale = idlePixelHeight > 0 && framePixelHeight > 0
      ? framePixelHeight / idlePixelHeight
      : 1;
    const displayHeight = playerHeight * pixelScale;
    const aspect = this.resolveSpriteAspectRatio(frameCached);
    return { displayWidth: displayHeight * aspect, displayHeight };
  }

  private createCachedSpriteTexture(texture: THREE.Texture): CachedSpriteTexture {
    const { width, height } = this.readTexturePixelSize(texture);
    return {
      texture,
      aspectRatio: width > 0 && height > 0 ? width / height : 0,
      pixelWidth: width,
      pixelHeight: height,
    };
  }

  private readTexturePixelSize(texture: THREE.Texture): { width: number; height: number } {
    const image = texture.image as { width?: number; height?: number } | undefined;
    return {
      width: image?.width ?? 0,
      height: image?.height ?? 0,
    };
  }

  private resolveSpriteAspectRatio(cached: CachedSpriteTexture): number {
    if (cached.aspectRatio > 0) {
      return cached.aspectRatio;
    }

    cached.aspectRatio = this.readTextureAspectRatio(cached.texture);
    return cached.aspectRatio > 0 ? cached.aspectRatio : 1;
  }

  private resolveCharacterVisualHalfWidth(
    player: RenderState['players'][number],
    animTick: number,
  ): number {
    const frame = resolveCharacterFrame(
      player.facing,
      player.heldItem,
      player.vx,
      animTick,
    );
    const cached = this.getCachedSpriteTexture(player.characterId, frame);
    const aspect = this.resolveSpriteAspectRatio(cached);
    return (player.height * aspect) * 0.5;
  }

  private readTextureAspectRatio(texture: THREE.Texture): number {
    const { width, height } = this.readTexturePixelSize(texture);
    if (width > 0 && height > 0) {
      return width / height;
    }
    return 0;
  }

  private createAttackSpriteMesh(): AttackSpriteMesh {
    return this.createWeaponSpriteMesh();
  }

  private createItemMesh(kind: ItemKind): THREE.Mesh {
    if (kind === ItemKind.EthernetWhip) {
      const weaponName = WEAPON_SPRITE_NAMES[ItemKind.EthernetWhip];
      if (!weaponName) {
        throw new Error('Missing weapon sprite name for EthernetWhip');
      }
      const cached = this.getWeaponSpriteTexture(weaponName, 'idle');
      const { displayWidth, displayHeight } = this.resolveWhipDisplaySize(
        weaponName,
        'idle',
        PLAYER_HALF_HEIGHT * 2,
      );
      const sprite = this.createWeaponSpriteMesh();
      sprite.mesh.material = this.createPlayerSpriteMaterial(cached.texture);
      sprite.mesh.scale.set(displayWidth, displayHeight, 1);
      const bottomInset = getEthernetWhipBottomInset('idle');
      // Keep idle art size; lift clears floor, then lower toward the ground.
      sprite.mesh.userData.itemCenterLift = (
        displayHeight * (0.5 - bottomInset) - ITEM_GUN_HEIGHT * 0.5 + WHIP_ITEM_Y_OFFSET
      );
      return sprite.mesh;
    }

    if (kind === ItemKind.Finals) {
      const weaponName = WEAPON_SPRITE_NAMES[ItemKind.Finals];
      if (!weaponName) {
        throw new Error('Missing weapon sprite name for Finals');
      }
      const cached = this.getWeaponSpriteTexture(weaponName, PAPER_STACK_HOLD_FRAME);
      const sprite = this.createWeaponSpriteMesh();
      sprite.mesh.material = this.createPlayerSpriteMaterial(cached.texture);
      const frameSize = this.applyPaperStackMeshScale(sprite.mesh, weaponName);
      sprite.mesh.userData.itemCenterLift = (
        frameSize.displayHeight * 0.5 - ITEM_GUN_HEIGHT * 0.5 + PAPER_STACK_ITEM_Y_OFFSET
      );
      return sprite.mesh;
    }

    if (kind === ItemKind.PenCrossbow) {
      const weaponName = WEAPON_SPRITE_NAMES[ItemKind.PenCrossbow];
      if (!weaponName) {
        throw new Error('Missing weapon sprite name for PenCrossbow');
      }
      const cached = this.getWeaponSpriteTexture(weaponName, PEN_CROSSBOW_HOLD_FRAME);
      const sprite = this.createWeaponSpriteMesh();
      sprite.mesh.material = this.createPlayerSpriteMaterial(cached.texture);
      const frameSize = this.applyPenCrossbowMeshScale(sprite.mesh, weaponName);
      sprite.mesh.userData.itemCenterLift = (
        frameSize.displayHeight * 0.5 - ITEM_GUN_HEIGHT * 0.5 + PEN_CROSSBOW_ITEM_Y_OFFSET
      );
      return sprite.mesh;
    }

    if (kind === ItemKind.BinaryBeam) {
      const weaponName = WEAPON_SPRITE_NAMES[ItemKind.BinaryBeam];
      const pickupFrame = WEAPON_SPRITE_CONFIG[ItemKind.BinaryBeam]?.pickupFrame ?? 'gpu';
      if (!weaponName) {
        throw new Error('Missing weapon sprite name for BinaryBeam');
      }
      const cached = this.getWeaponSpriteTexture(weaponName, pickupFrame);
      const sprite = this.createWeaponSpriteMesh();
      sprite.mesh.material = this.createPlayerSpriteMaterial(cached.texture);
      const aspect = this.resolveSpriteAspectRatio(cached);
      const displayHeight = WEAPON_SPRITE_CONFIG[ItemKind.BinaryBeam]?.pickupDisplayHeight ?? 0.52;
      const displayWidth = displayHeight * aspect;
      sprite.mesh.scale.set(displayWidth, displayHeight, 1);
      sprite.mesh.userData.itemCenterLift = displayHeight * 0.5 - ITEM_GUN_HEIGHT * 0.5;
      return sprite.mesh;
    }

    const geometry = new THREE.BoxGeometry(ITEM_GUN_WIDTH, ITEM_GUN_HEIGHT, ITEM_GUN_DEPTH);
    const material = new THREE.MeshStandardMaterial({
      color: GUN_COLOR,
      roughness: 0.3,
      metalness: 0.7,
      emissive: new THREE.Color(GUN_COLOR),
      emissiveIntensity: 0.15,
    });
    return new THREE.Mesh(geometry, material);
  }

  private createBulletMesh(kind: ItemKind): BulletSpriteMesh {
    if (kind === ItemKind.Finals) {
      const weaponName = WEAPON_SPRITE_NAMES[ItemKind.Finals];
      if (!weaponName) {
        throw new Error('Missing weapon sprite name for Finals');
      }
      const cached = this.getWeaponSpriteTexture(weaponName, PAPER_STACK_PROJECTILE_FRAME);
      const sprite = this.createWeaponSpriteMesh();
      sprite.mesh.material = this.createPlayerSpriteMaterial(cached.texture);
      return {
        mesh: sprite.mesh,
        lastFrameKey: `${PAPER_STACK_PROJECTILE_FRAME}`,
        kind: ItemKind.Finals,
      };
    }

    if (kind === ItemKind.PenCrossbow) {
      const weaponName = WEAPON_SPRITE_NAMES[ItemKind.PenCrossbow];
      if (!weaponName) {
        throw new Error('Missing weapon sprite name for PenCrossbow');
      }
      const cached = this.getWeaponSpriteTexture(weaponName, PEN_CROSSBOW_PROJECTILE_FRAME);
      const sprite = this.createWeaponSpriteMesh();
      sprite.mesh.material = this.createPlayerSpriteMaterial(cached.texture);
      const crossbowSize = this.resolvePenCrossbowDisplaySize(weaponName);
      const boltSize = this.resolvePenCrossbowBoltDisplaySize(weaponName, crossbowSize.displayWidth);
      sprite.mesh.scale.set(boltSize.displayWidth, boltSize.displayHeight, 1);
      return {
        mesh: sprite.mesh,
        lastFrameKey: `${PEN_CROSSBOW_PROJECTILE_FRAME}`,
        kind: ItemKind.PenCrossbow,
      };
    }

    if (kind === ItemKind.BinaryBeam) {
      const weaponName = WEAPON_SPRITE_NAMES[ItemKind.BinaryBeam];
      const projectileFrame = WEAPON_SPRITE_CONFIG[ItemKind.BinaryBeam]?.projectileFrame ?? 'beam';
      if (!weaponName) {
        throw new Error('Missing weapon sprite name for BinaryBeam');
      }
      const cached = this.getWeaponSpriteTexture(weaponName, projectileFrame);
      const sprite = this.createWeaponSpriteMesh();
      sprite.mesh.material = this.createPlayerSpriteMaterial(cached.texture);
      return {
        mesh: sprite.mesh,
        lastFrameKey: projectileFrame,
        kind: ItemKind.BinaryBeam,
      };
    }

    const geometry = new THREE.BoxGeometry(BULLET_W, BULLET_H, BULLET_D);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffe066,
      roughness: 0.2,
      metalness: 0.5,
      emissive: new THREE.Color(0xffe066),
      emissiveIntensity: 0.6,
    });
    return {
      mesh: new THREE.Mesh(geometry, material),
      lastFrameKey: '',
      kind: ItemKind.Gun,
    };
  }

  requestResize(): void {
    this.resize();
  }

  private resize(): void {
    const width  = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;

    const aspect = width / height;
    const viewHeight = this.baseViewHeight;
    const viewWidth = viewHeight * aspect;
    this.baseViewWidth = viewWidth;

    this.camera.left = -viewWidth * 0.5;
    this.camera.right = viewWidth * 0.5;
    this.camera.top = viewHeight * 0.5;
    this.camera.bottom = -viewHeight * 0.5;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
  }
}