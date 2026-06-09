import * as THREE from 'three';
import type { VFXAssetCache } from './vfx/assetCache';
import { VFXMeshPool, VFXMeshInstance } from './vfx/vfxMesh';
import { RING_OUT_PACK } from './vfx/packs';
import { DustParticleSystem } from './vfx/DustParticleSystem';
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
import {
  type CharacterId,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  RESPAWN_FLASH_TICKS,
  SHIELD_MAX_HP,
  DUST_SCUFF_MIN_SPEED,
  DUST_SCUFF_EMIT_INTERVAL_TICKS,
} from './constants';
import {
  K_createDroppedItemMesh,
  K_createProjectileMesh,
  K_createWeaponMesh,
  K_renderLaserSight,
} from './kyleWeapons';
import { GUN_COLOR, ItemKind, WEAPON_DEFINITIONS, WEAPON_SPRITE_CONFIG } from './items';
import type { RenderState } from './RollbackPhysicsGame';
import type { MapTileInstance, TiledMapDefinition, UvRect } from './tiledMap';
import {
  classifyBackgroundAsset,
  getMapBackground,
  resolveBackgroundUrl,
  type MapBackgroundConfig,
} from './mapBackgrounds';

interface ParallaxBackground {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  texture: THREE.Texture;
  video?: HTMLVideoElement;
  config: MapBackgroundConfig;
}


const CAMERA_MARGIN = 3.0;
// Fraction of viewport width the lobby stage preview should occupy.
const LOBBY_PREVIEW_WIDTH_FRACTION = 1 / 3;
// Distance (as fraction of viewport width) to shift the camera so the map
// appears centered in the right third of the viewport. The middle of the right
// third sits at 5/6 across, i.e. +1/3 from screen center.
const LOBBY_PREVIEW_OFFSET_FRACTION = 1 / 3;

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

// Constant world-space ring thickness regardless of shield size.
const SHIELD_RIM_WORLD_WIDTH = 0.07;

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
  private parallaxBackground: ParallaxBackground | null = null;
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
  private readonly vfxCache: VFXAssetCache;
  private vfxRingOutPool: VFXMeshPool | null = null;
  private readonly playerVFX = new Map<string, VFXMeshInstance>();
  private readonly prevRespawning = new Map<string, boolean>();
  private readonly prevEliminated = new Map<string, boolean>();
  private readonly prevVelocity = new Map<string, { vx: number; vy: number }>();
  private dust: DustParticleSystem | null = null;
  private readonly prevGrounded = new Map<string, boolean>();
  private readonly prevScuffEmitTick = new Map<string, number>();
  private readonly shieldMeshes = new Map<string, { fill: THREE.Mesh; rim: THREE.Mesh }>();
  private readonly localIndicatorMeshes = new Map<string, THREE.Mesh>();
  private localIndicatorGeometry: THREE.BufferGeometry | null = null;

  // Reused per-frame scratch sets to avoid allocating fresh Set objects on
  // every render() — runs at 60+ Hz so the GC pressure adds up.
  private readonly activePlayerIdsScratch = new Set<string>();
  private readonly activeAttackIdsScratch = new Set<string>();
  private readonly activeItemIdsScratch = new Set<number>();
  private readonly activeBulletIdsScratch = new Set<number>();
  private cameraLockTarget: THREE.Vector2 | null = null;
  private countdownCameraTargetId: string | null = null;
  private lobbyPreviewMode = false;
  private readonly resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, map: TiledMapDefinition, vfxCache: VFXAssetCache) {
    this.container = container;
    this.mapBounds = map.bounds;
    this.baseViewHeight = this.computeBaseViewHeight(map.bounds.height);
    this.vfxCache = vfxCache;

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

    // Ring-out atlases are registered permanent at app boot in MultiplayerApp;
    // here we wait for the resolved asset, then stand up a pool of 3 meshes.
    this.dust = new DustParticleSystem(this.scene);

    void this.vfxCache.registerPermanent(RING_OUT_PACK).then((asset) => {
      // 16 world units tall ≈ the dramatic scale the previous random formula
      // averaged to. Now deterministic.
      const RING_OUT_WORLD_HEIGHT = PLAYER_HALF_HEIGHT * 2 * (Math.random() * 4 + 10);
      this.vfxRingOutPool = new VFXMeshPool(asset, 3, RING_OUT_WORLD_HEIGHT);
    });
  }

  render(
    state: RenderState,
    localPlayerId: string,
    vfxDeltaSeconds = 0,
    secondaryLocalPlayerId: string | null = null,
  ): void {
    // --- Players ---
    const activeIds = this.activePlayerIdsScratch;
    activeIds.clear();
    for (const player of state.players) {
      activeIds.add(player.id);
    }

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
      if (playerSprite.lastFrameKey !== frameKey && cachedSprite.texture.image) {
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

      if (player.eliminated) {
        material.opacity = 0;
      } else if (player.respawning) {
        material.opacity = 0;
      } else if (player.respawnFlashTicksRemaining > 0) {
        const flashStep = Math.max(1, Math.floor(RESPAWN_FLASH_TICKS / 24));
        const flashVisible = Math.floor(player.respawnFlashTicksRemaining / flashStep) % 2 === 0;
        material.opacity = flashVisible ? 1 : 0.22;
      } else {
        material.opacity = 1;
      }

      const isTransparent = material.opacity < 1;
      material.transparent = isTransparent;
      material.depthWrite = !isTransparent;

      // --- Local-player indicator triangle (only shown above the client's own character) ---
      const isLocalPlayer =
        player.id === localPlayerId || player.id === secondaryLocalPlayerId;
      if (isLocalPlayer && !player.eliminated && !player.respawning) {
        const existing = this.localIndicatorMeshes.get(player.id);
        const indicator = existing ?? this.createLocalIndicatorMesh(player.color);
        if (!existing) {
          this.scene.add(indicator);
          this.localIndicatorMeshes.set(player.id, indicator);
        }
        const indicatorMat = indicator.material as THREE.MeshBasicMaterial;
        if (indicatorMat.color.getHex() !== player.color) {
          indicatorMat.color.setHex(player.color);
        }
        const bob = Math.sin(state.animTick * 0.15) * 0.08;
        indicator.position.set(
          player.x,
          player.y + PLAYER_HALF_HEIGHT + 0.3 + bob,
          0.4,
        );
        indicator.visible = true;
      } else {
        const stale = this.localIndicatorMeshes.get(player.id);
        if (stale) {
          stale.visible = false;
        }
      }
    }

    for (const [id, indicator] of this.localIndicatorMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(indicator);
        (indicator.material as THREE.MeshBasicMaterial).dispose();
        this.localIndicatorMeshes.delete(id);
      }
    }

    // --- Shield bubbles ---
    for (const player of state.players) {
      let sg = this.shieldMeshes.get(player.id);
      if (!sg) {
        const fillGeo = new THREE.CircleGeometry(1, 48);
        const fillMat = new THREE.MeshBasicMaterial({
          color: player.color,
          transparent: true,
          opacity: 0.50,
          depthWrite: false,
          toneMapped: false,
          side: THREE.DoubleSide,
        });
        const rimGeo = new THREE.RingGeometry(1.00, 1.08, 48);
        const rimMat = new THREE.MeshBasicMaterial({
          color: 0xFFFFFF, //new THREE.Color(player.color).lerp(_SHIELD_RIM_WHITE, SHIELD_RIM_LERP_T)
          transparent: true,
          opacity: 1,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
          side: THREE.DoubleSide,
        });
        sg = { fill: new THREE.Mesh(fillGeo, fillMat), rim: new THREE.Mesh(rimGeo, rimMat) };
        this.scene.add(sg.fill);
        this.scene.add(sg.rim);
        this.shieldMeshes.set(player.id, sg);
      }

      const showShield = player.shieldActive && !player.eliminated && !player.respawning;
      sg.fill.visible = showShield;
      sg.rim.visible = showShield;
      if (showShield) {
        const hpFraction = Math.max(0, player.shieldHp / SHIELD_MAX_HP);
        const radius = PLAYER_HALF_HEIGHT * (0.10 + 1.10 * hpFraction);
        sg.fill.position.set(player.x, player.y, 0.4);
        sg.fill.scale.set(radius, radius, 1);
        // Rebuild rim with constant world-space thickness so it doesn't thin out as shield shrinks.
        sg.rim.geometry.dispose();
        sg.rim.geometry = new THREE.RingGeometry(
          Math.max(0.01, radius - SHIELD_RIM_WORLD_WIDTH / 2),
          radius + SHIELD_RIM_WORLD_WIDTH / 2,
          48,
        );
        sg.rim.position.set(player.x, player.y, 0.42);
        sg.rim.scale.set(1, 1, 1);
        (sg.fill.material as THREE.MeshBasicMaterial).color.setHex(player.color);
      }
    }
    for (const [id, sg] of this.shieldMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(sg.fill);
        this.scene.remove(sg.rim);
        sg.fill.geometry.dispose();
        sg.rim.geometry.dispose();
        (sg.fill.material as THREE.MeshBasicMaterial).dispose();
        (sg.rim.material as THREE.MeshBasicMaterial).dispose();
        this.shieldMeshes.delete(id);
      }
    }

    // --- Ring-out VFX ---
    const stageCenterX = (this.mapBounds.minX + this.mapBounds.maxX) / 2;
    const stageCenterY = (this.mapBounds.minY + this.mapBounds.maxY) / 2;

    for (const player of state.players) {
      const wasRespawning = this.prevRespawning.get(player.id) ?? false;
      const wasEliminated = this.prevEliminated.get(player.id) ?? false;

      const isStageOut =
        player.x < this.mapBounds.minX ||
        player.x > this.mapBounds.maxX ||
        player.y < this.mapBounds.minY ||
        player.y > this.mapBounds.maxY;

      const justRingOut =
        (player.respawning && !wasRespawning && isStageOut) ||
        (player.eliminated && !wasEliminated && isStageOut);

      if (justRingOut && this.vfxRingOutPool) {
        const vfx = this.vfxRingOutPool.spawn(this.scene);
        if (vfx) {
          // 1. Calculate direction vector pointing BACK to the stage center
          const dx = stageCenterX - player.x;
          const dy = stageCenterY - player.y;
          
          // Calculate rotation angle facing the stage
          const baseAngle = Math.atan2(dy, dx);

          // 2. Raycast to find the map boundary intersection point
          let intersectionT = 1.0; // t represents progress along the line (0 = player, 1 = stage center)

          // Check Left Wall (x = minX)
          if (dx !== 0) {
            const t = (this.mapBounds.minX - player.x) / dx;
            if (t >= 0 && t <= 1) {
              const y = player.y + t * dy;
              if (y >= this.mapBounds.minY && y <= this.mapBounds.maxY) {
                intersectionT = t;
              }
            }
          }
          // Check Right Wall (x = maxX)
          if (dx !== 0 && intersectionT === 1.0) {
            const t = (this.mapBounds.maxX - player.x) / dx;
            if (t >= 0 && t <= 1) {
              const y = player.y + t * dy;
              if (y >= this.mapBounds.minY && y <= this.mapBounds.maxY) {
                intersectionT = t;
              }
            }
          }
          // Check Bottom Wall (y = minY)
          if (dy !== 0 && intersectionT === 1.0) {
            const t = (this.mapBounds.minY - player.y) / dy;
            if (t >= 0 && t <= 1) {
              const x = player.x + t * dx;
              if (x >= this.mapBounds.minX && x <= this.mapBounds.maxX) {
                intersectionT = t;
              }
            }
          }
          // Check Top Wall (y = maxY)
          if (dy !== 0 && intersectionT === 1.0) {
            const t = (this.mapBounds.maxY - player.y) / dy;
            if (t >= 0 && t <= 1) {
              const x = player.x + t * dx;
              if (x >= this.mapBounds.minX && x <= this.mapBounds.maxX) {
                intersectionT = t;
              }
            }
          }

          // Calculate the exact coordinate where the ray enters map bounds
          const intersectX = player.x + intersectionT * dx;
          const intersectY = player.y + intersectionT * dy;

          // 3. Find the midway point between the player's ringout point and the boundary hit
          //const midX = (player.x + intersectX) / 2;
          //const midY = (player.y + intersectY) / 2;

          // 4. Apply transformations to the VFX mesh
          vfx.mesh.position.set(intersectX, intersectY, 0.5); 
          vfx.mesh.rotation.z = baseAngle; // Orient the beam pointing back into the arena
          
          this.playerVFX.set(player.id, vfx);
        }
      }

      const vfx = this.playerVFX.get(player.id);
      if (vfx) {
        vfx.player.advance(vfxDeltaSeconds);
        vfx.update();
        if (vfx.isDone() && this.vfxRingOutPool) {
          this.vfxRingOutPool.release(this.scene, vfx);
          this.playerVFX.delete(player.id);
        }
      }

      this.prevRespawning.set(player.id, player.respawning);
      this.prevEliminated.set(player.id, player.eliminated);
      this.prevVelocity.set(player.id, { vx: player.vx, vy: player.vy });

      // --- Dust VFX ---
      if (this.dust && !player.eliminated && !player.respawning) {
        const wasGrounded = this.prevGrounded.get(player.id) ?? true;
        const wasAirborne = !wasGrounded;

        // Landing ring: fired once on airborne → grounded.
        if (wasAirborne && player.grounded) {
          const prev = this.prevVelocity.get(player.id);
          const impactVy = prev?.vy ?? player.vy;
          this.dust.spawnLandingRing(player.x, player.y - PLAYER_HALF_HEIGHT, impactVy);
        }

        // Scuff: while grounded and moving fast enough, emit at intervals.
        if (player.grounded && Math.abs(player.vx) > DUST_SCUFF_MIN_SPEED) {
          const last = this.prevScuffEmitTick.get(player.id) ?? -9999;
          if (state.animTick - last >= DUST_SCUFF_EMIT_INTERVAL_TICKS) {
            this.dust.spawnScuff(player.x, player.y - PLAYER_HALF_HEIGHT, player.facing);
            this.prevScuffEmitTick.set(player.id, state.animTick);
          }
        }

        this.prevGrounded.set(player.id, player.grounded);
      }
    }

    this.dust?.update(vfxDeltaSeconds);

    // Cleanup VFX for players who left the match
    for (const [id, vfx] of this.playerVFX) {
      if (!activeIds.has(id)) {
        if (this.vfxRingOutPool) this.vfxRingOutPool.release(this.scene, vfx);
        this.playerVFX.delete(id);
        this.prevRespawning.delete(id);
        this.prevEliminated.delete(id);
        this.prevVelocity.delete(id);
        this.prevGrounded.delete(id);
        this.prevScuffEmitTick.delete(id);
      }
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
    const activeAttackIds = this.activeAttackIdsScratch;
    activeAttackIds.clear();
    for (const attack of state.attacks) {
      activeAttackIds.add(attack.id);
    }

    for (const attack of state.attacks) {
      const variant = resolvePunchSpriteVariant(attack.characterId);
      const frameKey = `${attack.id}:${variant}`;

      let attackSprite = this.attackMeshes.get(attack.id);
      if (!attackSprite) {
        attackSprite = this.createAttackSpriteMesh();
        this.scene.add(attackSprite.mesh);
        this.attackMeshes.set(attack.id, attackSprite);
      }

      const cachedTex = this.getWeaponSpriteTexture(PUNCH_WEAPON_NAME, variant);
      if (attackSprite.lastFrameKey !== frameKey && cachedTex.texture.image) {
        const prev = attackSprite.mesh.material as THREE.MeshBasicMaterial;
        prev.dispose();
        attackSprite.mesh.material = this.createPlayerSpriteMaterial(cachedTex.texture);
        attackSprite.lastFrameKey = frameKey;
      }

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
    const activeItemIds = this.activeItemIdsScratch;
    activeItemIds.clear();
    for (const item of state.items) {
      activeItemIds.add(item.id);
    }

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
    const activeBulletIds = this.activeBulletIdsScratch;
    activeBulletIds.clear();
    for (const bullet of state.bullets) {
      activeBulletIds.add(bullet.id);
    }

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

  setCountdownCameraTarget(playerId: string | null): void {
    this.countdownCameraTargetId = playerId;
  }

  setLobbyPreviewMode(enabled: boolean): void {
    this.lobbyPreviewMode = enabled;
  }

  private computeLobbyPreviewZoom(): number {
    // Fit the stage (with a small margin) into the right-third area of the
    // viewport so it appears smaller and shifted regardless of map size.
    const fitW = Math.max(this.mapBounds.width + 2, 8);
    const fitH = Math.max(this.mapBounds.height + 2, 6);
    const previewWidth = this.baseViewWidth * LOBBY_PREVIEW_WIDTH_FRACTION;
    const zoom = Math.min(previewWidth / fitW, this.baseViewHeight / fitH);
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
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

    if (this.parallaxBackground) {
      this.scene.remove(this.parallaxBackground.mesh);
      this.parallaxBackground.mesh.geometry.dispose();
      this.parallaxBackground.material.dispose();
      this.parallaxBackground.texture.dispose();
      if (this.parallaxBackground.video) {
        this.parallaxBackground.video.pause();
        this.parallaxBackground.video.removeAttribute('src');
        this.parallaxBackground.video.load();
      }
      this.parallaxBackground = null;
    }

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

    for (const [, sg] of this.shieldMeshes) {
      this.scene.remove(sg.fill);
      this.scene.remove(sg.rim);
      sg.fill.geometry.dispose();
      sg.rim.geometry.dispose();
      (sg.fill.material as THREE.MeshBasicMaterial).dispose();
      (sg.rim.material as THREE.MeshBasicMaterial).dispose();
    }
    this.shieldMeshes.clear();

    for (const [, vfx] of this.playerVFX) {
      this.scene.remove(vfx.mesh);
    }
    this.playerVFX.clear();
    this.vfxRingOutPool?.disposeAll();
    this.vfxRingOutPool = null;

    this.dust?.dispose();
    this.dust = null;
    this.prevGrounded.clear();
    this.prevScuffEmitTick.clear();

    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  preloadCharacterTextures(characterIds: CharacterId[]): void {
    const characterFrames = [
      'idle_l', 'idle_r',
      'walk_l1', 'walk_l2', 'walk_r1', 'walk_r2',
      'hold_l', 'hold_r',
    ];
    for (const characterId of characterIds) {
      for (const frame of characterFrames) {
        this.getCachedSpriteTexture(characterId, frame);
      }
    }
    for (const variant of ['var1', 'var2']) {
      this.getWeaponSpriteTexture(PUNCH_WEAPON_NAME, variant);
    }
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

    const bgConfig = getMapBackground(map.id);
    if (bgConfig) {
      void this.loadParallaxBackground(map, bgConfig);
    }

    return backdrop;
  }

  private async loadParallaxBackground(
    map: TiledMapDefinition,
    config: MapBackgroundConfig,
  ): Promise<void> {
    const url = resolveBackgroundUrl(config.asset);
    if (!url) {
      console.warn(`[mapBackgrounds] Asset not found in src/assets/map_bgs: ${config.asset}`);
      return;
    }

    const kind = classifyBackgroundAsset(config.asset);
    if (!kind) {
      console.warn(`[mapBackgrounds] Unsupported asset extension: ${config.asset}`);
      return;
    }

    let texture: THREE.Texture;
    let video: HTMLVideoElement | undefined;
    let sourceWidth = 0;
    let sourceHeight = 0;

    if (kind === 'video') {
      video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.autoplay = true;
      video.crossOrigin = 'anonymous';
      // Begin playback; some browsers require an explicit play() call.
      try {
        await video.play();
      } catch (err) {
        // Autoplay may be blocked until user interaction; texture still updates once playing.
        console.warn('[mapBackgrounds] video.play() rejected, will retry on canplay', err);
      }
      await new Promise<void>((resolve) => {
        if (video!.readyState >= 2) {
          resolve();
        } else {
          video!.addEventListener('canplay', () => resolve(), { once: true });
        }
      });
      texture = new THREE.VideoTexture(video);
      // VideoTextures upload every frame; the GL-rebinding onUpdate hook used
      // for static tiles causes flicker here, so configure minimally.
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      sourceWidth = video.videoWidth;
      sourceHeight = video.videoHeight;
    } else {
      texture = await this.textureLoader.loadAsync(url);
      this.configurePixelTexture(texture);
      const img = texture.image as { width?: number; height?: number } | undefined;
      sourceWidth = img?.width ?? 0;
      sourceHeight = img?.height ?? 0;
    }

    const tint = config.tint ?? 0xffffff;
    const opacity = config.opacity ?? 1;
    const scale = config.scale ?? 1;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: tint,
      opacity: 0,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // Cover the map bounds while preserving the asset's native aspect ratio.
    let planeWidth = map.bounds.width * scale;
    let planeHeight = map.bounds.height * scale;
    if (sourceWidth > 0 && sourceHeight > 0) {
      const assetAspect = sourceWidth / sourceHeight;
      const mapAspect = map.bounds.width / map.bounds.height;
      if (assetAspect > mapAspect) {
        // Asset wider than map: match height, extend width.
        planeHeight = map.bounds.height * scale;
        planeWidth = planeHeight * assetAspect;
      } else {
        // Asset taller than map: match width, extend height.
        planeWidth = map.bounds.width * scale;
        planeHeight = planeWidth / assetAspect;
      }
    }
    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 0, -config.depth);
    mesh.renderOrder = -1000;
    this.scene.add(mesh);

    // Hide the solid color backdrop so it doesn't poke through at shallow depths.
    this.backdropMesh.visible = false;

    this.parallaxBackground = { mesh, material, texture, video, config };

    // Fade in over ~250 ms to mask the pop-in.
    const fadeStart = performance.now();
    const targetOpacity = opacity;
    const fade = () => {
      if (!this.parallaxBackground || this.parallaxBackground.material !== material) {
        return;
      }
      const t = Math.min(1, (performance.now() - fadeStart) / 250);
      material.opacity = targetOpacity * t;
      if (t < 1) {
        requestAnimationFrame(fade);
      }
    };
    requestAnimationFrame(fade);
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

    // Asymmetric zoom lerp: snap out fast to keep every player in frame,
    // ease in slowly so the view doesn't whip after a knockout/respawn.
    let zoomLerp: number;
    if (this.cameraMode === 'action') {
      const zoomingOut = targetZoom < this.camera.zoom;
      zoomLerp = zoomingOut ? 0.35 : 0.05;
    } else {
      zoomLerp = 0.16;
    }

    if (this.cameraMode === 'follow' && !this.countdownCameraTargetId) {
      this.camera.position.x = target.x;
      this.camera.position.y = target.y;
    } else if (this.countdownCameraTargetId) {
      // Smooth pan while sequencing through countdown spawn targets.
      this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, target.x, 0.12);
      this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, target.y, 0.12);
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

    if (this.parallaxBackground) {
      const bgZ = this.parallaxBackground.config.depth;
      // Camera sits at z = 12 looking down -z. Orthographic parallax factor
      // (1 - 12/(12+bgZ)) translates the bg in world space so it drifts more
      // slowly than the foreground in screen space.
      const offset = bgZ / (12 + bgZ);
      this.parallaxBackground.mesh.position.x = this.camera.position.x * offset;
      this.parallaxBackground.mesh.position.y = this.camera.position.y * offset;
    }
  }

  private getCameraTarget(state: RenderState, localPlayerId: string): THREE.Vector2 {
    if (this.lobbyPreviewMode) {
      const cx = (this.mapBounds.minX + this.mapBounds.maxX) * 0.5;
      const cy = (this.mapBounds.minY + this.mapBounds.maxY) * 0.5;
      // Shift the camera left so the map renders centered in the right third of
      // the viewport (lobby UI occupies the left/middle columns).
      const zoom = this.computeLobbyPreviewZoom();
      const screenWidthInWorld = this.baseViewWidth / zoom;
      const offsetX = screenWidthInWorld * LOBBY_PREVIEW_OFFSET_FRACTION;
      return this.cameraTarget.set(cx - offsetX, cy);
    }

    if (this.cameraLockTarget) {
      return this.cameraTarget.set(this.cameraLockTarget.x, this.cameraLockTarget.y);
    }

    if (this.cameraMode === 'free') {
      return this.cameraTarget.set(this.freeCameraTarget.x, this.freeCameraTarget.y);
    }

    if (state.players.length === 0) {
      return this.cameraTarget.set(0, 0);
    }

    if (this.countdownCameraTargetId) {
      const target = state.players.find(
        (player: RenderState['players'][number]) => player.id === this.countdownCameraTargetId,
      );
      if (target) {
        return this.cameraTarget.set(target.x, target.y);
      }
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

    // Clamp action-camera position to the map so the view never scrolls into
    // empty space past the stage edges. Zoom is what handles "fit everyone".
    const clampedX = THREE.MathUtils.clamp(
      bounds.centerX,
      this.mapBounds.minX,
      this.mapBounds.maxX,
    );
    const clampedY = THREE.MathUtils.clamp(
      bounds.centerY,
      this.mapBounds.minY,
      this.mapBounds.maxY,
    );

    return this.cameraTarget.set(clampedX, clampedY);
  }

  private getTargetZoom(state: RenderState): number {
    if (this.lobbyPreviewMode) {
      return this.computeLobbyPreviewZoom();
    }

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

    // No lower clamp on action zoom: as long as players are within map bounds,
    // the frame may grow as wide as it needs to in order to keep them visible.
    return Math.min(zoom, 2.5);
  }

  private getPlayerBounds(
    players: RenderState['players'],
  ): { centerX: number; centerY: number; height: number; width: number } | null {
    if (players.length === 0) {
      return null;
    }

    // Only track players who are alive and currently in play. Drop respawning
    // or eliminated players so the camera lerps smoothly to the survivors.
    const tracked = players.filter((p) => !p.eliminated && !p.respawning);
    const source = tracked.length > 0 ? tracked : players;

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const player of source) {
      // Project each player into the map bounds for framing. A player past the
      // edge is treated as if they were standing on the nearest edge — this
      // keeps the camera from chasing off-map positions while still letting
      // zoom grow to fit on-map players.
      const px = THREE.MathUtils.clamp(player.x, this.mapBounds.minX, this.mapBounds.maxX);
      const py = THREE.MathUtils.clamp(player.y, this.mapBounds.minY, this.mapBounds.maxY);
      minX = Math.min(minX, px - player.width * 0.5);
      maxX = Math.max(maxX, px + player.width * 0.5);
      minY = Math.min(minY, py - player.height * 0.5);
      maxY = Math.max(maxY, py + player.height * 0.5);
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
    return Math.min(Math.max(mapHeight * 0.75, 8), 10);
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

  private createLocalIndicatorMesh(color: number): THREE.Mesh {
    if (!this.localIndicatorGeometry) {
      // Downward-pointing triangle: apex at bottom (0, -h/2), base across the top.
      const halfW = 0.32;
      const halfH = 0.12;
      const geom = new THREE.BufferGeometry();
      const verts = new Float32Array([
        -halfW,  halfH, 0,
         halfW,  halfH, 0,
            0, -halfH, 0,
      ]);
      geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geom.setIndex([0, 1, 2]);
      this.localIndicatorGeometry = geom;
    }
    const material = new THREE.MeshBasicMaterial({
      color,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    return new THREE.Mesh(this.localIndicatorGeometry, material);
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
    // Clear any leftover inline width/height that older setSize calls
    // may have written before this build, so CSS can drive sizing again.
    this.renderer.domElement.style.width = '';
    this.renderer.domElement.style.height = '';
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

    // Pass updateStyle=false so Three.js only resizes the drawing buffer
    // and does NOT write inline width/height onto the canvas element.
    // The canvas keeps its CSS 100% x 100% sizing, so exiting fullscreen
    // can shrink it back without an inline-style lock-in.
    this.renderer.setSize(width, height, false);
  }
}