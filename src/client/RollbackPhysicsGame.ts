import * as RAPIER from '@dimforge/rapier2d-compat';
import type { Game, PlayerId } from 'rollback-netcode';
import {
  AIR_DODGE_COOLDOWN_TICKS,
  AIR_DODGE_DURATION_TICKS,
  AIR_DODGE_SPEED,
  AIR_DODGES_PER_AIRTIME,
  BULLET_HALF_WIDTH,
  BULLET_ID_MAX,
  BULLET_LIFETIME_TICKS,
  BULLET_SPEED,
  DASH_INPUT_COOLDOWN_TICKS,
  DASH_TURN_LOCK_TICKS,
  DODGE_COOLDOWN_TICKS,
  DODGE_DURATION_TICKS,
  DODGE_SPEED,
  DOUBLE_JUMP_SPEED,
  FALLBACK_BLAST_TILES_DOWN,
  FALLBACK_BLAST_TILES_SIDE,
  FALLBACK_BLAST_TILES_UP,
  FIXED_STEP_SECONDS,
  FLOOR_Y,
  GRAVITY_Y,
  INITIAL_DASH_SPEED,
  INITIAL_DASH_TICKS,
  JUMP_SPEED,
  KO_BLAST_TILES_DOWN,
  KO_BLAST_TILES_SIDE,
  KO_BLAST_TILES_UP,
  KOABLE_DURATION_TICKS,
  MOVE_SPEED,
  PLAYER_COLOR_PALETTE,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  RUN_SPEED,
  SHIELD_BROKEN_LOCKOUT_TICKS,
  SHIELD_DRAIN_PER_TICK,
  SHIELD_MAX_HP,
  SHIELD_RECHARGE_PER_TICK,
  SHIELD_RELEASE_COOLDOWN_TICKS,
  SKID_TICKS,
  SMASH_DEFAULT_BASE_KNOCKBACK,
  SMASH_DEFAULT_LAUNCH_ANGLE_DEG,
  SMASH_KB_GROWTH_MULT,
  SMASH_KB_HITSTUN_BIAS,
  SMASH_KB_LETHAL_MULTIPLIER,
  SMASH_KB_LETHAL_RESTITUTION,
  SMASH_KB_OUTPUT_SCALE,
  SMASH_KB_HORIZONTAL_MULT,
  SMASH_KB_VERTICAL_MULT,
  SMASH_LAUNCH_RECOVERY_TICKS,
  SMASH_LAUNCH_HORIZONTAL_DRAG,
  SMASH_LAUNCH_VERTICAL_DRAG,
  SMASH_LAUNCH_AIR_CONTROL,
  SMASH_LETHAL_NOCLIP_DELAY_TICKS,
  SMASH_MAX_DAMAGE_PCT,
  PUNCH_COOLDOWN_TICKS,
  TICK_RATE,
  TILE_SIZE,
  type CharacterId,
  type GameMode,
  DEFAULT_GAME_MODE,
  characterIdFromIndex,
  characterIdToIndex,
} from './constants';
import { defaultCharacterForPlayer } from './CharacterSprites';
import { GameStateManager } from './GameStateManager';
import { AttackKind, getAttackDefinition, getEquippedAttack } from './attacks';
import type { AttackDefinition } from './attacks';
import { InputBits, decodeInputBits } from './input';
import { MoveState, PlayerCharacter } from './PlayerCharacter';
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

const PUNCH_SOUND_URL = new URL('../assets/sounds/punch.wav', import.meta.url).href;
const WHIP_SOUND_URL = new URL('../assets/sounds/whip.wav', import.meta.url).href;
const PAPER_SOUND_URL = new URL('../assets/sounds/paper.wav', import.meta.url).href;
const EQUIP_SOUND_URL = new URL('../assets/sounds/equip_sound.mp3', import.meta.url).href;
const JUMP_SOUND_URL = new URL('../assets/sounds/jump.mp3', import.meta.url).href;
const FOOTSTEPS_SOUND_URL = new URL('../assets/sounds/Footsteps.wav', import.meta.url).href;
const PEN_CROSSBOW_SOUND_URL = new URL('../assets/sounds/pen_crossbow.wav', import.meta.url).href;
const BINARY_BEAM_SOUND_URL = new URL('../assets/sounds/binary_beam.wav', import.meta.url).href;
const STAGE_OUT_SOUND_URL = new URL('../assets/sounds/sfx/se_common_stage_fall.wav', import.meta.url).href;
const KO_HIT_SOUND_URL = new URL('../assets/sounds/sfx/koHit.mp3', import.meta.url).href;

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
  vy: number;
  gunFireCooldownTicks: number;
  activeWeaponAttack: { defKind: ItemKind; ticksRemaining: number } | null;
  shieldActive: boolean;
  shieldHp: number;
  koableTicksRemaining: number;
  knockbackTicksRemaining: number;
  /** Smash-mode damage accumulator (0..SMASH_MAX_DAMAGE_PCT+). */
  damagePct: number;
  /** True while this player is in the lethal-launch rocket state. */
  inLethalLaunch: boolean;
  /** True when on the ground (not in airborne move state). Used for VFX. */
  grounded: boolean;
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
  roundStartCountdownTicks: number | null;
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
const KNOCKBACK_BASE = 4;    // horizontal impulse at full health
const KNOCKBACK_SCALE = 14;  // additional impulse at 0 health
const KNOCKBACK_UP = 3;      // upward lift on every hit
export const ROUND_START_COUNTDOWN_TOTAL_TICKS = TICK_RATE * 4;
const SPAWN_ROTATION: readonly ItemKind[] = [
  ItemKind.BinaryBeam,
  ItemKind.PenCrossbow,
  ItemKind.EthernetWhip,
  ItemKind.Finals,
];

export class RollbackPhysicsGame implements Game<Uint8Array> {
  private map: TiledMapDefinition;
  private world: RAPIER.World;
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
  private readonly punchAudioPool: HTMLAudioElement[] = Array.from({ length: 4 }, () => {
    const audio = new Audio(PUNCH_SOUND_URL);
    audio.preload = 'auto';
    audio.volume = 0.5;
    audio.load();
    return audio;
  });
  private punchAudioPoolIndex = 0;
  private readonly equipAudioPool: HTMLAudioElement[] = Array.from({ length: 2 }, () => {
    const audio = new Audio(EQUIP_SOUND_URL);
    audio.preload = 'auto';
    audio.volume = 0.5;
    audio.load();
    return audio;
  });
  private equipAudioPoolIndex = 0;
  private readonly jumpAudioPool: HTMLAudioElement[] = Array.from({ length: 3 }, () => {
    const audio = new Audio(JUMP_SOUND_URL);
    audio.preload = 'auto';
    audio.volume = 0.5;
    audio.load();
    return audio;
  });
  private jumpAudioPoolIndex = 0;
  private readonly footstepsAudioPool: HTMLAudioElement[] = Array.from({ length: 3 }, () => {
    const audio = new Audio(FOOTSTEPS_SOUND_URL);
    audio.preload = 'auto';
    audio.volume = 0.9;
    audio.load();
    return audio;
  });
  private footstepsAudioPoolIndex = 0;
  private readonly stageOutAudioPool: HTMLAudioElement[] = Array.from({ length: 2 }, () => {
    const audio = new Audio(STAGE_OUT_SOUND_URL);
    audio.preload = 'auto';
    audio.volume = 0.8;
    audio.load();
    return audio;
  });
  private stageOutAudioPoolIndex = 0;
  private readonly koHitAudioPool: HTMLAudioElement[] = Array.from({ length: 3 }, () => {
    const audio = new Audio(KO_HIT_SOUND_URL);
    audio.preload = 'auto';
    audio.volume = 1.0;
    audio.load();
    return audio;
  });
  private koHitAudioPoolIndex = 0;
  private readonly previousHorizontalDir = new Map<string, number>();
  private sfxVolume = 1;
  private nextBulletId = 1;
  private tickCount = 0;
  private roundStartCountdownTicks = 0;
  private previousConnectedPlayerCount = 0;
  private readonly pendingCharacterIds = new Map<string, CharacterId>();
  private gameMode: GameMode = DEFAULT_GAME_MODE;

  // Hot-path scratch storage. Reused across every serialize/deserialize/step
  // call to eliminate per-tick allocations that GC-pause rollback resimulation.
  // The rollback library copies the bytes returned by serialize() into its own
  // snapshot history (see SnapshotBuffer.save), so a single shared buffer is
  // safe to reuse.
  private static readonly SNAPSHOT_SCRATCH_BYTES = 16 * 1024;
  private readonly snapshotScratchBuffer: ArrayBuffer = new ArrayBuffer(
    RollbackPhysicsGame.SNAPSHOT_SCRATCH_BYTES,
  );
  private readonly snapshotScratchView: DataView = new DataView(this.snapshotScratchBuffer);
  private readonly snapshotScratchBytes: Uint8Array = new Uint8Array(this.snapshotScratchBuffer);
  private readonly playerIdBytes = new Map<string, Uint8Array>();
  private sortedPlayerIds: string[] = [];
  private readonly bulletScratch: Bullet[] = [];
  private readonly previousStatesScratch = new Map<string, StepPlayerState>();
  private readonly incomingScratch = new Map<
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
      dodgeTicksRemaining: number;
      dodgeCooldownTicks: number;
      heldItem: number;
      heldItemExpiryTick: number;
      gunFireCooldownTicks: number;
      reloadPending: boolean;
      reloadPendingOnKill: boolean;
      characterId: number;
      weaponCooldownTicks: number;
      punchCooldownTicks: number;
      activeWeaponAttackTicksRemaining: number;
      knockbackTicksRemaining: number;
      launchRecoveryTicksRemaining: number;
      moveState: number;
      moveStateTicks: number;
      moveDirection: number;
      dashInputCooldownTicks: number;
      doubleJumpAvailable: boolean;
      shieldHp: number;
      shieldActive: boolean;
      shieldBlockedSinceRaise: boolean;
      shieldBrokenLockoutTicks: number;
      shieldReleaseCooldownTicks: number;
      koableTicksRemaining: number;
      airDodgesRemaining: number;
      damagePct: number;
      inLethalLaunch: boolean;
      lethalLaunchTicks: number;
    }
  >();
  private readonly deserializeIdsScratch: string[] = [];
  private readonly stepIdsScratch: string[] = [];

  constructor(map: TiledMapDefinition, options?: { startingStocks?: number; gameMode?: GameMode }) {
    this.map = map;
    this.world = new RAPIER.World({ x: 0, y: GRAVITY_Y });
    this.world.timestep = FIXED_STEP_SECONDS;
    this.createStaticLevel();
    this.initializeItemSlots();
    if (options?.startingStocks !== undefined) {
      this.matchState.setStartingStocks(options.startingStocks);
    }
    if (options?.gameMode !== undefined) {
      this.gameMode = options.gameMode;
    }
  }

  setVolume(volume: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, volume));

    this.punchAudioPool.forEach((audio) => {
      audio.volume = 0.5 * this.sfxVolume;
    });
    this.equipAudioPool.forEach((audio) => {
      audio.volume = 0.5 * this.sfxVolume;
    });
    this.jumpAudioPool.forEach((audio) => {
      audio.volume = 0.5 * this.sfxVolume;
    });
    this.footstepsAudioPool.forEach((audio) => {
      audio.volume = 0.9 * this.sfxVolume;
    });
    this.stageOutAudioPool.forEach((audio) => {
      audio.volume = 0.8 * this.sfxVolume;
    });
    this.koHitAudioPool.forEach((audio) => {
      audio.volume = 1.0 * this.sfxVolume;
    });
  }

  setStartingStocks(stocks: number): void {
    this.matchState.setStartingStocks(stocks);
  }

  setGameMode(mode: GameMode): void {
    this.gameMode = mode;
  }

  // Swap the active map in place. The session created in prepareNetworking()
  // captures this game reference, so we can't construct a new game — the
  // session would keep ticking the old one. reset() drops players and the
  // old world is discarded, so any selections in lobbyCharacterByPeer must
  // be re-applied by the caller before session.start().
  setMap(map: TiledMapDefinition): void {
    this.reset();
    this.map = map;
    this.world = new RAPIER.World({ x: 0, y: GRAVITY_Y });
    this.world.timestep = FIXED_STEP_SECONDS;
    this.staticColliderHandles.clear();
    this.platformColliderHandles.clear();
    this.playerColliderHandles.clear();
    this.createStaticLevel();
    this.initializeItemSlots();
  }

  getGameMode(): GameMode {
    return this.gameMode;
  }

  private getOrCacheIdBytes(id: string): Uint8Array {
    let bytes = this.playerIdBytes.get(id);
    if (!bytes) {
      bytes = this.textEncoder.encode(id);
      this.playerIdBytes.set(id, bytes);
    }
    return bytes;
  }

  serialize(): Uint8Array {
    const view = this.snapshotScratchView;
    const output = this.snapshotScratchBytes;
    const sortedIds = this.sortedPlayerIds;

    // Stage bullets into the scratch array, sorted in place.
    this.bulletScratch.length = 0;
    for (const bullet of this.bullets.values()) {
      this.bulletScratch.push(bullet);
    }
    this.bulletScratch.sort((left, right) => left.id - right.id);

    let offset = 0;
    view.setUint8(offset, sortedIds.length);
    offset += 1;

    for (const id of sortedIds) {
      const record = this.players.get(id);
      if (!record) {
        throw new Error(`Missing player record for ${id}`);
      }

      const idBytes = this.getOrCacheIdBytes(id);
      const translation = record.body.translation();
      const velocity = record.body.linvel();
      const inputFlags = this.previousInputFlags.get(id) ?? 0;
      const activeAttack = record.activeAttack;

      view.setUint16(offset, idBytes.length, true);
      offset += 2;
      output.set(idBytes, offset);
      offset += idBytes.length;

      view.setFloat32(offset, translation.x, true); offset += 4;
      view.setFloat32(offset, translation.y, true); offset += 4;
      view.setFloat32(offset, velocity.x, true); offset += 4;
      view.setFloat32(offset, velocity.y, true); offset += 4;
      view.setUint8(offset, inputFlags & 0xff); offset += 1;
      view.setUint8(offset, record.health); offset += 1;
      view.setInt8(offset, record.facing < 0 ? -1 : 1); offset += 1;
      view.setUint8(offset, activeAttack?.kind ?? 0); offset += 1;
      view.setUint8(offset, activeAttack?.ticksRemaining ?? 0); offset += 1;
      view.setUint8(offset, record.dodgeTicksRemaining); offset += 1;
      view.setUint8(offset, record.dodgeCooldownTicks); offset += 1;
      view.setUint16(offset, record.heldItem ?? 0, true); offset += 2;
      view.setUint16(offset, record.heldItemExpiryTick, true); offset += 2;
      view.setUint8(offset, record.gunFireCooldownTicks); offset += 1;
      view.setUint8(offset, record.reloadPending ? 1 : 0); offset += 1;
      view.setUint8(offset, record.reloadPendingOnKill ? 1 : 0); offset += 1;
      view.setUint8(offset, characterIdToIndex(record.characterId)); offset += 1;
      view.setUint8(offset, record.weaponCooldownTicks); offset += 1;
      view.setUint8(offset, Math.min(0xff, record.punchCooldownTicks)); offset += 1;
      view.setUint8(offset, record.activeWeaponAttack?.ticksRemaining ?? 0); offset += 1;
      view.setUint8(offset, record.knockbackTicksRemaining); offset += 1;
      view.setUint8(offset, Math.min(0xff, record.launchRecoveryTicksRemaining)); offset += 1;
      view.setUint8(offset, record.moveState & 0xff); offset += 1;
      view.setUint8(offset, record.moveStateTicks & 0xff); offset += 1;
      view.setInt8(offset, record.moveDirection < 0 ? -1 : record.moveDirection > 0 ? 1 : 0); offset += 1;
      view.setUint8(offset, record.dashInputCooldownTicks & 0xff); offset += 1;
      view.setUint8(offset, record.doubleJumpAvailable ? 1 : 0); offset += 1;
      view.setFloat32(offset, record.shieldHp, true); offset += 4;
      view.setUint8(offset, record.shieldActive ? 1 : 0); offset += 1;
      view.setUint8(offset, record.shieldBlockedSinceRaise ? 1 : 0); offset += 1;
      view.setUint16(offset, Math.min(0xffff, record.shieldBrokenLockoutTicks), true); offset += 2;
      view.setUint16(offset, Math.min(0xffff, record.shieldReleaseCooldownTicks), true); offset += 2;
      view.setUint16(offset, Math.min(0xffff, record.koableTicksRemaining), true); offset += 2;
      view.setUint8(offset, record.airDodgesRemaining & 0xff); offset += 1;
      view.setFloat32(offset, record.damagePct, true); offset += 4;
      view.setUint8(offset, record.inLethalLaunch ? 1 : 0); offset += 1;
      view.setUint16(offset, Math.min(0xffff, record.lethalLaunchTicks), true); offset += 2;

      offset = this.matchState.writePlayer(view, offset, id);
    }

    view.setUint32(offset, this.tickCount, true);
    offset += 4;
    view.setUint8(offset, this.roundStartCountdownTicks & 0xff);
    offset += 1;
    view.setUint8(offset, this.previousConnectedPlayerCount & 0xff);
    offset += 1;

    view.setUint8(offset, this.bulletScratch.length);
    offset += 1;

    for (const bullet of this.bulletScratch) {
      const ownerIdBytes = this.getOrCacheIdBytes(bullet.ownerId);
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

    if (offset > RollbackPhysicsGame.SNAPSHOT_SCRATCH_BYTES) {
      // Defensive: SNAPSHOT_SCRATCH_BYTES is sized for 4 players + 64 bullets
      // + 8 item slots with generous headroom. Overflow means a new field was
      // added without resizing the buffer.
      throw new Error(
        `Snapshot overflowed scratch buffer (${offset} > ${RollbackPhysicsGame.SNAPSHOT_SCRATCH_BYTES})`,
      );
    }

    return output.subarray(0, offset);
  }

  deserialize(data: Uint8Array): void {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    const count = view.getUint8(offset);
    offset += 1;

    const incoming = this.incomingScratch;
    incoming.clear();
    const incomingIds = this.deserializeIdsScratch;
    incomingIds.length = 0;

    for (let i = 0; i < count; i += 1) {
      const idByteLength = view.getUint16(offset, true);
      offset += 2;
      const idBytes = data.subarray(offset, offset + idByteLength);
      offset += idByteLength;
      const id = this.textDecoder.decode(idBytes);
      incomingIds.push(id);

      const x = view.getFloat32(offset, true); offset += 4;
      const y = view.getFloat32(offset, true); offset += 4;
      const vx = view.getFloat32(offset, true); offset += 4;
      const vy = view.getFloat32(offset, true); offset += 4;
      const inputFlags = view.getUint8(offset); offset += 1;
      const health = view.getUint8(offset); offset += 1;
      const facing = view.getInt8(offset); offset += 1;
      const attackKind = view.getUint8(offset); offset += 1;
      const attackTicksRemaining = view.getUint8(offset); offset += 1;
      const dodgeTicksRemaining = view.getUint8(offset); offset += 1;
      const dodgeCooldownTicks = view.getUint8(offset); offset += 1;
      const heldItem = view.getUint16(offset, true); offset += 2;
      const heldItemExpiryTick = view.getUint16(offset, true); offset += 2;
      const gunFireCooldownTicks = view.getUint8(offset); offset += 1;
      const reloadPending = view.getUint8(offset) !== 0; offset += 1;
      const reloadPendingOnKill = view.getUint8(offset) !== 0; offset += 1;
      const characterId = view.getUint8(offset); offset += 1;
      const weaponCooldownTicks = view.getUint8(offset); offset += 1;
      const punchCooldownTicks = view.getUint8(offset); offset += 1;
      const activeWeaponAttackTicksRemaining = view.getUint8(offset); offset += 1;
      const knockbackTicksRemaining = view.getUint8(offset); offset += 1;
      const launchRecoveryTicksRemaining = view.getUint8(offset); offset += 1;
      const moveState = view.getUint8(offset); offset += 1;
      const moveStateTicks = view.getUint8(offset); offset += 1;
      const moveDirection = view.getInt8(offset); offset += 1;
      const dashInputCooldownTicks = view.getUint8(offset); offset += 1;
      const doubleJumpAvailable = view.getUint8(offset) !== 0; offset += 1;
      const shieldHp = view.getFloat32(offset, true); offset += 4;
      const shieldActive = view.getUint8(offset) !== 0; offset += 1;
      const shieldBlockedSinceRaise = view.getUint8(offset) !== 0; offset += 1;
      const shieldBrokenLockoutTicks = view.getUint16(offset, true); offset += 2;
      const shieldReleaseCooldownTicks = view.getUint16(offset, true); offset += 2;
      const koableTicksRemaining = view.getUint16(offset, true); offset += 2;
      const airDodgesRemaining = view.getUint8(offset); offset += 1;
      const damagePct = view.getFloat32(offset, true); offset += 4;
      const inLethalLaunch = view.getUint8(offset) !== 0; offset += 1;
      const lethalLaunchTicks = view.getUint16(offset, true); offset += 2;

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
        dodgeTicksRemaining,
        dodgeCooldownTicks,
        heldItem,
        heldItemExpiryTick,
        gunFireCooldownTicks,
        reloadPending,
        reloadPendingOnKill,
        characterId,
        weaponCooldownTicks,
        punchCooldownTicks,
        activeWeaponAttackTicksRemaining,
        knockbackTicksRemaining,
        launchRecoveryTicksRemaining,
        moveState,
        moveStateTicks,
        moveDirection,
        dashInputCooldownTicks,
        doubleJumpAvailable,
        shieldHp,
        shieldActive,
        shieldBlockedSinceRaise,
        shieldBrokenLockoutTicks,
        shieldReleaseCooldownTicks,
        koableTicksRemaining,
        airDodgesRemaining,
        damagePct,
        inLethalLaunch,
        lethalLaunchTicks,
      });

      offset = this.matchState.readPlayer(view, offset, id);
    }

    incomingIds.sort();
    this.syncPlayers(incomingIds);

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
      record.dodgeTicksRemaining = state.dodgeTicksRemaining;
      record.dodgeCooldownTicks = state.dodgeCooldownTicks;
      record.heldItem = state.heldItem > 0 ? (state.heldItem as ItemKind) : null;
      record.heldItemExpiryTick = state.heldItemExpiryTick;
      record.gunFireCooldownTicks = state.gunFireCooldownTicks;
      record.reloadPending = state.reloadPending;
      record.reloadPendingOnKill = state.reloadPendingOnKill;
      record.characterId = characterIdFromIndex(state.characterId);
      record.weaponCooldownTicks = state.weaponCooldownTicks;
      record.punchCooldownTicks = state.punchCooldownTicks;
      record.knockbackTicksRemaining = state.knockbackTicksRemaining;
      record.launchRecoveryTicksRemaining = state.launchRecoveryTicksRemaining;
      record.moveState = state.moveState as MoveState;
      record.moveStateTicks = state.moveStateTicks;
      record.moveDirection = state.moveDirection < 0 ? -1 : state.moveDirection > 0 ? 1 : 0;
      record.dashInputCooldownTicks = state.dashInputCooldownTicks;
      record.doubleJumpAvailable = state.doubleJumpAvailable;
      record.shieldHp = Math.max(0, Math.min(SHIELD_MAX_HP, state.shieldHp));
      record.shieldActive = state.shieldActive;
      record.shieldBlockedSinceRaise = state.shieldBlockedSinceRaise;
      record.shieldBrokenLockoutTicks = state.shieldBrokenLockoutTicks;
      record.shieldReleaseCooldownTicks = state.shieldReleaseCooldownTicks;
      record.koableTicksRemaining = state.koableTicksRemaining;
      record.airDodgesRemaining = state.airDodgesRemaining;
      record.damagePct = state.damagePct;
      const wasLethalLaunch = record.inLethalLaunch;
      record.inLethalLaunch = state.inLethalLaunch;
      record.lethalLaunchTicks = state.lethalLaunchTicks;
      // Re-sync collider state to the deserialized lethal-launch flag.
      this.syncLethalLaunchColliderState(record, wasLethalLaunch);

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

    // Reuse sortedPlayerIds if the input membership matches it; otherwise
    // rebuild from inputs.keys() and let syncPlayers refresh the cache.
    const ids = this.stepIdsScratch;
    ids.length = 0;
    for (const id of inputs.keys()) {
      ids.push(id as string);
    }
    ids.sort();
    this.syncPlayers(ids);
    this.handleRoundStartIfNeeded();

    if (this.roundStartCountdownTicks > 0) {
      this.roundStartCountdownTicks -= 1;
      this.updateCountdownSpawns();
      if (this.roundStartCountdownTicks === 0) {
        this.wakeActivePlayers();
      }
      return;
    }

    const respawnedIds = this.matchState.advanceTimers();
    this.respawnPlayers(respawnedIds);
    this.tickPlayerCooldowns();
    this.tickGunCooldowns();
    this.tickWeaponCooldowns();

    const previousStates = this.previousStatesScratch;
    previousStates.clear();

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

      // While in the lethal-launch state, inputs are ignored. This keeps
      // the rollback sim cheap during the 10x knockback fly-out.
      if (record.inLethalLaunch) {
        continue;
      }
      this.applyInput(id, inputFlags);
    }

    this.tickAttacks();
    this.tickBullets();
    this.updateLethalLaunches();
    this.world.step();
    this.resolvePlatformContacts(previousStates);
    this.syncHorizontalMovement(ids, inputs, previousStates);
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

  getRenderState(renderDelaySeconds = 0): RenderState {
    const renderDelay = Math.max(0, renderDelaySeconds);

    const players = Array.from(this.players.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, record]) => {
        const position = record.body.translation();
        const velocity = record.body.linvel();
        const renderX = position.x + velocity.x * renderDelay;
        const renderY = position.y + velocity.y * renderDelay;
        const match = this.matchState.getRenderInfo(id);

        return {
          id,
          x: renderX,
          y: renderY,
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
          vy: velocity.y,
          gunFireCooldownTicks: record.gunFireCooldownTicks,
          activeWeaponAttack: record.activeWeaponAttack
            ? { defKind: record.heldItem!, ticksRemaining: record.activeWeaponAttack.ticksRemaining }
            : null,
          shieldActive: record.shieldActive,
          shieldHp: record.shieldHp,
          koableTicksRemaining: record.koableTicksRemaining,
          knockbackTicksRemaining: record.knockbackTicksRemaining,
          damagePct: record.damagePct,
          inLethalLaunch: record.inLethalLaunch,
          grounded: record.moveState !== MoveState.Airborne,
        };
      });

    const attacks: AttackRenderState[] = [];
    for (const [id, record] of this.players) {
      if (!record.activeAttack) {
        continue;
      }

      const definition = getAttackDefinition(record.activeAttack.kind);
      const position = record.body.translation();
      const velocity = record.body.linvel();
      const renderX = position.x + velocity.x * renderDelay;
      const renderY = position.y + velocity.y * renderDelay;
      const center = this.attackCenter(renderX, renderY, record.facing, definition);
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
        x: bullet.x + bullet.vx * renderDelay,
        y: bullet.y + bullet.vy * renderDelay,
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
      roundStartCountdownTicks: this.getRoundStartCountdownTicks(),
      animTick: this.tickCount + renderDelay * TICK_RATE,
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

  // Creates physics bodies for all given players so that serialize() succeeds
  // at tick 0 when session.start() is called before any step() runs.
  initializePlayers(sortedIds: string[]): void {
    this.syncPlayers(sortedIds);
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

  private syncHorizontalMovement(
    ids: string[],
    inputs: Map<PlayerId, Uint8Array>,
    previousStates: Map<string, StepPlayerState>,
  ): void {
    for (const id of ids) {
      if (!this.matchState.canReceiveInput(id)) {
        continue;
      }

      const previous = previousStates.get(id);
      const record = this.players.get(id);
      if (!previous || !record) {
        continue;
      }
      // Only correct horizontal drift when the player is in the air-control
      // state (or skid/idle on ground). The smash-style ground states
      // (initial-dash, dash-turn-lock, run) write their own velocity each
      // tick and don't benefit from MOVE_SPEED drift correction.
      if (record.moveState !== MoveState.Airborne) {
        continue;
      }
      if (record.dodgeTicksRemaining > 0 || record.shieldActive) {
        continue;
      }
      // Don't reel a Smash-mode victim back to MOVE_SPEED while they're being
      // launched — the SSB knockback owns their velocity during hitstun.
      if (
        this.gameMode === 'smash' &&
        (record.knockbackTicksRemaining > 0 || record.launchRecoveryTicksRemaining > 0)
      ) {
        continue;
      }

      const raw = inputs.get(id as PlayerId);
      if (!raw) {
        continue;
      }

      const inputFlags = decodeInputBits(raw);
      const horizontalDir =
        (inputFlags & InputBits.Left ? -1 : 0) +
        (inputFlags & InputBits.Right ? 1 : 0);
      if (horizontalDir === 0) {
        continue;
      }

      const position = record.body.translation();
      const intendedDelta = horizontalDir * MOVE_SPEED * FIXED_STEP_SECONDS;
      const intendedX = previous.x + intendedDelta;
      const actualDelta = position.x - previous.x;

      if (Math.abs(actualDelta) > 0.001 && Math.sign(actualDelta) !== horizontalDir) {
        continue;
      }
      if (Math.abs(actualDelta) > Math.abs(intendedDelta) + 0.001) {
        continue;
      }
      // If the physics solver moved us far less than intended, a wall blocked
      // the player. Force-writing intendedX here would teleport them inside
      // the wall, which lets the grounded raycast pick up the wall geometry
      // and grants an infinite wall-jump. Skip the snap in that case.
      if (Math.abs(actualDelta) < Math.abs(intendedDelta) * 0.5) {
        continue;
      }

      record.body.setTranslation({ x: intendedX, y: position.y }, true);
      record.body.setLinvel({ x: horizontalDir * MOVE_SPEED, y: record.body.linvel().y }, true);
    }
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
    let membershipChanged = false;

    for (const [id, record] of this.players) {
      if (!keep.has(id)) {
        this.unregisterPlayerColliders(record.body);
        this.world.removeRigidBody(record.body);
        this.players.delete(id);
        this.previousInputFlags.delete(id);
        this.matchState.removePlayer(id);
        this.playerIdBytes.delete(id);
        membershipChanged = true;
      }
    }

    for (const id of sortedIds) {
      if (this.players.has(id)) {
        continue;
      }

      const playerSlot = sortedIds.indexOf(id);
      this.assignColorToPlayer(id, playerSlot);  // ← ADD THIS LIN

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
      membershipChanged = true;
    }

    if (membershipChanged || this.sortedPlayerIds.length !== sortedIds.length) {
      this.sortedPlayerIds.length = 0;
      for (const id of sortedIds) {
        this.sortedPlayerIds.push(id);
      }
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

    // Smash-mode hitstun: while a victim is mid-knockback, don't run the
    // move-state machine at all. Otherwise its per-tick velocity write would
    // clobber the launch impulse and the launch angle collapses to vertical.
    if (this.gameMode === 'smash' && record.knockbackTicksRemaining > 0) {
      this.previousInputFlags.set(id, inputFlags);
      return;
    }

    const body = record.body;
    const velocity = body.linvel();
    const previousFlags = this.previousInputFlags.get(id) ?? 0;

    const horizontalDir =
      (inputFlags & InputBits.Left ? -1 : 0) +
      (inputFlags & InputBits.Right ? 1 : 0);

    const jumpPressed = (inputFlags & InputBits.Jump) !== 0 && (previousFlags & InputBits.Jump) === 0;
    const ducking = (inputFlags & InputBits.Duck) !== 0;
    const attackPressed = (inputFlags & InputBits.Punch) !== 0 && (previousFlags & InputBits.Punch) === 0;
    const dodgePressed = (inputFlags & InputBits.Dodge) !== 0 && (previousFlags & InputBits.Dodge) === 0;
    const shieldHeld = (inputFlags & InputBits.Shield) !== 0;
    const shieldWasHeld = (previousFlags & InputBits.Shield) !== 0;
    const shieldPressed = shieldHeld && !shieldWasHeld;
    const shieldReleased = !shieldHeld && shieldWasHeld;

    const grounded = this.isGrounded(body, false);

    // 1. Active dodge: maintain burst velocity, decrement, ignore other input.
    if (record.dodgeTicksRemaining > 0) {
      // Pin horizontal slide on the ground; let physics carry the launched
      // 2D velocity of an air dodge so it can travel diagonally / vertically.
      if (grounded) {
        body.setLinvel({ x: record.facing * DODGE_SPEED, y: velocity.y }, true);
      }
      record.dodgeTicksRemaining -= 1;
      this.previousInputFlags.set(id, inputFlags);
      return;
    }

    // 2. Shield raise (rising edge).
    if (
      shieldPressed &&
      !record.shieldActive &&
      record.shieldBrokenLockoutTicks === 0 &&
      record.shieldReleaseCooldownTicks === 0 &&
      record.shieldHp > 0
    ) {
      record.shieldActive = true;
      record.shieldBlockedSinceRaise = false;
      if (grounded) {
        // Hard standstill cancels any ground movement state instantly.
        record.moveState = MoveState.Idle;
        record.moveStateTicks = 0;
        record.moveDirection = 0;
        body.setLinvel({ x: 0, y: velocity.y }, true);
      }
      // Airborne: preserve horizontal momentum.
    }

    // While shield is active, drain HP and skip all other input.
    let shieldDeactivatedThisFrame = false;
    if (record.shieldActive) {
      if (shieldReleased) {
        // Button released: deactivate shield immediately and fall through to normal input.
        record.shieldActive = false;
        shieldDeactivatedThisFrame = true;
      } else {
        record.shieldHp -= SHIELD_DRAIN_PER_TICK;
        if (record.shieldHp <= 0) {
          record.shieldHp = 0;
          record.shieldActive = false;
          record.shieldBlockedSinceRaise = false;
          record.shieldBrokenLockoutTicks = SHIELD_BROKEN_LOCKOUT_TICKS;
        } else {
          if (grounded) {
            body.setLinvel({ x: 0, y: velocity.y }, true);
          }
          this.previousInputFlags.set(id, inputFlags);
          return;
        }
      }
    }

    // Shield released this tick: apply 2s cooldown unless something was blocked.
    // Only fires when shield was actually active — pressing during cooldown doesn't reset the timer.
    if (shieldDeactivatedThisFrame) {
      if (!record.shieldBlockedSinceRaise) {
        record.shieldReleaseCooldownTicks = SHIELD_RELEASE_COOLDOWN_TICKS;
      }
      record.shieldBlockedSinceRaise = false;
    }

    // 3. Jump (rising edge) — ground or double jump.
    let nextYVelocity = velocity.y;
    if (jumpPressed) {
      if (this.isGrounded(body, ducking)) {
        nextYVelocity = JUMP_SPEED;
        record.doubleJumpAvailable = true;
        this.playJumpSound();
      } else if (record.doubleJumpAvailable && !ducking) {
        nextYVelocity = DOUBLE_JUMP_SPEED;
        record.doubleJumpAvailable = false;
        this.playJumpSound();
      }
    }

    // 4. Attack branches (gun, melee weapon, default punch).
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

    if (attackPressed && record.canUseWeapon()) {
      const heldKind = record.heldItem!;
      const def = WEAPON_DEFINITIONS[heldKind];
      if (def?.kind === 'melee') {
        record.activeWeaponAttack = {
          def,
          ticksRemaining: def.durationTicks ?? 0,
        };
        record.weaponCooldownTicks = def.cooldownTicks;
        if (heldKind === ItemKind.EthernetWhip) {
          const whipSound = new Audio(WHIP_SOUND_URL);
          whipSound.volume = 0.5 * this.sfxVolume;
          void whipSound.play().catch((err) => {
            console.warn('Whip sound could not play:', err);
          });
        }
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
      record.punchCooldownTicks = PUNCH_COOLDOWN_TICKS;
      this.playPunchSound();
      this.resolvePunchHits(id, definition);
    }

    // 5. Dodge initiation (Shift). 8-way: WASD/arrows pick the direction;
    // airborne dodge uses separate speed/duration values and is limited per
    // airtime so it doubles as a recovery tool.
    if (dodgePressed && record.canDodge()) {
      const jumpHeldNow = (inputFlags & InputBits.Jump) !== 0;
      let dx = horizontalDir;
      let dy = (jumpHeldNow ? 1 : 0) + (ducking ? -1 : 0);
      if (dx === 0 && dy === 0) {
        dx = record.facing;
      }
      const len = Math.hypot(dx, dy) || 1;
      const ndx = dx / len;
      const ndy = dy / len;

      if (grounded) {
        record.facing = ndx >= 0 ? 1 : -1;
        record.dodgeTicksRemaining = DODGE_DURATION_TICKS;
        record.dodgeCooldownTicks = DODGE_COOLDOWN_TICKS;
        body.setLinvel({ x: record.facing * DODGE_SPEED, y: velocity.y }, true);
        this.previousInputFlags.set(id, inputFlags);
        return;
      }

      if (record.airDodgesRemaining > 0) {
        record.airDodgesRemaining -= 1;
        record.facing = ndx >= 0 ? 1 : -1;
        record.dodgeTicksRemaining = AIR_DODGE_DURATION_TICKS;
        record.dodgeCooldownTicks = AIR_DODGE_COOLDOWN_TICKS;
        body.setLinvel(
          { x: ndx * AIR_DODGE_SPEED, y: ndy * AIR_DODGE_SPEED },
          true,
        );
        this.previousInputFlags.set(id, inputFlags);
        return;
      }
      // No air dodges left — fall through and let normal airborne control resume.
    }

    // Keep facing in sync with held direction outside of the state machine.
    if (horizontalDir !== 0) {
      record.facing = horizontalDir;
    }

    // 6. Movement state machine.
    // Sync grounded state.
    if (!grounded) {
      if (record.moveState !== MoveState.Airborne) {
        record.moveState = MoveState.Airborne;
        record.moveStateTicks = 0;
      }
    } else if (record.moveState === MoveState.Airborne) {
      record.moveState = MoveState.Idle;
      record.moveStateTicks = 0;
      record.moveDirection = 0;
      record.doubleJumpAvailable = true;
      record.airDodgesRemaining = AIR_DODGES_PER_AIRTIME;
      record.launchRecoveryTicksRemaining = 0;
    }

    let nextVx = velocity.x;
    switch (record.moveState) {
      case MoveState.Airborne: {
        if (this.gameMode === 'smash' && record.launchRecoveryTicksRemaining > 0) {
          const targetVx = horizontalDir * MOVE_SPEED;
          const delta = targetVx - velocity.x;
          const step = Math.sign(delta) * Math.min(Math.abs(delta), SMASH_LAUNCH_AIR_CONTROL);
          nextVx = velocity.x + step;
        } else {
          nextVx = horizontalDir * MOVE_SPEED;
        }
        break;
      }
      case MoveState.Idle: {
        if (horizontalDir !== 0 && record.dashInputCooldownTicks === 0 && !ducking) {
          record.moveState = MoveState.InitialDash;
          record.moveStateTicks = 0;
          record.moveDirection = horizontalDir;
          record.facing = horizontalDir;
          record.dashInputCooldownTicks = DASH_INPUT_COOLDOWN_TICKS;
          nextVx = horizontalDir * INITIAL_DASH_SPEED;
        } else {
          nextVx = 0;
        }
        break;
      }
      case MoveState.InitialDash: {
        if (horizontalDir !== 0 && horizontalDir !== record.moveDirection) {
          record.moveDirection = horizontalDir;
          record.facing = horizontalDir;
          record.moveStateTicks = 0;
        }
        nextVx = record.moveDirection * INITIAL_DASH_SPEED;
        record.moveStateTicks += 1;
        if (record.moveStateTicks >= INITIAL_DASH_TICKS) {
          record.moveState = MoveState.DashTurnLock;
          record.moveStateTicks = 0;
        }
        break;
      }
      case MoveState.DashTurnLock: {
        const t = record.moveStateTicks / DASH_TURN_LOCK_TICKS;
        const speed = INITIAL_DASH_SPEED + (RUN_SPEED - INITIAL_DASH_SPEED) * t;
        nextVx = record.moveDirection * speed;
        record.moveStateTicks += 1;
        if (record.moveStateTicks >= DASH_TURN_LOCK_TICKS) {
          if (horizontalDir === record.moveDirection && horizontalDir !== 0) {
            record.moveState = MoveState.Run;
          } else {
            record.moveState = MoveState.Skid;
          }
          record.moveStateTicks = 0;
        }
        break;
      }
      case MoveState.Run: {
        if (horizontalDir === 0 || horizontalDir !== record.moveDirection) {
          record.moveState = MoveState.Skid;
          record.moveStateTicks = 0;
        }
        nextVx = record.moveDirection * RUN_SPEED;
        break;
      }
      case MoveState.Skid: {
        const t = Math.min(1, record.moveStateTicks / SKID_TICKS);
        const speed = RUN_SPEED * (1 - t);
        nextVx = record.moveDirection * speed;
        record.moveStateTicks += 1;
        if (record.moveStateTicks >= SKID_TICKS) {
          nextVx = 0;
          if (
            horizontalDir !== 0 &&
            horizontalDir !== record.moveDirection &&
            record.dashInputCooldownTicks === 0 &&
            !ducking
          ) {
            record.moveState = MoveState.InitialDash;
            record.moveStateTicks = 0;
            record.moveDirection = horizontalDir;
            record.facing = horizontalDir;
            record.dashInputCooldownTicks = DASH_INPUT_COOLDOWN_TICKS;
            nextVx = horizontalDir * INITIAL_DASH_SPEED;
          } else {
            record.moveState = MoveState.Idle;
            record.moveStateTicks = 0;
            record.moveDirection = 0;
          }
        }
        break;
      }
    }

    const prevHorizontalDir = this.previousHorizontalDir.get(id) ?? 0;
    if (horizontalDir !== 0 && prevHorizontalDir === 0 && grounded) {
      this.playFootstepsSound();
    }
    this.previousHorizontalDir.set(id, horizontalDir);

    body.setLinvel({ x: nextVx, y: nextYVelocity }, true);
    this.previousInputFlags.set(id, inputFlags);
  }

  private playStageOutSound(): void {
    const audio = this.stageOutAudioPool[this.stageOutAudioPoolIndex];
    this.stageOutAudioPoolIndex = (this.stageOutAudioPoolIndex + 1) % this.stageOutAudioPool.length;
    audio.currentTime = 0;
    void audio.play().catch((err) => {
      console.warn('Stage-out sound could not play:', err);
    });
  }

  private playKoHitSound(): void {
    const audio = this.koHitAudioPool[this.koHitAudioPoolIndex];
    this.koHitAudioPoolIndex = (this.koHitAudioPoolIndex + 1) % this.koHitAudioPool.length;
    audio.currentTime = 0;
    void audio.play().catch((err) => {
      console.warn('KO hit sound could not play:', err);
    });
  }

  private playPunchSound(): void {
    const audio = this.punchAudioPool[this.punchAudioPoolIndex];
    this.punchAudioPoolIndex = (this.punchAudioPoolIndex + 1) % this.punchAudioPool.length;
    audio.currentTime = 0;
    void audio.play().catch((err) => {
      console.warn('Punch sound could not play:', err);
    });
  }

  private playEquipSound(): void {
    const audio = this.equipAudioPool[this.equipAudioPoolIndex];
    this.equipAudioPoolIndex = (this.equipAudioPoolIndex + 1) % this.equipAudioPool.length;
    audio.currentTime = 0;
    void audio.play().catch((err) => {
      console.warn('Equip sound could not play:', err);
    });
  }

  private playJumpSound(): void {
    const audio = this.jumpAudioPool[this.jumpAudioPoolIndex];
    this.jumpAudioPoolIndex = (this.jumpAudioPoolIndex + 1) % this.jumpAudioPool.length;
    audio.currentTime = 0;
    void audio.play().catch((err) => {
      console.warn('Jump sound could not play:', err);
    });
  }

  private playFootstepsSound(): void {
    const audio = this.footstepsAudioPool[this.footstepsAudioPoolIndex];
    this.footstepsAudioPoolIndex = (this.footstepsAudioPoolIndex + 1) % this.footstepsAudioPool.length;
    audio.currentTime = 0;
    void audio.play().catch((err) => {
      console.warn('Footsteps sound could not play:', err);
    });
  }

  private tickPlayerCooldowns(): void {
    for (const [, record] of this.players) {
      if (record.dodgeCooldownTicks > 0) {
        record.dodgeCooldownTicks -= 1;
      }
      if (record.knockbackTicksRemaining > 0) {
        record.knockbackTicksRemaining -= 1;
      }
      if (record.launchRecoveryTicksRemaining > 0 && this.gameMode === 'smash') {
        if (record.moveState === MoveState.Airborne) {
          const v = record.body.linvel();
          record.body.setLinvel(
            {
              x: v.x * SMASH_LAUNCH_HORIZONTAL_DRAG,
              y: v.y * SMASH_LAUNCH_VERTICAL_DRAG,
            },
            true,
          );
        }
        record.launchRecoveryTicksRemaining -= 1;
      }
      if (record.dashInputCooldownTicks > 0) {
        record.dashInputCooldownTicks -= 1;
      }
      if (record.koableTicksRemaining > 1) {
        record.koableTicksRemaining -= 1;
      }
      // After 3s, touching the ground clears the KOable window. This is what
      // lets a player who got hit recover and become safe from inner-blast
      // ring out again.
      
      // If not koable and not grounded. Remove KOable
      if (record.koableTicksRemaining <= 1 && this.isGrounded(record.body, false)){
        record.koableTicksRemaining = 0;
      }

      if (record.shieldBrokenLockoutTicks > 0) {
        record.shieldBrokenLockoutTicks -= 1;
        if (record.shieldBrokenLockoutTicks === 0) {
          record.shieldHp = SHIELD_MAX_HP;
        }
      }
      if (record.shieldReleaseCooldownTicks > 0) {
        record.shieldReleaseCooldownTicks -= 1;
      }
      if (
        !record.shieldActive &&
        record.shieldBrokenLockoutTicks === 0 &&
        record.shieldHp < SHIELD_MAX_HP
      ) {
        record.shieldHp = Math.min(SHIELD_MAX_HP, record.shieldHp + SHIELD_RECHARGE_PER_TICK);
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
          const def = record.activeWeaponAttack.def;
          const lashStartTicks = (def.lashTicks ?? 0) + (def.recoilTicks ?? 0);
          if (record.activeWeaponAttack.ticksRemaining === lashStartTicks) {
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
      if (record.punchCooldownTicks > 0) {
        record.punchCooldownTicks -= 1;
      }

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
        const piercesPlayers = weaponDef?.projectilePiercePlayers ?? false;

        if (hitPlayerId !== undefined && piercesPlayers) {
          if (this.matchState.canTakeDamage(hitPlayerId)) {
            const target = this.players.get(hitPlayerId);
            if (target) {
              const nextHealth = this.applyDamageWithShield(target, bullet.damage, Math.sign(bullet.vx) || 1, {
                baseKnockback: weaponDef?.baseKnockback,
                launchAngleDeg: weaponDef?.launchAngleDeg,
              });
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

          const travelSign = Math.sign(bullet.vx) || 1;
          const piercedTarget = this.players.get(hitPlayerId);
          if (piercedTarget) {
            const pos = piercedTarget.body.translation();
            const exitX = pos.x + travelSign * (PLAYER_HALF_WIDTH + hitHalfWidth + 0.02);
            bullet.x = travelSign > 0 ? Math.max(bullet.x, exitX) : Math.min(bullet.x, exitX);
          } else {
            bullet.x += dx;
          }

          bullet.y += bullet.vy * FIXED_STEP_SECONDS;
          if (bullet.x < minX || bullet.x > maxX) {
            this.bullets.delete(bulletId);
          }
          continue;
        }

        if (hitPlayerId !== undefined && this.matchState.canTakeDamage(hitPlayerId)) {
          const target = this.players.get(hitPlayerId);
          if (target) {
            const nextHealth = this.applyDamageWithShield(
              target,
              bullet.damage,
              Math.sign(bullet.vx) || 1,
              {
                baseKnockback: weaponDef?.baseKnockback,
                launchAngleDeg: weaponDef?.launchAngleDeg,
              },
            );
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

      if (slot.respawnTick > 0 && this.tickCount >= slot.respawnTick) {
        this.spawnItem(slotIndex);
      }

      if (slot.item !== null) {
        const pickedUpBy = this.findItemPickupCandidate(slot.item);
        if (pickedUpBy) {
          this.collectItem(slotIndex, pickedUpBy);
        }
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
    this.playEquipSound();
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
      respawnTick: this.tickCount + ITEM_SPAWN_INTERVAL_TICKS,
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
        respawnTick: this.tickCount + ITEM_SPAWN_INTERVAL_TICKS,
      });
    }
  }

  private chooseSpawnedItemKind(slotIndex: number): ItemKind {
    // Deterministic pseudo-random pick keyed on tickCount + slotIndex so that
    // every rollback peer agrees on the spawned kind without desync.
    let seed = (this.tickCount * 2654435761 + slotIndex * 40503 + 0x9e3779b9) >>> 0;
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;  seed >>>= 0;
    const index = seed % SPAWN_ROTATION.length;
    return SPAWN_ROTATION[index] ?? ItemKind.Gun;
  }

  private handleBlastZoneDeaths(): void {
    for (const [id, record] of this.players) {
      if (!this.matchState.canReceiveInput(id)) {
        continue;
      }

      const position = record.body.translation();
      const pastOuter = this.outsideOuterBlast(position);
      const pastInner = pastOuter || this.outsideInnerBlast(position);
      if (!pastInner) {
        continue;
      }

      // Inner blast only kills if the player is in the KOable window OR
      // they're in the smash-mode lethal-launch state (already condemned).
      // Outer blast always kills.
      if (!pastOuter && record.koableTicksRemaining === 0 && !record.inLethalLaunch) {
        continue;
      }

      if (!this.hasOpponentInMatch()) {
        this.recoverSoloPlayer(record);
        continue;
      }

      this.playStageOutSound();
      record.body.setLinvel({ x: 0, y: 0 }, true);
      record.body.sleep();
      // Clear lethal-launch state now (not at respawn) so the collider's
      // sensor flag has many ticks to settle in Rapier's broadphase before
      // the body is teleported to the spawn point. Otherwise setSensor(false)
      // issued on the same tick as the spawn teleport can fail to apply,
      // leaving the player to fall through the platform for one frame.
      const wasInLethal = record.inLethalLaunch;
      record.inLethalLaunch = false;
      record.lethalLaunchTicks = 0;
      this.syncLethalLaunchColliderState(record, wasInLethal);
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
      const wasInLethal = record.inLethalLaunch;
      record.reset();
      // record.reset() clears inLethalLaunch; resync collider state to
      // restore restitution + disable sensor-mode if we had transitioned.
      this.syncLethalLaunchColliderState(record, wasInLethal);
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

  private outsideInnerBlast(position: { x: number; y: number }): boolean {
    const left = position.x - PLAYER_HALF_WIDTH;
    const right = position.x + PLAYER_HALF_WIDTH;
    const top = position.y + PLAYER_HALF_HEIGHT;
    const bottom = position.y - PLAYER_HALF_HEIGHT;

    return (
      left < this.map.bounds.minX - KO_BLAST_TILES_SIDE * TILE_SIZE ||
      right > this.map.bounds.maxX + KO_BLAST_TILES_SIDE * TILE_SIZE ||
      top > this.map.bounds.maxY + KO_BLAST_TILES_UP * TILE_SIZE ||
      bottom < this.map.bounds.minY - KO_BLAST_TILES_DOWN * TILE_SIZE
    );
  }

  private outsideOuterBlast(position: { x: number; y: number }): boolean {
    const left = position.x - PLAYER_HALF_WIDTH;
    const right = position.x + PLAYER_HALF_WIDTH;
    const top = position.y + PLAYER_HALF_HEIGHT;
    const bottom = position.y - PLAYER_HALF_HEIGHT;

    return (
      left < this.map.bounds.minX - FALLBACK_BLAST_TILES_SIDE * TILE_SIZE ||
      right > this.map.bounds.maxX + FALLBACK_BLAST_TILES_SIDE * TILE_SIZE ||
      top > this.map.bounds.maxY + FALLBACK_BLAST_TILES_UP * TILE_SIZE ||
      bottom < this.map.bounds.minY - FALLBACK_BLAST_TILES_DOWN * TILE_SIZE
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

    if (weapon.kind === ItemKind.PenCrossbow) {
      const crossbowSound = new Audio(PEN_CROSSBOW_SOUND_URL);
      crossbowSound.volume = 0.5 * this.sfxVolume;
      void crossbowSound.play().catch((err) => {
        console.warn('Pen crossbow sound could not play:', err);
      });
    }
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

    if (kind === ItemKind.Finals) {
      const paperSound = new Audio(PAPER_SOUND_URL);
      paperSound.volume = 0.9 * this.sfxVolume;
      void paperSound.play().catch((err) => {
        console.warn('Paper sound could not play:', err);
      });
    }

    if (kind === ItemKind.PenCrossbow) {
      const crossbowSound = new Audio(PEN_CROSSBOW_SOUND_URL);
      crossbowSound.volume = 0.5 * this.sfxVolume;
      void crossbowSound.play().catch((err) => {
        console.warn('Pen crossbow sound could not play:', err);
      });
    }

    if (kind === ItemKind.BinaryBeam) {
      const binaryBeamSound = new Audio(BINARY_BEAM_SOUND_URL);
      binaryBeamSound.volume = 0.5 * this.sfxVolume;
      void binaryBeamSound.play().catch((err) => {
        console.warn('Binary beam sound could not play:', err);
      });
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

  /**
   * Route damage through the target's shield / dodge i-frames.
   *
   * - If the target is mid-dodge: no-op (full invincibility).
   * - If the target has an active shield with HP: drain shield HP by `damage`,
   *   negate health damage and knockback. If shield drops to 0 it shatters,
   *   begins lockout, and the original damage + knockback go through as a
   *   shield-break punish.
   * - Otherwise: apply damage and (if knockbackDirX != null) knockback as usual.
   *
   * Stage-out (blast zone) is intentionally NOT gated by this — it's checked
   * by position in handleBlastZoneDeaths.
   *
   * Returns target.health after the call (matches PlayerCharacter.takeDamage).
   */
  private applyDamageWithShield(
    target: PlayerCharacter,
    damage: number,
    knockbackDirX: number | null,
    attackMeta?: { baseKnockback?: number; launchAngleDeg?: number },
  ): number {
    if (target.dodgeTicksRemaining > 0) {
      return target.health;
    }
    if (target.shieldActive && target.shieldHp > 0) {
      target.shieldHp -= damage;
      target.shieldBlockedSinceRaise = true;
      if (target.shieldHp <= 0) {
        target.shieldHp = 0;
        target.shieldActive = false;
        target.shieldBlockedSinceRaise = false;
        target.shieldBrokenLockoutTicks = SHIELD_BROKEN_LOCKOUT_TICKS;
        this.absorbDamage(target, damage);
        target.koableTicksRemaining = KOABLE_DURATION_TICKS;
        if (knockbackDirX !== null) {
          this.applyKnockback(target, knockbackDirX, damage, attackMeta);
        }
      }
      return target.health;
    }
    this.absorbDamage(target, damage);
    target.koableTicksRemaining = KOABLE_DURATION_TICKS;
    if (knockbackDirX !== null) {
      this.applyKnockback(target, knockbackDirX, damage, attackMeta);
    }
    return target.health;
  }

  /**
   * Classic: subtracts from `health`.
   * Smash: accumulates `damagePct` (and leaves `health` at full so existing
   * health-based code paths like `handleHealthDamage` stay no-ops).
   */
  private absorbDamage(target: PlayerCharacter, damage: number): void {
    if (this.gameMode === 'smash') {
      target.damagePct = Math.max(0, target.damagePct + Math.max(0, damage));
    } else {
      target.takeDamage(damage);
    }
  }

  private applyKnockback(
    target: PlayerCharacter,
    directionX: number,
    attackDamage: number,
    attackMeta?: { baseKnockback?: number; launchAngleDeg?: number },
  ): void {
    if (this.gameMode === 'smash') {
      this.applySmashKnockback(target, directionX, attackDamage, attackMeta);
    } else {
      this.applyClassicKnockback(target, directionX);
    }
  }

  private applyClassicKnockback(target: PlayerCharacter, directionX: number): void {
    const healthFraction = target.health / target.maxHealth;
    const magnitude = KNOCKBACK_BASE + KNOCKBACK_SCALE * (1 - healthFraction);
    const currentVel = target.body.linvel();
    target.knockbackTicksRemaining = 6;
    target.body.setLinvel(
      {
        x: currentVel.x + directionX * magnitude,
        y: currentVel.y + KNOCKBACK_UP,
      },
      true,
    );
  }

  /**
   * SSB-style knockback. Formula:
   *   KB = ((p/10 + p*d/20) * 200/(w+100) * 1.4) + 18 + b
   * (knockback scaling `s` and other-scalers `r` fixed at 1)
   *
   * When the victim is already at or above SMASH_MAX_DAMAGE_PCT *before* this
   * hit, multiply the result by SMASH_KB_LETHAL_MULTIPLIER and enter the
   * lethal-launch state (input locked, restitution=1, collisions disabled
   * after a brief delay so they noclip to the blast zone).
   */
  private applySmashKnockback(
    target: PlayerCharacter,
    directionX: number,
    attackDamage: number,
    attackMeta?: { baseKnockback?: number; launchAngleDeg?: number },
  ): void {
    // Was the victim already over the lethal threshold *before* this hit?
    const damageBeforeHit = target.damagePct - Math.max(0, attackDamage);
    const wasLethal = damageBeforeHit >= SMASH_MAX_DAMAGE_PCT;

    const p = target.damagePct;
    const d = attackDamage;
    const w = target.weight > 0 ? target.weight : 1;
    const b = attackMeta?.baseKnockback ?? SMASH_DEFAULT_BASE_KNOCKBACK;

    let kb = ((p / 10 + (p * d) / 20) * (200 / (w + 100)) * SMASH_KB_GROWTH_MULT)
      + SMASH_KB_HITSTUN_BIAS
      + b;
    // Global output scale ("r" term). Tune in constants.ts.
    kb *= SMASH_KB_OUTPUT_SCALE;

    if (wasLethal) {
      kb *= SMASH_KB_LETHAL_MULTIPLIER;
      const wasInLethal = target.inLethalLaunch;
      target.inLethalLaunch = true;
      target.lethalLaunchTicks = 0;
      this.syncLethalLaunchColliderState(target, wasInLethal);
      this.playKoHitSound();
    }

    const angleDeg = attackMeta?.launchAngleDeg ?? SMASH_DEFAULT_LAUNCH_ANGLE_DEG;
    const ang = (angleDeg * Math.PI) / 180;
    const cur = target.body.linvel();
    target.knockbackTicksRemaining = 6;
    target.launchRecoveryTicksRemaining = SMASH_LAUNCH_RECOVERY_TICKS;
    target.body.setLinvel(
      {
        x: cur.x + directionX * kb * Math.cos(ang) * SMASH_KB_HORIZONTAL_MULT,
        y: cur.y + kb * Math.sin(ang) * SMASH_KB_VERTICAL_MULT,
      },
      true,
    );
  }

  /**
   * Reapply collider mutations (restitution, sensor) so they reflect the
   * player's current `inLethalLaunch` + `lethalLaunchTicks`. Idempotent —
   * safe to call after deserialize as well as on state transitions.
   * `wasInLethal` is unused but retained for callsite clarity.
   */
  private syncLethalLaunchColliderState(target: PlayerCharacter, _wasInLethal: boolean): void {
    void _wasInLethal;
    const wantSensor =
      target.inLethalLaunch && target.lethalLaunchTicks >= SMASH_LETHAL_NOCLIP_DELAY_TICKS;
    const wantRestitution = target.inLethalLaunch ? SMASH_KB_LETHAL_RESTITUTION : 0;
    for (let i = 0; i < target.body.numColliders(); i += 1) {
      const collider = target.body.collider(i);
      collider.setRestitution(wantRestitution);
      collider.setSensor(wantSensor);
    }
  }

  /**
   * Per-tick: advance lethal-launch timers, flip colliders to sensors after
   * the noclip delay so the rocket-launched victim passes through stage
   * geometry until the blast zone kills them.
   */
  private updateLethalLaunches(): void {
    if (this.gameMode !== 'smash') return;
    for (const p of this.players.values()) {
      if (!p.inLethalLaunch) continue;
      p.lethalLaunchTicks += 1;
      if (p.lethalLaunchTicks === SMASH_LETHAL_NOCLIP_DELAY_TICKS) {
        this.syncLethalLaunchColliderState(p, true);
      }
    }
  }

  /**
   * Public hook for future explosion implementations. Applies damage and
   * knockback radially from `(centerX, centerY)`.
   */
  applyExplosionDamage(
    centerX: number,
    centerY: number,
    radius: number,
    damage: number,
    options?: { baseKnockback?: number; launchAngleDeg?: number },
  ): void {
    const r2 = radius * radius;
    for (const [id, p] of this.players) {
      if (!this.matchState.canTakeDamage(id)) continue;
      const pos = p.body.translation();
      const dx = pos.x - centerX;
      const dy = pos.y - centerY;
      if (dx * dx + dy * dy > r2) continue;
      const dirX = Math.sign(dx) || 1;
      this.applyDamageWithShield(p, damage, dirX, options);
    }
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
      if (!this.matchState.canTakeDamage(otherId)) {
        continue;
      }

      const targetPos = target.body.translation();
      if (
        Math.abs(targetPos.x - center.x) < overlapHalfWidth &&
        Math.abs(targetPos.y - center.y) < overlapHalfHeight
      ) {
        const knockDir = attacker.facing;
        this.applyDamageWithShield(target, definition.damage, knockDir, {
          baseKnockback: definition.baseKnockback,
          launchAngleDeg: definition.launchAngleDeg,
        });
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
      if (!this.matchState.canTakeDamage(otherId)) continue;

      const targetPos = target.body.translation();
      if (
        Math.abs(targetPos.x - cx) < overlapHalfWidth &&
        Math.abs(targetPos.y - cy) < overlapHalfHeight
      ) {
        this.applyDamageWithShield(target, def.damage, attacker.facing, {
          baseKnockback: def.baseKnockback,
          launchAngleDeg: def.launchAngleDeg,
        });
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
      // solid: false — if the ray origin is already inside a collider (e.g.
      // brief penetration into a wall after a hard horizontal hit), don't
      // report a distance-0 hit. Otherwise the side rays here would treat a
      // wall as ground and grant an infinite wall-jump.
      const hit = this.world.castRay(
        ray,
        GROUND_RAY_LENGTH,
        false,
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

    const slot = this.playerColorMap.get(playerId);
    if (slot !== undefined) {
      return this.map.playerSpawnPoints[slot % this.map.playerSpawnPoints.length];
    }
    return this.map.playerSpawnPoints[this.hashString(playerId) % this.map.playerSpawnPoints.length];
  }

  private playerColorMap = new Map<string, number>();

assignColorToPlayer(playerId: string, playerSlot: number) {
    this.playerColorMap.set(playerId, playerSlot % PLAYER_COLOR_PALETTE.length);
}

private colorForPlayer(playerId: string): number {
    const colorIndex = this.playerColorMap.get(playerId);
    return colorIndex !== undefined ? PLAYER_COLOR_PALETTE[colorIndex] : PLAYER_COLOR_PALETTE[0];
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

  /** Y position far below the map where players "wait" before their countdown stage. */
  private getOffstageSentinelY(): number {
    return this.map.bounds.minY - 1000;
  }

  /** Slot index for sequential countdown spawn. Smaller slot spawns first. */
  private getPlayerSlot(playerId: string): number {
    return this.playerColorMap.get(playerId) ?? 0;
  }

  /** During countdown, returns 0..(numPlayers-1) — the highest slot that should be on-stage now. */
  private getCountdownStageIndex(): number {
    if (this.roundStartCountdownTicks <= 0) {
      return Number.MAX_SAFE_INTEGER;
    }
    return Math.floor(
      (ROUND_START_COUNTDOWN_TOTAL_TICKS - this.roundStartCountdownTicks) / TICK_RATE,
    );
  }

  /** Sorted list of non-eliminated player ids in slot order. */
  private getCountdownSpawnOrder(): string[] {
    const list: string[] = [];
    for (const [id] of this.players) {
      if (this.matchState.getRenderInfo(id).eliminated) {
        continue;
      }
      list.push(id);
    }
    list.sort((a, b) => this.getPlayerSlot(a) - this.getPlayerSlot(b));
    return list;
  }

  /** Render-side: which player the camera should follow during the countdown. */
  getCountdownCameraTargetId(): string | null {
    if (this.roundStartCountdownTicks <= 0) {
      return null;
    }
    const order = this.getCountdownSpawnOrder();
    if (order.length === 0) {
      return null;
    }
    const stage = this.getCountdownStageIndex();
    const idx = Math.min(stage, order.length - 1);
    return order[idx];
  }

  /** Teleport `record` to its proper spawn point and wake it. */
  private placePlayerAtSpawn(record: PlayerCharacter): void {
    const spawnPoint = this.spawnPointForPlayer(record.id);
    record.body.setTranslation(
      { x: spawnPoint.x, y: spawnPoint.feetY + PLAYER_HALF_HEIGHT },
      true,
    );
    record.body.setLinvel({ x: 0, y: 0 }, true);
    record.body.sleep();
  }

  /** Park `record` far below the map until its countdown stage arrives. */
  private parkPlayerOffstage(record: PlayerCharacter): void {
    record.body.setTranslation(
      { x: 0, y: this.getOffstageSentinelY() },
      true,
    );
    record.body.setLinvel({ x: 0, y: 0 }, true);
    record.body.sleep();
  }

  /**
   * Each countdown tick, ensure every player whose slot is ≤ current stage is at
   * their spawn point. Idempotent — re-teleporting an already-on-stage player is
   * detected by checking their Y vs. the offstage sentinel.
   */
  private updateCountdownSpawns(): void {
    const order = this.getCountdownSpawnOrder();
    if (order.length === 0) {
      return;
    }
    const stage = this.getCountdownStageIndex();
    const sentinelY = this.getOffstageSentinelY();
    for (let i = 0; i <= stage && i < order.length; i += 1) {
      const record = this.players.get(order[i]);
      if (!record) {
        continue;
      }
      // Only teleport if the player is still parked offstage — avoids resetting
      // a body we already placed on a previous tick.
      if (record.body.translation().y <= sentinelY + 0.5) {
        this.placePlayerAtSpawn(record);
      }
    }
  }

  private startRoundStartCountdown(): void {
    this.roundStartCountdownTicks = ROUND_START_COUNTDOWN_TOTAL_TICKS;
    this.bullets.clear();

    const order = this.getCountdownSpawnOrder();
    const firstId = order[0];

    for (const [id, record] of this.players) {
      if (this.matchState.getRenderInfo(id).eliminated) {
        continue;
      }
      this.matchState.resetRespawnState(id);
      record.activeAttack = null;
      record.activeWeaponAttack = null;
      record.punchCooldownTicks = 0;
      record.health = record.maxHealth;
      if (id === firstId) {
        this.placePlayerAtSpawn(record);
      } else {
        this.parkPlayerOffstage(record);
      }
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

  private getRoundStartCountdownTicks(): number | null {
    return this.roundStartCountdownTicks > 0 ? this.roundStartCountdownTicks : null;
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
    record.damagePct = 0;
    const wasInLethal = record.inLethalLaunch;
    record.inLethalLaunch = false;
    this.syncLethalLaunchColliderState(record, wasInLethal);
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