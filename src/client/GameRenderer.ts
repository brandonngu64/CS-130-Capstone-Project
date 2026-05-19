import * as THREE from 'three';
import type { RenderState } from './RollbackPhysicsGame';
import type { LevelDefinition, LevelTile, LevelTilesetInfo } from './levels';

const DEFAULT_VIEW_WIDTH = 24;
const DEFAULT_VIEW_HEIGHT = 14;
const CAMERA_PADDING = 4;

export class GameRenderer {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly container: HTMLElement;
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly atlasTextures = new Map<string, THREE.Texture>();
  private readonly levelGroup = new THREE.Group();
  private readonly playerMeshes = new Map<string, THREE.Mesh>();
  private readonly resizeObserver: ResizeObserver;
  private currentLevel: LevelDefinition | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x131924);

    this.camera = new THREE.OrthographicCamera(-12, 12, 10, -2, 0.1, 100);
    this.camera.position.set(0, 4, 12);
    this.camera.lookAt(0, 4, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    const gl = this.renderer.getContext();
    gl.disable(gl.DITHER);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.container.appendChild(this.renderer.domElement);

    this.setupLighting();
    this.scene.add(this.levelGroup);

    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    this.resizeObserver.observe(this.container);
    this.resize();
  }

  setLevel(level: LevelDefinition): void {
    this.currentLevel = level;
    this.rebuildLevelMeshes(level);
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

    this.clearLevelMeshes();

    for (const texture of this.atlasTextures.values()) {
      texture.dispose();
    }
    this.atlasTextures.clear();

    for (const [, mesh] of this.playerMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.MeshStandardMaterial).dispose();
    }
    this.playerMeshes.clear();

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

  private rebuildLevelMeshes(level: LevelDefinition): void {
    this.clearLevelMeshes();

    const tilesetByName = new Map(
      level.tilesets.map((tileset) => [tileset.name, tileset] as const),
    );

    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(
        level.bounds.maxX - level.bounds.minX + CAMERA_PADDING * 2,
        level.bounds.maxY - level.bounds.minY + CAMERA_PADDING * 2,
      ),
      new THREE.MeshBasicMaterial({ color: 0x0f141f }),
    );
    backdrop.position.set(0, 0, -1.2);
    this.levelGroup.add(backdrop);

    for (const tile of level.tiles) {
      const mesh = this.createTileMesh(tile, tilesetByName.get(tile.tilesetName));
      this.levelGroup.add(mesh);
    }

    for (const itemSpawn of level.itemSpawns) {
      if (!itemSpawn.visible) {
        continue;
      }

      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 0.45, 0.45),
        new THREE.MeshStandardMaterial({
          color: 0x74c69d,
          emissive: 0x114b5f,
          emissiveIntensity: 0.35,
          roughness: 0.5,
          metalness: 0.15,
        }),
      );
      marker.position.set(itemSpawn.x, itemSpawn.y + 0.3, 0.62);
      this.levelGroup.add(marker);
    }

    for (const spawn of level.gunSpawns) {
      if (!spawn.visible) {
        continue;
      }

      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, 0.5),
        new THREE.MeshStandardMaterial({
          color: 0xf4a261,
          emissive: 0x5a2d0c,
          emissiveIntensity: 0.35,
          roughness: 0.55,
          metalness: 0.2,
        }),
      );
      marker.position.set(spawn.x, spawn.y + 0.35, 0.65);
      this.levelGroup.add(marker);
    }
  }

  private clearLevelMeshes(): void {
    while (this.levelGroup.children.length > 0) {
      const child = this.levelGroup.children[0];
      this.levelGroup.remove(child);

      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const material = child.material;
        if (Array.isArray(material)) {
          for (const item of material) {
            item.dispose();
          }
        } else {
          material.dispose();
        }
      }
    }
  }

  private createTileMesh(
    tile: LevelTile,
    tileset: LevelTilesetInfo | undefined,
  ): THREE.Mesh {
    if (tile.tilesetImageUrl && tileset) {
      const geometry = new THREE.PlaneGeometry(tile.width, tile.height);
      this.applyTileUvs(geometry, tileset, tile.tileId);

      const material = new THREE.MeshBasicMaterial({
        map: this.getAtlasTexture(tile.tilesetImageUrl),
        transparent: true,
        alphaTest: 0.01,
        side: THREE.DoubleSide,
        opacity: 1,
      });
      material.toneMapped = false;

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(tile.x, tile.y, tile.kind === 'platform' ? 0.3 : 0.2);
      return mesh;
    }

    const geometry = new THREE.BoxGeometry(tile.width, tile.height, 0.7);
    const material = new THREE.MeshStandardMaterial({
      color: this.colorForTile(tile.kind),
      roughness: tile.kind === 'platform' ? 0.6 : 0.85,
      metalness: tile.kind === 'platform' ? 0.15 : 0.08,
      transparent: tile.kind === 'decoration',
      opacity: tile.kind === 'decoration' ? 0.45 : 1,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(tile.x, tile.y, tile.kind === 'platform' ? 0.3 : 0.2);
    return mesh;
  }

  private getAtlasTexture(imageUrl: string): THREE.Texture {
    const existingTexture = this.atlasTextures.get(imageUrl);
    if (existingTexture) {
      return existingTexture;
    }

    const texture = this.textureLoader.load(imageUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = true;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.anisotropy = 1;
    texture.generateMipmaps = false;
    this.atlasTextures.set(imageUrl, texture);
    return texture;
  }

  private applyTileUvs(
    geometry: THREE.PlaneGeometry,
    tileset: LevelTilesetInfo,
    tileId: number,
  ): void {
    const columns = Math.max(tileset.columns, 1);
    const row = Math.floor(tileId / columns);
    const column = tileId % columns;
    const atlasWidth = Math.max(tileset.imageWidth, tileset.tileWidth);
    const atlasHeight = Math.max(tileset.imageHeight, tileset.tileHeight);
    const insetU = 0.5 / atlasWidth;
    const insetV = 0.5 / atlasHeight;
    const u0 = (column * tileset.tileWidth) / atlasWidth + insetU;
    const u1 = ((column + 1) * tileset.tileWidth) / atlasWidth - insetU;
    const vTop = 1 - (row * tileset.tileHeight) / atlasHeight - insetV;
    const vBottom = 1 - ((row + 1) * tileset.tileHeight) / atlasHeight + insetV;

    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    uv.setXY(0, u0, vTop);
    uv.setXY(1, u1, vTop);
    uv.setXY(2, u0, vBottom);
    uv.setXY(3, u1, vBottom);
    uv.needsUpdate = true;
  }

  private colorForTile(kind: LevelTile['kind']): number {
    switch (kind) {
      case 'platform':
        return 0x6c7a89;
      case 'decoration':
        return 0x4a5a63;
      default:
        return 0x2f3a3f;
    }
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
    const levelWidth = this.currentLevel?.width ?? DEFAULT_VIEW_WIDTH;
    const levelHeight = this.currentLevel?.height ?? DEFAULT_VIEW_HEIGHT;
    const targetWidth = Math.max(levelWidth + CAMERA_PADDING, DEFAULT_VIEW_WIDTH);
    const targetHeight = Math.max(levelHeight + CAMERA_PADDING, DEFAULT_VIEW_HEIGHT);

    let viewWidth = targetWidth;
    let viewHeight = targetHeight;

    if (viewWidth / viewHeight < aspect) {
      viewWidth = viewHeight * aspect;
    } else {
      viewHeight = viewWidth / aspect;
    }

    this.camera.left = -viewWidth * 0.5;
    this.camera.right = viewWidth * 0.5;
    this.camera.top = viewHeight * 0.5;
    this.camera.bottom = -viewHeight * 0.5;
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
  }
}
