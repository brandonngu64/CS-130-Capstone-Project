import * as THREE from 'three';
import dustTextureUrl from '../../assets/vfx/dustEffect/Dust.png';
import {
  DUST_BASE_ALPHA,
  DUST_DRAG,
  DUST_END_SCALE,
  DUST_GRAVITY,
  DUST_LANDING_LIFETIME_SEC,
  DUST_LANDING_MIN_VY,
  DUST_LANDING_PARTICLES,
  DUST_LANDING_REF_VY,
  DUST_LANDING_RING_ANGLE_RANGE_DEG,
  DUST_LANDING_SIZE,
  DUST_LANDING_SIZE_JITTER,
  DUST_LANDING_SPEED,
  DUST_LANDING_SPEED_JITTER,
  DUST_LANDING_UPWARD_BIAS,
  DUST_POOL_SIZE,
  DUST_SCUFF_DRIFT_X,
  DUST_SCUFF_DRIFT_X_JITTER,
  DUST_SCUFF_DRIFT_Y,
  DUST_SCUFF_DRIFT_Y_JITTER,
  DUST_SCUFF_LIFETIME_SEC,
  DUST_SCUFF_PARTICLES_PER_BURST,
  DUST_SCUFF_SIZE,
  DUST_SCUFF_SIZE_JITTER,
  DUST_SCUFF_SPAWN_OFFSET_X,
  DUST_SCUFF_SPAWN_Y_JITTER,
  DUST_Z,
} from '../constants';

type Particle = {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  vx: number;
  vy: number;
  age: number;
  lifetime: number;
  startSize: number;
  baseAlpha: number;
  active: boolean;
};

function jitter(range: number): number {
  return (Math.random() * 2 - 1) * range;
}

export class DustParticleSystem {
  private readonly scene: THREE.Scene;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly texture: THREE.Texture;
  private readonly particles: Particle[] = [];
  private readonly free: Particle[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.geometry = new THREE.PlaneGeometry(1, 1);

    const loader = new THREE.TextureLoader();
    this.texture = loader.load(dustTextureUrl);
    // Manual webgl filter setup — keep pixel art crisp, no smoothing.
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.SRGBColorSpace;

    for (let i = 0; i < DUST_POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      scene.add(mesh);
      const particle: Particle = {
        mesh,
        material,
        vx: 0,
        vy: 0,
        age: 0,
        lifetime: 0,
        startSize: 1,
        baseAlpha: 1,
        active: false,
      };
      this.particles.push(particle);
      this.free.push(particle);
    }
  }

  private acquire(): Particle | null {
    const p = this.free.pop();
    if (!p) return null;
    p.active = true;
    p.age = 0;
    p.mesh.visible = true;
    return p;
  }

  private release(p: Particle): void {
    p.active = false;
    p.mesh.visible = false;
    this.free.push(p);
  }

  spawnScuff(x: number, y: number, facing: number): void {
    const dir = facing >= 0 ? 1 : -1;
    for (let i = 0; i < DUST_SCUFF_PARTICLES_PER_BURST; i++) {
      const p = this.acquire();
      if (!p) return;
      const size = DUST_SCUFF_SIZE + jitter(DUST_SCUFF_SIZE_JITTER);
      p.startSize = size;
      p.lifetime = DUST_SCUFF_LIFETIME_SEC;
      p.baseAlpha = DUST_BASE_ALPHA;
      // Drift backward (opposite facing) + slight up.
      p.vx = -dir * (DUST_SCUFF_DRIFT_X + jitter(DUST_SCUFF_DRIFT_X_JITTER));
      p.vy = DUST_SCUFF_DRIFT_Y + jitter(DUST_SCUFF_DRIFT_Y_JITTER);

      const spawnX = x - dir * DUST_SCUFF_SPAWN_OFFSET_X;
      const spawnY = y + jitter(DUST_SCUFF_SPAWN_Y_JITTER);
      p.mesh.position.set(spawnX, spawnY, DUST_Z);
      p.mesh.scale.set(size, size, 1);
      p.material.opacity = p.baseAlpha;
    }
  }

  spawnLandingRing(x: number, y: number, impactVy: number): void {
    const absVy = Math.abs(impactVy);
    if (absVy < DUST_LANDING_MIN_VY) return;
    const strength = Math.min(1, absVy / DUST_LANDING_REF_VY);

    const count = Math.max(1, Math.round(DUST_LANDING_PARTICLES * strength));
    const rangeRad = (DUST_LANDING_RING_ANGLE_RANGE_DEG * Math.PI) / 180;
    // Center at 0 rad (right); spread symmetric ±range/2 about horizontal.
    // Half above (+y), half below would clip into ground — we mirror to upper hemisphere only.
    for (let i = 0; i < count; i++) {
      const p = this.acquire();
      if (!p) return;
      const size = (DUST_LANDING_SIZE + jitter(DUST_LANDING_SIZE_JITTER)) * (0.6 + 0.4 * strength);
      p.startSize = size;
      p.lifetime = DUST_LANDING_LIFETIME_SEC;
      p.baseAlpha = DUST_BASE_ALPHA;

      // Angle: spread across [-range/2, +range/2] from horizontal, then force upper hemisphere.
      const t = count === 1 ? 0.5 : i / (count - 1);
      const horizAngle = (t - 0.5) * rangeRad; // -range/2 .. +range/2
      // Pick side randomly (left or right of player).
      const sideSign = i % 2 === 0 ? 1 : -1;
      const dirX = Math.cos(horizAngle) * sideSign;
      const dirY = Math.abs(Math.sin(horizAngle));

      const speed = (DUST_LANDING_SPEED + jitter(DUST_LANDING_SPEED_JITTER)) * strength;
      p.vx = dirX * speed;
      p.vy = dirY * speed + DUST_LANDING_UPWARD_BIAS;

      p.mesh.position.set(x, y, DUST_Z);
      p.mesh.scale.set(size, size, 1);
      p.material.opacity = p.baseAlpha;
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    for (const p of this.particles) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.lifetime) {
        this.release(p);
        continue;
      }
      p.vx *= DUST_DRAG;
      p.vy += DUST_GRAVITY * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;

      const t = p.age / p.lifetime;
      p.material.opacity = p.baseAlpha * (1 - t);
      const scale = p.startSize * (1 + (DUST_END_SCALE - 1) * t);
      p.mesh.scale.set(scale, scale, 1);
    }
  }

  dispose(): void {
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
      p.material.dispose();
    }
    this.particles.length = 0;
    this.free.length = 0;
    this.geometry.dispose();
    this.texture.dispose();
  }
}
