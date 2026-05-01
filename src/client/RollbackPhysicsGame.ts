import * as RAPIER from '@dimforge/rapier2d-compat';
import type { Game, PlayerId } from 'rollback-netcode';
import {
  ARENA_HALF_WIDTH,
  FIXED_STEP_SECONDS,
  FLOOR_Y,
  GRAVITY_Y,
  JUMP_SPEED,
  MOVE_SPEED,
  PLATFORMS,
  PLAYER_COLOR_PALETTE,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  PLAYER_SPAWN_Y,
} from './constants';
import { InputBits, decodeInputBits } from './input';

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
  body: RAPIER.RigidBody;
  color: number;
};

const SPAWN_SLOTS = [-10, -4, 4, 10];

export class RollbackPhysicsGame implements Game<Uint8Array> {
  private readonly world: RAPIER.World;
  private readonly players = new Map<string, PlayerBodyRecord>();
  private readonly previousInputFlags = new Map<string, number>();
  private readonly textEncoder = new TextEncoder();
  private readonly textDecoder = new TextDecoder();

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: GRAVITY_Y });
    this.world.timestep = FIXED_STEP_SECONDS;
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
      return {
        idBytes,
        x: translation.x,
        y: translation.y,
        vx: velocity.x,
        vy: velocity.y,
        inputFlags,
      };
    });

    let byteLength = 1;
    for (const record of records) {
      byteLength += 2 + record.idBytes.length + 4 * 4 + 1;
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

      incoming.set(id, { x, y, vx, vy, inputFlags });
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
    }
  }

  step(inputs: Map<PlayerId, Uint8Array>): void {
    const ids = Array.from(inputs.keys(), (id) => id as string).sort();
    this.syncPlayers(ids);

    for (const id of ids) {
      const raw = inputs.get(id as PlayerId);
      this.applyInput(id, decodeInputBits(raw));
    }

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
        };
      });

    return { players };
  }

  reset(): void {
    for (const [, record] of this.players) {
      this.world.removeRigidBody(record.body);
    }
    this.players.clear();
    this.previousInputFlags.clear();
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
        RAPIER.RigidBodyDesc.fixed().setTranslation(
          platform.centerX,
          platform.centerY,
        ),
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
        this.players.set(id, {
          body: this.createPlayerBody(this.spawnXForPlayer(id)),
          color: this.colorForPlayer(id),
        });
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

    if (jumpPressed && this.isGrounded(body)) {
      nextYVelocity = JUMP_SPEED;
    }

    body.setLinvel({ x: horizontalDir * MOVE_SPEED, y: nextYVelocity }, true);
    this.previousInputFlags.set(id, inputFlags);
  }

  private isGrounded(body: RAPIER.RigidBody): boolean {
    if (body.linvel().y > 0.2) {
      return false;
    }

    const position = body.translation();
    const feetY = position.y - PLAYER_HALF_HEIGHT;

    if (feetY <= FLOOR_Y + 0.06) {
      return true;
    }

    // Cast a short ray straight down from just below each foot to detect
    // platforms underneath the player.
    const rayOrigins = [
      { x: position.x - PLAYER_HALF_WIDTH * 0.9, y: feetY - 0.01 },
      { x: position.x, y: feetY - 0.01 },
      { x: position.x + PLAYER_HALF_WIDTH * 0.9, y: feetY - 0.01 },
    ];

    for (const origin of rayOrigins) {
      const ray = new RAPIER.Ray(origin, { x: 0, y: -1 });
      const hit = this.world.castRay(ray, 0.1, true);
      if (hit !== null) {
        return true;
      }
    }

    return false;
  }

  private enforceHorizontalBounds(): void {
    const minX = -ARENA_HALF_WIDTH + PLAYER_HALF_WIDTH;
    const maxX = ARENA_HALF_WIDTH - PLAYER_HALF_WIDTH;

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
    return SPAWN_SLOTS[this.hashString(playerId) % SPAWN_SLOTS.length];
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
}
