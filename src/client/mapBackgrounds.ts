// Parallax background registry.
//
// Edit MAP_BACKGROUND_CONFIG below to assign a background asset to a map id
// (the map id matches the basename of src/assets/maps/<id>.json).
//
// Supported formats: .jpg, .jpeg, .png, .gif, .mp4
// NOTE: GIFs render as their first frame only (three.js TextureLoader does
// not animate them). Convert to mp4 if you need animation.

const BACKGROUND_URL_MODULES = import.meta.glob('../assets/map_bgs/*', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export interface MapBackgroundConfig {
  /** Filename in src/assets/map_bgs (with extension). */
  asset: string;
  /** Distance behind the map plane in world units. Larger = slower parallax = deeper. */
  depth: number;
  /** Optional scale multiplier (default 1). Oversize the bg so it doesn't reveal edges. */
  scale?: number;
  /** Optional tint (default 0xffffff). */
  tint?: number;
  /** Optional opacity (default 1). */
  opacity?: number;
}

export const MAP_BACKGROUND_CONFIG: Record<string, MapBackgroundConfig> = {
  'finalDestV3_brawl': { asset: 'finalDestV3_brawl.mp4', depth: 80, scale: 1.2 },
};

function normalizeAssetKey(value: string): string {
  const normalizedPath = value.replace(/\\/g, '/');
  const basename = normalizedPath.split('/').pop() ?? normalizedPath;
  return basename.replace(/\.[^.]+$/, '');
}

export function getMapBackground(mapId: string): MapBackgroundConfig | null {
  const key = normalizeAssetKey(mapId);
  return MAP_BACKGROUND_CONFIG[key] ?? null;
}

export function resolveBackgroundUrl(asset: string): string | null {
  const target = asset.replace(/\\/g, '/').split('/').pop() ?? asset;
  for (const [path, url] of Object.entries(BACKGROUND_URL_MODULES)) {
    const basename = path.replace(/\\/g, '/').split('/').pop();
    if (basename === target) {
      return url;
    }
  }
  return null;
}

export type BackgroundAssetKind = 'image' | 'video';

export function classifyBackgroundAsset(asset: string): BackgroundAssetKind | null {
  const ext = asset.toLowerCase().split('.').pop();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
      return 'image';
    case 'mp4':
      return 'video';
    default:
      return null;
  }
}
