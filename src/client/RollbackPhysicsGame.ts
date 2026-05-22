import * as RAPIER from '@dimforge/rapier2d-compat';
import type { Game, PlayerId } from 'rollback-netcode';
import {
  ARENA_HALF_WIDTH,
  DASH_COOLDOWN_TICKS,
  DASH_DURATION_TICKS,
  DASH_SPEED,
  FIXED_STEP_SECONDS,
  FLOOR_Y,
  GRAVITY_Y,
  JUMP_SPEED,
  MOVE_SPEED,
  PLATFORMS,
  PLAYER_COLOR_PALETTE,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  PLAYER_MAX_HEALTH,
  PLAYER_SPAWN_Y,
} from './constants';
import { AttackKind, getAttackDefinition, getEquippedAttack } from './attacks';
import { InputBits, decodeInputBits } from './input';
import { PlayerCharacter } from './PlayerCharacter';
import {
  ItemKind,
  WorldItem,
  ITEM_SPAWN_SLOTS,
  ITEM_SPAWN_INTERVAL_TICKS,
  ITEM_LIFETIME_TICKS,
  ITEM_PICKUP_RADIUS,
  GUN_COLOR,
} from './items';

export interface AttackRenderState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: number;
}

export interface PlayerRenderState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: number;
  health: number;
  maxHealth: number;
  heldItem: ItemKind | null;
}

export interface ItemRenderState {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
}

export interface RenderState {
  players: PlayerRenderState[];
  attacks: AttackRenderState[];
  items: ItemRenderState[];
}

const PLAYER_SPAWN_SLOTS = [-10, -4, 4, 10];

// Deterministic item id counter — incremented each time an item spawns.
// Wraps at 255 so it fits in a single byte in the serialized state.
const ITEM_ID_MAX = 255;

export class RollbackPhysicsGame implements Game<Uint8Array> {
  private readonly world: RAPIER.World;
  private readonly players = new Map<string, PlayerCharacter>();
  private readonly previousInputFlags = new Map<string, number>();
  private readonly textEncoder = new TextEncoder();
  private readonly textDecoder = new TextDecoder();

  // Items that are in the arena
  private readonly worldItems = new Map<number, WorldItem>();
  // Occupied item spawn slots
  private readonly occupiedSlots = new Set<number>();
  // Absolute tick counter used for item expiry
  private globalTick = 0;
  // Tick counter for deterministic item spawns
  private itemSpawnTick = 0;
  // Monotonically increasing id assigned to each spawned item
  private nextItemId = 1;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: GRAVITY_Y });
    this.world.timestep = FIXED_STEP_SECONDS;
    this.createStaticLevel();
  }

  serialize(): Uint8Array {
    const sortedIds = Array.from(this.players.keys()).sort();

    const playerRecords = sortedIds.map((id) => {
      const record = this.players.get(id);
      if (!record) {
        throw new Error(`Missing player record for ${id}`);
      }
      const idBytes = this.textEncoder.encode(id);
      const translation = record.body.translation();
      const velocity = record.body.linvel();
      const inputFlags = this.previousInputFlags.get(id) ?? 0;
      const attack = record.activeAttack;
      return {
        idBytes,
        x: translation.x,
        y: translation.y,
        vx: velocity.x,
        vy: velocity.y,
        inputFlags,
        health: record.health,
        facing: record.facing,
        attackKind: attack?.kind ?? 0,
        attackTicksRemaining: attack?.ticksRemaining ?? 0,
        dashTicksRemaining: record.dashTicksRemaining,
        dashCooldownTicks: record.dashCooldownTicks,
        heldItem: record.heldItem ?? 0,
        heldItemExpiryTick: record.heldItemExpiryTick,
      };
    });

    const itemList = Array.from(this.worldItems.values()).sort(
      (a, b) => a.id - b.id,
    );

    // Calculate byte length:
    //   1  player count
    //   per player: 2 (id len) + idBytes + 4*4 (floats) + 7 bytes (flags/state) + 2 (heldItemExpiryTick)
    //   1  item count
    //   per item: 1 (id) + 1 (kind) + 1 (slotIndex) + 2 (expiryTick uint16)
    //   2  itemSpawnTick (uint16)
    //   1  nextItemId
    //   2  globalTick (uint16)
    let byteLength = 1;
    for (const rec of playerRecords) {
      byteLength += 2 + rec.idBytes.length + 4 * 4 + 9;
    }
    byteLength += 1 + itemList.length * 5 + 2 + 1 + 2;

    const buffer = new ArrayBuffer(byteLength);
    const view = new DataView(buffer);
    const output = new Uint8Array(buffer);

    let offset = 0;

    // Players
    view.setUint8(offset, playerRecords.length);
    offset += 1;

    for (const rec of playerRecords) {
      view.setUint16(offset, rec.idBytes.length, true);
      offset += 2;
      output.set(rec.idBytes, offset);
      offset += rec.idBytes.length;

      view.setFloat32(offset, rec.x, true);        offset += 4;
      view.setFloat32(offset, rec.y, true);        offset += 4;
      view.setFloat32(offset, rec.vx, true);       offset += 4;
      view.setFloat32(offset, rec.vy, true);       offset += 4;
      view.setUint8(offset, rec.inputFlags & 0xff); offset += 1;
      view.setUint8(offset, rec.health);            offset += 1;
      view.setInt8(offset, rec.facing < 0 ? -1 : 1); offset += 1;
      view.setUint8(offset, rec.attackKind);        offset += 1;
      view.setUint8(offset, rec.attackTicksRemaining); offset += 1;
      view.setUint8(offset, rec.dashTicksRemaining);   offset += 1;
      view.setUint8(offset, rec.heldItem);          offset += 1;
      view.setUint16(offset, rec.heldItemExpiryTick, true); offset += 2;
    }

    // Items
    view.setUint8(offset, itemList.length);
    offset += 1;

    for (const item of itemList) {
      view.setUint8(offset, item.id);                       offset += 1;
      view.setUint8(offset, item.kind);                     offset += 1;
      view.setUint8(offset, item.slotIndex);                offset += 1;
      view.setUint16(offset, item.expiryTick, true);        offset += 2;
    }

    view.setUint16(offset, this.itemSpawnTick, true); offset += 2;
    view.setUint8(offset, this.nextItemId);           offset += 1;
    view.setUint16(offset, this.globalTick, true);    offset += 2;

    return output;
  }

  deserialize(data: Uint8Array): void {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    // Players
    const count = view.getUint8(offset);
    offset += 1;

    const incoming = new Map<
      string,
      {
        x: number; y: number; vx: number; vy: number;
        inputFlags: number; health: number; facing: number;
        attackKind: number; attackTicksRemaining: number;
        dashTicksRemaining: number; dashCooldownTicks: number;
        heldItem: number; heldItemExpiryTick: number;
      }
    >();

    for (let i = 0; i < count; i += 1) {
      const idByteLength = view.getUint16(offset, true); offset += 2;
      const idBytes = data.slice(offset, offset + idByteLength); offset += idByteLength;
      const id = this.textDecoder.decode(idBytes);

      const x   = view.getFloat32(offset, true); offset += 4;
      const y   = view.getFloat32(offset, true); offset += 4;
      const vx  = view.getFloat32(offset, true); offset += 4;
      const vy  = view.getFloat32(offset, true); offset += 4;
      const inputFlags           = view.getUint8(offset); offset += 1;
      const health               = view.getUint8(offset); offset += 1;
      const facing               = view.getInt8(offset);  offset += 1;
      const attackKind           = view.getUint8(offset); offset += 1;
      const attackTicksRemaining = view.getUint8(offset); offset += 1;
      const dashTicksRemaining   = view.getUint8(offset); offset += 1;
      const heldItem             = view.getUint8(offset); offset += 1;
      const heldItemExpiryTick   = view.getUint16(offset, true); offset += 2;

      incoming.set(id, {
        x, y, vx, vy, inputFlags, health, facing,
        attackKind, attackTicksRemaining,
        dashTicksRemaining, dashCooldownTicks: 0, heldItem, heldItemExpiryTick,
      });
    }

    this.syncPlayers(Array.from(incoming.keys()).sort());

    for (const [id, state] of incoming) {
      const record = this.players.get(id);
      if (!record) continue;
      record.body.setTranslation({ x: state.x, y: state.y }, true);
      record.body.setLinvel({ x: state.vx, y: state.vy }, true);
      record.health = Math.max(0, Math.min(state.health, PLAYER_MAX_HEALTH));
      record.facing = state.facing < 0 ? -1 : 1;
      record.activeAttack =
        state.attackKind > 0 && state.attackTicksRemaining > 0
          ? { kind: state.attackKind as AttackKind, ticksRemaining: state.attackTicksRemaining }
          : null;
      record.dashTicksRemaining = state.dashTicksRemaining;
      record.heldItem = state.heldItem > 0 ? (state.heldItem as ItemKind) : null;
      record.heldItemExpiryTick = state.heldItemExpiryTick;
      this.previousInputFlags.set(id, state.inputFlags);
    }

    // Items
    const itemCount = view.getUint8(offset); offset += 1;

    this.worldItems.clear();
    this.occupiedSlots.clear();

    for (let i = 0; i < itemCount; i += 1) {
      const id        = view.getUint8(offset);  offset += 1;
      const kind      = view.getUint8(offset) as ItemKind; offset += 1;
      const slotIndex = view.getUint8(offset);  offset += 1;
      const expiryTick = view.getUint16(offset, true); offset += 2;
      const slot = ITEM_SPAWN_SLOTS[slotIndex];
      if (!slot) continue;
      this.worldItems.set(id, { id, kind, slotIndex, x: slot.x, y: slot.y, expiryTick });
      this.occupiedSlots.add(slotIndex);
    }

    this.itemSpawnTick = view.getUint16(offset, true); offset += 2;
    this.nextItemId    = view.getUint8(offset);        offset += 1;
    this.globalTick    = view.getUint16(offset, true); offset += 2;
  }

  step(inputs: Map<PlayerId, Uint8Array>): void {
    const ids = Array.from(inputs.keys(), (id) => id as string).sort();
    this.globalTick += 1;
    this.syncPlayers(ids);
    this.tickDashCooldowns();

    for (const id of ids) {
      const raw = inputs.get(id as PlayerId);
      this.applyInput(id, decodeInputBits(raw));
    }

    this.tickAttacks();
    this.tickItems();
    this.world.step();
    this.enforceHorizontalBounds();
  }

  hash(): number {
    const bytes = this.serialize();
    let hash = 0x811c9dc5;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  getRenderState(): RenderState {
    const players = Array.from(this.players.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, record]) => {
        const position = record.body.translation();
        return {
          id,
          x: position.x,
          y: position.y,
          width: PLAYER_HALF_WIDTH * 2,
          height: PLAYER_HALF_HEIGHT * 2,
          color: record.color,
          health: record.health,
          maxHealth: record.maxHealth,
          heldItem: record.heldItem,
        };
      });

    const attacks: AttackRenderState[] = [];

    for (const [id, record] of this.players) {
      if (!record.activeAttack) continue;
      const definition = getAttackDefinition(record.activeAttack.kind);
      const position = record.body.translation();
      const center = this.attackCenter(position.x, position.y, record.facing, definition);
      attacks.push({
        id: `${id}-attack`,
        x: center.x,
        y: center.y,
        width: definition.hitboxHalfWidth * 2,
        height: definition.hitboxHalfHeight * 2,
        color: definition.spriteColor,
      });
    }

    attacks.sort((left, right) => left.id.localeCompare(right.id));

    const items: ItemRenderState[] = Array.from(this.worldItems.values()).map(
      (item) => ({ id: item.id, kind: item.kind, x: item.x, y: item.y }),
    );

    return { players, attacks, items };
  }

  reset(): void {
    for (const [, record] of this.players) {
      this.world.removeRigidBody(record.body);
    }
    this.players.clear();
    this.previousInputFlags.clear();
    this.worldItems.clear();
    this.occupiedSlots.clear();
    this.itemSpawnTick = 0;
    this.nextItemId = 1;
    this.globalTick = 0;
  }

  // ---------------------------------------------------------------------------
  // Item logic
  // ---------------------------------------------------------------------------

  private tickItems(): void {
    this.itemSpawnTick += 1;

    // Despawn expired items 
    for (const [itemId, item] of this.worldItems) {
      if (this.globalTick >= item.expiryTick) {
        this.worldItems.delete(itemId);
        this.occupiedSlots.delete(item.slotIndex);
      }
    }

    // Expire held player items
    for (const [, player] of this.players) {
      if (player.heldItem !== null && this.globalTick >= player.heldItemExpiryTick) {
        player.dropItem();
      }
    }

    // Spawn a new item every ITEM_SPAWN_INTERVAL_TICKS ticks if a free slot exists.
    if (this.itemSpawnTick >= ITEM_SPAWN_INTERVAL_TICKS) {
      this.itemSpawnTick = 0;
      this.trySpawnItem();
    }

    // Check each player against each live item for pickup.
    for (const [, player] of this.players) {
      if (player.heldItem !== null) continue;

      const pos = player.body.translation();

      for (const [itemId, item] of this.worldItems) {
        const dx = pos.x - item.x;
        const dy = pos.y - item.y;
        const distSq = dx * dx + dy * dy;

        if (distSq <= ITEM_PICKUP_RADIUS * ITEM_PICKUP_RADIUS) {
          player.heldItem = item.kind;
          player.heldItemExpiryTick = this.globalTick + ITEM_LIFETIME_TICKS;
          this.worldItems.delete(itemId);
          this.occupiedSlots.delete(item.slotIndex);
          break;
        }
      }
    }
  }

  private trySpawnItem(): void {
    const freeSlots: number[] = [];
    for (let i = 0; i < ITEM_SPAWN_SLOTS.length; i += 1) {
      if (!this.occupiedSlots.has(i)) {
        freeSlots.push(i);
      }
    }

    if (freeSlots.length === 0) return;

    const slotIndex = freeSlots[this.nextItemId % freeSlots.length];
    const slot = ITEM_SPAWN_SLOTS[slotIndex];
    if (!slot) return;

    const id = this.nextItemId;
    this.nextItemId = (this.nextItemId % ITEM_ID_MAX) + 1;

    const item: WorldItem = {
      id,
      kind: ItemKind.Gun,
      slotIndex,
      x: slot.x,
      y: slot.y,
      expiryTick: this.globalTick + ITEM_LIFETIME_TICKS,
    };

    this.worldItems.set(id, item);
    this.occupiedSlots.add(slotIndex);
  }


  private createStaticLevel(): void {
    const ground = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, FLOOR_Y - 0.5),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(ARENA_HALF_WIDTH + 2, 0.5).setFriction(1),
      ground,
    );

    const leftWall = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(-(ARENA_HALF_WIDTH + 0.5), 5),
    );
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 8), leftWall);

    const rightWall = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(ARENA_HALF_WIDTH + 0.5, 5),
    );
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 8), rightWall);

    for (const platform of PLATFORMS) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(platform.centerX, platform.centerY),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(platform.halfWidth, platform.halfHeight)
          .setFriction(1)
          .setRestitution(0),
        body,
      );
    }
  }

  private syncPlayers(sortedIds: string[]): void {
    const keep = new Set(sortedIds);

    for (const [id, record] of this.players) {
      if (!keep.has(id)) {
        this.world.removeRigidBody(record.body);
        this.players.delete(id);
        this.previousInputFlags.delete(id);
      }
    }

    for (const id of sortedIds) {
      if (!this.players.has(id)) {
        this.players.set(
          id,
          new PlayerCharacter(
            id,
            this.createPlayerBody(this.spawnXForPlayer(id)),
            this.colorForPlayer(id),
          ),
        );
        this.previousInputFlags.set(id, 0);
      }
    }
  }

  private createPlayerBody(spawnX: number): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawnX, PLAYER_SPAWN_Y)
        .lockRotations()
        .setLinearDamping(0)
        .setAngularDamping(0)
        .setCcdEnabled(true),
    );

    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)
        .setFriction(1)
        .setRestitution(0),
      body,
    );

    return body;
  }

  private applyInput(id: string, inputFlags: number): void {
    const record = this.players.get(id);
    if (!record) return;

    const body = record.body;
    const velocity = body.linvel();
    const previousFlags = this.previousInputFlags.get(id) ?? 0;

    const horizontalDir =
      (inputFlags & InputBits.Left  ? -1 : 0) +
      (inputFlags & InputBits.Right ?  1 : 0);

    if (horizontalDir !== 0) {
      record.facing = horizontalDir;
    }

    let nextYVelocity = velocity.y;
    const jumpPressed  = (inputFlags & InputBits.Jump)  !== 0 && (previousFlags & InputBits.Jump)  === 0;
    const punchPressed = (inputFlags & InputBits.Punch) !== 0 && (previousFlags & InputBits.Punch) === 0;
    const dashPressed  = (inputFlags & InputBits.Dash)  !== 0 && (previousFlags & InputBits.Dash)  === 0;

    if (record.dashTicksRemaining > 0) {
      body.setLinvel({ x: record.facing * DASH_SPEED, y: velocity.y }, true);
      record.dashTicksRemaining -= 1;
      this.previousInputFlags.set(id, inputFlags);
      return;
    }

    if (jumpPressed && this.isGrounded(body)) {
      nextYVelocity = JUMP_SPEED;
    }

    if (punchPressed && record.activeAttack === null) {
      const definition = getEquippedAttack(record.equippedWeapon);
      record.activeAttack = {
        kind: definition.kind,
        ticksRemaining: definition.durationTicks,
      };
    }

    if (dashPressed && record.canDash()) {
      const dashDir = horizontalDir !== 0 ? horizontalDir : record.facing;
      record.facing = dashDir;
      record.dashTicksRemaining = DASH_DURATION_TICKS;
      record.dashCooldownTicks = DASH_COOLDOWN_TICKS;
      body.setLinvel({ x: dashDir * DASH_SPEED, y: velocity.y }, true);
      this.previousInputFlags.set(id, inputFlags);
      return;
    }

    body.setLinvel({ x: horizontalDir * MOVE_SPEED, y: nextYVelocity }, true);
    this.previousInputFlags.set(id, inputFlags);
  }

  private tickDashCooldowns(): void {
    for (const [, record] of this.players) {
      if (record.dashCooldownTicks > 0) {
        record.dashCooldownTicks -= 1;
      }
    }
  }

  private tickAttacks(): void {
    for (const [, record] of this.players) {
      if (!record.activeAttack) continue;
      record.activeAttack.ticksRemaining -= 1;
      if (record.activeAttack.ticksRemaining <= 0) {
        record.activeAttack = null;
      }
    }
  }

  private attackCenter(
    playerX: number,
    playerY: number,
    facing: number,
    definition: ReturnType<typeof getEquippedAttack>,
  ): { x: number; y: number } {
    return {
      x: playerX + definition.centerOffsetX * facing,
      y: playerY + definition.centerOffsetY,
    };
  }

  private isGrounded(body: RAPIER.RigidBody): boolean {
    if (body.linvel().y > 0.2) return false;

    const position = body.translation();
    const feetY = position.y - PLAYER_HALF_HEIGHT;

    if (feetY <= FLOOR_Y + 0.06) return true;

    const rayOrigins = [
      { x: position.x - PLAYER_HALF_WIDTH * 0.9, y: feetY - 0.01 },
      { x: position.x,                            y: feetY - 0.01 },
      { x: position.x + PLAYER_HALF_WIDTH * 0.9, y: feetY - 0.01 },
    ];

    for (const origin of rayOrigins) {
      const ray = new RAPIER.Ray(origin, { x: 0, y: -1 });
      const hit = this.world.castRay(ray, 0.1, true);
      if (hit !== null) return true;
    }

    return false;
  }

  private enforceHorizontalBounds(): void {
    const minX = -ARENA_HALF_WIDTH + PLAYER_HALF_WIDTH;
    const maxX =  ARENA_HALF_WIDTH - PLAYER_HALF_WIDTH;

    for (const [, record] of this.players) {
      const position = record.body.translation();
      if (position.x < minX || position.x > maxX) {
        const clampedX = Math.min(Math.max(position.x, minX), maxX);
        const velocity = record.body.linvel();
        record.body.setTranslation({ x: clampedX, y: position.y }, true);
        record.body.setLinvel({ x: 0, y: velocity.y }, true);
      }
    }
  }

  private spawnXForPlayer(playerId: string): number {
    return PLAYER_SPAWN_SLOTS[this.hashString(playerId) % PLAYER_SPAWN_SLOTS.length];
  }

  private colorForPlayer(playerId: string): number {
    return (
      PLAYER_COLOR_PALETTE[this.hashString(playerId) % PLAYER_COLOR_PALETTE.length]
      ?? PLAYER_COLOR_PALETTE[0]
    );
  }

  private hashString(value: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }
}