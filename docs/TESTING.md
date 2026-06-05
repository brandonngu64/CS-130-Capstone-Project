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

## Suite 3: Character Sprite and Weapon Frames

- Test class/file: [src/client/__tests__/CharacterSprites.test.ts](../src/client/__tests__/CharacterSprites.test.ts)
- Framework mapping: `describe('character body frame selection')`, `describe('weapon and punch frame selection')`, `describe('sprite asset resolution')`, and `describe('character id normalization and assignment')` are Vitest suites; each `it(...)` or `it.each(...)` block is a test case.
- Setup: tests import deterministic sprite helper functions and use existing character/weapon image assets resolved by Vite's test environment.
- Teardown: no teardown is required because the tested helpers do not create renderer objects, DOM nodes, network connections, or persistent timers.

### Character Body Frame Selection

| Test method | Inputs | Expected outcome / test oracle |
| --- | --- | --- |
| `uses facing %s for idle frame %s` | Facing values `1`, `0`, and `-1` with no held item, zero velocity, and animation tick `0` | Facing right or neutral resolves to `idle_r`; facing left resolves to `idle_l`. |
| `switches to hold frames whenever a character has an item` | Finals while facing right; Ethernet Whip while facing left with nonzero movement inputs | Held items force `hold_r` or `hold_l`, proving held weapon rendering overrides movement animation. |
| `alternates walk frames after crossing the velocity threshold` | Velocities `0.35`, `0.36`, and `-0.36`; animation ticks `0`, `10`, and `20` | Velocity at the threshold stays idle; velocity above the threshold alternates between walk frame 1 and 2 based on animation tick and facing. |
| `includes character id and resolved frame in frame cache keys` | Character `sahai`, facing left, moving left, animation tick `10` | The cache key is `sahai:walk_l2`. |

### Weapon and Punch Frame Selection

| Test method | Inputs | Expected outcome / test oracle |
| --- | --- | --- |
| `uses the special Sahai punch sprite variant only for Sahai` | `sahai`, `eggert`, and `nachenburg` | Sahai resolves to punch variant `var2`; the other tested characters resolve to `var1`. |
| `resolves %s whip ticks remaining to %s` | Whip ticks remaining `14`, `10`, `5`, and `0` | Windup/recoil use `attack1`, lash uses `attack2`, and zero ticks remaining uses `idle`. |
| `resolves non-whip held weapon frames from item-specific rules` | Finals, Binary Beam, and Pen Crossbow with cooldowns `0` and `3` | Finals uses `paper_stack`, Binary Beam uses `gpu`, Pen Crossbow uses `idle` normally and `firing` during cooldown. |
| `throws when a held item has no sprite rule or weapon definition` | Gun with no weapon definition | `resolveHeldWeaponFrame` throws `Missing weapon definition for held item 1`. |
| `falls back to idle bottom inset for unknown whip frames` | Known frame `attack2` and unknown frame `missing` | Known frames use their configured inset; unknown frames fall back to the idle inset. |

### Sprite Asset Resolution

| Test method | Inputs | Expected outcome / test oracle |
| --- | --- | --- |
| `resolves existing character and weapon sprite URLs` | Eggert idle sprite, Sahai preview sprite, and paper stack weapon sprite | Each helper returns a URL containing the expected asset path. |
| `throws clear errors for missing sprite assets` | Missing Eggert frame and missing paper stack weapon frame | The helpers throw explicit missing-sprite errors with the requested asset name. |

### Character ID Normalization and Assignment

| Test method | Inputs | Expected outcome / test oracle |
| --- | --- | --- |
| `normalizes missing or invalid character ids to the default character` | `smallberg`, `Smallberg`, `null`, and `undefined` | Valid lowercase IDs are preserved; invalid, null, and undefined values return the default character. |
| `assigns characters by sorted player order and wraps long rosters` | Sorted player IDs `a`, `b`, `c`, `d`, `e` | Players map by roster order, and the fifth player wraps back to `eggert`. |
| `assigns a stable valid fallback character for players missing from the sorted list` | Player `late-joiner` with sorted list `['host']` | The fallback assignment is deterministic and always one of the configured character IDs. |

Edge cases and error handling covered: neutral facing, exact walk threshold, held-item animation override, whip timing boundaries, unknown weapon definitions, unknown sprite assets, invalid character IDs, roster wraparound, and late-joining players.

## Suite 4: Game State Manager

- Test class/file: [src/client/__tests__/GameStateManager.test.ts](../src/client/__tests__/GameStateManager.test.ts)
- Framework mapping: `describe('player state initialization and cleanup')`, `describe('respawn and damage lifecycle')`, `describe('winner detection')`, and `describe('rollback match state serialization')` are Vitest suites; each `it(...)` block is a test case.
- Setup: tests create fresh `GameStateManager` instances for each case. Shared helpers create players and advance deterministic timer ticks.
- Teardown: no teardown is required because each test owns its manager instance and the class does not allocate DOM, physics, file, or network resources.

### Player State Initialization and Cleanup

| Test method | Inputs | Expected outcome / test oracle |
| --- | --- | --- |
| `creates new players with default stocks and active timers` | New manager with player `alice` | Alice starts with `DEFAULT_STOCKS`, zero respawn timers, can receive input, can take damage, and renders as active. |
| `does not reset an existing player when ensurePlayer is called again` | Alice loses one stock, then `ensurePlayer('alice')` is called again | Alice keeps `DEFAULT_STOCKS - 1` and the active respawn delay, proving duplicate setup does not reset match state. |
| `treats unknown players as eliminated and unable to act` | Unknown player id `missing` | Snapshot is `null`, input/damage checks return `false`, and render info reports eliminated with zero stocks. |
| `removes individual players and clears all match state` | Players `alice` and `bob`; call `removePlayer('alice')`, then `clear()` | Alice is removed while Bob remains; after clear, Bob is also removed. |

### Respawn and Damage Lifecycle

| Test method | Inputs | Expected outcome / test oracle |
| --- | --- | --- |
| `starts a respawn after a non-final stock loss` | Alice starts respawn with 3 stocks | Stocks drop to 2, respawn delay becomes `RESPAWN_DELAY_TICKS`, input and damage are blocked, and render info marks Alice respawning. |
| `rejects respawn starts for unknown, eliminated, or already-respawning players` | Unknown player, Alice while respawning, and Alice after final stock loss | `startRespawn` returns `false` for invalid states and never starts a new timer for eliminated players. |
| `emits a respawn event only when the respawn timer reaches zero` | Alice respawn timer advanced `RESPAWN_DELAY_TICKS - 1`, then one more tick | No event fires early; the final tick returns `['alice']` and starts `RESPAWN_FLASH_TICKS`. |
| `blocks damage during respawn flash while allowing input after respawn` | Alice after respawn delay and through the flash timer | Input is allowed during flash, damage is blocked during flash, and damage is allowed again after flash reaches zero. |
| `can force a living player back into active state without restoring stocks` | Alice loses one stock, then `resetRespawnState('alice')` | Respawn timers reset to zero, Alice can take damage, and lost stock is not restored. |
| `does not reset timers for unknown or eliminated players` | Unknown player and Alice after losing all stocks | Reset calls do nothing for missing or eliminated players; Alice remains eliminated with zero stocks. |

### Winner Detection

| Test method | Inputs | Expected outcome / test oracle |
| --- | --- | --- |
| `returns null while there are zero or multiple living active players` | Empty active list, `alice`/`bob`, and missing-only list | Winner is `null` when there is no single surviving player. |
| `returns the only active player with stocks remaining` | Bob loses all stocks while Alice remains active | Winner is `alice`. |

### Rollback Match State Serialization

| Test method | Inputs | Expected outcome / test oracle |
| --- | --- | --- |
| `reports a stable byte size for each serialized player` | New manager | `matchBytesPerPlayer()` returns `5`. |
| `writes and reads player state snapshots using little-endian timers` | Alice loses one stock, advances 7 respawn ticks, then serializes to `DataView` | Serialized bytes contain stocks, remaining respawn ticks, and flash ticks at the expected offsets; reading into a new manager recreates the same snapshot. |
| `serializes multiple players at caller-provided offsets` | Alice in flash state and Bob in respawn state serialized back-to-back | Offsets advance by 5 bytes per player, and restoring both players matches the source snapshots. |
| `throws when writing a player that has no match state` | Attempt to write `missing` | `writePlayer` throws `Missing match state for missing`. |

Edge cases and error handling covered: duplicate player initialization, unknown players, player removal, clearing state, final-stock elimination, respawn timer boundary, invulnerability flash boundary, forced respawn reset, single-winner detection, multi-player serialization offsets, and missing-player serialization errors.

## Planned Suite Breakdown

The remaining suites can be added as separate commits so the final report is easy to explain:

1. Rollback physics gameplay suite: validate movement, jumping, dashing, projectile lifetime, hit detection, respawn timing, and blast-zone deaths using deterministic frame advancement.
2. Signaling/server suite: validate room creation, joins, duplicate player IDs, broadcasts, disconnect cleanup, and malformed message handling.