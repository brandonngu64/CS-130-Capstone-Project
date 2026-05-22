import * as THREE from 'three';
import {
  ARENA_HALF_WIDTH,
  FLOOR_Y,
  PLATFORM_COLOR,
  PLATFORMS,
} from './constants';
import { GUN_COLOR, ItemKind } from './items';
import type { RenderState } from './RollbackPhysicsGame';

const BASE_VIEW_BOTTOM = -5;
const BASE_VIEW_TOP = 7;
const MIN_VIEW_WIDTH = ARENA_HALF_WIDTH * 2 + 4;

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
  private readonly attackMeshes = new Map<string, THREE.Mesh>();
  private readonly itemMeshes   = new Map<number, THREE.Mesh>();
  private readonly bulletMeshes = new Map<number, THREE.Mesh>();
  private readonly gunMeshes = new Map<string, THREE.Mesh>();
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
    // --- Players ---
    const activeIds = new Set(state.players.map((p) => p.id));

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
    const activeAttackIds = new Set(state.attacks.map((a) => a.id));

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
    const activeItemIds = new Set(state.items.map((item) => item.id));

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
    const activeBulletIds = new Set(state.bullets.map((b) => b.id));

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

    for (const platform of PLATFORMS) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(platform.halfWidth * 2, platform.halfHeight * 2, 0.7),
        platformMaterial,
      );
      mesh.position.set(platform.centerX, platform.centerY, 0.35);
      this.scene.add(mesh);
    }
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

  private createItemMesh(kind: ItemKind): THREE.Mesh {
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
    let viewTop    = BASE_VIEW_TOP;
    let viewBottom = BASE_VIEW_BOTTOM;
    let viewWidth  = (viewTop - viewBottom) * aspect;

    if (viewWidth < MIN_VIEW_WIDTH) {
      const requiredHeight = MIN_VIEW_WIDTH / aspect;
      const currentHeight  = viewTop - viewBottom;
      const expand         = (requiredHeight - currentHeight) * 0.5;
      viewTop    += expand;
      viewBottom -= expand;
      viewWidth   = MIN_VIEW_WIDTH;
    }

    this.camera.left   = -viewWidth * 0.5;
    this.camera.right  =  viewWidth * 0.5;
    this.camera.top    = viewTop;
    this.camera.bottom = viewBottom;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
  }
}