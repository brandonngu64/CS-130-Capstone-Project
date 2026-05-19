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
  PLAYER_SPAWN_Y,
} from './constants';
import { InputBits, decodeInputBits } from './input';
import type { LevelDefinition, LevelSpawnPoint, LevelTile } from './levels';

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

type StepState = {
  x: number;
  y: number;
  velocityY: number;
  ducking: boolean;
};

export class RollbackPhysicsGame implements Game<Uint8Array> {
  private readonly world: RAPIER.World;
  private readonly level: LevelDefinition;
  private readonly players = new Map<string, PlayerBodyRecord>();
  private readonly previousInputFlags = new Map<string, number>();
  private readonly textEncoder = new TextEncoder();
  private readonly textDecoder = new TextDecoder();
  private readonly platformTiles: LevelTile[];

  constructor(level: LevelDefinition) {
    this.level = level;
    this.platformTiles = level.tiles.filter((tile) => tile.kind === 'platform');
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

    const beforeStepStates = new Map<string, StepState>();

    for (const id of ids) {
      const raw = inputs.get(id as PlayerId);
      const inputFlags = decodeInputBits(raw);
      this.applyInput(id, inputFlags);

      const record = this.players.get(id);
      if (!record) {
        continue;
      }

      const position = record.body.translation();
      const velocity = record.body.linvel();
      beforeStepStates.set(id, {
        x: position.x,
        y: position.y,
        velocityY: velocity.y,
        ducking: (inputFlags & InputBits.Duck) !== 0,
      });
    }

    this.world.step();
    this.resolvePlatformContacts(beforeStepStates);
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
    for (const tile of this.level.tiles) {
      if (tile.kind !== 'solid') {
        continue;
      }

      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(tile.x, tile.y),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(tile.width * 0.5, tile.height * 0.5)
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

    for (let index = 0; index < sortedIds.length; index += 1) {
      const id = sortedIds[index];
      if (!this.players.has(id)) {
        const spawn = this.spawnForPlayer(id, index);
        this.players.set(id, {
          body: this.createPlayerBody(spawn),
          color: this.colorForPlayer(id),
        });
        this.previousInputFlags.set(id, 0);
      }
    }
  }

  private createPlayerBody(spawn: LevelSpawnPoint): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y)
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
    const ducking = (inputFlags & InputBits.Duck) !== 0;

    const horizontalDir =
      (inputFlags & InputBits.Left ? -1 : 0) +
      (inputFlags & InputBits.Right ? 1 : 0);

    let nextYVelocity = velocity.y;
    const jumpPressed =
      (inputFlags & InputBits.Jump) !== 0 &&
      (previousFlags & InputBits.Jump) === 0;

    if (jumpPressed && this.isGrounded(body, ducking)) {
      nextYVelocity = JUMP_SPEED;
    }

    body.setLinvel({ x: horizontalDir * MOVE_SPEED, y: nextYVelocity }, true);
    this.previousInputFlags.set(id, inputFlags);
  }

  private isGrounded(body: RAPIER.RigidBody, ducking: boolean): boolean {
    if (body.linvel().y > 0.2) {
      return false;
    }

    const position = body.translation();
    const feetY = position.y - PLAYER_HALF_HEIGHT;

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

    if (ducking) {
      return false;
    }

    for (const platform of this.platformTiles) {
      const left = platform.x - platform.width * 0.5;
      const right = platform.x + platform.width * 0.5;
      if (
        position.x + PLAYER_HALF_WIDTH <= left ||
        position.x - PLAYER_HALF_WIDTH >= right
      ) {
        continue;
      }

      const top = platform.y + platform.height * 0.5;
      if (feetY <= top + 0.06 && feetY >= top - 0.12) {
        return true;
      }
    }

    return false;
  }

  private resolvePlatformContacts(previousStates: Map<string, StepState>): void {
    if (this.platformTiles.length === 0) {
      return;
    }

    for (const [id, record] of this.players) {
      const previousState = previousStates.get(id);
      if (!previousState || previousState.ducking || previousState.velocityY > 0.05) {
        continue;
      }

      const currentPosition = record.body.translation();
      const currentFeetY = currentPosition.y - PLAYER_HALF_HEIGHT;
      const previousFeetY = previousState.y - PLAYER_HALF_HEIGHT;

      for (const platform of this.platformTiles) {
        const left = platform.x - platform.width * 0.5;
        const right = platform.x + platform.width * 0.5;
        if (
          currentPosition.x + PLAYER_HALF_WIDTH <= left ||
          currentPosition.x - PLAYER_HALF_WIDTH >= right
        ) {
          continue;
        }

        const top = platform.y + platform.height * 0.5;
        const crossedTop = previousFeetY >= top - 0.08 && currentFeetY <= top + 0.08;
        if (!crossedTop) {
          continue;
        }

        const velocity = record.body.linvel();
        record.body.setTranslation({ x: currentPosition.x, y: top + PLAYER_HALF_HEIGHT }, true);
        record.body.setLinvel({ x: velocity.x, y: 0 }, true);
        break;
      }
    }
  }

  private enforceHorizontalBounds(): void {
    const minX = this.level.bounds.minX + PLAYER_HALF_WIDTH;
    const maxX = this.level.bounds.maxX - PLAYER_HALF_WIDTH;

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

  private spawnForPlayer(playerId: string, index: number): LevelSpawnPoint {
    if (this.level.playerSpawns.length > 0) {
      const spawn = this.level.playerSpawns[index % this.level.playerSpawns.length];
      return {
        id: spawn.id,
        x: spawn.x,
        y: spawn.y,
        visible: spawn.visible,
      };
    }

    const spawnSlots = [-0.3, -0.1, 0.1, 0.3];
    const slot = spawnSlots[this.hashString(playerId) % spawnSlots.length];

    return {
      id: this.hashString(playerId),
      x: slot * this.level.width,
      y: PLAYER_SPAWN_Y,
      visible: false,
    };
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
