import * as THREE from 'three';
import { readArenaSideWallsEnabled } from './arenaOptions';
import { GUN_COLOR, ItemKind } from './items';
import type { RenderState } from './RollbackPhysicsGame';
import type { MapTileInstance, TiledMapDefinition, UvRect } from './tiledMap';

const CAMERA_MARGIN = 1.5;

export type CameraMode = 'follow' | 'free' | 'action';

type CachedTileMaterial = {
  material: THREE.MeshBasicMaterial;
  texture: THREE.Texture;
};

// Size of a collectible item sitting on the ground
const ITEM_GUN_WIDTH  = 0.5;
const ITEM_GUN_HEIGHT = 0.25;
const ITEM_GUN_DEPTH  = 0.25;

const BULLET_W = 0.3;
const BULLET_H = 0.16;
const BULLET_D = 0.16;

export class GameRenderer {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly container: HTMLElement;
  private readonly playerMeshes = new Map<string, THREE.Mesh>();
  private readonly mapMeshes: THREE.Mesh[] = [];
  private readonly materialCache = new Map<string, CachedTileMaterial>();
  private readonly backdropMesh: THREE.Mesh;
  private readonly mapBounds: TiledMapDefinition['bounds'];
  private readonly baseViewHeight: number;
  private baseViewWidth = 0;
  private readonly freeCameraTarget = new THREE.Vector2();
  private readonly cameraTarget = new THREE.Vector2();
  private cameraMode: CameraMode = 'follow';
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly attackMeshes = new Map<string, THREE.Mesh>();
  private readonly itemMeshes = new Map<number, THREE.Mesh>();
  private readonly bulletMeshes = new Map<number, THREE.Mesh>();
  private readonly gunMeshes = new Map<string, THREE.Mesh>();
  private readonly resizeObserver: ResizeObserver;
  private sideWallsEnabled: boolean;
  private groundMesh!: THREE.Mesh;
  private leftWallMesh: THREE.Mesh | null = null;
  private rightWallMesh: THREE.Mesh | null = null;
  private readonly wallMaterial = new THREE.MeshStandardMaterial({
    color: 0x1f2830,
    roughness: 0.9,
    metalness: 0.05,
  });

  constructor(container: HTMLElement, map: TiledMapDefinition, sideWallsEnabled = readArenaSideWallsEnabled()) {
    this.container = container;
    this.mapBounds = map.bounds;
    this.baseViewHeight = this.computeBaseViewHeight(map.bounds.height);
    this.sideWallsEnabled = sideWallsEnabled;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x131924);

    this.camera = new THREE.OrthographicCamera(-12, 12, 10, -2, 0.1, 100);
    this.camera.position.set(0, 0, 12);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.style.imageRendering = 'pixelated';

    this.container.appendChild(this.renderer.domElement);

    this.setupLighting();
    this.backdropMesh = this.setupBackdrop(map);
    this.setupMapMeshes(map);
    this.rebuildGroundMesh();
    this.setupArenaMeshes();

    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    this.resizeObserver.observe(this.container);
    this.resize();
  }

  areSideWallsEnabled(): boolean {
    return this.sideWallsEnabled;
  }

  setSideWallsEnabled(enabled: boolean): void {
    if (enabled === this.sideWallsEnabled) {
      return;
    }
    this.sideWallsEnabled = enabled;
    this.syncSideWallMeshes();
  }

  render(state: RenderState, localPlayerId: string): void {
    // --- Players ---
    const activeIds = new Set(state.players.map((player: RenderState['players'][number]) => player.id));

    for (const player of state.players) {
      let mesh = this.playerMeshes.get(player.id);
      if (!mesh) {
        mesh = this.createPlayerMesh(player.width, player.height, player.color);
        this.scene.add(mesh);
        this.playerMeshes.set(player.id, mesh);
      }

      mesh.position.set(player.x, player.y, 0.35);

      const material = mesh.material as THREE.MeshStandardMaterial;
      material.emissive.setHex(player.id === localPlayerId ? 0x2a9d8f : 0x000000);
      material.emissiveIntensity = player.id === localPlayerId ? 0.26 : 0;

      if (player.heldItem !== null) {
        let gun = this.gunMeshes.get(player.id);
        if (!gun) {
          gun = this.createGunMesh();
          this.scene.add(gun);
          this.gunMeshes.set(player.id, gun);
        }
        gun.position.set(player.x + player.facing * 0.55, player.y + 0.2, 0.7);
        gun.visible = true;
      } else {
        const gun = this.gunMeshes.get(player.id);
        if (gun) gun.visible = false;
      }
    }

    for (const [id, mesh] of this.playerMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.MeshStandardMaterial).dispose();
        this.playerMeshes.delete(id);

        const gun = this.gunMeshes.get(id);
        if (gun) {
          this.scene.remove(gun);
          gun.geometry.dispose();
          (gun.material as THREE.MeshStandardMaterial).dispose();
          this.gunMeshes.delete(id);
        }
      }
    }

    // --- Attacks ---
    const activeAttackIds = new Set(state.attacks.map((attack: RenderState['attacks'][number]) => attack.id));

    for (const attack of state.attacks) {
      let mesh = this.attackMeshes.get(attack.id);
      if (!mesh) {
        mesh = this.createAttackMesh(attack.width, attack.height, attack.color);
        this.scene.add(mesh);
        this.attackMeshes.set(attack.id, mesh);
      }
      mesh.position.set(attack.x, attack.y, 0.5);
    }

    for (const [id, mesh] of this.attackMeshes) {
      if (!activeAttackIds.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.MeshStandardMaterial).dispose();
        this.attackMeshes.delete(id);
      }
    }

    // --- Items ---
    const activeItemIds = new Set(state.items.map((item: RenderState['items'][number]) => item.id));

    for (const item of state.items) {
      let mesh = this.itemMeshes.get(item.id);
      if (!mesh) {
        mesh = this.createItemMesh(item.kind);
        this.scene.add(mesh);
        this.itemMeshes.set(item.id, mesh);
      }
      // Bob gently up and down so items are easy to spot.
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
        mesh = this.createBulletMesh();
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

    for (const [, mesh] of this.playerMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.MeshStandardMaterial).dispose();
    }
    this.playerMeshes.clear();

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

    for (const [, mesh] of this.attackMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.MeshStandardMaterial).dispose();
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

    for (const [, mesh] of this.gunMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.MeshStandardMaterial).dispose();
    }
    this.gunMeshes.clear();

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
    const material = new THREE.MeshBasicMaterial({ color: 0x0f141f });
    const backdrop = new THREE.Mesh(geometry, material);
    backdrop.position.set(0, 0, -2);
    this.scene.add(backdrop);
    return backdrop;
  }

  private floorDisplayWidth(): number {
    return this.mapBounds.width;
  }

  private setupArenaMeshes(): void {
    this.syncSideWallMeshes();
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

    const material = new THREE.MeshBasicMaterial({
      alphaTest: 0.001,
      color: tintColor,
      map: texture,
      opacity: tile.opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      transparent: true,
    });

    this.materialCache.set(cacheKey, { material, texture });
    return material;
  }

  private configurePixelTexture(texture: THREE.Texture): void {
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
    this.snapCameraToPixelGrid();
    this.camera.updateProjectionMatrix();
  }

  private getCameraTarget(state: RenderState, localPlayerId: string): THREE.Vector2 {
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

  private rebuildGroundMesh(): void {
    if (this.groundMesh) {
      this.scene.remove(this.groundMesh);
      this.groundMesh.geometry.dispose();
      (this.groundMesh.material as THREE.MeshStandardMaterial).dispose();
    }

    const groundGeometry = new THREE.BoxGeometry(this.floorDisplayWidth(), 1, 1);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x2f3a3f,
      roughness: 0.85,
      metalness: 0.1,
    });
    this.groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    this.groundMesh.position.set(0, this.mapBounds.minY - 0.5, -0.4);
    this.scene.add(this.groundMesh);
  }

  private syncSideWallMeshes(): void {
    if (this.leftWallMesh) {
      this.scene.remove(this.leftWallMesh);
      this.leftWallMesh.geometry.dispose();
      this.leftWallMesh = null;
    }
    if (this.rightWallMesh) {
      this.scene.remove(this.rightWallMesh);
      this.rightWallMesh.geometry.dispose();
      this.rightWallMesh = null;
    }

    if (!this.sideWallsEnabled) {
      return;
    }

    const wallHeight = this.mapBounds.height;
    const wallCenterY = (this.mapBounds.minY + this.mapBounds.maxY) * 0.5;

    this.leftWallMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, wallHeight, 1),
      this.wallMaterial,
    );
    this.leftWallMesh.position.set(this.mapBounds.minX - 0.5, wallCenterY, -0.6);
    this.scene.add(this.leftWallMesh);

    this.rightWallMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, wallHeight, 1),
      this.wallMaterial,
    );
    this.rightWallMesh.position.set(this.mapBounds.maxX + 0.5, wallCenterY, -0.6);
    this.scene.add(this.rightWallMesh);
  }

  private createPlayerMesh(width: number, height: number, color: number): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(width, height, 0.7);
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.45,
      metalness: 0.1,
    });
    return new THREE.Mesh(geometry, material);
  }

  private createAttackMesh(width: number, height: number, color: number): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(width, height, 0.5);
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.35,
      metalness: 0.05,
    });
    return new THREE.Mesh(geometry, material);
  }

  private createItemMesh(_kind: ItemKind): THREE.Mesh {
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

  private createGunMesh(): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(0.35, 0.35, 0.18);
    const material = new THREE.MeshStandardMaterial({
      color: GUN_COLOR,
      roughness: 0.3,
      metalness: 0.8,
      emissive: new THREE.Color(GUN_COLOR),
      emissiveIntensity: 0.3,
    });
    return new THREE.Mesh(geometry, material);
  }

  private createBulletMesh(): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(BULLET_W, BULLET_H, BULLET_D);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffe066,
      roughness: 0.2,
      metalness: 0.5,
      emissive: new THREE.Color(0xffe066),
      emissiveIntensity: 0.6,
    });
    return new THREE.Mesh(geometry, material);
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