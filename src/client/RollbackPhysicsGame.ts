import * as RAPIER from '@dimforge/rapier2d-compat';
import type { Game, PlayerId } from 'rollback-netcode';
import {
  BLAST_ZONE_DOWN_OFFSET,
  BLAST_ZONE_SIDE_OFFSET,
  BLAST_ZONE_UP_OFFSET,
  BULLET_HALF_WIDTH,
  BULLET_ID_MAX,
  BULLET_LIFETIME_TICKS,
  BULLET_SPEED,
  DASH_COOLDOWN_TICKS,
  DASH_DURATION_TICKS,
  DASH_SPEED,
  FIXED_STEP_SECONDS,
  FLOOR_Y,
  GRAVITY_Y,
  JUMP_SPEED,
  MOVE_SPEED,
  PLAYER_COLOR_PALETTE,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  TICK_RATE,
  type CharacterId,
  characterIdFromIndex,
  characterIdToIndex,
} from './constants';
import { defaultCharacterForPlayer } from './CharacterSprites';
import { GameStateManager } from './GameStateManager';
import { AttackKind, getAttackDefinition, getEquippedAttack } from './attacks';
import type { AttackDefinition } from './attacks';
import { InputBits, decodeInputBits } from './input';
import { PlayerCharacter } from './PlayerCharacter';
import { K_getWeaponDefinition } from './kyleWeapons';
import {
  ITEM_LIFETIME_TICKS,
  ITEM_PICKUP_RADIUS,
  ITEM_SPAWN_INTERVAL_TICKS,
  ItemKind,
  WEAPON_DEFINITIONS,
} from './items';
import type { WeaponDefinition, WorldItem } from './items';
import type { MapColliderRect, MapSpawnPoint, TiledMapDefinition } from './tiledMap';

export interface AttackRenderState {
  id: string;
  x: number;
  y: number;
  characterId: CharacterId;
  facing: number;
  displayHeight: number;
}

export interface PlayerRenderState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: number;
  characterId: CharacterId;
  stocks: number;
  eliminated: boolean;
  respawning: boolean;
  respawnFlashTicksRemaining: number;
  health: number;
  maxHealth: number;
  heldItem: ItemKind | null;
  facing: number;
  vx: number;
  gunFireCooldownTicks: number;
  activeWeaponAttack: { defKind: ItemKind; ticksRemaining: number } | null;
}

export interface ItemRenderState {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
}

export interface BulletRenderState {
  id: number;
  x: number;
  y: number;
  kind: ItemKind;
  facing: number;
}

export interface RenderState {
  players: PlayerRenderState[];
  attacks: AttackRenderState[];
  items: ItemRenderState[];
  bullets: BulletRenderState[];
  winnerId: string | null;
  roundStartCountdownLabel: string | null;
  animTick: number;
}

type StepPlayerState = {
  ducking: boolean;
  vx: number;
  vy: number;
  x: number;
  y: number;
};

type Bullet = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ticksRemaining: number;
  kind: ItemKind;
  damage: number;
  ownerId: string;
  reloadOnHit: boolean;
  reloadOnKill: boolean;
  projectileGravity: number;
};

type ItemSlotState = {
  item: WorldItem | null;
  respawnTick: number;
};

const CONTACT_ALLOWANCE = 0.15;
const GROUND_RAY_OFFSET = 0.02;
const GROUND_RAY_LENGTH = 0.25;
const ROUND_START_COUNTDOWN_TOTAL_TICKS = TICK_RATE * 4;
const SPAWN_ROTATION: readonly ItemKind[] = [
  ItemKind.BinaryBeam,
  ItemKind.PenCrossbow,
  ItemKind.EthernetWhip,
  ItemKind.Finals,
];

export class RollbackPhysicsGame implements Game<Uint8Array> {
  private readonly map: TiledMapDefinition;
  private readonly world: RAPIER.World;
  private readonly players = new Map<string, PlayerCharacter>();
  private readonly previousInputFlags = new Map<string, number>();
  private readonly staticColliderHandles = new Set<number>();
  private readonly platformColliderHandles = new Set<number>();
  private readonly playerColliderHandles = new Map<number, string>();
  private readonly matchState = new GameStateManager();
  private readonly textEncoder = new TextEncoder();
  private readonly textDecoder = new TextDecoder();
  private readonly bullets = new Map<number, Bullet>();
  private readonly itemSlots: ItemSlotState[] = [];
  private nextBulletId = 1;
  private tickCount = 0;
  private roundStartCountdownTicks = 0;
  private previousConnectedPlayerCount = 0;
  private readonly pendingCharacterIds = new Map<string, CharacterId>();

  constructor(map: TiledMapDefinition) {
    this.map = map;
    this.world = new RAPIER.World({ x: 0, y: GRAVITY_Y });
    this.world.timestep = FIXED_STEP_SECONDS;
    this.createStaticLevel();
    this.initializeItemSlots();
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
      const activeAttack = record.activeAttack;

      return {
        idBytes,
        inputFlags,
        x: translation.x,
        y: translation.y,
        vx: velocity.x,
        vy: velocity.y,
        health: record.health,
        facing: record.facing,
        attackKind: activeAttack?.kind ?? 0,
        attackTicksRemaining: activeAttack?.ticksRemaining ?? 0,
        dashTicksRemaining: record.dashTicksRemaining,
        dashCooldownTicks: record.dashCooldownTicks,
        heldItem: record.heldItem ?? 0,
        heldItemExpiryTick: record.heldItemExpiryTick,
        gunFireCooldownTicks: record.gunFireCooldownTicks,
        reloadPending: record.reloadPending,
        reloadPendingOnKill: record.reloadPendingOnKill,
        characterId: characterIdToIndex(record.characterId),
        weaponCooldownTicks: record.weaponCooldownTicks,
        activeWeaponAttackTicksRemaining: record.activeWeaponAttack?.ticksRemaining ?? 0,
      };
    });

    const matchBytes = this.matchState.matchBytesPerPlayer();
    const bulletList = Array.from(this.bullets.values()).sort((left, right) => left.id - right.id);
    let byteLength = 1;
    for (const record of records) {
      byteLength += 2 + record.idBytes.length + 16 + 17 + matchBytes;
    }

    byteLength += 4 + 1 + 1 + 1;
    for (const bullet of bulletList) {
      const ownerIdBytes = this.textEncoder.encode(bullet.ownerId);
      byteLength += 1 + 4 + 4 + 4 + 4 + 1 + 2 + 1 + 2 + ownerIdBytes.length + 1 + 1 + 4;
    }
    byteLength += 1 + this.itemSlots.length * 10 + 1;

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

      view.setFloat32(offset, record.x, true); offset += 4;
      view.setFloat32(offset, record.y, true); offset += 4;
      view.setFloat32(offset, record.vx, true); offset += 4;
      view.setFloat32(offset, record.vy, true); offset += 4;
      view.setUint8(offset, record.inputFlags & 0xff); offset += 1;
      view.setUint8(offset, record.health); offset += 1;
      view.setInt8(offset, record.facing < 0 ? -1 : 1); offset += 1;
      view.setUint8(offset, record.attackKind); offset += 1;
      view.setUint8(offset, record.attackTicksRemaining); offset += 1;
      view.setUint8(offset, record.dashTicksRemaining); offset += 1;
      view.setUint8(offset, record.dashCooldownTicks); offset += 1;
      view.setUint16(offset, record.heldItem ?? 0, true); offset += 2;
      view.setUint16(offset, record.heldItemExpiryTick, true); offset += 2;
      view.setUint8(offset, record.gunFireCooldownTicks); offset += 1;
      view.setUint8(offset, record.reloadPending ? 1 : 0); offset += 1;
      view.setUint8(offset, record.reloadPendingOnKill ? 1 : 0); offset += 1;
      view.setUint8(offset, record.characterId); offset += 1;
      view.setUint8(offset, record.weaponCooldownTicks); offset += 1;
      view.setUint8(offset, record.activeWeaponAttackTicksRemaining); offset += 1;

      offset = this.matchState.writePlayer(view, offset, this.textDecoder.decode(record.idBytes));
    }

    view.setUint32(offset, this.tickCount, true);
    offset += 4;
    view.setUint8(offset, this.roundStartCountdownTicks & 0xff);
    offset += 1;
    view.setUint8(offset, this.previousConnectedPlayerCount & 0xff);
    offset += 1;

    view.setUint8(offset, bulletList.length);
    offset += 1;

    for (const bullet of bulletList) {
      const ownerIdBytes = this.textEncoder.encode(bullet.ownerId);
      view.setUint8(offset, bullet.id); offset += 1;
      view.setFloat32(offset, bullet.x, true); offset += 4;
      view.setFloat32(offset, bullet.y, true); offset += 4;
      view.setFloat32(offset, bullet.vx, true); offset += 4;
      view.setFloat32(offset, bullet.vy, true); offset += 4;
      view.setUint8(offset, bullet.ticksRemaining); offset += 1;
      view.setUint16(offset, bullet.kind, true); offset += 2;
      view.setUint8(offset, bullet.damage); offset += 1;
      view.setUint16(offset, ownerIdBytes.length, true); offset += 2;
      output.set(ownerIdBytes, offset);
      offset += ownerIdBytes.length;
      view.setUint8(offset, bullet.reloadOnHit ? 1 : 0); offset += 1;
      view.setUint8(offset, bullet.reloadOnKill ? 1 : 0); offset += 1;
      view.setFloat32(offset, bullet.projectileGravity, true); offset += 4;
    }

    view.setUint8(offset, this.itemSlots.length);
    offset += 1;

    for (const slot of this.itemSlots) {
      view.setUint16(offset, slot.item?.kind ?? 0, true); offset += 2;
      view.setUint32(offset, slot.item?.expiryTick ?? 0, true); offset += 4;
      view.setUint32(offset, slot.respawnTick, true); offset += 4;
    }

    view.setUint8(offset, this.nextBulletId); offset += 1;

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
        health: number;
        facing: number;
        attackKind: number;
        attackTicksRemaining: number;
        dashTicksRemaining: number;
        dashCooldownTicks: number;
        heldItem: number;
        heldItemExpiryTick: number;
        gunFireCooldownTicks: number;
        reloadPending: boolean;
        reloadPendingOnKill: boolean;
        characterId: number;
        weaponCooldownTicks: number;
        activeWeaponAttackTicksRemaining: number;
      }
    >();

    for (let i = 0; i < count; i += 1) {
      const idByteLength = view.getUint16(offset, true);
      offset += 2;
      const idBytes = data.slice(offset, offset + idByteLength);
      offset += idByteLength;
      const id = this.textDecoder.decode(idBytes);

      const x = view.getFloat32(offset, true); offset += 4;
      const y = view.getFloat32(offset, true); offset += 4;
      const vx = view.getFloat32(offset, true); offset += 4;
      const vy = view.getFloat32(offset, true); offset += 4;
      const inputFlags = view.getUint8(offset); offset += 1;
      const health = view.getUint8(offset); offset += 1;
      const facing = view.getInt8(offset); offset += 1;
      const attackKind = view.getUint8(offset); offset += 1;
      const attackTicksRemaining = view.getUint8(offset); offset += 1;
      const dashTicksRemaining = view.getUint8(offset); offset += 1;
      const dashCooldownTicks = view.getUint8(offset); offset += 1;
      const heldItem = view.getUint16(offset, true); offset += 2;
      const heldItemExpiryTick = view.getUint16(offset, true); offset += 2;
      const gunFireCooldownTicks = view.getUint8(offset); offset += 1;
      const reloadPending = view.getUint8(offset) !== 0; offset += 1;
      const reloadPendingOnKill = view.getUint8(offset) !== 0; offset += 1;
      const characterId = view.getUint8(offset); offset += 1;
      const weaponCooldownTicks = view.getUint8(offset); offset += 1;
      const activeWeaponAttackTicksRemaining = view.getUint8(offset); offset += 1;

      incoming.set(id, {
        x,
        y,
        vx,
        vy,
        inputFlags,
        health,
        facing,
        attackKind,
        attackTicksRemaining,
        dashTicksRemaining,
        dashCooldownTicks,
        heldItem,
        heldItemExpiryTick,
        gunFireCooldownTicks,
        reloadPending,
        reloadPendingOnKill,
        characterId,
        weaponCooldownTicks,
        activeWeaponAttackTicksRemaining,
      });

      offset = this.matchState.readPlayer(view, offset, id);
    }

    this.syncPlayers(Array.from(incoming.keys()).sort());

    this.tickCount = view.getUint32(offset, true);
    offset += 4;
    this.roundStartCountdownTicks = view.getUint8(offset);
    offset += 1;
    this.previousConnectedPlayerCount = view.getUint8(offset);
    offset += 1;

    for (const [id, state] of incoming) {
      const record = this.players.get(id);
      if (!record) {
        continue;
      }

      record.body.setTranslation({ x: state.x, y: state.y }, true);
      record.body.setLinvel({ x: state.vx, y: state.vy }, true);
      record.health = Math.max(0, Math.min(state.health, record.maxHealth));
      record.facing = state.facing < 0 ? -1 : 1;
      record.activeAttack =
        state.attackKind > 0 && state.attackTicksRemaining > 0
          ? { kind: state.attackKind as AttackKind, ticksRemaining: state.attackTicksRemaining }
          : null;
      record.dashTicksRemaining = state.dashTicksRemaining;
      record.dashCooldownTicks = state.dashCooldownTicks;
      record.heldItem = state.heldItem > 0 ? (state.heldItem as ItemKind) : null;
      record.heldItemExpiryTick = state.heldItemExpiryTick;
      record.gunFireCooldownTicks = state.gunFireCooldownTicks;
      record.reloadPending = state.reloadPending;
      record.reloadPendingOnKill = state.reloadPendingOnKill;
      record.characterId = characterIdFromIndex(state.characterId);
      record.weaponCooldownTicks = state.weaponCooldownTicks;

      // Reconstruct activeWeaponAttack from the serialized ticks + current heldItem
      if (state.activeWeaponAttackTicksRemaining > 0 && state.heldItem > 0) {
        const def = WEAPON_DEFINITIONS[state.heldItem as ItemKind];
        record.activeWeaponAttack = def
          ? { def, ticksRemaining: state.activeWeaponAttackTicksRemaining }
          : null;
      } else {
        record.activeWeaponAttack = null;
      }

      this.previousInputFlags.set(id, state.inputFlags);
    }

    this.bullets.clear();
    const bulletCount = view.getUint8(offset);
    offset += 1;

    for (let i = 0; i < bulletCount; i += 1) {
      const id = view.getUint8(offset); offset += 1;
      const x = view.getFloat32(offset, true); offset += 4;
      const y = view.getFloat32(offset, true); offset += 4;
      const vx = view.getFloat32(offset, true); offset += 4;
      const vy = view.getFloat32(offset, true); offset += 4;
      const ticksRemaining = view.getUint8(offset); offset += 1;
      const kind = view.getUint16(offset, true); offset += 2;
      const damage = view.getUint8(offset); offset += 1;
      const ownerIdLength = view.getUint16(offset, true); offset += 2;
      const ownerIdBytes = new Uint8Array(data.buffer, data.byteOffset + offset, ownerIdLength);
      const ownerId = this.textDecoder.decode(ownerIdBytes);
      offset += ownerIdLength;
      const reloadOnHit = view.getUint8(offset) !== 0; offset += 1;
      const reloadOnKill = view.getUint8(offset) !== 0; offset += 1;
      const projectileGravity = view.getFloat32(offset, true); offset += 4;
      this.bullets.set(id, {
        id,
        x,
        y,
        vx,
        vy,
        ticksRemaining,
        kind: kind as ItemKind,
        damage,
        ownerId,
        reloadOnHit,
        reloadOnKill,
        projectileGravity,
      });
    }

    const itemSlotCount = view.getUint8(offset);
    offset += 1;

    if (itemSlotCount !== this.itemSlots.length) {
      throw new Error(`Mismatched item slot count: expected ${this.itemSlots.length}, got ${itemSlotCount}`);
    }

    for (let slotIndex = 0; slotIndex < itemSlotCount; slotIndex += 1) {
      const kind = view.getUint16(offset, true); offset += 2;
      const expiryTick = view.getUint32(offset, true); offset += 4;
      const respawnTick = view.getUint32(offset, true); offset += 4;

      const spawnPoint = this.map.itemSpawnPoints[slotIndex];
      if (!spawnPoint) {
        throw new Error(`Missing item spawn point for slot ${slotIndex}`);
      }

      this.itemSlots[slotIndex] = {
        item:
          kind > 0
            ? {
                id: slotIndex,
                kind: kind as ItemKind,
                slotIndex,
                x: spawnPoint.x,
                y: spawnPoint.y,
                expiryTick,
              }
            : null,
        respawnTick,
      };
    }

    this.nextBulletId = view.getUint8(offset) || 1;
  }

  step(inputs: Map<PlayerId, Uint8Array>): void {
    this.tickCount += 1;

    const ids = Array.from(inputs.keys(), (id) => id as string).sort();
    this.syncPlayers(ids);
    this.handleRoundStartIfNeeded();

    if (this.roundStartCountdownTicks > 0) {
      this.roundStartCountdownTicks -= 1;
      if (this.roundStartCountdownTicks === 0) {
        this.wakeActivePlayers();
      }
      return;
    }

    const respawnedIds = this.matchState.advanceTimers();
    this.respawnPlayers(respawnedIds);
    this.tickDashCooldowns();
    this.tickGunCooldowns();
    this.tickWeaponCooldowns();

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
      const velocity = record.body.linvel();
      previousStates.set(id, {
        ducking: (inputFlags & InputBits.Duck) !== 0,
        vx: velocity.x,
        vy: velocity.y,
        x: position.x,
        y: position.y,
      });

      this.applyInput(id, inputFlags);
    }

    this.tickAttacks();
    this.tickBullets();
    this.world.step();
    this.resolvePlatformContacts(previousStates);
    this.handleBlastZoneDeaths();
    this.handleHealthDamage();
    this.tickHeldItems();
    this.tickItems();
  }

  // if a player's health drops to 0 or below, they should be considered dead and respawn
  private handleHealthDamage(): void {
    for (const [id, record] of this.players) {
      if (!this.matchState.canReceiveInput(id)) {
        continue;
      }

      if (record.health <= 0) {
        if (!this.hasOpponentInMatch()) {
          this.recoverSoloPlayer(record);
          continue;
        }
        record.body.setLinvel({ x: 0, y: 0 }, true);
        record.body.sleep();
        this.matchState.startRespawn(id);
      }
    }
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
        const velocity = record.body.linvel();
        const match = this.matchState.getRenderInfo(id);

        return {
          id,
          x: position.x,
          y: position.y,
          width: PLAYER_HALF_WIDTH * 2,
          height: PLAYER_HALF_HEIGHT * 2,
          color: record.color,
          characterId: record.characterId,
          stocks: match.stocks,
          eliminated: match.eliminated,
          respawning: match.respawning,
          respawnFlashTicksRemaining: match.respawnFlashTicksRemaining,
          health: record.health,
          maxHealth: record.maxHealth,
          heldItem: record.heldItem,
          facing: record.facing,
          vx: velocity.x,
          gunFireCooldownTicks: record.gunFireCooldownTicks,
          activeWeaponAttack: record.activeWeaponAttack
            ? { defKind: record.heldItem!, ticksRemaining: record.activeWeaponAttack.ticksRemaining }
            : null,
        };
      });

    const attacks: AttackRenderState[] = [];
    for (const [id, record] of this.players) {
      if (!record.activeAttack) {
        continue;
      }

      const definition = getAttackDefinition(record.activeAttack.kind);
      const position = record.body.translation();
      const center = this.attackCenter(position.x, position.y, record.facing, definition);
      attacks.push({
        id: `${id}-attack`,
        x: center.x,
        y: center.y,
        characterId: record.characterId,
        facing: record.facing,
        displayHeight: PLAYER_HALF_HEIGHT * 2,
      });
    }

    attacks.sort((left, right) => left.id.localeCompare(right.id));

    const bullets = Array.from(this.bullets.values())
      .sort((left, right) => left.id - right.id)
      .map((bullet) => ({
        id: bullet.id,
        x: bullet.x,
        y: bullet.y,
        kind: bullet.kind,
        facing: Math.sign(bullet.vx) || 1,
      }));

    const items = this.itemSlots
      .map((slot) => slot.item)
      .filter((item): item is WorldItem => item !== null)
      .sort((left, right) => left.id - right.id)
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        x: item.x,
        y: item.y,
      }));

    const playerIds = Array.from(this.players.keys());
    const winnerId = playerIds.length >= 2 ? this.matchState.getWinnerId(playerIds) : null;

    return {
      players,
      attacks,
      items,
      bullets,
      winnerId,
      roundStartCountdownLabel: this.getRoundStartCountdownLabel(),
      animTick: this.tickCount,
    };
  }

  setCharacterSelection(playerId: string, characterId: CharacterId): void {
    this.pendingCharacterIds.set(playerId, characterId);
    const record = this.players.get(playerId);
    if (record) {
      record.characterId = characterId;
    }
  }

  applyCharacterSelections(selections: ReadonlyMap<string, CharacterId>): void {
    for (const [playerId, characterId] of selections) {
      this.setCharacterSelection(playerId, characterId);
    }
  }

  reset(): void {
    for (const [, record] of this.players) {
      this.unregisterPlayerColliders(record.body);
      this.world.removeRigidBody(record.body);
    }

    this.players.clear();
    this.previousInputFlags.clear();
    this.pendingCharacterIds.clear();
    this.bullets.clear();
    this.nextBulletId = 1;
    this.tickCount = 0;
    this.roundStartCountdownTicks = 0;
    this.previousConnectedPlayerCount = 0;
    this.matchState.clear();
    this.initializeItemSlots();
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

    const colliderDesc = RAPIER.ColliderDesc.cuboid(rect.width * 0.5, rect.height * 0.5)
      .setFriction(0)
      .setRestitution(0);

    if (platform) {
      colliderDesc.setSensor(true);
    }

    const collider = this.world.createCollider(colliderDesc, body);
    this.staticColliderHandles.add(collider.handle);
    if (platform) {
      this.platformColliderHandles.add(collider.handle);
    }
  }

  private syncPlayers(sortedIds: string[]): void {
    const keep = new Set(sortedIds);

    for (const [id, record] of this.players) {
      if (!keep.has(id)) {
        this.unregisterPlayerColliders(record.body);
        this.world.removeRigidBody(record.body);
        this.players.delete(id);
        this.previousInputFlags.delete(id);
        this.matchState.removePlayer(id);
      }
    }

    for (const id of sortedIds) {
      if (this.players.has(id)) {
        continue;
      }

      const body = this.createPlayerBody(this.spawnPointForPlayer(id));
      this.registerPlayerColliders(body, id);
      const characterId =
        this.pendingCharacterIds.get(id) ?? defaultCharacterForPlayer(id, sortedIds);
      this.players.set(
        id,
        new PlayerCharacter(id, body, this.colorForPlayer(id), undefined, characterId),
      );
      this.previousInputFlags.set(id, 0);
      this.matchState.ensurePlayer(id);
    }
  }

  private registerPlayerColliders(body: RAPIER.RigidBody, playerId: string): void {
    for (let i = 0; i < body.numColliders(); i += 1) {
      this.playerColliderHandles.set(body.collider(i).handle, playerId);
    }
  }

  private unregisterPlayerColliders(body: RAPIER.RigidBody): void {
    for (let i = 0; i < body.numColliders(); i += 1) {
      this.playerColliderHandles.delete(body.collider(i).handle);
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
        .setFriction(0)
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

    if (horizontalDir !== 0) {
      record.facing = horizontalDir;
    }

    const jumpPressed = (inputFlags & InputBits.Jump) !== 0 && (previousFlags & InputBits.Jump) === 0;
    const ducking = (inputFlags & InputBits.Duck) !== 0;
    const attackPressed = (inputFlags & InputBits.Punch) !== 0 && (previousFlags & InputBits.Punch) === 0;
    const dashPressed = (inputFlags & InputBits.Dash) !== 0 && (previousFlags & InputBits.Dash) === 0;

    if (record.dashTicksRemaining > 0) {
      body.setLinvel({ x: record.facing * DASH_SPEED, y: velocity.y }, true);
      record.dashTicksRemaining -= 1;
      this.previousInputFlags.set(id, inputFlags);
      return;
    }

    let nextYVelocity = velocity.y;
    if (jumpPressed && this.isGrounded(body, ducking)) {
      nextYVelocity = JUMP_SPEED;
    }

    if (
      attackPressed &&
      record.gunFireCooldownTicks === 0 &&
      record.canShoot()
    ) {
      const weapon = K_getWeaponDefinition(record.heldItem!);
      this.fireBullet(record, weapon);
      record.gunFireCooldownTicks = Math.max(1, Math.round(weapon.fireRate));
      if (weapon.reloadOnHit || weapon.reloadOnKill) {
        record.reloadPending = true;
        record.reloadPendingOnKill = weapon.reloadOnKill;
      }
    }

    // Use U key input for weapon and default attacks.
    if (attackPressed && record.canUseWeapon()) {
      const heldKind = record.heldItem!;
      const def = WEAPON_DEFINITIONS[heldKind];
      if (def?.kind === 'melee') {
        record.activeWeaponAttack = {
          def,
          ticksRemaining: def.durationTicks ?? 0,
        };
        record.weaponCooldownTicks = def.cooldownTicks;
      } else if (def?.kind === 'projectile') {
        this.fireProjectileWeapon(record, def, heldKind);
        record.weaponCooldownTicks = def.cooldownTicks;
      }
    }

    if (attackPressed && record.activeAttack === null && record.canPunch()) {
      const definition = getEquippedAttack(record.equippedWeapon);
      record.activeAttack = {
        kind: definition.kind,
        ticksRemaining: definition.durationTicks,
      };
      this.resolvePunchHits(id, definition);
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

  private tickGunCooldowns(): void {
    for (const [, record] of this.players) {
      if (record.gunFireCooldownTicks > 0) {
        record.gunFireCooldownTicks -= 1;
      }
    }
  }

  private tickWeaponCooldowns(): void {
    for (const [id, record] of this.players) {
      if (record.weaponCooldownTicks > 0) {
        record.weaponCooldownTicks -= 1;
      }

      if (record.activeWeaponAttack) {
        // Resolve melee hit on the very first tick of the lash phase
        if (record.isWhipHitboxActive()) {
          const lashTicks = record.activeWeaponAttack.def.lashTicks ?? 0;
          if (record.activeWeaponAttack.ticksRemaining === lashTicks) {
            this.resolveMeleeWeaponHits(id, record);
          }
        }

        record.activeWeaponAttack.ticksRemaining -= 1;
        if (record.activeWeaponAttack.ticksRemaining <= 0) {
          record.activeWeaponAttack = null;
        }
      }
    }
  }

  private tickAttacks(): void {
    for (const [, record] of this.players) {
      if (!record.activeAttack) {
        continue;
      }

      record.activeAttack.ticksRemaining -= 1;
      if (record.activeAttack.ticksRemaining <= 0) {
        record.activeAttack = null;
      }
    }
  }

  private tickBullets(): void {
    const minX = this.map.bounds.minX - 1;
    const maxX = this.map.bounds.maxX + 1;

    for (const [bulletId, bullet] of this.bullets) {
      bullet.ticksRemaining -= 1;
      if (bullet.ticksRemaining <= 0) {
        this.bullets.delete(bulletId);
        continue;
      }

      bullet.vy += bullet.projectileGravity * FIXED_STEP_SECONDS;
      const dx = bullet.vx * FIXED_STEP_SECONDS;
      const ray = new RAPIER.Ray({ x: bullet.x, y: bullet.y }, { x: Math.sign(bullet.vx), y: 0 });
      const weaponDef = WEAPON_DEFINITIONS[bullet.kind];
      const hitHalfWidth = weaponDef?.projectileHitHalfWidth ?? BULLET_HALF_WIDTH;
      const hit = this.world.castRayAndGetNormal(
        ray,
        Math.abs(dx) + hitHalfWidth,
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        (collider) => !this.platformColliderHandles.has(collider.handle),
      );

      if (hit) {
        const hitPlayerId = this.playerColliderHandles.get(hit.collider.handle);
        if (hitPlayerId !== undefined && this.matchState.canReceiveInput(hitPlayerId)) {
          const target = this.players.get(hitPlayerId);
          if (target) {
            const nextHealth = target.takeDamage(bullet.damage);
            const shooter = this.players.get(bullet.ownerId);
            if (bullet.reloadOnHit && shooter) {
              shooter.reloadPending = false;
              shooter.reloadPendingOnKill = false;
            }
            if (bullet.reloadOnKill && nextHealth === 0 && shooter) {
              shooter.reloadPending = false;
              shooter.reloadPendingOnKill = false;
            }
          }
        }
        this.bullets.delete(bulletId);
        continue;
      }

      bullet.x += dx;
      bullet.y += bullet.vy * FIXED_STEP_SECONDS;
      if (bullet.x < minX || bullet.x > maxX) {
        this.bullets.delete(bulletId);
      }
    }
  }

  private tickHeldItems(): void {
    for (const [, record] of this.players) {
      if (record.heldItem === null) {
        continue;
      }

      if (this.tickCount >= record.heldItemExpiryTick) {
        record.dropItem();
      }
    }
  }

  private tickItems(): void {
    for (let slotIndex = 0; slotIndex < this.itemSlots.length; slotIndex += 1) {
      const slot = this.itemSlots[slotIndex];

      if (slot.item !== null) {
        if (this.tickCount >= slot.item.expiryTick) {
          this.queueItemRespawn(slotIndex);
          continue;
        }

        const pickedUpBy = this.findItemPickupCandidate(slot.item);
        if (pickedUpBy) {
          this.collectItem(slotIndex, pickedUpBy);
        }

        continue;
      }

      if (slot.respawnTick > 0 && this.tickCount >= slot.respawnTick) {
        this.spawnItem(slotIndex);
      }
    }
  }

  private findItemPickupCandidate(item: WorldItem): PlayerCharacter | null {
    let closestPlayer: PlayerCharacter | null = null;
    let closestDistanceSq = Number.POSITIVE_INFINITY;

    for (const [id, record] of this.players) {
      if (!this.matchState.canReceiveInput(id)) {
        continue;
      }

      const position = record.body.translation();
      const dx = position.x - item.x;
      const dy = position.y - item.y;
      const distanceSq = dx * dx + dy * dy;

      if (distanceSq > ITEM_PICKUP_RADIUS * ITEM_PICKUP_RADIUS) {
        continue;
      }

      if (distanceSq < closestDistanceSq) {
        closestPlayer = record;
        closestDistanceSq = distanceSq;
      }
    }

    return closestPlayer;
  }

  private collectItem(slotIndex: number, player: PlayerCharacter): void {
    const slot = this.itemSlots[slotIndex];
    if (!slot.item) {
      return;
    }

    player.heldItem = slot.item.kind;
    player.heldItemExpiryTick = this.tickCount + ITEM_LIFETIME_TICKS;
    player.gunFireCooldownTicks = 0;
    player.reloadPending = false;
    player.reloadPendingOnKill = false;
    this.K_refreshWeaponFromGround(player, slot.item.kind);
    player.activeWeaponAttack = null;
    player.weaponCooldownTicks = 0;
    this.queueItemRespawn(slotIndex);
  }

  private queueItemRespawn(slotIndex: number): void {
    const slot = this.itemSlots[slotIndex];
    slot.item = null;
    slot.respawnTick = this.tickCount + ITEM_SPAWN_INTERVAL_TICKS;
  }

  private K_refreshWeaponFromGround(player: PlayerCharacter, itemKind: ItemKind): void {
    if (player.heldItem !== itemKind) {
      return;
    }

    player.gunFireCooldownTicks = 0;
    player.reloadPending = false;
    player.reloadPendingOnKill = false;
  }

  private spawnItem(slotIndex: number): void {
    const spawnPoint = this.map.itemSpawnPoints[slotIndex];
    if (!spawnPoint) {
      return;
    }

    const kind = this.chooseSpawnedItemKind(slotIndex);

    this.itemSlots[slotIndex] = {
      item: {
        id: slotIndex,
        kind,
        slotIndex,
        x: spawnPoint.x,
        y: spawnPoint.y,
        expiryTick: this.tickCount + ITEM_LIFETIME_TICKS,
      },
      respawnTick: 0,
    };
  }

  private initializeItemSlots(): void {
    this.itemSlots.length = 0;

    for (let slotIndex = 0; slotIndex < this.map.itemSpawnPoints.length; slotIndex += 1) {
      const spawnPoint = this.map.itemSpawnPoints[slotIndex];
      const kind = this.chooseSpawnedItemKind(slotIndex);
      this.itemSlots.push({
        item: {
          id: slotIndex,
          kind,
          slotIndex,
          x: spawnPoint.x,
          y: spawnPoint.y,
          expiryTick: this.tickCount + ITEM_LIFETIME_TICKS,
        },
        respawnTick: 0,
      });
    }
  }

  private chooseSpawnedItemKind(slotIndex: number): ItemKind {
    return SPAWN_ROTATION[slotIndex % SPAWN_ROTATION.length] ?? ItemKind.Gun;
  }

  private handleBlastZoneDeaths(): void {
    for (const [id, record] of this.players) {
      if (!this.matchState.canReceiveInput(id)) {
        continue;
      }

      const position = record.body.translation();
      if (!this.isOutsideBlastZone(position)) {
        continue;
      }

      if (!this.hasOpponentInMatch()) {
        this.recoverSoloPlayer(record);
        continue;
      }

      record.body.setLinvel({ x: 0, y: 0 }, true);
      record.body.sleep();
      this.matchState.startRespawn(id);
    }
  }

  private respawnPlayers(respawnedIds: string[]): void {
    const sortedRespawnedIds = [...respawnedIds].sort();

    for (const playerId of sortedRespawnedIds) {
      const record = this.players.get(playerId);
      if (!record) {
        continue;
      }

      const spawnPoint = this.chooseRespawnPoint(playerId);
      record.reset();
      record.body.setTranslation(
        { x: spawnPoint.x, y: spawnPoint.feetY + PLAYER_HALF_HEIGHT },
        true,
      );
      record.body.setLinvel({ x: 0, y: 0 }, true);
      record.body.wakeUp();
    }
  }

  private chooseRespawnPoint(playerId: string): MapSpawnPoint {
    if (this.map.playerSpawnPoints.length === 0) {
      return this.spawnPointForPlayer(playerId);
    }

    const alivePlayers = Array.from(this.players.entries())
      .filter(([otherId]) => otherId !== playerId && this.matchState.canReceiveInput(otherId))
      .map(([, record]) => {
        const position = record.body.translation();
        return { x: position.x, y: position.y };
      });

    let bestSpawn = this.map.playerSpawnPoints[0];
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const spawnPoint of this.map.playerSpawnPoints) {
      const spawnCenterY = spawnPoint.feetY + PLAYER_HALF_HEIGHT;
      const score = alivePlayers.length === 0
        ? Number.POSITIVE_INFINITY
        : Math.min(
            ...alivePlayers.map((player) => {
              const dx = spawnPoint.x - player.x;
              const dy = spawnCenterY - player.y;
              return dx * dx + dy * dy;
            }),
          );

      if (score > bestScore) {
        bestSpawn = spawnPoint;
        bestScore = score;
        continue;
      }

      if (score === bestScore) {
        const currentSortKey = `${bestSpawn.tileY}:${bestSpawn.tileX}`;
        const nextSortKey = `${spawnPoint.tileY}:${spawnPoint.tileX}`;
        if (nextSortKey < currentSortKey) {
          bestSpawn = spawnPoint;
        }
      }
    }

    return bestSpawn;
  }

  private isOutsideBlastZone(position: { x: number; y: number }): boolean {
    const left = position.x - PLAYER_HALF_WIDTH;
    const right = position.x + PLAYER_HALF_WIDTH;
    const top = position.y + PLAYER_HALF_HEIGHT;
    const bottom = position.y - PLAYER_HALF_HEIGHT;

    return (
      left < this.map.bounds.minX - BLAST_ZONE_SIDE_OFFSET ||
      right > this.map.bounds.maxX + BLAST_ZONE_SIDE_OFFSET ||
      top > this.map.bounds.maxY + BLAST_ZONE_UP_OFFSET ||
      bottom < this.map.bounds.minY - BLAST_ZONE_DOWN_OFFSET
    );
  }

  private fireBullet(owner: PlayerCharacter, weapon: ReturnType<typeof K_getWeaponDefinition>): void {
    let bulletId = this.nextBulletId;
    for (let i = 0; i < BULLET_ID_MAX; i += 1) {
      if (!this.bullets.has(bulletId)) {
        break;
      }
      bulletId = (bulletId % BULLET_ID_MAX) + 1;
    }

    this.nextBulletId = (bulletId % BULLET_ID_MAX) + 1;

    const BULLET_SPAWN_VERTICAL_OFFSET = 0.22;
    //const BULLET_SPAWN_FORWARD_OFFSET = 0.30;

    const position = owner.body.translation();  
    const spawnX = position.x + owner.facing * (PLAYER_HALF_WIDTH + BULLET_HALF_WIDTH + 0.01);

    this.bullets.set(bulletId, {
      id: bulletId,
      x: spawnX,
      y: position.y + BULLET_SPAWN_VERTICAL_OFFSET,
      vx: owner.facing * weapon.projectileSpeed,
      vy: 0,
      ticksRemaining: BULLET_LIFETIME_TICKS,
      kind: weapon.kind,
      damage: weapon.damage,
      ownerId: owner.id,
      reloadOnHit: weapon.reloadOnHit,
      reloadOnKill: weapon.reloadOnKill,
      projectileGravity: weapon.projectileGravity,
    });
  }

  private fireProjectileWeapon(owner: PlayerCharacter, def: WeaponDefinition, kind: ItemKind): void {
    let bulletId = this.nextBulletId;
    for (let i = 0; i < BULLET_ID_MAX; i += 1) {
      if (!this.bullets.has(bulletId)) {
        break;
      }
      bulletId = (bulletId % BULLET_ID_MAX) + 1;
    }

    this.nextBulletId = (bulletId % BULLET_ID_MAX) + 1;

    const position = owner.body.translation();
    const spawnX =
      position.x
      + owner.facing * (PLAYER_HALF_WIDTH + BULLET_HALF_WIDTH + 0.05 + (def.projectileSpawnOffsetX ?? 0));
    const spawnY = position.y + (def.projectileSpawnOffsetY ?? 0);
    const speed = def.projectileSpeed ?? BULLET_SPEED;
    const lifetime = def.projectileLifetimeTicks ?? BULLET_LIFETIME_TICKS;

    this.bullets.set(bulletId, {
      id: bulletId,
      x: spawnX,
      y: spawnY,
      vx: owner.facing * speed,
      vy: 0,
      ticksRemaining: lifetime,
      kind,
      damage: def.damage,
      ownerId: owner.id,
      reloadOnHit: def.reloadOnHit ?? false,
      reloadOnKill: def.reloadOnKill ?? false,
      projectileGravity: def.projectileGravity ?? 0,
    });
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

  private resolvePunchHits(attackerId: string, definition: AttackDefinition): void {
    const attacker = this.players.get(attackerId);
    if (!attacker) {
      return;
    }

    const position = attacker.body.translation();
    const center = this.attackCenter(position.x, position.y, attacker.facing, definition);
    const overlapHalfWidth = definition.hitboxHalfWidth + PLAYER_HALF_WIDTH;
    const overlapHalfHeight = definition.hitboxHalfHeight + PLAYER_HALF_HEIGHT;

    for (const [otherId, target] of this.players) {
      if (otherId === attackerId) {
        continue;
      }
      if (!this.matchState.canReceiveInput(otherId)) {
        continue;
      }

      const targetPos = target.body.translation();
      if (
        Math.abs(targetPos.x - center.x) < overlapHalfWidth &&
        Math.abs(targetPos.y - center.y) < overlapHalfHeight
      ) {
        target.takeDamage(definition.damage);
      }
    }
  }

  private resolveMeleeWeaponHits(attackerId: string, attacker: PlayerCharacter): void {
    if (!attacker.activeWeaponAttack) return;
    const def = attacker.activeWeaponAttack.def;
    const position = attacker.body.translation();
    const cx = position.x + (def.centerOffsetX ?? 0) * attacker.facing;
    const cy = position.y + (def.centerOffsetY ?? 0);
    const overlapHalfWidth = (def.hitboxHalfWidth ?? 0) + PLAYER_HALF_WIDTH;
    const overlapHalfHeight = (def.hitboxHalfHeight ?? 0) + PLAYER_HALF_HEIGHT;

    for (const [otherId, target] of this.players) {
      if (otherId === attackerId) continue;
      if (!this.matchState.canReceiveInput(otherId)) continue;

      const targetPos = target.body.translation();
      if (
        Math.abs(targetPos.x - cx) < overlapHalfWidth &&
        Math.abs(targetPos.y - cy) < overlapHalfHeight
      ) {
        target.takeDamage(def.damage);
      }
    }
  }

  private isGrounded(body: RAPIER.RigidBody, ducking: boolean): boolean {
    if (ducking) {
      return false;
    }

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
        record.body.setTranslation({ x: position.x, y: bestPlatformTop + PLAYER_HALF_HEIGHT }, true);
        record.body.setLinvel({ x: velocity.x, y: 0 }, true);
      }
    }
  }

  private spawnPointForPlayer(playerId: string): MapSpawnPoint {
    if (this.map.playerSpawnPoints.length === 0) {
      return {
        feetY: FLOOR_Y,
        layerName: 'fallback',
        role: 'player_spawn',
        tileX: 0,
        tileY: 0,
        x: 0,
        y: FLOOR_Y,
      };
    }

    return this.map.playerSpawnPoints[this.hashString(playerId) % this.map.playerSpawnPoints.length];
  }

  private colorForPlayer(playerId: string): number {
    return PLAYER_COLOR_PALETTE[this.hashString(playerId) % PLAYER_COLOR_PALETTE.length] ?? PLAYER_COLOR_PALETTE[0];
  }

  private handleRoundStartIfNeeded(): void {
    const connectedPlayerCount = this.players.size;
    if (
      this.roundStartCountdownTicks === 0 &&
      this.previousConnectedPlayerCount < 2 &&
      connectedPlayerCount >= 2
    ) {
      this.startRoundStartCountdown();
    }
    this.previousConnectedPlayerCount = connectedPlayerCount;
  }

  private startRoundStartCountdown(): void {
    this.roundStartCountdownTicks = ROUND_START_COUNTDOWN_TOTAL_TICKS;
    this.bullets.clear();

    for (const [id, record] of this.players) {
      if (this.matchState.getRenderInfo(id).eliminated) {
        continue;
      }
      this.matchState.resetRespawnState(id);
      const spawnPoint = this.spawnPointForPlayer(id);
      record.activeAttack = null;
      record.activeWeaponAttack = null;
      record.health = record.maxHealth;
      record.body.setTranslation(
        { x: spawnPoint.x, y: spawnPoint.feetY + PLAYER_HALF_HEIGHT },
        true,
      );
      record.body.setLinvel({ x: 0, y: 0 }, true);
      record.body.sleep();
    }
  }

  private wakeActivePlayers(): void {
    for (const [id, record] of this.players) {
      if (this.matchState.getRenderInfo(id).eliminated) {
        continue;
      }
      record.body.wakeUp();
    }
  }

  private getRoundStartCountdownLabel(): string | null {
    if (this.roundStartCountdownTicks <= 0) {
      return null;
    }

    const oneSecond = TICK_RATE;
    if (this.roundStartCountdownTicks > oneSecond * 3) {
      return '3';
    }
    if (this.roundStartCountdownTicks > oneSecond * 2) {
      return '2';
    }
    if (this.roundStartCountdownTicks > oneSecond) {
      return '1';
    }
    return 'GO!';
  }

  private hasOpponentInMatch(): boolean {
    let activePlayers = 0;
    for (const [id] of this.players) {
      if (!this.matchState.canReceiveInput(id)) {
        continue;
      }
      activePlayers += 1;
      if (activePlayers >= 2) {
        return true;
      }
    }
    return false;
  }

  private recoverSoloPlayer(record: PlayerCharacter): void {
    const spawnPoint = this.spawnPointForPlayer(record.id);
    record.health = record.maxHealth;
    record.body.setTranslation(
      { x: spawnPoint.x, y: spawnPoint.feetY + PLAYER_HALF_HEIGHT },
      true,
    );
    record.body.setLinvel({ x: 0, y: 0 }, true);
    record.body.wakeUp();
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