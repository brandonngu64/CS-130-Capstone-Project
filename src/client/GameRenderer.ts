import * as THREE from 'three';
import {
  getCharacterSpriteUrl,
  getWeaponSpriteUrl,
  PUNCH_SPRITE_HEIGHT_RATIO,
  PUNCH_WEAPON_NAME,
  resolveCharacterFrame,
  resolveCharacterFrameKey,
  resolvePunchSpriteVariant,
  resolveWhipFrame,
  WEAPON_SPRITE_NAMES,
} from './CharacterSprites';
import { RESPAWN_FLASH_TICKS } from './constants';
import { K_createDroppedItemMesh, K_createProjectileMesh, K_createWeaponMesh, K_renderLaserSight } from './kyleWeapons';
import { ItemKind, WEAPON_DEFINITIONS } from './items';
import type { RenderState } from './RollbackPhysicsGame';
import type { MapTileInstance, TiledMapDefinition, UvRect } from './tiledMap';

const CAMERA_MARGIN = 1.5;

export type CameraMode = 'follow' | 'free' | 'action';

type CachedTileMaterial = {
  material: THREE.MeshBasicMaterial;
  texture: THREE.Texture;
};

type CachedSpriteTexture = {
  texture: THREE.Texture;
  aspectRatio: number;
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

// How far from the player centre the whip sprite is anchored
const WHIP_OFFSET_X = 0.5;

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
  private readonly cameraTarget = new THREE.Vector2();
  private cameraMode: CameraMode = 'follow';
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly attackMeshes = new Map<string, AttackSpriteMesh>();
  private readonly itemMeshes = new Map<number, THREE.Mesh>();
  private readonly bulletMeshes = new Map<number, THREE.Mesh>();
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

      if (player.heldItem === null) {
        if (weapon) {
          this.scene.remove(weapon);
          weapon.geometry.dispose();
          (weapon.material as THREE.Material).dispose();
          this.weaponMeshes.delete(player.id);
        }
        if (laser) {
          this.scene.remove(laser);
          laser.geometry.dispose();
          (laser.material as THREE.Material).dispose();
          this.laserSightMeshes.delete(player.id);
        }
        continue;
      }

      if (!weapon || weapon.userData.kind !== player.heldItem) {
        if (weapon) {
          this.scene.remove(weapon);
          weapon.geometry.dispose();
          (weapon.material as THREE.Material).dispose();
          this.weaponMeshes.delete(player.id);
        }
        const nextWeapon = K_createWeaponMesh(player.heldItem, this.textureLoader);
        nextWeapon.userData.kind = player.heldItem;
        this.scene.add(nextWeapon);
        this.weaponMeshes.set(player.id, nextWeapon);
      }

      const currentWeapon = this.weaponMeshes.get(player.id);
      if (currentWeapon) {
        currentWeapon.position.set(player.x + player.facing * 0.55, player.y + 0.2, 0.7);
        currentWeapon.visible = true;
      }

      let currentLaser = laser;
      if (!currentLaser) {
        currentLaser = K_renderLaserSight(player.x, player.y + 0.1, player.facing);
        this.scene.add(currentLaser);
        this.laserSightMeshes.set(player.id, currentLaser);
      }
      currentLaser.position.set(player.x + player.facing * 0.55, player.y + 0.2, 0.30);
      currentLaser.rotation.z = player.facing === -1 ? Math.PI : 0;
      currentLaser.visible = player.heldItem === ItemKind.PenCrossbow;
    }

    for (const [id, playerSprite] of this.playerMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(playerSprite.mesh);
        playerSprite.mesh.geometry.dispose();
        this.playerMeshes.delete(id);
      }
    }

    for (const [id, weapon] of this.weaponMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(weapon);
        weapon.geometry.dispose();
        (weapon.material as THREE.Material).dispose();
        this.weaponMeshes.delete(id);
      }
    }

    for (const [id, laser] of this.laserSightMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(laser);
        laser.geometry.dispose();
        (laser.material as THREE.Material).dispose();
        this.laserSightMeshes.delete(id);
      }
    }

    // --- Weapon sprites (whip etc.) ---
    for (const player of state.players) {
      const weaponName = player.heldItem !== null
        ? WEAPON_SPRITE_NAMES[player.heldItem]
        : undefined;

      if (!weaponName) {
        const stale = this.weaponSpriteMeshes.get(player.id);
        if (stale) {
          this.scene.remove(stale.mesh);
          stale.mesh.geometry.dispose();
          (stale.mesh.material as THREE.MeshBasicMaterial).dispose();
          this.weaponSpriteMeshes.delete(player.id);
        }
        continue;
      }

      const def = player.heldItem !== null ? WEAPON_DEFINITIONS[player.heldItem] : undefined;
      if (!def) {
        const stale = this.weaponSpriteMeshes.get(player.id);
        if (stale) {
          this.scene.remove(stale.mesh);
          stale.mesh.geometry.dispose();
          (stale.mesh.material as THREE.MeshBasicMaterial).dispose();
          this.weaponSpriteMeshes.delete(player.id);
        }
        continue;
      }

      const ticksRemaining = player.activeWeaponAttack?.ticksRemaining ?? 0;
      const whipFrame = resolveWhipFrame(player.facing, def, ticksRemaining);
      const whipFrameKey = `${player.id}:${weaponName}:${whipFrame}`;

      let weaponSprite = this.weaponSpriteMeshes.get(player.id);
      if (!weaponSprite) {
        weaponSprite = this.createWeaponSpriteMesh();
        this.scene.add(weaponSprite.mesh);
        this.weaponSpriteMeshes.set(player.id, weaponSprite);
      }

      if (weaponSprite.lastFrameKey !== whipFrameKey) {
        const cachedTex = this.getWeaponSpriteTexture(weaponName, whipFrame);
        const prev = weaponSprite.mesh.material as THREE.MeshBasicMaterial;
        prev.dispose();
        weaponSprite.mesh.material = this.createPlayerSpriteMaterial(cachedTex.texture);
        weaponSprite.lastFrameKey = whipFrameKey;
      }

      const cachedTex = this.getWeaponSpriteTexture(weaponName, whipFrame);
      const aspect = this.resolveSpriteAspectRatio(cachedTex);
      const displayHeight = player.height;
      const displayWidth = displayHeight * aspect;

      weaponSprite.mesh.scale.set(displayWidth * player.facing, displayHeight, 1);
      weaponSprite.mesh.position.set(
        player.x + player.facing * WHIP_OFFSET_X,
        player.y,
        0.36,
      );

      const playerMesh = this.playerMeshes.get(player.id);
      const playerOpacity = playerMesh
        ? (playerMesh.mesh.material as THREE.MeshBasicMaterial).opacity
        : 1;
      const weaponMaterial = weaponSprite.mesh.material as THREE.MeshBasicMaterial;
      weaponMaterial.opacity = playerOpacity;
      weaponMaterial.transparent = playerOpacity < 1;
      weaponMaterial.depthWrite = playerOpacity >= 1;
    }

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
        mesh = K_createDroppedItemMesh(item.kind, this.textureLoader);
        this.scene.add(mesh);
        this.itemMeshes.set(item.id, mesh);
      }
      const bob = Math.sin(Date.now() / 400) * 0.08;
      mesh.position.set(item.x, item.y + bob, 0.35);
    }

    for (const [id, mesh] of this.itemMeshes) {
      if (!activeItemIds.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.MeshStandardMaterial).dispose();
        this.itemMeshes.delete(id);
      }
    }

    // --- Bullets ---
    const activeBulletIds = new Set(state.bullets.map((bullet: RenderState['bullets'][number]) => bullet.id));

    for (const bullet of state.bullets) {
      let mesh = this.bulletMeshes.get(bullet.id);
      if (!mesh) {
        mesh = K_createProjectileMesh(bullet.kind, this.textureLoader);
        this.scene.add(mesh);
        this.bulletMeshes.set(bullet.id, mesh);
      }
      mesh.position.set(bullet.x, bullet.y, 0.35);
    }

    for (const [id, mesh] of this.bulletMeshes) {
      if (!activeBulletIds.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.MeshStandardMaterial).dispose();
        this.bulletMeshes.delete(id);
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
      (mesh.material as THREE.MeshStandardMaterial).dispose();
    }
    this.itemMeshes.clear();

    for (const [, mesh] of this.bulletMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.MeshStandardMaterial).dispose();
    }
    this.bulletMeshes.clear();

    for (const [, mesh] of this.weaponMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.MeshStandardMaterial).dispose();
    }
    this.weaponMeshes.clear();

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
    const cacheKey = `${tile.atlasUrl}|${tintColor}|${tile.opacity}`;
    const cachedMaterial = this.materialCache.get(cacheKey);
    if (cachedMaterial) {
      return cachedMaterial.material;
    }

    const texture = this.textureLoader.load(tile.atlasUrl);
    this.configurePixelTexture(texture);

    const isOpaque = tile.opacity >= 1;

    const material = new THREE.MeshBasicMaterial({
      alphaTest: 0.001,
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

    const followLerp = this.cameraMode === 'action' ? 0.12 : 0.18;
    const zoomLerp = this.cameraMode === 'action' ? 0.08 : 0.12;

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
      alphaTest: 0.001,
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
      alphaTest: 0.001,
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

    const entry: CachedSpriteTexture = {
      texture,
      aspectRatio: this.readTextureAspectRatio(texture),
    };
    this.spriteTextureCache.set(cacheKey, entry);
    return entry;
  }

  private getWeaponSpriteTexture(weaponName: string, frame: string): CachedSpriteTexture {
    const cacheKey = `weapon:${weaponName}:${frame}`;
    const cached = this.spriteTextureCache.get(cacheKey);
    if (cached) return cached;

    const texture = this.textureLoader.load(getWeaponSpriteUrl(weaponName, frame));
    this.configurePixelTexture(texture);

    const entry: CachedSpriteTexture = {
      texture,
      aspectRatio: this.readTextureAspectRatio(texture),
    };
    this.spriteTextureCache.set(cacheKey, entry);
    return entry;
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
    const image = texture.image as { width?: number; height?: number } | undefined;
    if (image?.width && image?.height) {
      return image.width / image.height;
    }
    return 0;
  }

  private createAttackSpriteMesh(): AttackSpriteMesh {
    return this.createWeaponSpriteMesh();
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