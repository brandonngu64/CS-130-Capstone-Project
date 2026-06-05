import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAP_ID,
  getAvailableMaps,
  loadMapDefinition,
  type MapColliderRect,
} from '../tiledMap';

describe('map manifest loading', () => {
  it('lists available maps in display-name order', () => {
    const maps = getAvailableMaps();

    expect(maps.length).toBeGreaterThanOrEqual(9);
    expect(maps.map((map) => map.name)).toEqual(
      [...maps].map((map) => map.name).sort((left, right) => left.localeCompare(right)),
    );
    expect(maps).toContainEqual({
      id: '1bit-finaldest-ver2',
      name: '1bit-finaldest-ver2',
      width: 26,
      height: 15,
    });
  });

  it('returns a defensive copy of the map manifest list', () => {
    const maps = getAvailableMaps();
    maps.pop();

    expect(getAvailableMaps()).toHaveLength(9);
  });

  it('selects final destination as the default map when present', () => {
    expect(DEFAULT_MAP_ID).toBe('1bit-finaldest-ver2');
  });
});

describe('tiled map definition loading', () => {
  it('loads and caches the default map definition', () => {
    const firstLoad = loadMapDefinition();
    const secondLoad = loadMapDefinition(DEFAULT_MAP_ID);

    expect(firstLoad).toBe(secondLoad);
    expect(firstLoad).toMatchObject({
      id: '1bit-finaldest-ver2',
      name: '1bit-finaldest-ver2',
      width: 26,
      height: 15,
      tileWidth: 16,
      tileHeight: 16,
    });
  });

  it('normalizes map ids from filenames or paths before loading', () => {
    expect(loadMapDefinition('1bit-finaldest-ver2.json')).toBe(loadMapDefinition(DEFAULT_MAP_ID));
    expect(loadMapDefinition('../assets/maps/1bit-finaldest-ver2.json')).toBe(
      loadMapDefinition(DEFAULT_MAP_ID),
    );
  });

  it('throws a clear error for unknown maps', () => {
    expect(() => loadMapDefinition('missing-map')).toThrow('Unknown map id: missing-map');
  });

  it('builds bounds around the map center', () => {
    const map = loadMapDefinition(DEFAULT_MAP_ID);

    expect(map.bounds).toEqual({
      width: 26,
      height: 15,
      minX: -13,
      maxX: 13,
      minY: -7.5,
      maxY: 7.5,
    });
  });

  it('resolves visible layer and tile instances from Tiled data', () => {
    const map = loadMapDefinition(DEFAULT_MAP_ID);

    expect(map.layers.map((layer) => layer.name)).toEqual(['level_layer', 'background']);
    expect(map.layers.map((layer) => layer.tiles.length)).toEqual([35, 39]);
    expect(map.tiles).toHaveLength(74);
    expect(map.tiles.every((tile) => tile.atlasUrl.length > 0)).toBe(true);
  });

  it('resolves the map tileset atlas and global tile id range', () => {
    const [tileset] = loadMapDefinition(DEFAULT_MAP_ID).tilesets;

    expect(tileset).toMatchObject({
      id: 'monochrome_tilemap_transparent_packed',
      firstGid: 1,
      lastGid: 400,
      tileCount: 400,
      tileWidth: 16,
      tileHeight: 16,
    });
    expect(tileset.atlasUrl.length).toBeGreaterThan(0);
  });
});

describe('map gameplay metadata', () => {
  function expectColliderInsideBounds(collider: MapColliderRect): void {
    const map = loadMapDefinition(DEFAULT_MAP_ID);
    const halfWidth = collider.width / 2;
    const halfHeight = collider.height / 2;

    expect(collider.x - halfWidth).toBeGreaterThanOrEqual(map.bounds.minX);
    expect(collider.x + halfWidth).toBeLessThanOrEqual(map.bounds.maxX);
    expect(collider.y - halfHeight).toBeGreaterThanOrEqual(map.bounds.minY);
    expect(collider.y + halfHeight).toBeLessThanOrEqual(map.bounds.maxY);
  }

  it('merges default map collision tiles into solid and platform rectangles', () => {
    const map = loadMapDefinition(DEFAULT_MAP_ID);

    expect(map.colliders.solids).toHaveLength(1);
    expect(map.colliders.platforms).toHaveLength(3);
    expect(map.colliders.solids[0]).toMatchObject({ kind: 'solid', layerName: 'level_layer' });
    expect(map.colliders.platforms.every((collider) => collider.kind === 'platform')).toBe(true);
    for (const collider of [...map.colliders.solids, ...map.colliders.platforms]) {
      expect(collider.tileCount).toBe(collider.width * collider.height);
      expectColliderInsideBounds(collider);
    }
  });

  it('extracts player and item spawn points from non-rendered special tiles', () => {
    const map = loadMapDefinition(DEFAULT_MAP_ID);

    expect(map.playerSpawnPoints).toHaveLength(4);
    expect(map.itemSpawnPoints).toHaveLength(3);
    expect(map.playerSpawnPoints.every((spawn) => spawn.role === 'player_spawn')).toBe(true);
    expect(map.itemSpawnPoints.every((spawn) => spawn.role === 'item_spawn')).toBe(true);
    expect(map.tiles.filter((tile) => tile.specialRole === 'player_spawn')).toHaveLength(4);
    expect(map.tiles.filter((tile) => tile.specialRole === 'item_spawn')).toHaveLength(3);
    expect(map.tiles.filter((tile) => tile.specialRole !== null).every((tile) => !tile.renderVisible)).toBe(
      true,
    );
  });
});