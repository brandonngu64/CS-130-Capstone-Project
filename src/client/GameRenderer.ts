import * as THREE from 'three';
import {
  ARENA_HALF_WIDTH,
  FLOOR_Y,
  PLATFORM_COLOR,
  PLATFORMS,
} from './constants';
import type { RenderState } from './RollbackPhysicsGame';

const BASE_VIEW_BOTTOM = -5;
const BASE_VIEW_TOP = 7;
const MIN_VIEW_WIDTH = ARENA_HALF_WIDTH * 2 + 4;

export class GameRenderer {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly container: HTMLElement;
  private readonly playerMeshes = new Map<string, THREE.Mesh>();
  private readonly resizeObserver: ResizeObserver;

  constructor(container: HTMLElement) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x131924);

    this.camera = new THREE.OrthographicCamera(-12, 12, 10, -2, 0.1, 100);
    this.camera.position.set(0, 4, 12);
    this.camera.lookAt(0, 4, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.container.appendChild(this.renderer.domElement);

    this.setupLighting();
    this.setupArenaMeshes();

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

  private setupArenaMeshes(): void {
    const groundGeometry = new THREE.BoxGeometry(ARENA_HALF_WIDTH * 2 + 4, 1, 1);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x2f3a3f,
      roughness: 0.85,
      metalness: 0.1,
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.position.set(0, FLOOR_Y - 0.5, -0.4);
    this.scene.add(ground);

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x1f2830,
      roughness: 0.9,
      metalness: 0.05,
    });

    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(1, 16, 1), wallMaterial);
    leftWall.position.set(-(ARENA_HALF_WIDTH + 0.5), 5.5, -0.6);
    this.scene.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(1, 16, 1), wallMaterial);
    rightWall.position.set(ARENA_HALF_WIDTH + 0.5, 5.5, -0.6);
    this.scene.add(rightWall);

    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_HALF_WIDTH * 2 + 8, 18),
      new THREE.MeshBasicMaterial({ color: 0x0f141f }),
    );
    backdrop.position.set(0, 6, -1.2);
    this.scene.add(backdrop);

    const platformMaterial = new THREE.MeshStandardMaterial({
      color: PLATFORM_COLOR,
      roughness: 0.6,
      metalness: 0.15,
    });

    // Match the player's z range (centered at 0.35, depth 0.7) so the camera
    // tilt doesn't cause the player to visually clip into the platform top.
    for (const platform of PLATFORMS) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(
          platform.halfWidth * 2,
          platform.halfHeight * 2,
          0.7,
        ),
        platformMaterial,
      );
      mesh.position.set(platform.centerX, platform.centerY, 0.35);
      this.scene.add(mesh);
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
    let viewTop = BASE_VIEW_TOP;
    let viewBottom = BASE_VIEW_BOTTOM;
    let viewWidth = (viewTop - viewBottom) * aspect;

    if (viewWidth < MIN_VIEW_WIDTH) {
      const requiredHeight = MIN_VIEW_WIDTH / aspect;
      const currentHeight = viewTop - viewBottom;
      const expand = (requiredHeight - currentHeight) * 0.5;
      viewTop += expand;
      viewBottom -= expand;
      viewWidth = MIN_VIEW_WIDTH;
    }

    this.camera.left = -viewWidth * 0.5;
    this.camera.right = viewWidth * 0.5;
    this.camera.top = viewTop;
    this.camera.bottom = viewBottom;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
  }
}
