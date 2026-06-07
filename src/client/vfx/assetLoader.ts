import * as THREE from 'three';
import type { VFXPackDef } from './packs';

export type FrameData = {
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

function extractFrameNumber(name: string): number {
  const m = name.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function buildFrameList(def: VFXPackDef): { frames: FrameData[]; atlasSizes: { w: number; h: number }[] } {
  const frames: FrameData[] = [];
  const atlasSizes: { w: number; h: number }[] = [];

  for (let i = 0; i < def.jsonPaths.length; i++) {
    const jsonData = VFX_JSON_MODULES[def.jsonPaths[i]];
    if (!jsonData) {
      atlasSizes.push({ w: 1, h: 1 });
      continue;
    }
    atlasSizes.push(jsonData.meta.size);
    for (const [name, entry] of Object.entries(jsonData.frames)) {
      frames.push({
        name,
        atlasIndex: i,
        frame: entry.frame,
        rotated: entry.rotated,
        spriteSourceSize: entry.spriteSourceSize,
        sourceSize: entry.sourceSize,
      });
    }
  }

  frames.sort((a, b) => extractFrameNumber(a.name) - extractFrameNumber(b.name));
  return { frames, atlasSizes };
}

async function decodeAtlas(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  const blob = await response.blob();
  return createImageBitmap(blob, { imageOrientation: 'none', premultiplyAlpha: 'default' });
}

export class VFXAsset {
  readonly frames: FrameData[];
  readonly atlases: ImageBitmap[];
  readonly atlasSizes: { w: number; h: number }[];
  readonly designSize: { w: number; h: number };
  private textures: THREE.Texture[] | null = null;
  private disposed = false;

  private constructor(
    frames: FrameData[],
    atlases: ImageBitmap[],
    atlasSizes: { w: number; h: number }[],
  ) {
    this.frames = frames;
    this.atlases = atlases;
    this.atlasSizes = atlasSizes;
    this.designSize = frames[0]?.sourceSize ?? { w: 256, h: 256 };
  }

  static async load(def: VFXPackDef): Promise<VFXAsset> {
    const { frames, atlasSizes } = buildFrameList(def);
    const atlases = await Promise.all(
      def.pngPaths.map((path) => {
        const url = VFX_PNG_URLS[path];
        if (!url) return Promise.reject(new Error(`Missing VFX atlas asset: ${path}`));
        return decodeAtlas(url);
      }),
    );
    return new VFXAsset(frames, atlases, atlasSizes);
  }

  // Lazy-build THREE.Textures from ImageBitmaps. Each atlas page becomes one
  // GPU texture, uploaded exactly once and kept until dispose().
  ensureTextures(): THREE.Texture[] {
    if (this.disposed) throw new Error('VFXAsset used after dispose');
    if (this.textures) return this.textures;
    this.textures = this.atlases.map((bitmap) => {
      const tex = new THREE.Texture(bitmap as unknown as HTMLImageElement);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.flipY = false;
      tex.needsUpdate = true;
      return tex;
    });
    return this.textures;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.textures) {
      for (const tex of this.textures) tex.dispose();
      this.textures = null;
    }
    for (const bitmap of this.atlases) {
      try { bitmap.close(); } catch { /* ignore */ }
    }
  }
}
