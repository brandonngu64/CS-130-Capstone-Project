type TiledProperty = {
  name: string;
  type?: string;
  value: unknown;
};

type TiledTileDefinition = {
  id: number;
  properties?: TiledProperty[];
};

type TiledTilesetReference = {
  firstgid: number;
  source?: string;
};

type TiledTileset = {
  columns?: number;
  firstgid?: number;
  image?: string;
  imageheight?: number;
  imagewidth?: number;
  margin?: number;
  name?: string;
  properties?: TiledProperty[];
  spacing?: number;
  tilecount?: number;
  tileheight: number;
  tilewidth: number;
  tiles?: TiledTileDefinition[];
  type?: string;
  version?: string;
};

type TiledObject = {
  id: number;
  name?: string;
  type?: string;
  visible?: boolean;
  x: number;
  y: number;
  width?: number;
  height?: number;
  gid?: number;
  point?: boolean;
  properties?: TiledProperty[];
};

type TiledLayer =
  | {
      type: 'tilelayer';
      name?: string;
      visible?: boolean;
      data?: number[];
      width: number;
      height: number;
      properties?: TiledProperty[];
    }
  | {
      type: 'objectgroup';
      name?: string;
      visible?: boolean;
      objects?: TiledObject[];
      properties?: TiledProperty[];
    }
  | {
      type: string;
      name?: string;
      visible?: boolean;
      properties?: TiledProperty[];
    };

type TiledMap = {
  height: number;
  layers: TiledLayer[];
  name?: string;
  tileheight: number;
  tilewidth: number;
  tilesets: TiledTilesetReference[];
  width: number;
};

type ResolvedTileset = {
  name: string;
  firstGid: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  imageWidth: number;
  imageHeight: number;
  tileCount: number;
  imageUrl?: string;
  tiles: Map<number, TiledTileDefinition>;
};

export type PropertyBag = Record<string, unknown>;

const FALLBACK_PLATFORM_TILE_IDS = new Set<number>([
  18,
  19,
  20,
  38,
  39,
  40,
  58,
  59,
  60,
]);

const MAP_MODULES = import.meta.glob('../assets/maps/*.{json,tmj}', {
  eager: true,
  import: 'default',
}) as Record<string, TiledMap>;

const TILESET_MODULES = import.meta.glob('../assets/tileset/*.{json,tsj}', {
  eager: true,
  import: 'default',
}) as Record<string, TiledTileset>;

const TILESET_IMAGE_MODULES = import.meta.glob(
  '../assets/tileset/*.{png,jpg,jpeg,webp}',
  {
    eager: true,
    import: 'default',
  },
) as Record<string, string>;

export type LevelTileKind = 'solid' | 'platform' | 'decoration';

export interface LevelTile {
  id: string;
  kind: LevelTileKind;
  x: number;
  y: number;
  width: number;
  height: number;
  tileId: number;
  gid: number;
  tilesetName: string;
  tilesetImageUrl?: string;
  layerName: string;
  properties: PropertyBag;
}

export interface LevelSpawnPoint {
  id: number;
  x: number;
  y: number;
  visible: boolean;
}

export interface LevelGunSpawn extends LevelSpawnPoint {
  gunType: string;
}

export interface LevelTilesetInfo {
  name: string;
  firstGid: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  imageWidth: number;
  imageHeight: number;
  tileCount: number;
  imageUrl?: string;
}

export interface LevelDefinition {
  id: string;
  name: string;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
  tilesets: LevelTilesetInfo[];
  tiles: LevelTile[];
  playerSpawns: LevelSpawnPoint[];
  itemSpawns: LevelSpawnPoint[];
  gunSpawns: LevelGunSpawn[];
}

const AVAILABLE_LEVEL_IDS = Object.keys(MAP_MODULES)
  .map((filePath) => normalizeAssetId(filePath))
  .sort((left, right) => left.localeCompare(right));

export const DEFAULT_LEVEL_ID = AVAILABLE_LEVEL_IDS[0] ?? 'testMap1';

export function getAvailableLevelIds(): string[] {
  return [...AVAILABLE_LEVEL_IDS];
}

export function loadLevelDefinition(levelId: string): LevelDefinition {
  const resolvedLevelId = resolveLevelId(levelId);
  const map = getMapById(resolvedLevelId);

  return buildLevelDefinition(resolvedLevelId, map);
}

function buildLevelDefinition(levelId: string, map: TiledMap): LevelDefinition {
  const tilesets = resolveTilesets(map);
  const tiles: LevelTile[] = [];
  const playerSpawns: LevelSpawnPoint[] = [];
  const itemSpawns: LevelSpawnPoint[] = [];
  const gunSpawns: LevelGunSpawn[] = [];

  for (const [layerIndex, layer] of map.layers.entries()) {
    if (layer.visible === false) {
      continue;
    }

    if (layer.type === 'tilelayer') {
      const tileLayer = layer as Extract<TiledLayer, { type: 'tilelayer' }>;
      const tileData = Array.isArray(tileLayer.data) ? tileLayer.data : [];
      const layerWidth = tileLayer.width || map.width;

      for (let index = 0; index < tileData.length; index += 1) {
        const rawGid = tileData[index] ?? 0;
        const gid = rawGid & 0x1fffffff;
        if (gid === 0) {
          continue;
        }

        const resolvedTileset = resolveTilesetForGid(tilesets, gid);
        if (!resolvedTileset) {
          continue;
        }

        const localTileId = gid - resolvedTileset.firstGid;
        const tileDefinition = resolvedTileset.tiles.get(localTileId);
        const properties = propertiesToBag(tileDefinition?.properties);

        const column = index % layerWidth;
        const row = Math.floor(index / layerWidth);
        const role = resolveTileRole(properties);

        if (role === 'player_spawn' || role === 'item_spawn') {
          const tileSpawnId = layerIndex * map.width * map.height + index;
          const spawn = {
            id: tileSpawnId,
            x: column - map.width / 2 + 0.5,
            y: map.height / 2 - row - 0.5,
            visible: readBoolean(properties, 'visible'),
          };

          if (role === 'player_spawn') {
            playerSpawns.push({
              ...spawn,
              visible: false,
            });
          } else {
            itemSpawns.push(spawn);
          }

          continue;
        }

        const kind = resolveTileKind(properties, localTileId);

        tiles.push({
          id: `${levelId}:layer-${layerIndex}:tile-${index}`,
          kind,
          x: column - map.width / 2 + 0.5,
          y: map.height / 2 - row - 0.5,
          width: 1,
          height: 1,
          tileId: localTileId,
          gid,
          tilesetName: resolvedTileset.name,
          tilesetImageUrl: resolvedTileset.imageUrl,
          layerName: tileLayer.name ?? `layer-${layerIndex}`,
          properties,
        });
      }
      continue;
    }

    if (layer.type === 'objectgroup') {
      const objectLayer = layer as Extract<TiledLayer, { type: 'objectgroup' }>;
      for (const object of objectLayer.objects ?? []) {
        const properties = propertiesToBag(object.properties);
        const objectKind = resolveObjectKind(object, properties);
        if (!objectKind) {
          continue;
        }

        const centerX = object.x + (object.width ?? 0) * 0.5;
        const centerY = object.y + (object.height ?? 0) * 0.5;
        const worldX = centerX / map.tilewidth - map.width / 2;
        const worldY = map.height / 2 - centerY / map.tileheight;
        const visible = object.visible !== false;

        if (objectKind === 'player_spawn') {
          playerSpawns.push({
            id: object.id,
            x: worldX,
            y: worldY,
            visible: false,
          });
          continue;
        }

        if (objectKind === 'item_spawn') {
          itemSpawns.push({
            id: object.id,
            x: worldX,
            y: worldY,
            visible: object.visible !== false,
          });
          continue;
        }

        gunSpawns.push({
          id: object.id,
          x: worldX,
          y: worldY,
          visible,
          gunType: readString(properties, 'gunType') ?? 'pistol',
        });
      }
    }
  }

  return {
    id: levelId,
    name: map.name ?? levelId,
    width: map.width,
    height: map.height,
    tileWidth: map.tilewidth,
    tileHeight: map.tileheight,
    bounds: {
      minX: -map.width / 2,
      maxX: map.width / 2,
      minY: -map.height / 2,
      maxY: map.height / 2,
    },
    tilesets,
    tiles,
    playerSpawns,
    itemSpawns,
    gunSpawns,
  };
}

function resolveTilesets(map: TiledMap): ResolvedTileset[] {
  const resolved = map.tilesets
    .map((reference) => resolveTileset(reference))
    .filter((tileset): tileset is ResolvedTileset => tileset !== null)
    .sort((left, right) => left.firstGid - right.firstGid);

  if (resolved.length > 0) {
    return resolved;
  }

  const fallbackPath = Object.keys(TILESET_MODULES)[0];
  if (!fallbackPath) {
    return [];
  }

  const tileset = TILESET_MODULES[fallbackPath];
  return [resolveTilesetDefinition(tileset, tileset.firstgid ?? 1, tileset.name)];
}

function resolveTileset(reference: TiledTilesetReference): ResolvedTileset | null {
  const sourceId = normalizeAssetId(reference.source ?? '');
  const modulePath = sourceId ? findModulePath(TILESET_MODULES, sourceId) : null;

  if (modulePath) {
    return resolveTilesetDefinition(
      TILESET_MODULES[modulePath],
      reference.firstgid,
      sourceId,
    );
  }

  const fallbackPath = Object.keys(TILESET_MODULES)[0];
  if (!fallbackPath) {
    return null;
  }

  return resolveTilesetDefinition(
    TILESET_MODULES[fallbackPath],
    reference.firstgid,
    sourceId || normalizeAssetId(TILESET_MODULES[fallbackPath].name ?? fallbackPath),
  );
}

function resolveTilesetDefinition(
  tileset: TiledTileset,
  firstGid: number,
  fallbackName: string | undefined,
): ResolvedTileset {
  const name = normalizeAssetId(tileset.name ?? fallbackName ?? 'tileset');
  const imageUrl = resolveImageUrl(tileset.image);
  const columns = tileset.columns ?? 1;
  const tileCount = tileset.tilecount ?? tileset.tiles?.length ?? 0;
  const imageWidth = tileset.imagewidth ?? tileset.tilewidth * Math.max(columns, 1);
  const imageHeight =
    tileset.imageheight ??
    tileset.tileheight * Math.max(Math.ceil(tileCount / Math.max(columns, 1)), 1);
  const tiles = new Map<number, TiledTileDefinition>();

  for (const tile of tileset.tiles ?? []) {
    tiles.set(tile.id, tile);
  }

  return {
    name,
    firstGid,
    tileWidth: tileset.tilewidth,
    tileHeight: tileset.tileheight,
    columns,
    imageWidth,
    imageHeight,
    tileCount,
    imageUrl,
    tiles,
  };
}

function resolveTilesetForGid(
  tilesets: ResolvedTileset[],
  gid: number,
): ResolvedTileset | null {
  let candidate: ResolvedTileset | null = null;

  for (const tileset of tilesets) {
    if (tileset.firstGid <= gid) {
      candidate = tileset;
    }
  }

  return candidate;
}

function resolveTileKind(
  properties: PropertyBag | undefined,
  localTileId: number,
): LevelTileKind {
  if (readBoolean(properties, 'visible') === false) {
    return 'decoration';
  }

  const collisionType = readNumber(properties, 'collision_type');
  if (collisionType === 1) {
    return 'platform';
  }

  if (collisionType === 2) {
    return 'solid';
  }

  if (collisionType === 0) {
    return 'decoration';
  }

  const explicitKind = readString(properties, 'kind') ?? readString(properties, 'type');
  const normalizedKind = explicitKind?.toLowerCase();

  if (normalizedKind === 'platform' || normalizedKind === 'oneway') {
    return 'platform';
  }

  if (
    normalizedKind === 'decoration' ||
    normalizedKind === 'decor' ||
    normalizedKind === 'visual'
  ) {
    return 'decoration';
  }

  if (
    normalizedKind === 'collision' ||
    normalizedKind === 'solid' ||
    normalizedKind === 'block'
  ) {
    return 'solid';
  }

  if (readBoolean(properties, 'platform')) {
    return 'platform';
  }

  if (readBoolean(properties, 'collision') || readBoolean(properties, 'solid')) {
    return 'solid';
  }

  if (readBoolean(properties, 'decoration') || readBoolean(properties, 'decor')) {
    return 'decoration';
  }

  if (FALLBACK_PLATFORM_TILE_IDS.has(localTileId)) {
    return 'platform';
  }

  return 'solid';
}

function resolveTileRole(
  properties: PropertyBag | undefined,
): 'player_spawn' | 'item_spawn' | null {
  const role = readString(properties, 'type')?.toLowerCase();

  if (role === 'player_spawn') {
    return 'player_spawn';
  }

  if (role === 'item_spawn') {
    return 'item_spawn';
  }

  return null;
}

function resolveObjectKind(
  object: TiledObject,
  properties: PropertyBag,
): 'player_spawn' | 'item_spawn' | 'gun_spawn' | null {
  const declaredKind =
    readString(properties, 'kind') ??
    readString(properties, 'type') ??
    object.type ??
    object.name;

  const normalizedKind = declaredKind?.toLowerCase();
  if (!normalizedKind) {
    return null;
  }

  if (normalizedKind.includes('player')) {
    return 'player_spawn';
  }

  if (normalizedKind.includes('item')) {
    return 'item_spawn';
  }

  if (normalizedKind.includes('gun')) {
    return 'gun_spawn';
  }

  return null;
}

function resolveImageUrl(imagePath?: string): string | undefined {
  if (!imagePath) {
    return undefined;
  }

  const imageId = normalizeAssetId(imagePath);
  const modulePath = findModulePath(TILESET_IMAGE_MODULES, imageId);
  return modulePath ? TILESET_IMAGE_MODULES[modulePath] : undefined;
}

function readString(properties: PropertyBag | undefined, name: string): string | undefined {
  const value = properties?.[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readBoolean(properties: PropertyBag | undefined, name: string): boolean {
  const value = properties?.[name];
  return typeof value === 'boolean' ? value : false;
}

function readNumber(properties: PropertyBag | undefined, name: string): number | undefined {
  const value = properties?.[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function propertiesToBag(properties: TiledProperty[] | undefined): PropertyBag {
  const bag: PropertyBag = {};

  for (const property of properties ?? []) {
    bag[property.name] = property.value;
  }

  return bag;
}

function resolveLevelId(levelId: string): string {
  const normalizedId = normalizeAssetId(levelId);
  if (AVAILABLE_LEVEL_IDS.includes(normalizedId)) {
    return normalizedId;
  }

  return DEFAULT_LEVEL_ID;
}

function getMapById(levelId: string): TiledMap {
  const modulePath = findModulePath(MAP_MODULES, levelId);
  if (modulePath) {
    return MAP_MODULES[modulePath];
  }

  const fallbackPath = findModulePath(MAP_MODULES, DEFAULT_LEVEL_ID);
  if (fallbackPath) {
    return MAP_MODULES[fallbackPath];
  }

  throw new Error(`Unable to locate map asset for ${levelId}`);
}

function findModulePath<T>(modules: Record<string, T>, assetId: string): string | null {
  const normalizedTarget = normalizeAssetId(assetId);

  for (const modulePath of Object.keys(modules)) {
    if (normalizeAssetId(modulePath) === normalizedTarget) {
      return modulePath;
    }
  }

  return null;
}

function normalizeAssetId(value: string): string {
  const fileName = value.split(/[\\/]/).pop() ?? value;
  return fileName.replace(/\.[^.]+$/, '').toLowerCase();
}