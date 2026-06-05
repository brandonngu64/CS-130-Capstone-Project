import * as RAPIER from '@dimforge/rapier2d-compat';
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
  GUN_FIRE_COOLDOWN_TICKS,
  JUMP_SPEED,
  MOVE_SPEED,
  PLAYER_COLOR_PALETTE,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  PLAYER_MAX_HEALTH,
  PLAYER_SPAWN_Y,
} from '../client/constants';
import { AttackKind, getAttackDefinition } from '../client/attacks';
import { ItemKind } from '../client/items';
import type { MapColliderRect, TiledMapDefinition } from '../client/tiledMap';
import type { GameEvent } from '../shared/GameEvents';
import {
  PlayerSpawnedEvent,
  PlayerMovedEvent,
  PlayerDamagedEvent,
  PlayerDiedEvent,
  PlayerRespawnedEvent,
  GameStateUpdateEvent,
} from '../shared/GameEvents';

interface ServerPlayerState {
  id: string;
  body: RAPIER.RigidBody;
  health: number;
  maxHealth: number;
  stocks: number;
  respawning: boolean;
  respawnTicksRemaining: number;
  dashTicksRemaining: number;
  dashCooldownTicks: number;
  gunFireCooldownTicks: number;
  facing: number;
  heldItem: ItemKind | null;
  heldItemExpiryTick: number;
  color: number;
  eliminated: boolean;
  lastInputTick: number;
}

interface ServerProjectile {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ticksRemaining: number;
  damage: number;
  ownerPlayerId: string;
}

interface ServerItem {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  ticksRemaining: number;
}

export class ServerGameEngine {
  private world: RAPIER.World;
  private map: TiledMapDefinition;
  private players = new Map<string, ServerPlayerState>();
  private projectiles = new Map<number, ServerProjectile>();
  private items = new Map<number, ServerItem>();
  private staticColliders = new Set<number>();
  private tickCount = 0;
  private nextProjectileId = 1;
  private nextItemId = 1;
  private readonly eventQueue: GameEvent[] = [];
  private itemSpawnCounter = 0;

  constructor(map: TiledMapDefinition) {
    this.map = map;
    this.world = new RAPIER.World({ x: 0, y: GRAVITY_Y });
    this.world.timestep = FIXED_STEP_SECONDS;
    this.setupStaticLevel();
  }

  private setupStaticLevel(): void {
    // Create ground
    const groundShape = new RAPIER.Cuboid(500, 1);
    const groundBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, FLOOR_Y),
    );
    this.world.createCollider(groundShape, groundBody);
    this.staticColliders.add(groundBody.handle);

    // Setup colliders from tiled map
    if (this.map.colliders) {
      for (const collider of this.map.colliders) {
        this.createMapCollider(collider);
      }
    }
  }

  private createMapCollider(collider: MapColliderRect): void {
    const width = collider.width / 2;
    const height = collider.height / 2;
    const x = collider.x + width;
    const y = collider.y + height;

    const shape = new RAPIER.Cuboid(width, height);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y),
    );
    this.world.createCollider(shape, body);
    this.staticColliders.add(body.handle);
  }

  addPlayer(playerId: string, colorIndex: number): void {
    if (this.players.has(playerId)) {
      return;
    }

    const spawnX = colorIndex * 5;
    const spawnY = PLAYER_SPAWN_Y;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawnX, spawnY)
      .setCan_sleep(false);
    const body = this.world.createRigidBody(bodyDesc);

    const shape = new RAPIER.Cuboid(PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT);
    this.world.createCollider(shape, body);

    const player: ServerPlayerState = {
      id: playerId,
      body,
      health: PLAYER_MAX_HEALTH,
      maxHealth: PLAYER_MAX_HEALTH,
      stocks: 3,
      respawning: false,
      respawnTicksRemaining: 0,
      dashTicksRemaining: 0,
      dashCooldownTicks: 0,
      gunFireCooldownTicks: 0,
      facing: 1,
      heldItem: null,
      heldItemExpiryTick: 0,
      color: PLAYER_COLOR_PALETTE[colorIndex % PLAYER_COLOR_PALETTE.length],
      eliminated: false,
      lastInputTick: 0,
    };

    this.players.set(playerId, player);

    const event: PlayerSpawnedEvent = {
      type: 'player_spawned',
      timestamp: Date.now(),
      tick: this.tickCount,
      playerId,
      x: spawnX,
      y: spawnY,
      color: player.color,
    };
    this.eventQueue.push(event);
  }

  removePlayer(playerId: string): void {
    const player = this.players.get(playerId);
    if (player) {
      this.world.removeRigidBody(player.body);
      this.players.delete(playerId);
    }
  }

  processPlayerInput(
    playerId: string,
    tick: number,
    actions: {
      moveLeft: boolean;
      moveRight: boolean;
      jump: boolean;
      duck: boolean;
      punch: boolean;
      dash: boolean;
      shoot: boolean;
    },
  ): void {
    const player = this.players.get(playerId);
    if (!player || player.eliminated) {
      return;
    }

    // Handle movement
    let targetVx = 0;
    if (actions.moveLeft) {
      targetVx -= MOVE_SPEED;
      player.facing = -1;
    }
    if (actions.moveRight) {
      targetVx += MOVE_SPEED;
      player.facing = 1;
    }

    const currentVel = player.body.linvel();
    player.body.setLinvel({ x: targetVx, y: currentVel.y }, true);

    // Handle jump
    if (actions.jump && this.isPlayerGrounded(player)) {
      player.body.applyImpulse({ x: 0, y: JUMP_SPEED }, true);
    }

    // Handle dash
    if (actions.dash && player.dashCooldownTicks === 0 && player.dashTicksRemaining === 0) {
      player.dashTicksRemaining = DASH_DURATION_TICKS;
      player.dashCooldownTicks = DASH_COOLDOWN_TICKS;
      const dashDirection = actions.moveLeft ? -1 : actions.moveRight ? 1 : player.facing;
      const dashVel = { x: dashDirection * DASH_SPEED, y: 0 };
      player.body.setLinvel(dashVel, true);
    }

    // Handle punch attack
    if (actions.punch) {
      this.handlePlayerAttack(player, AttackKind.PUNCH);
    }

    // Handle shoot
    if (actions.shoot) {
      this.handlePlayerShoot(player);
    }

    player.lastInputTick = tick;
  }

  private isPlayerGrounded(player: ServerPlayerState): boolean {
    const translation = player.body.translation();
    const rayOrigin = { x: translation.x, y: translation.y + PLAYER_HALF_HEIGHT + 0.02 };
    const rayDir = { x: 0, y: 1 };
    const rayLength = 0.25;

    let hit = false;
    this.world.castRay(
      rayOrigin,
      rayDir,
      rayLength,
      true,
      (_collider, _intersection) => {
        hit = true;
        return false;
      },
    );

    return hit;
  }

  private handlePlayerAttack(player: ServerPlayerState, attackKind: AttackKind): void {
    const attackDef = getAttackDefinition(attackKind);
    if (!attackDef) {
      return;
    }

    const translation = player.body.translation();
    const attackX = translation.x + player.facing * attackDef.offsetX;
    const attackY = translation.y + attackDef.offsetY;

    // Create attack hitbox
    const attackShape = new RAPIER.Cuboid(attackDef.width / 2, attackDef.height / 2);
    const attackBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematic().setTranslation(attackX, attackY),
    );
    this.world.createCollider(attackShape, attackBody);

    // Check for hits
    const shapeIter = this.world.intersectionsWithShape(
      attackBody.translation(),
      &attackBody.rotation(),
      &attackShape,
    );
    for (const contact of shapeIter) {
      const otherCollider = this.world.getCollider(contact.collider2);
      if (otherCollider) {
        const otherBody = otherCollider.parent();
        if (otherBody) {
          const targetPlayer = Array.from(this.players.values()).find(
            (p) => p.body.handle === otherBody.handle,
          );
          if (targetPlayer && targetPlayer.id !== player.id) {
            this.damagePlayer(targetPlayer, attackDef.damage, player.id);
          }
        }
      }
    }

    this.world.removeRigidBody(attackBody);
  }

  private handlePlayerShoot(player: ServerPlayerState): void {
    if (player.gunFireCooldownTicks > 0) {
      return;
    }

    const translation = player.body.translation();
    const bulletX = translation.x + player.facing * PLAYER_HALF_WIDTH;
    const bulletY = translation.y;
    const bulletVx = player.facing * BULLET_SPEED;

    const projectile: ServerProjectile = {
      id: this.nextProjectileId++,
      x: bulletX,
      y: bulletY,
      vx: bulletVx,
      vy: 0,
      ticksRemaining: BULLET_LIFETIME_TICKS,
      damage: 10,
      ownerPlayerId: player.id,
    };

    this.projectiles.set(projectile.id, projectile);
    player.gunFireCooldownTicks = GUN_FIRE_COOLDOWN_TICKS;
  }

  private damagePlayer(
    player: ServerPlayerState,
    damage: number,
    sourcePlayerId: string,
  ): void {
    player.health = Math.max(0, player.health - damage);

    const event: PlayerDamagedEvent = {
      type: 'player_damaged',
      timestamp: Date.now(),
      tick: this.tickCount,
      playerId: player.id,
      damageAmount: damage,
      currentHealth: player.health,
      sourcePlayerId,
    };
    this.eventQueue.push(event);

    if (player.health <= 0) {
      this.killPlayer(player);
    }
  }

  private killPlayer(player: ServerPlayerState): void {
    player.stocks = Math.max(0, player.stocks - 1);

    const event: PlayerDiedEvent = {
      type: 'player_died',
      timestamp: Date.now(),
      tick: this.tickCount,
      playerId: player.id,
      stocks: player.stocks,
    };
    this.eventQueue.push(event);

    if (player.stocks > 0) {
      player.respawning = true;
      player.respawnTicksRemaining = 120;
      player.health = PLAYER_MAX_HEALTH;
    } else {
      player.eliminated = true;
    }
  }

  tick(): GameEvent[] {
    this.eventQueue.length = 0;

    // Step physics
    this.world.step();

    // Update player states
    for (const player of this.players.values()) {
      // Update timers
      if (player.dashTicksRemaining > 0) {
        player.dashTicksRemaining--;
      }
      if (player.dashCooldownTicks > 0) {
        player.dashCooldownTicks--;
      }
      if (player.gunFireCooldownTicks > 0) {
        player.gunFireCooldownTicks--;
      }

      // Handle respawn
      if (player.respawning) {
        player.respawnTicksRemaining--;
        if (player.respawnTicksRemaining <= 0) {
          player.respawning = false;
          const translation = player.body.translation();
          const event: PlayerRespawnedEvent = {
            type: 'player_respawned',
            timestamp: Date.now(),
            tick: this.tickCount,
            playerId: player.id,
            x: translation.x,
            y: translation.y,
          };
          this.eventQueue.push(event);
        }
      }

      // Check for out of bounds
      const translation = player.body.translation();
      if (
        translation.x < -BLAST_ZONE_SIDE_OFFSET ||
        translation.x > BLAST_ZONE_SIDE_OFFSET ||
        translation.y > BLAST_ZONE_DOWN_OFFSET ||
        translation.y < -BLAST_ZONE_UP_OFFSET
      ) {
        this.killPlayer(player);
      }

      // Emit position update
      const vel = player.body.linvel();
      const event: PlayerMovedEvent = {
        type: 'player_moved',
        timestamp: Date.now(),
        tick: this.tickCount,
        playerId: player.id,
        x: translation.x,
        y: translation.y,
        vx: vel.x,
        vy: vel.y,
        facing: player.facing,
      };
      this.eventQueue.push(event);
    }

    // Update projectiles
    const expiredProjectiles: number[] = [];
    for (const [projectileId, projectile] of this.projectiles) {
      projectile.x += projectile.vx * FIXED_STEP_SECONDS;
      projectile.y += projectile.vy * FIXED_STEP_SECONDS;
      projectile.ticksRemaining--;

      if (projectile.ticksRemaining <= 0) {
        expiredProjectiles.push(projectileId);
      }
    }

    for (const projectileId of expiredProjectiles) {
      this.projectiles.delete(projectileId);
    }

    // Emit full state snapshot periodically
    if (this.tickCount % 5 === 0) {
      this.emitGameStateSnapshot();
    }

    this.tickCount++;
    return this.eventQueue;
  }

  private emitGameStateSnapshot(): void {
    const players = Array.from(this.players.values()).map((player) => {
      const translation = player.body.translation();
      const vel = player.body.linvel();
      return {
        id: player.id,
        x: translation.x,
        y: translation.y,
        vx: vel.x,
        vy: vel.y,
        health: player.health,
        maxHealth: player.maxHealth,
        stocks: player.stocks,
        facing: player.facing,
        eliminated: player.eliminated,
        color: player.color,
        heldItem: player.heldItem,
      };
    });

    const projectiles = Array.from(this.projectiles.values()).map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
    }));

    const items = Array.from(this.items.values()).map((i) => ({
      id: i.id,
      kind: i.kind,
      x: i.x,
      y: i.y,
    }));

    const event: GameStateUpdateEvent = {
      type: 'game_state_update',
      timestamp: Date.now(),
      tick: this.tickCount,
      players,
      projectiles,
      items,
    };
    this.eventQueue.push(event);
  }

  getPlayers(): ServerPlayerState[] {
    return Array.from(this.players.values());
  }

  getProjectiles(): ServerProjectile[] {
    return Array.from(this.projectiles.values());
  }

  getItems(): ServerItem[] {
    return Array.from(this.items.values());
  }

  getTick(): number {
    return this.tickCount;
  }
}
