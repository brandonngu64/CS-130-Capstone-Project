import * as THREE from 'three';
import { PLAYER_HALF_HEIGHT } from '../constants';

type FrameData = {
  name: string;
  atlasIndex: number;
  frame: { x: number; y: number; w: number; h: number };
  rotated: boolean;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
};

type TexturePackerJson = {
  frames: Record<string, {
    frame: { x: number; y: number; w: number; h: number };
    rotated: boolean;
    trimmed: boolean;
    spriteSourceSize: { x: number; y: number; w: number; h: number };
    sourceSize: { w: number; h: number };
  }>;
  meta: {
    image: string;
    size: { w: number; h: number };
    related_multi_packs?: string[];
  };
};

const VFX_JSON_MODULES = import.meta.glob('../../assets/vfx/**/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, TexturePackerJson>;

const VFX_PNG_URLS = import.meta.glob('../../assets/vfx/**/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

type VFXPackDef = {
  jsonPaths: string[];
  pngPaths: string[];
};

const VFX_ANIM_FPS = 60; // animation playback rate; lower = slower/more visible
const POOL_SIZE = 3;    // pre-allocated instances per pack; no new allocs after load

const PACK_DEFS: Record<string, VFXPackDef> = {
  ringOutFull: {
    jsonPaths: [
      '../../assets/vfx/ringOutFull/ringOutFullFix-0.json',
      '../../assets/vfx/ringOutFull/ringOutFullFix-1.json',
      '../../assets/vfx/ringOutFull/ringOutFullFix-2.json'
    ],
    pngPaths: [
      '../../assets/vfx/ringOutFull/ringOutFullFix-0.png',
      '../../assets/vfx/ringOutFull/ringOutFullFix-1.png',
      '../../assets/vfx/ringOutFull/ringOutFullFix-2.png',
    ],
  },
};

function extractFrameNumber(name: string): number {
  const m = name.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function buildFrameList(def: VFXPackDef): FrameData[] {
  const pooled: FrameData[] = [];

  for (let i = 0; i < def.jsonPaths.length; i++) {
    const jsonData = VFX_JSON_MODULES[def.jsonPaths[i]];
    if (!jsonData) continue;

    for (const [name, entry] of Object.entries(jsonData.frames)) {
      pooled.push({
        name,
        atlasIndex: i,
        frame: entry.frame,
        rotated: entry.rotated,
        spriteSourceSize: entry.spriteSourceSize,
        sourceSize: entry.sourceSize,
      });
    }
  }

  pooled.sort((a, b) => extractFrameNumber(a.name) - extractFrameNumber(b.name));
  return pooled;
}

// 3.5× the player's display height gives a dramatic ring-out scale
const VFX_WORLD_SCALE = PLAYER_HALF_HEIGHT * 2 * (Math.random() * 5 + 10); // CHANGES SIZE OF VFX

export class VFXInstance {
  readonly mesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvasTexture: THREE.CanvasTexture;
  private readonly frames: FrameData[];
  private readonly atlasImages: HTMLImageElement[];
  private currentFrame = 0;
  private tickAccumulator = 0;
  private readonly frameRate: number; // anim frames per game tick

  // startIdle=true marks it as "done" so the pool can pick it up immediately
  constructor(frames: FrameData[], atlasImages: HTMLImageElement[], animFps = VFX_ANIM_FPS, startIdle = false) {
    this.frames = frames;
    this.atlasImages = atlasImages;
    this.frameRate = animFps / 60;

    const src = frames[0]?.sourceSize ?? { w: 256, h: 256 };
    this.canvas = document.createElement('canvas');
    this.canvas.width = src.w;
    this.canvas.height = src.h;
    this.ctx = this.canvas.getContext('2d')!;

    this.canvasTexture = new THREE.CanvasTexture(this.canvas);
    this.canvasTexture.minFilter = THREE.NearestFilter;
    this.canvasTexture.magFilter = THREE.NearestFilter;

    const worldPerPixel = VFX_WORLD_SCALE / src.h;
    const planeW = src.w * worldPerPixel;
    const planeH = src.h * worldPerPixel;

    const geometry = new THREE.PlaneGeometry(planeW, planeH);
    const material = new THREE.MeshBasicMaterial({
      alphaTest: 0.01,
      depthWrite: false,
      map: this.canvasTexture,
      toneMapped: false,
      transparent: true,
    });
    this.mesh = new THREE.Mesh(geometry, material);

    if (startIdle) {
      this.currentFrame = frames.length; // available in pool, not playing
    } else {
      this.drawFrame();
    }
  }

  tick(): void {
    this.tickAccumulator += this.frameRate;
    const nextFrame = Math.floor(this.tickAccumulator);
    if (nextFrame > this.currentFrame && this.currentFrame < this.frames.length) {
      this.currentFrame = nextFrame;
      if (this.currentFrame < this.frames.length) {
        this.drawFrame();
      }
    }
  }

  isDone(): boolean {
    return this.currentFrame >= this.frames.length;
  }

  reset(): void {
    this.currentFrame = 0;
    this.tickAccumulator = 0;
    this.drawFrame();
  }

  disposeResources(): void {
    this.canvasTexture.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  private drawFrame(): void {
    const f = this.frames[this.currentFrame];
    if (!f) return;

    const img = this.atlasImages[f.atlasIndex];
    if (!img?.complete) return;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (f.rotated) {
      // Atlas stores the sprite rotated 90° CW (physical region is frame.h wide × frame.w tall).
      // Rotate the canvas context -90° (CCW) to restore the original orientation.
      const cx = f.spriteSourceSize.x + f.frame.w / 2;
      const cy = f.spriteSourceSize.y + f.frame.h / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(
        img,
        f.frame.x, f.frame.y, f.frame.h, f.frame.w,
        -f.frame.h / 2, -f.frame.w / 2, f.frame.h, f.frame.w,
      );
      ctx.restore();
    } else {
      ctx.drawImage(
        img,
        f.frame.x, f.frame.y, f.frame.w, f.frame.h,
        f.spriteSourceSize.x, f.spriteSourceSize.y, f.frame.w, f.frame.h,
      );
    }

    this.canvasTexture.needsUpdate = true;
  }
}

type LoadedPack = {
  frames: FrameData[];
  atlasImages: HTMLImageElement[];
  pool: VFXInstance[];
};

export class SpriteSheetVFXManager {
  private readonly packs = new Map<string, LoadedPack>();
  private readonly packNames = Object.keys(PACK_DEFS);
  private loaded = false;

  load(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [name, def] of Object.entries(PACK_DEFS)) {
      const frames = buildFrameList(def);
      const images: HTMLImageElement[] = def.pngPaths.map((path) => {
        const img = new Image();
        const url = VFX_PNG_URLS[path];
        const p = new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });
        if (url) img.src = url;
        promises.push(p);
        return img;
      });

      const pool: VFXInstance[] = [];
      for (let i = 0; i < POOL_SIZE; i++) {
        pool.push(new VFXInstance(frames, images, VFX_ANIM_FPS, true));
      }
      this.packs.set(name, { frames, atlasImages: images, pool });
    }

    return Promise.all(promises).then(() => {
      this.loaded = true;
    });
  }

  spawn(scene: THREE.Scene, _color?: number): VFXInstance | null {
    if (!this.loaded || this.packs.size === 0) return null;

    const startIdx = Math.floor(Math.random() * this.packNames.length);
    for (let i = 0; i < this.packNames.length; i++) {
      const packName = this.packNames[(startIdx + i) % this.packNames.length];
      const pack = this.packs.get(packName);
      if (!pack || pack.frames.length === 0) continue;

      const instance = pack.pool.find(inst => inst.isDone());
      if (!instance) continue;

      instance.reset();
      scene.add(instance.mesh);
      return instance;
    }
    return null;
  }

  release(scene: THREE.Scene, vfx: VFXInstance): void {
    scene.remove(vfx.mesh);
    // instance stays in pool for reuse; no GPU resources freed
  }

  disposeAll(): void {
    for (const pack of this.packs.values()) {
      for (const instance of pack.pool) {
        instance.disposeResources();
      }
    }
    this.packs.clear();
    this.loaded = false;
  }
}
