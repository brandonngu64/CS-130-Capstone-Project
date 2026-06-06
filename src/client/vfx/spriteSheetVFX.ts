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

const PACK_DEFS: Record<string, VFXPackDef> = {
  ringOutFull: {
    jsonPaths: [
      '../../assets/vfx/ringOutFull/ringOutFull_MaxRectTrimNoRot-0.json',
      '../../assets/vfx/ringOutFull/ringOutFull_MaxRectTrimNoRot-1.json',
    ],
    pngPaths: [
      '../../assets/vfx/ringOutFull/ringOutFull_MaxRectTrimNoRot-0.png',
      '../../assets/vfx/ringOutFull/ringOutFull_MaxRectTrimNoRot-1.png',
    ],
  },
  ringOutBeam1: {
    jsonPaths: ['../../assets/vfx/ringOutBeam1/ringOutBeam1-0.json'],
    pngPaths: ['../../assets/vfx/ringOutBeam1/ringOutBeam1-0.png'],
  },
  ringOutBeam2: {
    jsonPaths: ['../../assets/vfx/ringOutBeam2/ringOutBeam2-0.json'],
    pngPaths: ['../../assets/vfx/ringOutBeam2/ringOutBeam2-0.png'],
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

  constructor(frames: FrameData[], atlasImages: HTMLImageElement[], color: number = 0xffffff) {
    this.frames = frames;
    this.atlasImages = atlasImages;

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
      color: color,
      depthWrite: false,
      map: this.canvasTexture,
      toneMapped: false,
      transparent: true,
    });
    this.mesh = new THREE.Mesh(geometry, material);

    this.drawFrame();
  }

  tick(): void {
    this.currentFrame += 1;
    if (this.currentFrame < this.frames.length) {
      this.drawFrame();
    }
  }

  isDone(): boolean {
    return this.currentFrame >= this.frames.length;
  }

  dispose(): void {
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
      this.packs.set(name, { frames, atlasImages: images });
    }

    return Promise.all(promises).then(() => {
      this.loaded = true;
    });
  }

  spawn(scene: THREE.Scene, color: number = 0xffffff): VFXInstance | null {
    if (!this.loaded || this.packs.size === 0) return null;

    const idx = Math.floor(Math.random() * this.packNames.length);
    const packName = this.packNames[idx];
    const pack = this.packs.get(packName);
    if (!pack || pack.frames.length === 0) return null;

    const c1 = new THREE.Color(color);
    const c2 = new THREE.Color(0xffffff);
    c1.lerp(c2, Math.random() * 0.2 + 0.4); // Adjust 0.5 for more/less tint (0 = pure color, 1 = white)

    const instance = new VFXInstance(pack.frames, pack.atlasImages, c1.getHex());
    scene.add(instance.mesh);
    return instance;
  }
}
