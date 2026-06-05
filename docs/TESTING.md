# Test Scenarios and Test Cases

This project uses [Vitest](https://vitest.dev/) for automated TypeScript unit tests. The current test command runs the unit test suites first and then runs TypeScript validation for both client and server code:

```bash
npm test
```

## Suite 1: Client Rules and Helper Logic

- Test class/file: [src/client/__tests__/rules.test.ts](../src/client/__tests__/rules.test.ts)
- Framework mapping: each `describe(...)` block is a test suite, and each `it(...)` or `it.each(...)` block is an individual test case.
- Setup: tests import deterministic client helper modules directly. The shared `emptyInput` fixture represents a neutral controller state with every control set to `false`.
- Teardown: no teardown is required because the tested helpers are pure functions and do not allocate DOM nodes, network connections, timers, or physics engine state.

### Input Bit Packing

These tests verify that rollback/network input can be encoded into one deterministic byte and decoded safely.

| Test method | Inputs | Expected outcome / test oracle |
| --- | --- | --- |
| `encodes no pressed controls as zero bits` | `emptyInput`, where `left`, `right`, `jump`, `duck`, `punch`, and `dash` are all `false` | `encodeInput` returns a byte whose decoded bit value is `0`, proving neutral input is represented consistently. |
| `sets only the %s bit when that control is pressed` | Six parameterized cases: one control at a time set to `true` for left, right, jump, duck, punch, and dash | Each encoded input equals the matching `InputBits` flag and no unrelated bits are set. |
| `combines simultaneous controls into one deterministic byte` | `left`, `right`, `duck`, and `punch` set to `true`; `jump` and `dash` set to `false` | The decoded byte equals `InputBits.Left | InputBits.Right | InputBits.Duck | InputBits.Punch`, demonstrating simultaneous controls are combined without dropping inputs. |
| `encodes every supported control without overflowing one byte` | All six supported controls set to `true` | The returned `Uint8Array` has length `1`, and the decoded value is `63`, the sum of all supported bit flags. |
| `treats missing or empty rollback input as neutral input` | `undefined` and `new Uint8Array()` | Both inputs decode to `0`, covering missing-input and empty-packet error-handling paths. |

Edge cases covered: no controls pressed, every control pressed, simultaneous opposite directions, `undefined` rollback input, and empty byte arrays.

### Character ID Helpers

These tests verify that character selection stays stable for menus, player assignment, and serialized settings.

| Test method | Inputs | Expected outcome / test oracle |
| --- | --- | --- |
| `accepts every configured character id and rejects unknown ids` | Every value in `CHARACTER_IDS`, plus `unknown` and `Eggert` | Valid configured IDs return `true`; unknown and incorrectly cased IDs return `false`. |
| `maps character ids to their configured indexes` | `eggert`, `nachenburg`, `sahai`, and `smallberg` | The helper returns indexes `0`, `1`, `2`, and `3`, matching the configured roster order. |
| `wraps positive and negative indexes into the character roster` | `0`, `CHARACTER_IDS.length`, `CHARACTER_IDS.length + 1`, `-1`, and `-CHARACTER_IDS.length` | Indexes wrap around the roster: overflow returns from the start, and negative values wrap from the end. |

Boundary conditions covered: first roster index, one-past-the-end index, larger positive overflow, `-1`, and a negative value equal to the roster length.

### Attack Definitions

These tests verify that the default punch attack is available, correctly shaped, and fails safely for invalid attack IDs.

| Test method | Inputs | Expected outcome / test oracle |
| --- | --- | --- |
| `returns the default punch definition with the expected hitbox and damage values` | `AttackKind.DefaultPunch` | The definition has duration `8`, damage `15`, hitbox size `0.8 x 0.25`, vertical offset `0.1`, and horizontal center offset equal to `PLAYER_HALF_WIDTH + hitboxHalfWidth`. |
| `uses default punch when no equipped attack is supplied` | No argument to `getEquippedAttack()` | The returned object is the same default punch definition returned by `getAttackDefinition(AttackKind.DefaultPunch)`. |
| `throws for an unknown attack kind instead of returning an invalid definition` | `999 as AttackKind` | `getAttackDefinition` throws `Unknown attack kind: 999`, preventing invalid combat state from silently propagating. |

Error-handling covered: unknown attack kinds throw an explicit error.

### Weapon Phase Helpers

These tests verify Ethernet Whip timing because melee hitbox activation depends on exact phase boundaries.

| Test method | Inputs | Expected outcome / test oracle |
| --- | --- | --- |
| `computes ethernet whip duration from windup, lash, and recoil timing` | `WEAPON_DEFINITIONS[ItemKind.EthernetWhip]` | The computed `durationTicks` is `14`, equal to windup `4` + lash `5` + recoil `5`. |
| `reports %s ticks remaining as %s phase` | Parameterized `ticksRemaining` cases: `14`, `11`, `10`, `6`, `5`, and `1` | The helper returns `windup` for `14` and `11`, `lash` for `10` and `6`, and `recoil` for `5` and `1`. |
| `activates the whip hitbox only during the lash phase` | `ticksRemaining` values `14`, `10`, `6`, and `5` | The hitbox is inactive during windup and recoil, and active only during lash. |
| `falls back to recoil for elapsed time beyond the configured duration` | `ticksRemaining = 0` | The phase is `recoil`, and the hitbox is inactive, covering the boundary where the active attack state has ended. |

Boundary conditions covered: first tick of windup, last tick of windup, first and last lash ticks, first recoil tick, and zero ticks remaining.

## Planned Suite Breakdown

The remaining suites can be added as separate commits so the final report is easy to explain:

## Suite 2: Map Loading and Gameplay Metadata

- Test class/file: [src/client/__tests__/tiledMap.test.ts](../src/client/__tests__/tiledMap.test.ts)
- Framework mapping: `describe('map manifest loading')`, `describe('tiled map definition loading')`, and `describe('map gameplay metadata')` are Vitest suites; each `it(...)` block is a test case.
- Setup: tests import the map loader directly and use the real Tiled JSON/assets available through Vite's `import.meta.glob` support in Vitest.
- Teardown: no teardown is required because `loadMapDefinition` only uses an in-memory cache and does not create DOM, network, file, or physics resources.

### Map Manifest Loading

| Test method | Inputs | Expected outcome / test oracle |
| --- | --- | --- |
| `lists available maps in display-name order` | Call `getAvailableMaps()` | The manifest list has at least 9 maps, is sorted by display name, and contains `1bit-finaldest-ver2` with dimensions `26 x 15`. |
| `returns a defensive copy of the map manifest list` | Mutate the returned array with `pop()` | A later `getAvailableMaps()` call still returns all 9 maps, proving callers cannot mutate the exported manifest state. |
| `selects final destination as the default map when present` | Read `DEFAULT_MAP_ID` | The default map id is `1bit-finaldest-ver2`. |

### Tiled Map Definition Loading

| Test method | Inputs | Expected outcome / test oracle |
| --- | --- | --- |
| `loads and caches the default map definition` | `loadMapDefinition()` and `loadMapDefinition(DEFAULT_MAP_ID)` | Both calls return the same cached object with id/name `1bit-finaldest-ver2`, dimensions `26 x 15`, and tile size `16 x 16`. |
| `normalizes map ids from filenames or paths before loading` | `1bit-finaldest-ver2.json` and `../assets/maps/1bit-finaldest-ver2.json` | Both inputs normalize to the default map and return the cached default definition. |
| `throws a clear error for unknown maps` | `missing-map` | `loadMapDefinition` throws `Unknown map id: missing-map`. |
| `builds bounds around the map center` | Default map | Bounds are centered at the origin: x from `-13` to `13`, y from `-7.5` to `7.5`. |
| `resolves visible layer and tile instances from Tiled data` | Default map | Layers are `level_layer` and `background`, tile counts are `35` and `39`, total resolved tiles are `74`, and every tile has an atlas URL. |
| `resolves the map tileset atlas and global tile id range` | Default map tileset | The tileset id is `monochrome_tilemap_transparent_packed`, global ids span `1` through `400`, tile count is `400`, tile size is `16 x 16`, and the atlas URL resolves. |

### Map Gameplay Metadata

| Test method | Inputs | Expected outcome / test oracle |
| --- | --- | --- |
| `merges default map collision tiles into solid and platform rectangles` | Default map | Collision data becomes 1 solid rectangle and 3 platform rectangles; each collider has correct kind/layer, correct tile count, and stays inside map bounds. |
| `extracts player and item spawn points from non-rendered special tiles` | Default map | The loader finds 4 player spawns and 3 item spawns, assigns the correct roles, and marks special-role tiles as not render-visible. |

Edge cases and error handling covered: unknown map IDs, filename/path normalization, defensive manifest copying, cached default loading, centered boundary math, collider bounds, and hidden special spawn tiles.

## Planned Suite Breakdown

The remaining suites can be added as separate commits so the final report is easy to explain:

1. Character sprite and weapon frame suite: validate frame selection for idle, walking, held items, punch variants, whip phases, and pen crossbow firing cooldowns.
2. Game state manager suite: validate player snapshots, stock/life transitions, match-over calculation, and render info ordering.
3. Rollback physics gameplay suite: validate movement, jumping, dashing, projectile lifetime, hit detection, respawn timing, and blast-zone deaths using deterministic frame advancement.
4. Signaling/server suite: validate room creation, joins, duplicate player IDs, broadcasts, disconnect cleanup, and malformed message handling.