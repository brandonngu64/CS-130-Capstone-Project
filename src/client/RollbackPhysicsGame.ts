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
import { readArenaSideWallsEnabled } from './arenaOptions';
import { GameStateManager } from './GameStateManager';
import { InputBits, decodeInputBits } from './input';
import type { MapColliderRect, MapSpawnPoint, TiledMapDefinition } from './tiledMap';

export interface PlayerRenderState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: number;
  stocks: number;
  eliminated: boolean;
  respawning: boolean;
}

export interface RenderState {
  players: PlayerRenderState[];
}

type PlayerBodyRecord = {
  id: string;
  body: RAPIER.RigidBody;
  color: number;
};

type StepPlayerState = {
  ducking: boolean;
  vx: number;
  vy: number;
  x: number;
  y: number;
};

const CONTACT_ALLOWANCE = 0.15;
const GROUND_RAY_OFFSET = 0.02;
const GROUND_RAY_LENGTH = 0.25;

export class RollbackPhysicsGame implements Game<Uint8Array> {
  private readonly map: TiledMapDefinition;
  private readonly world: RAPIER.World;
  private readonly players = new Map<string, PlayerBodyRecord>();
  private readonly previousInputFlags = new Map<string, number>();
  private readonly staticColliderHandles = new Set<number>();
  private readonly matchState = new GameStateManager();
  private readonly textEncoder = new TextEncoder();
  private readonly textDecoder = new TextDecoder();

  private sideWallsEnabled: boolean;

  constructor(map: TiledMapDefinition, sideWallsEnabled = readArenaSideWallsEnabled()) {
    this.map = map;
    this.sideWallsEnabled = sideWallsEnabled;
    this.world = new RAPIER.World({ x: 0, y: GRAVITY_Y });
    this.world.timestep = FIXED_STEP_SECONDS;
    this.createStaticLevel();
  }

  areSideWallsEnabled(): boolean {
    return this.sideWallsEnabled;
  }

  setSideWallsEnabled(enabled: boolean): void {
    this.sideWallsEnabled = enabled;
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
        inputFlags,
        vx: velocity.x,
        vy: velocity.y,
        x: translation.x,
        y: translation.y,
      };
    });

    const matchBytes = this.matchState.matchBytesPerPlayer();
    let byteLength = 1;
    for (const record of records) {
      byteLength += 2 + record.idBytes.length + 4 * 4 + 1 + matchBytes;
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

      const id = this.textDecoder.decode(record.idBytes);
      offset = this.matchState.writePlayer(view, offset, id);
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
        inputFlags: number;
        vx: number;
        vy: number;
        x: number;
        y: number;
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

      offset = this.matchState.readPlayer(view, offset, id);
      incoming.set(id, { inputFlags, vx, vy, x, y });
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

    const previousStates = new Map<string, StepPlayerState>();

    for (const id of ids) {
      if (!this.matchState.canReceiveInput(id)) {
        continue;
      }

      const raw = inputs.get(id as PlayerId);
      if (!raw) {
        continue;
      }

      const inputFlags = decodeInputBits(raw);
      const record = this.players.get(id);
      if (!record) {
        continue;
      }

      const position = record.body.translation();
      this.applyInput(id, inputFlags);

      const velocity = record.body.linvel();
      previousStates.set(id, {
        ducking: (inputFlags & InputBits.Duck) !== 0,
        vx: velocity.x,
        vy: velocity.y,
        x: position.x,
        y: position.y,
      });
    }

    this.world.step();
    this.resolvePlatformContacts(previousStates);

    if (this.sideWallsEnabled) {
      this.enforceHorizontalBounds();
    }

    this.matchState.checkBlastZone(this.players, (playerId) =>
      this.spawnPointForPlayer(playerId),
    );
    this.matchState.tickRespawn(this.players, (playerId) =>
      this.spawnPointForPlayer(playerId),
    );
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
        const match = this.matchState.getRenderInfo(id);
        return {
          color: record.color,
          height: PLAYER_HALF_HEIGHT * 2,
          id,
          width: PLAYER_HALF_WIDTH * 2,
          x: position.x,
          y: position.y,
          stocks: match.stocks,
          eliminated: match.eliminated,
          respawning: match.respawning,
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
    this.matchState.clear();
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
      colliderDesc.setSensor(true);
    }

    const collider = this.world.createCollider(colliderDesc, body);
    this.staticColliderHandles.add(collider.handle);
  }

  private syncPlayers(sortedIds: string[]): void {
    const keep = new Set(sortedIds);

    for (const [id, record] of this.players) {
      if (!keep.has(id)) {
        this.world.removeRigidBody(record.body);
        this.players.delete(id);
        this.previousInputFlags.delete(id);
        this.matchState.removePlayer(id);
      }
    }

    for (const id of sortedIds) {
      if (!this.players.has(id)) {
        const spawnPoint = this.spawnPointForPlayer(id);
        this.players.set(id, {
          body: this.createPlayerBody(spawnPoint),
          color: this.colorForPlayer(id),
          id,
        });
        this.previousInputFlags.set(id, 0);
        this.matchState.ensurePlayer(id);
      }
    }
  }

  private createPlayerBody(spawnPoint: MapSpawnPoint): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawnPoint.x, spawnPoint.feetY + PLAYER_HALF_HEIGHT)
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
    const ducking = (inputFlags & InputBits.Duck) !== 0;

    if (jumpPressed && this.isGrounded(record, ducking)) {
      nextYVelocity = JUMP_SPEED;
    }

    body.setLinvel({ x: horizontalDir * MOVE_SPEED, y: nextYVelocity }, true);
    this.previousInputFlags.set(id, inputFlags);
  }

  private isGrounded(record: PlayerBodyRecord, ducking: boolean): boolean {
    if (ducking) {
      return false;
    }

    const body = record.body;
    if (body.linvel().y > 0.2) {
      return false;
    }

    const position = body.translation();
    const feetY = position.y - PLAYER_HALF_HEIGHT;
    const rayOrigins = [
      { x: position.x - PLAYER_HALF_WIDTH * 0.9, y: feetY + GROUND_RAY_OFFSET },
      { x: position.x, y: feetY + GROUND_RAY_OFFSET },
      { x: position.x + PLAYER_HALF_WIDTH * 0.9, y: feetY + GROUND_RAY_OFFSET },
    ];

    for (const origin of rayOrigins) {
      const ray = new RAPIER.Ray(origin, { x: 0, y: -1 });
      const hit = this.world.castRay(
        ray,
        GROUND_RAY_LENGTH,
        true,
        undefined,
        undefined,
        undefined,
        body,
        (collider) => this.staticColliderHandles.has(collider.handle),
      );
      if (hit) {
        return true;
      }
    }

    return false;
  }

  private resolvePlatformContacts(previousStates: Map<string, StepPlayerState>): void {
    for (const [id, record] of this.players) {
      const previousState = previousStates.get(id);
      if (!previousState || previousState.ducking) {
        continue;
      }

      if (previousState.vy > 0.05) {
        continue;
      }

      const position = record.body.translation();
      const currentBottom = position.y - PLAYER_HALF_HEIGHT;
      const previousBottom = previousState.y - PLAYER_HALF_HEIGHT;
      const playerLeft = position.x - PLAYER_HALF_WIDTH;
      const playerRight = position.x + PLAYER_HALF_WIDTH;

      let bestPlatformTop: number | null = null;

      for (const platform of this.map.colliders.platforms) {
        const platformLeft = platform.x - platform.width * 0.5;
        const platformRight = platform.x + platform.width * 0.5;
        if (playerRight <= platformLeft || playerLeft >= platformRight) {
          continue;
        }

        const platformTop = platform.y + platform.height * 0.5;
        const crossedFromAbove =
          previousBottom >= platformTop - CONTACT_ALLOWANCE &&
          currentBottom <= platformTop + CONTACT_ALLOWANCE;

        if (!crossedFromAbove) {
          continue;
        }

        if (bestPlatformTop === null || platformTop > bestPlatformTop) {
          bestPlatformTop = platformTop;
        }
      }

      if (bestPlatformTop !== null) {
        const velocity = record.body.linvel();
        record.body.setTranslation(
          { x: position.x, y: bestPlatformTop + PLAYER_HALF_HEIGHT },
          true,
        );
        record.body.setLinvel({ x: velocity.x, y: 0 }, true);
      }
    }
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
}
