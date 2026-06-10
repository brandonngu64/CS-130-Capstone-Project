import * as THREE from 'three';
import type { VFXAsset } from './assetLoader';
import { VFXPlayer } from './vfxPlayer';

// 3D output adapter. One THREE.Texture per atlas page, uploaded once via
// asset.ensureTextures(). Each frame just rewrites this mesh's 4-vertex
// position + UV buffers — zero per-frame GPU texture uploads.
export class VFXMeshInstance {
  readonly mesh: THREE.Mesh;
  readonly player: VFXPlayer;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly uvAttr: THREE.BufferAttribute;
  private readonly textures: THREE.Texture[];
  private readonly worldPerPx: number;
  private lastFrameIndex = -1;
  private lastAtlasIndex = -1;
  // Soft-light tint uniforms, injected via onBeforeCompile. Default strength 0
  // = no-op (renders identically to the raw sequence until setTint() is called).
  private readonly uTintColor = { value: new THREE.Color(0xffffff) };
  private readonly uTintStrength = { value: 0 };

  constructor(player: VFXPlayer, worldHeight: number) {
    this.player = player;
    const asset = player.asset;
    this.textures = asset.ensureTextures();
    this.worldPerPx = worldHeight / asset.designSize.h;

    this.geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(12); // 4 verts × 3 components
    const uvs = new Float32Array(8);        // 4 verts × 2 components
    const indices = new Uint16Array([0, 2, 1, 1, 2, 3]); // TL, BL, TR | TR, BL, BR
    this.positionAttr = new THREE.BufferAttribute(positions, 3);
    this.uvAttr = new THREE.BufferAttribute(uvs, 2);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.uvAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttr);
    this.geometry.setAttribute('uv', this.uvAttr);
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    this.material = new THREE.MeshBasicMaterial({
      alphaTest: 0.01,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    // Soft-light tint toward a player color, blended by strength. Preserves the
    // sequence's bright cores (they stay near-white) and only nudges midtones —
    // single-pass, no extra mesh. Shader source is identical across instances,
    // so the program is shared; only the per-instance uniform values differ.
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTintColor = this.uTintColor;
      shader.uniforms.uTintStrength = this.uTintStrength;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform vec3 uTintColor;\nuniform float uTintStrength;'
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            vec3 base = diffuseColor.rgb;
            vec3 blend = uTintColor;
            // Pegtop soft-light: keeps highlights bright, colors the midtones.
            vec3 soft = (1.0 - 2.0 * blend) * base * base + 2.0 * blend * base;
            diffuseColor.rgb = mix(base, soft, uTintStrength);
          }`
        );
    };
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;

    this.update(true);
  }

  // Called once per render frame (only when VFXClock emits a non-zero delta
  // does the player's frameIndex change — we early-out otherwise).
  update(force = false): void {
    const idx = this.player.currentFrameIndex;
    if (!force && idx === this.lastFrameIndex) return;
    this.lastFrameIndex = idx;

    const f = this.player.currentFrame;
    if (!f) return;

    if (f.atlasIndex !== this.lastAtlasIndex) {
      this.lastAtlasIndex = f.atlasIndex;
      this.material.map = this.textures[f.atlasIndex];
      this.material.needsUpdate = true;
    }

    const asset = this.player.asset;
    const dW = asset.designSize.w;
    const dH = asset.designSize.h;
    const px = this.worldPerPx;

    // Trim quad position in mesh-local space.
    // Design space: origin top-left, Y down. World: origin center, Y up.
    const ssx = f.spriteSourceSize.x;
    const ssy = f.spriteSourceSize.y;
    const ssw = f.spriteSourceSize.w;
    const ssh = f.spriteSourceSize.h;
    const x0 = (ssx - dW / 2) * px;
    const x1 = (ssx + ssw - dW / 2) * px;
    const y0 = (dH / 2 - (ssy + ssh)) * px; // bottom
    const y1 = (dH / 2 - ssy) * px;         // top

    const pos = this.positionAttr.array as Float32Array;
    // Vertex order: 0=TL, 1=TR, 2=BL, 3=BR
    pos[0] = x0; pos[1] = y1; pos[2] = 0;
    pos[3] = x1; pos[4] = y1; pos[5] = 0;
    pos[6] = x0; pos[7] = y0; pos[8] = 0;
    pos[9] = x1; pos[10] = y0; pos[11] = 0;
    this.positionAttr.needsUpdate = true;

    // UV sub-rect in atlas. Texture has flipY=false, so V=0 at top of image.
    const atlas = asset.atlasSizes[f.atlasIndex];
    const u0 = f.frame.x / atlas.w;
    const u1 = (f.frame.x + f.frame.w) / atlas.w;
    const v0 = f.frame.y / atlas.h;
    const v1 = (f.frame.y + f.frame.h) / atlas.h;

    const uv = this.uvAttr.array as Float32Array;
    if (!f.rotated) {
      // 0=TL, 1=TR, 2=BL, 3=BR
      uv[0] = u0; uv[1] = v0;
      uv[2] = u1; uv[3] = v0;
      uv[4] = u0; uv[5] = v1;
      uv[6] = u1; uv[7] = v1;
    } else {
      // Atlas stores sprite rotated 90° CW. To restore on the displayed quad,
      // rotate UVs −90° (CCW): quad TL samples atlas TR, etc.
      uv[0] = u1; uv[1] = v0;
      uv[2] = u1; uv[3] = v1;
      uv[4] = u0; uv[5] = v0;
      uv[6] = u0; uv[7] = v1;
    }
    this.uvAttr.needsUpdate = true;
  }

  // Tint this effect toward a player color using a soft-light blend.
  // strength 0 = raw sequence, ~0.5 = subtle player hue, 1 = strongest.
  setTint(colorHex: number, strength = 0.5): void {
    this.uTintColor.value.setHex(colorHex);
    this.uTintStrength.value = strength;
  }

  reset(): void {
    this.player.reset();
    this.lastFrameIndex = -1;
    this.lastAtlasIndex = -1;
    this.update(true);
  }

  isDone(): boolean {
    return this.player.isDone();
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

// Pool of reusable VFXMeshInstance objects for a single asset (one pack).
export class VFXMeshPool {
  private readonly pool: VFXMeshInstance[] = [];

  constructor(asset: VFXAsset, count: number, worldHeight: number, fps = 60) {
    for (let i = 0; i < count; i++) {
      const player = new VFXPlayer(asset, { fps });
      const instance = new VFXMeshInstance(player, worldHeight);
      player.markDone(); // idle in pool until spawn()
      this.pool.push(instance);
    }
  }

  spawn(scene: THREE.Scene): VFXMeshInstance | null {
    const inst = this.pool.find((i) => i.isDone());
    if (!inst) return null;
    inst.reset();
    scene.add(inst.mesh);
    return inst;
  }

  release(scene: THREE.Scene, instance: VFXMeshInstance): void {
    scene.remove(instance.mesh);
    instance.player.markDone();
  }

  disposeAll(): void {
    for (const inst of this.pool) inst.dispose();
    this.pool.length = 0;
  }
}
