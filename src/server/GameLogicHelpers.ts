import * as RAPIER from '@dimforge/rapier2d-compat';

/**
 * Collision detection helper for server-side physics
 */
export class CollisionHelper {
  /**
   * Check if two rectangles overlap
   */
  static rectanglesOverlap(
    x1: number,
    y1: number,
    w1: number,
    h1: number,
    x2: number,
    y2: number,
    w2: number,
    h2: number,
  ): boolean {
    return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
  }

  /**
   * Check if point is inside rectangle
   */
  static pointInRectangle(
    px: number,
    py: number,
    x: number,
    y: number,
    w: number,
    h: number,
  ): boolean {
    return px >= x && px <= x + w && py >= y && py <= y + h;
  }

  /**
   * Check if point is inside circle
   */
  static pointInCircle(px: number, py: number, cx: number, cy: number, r: number): boolean {
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy <= r * r;
  }

  /**
   * Calculate distance between two points
   */
  static distance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Calculate knockback vector
   */
  static calculateKnockback(
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
    force: number,
  ): { x: number; y: number } {
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist === 0) {
      return { x: force, y: 0 };
    }

    return {
      x: (dx / dist) * force,
      y: (dy / dist) * force,
    };
  }
}

/**
 * Damage calculation helper
 */
export class DamageCalculator {
  /**
   * Calculate damage with modifiers
   */
  static calculateDamage(baseDamage: number, modifiers: DamageModifiers = {}): number {
    let damage = baseDamage;

    if (modifiers.critical) {
      damage *= 1.5;
    }

    if (modifiers.multiplier) {
      damage *= modifiers.multiplier;
    }

    if (modifiers.reduction) {
      damage *= 1 - modifiers.reduction;
    }

    if (modifiers.flat) {
      damage += modifiers.flat;
    }

    return Math.max(0, Math.floor(damage));
  }

  /**
   * Check if damage should be fatal
   */
  static isFatal(currentHealth: number, damage: number): boolean {
    return currentHealth - damage <= 0;
  }

  /**
   * Calculate overkill damage
   */
  static getOverkillDamage(currentHealth: number, damage: number): number {
    return Math.max(0, damage - currentHealth);
  }
}

interface DamageModifiers {
  critical?: boolean;
  multiplier?: number;
  reduction?: number;
  flat?: number;
}

/**
 * Spawning helper for game entities
 */
export class SpawningHelper {
  /**
   * Get random spawn point from options
   */
  static randomSpawnPoint(
    spawnPoints: Array<{ x: number; y: number }>,
  ): { x: number; y: number } | null {
    if (spawnPoints.length === 0) {
      return null;
    }

    return spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
  }

  /**
   * Get least-crowded spawn point
   */
  static getLeastCrowdedSpawn(
    spawnPoints: Array<{ x: number; y: number }>,
    existingPositions: Array<{ x: number; y: number }>,
    minimumDistance: number = 5,
  ): { x: number; y: number } | null {
    let bestSpawn = null;
    let maxMinDistance = -Infinity;

    for (const spawn of spawnPoints) {
      let minDist = Infinity;

      for (const existing of existingPositions) {
        const dx = spawn.x - existing.x;
        const dy = spawn.y - existing.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        minDist = Math.min(minDist, dist);
      }

      if (minDist > maxMinDistance && minDist >= minimumDistance) {
        maxMinDistance = minDist;
        bestSpawn = spawn;
      }
    }

    return bestSpawn ?? spawnPoints[0];
  }
}

/**
 * Physics state snapshot for rollback (if needed)
 */
export interface PhysicsSnapshot {
  tick: number;
  entities: Array<{
    id: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
  }>;
}

/**
 * State validator for anti-cheat
 */
export class StateValidator {
  /**
   * Check if player input is valid for current state
   */
  static isValidInput(
    playerX: number,
    playerY: number,
    inputX?: number,
    inputY?: number,
    maxDistance: number = 5,
  ): boolean {
    // Check that player hasn't teleported too far
    if (inputX !== undefined && inputY !== undefined) {
      const dx = Math.abs(playerX - inputX);
      const dy = Math.abs(playerY - inputY);
      return dx <= maxDistance && dy <= maxDistance;
    }

    return true;
  }

  /**
   * Check if velocity is reasonable
   */
  static isReasonableVelocity(
    vx: number,
    vy: number,
    maxSpeed: number = 20,
  ): boolean {
    const speed = Math.sqrt(vx * vx + vy * vy);
    return speed <= maxSpeed * 1.5; // Allow 50% overage for acceleration
  }

  /**
   * Check for impossible state transitions
   */
  static isValidStateTransition(from: string, to: string): boolean {
    const validTransitions: Record<string, string[]> = {
      idle: ['moving', 'jumping', 'attacking', 'dead'],
      moving: ['idle', 'jumping', 'attacking', 'dead'],
      jumping: ['idle', 'moving', 'attacking', 'dead'],
      attacking: ['idle', 'moving', 'jumping', 'dead'],
      dead: ['respawning'],
      respawning: ['idle'],
    };

    return validTransitions[from]?.includes(to) ?? false;
  }

  /**
   * Check player integrity (health, position, etc.)
   */
  static isValidPlayerState(
    health: number,
    maxHealth: number,
    x: number,
    y: number,
    mapBounds: { minX: number; maxX: number; minY: number; maxY: number },
  ): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Health check
    if (health < 0 || health > maxHealth) {
      issues.push(`Invalid health: ${health}/${maxHealth}`);
    }

    // Position check
    if (x < mapBounds.minX || x > mapBounds.maxX) {
      issues.push(`Player X out of bounds: ${x}`);
    }

    if (y < mapBounds.minY || y > mapBounds.maxY) {
      issues.push(`Player Y out of bounds: ${y}`);
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}

/**
 * Game timing utilities
 */
export class GameTimer {
  private startTime: number;
  private paused: boolean = false;
  private pausedTime: number = 0;

  constructor() {
    this.startTime = Date.now();
  }

  getElapsed(): number {
    if (this.paused) {
      return this.pausedTime;
    }
    return Date.now() - this.startTime;
  }

  pause(): void {
    if (!this.paused) {
      this.pausedTime = this.getElapsed();
      this.paused = true;
    }
  }

  resume(): void {
    if (this.paused) {
      this.startTime = Date.now() - this.pausedTime;
      this.paused = false;
    }
  }

  reset(): void {
    this.startTime = Date.now();
    this.pausedTime = 0;
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }
}

/**
 * Match state tracker
 */
export interface MatchStats {
  totalDamageDealt: Map<string, number>;
  damageDealtTo: Map<string, Map<string, number>>;
  kills: Map<string, number>;
  deaths: Map<string, number>;
  knockouts: Map<string, number>;
}

export class MatchTracker {
  private stats: MatchStats = {
    totalDamageDealt: new Map(),
    damageDealtTo: new Map(),
    kills: new Map(),
    deaths: new Map(),
    knockouts: new Map(),
  };

  recordDamage(source: string, target: string, damage: number): void {
    // Total damage
    this.stats.totalDamageDealt.set(source, (this.stats.totalDamageDealt.get(source) ?? 0) + damage);

    // Damage dealt to specific target
    if (!this.stats.damageDealtTo.has(source)) {
      this.stats.damageDealtTo.set(source, new Map());
    }
    const targetMap = this.stats.damageDealtTo.get(source)!;
    targetMap.set(target, (targetMap.get(target) ?? 0) + damage);
  }

  recordKill(killer: string, victim: string): void {
    this.stats.kills.set(killer, (this.stats.kills.get(killer) ?? 0) + 1);
    this.stats.deaths.set(victim, (this.stats.deaths.get(victim) ?? 0) + 1);
  }

  recordKnockout(source: string): void {
    this.stats.knockouts.set(source, (this.stats.knockouts.get(source) ?? 0) + 1);
  }

  getStats(): MatchStats {
    return this.stats;
  }

  getPlayerStats(playerId: string): {
    damageDealt: number;
    kills: number;
    deaths: number;
    knockouts: number;
  } {
    return {
      damageDealt: this.stats.totalDamageDealt.get(playerId) ?? 0,
      kills: this.stats.kills.get(playerId) ?? 0,
      deaths: this.stats.deaths.get(playerId) ?? 0,
      knockouts: this.stats.knockouts.get(playerId) ?? 0,
    };
  }

  reset(): void {
    this.stats = {
      totalDamageDealt: new Map(),
      damageDealtTo: new Map(),
      kills: new Map(),
      deaths: new Map(),
      knockouts: new Map(),
    };
  }
}
