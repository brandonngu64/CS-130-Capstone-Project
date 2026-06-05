import type { GameEvent } from '../shared/GameEvents';
import type { ClientGameState, GameSnapshot } from './ClientGameState';
import type { GameEngine } from '../server/GameEngine';

/**
 * Debug console overlay for in-game debugging
 */
export class DebugConsole {
  private enabled = false;
  private logs: Array<{ time: number; level: string; message: string }> = [];
  private maxLogs = 100;

  log(message: string): void {
    this.addLog('LOG', message);
  }

  warn(message: string): void {
    this.addLog('WARN', message);
  }

  error(message: string): void {
    this.addLog('ERROR', message);
  }

  info(message: string): void {
    this.addLog('INFO', message);
  }

  private addLog(level: string, message: string): void {
    this.logs.push({
      time: Date.now(),
      level,
      message,
    });

    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    if (this.enabled) {
      console.log(`[${level}] ${message}`);
    }
  }

  getLogs(): Array<{ time: number; level: string; message: string }> {
    return [...this.logs];
  }

  clear(): void {
    this.logs = [];
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

/**
 * Event replayer for testing and debugging
 */
export class EventReplayer {
  private recordedEvents: GameEvent[] = [];
  private isRecording = false;
  private isReplaying = false;
  private replayIndex = 0;

  startRecording(): void {
    this.isRecording = true;
    this.recordedEvents = [];
    console.log('Started recording events');
  }

  stopRecording(): void {
    this.isRecording = false;
    console.log(`Stopped recording: ${this.recordedEvents.length} events recorded`);
  }

  recordEvent(event: GameEvent): void {
    if (this.isRecording) {
      this.recordedEvents.push(event);
    }
  }

  startReplay(): void {
    this.isReplaying = true;
    this.replayIndex = 0;
    console.log('Started replaying events');
  }

  stopReplay(): void {
    this.isReplaying = false;
    this.replayIndex = 0;
    console.log('Stopped replaying');
  }

  getNextEvent(): GameEvent | null {
    if (!this.isReplaying || this.replayIndex >= this.recordedEvents.length) {
      this.stopReplay();
      return null;
    }

    return this.recordedEvents[this.replayIndex++];
  }

  exportEvents(): string {
    return JSON.stringify(this.recordedEvents, null, 2);
  }

  importEvents(jsonString: string): boolean {
    try {
      this.recordedEvents = JSON.parse(jsonString);
      console.log(`Imported ${this.recordedEvents.length} events`);
      return true;
    } catch (error) {
      console.error('Failed to import events:', error);
      return false;
    }
  }

  isRecordingActive(): boolean {
    return this.isRecording;
  }

  isReplayingActive(): boolean {
    return this.isReplaying;
  }

  getRecordedEventCount(): number {
    return this.recordedEvents.length;
  }
}

/**
 * Network simulator for testing lag, packet loss, etc.
 */
export class NetworkSimulator {
  private latency = 50; // ms
  private packetLoss = 0; // percentage (0-1)
  private enabled = false;

  simulate<T>(fn: () => T, delay?: number): Promise<T> {
    const actualDelay = delay ?? this.latency;

    if (!this.enabled) {
      return Promise.resolve(fn());
    }

    // Simulate packet loss
    if (Math.random() < this.packetLoss) {
      return Promise.reject(new Error('Simulated packet loss'));
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(fn());
      }, actualDelay);
    });
  }

  setLatency(ms: number): void {
    this.latency = ms;
  }

  setPacketLoss(percentage: number): void {
    this.packetLoss = Math.max(0, Math.min(1, percentage));
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  getStats(): { latency: number; packetLoss: number; enabled: boolean } {
    return {
      latency: this.latency,
      packetLoss: this.packetLoss,
      enabled: this.enabled,
    };
  }
}

/**
 * Performance profiler
 */
export class PerformanceProfiler {
  private markers = new Map<string, number>();
  private measurements: Array<{ name: string; duration: number }> = [];
  private maxMeasurements = 1000;

  mark(name: string): void {
    this.markers.set(name, performance.now());
  }

  measure(name: string, startMark: string, endMark?: string): void {
    const endTime = endMark ? this.markers.get(endMark) : performance.now();
    const startTime = this.markers.get(startMark);

    if (startTime === undefined || endTime === undefined) {
      console.warn(`Invalid markers for measurement: ${startMark} -> ${endMark}`);
      return;
    }

    const duration = endTime - startTime;
    this.measurements.push({ name, duration });

    if (this.measurements.length > this.maxMeasurements) {
      this.measurements.shift();
    }
  }

  getAverage(name: string): number {
    const times = this.measurements.filter((m) => m.name === name).map((m) => m.duration);

    if (times.length === 0) return 0;
    return times.reduce((a, b) => a + b, 0) / times.length;
  }

  getMax(name: string): number {
    const times = this.measurements.filter((m) => m.name === name).map((m) => m.duration);
    return times.length > 0 ? Math.max(...times) : 0;
  }

  getMin(name: string): number {
    const times = this.measurements.filter((m) => m.name === name).map((m) => m.duration);
    return times.length > 0 ? Math.min(...times) : 0;
  }

  getReport(): string {
    const unique = new Set(this.measurements.map((m) => m.name));
    const report: string[] = [];

    for (const name of unique) {
      const avg = this.getAverage(name);
      const max = this.getMax(name);
      const min = this.getMin(name);
      report.push(`${name}: avg=${avg.toFixed(2)}ms, min=${min.toFixed(2)}ms, max=${max.toFixed(2)}ms`);
    }

    return report.join('\n');
  }

  clear(): void {
    this.markers.clear();
    this.measurements = [];
  }
}

/**
 * Game state validator
 */
export class GameStateValidator {
  validate(snapshot: GameSnapshot): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check tick is non-negative
    if (snapshot.tick < 0) {
      errors.push('Negative tick value');
    }

    // Check players
    for (const [playerId, player] of snapshot.players) {
      if (!playerId) {
        errors.push('Player with empty ID');
      }

      if (player.health < 0 || player.health > player.maxHealth) {
        errors.push(`Player ${playerId}: invalid health ${player.health}/${player.maxHealth}`);
      }

      if (player.stocks < 0) {
        errors.push(`Player ${playerId}: negative stocks`);
      }

      if (!isFinite(player.x) || !isFinite(player.y)) {
        errors.push(`Player ${playerId}: invalid position`);
      }

      if (!isFinite(player.vx) || !isFinite(player.vy)) {
        errors.push(`Player ${playerId}: invalid velocity`);
      }
    }

    // Check projectiles
    for (const [id, projectile] of snapshot.projectiles) {
      if (id < 0) {
        errors.push('Projectile with negative ID');
      }

      if (!isFinite(projectile.x) || !isFinite(projectile.y)) {
        errors.push(`Projectile ${id}: invalid position`);
      }

      if (!isFinite(projectile.vx) || !isFinite(projectile.vy)) {
        errors.push(`Projectile ${id}: invalid velocity`);
      }
    }

    // Check items
    for (const [id, item] of snapshot.items) {
      if (id < 0) {
        errors.push('Item with negative ID');
      }

      if (!isFinite(item.x) || !isFinite(item.y)) {
        errors.push(`Item ${id}: invalid position`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  validateEvent(event: GameEvent): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!event.type) {
      errors.push('Event missing type');
    }

    if (event.tick < 0) {
      errors.push('Event has negative tick');
    }

    if (event.timestamp < 0) {
      errors.push('Event has negative timestamp');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

/**
 * Debug overlay for in-game display
 */
export class DebugOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private enabled = false;
  private debugInfo: Record<string, string | number> = {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context from canvas');
    }
    this.ctx = ctx;
  }

  setInfo(key: string, value: string | number): void {
    this.debugInfo[key] = value;
  }

  render(): void {
    if (!this.enabled) {
      return;
    }

    const ctx = this.ctx;
    const padding = 10;
    const lineHeight = 20;
    let y = padding;

    // Semi-transparent background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, 300, Object.keys(this.debugInfo).length * lineHeight + padding * 2);

    ctx.fillStyle = '#00ff00';
    ctx.font = '12px monospace';

    for (const [key, value] of Object.entries(this.debugInfo)) {
      ctx.fillText(`${key}: ${value}`, padding, y + lineHeight);
      y += lineHeight;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  clear(): void {
    this.debugInfo = {};
  }
}
