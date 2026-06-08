type RawTiledProperty = {
  name: string;
  type: string;
  value: string | number | boolean;
};

type RawTiledTilesetTile = {
  id: number;
  properties?: RawTiledProperty[];
};

type RawTiledTileset = {
  columns: number;
  image: string;
  imageheight: number;
  imagewidth: number;
  margin?: number;
  name: string;
  spacing?: number;
  tilecount: number;
  tileheight: number;
  tiles?: RawTiledTilesetTile[];
  tilewidth: number;
};

type RawTiledMapTilesetRef = {
  firstgid: number;
  source?: string;
};

type RawTiledLayer = {
  data: number[];
  height: number;
  name: string;
  opacity?: number;
  tintcolor?: string;
  type: string;
  visible?: boolean;
  width: number;
};

type RawTiledMap = {
  height: number;
  layers: RawTiledLayer[];
  name?: string;
  tileheight: number;
  tilesets: RawTiledMapTilesetRef[];
  tilewidth: number;
  width: number;
};

export type TileCollision = 0 | 1 | 2;

export type TileSpecialRole = string | null;

export type TilePropertyValue = string | number | boolean;

export interface MapManifest {
  id: string;
  name: string;
  width: number;
  height: number;
}

export interface UvRect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

export interface ResolvedTileset {
  atlasUrl: string;
  columns: number;
  firstGid: number;
  id: string;
  imageWidth: number;
  imageHeight: number;
  lastGid: number;
  margin: number;
  name: string;
  rows: number;
  spacing: number;
  tileCount: number;
  tileHeight: number;
  tileWidth: number;
}

export interface TileMetadata {
  collision: TileCollision;
  renderVisible: boolean;
  specialRole: TileSpecialRole;
  uv: UvRect;
  visible: boolean;
  zLayerPos: number;
}

export interface MapTileInstance {
  atlasUrl: string;
  collision: TileCollision;
  globalId: number;
  layerIndex: number;
  layerName: string;
  opacity: number;
  renderVisible: boolean;
  specialRole: TileSpecialRole;
  tileX: number;
  tileY: number;
  tilesetId: string;
  tintColor: number | null;
  uv: UvRect;
  x: number;
  y: number;
  z: number;
  zLayerPos: number;
}

export interface MapLayerInstance {
  index: number;
  name: string;
  opacity: number;
  renderVisible: boolean;
  tiles: MapTileInstance[];
  tintColor: number | null;
}

export interface MapColliderRect {
  kind: 'solid' | 'platform';
  height: number;
  layerName: string;
  tileCount: number;
  width: number;
  x: number;
  y: number;
}

export interface MapSpawnPoint {
  feetY: number;
  layerName: string;
  role: 'player_spawn' | 'item_spawn';
  tileX: number;
  tileY: number;
  x: number;
  y: number;
}

export interface MapBounds {
  height: number;
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
  width: number;
}

export interface BlastZoneOffsets {
  up: number;
  down: number;
  side: number;
}

export function expandMapBounds(bounds: MapBounds, offsets: BlastZoneOffsets): MapBounds {
  return {
    minX: bounds.minX - offsets.side,
    maxX: bounds.maxX + offsets.side,
    minY: bounds.minY - offsets.down,
    maxY: bounds.maxY + offsets.up,
    width: bounds.width + offsets.side * 2,
    height: bounds.height + offsets.up + offsets.down,
  };
}

export interface TiledMapDefinition {
  bounds: MapBounds;
  colliders: {
    platforms: MapColliderRect[];
    solids: MapColliderRect[];
  };
  height: number;
  id: string;
  itemSpawnPoints: MapSpawnPoint[];
  layers: MapLayerInstance[];
  name: string;
  playerSpawnPoints: MapSpawnPoint[];
  tileHeight: number;
  tileWidth: number;
  tiles: MapTileInstance[];
  tilesets: ResolvedTileset[];
  width: number;
}

const RAW_MAP_MODULES = import.meta.glob('../assets/maps/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, RawTiledMap>;

const RAW_TILESET_MODULES = import.meta.glob('../assets/tilemap/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, RawTiledTileset>;

const ATLAS_MODULES = import.meta.glob('../assets/tilemap/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const MAP_CACHE = new Map<string, TiledMapDefinition>();

function normalizeAssetKey(value: string): string {
  const normalizedPath = value.replace(/\\/g, '/');
  const basename = normalizedPath.split('/').pop() ?? normalizedPath;
  return basename.replace(/\.[^.]+$/, '');
}

function parsePropertyValue(value: unknown): TilePropertyValue | undefined {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  return undefined;
}

function parseProperties(properties: RawTiledProperty[] | undefined): Record<string, TilePropertyValue> {
  const output: Record<string, TilePropertyValue> = {};

  for (const property of properties ?? []) {
    const parsed = parsePropertyValue(property.value);
    if (parsed !== undefined) {
      output[property.name] = parsed;
    }
  }

  return output;
}

function parseColorValue(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().replace(/^#/, '');
  const hex = normalized.length === 8 ? normalized.slice(2) : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return null;
  }

  return Number.parseInt(hex, 16);
}

function parseCollisionValue(value: unknown): TileCollision {
  if (value === 1 || value === 2) {
    return value;
  }

  return 0;
}

function createUvRect(tileset: ResolvedTileset, localId: number): UvRect {
  const column = localId % tileset.columns;
  const row = Math.floor(localId / tileset.columns);
  const pixelX = tileset.margin + column * (tileset.tileWidth + tileset.spacing);
  const pixelY = tileset.margin + row * (tileset.tileHeight + tileset.spacing);

  const u0 = (pixelX + 0.5) / tileset.imageWidth;
  const u1 = (pixelX + tileset.tileWidth - 0.5) / tileset.imageWidth;
  const v1 = 1 - (pixelY + 0.5) / tileset.imageHeight;
  const v0 = 1 - (pixelY + tileset.tileHeight - 0.5) / tileset.imageHeight;

  return { u0, u1, v0, v1 };
}

function resolveAtlasUrl(rawImage: string, fallbackKey: string): string {
  const imageKey = normalizeAssetKey(rawImage);
  const atlasKey =
    Object.keys(ATLAS_MODULES).find((key) => normalizeAssetKey(key) === imageKey) ??
    Object.keys(ATLAS_MODULES).find((key) => normalizeAssetKey(key) === fallbackKey) ??
    '';

  const atlas = atlasKey ? ATLAS_MODULES[atlasKey] : null;
  if (!atlas) {
    throw new Error(
      `Unable to resolve atlas image for tileset ${fallbackKey} (${rawImage})`,
    );
  }

  return atlas;
}

function resolveTilesetRecord(ref: RawTiledMapTilesetRef): ResolvedTileset {
  const sourceKey = ref.source ? normalizeAssetKey(ref.source) : '';
  const tilesetModuleKey =
    Object.keys(RAW_TILESET_MODULES).find(
      (key) => normalizeAssetKey(key) === sourceKey,
    ) ??
    Object.keys(RAW_TILESET_MODULES).find(
      (key) => normalizeAssetKey(RAW_TILESET_MODULES[key].name) === sourceKey,
    );

  if (!tilesetModuleKey) {
    throw new Error(`Unable to resolve tileset source for ${ref.source ?? '(missing source)'}`);
  }

  const rawTileset = RAW_TILESET_MODULES[tilesetModuleKey];
  const id = rawTileset.name?.trim() || normalizeAssetKey(tilesetModuleKey);
  const atlasUrl = resolveAtlasUrl(rawTileset.image, id);
  const rows = Math.max(1, Math.ceil(rawTileset.tilecount / rawTileset.columns));

  return {
    atlasUrl,
    columns: rawTileset.columns,
    firstGid: ref.firstgid,
    id,
    imageHeight: rawTileset.imageheight,
    imageWidth: rawTileset.imagewidth,
    lastGid: ref.firstgid + rawTileset.tilecount - 1,
    margin: rawTileset.margin ?? 0,
    name: rawTileset.name,
    rows,
    spacing: rawTileset.spacing ?? 0,
    tileCount: rawTileset.tilecount,
    tileHeight: rawTileset.tileheight,
    tileWidth: rawTileset.tilewidth,
  };
}

function buildTileMetadata(tileset: ResolvedTileset, localId: number): TileMetadata {
  const rawTilesetModule = Object.values(RAW_TILESET_MODULES).find(
    (entry) => normalizeAssetKey(entry.name) === tileset.id,
  );
  const sourceTile = rawTilesetModule?.tiles?.find((tile) => tile.id === localId);
  const properties = parseProperties(sourceTile?.properties);
  const visible = properties.visible !== false;
  const specialRole =
    typeof properties.special_role === 'string' ? properties.special_role : null;
  const zLayerPos = typeof properties.z_layer_pos === 'number' ? properties.z_layer_pos : 0;
  const collision = visible ? parseCollisionValue(properties.collision) : 0;

  return {
    collision,
    renderVisible:
      visible && specialRole !== 'player_spawn' && specialRole !== 'item_spawn',
    specialRole,
    uv: createUvRect(tileset, localId),
    visible,
    zLayerPos,
  };
}

function resolveTileMetadataByGlobalId(
  tilesets: ResolvedTileset[],
): Map<number, { metadata: TileMetadata; tileset: ResolvedTileset; localId: number }> {
  const lookup = new Map<number, { metadata: TileMetadata; tileset: ResolvedTileset; localId: number }>();

  for (const tileset of tilesets) {
    for (let localId = 0; localId < tileset.tileCount; localId += 1) {
      const globalId = tileset.firstGid + localId;
      lookup.set(globalId, {
        metadata: buildTileMetadata(tileset, localId),
        tileset,
        localId,
      });
    }
  }

  return lookup;
}

function computeLayerZ(rawIndex: number, levelLayerIndex: number, totalLayers: number): number {
  if (rawIndex === levelLayerIndex) {
    return 0;
  }

  if (rawIndex < levelLayerIndex) {
    // Background layers: z from -0.9 (backmost) to -0.1 (just behind level_layer)
    const t = levelLayerIndex > 1 ? rawIndex / (levelLayerIndex - 1) : 0;
    return -0.9 + t * 0.8;
  }

  // Foreground layers: z from 0.6 (just in front of players ~0.35–0.5) to 1.0 (frontmost)
  const fgCount = totalLayers - levelLayerIndex - 1;
  const t = fgCount > 1 ? (rawIndex - levelLayerIndex - 1) / (fgCount - 1) : 0;
  return 0.6 + t * 0.4;
}

function buildMapBounds(width: number, height: number): MapBounds {
  return {
    height,
    maxX: width / 2,
    maxY: height / 2,
    minX: -width / 2,
    minY: -height / 2,
    width,
  };
}

function collectLayerGrid(
  width: number,
  height: number,
  tiles: MapTileInstance[],
  kind: 'solid' | 'platform',
): boolean[][] {
  const grid = Array.from({ length: height }, () => Array<boolean>(width).fill(false));

  for (const tile of tiles) {
    if (tile.collision !== (kind === 'solid' ? 2 : 1)) {
      continue;
    }

    grid[tile.tileY][tile.tileX] = true;
  }

  return grid;
}

function mergeSolidRects(
  width: number,
  height: number,
  tiles: MapTileInstance[],
): MapColliderRect[] {
  const grid = collectLayerGrid(width, height, tiles, 'solid');
  const rects: MapColliderRect[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!grid[y][x]) {
        continue;
      }

      let rectWidth = 1;
      while (x + rectWidth < width && grid[y][x + rectWidth]) {
        rectWidth += 1;
      }

      let rectHeight = 1;
      let canExpand = true;
      while (y + rectHeight < height && canExpand) {
        for (let dx = 0; dx < rectWidth; dx += 1) {
          if (!grid[y + rectHeight][x + dx]) {
            canExpand = false;
            break;
          }
        }

        if (canExpand) {
          rectHeight += 1;
        }
      }

      for (let dy = 0; dy < rectHeight; dy += 1) {
        for (let dx = 0; dx < rectWidth; dx += 1) {
          grid[y + dy][x + dx] = false;
        }
      }

      rects.push({
        height: rectHeight,
        kind: 'solid',
        layerName: 'level_layer',
        tileCount: rectWidth * rectHeight,
        width: rectWidth,
        x: x + rectWidth / 2 - width / 2,
        y: height / 2 - y - rectHeight / 2,
      });
    }
  }

  return rects;
}

function mergePlatformRects(
  width: number,
  height: number,
  tiles: MapTileInstance[],
): MapColliderRect[] {
  const grid = collectLayerGrid(width, height, tiles, 'platform');
  const rects: MapColliderRect[] = [];

  for (let y = 0; y < height; y += 1) {
    let x = 0;
    while (x < width) {
      if (!grid[y][x]) {
        x += 1;
        continue;
      }

      let rectWidth = 1;
      while (x + rectWidth < width && grid[y][x + rectWidth]) {
        rectWidth += 1;
      }

      for (let dx = 0; dx < rectWidth; dx += 1) {
        grid[y][x + dx] = false;
      }

      rects.push({
        height: 1,
        kind: 'platform',
        layerName: 'level_layer',
        tileCount: rectWidth,
        width: rectWidth,
        x: x + rectWidth / 2 - width / 2,
        y: height / 2 - y - 0.5,
      });

      x += rectWidth;
    }
  }

  return rects;
}

function collectSpawnPoints(tiles: MapTileInstance[]): {
  itemSpawnPoints: MapSpawnPoint[];
  playerSpawnPoints: MapSpawnPoint[];
} {
  const playerSpawnPoints: MapSpawnPoint[] = [];
  const itemSpawnPoints: MapSpawnPoint[] = [];

  for (const tile of tiles) {
    if (tile.layerName !== 'level_layer') {
      continue;
    }

    const role = tile.specialRole;
    if (role !== 'player_spawn' && role !== 'item_spawn') {
      continue;
    }

    const spawnPoint: MapSpawnPoint = {
      feetY: tile.y - 0.5,
      layerName: tile.layerName,
      role,
      tileX: tile.tileX,
      tileY: tile.tileY,
      x: tile.x,
      y: tile.y,
    };

    if (role === 'player_spawn') {
      playerSpawnPoints.push(spawnPoint);
    } else {
      itemSpawnPoints.push(spawnPoint);
    }
  }

  const sortByPosition = (left: MapSpawnPoint, right: MapSpawnPoint): number => {
    if (left.tileY !== right.tileY) {
      return left.tileY - right.tileY;
    }

    return left.tileX - right.tileX;
  };

  playerSpawnPoints.sort(sortByPosition);
  itemSpawnPoints.sort(sortByPosition);

  return { itemSpawnPoints, playerSpawnPoints };
}

function buildLayerInstances(
  rawMap: RawTiledMap,
  tilesets: ResolvedTileset[],
): {
  layers: MapLayerInstance[];
  tiles: MapTileInstance[];
} {
  const tilesByGlobalId = resolveTileMetadataByGlobalId(tilesets);
  const layers: MapLayerInstance[] = [];
  const tiles: MapTileInstance[] = [];
  const halfWidth = rawMap.width / 2;
  const halfHeight = rawMap.height / 2;

  const levelLayerIndex = rawMap.layers.findIndex((l) => l.name === 'level_layer');
  const effectiveLevelIndex = levelLayerIndex >= 0 ? levelLayerIndex : Math.floor(rawMap.layers.length / 2);
  const orderedLayers = rawMap.layers.map((layer, index) => ({ index, layer }));

  for (const entry of orderedLayers) {
    const rawLayer = entry.layer;
    const visible = rawLayer.visible !== false;
    const opacity = rawLayer.opacity ?? 1;
    const tintColor = parseColorValue(rawLayer.tintcolor);
    const layerTiles: MapTileInstance[] = [];

    if (rawLayer.type !== 'tilelayer') {
      layers.push({
        index: entry.index,
        name: rawLayer.name,
        opacity,
        renderVisible: false,
        tiles: [],
        tintColor,
      });
      continue;
    }

    if (rawLayer.data.length !== rawMap.width * rawMap.height) {
      throw new Error(
        `Layer ${rawLayer.name} has ${rawLayer.data.length} cells, expected ${rawMap.width * rawMap.height}`,
      );
    }

    for (let tileY = 0; tileY < rawMap.height; tileY += 1) {
      for (let tileX = 0; tileX < rawMap.width; tileX += 1) {
        const cellIndex = tileY * rawMap.width + tileX;
        const globalId = rawLayer.data[cellIndex];
        if (globalId === 0) {
          continue;
        }

        const tileRecord = tilesByGlobalId.get(globalId);
        if (!tileRecord) {
          throw new Error(`Unable to resolve tile id ${globalId} in layer ${rawLayer.name}`);
        }

        const resolvedTile = tileRecord.metadata;
        const worldX = tileX + 0.5 - halfWidth;
        const worldY = halfHeight - tileY - 0.5;
        const tileDepth = computeLayerZ(entry.index, effectiveLevelIndex, rawMap.layers.length) + resolvedTile.zLayerPos * 0.01;
        const renderVisible = visible && resolvedTile.renderVisible;
        const collision = rawLayer.name === 'level_layer' ? resolvedTile.collision : 0;
        const specialRole = rawLayer.name === 'level_layer' ? resolvedTile.specialRole : null;

        const tileInstance: MapTileInstance = {
          atlasUrl: tileRecord.tileset.atlasUrl,
          collision,
          globalId,
          layerIndex: entry.index,
          layerName: rawLayer.name,
          opacity,
          renderVisible,
          specialRole,
          tileX,
          tileY,
          tilesetId: tileRecord.tileset.id,
          tintColor,
          uv: resolvedTile.uv,
          x: worldX,
          y: worldY,
          z: tileDepth,
          zLayerPos: resolvedTile.zLayerPos,
        };

        layerTiles.push(tileInstance);
        tiles.push(tileInstance);
      }
    }

    layers.push({
      index: entry.index,
      name: rawLayer.name,
      opacity,
      renderVisible: visible,
      tiles: layerTiles,
      tintColor,
    });
  }

  return { layers, tiles };
}

function buildMapDefinition(mapId: string): TiledMapDefinition {
  const rawMap = RAW_MAP_MODULES[
    Object.keys(RAW_MAP_MODULES).find((key) => normalizeAssetKey(key) === mapId) ?? ''
  ];

  if (!rawMap) {
    throw new Error(`Unknown map id: ${mapId}`);
  }

  const tilesets = rawMap.tilesets.map((ref) => resolveTilesetRecord(ref));
  const { layers, tiles } = buildLayerInstances(rawMap, tilesets);
  const solids = mergeSolidRects(rawMap.width, rawMap.height, tiles);
  const platforms = mergePlatformRects(rawMap.width, rawMap.height, tiles);
  const { playerSpawnPoints, itemSpawnPoints } = collectSpawnPoints(tiles);

  return {
    bounds: buildMapBounds(rawMap.width, rawMap.height),
    colliders: {
      platforms,
      solids,
    },
    height: rawMap.height,
    id: mapId,
    itemSpawnPoints,
    layers,
    name: rawMap.name?.trim() || mapId,
    playerSpawnPoints,
    tileHeight: rawMap.tileheight,
    tileWidth: rawMap.tilewidth,
    tiles,
    tilesets,
    width: rawMap.width,
  };
}

export const AVAILABLE_MAPS: MapManifest[] = Object.entries(RAW_MAP_MODULES)
  .map(([path, rawMap]) => ({
    height: rawMap.height,
    id: normalizeAssetKey(path),
    name: rawMap.name?.trim() || normalizeAssetKey(path),
    width: rawMap.width,
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

export const DEFAULT_MAP_ID =
  AVAILABLE_MAPS.find((entry) => entry.id === '1bit-finaldest-ver2')?.id ??
  AVAILABLE_MAPS[0]?.id ??
  (() => {
    throw new Error('No maps were found in src/assets/maps');
  })();

export function getAvailableMaps(): MapManifest[] {
  return [...AVAILABLE_MAPS];
}

export function loadMapDefinition(mapId = DEFAULT_MAP_ID): TiledMapDefinition {
  const normalizedMapId = normalizeAssetKey(mapId);
  const cached = MAP_CACHE.get(normalizedMapId);
  if (cached) {
    return cached;
  }

  const definition = buildMapDefinition(normalizedMapId);
  MAP_CACHE.set(normalizedMapId, definition);
  return definition;
}
