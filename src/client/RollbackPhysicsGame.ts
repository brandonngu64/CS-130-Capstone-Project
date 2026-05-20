import * as RAPIER from '@dimforge/rapier2d-compat';
import type { Game, PlayerId } from 'rollback-netcode';
import {
  FIXED_STEP_SECONDS,
  GRAVITY_Y,
  JUMP_SPEED,
  MOVE_SPEED,
  PLAYER_COLOR_PALETTE,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
} from './constants';
import { InputBits, decodeInputBits } from './input';
import type { MapColliderRect, MapSpawnPoint, TiledMapDefinition } from './tiledMap';

export interface PlayerRenderState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: number;
}

export interface RenderState {
  players: PlayerRenderState[];
}

type PlayerBodyRecord = {
  id: string;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  color: number;
};

const PLATFORM_DROP_THROUGH_TICKS = 12;
const CONTACT_ALLOWANCE = 0.15;

export class RollbackPhysicsGame implements Game<Uint8Array> {
  private readonly map: TiledMapDefinition;
  private readonly world: RAPIER.World;
  private readonly players = new Map<string, PlayerBodyRecord>();
  private readonly playersByBodyHandle = new Map<number, PlayerBodyRecord>();
  private readonly previousInputFlags = new Map<string, number>();
  private readonly dropThroughTimers = new Map<string, number>();
  private readonly platformColliderHandles = new Set<number>();
  private readonly platformColliderRects = new Map<number, MapColliderRect>();
  private readonly physicsHooks: RAPIER.PhysicsHooks;
  private readonly textEncoder = new TextEncoder();
  private readonly textDecoder = new TextDecoder();

  constructor(map: TiledMapDefinition) {
    this.map = map;
    this.world = new RAPIER.World({ x: 0, y: GRAVITY_Y });
    this.world.timestep = FIXED_STEP_SECONDS;
    this.physicsHooks = {
      filterContactPair: (
        collider1: number,
        collider2: number,
        body1: number | null,
        body2: number | null,
      ) => this.filterContactPair(collider1, collider2, body1, body2),
      filterIntersectionPair: () => true,
    };
    this.createStaticLevel();
  }

  serialize(): Uint8Array {
    const sortedIds = Array.from(this.players.keys()).sort();

    const records = sortedIds.map((id) => {
      const record = this.players.get(id);
      if (!record) {
        throw new Error(`Missing player record for ${id}`);
      }
      const idBytes = this.textEncoder.encode(id);
      const translation = record.body.translation();
      const velocity = record.body.linvel();
      const inputFlags = this.previousInputFlags.get(id) ?? 0;
      const dropThroughTicks = this.dropThroughTimers.get(id) ?? 0;
      return {
        idBytes,
        x: translation.x,
        y: translation.y,
        vx: velocity.x,
        vy: velocity.y,
        inputFlags,
        dropThroughTicks,
      };
    });

    let byteLength = 1;
    for (const record of records) {
      byteLength += 2 + record.idBytes.length + 4 * 4 + 2;
    }

    const buffer = new ArrayBuffer(byteLength);
    const view = new DataView(buffer);
    const output = new Uint8Array(buffer);

    let offset = 0;
    view.setUint8(offset, records.length);
    offset += 1;

    for (const record of records) {
      view.setUint16(offset, record.idBytes.length, true);
      offset += 2;

      output.set(record.idBytes, offset);
      offset += record.idBytes.length;

      view.setFloat32(offset, record.x, true);
      offset += 4;
      view.setFloat32(offset, record.y, true);
      offset += 4;
      view.setFloat32(offset, record.vx, true);
      offset += 4;
      view.setFloat32(offset, record.vy, true);
      offset += 4;
      view.setUint8(offset, record.inputFlags & 0xff);
      offset += 1;
      view.setUint8(offset, record.dropThroughTicks & 0xff);
      offset += 1;
    }

    return output;
  }

  deserialize(data: Uint8Array): void {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    const count = view.getUint8(offset);
    offset += 1;

    const incoming = new Map<
      string,
      {
        x: number;
        y: number;
        vx: number;
        vy: number;
        inputFlags: number;
        dropThroughTicks: number;
      }
    >();

    for (let i = 0; i < count; i += 1) {
      const idByteLength = view.getUint16(offset, true);
      offset += 2;

      const idBytes = data.slice(offset, offset + idByteLength);
      offset += idByteLength;

      const id = this.textDecoder.decode(idBytes);
      const x = view.getFloat32(offset, true);
      offset += 4;
      const y = view.getFloat32(offset, true);
      offset += 4;
      const vx = view.getFloat32(offset, true);
      offset += 4;
      const vy = view.getFloat32(offset, true);
      offset += 4;
      const inputFlags = view.getUint8(offset);
      offset += 1;
      const dropThroughTicks = view.getUint8(offset);
      offset += 1;

      incoming.set(id, { x, y, vx, vy, inputFlags, dropThroughTicks });
    }

    this.syncPlayers(Array.from(incoming.keys()).sort());

    for (const [id, state] of incoming) {
      const record = this.players.get(id);
      if (!record) {
        continue;
      }
      record.body.setTranslation({ x: state.x, y: state.y }, true);
      record.body.setLinvel({ x: state.vx, y: state.vy }, true);
      this.previousInputFlags.set(id, state.inputFlags);
      this.dropThroughTimers.set(id, state.dropThroughTicks);
    }
  }

  step(inputs: Map<PlayerId, Uint8Array>): void {
    const ids = Array.from(inputs.keys(), (id) => id as string).sort();
    this.syncPlayers(ids);

    for (const id of ids) {
      const raw = inputs.get(id as PlayerId);
      this.applyInput(id, decodeInputBits(raw));
    }

    this.world.step(undefined, this.physicsHooks);
    this.enforceHorizontalBounds();
    this.advanceDropThroughTimers();
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
        };
      });

    return { players };
  }

  reset(): void {
    for (const [, record] of this.players) {
      this.world.removeRigidBody(record.body);
    }
    this.players.clear();
    this.playersByBodyHandle.clear();
    this.previousInputFlags.clear();
    this.dropThroughTimers.clear();
  }

  private createStaticLevel(): void {
    for (const rect of this.map.colliders.solids) {
      this.createStaticCollider(rect, false);
    }

    for (const rect of this.map.colliders.platforms) {
      this.createStaticCollider(rect, true);
    }
  }

  private createStaticCollider(rect: MapColliderRect, platform: boolean): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(rect.x, rect.y),
    );
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      rect.width * 0.5,
      rect.height * 0.5,
    )
      .setFriction(1)
      .setRestitution(0);

    if (platform) {
      colliderDesc.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
    }

    const collider = this.world.createCollider(colliderDesc, body);

    if (platform) {
      this.platformColliderHandles.add(collider.handle);
      this.platformColliderRects.set(collider.handle, rect);
    }
  }

  private syncPlayers(sortedIds: string[]): void {
    const keep = new Set(sortedIds);

    for (const [id, record] of this.players) {
      if (!keep.has(id)) {
        this.world.removeRigidBody(record.body);
        this.players.delete(id);
        this.playersByBodyHandle.delete(record.body.handle);
        this.previousInputFlags.delete(id);
        this.dropThroughTimers.delete(id);
      }
    }

    for (const id of sortedIds) {
      if (!this.players.has(id)) {
        const spawnPoint = this.spawnPointForPlayer(id);
        const bodyRecord = this.createPlayerBody(spawnPoint);
        const record: PlayerBodyRecord = {
          ...bodyRecord,
          color: this.colorForPlayer(id),
          id,
        };

        this.players.set(id, record);
        this.playersByBodyHandle.set(record.body.handle, record);
        this.previousInputFlags.set(id, 0);
        this.dropThroughTimers.set(id, 0);
      }
    }
  }

  private createPlayerBody(spawnPoint: MapSpawnPoint): {
    body: RAPIER.RigidBody;
    collider: RAPIER.Collider;
  } {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawnPoint.x, spawnPoint.feetY + PLAYER_HALF_HEIGHT)
        .lockRotations()
        .setLinearDamping(0)
        .setAngularDamping(0)
        .setCcdEnabled(true),
    );

    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)
        .setFriction(1)
        .setRestitution(0),
      body,
    );

    return { body, collider };
  }

  private applyInput(id: string, inputFlags: number): void {
    const record = this.players.get(id);
    if (!record) {
      return;
    }

    const body = record.body;
    const velocity = body.linvel();
    const previousFlags = this.previousInputFlags.get(id) ?? 0;

    const horizontalDir =
      (inputFlags & InputBits.Left ? -1 : 0) +
      (inputFlags & InputBits.Right ? 1 : 0);

    let nextYVelocity = velocity.y;
    const jumpPressed =
      (inputFlags & InputBits.Jump) !== 0 &&
      (previousFlags & InputBits.Jump) === 0;
    const duckPressed =
      (inputFlags & InputBits.Duck) !== 0 &&
      (previousFlags & InputBits.Duck) === 0;

    if (jumpPressed && this.isGrounded(record)) {
      nextYVelocity = JUMP_SPEED;
    }

    if (duckPressed && this.isStandingOnPlatform(record)) {
      this.dropThroughTimers.set(id, PLATFORM_DROP_THROUGH_TICKS);
    }

    body.setLinvel({ x: horizontalDir * MOVE_SPEED, y: nextYVelocity }, true);
    this.previousInputFlags.set(id, inputFlags);
  }

  private isGrounded(record: PlayerBodyRecord): boolean {
    const body = record.body;
    if (body.linvel().y > 0.2) {
      return false;
    }

    const position = body.translation();
    const feetY = position.y - PLAYER_HALF_HEIGHT;
    const dropThroughTicks = this.dropThroughTimers.get(record.id) ?? 0;
    const rayOrigins = [
      { x: position.x - PLAYER_HALF_WIDTH * 0.9, y: feetY - 0.01 },
      { x: position.x, y: feetY - 0.01 },
      { x: position.x + PLAYER_HALF_WIDTH * 0.9, y: feetY - 0.01 },
    ];

    for (const origin of rayOrigins) {
      const ray = new RAPIER.Ray(origin, { x: 0, y: -1 });
      const hit = this.world.castRay(
        ray,
        0.25,
        true,
        undefined,
        undefined,
        record.collider,
        undefined,
        (collider) =>
          dropThroughTicks === 0 || !this.platformColliderHandles.has(collider.handle),
      );
      if (hit) {
        return true;
      }
    }

    return false;
  }

  private enforceHorizontalBounds(): void {
    const minX = this.map.bounds.minX + PLAYER_HALF_WIDTH;
    const maxX = this.map.bounds.maxX - PLAYER_HALF_WIDTH;

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

  private advanceDropThroughTimers(): void {
    for (const [id, timer] of this.dropThroughTimers) {
      this.dropThroughTimers.set(id, timer > 0 ? timer - 1 : 0);
    }
  }

  private spawnPointForPlayer(playerId: string): MapSpawnPoint {
    if (this.map.playerSpawnPoints.length === 0) {
      return {
        feetY: 0,
        layerName: 'level_layer',
        role: 'player_spawn',
        tileX: 0,
        tileY: 0,
        x: 0,
        y: 0,
      };
    }

    return this.map.playerSpawnPoints[
      this.hashString(playerId) % this.map.playerSpawnPoints.length
    ];
  }

  private colorForPlayer(playerId: string): number {
    return (
      PLAYER_COLOR_PALETTE[
        this.hashString(playerId) % PLAYER_COLOR_PALETTE.length
      ] ?? PLAYER_COLOR_PALETTE[0]
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

  private isStandingOnPlatform(record: PlayerBodyRecord): boolean {
    const body = record.body;
    const position = body.translation();
    const feetY = position.y - PLAYER_HALF_HEIGHT;
    const rayOrigins = [
      { x: position.x - PLAYER_HALF_WIDTH * 0.9, y: feetY - 0.01 },
      { x: position.x, y: feetY - 0.01 },
      { x: position.x + PLAYER_HALF_WIDTH * 0.9, y: feetY - 0.01 },
    ];

    for (const origin of rayOrigins) {
      const ray = new RAPIER.Ray(origin, { x: 0, y: -1 });
      const hit = this.world.castRay(
        ray,
        0.25,
        true,
        undefined,
        undefined,
        record.collider,
        undefined,
        (collider) => this.platformColliderHandles.has(collider.handle),
      );

      if (hit) {
        return true;
      }
    }

    return false;
  }

  private filterContactPair(
    collider1: number,
    collider2: number,
    body1: number | null,
    body2: number | null,
  ): RAPIER.SolverFlags {
    const platformColliderHandle = this.platformColliderHandles.has(collider1)
      ? collider1
      : this.platformColliderHandles.has(collider2)
        ? collider2
        : null;

    if (platformColliderHandle === null) {
      return RAPIER.SolverFlags.COMPUTE_IMPULSE;
    }

    const playerRecord =
      (body1 !== null ? this.playersByBodyHandle.get(body1) : null) ??
      (body2 !== null ? this.playersByBodyHandle.get(body2) : null);

    if (!playerRecord) {
      return RAPIER.SolverFlags.COMPUTE_IMPULSE;
    }

    const rect = this.platformColliderRects.get(platformColliderHandle);
    if (!rect) {
      return RAPIER.SolverFlags.COMPUTE_IMPULSE;
    }

    if ((this.dropThroughTimers.get(playerRecord.id) ?? 0) > 0) {
      return RAPIER.SolverFlags.EMPTY;
    }

    const playerPosition = playerRecord.body.translation();
    const playerBottom = playerPosition.y - PLAYER_HALF_HEIGHT;
    const platformTop = rect.y + rect.height * 0.5;
    const verticalVelocity = playerRecord.body.linvel().y;

    const canStandOnPlatform =
      playerBottom >= platformTop - CONTACT_ALLOWANCE && verticalVelocity <= 0.05;

    return canStandOnPlatform
      ? RAPIER.SolverFlags.COMPUTE_IMPULSE
      : RAPIER.SolverFlags.EMPTY;
  }
}
