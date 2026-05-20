import * as THREE from 'three';
import type { RenderState } from './RollbackPhysicsGame';
import type { MapTileInstance, TiledMapDefinition, UvRect } from './tiledMap';

const CAMERA_MARGIN = 1.5;

type CachedTileMaterial = {
  material: THREE.MeshBasicMaterial;
  texture: THREE.Texture;
};

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
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, map: TiledMapDefinition) {
    this.container = container;
    this.mapBounds = map.bounds;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x131924);

    this.camera = new THREE.OrthographicCamera(-12, 12, 10, -2, 0.1, 100);
    this.camera.position.set(0, 0, 12);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

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
    const activeIds = new Set(state.players.map((player) => player.id));

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
    }

    for (const [id, mesh] of this.playerMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.MeshStandardMaterial).dispose();
        this.playerMeshes.delete(id);
      }
    }

    this.renderer.render(this.scene, this.camera);
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
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;

    const material = new THREE.MeshBasicMaterial({
      alphaTest: 0.001,
      color: tintColor,
      map: texture,
      opacity: tile.opacity,
      side: THREE.DoubleSide,
      transparent: true,
    });

    this.materialCache.set(cacheKey, { material, texture });
    return material;
  }

  private createPlayerMesh(
    width: number,
    height: number,
    color: number,
  ): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(width, height, 0.7);
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.45,
      metalness: 0.1,
    });

    return new THREE.Mesh(geometry, material);
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    if (width === 0 || height === 0) {
      return;
    }

    const aspect = width / height;
    const contentWidth = this.mapBounds.width + CAMERA_MARGIN * 2;
    const contentHeight = this.mapBounds.height + CAMERA_MARGIN * 2;
    const viewHeight = Math.max(contentHeight, contentWidth / aspect);
    const viewWidth = viewHeight * aspect;

    this.camera.left = -viewWidth * 0.5;
    this.camera.right = viewWidth * 0.5;
    this.camera.top = viewHeight * 0.5;
    this.camera.bottom = -viewHeight * 0.5;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
  }
}
