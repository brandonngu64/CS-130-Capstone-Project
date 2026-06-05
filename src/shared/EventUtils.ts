import type { GameEvent } from '../shared/GameEvents';

/**
 * Event queue for buffering and processing events in order
 */
export class EventQueue {
  private queue: GameEvent[] = [];
  private processed = 0;

  enqueue(event: GameEvent): void {
    this.queue.push(event);
  }

  dequeue(): GameEvent | undefined {
    if (this.queue.length === 0) {
      return undefined;
    }
    const event = this.queue.shift()!;
    this.processed++;
    return event;
  }

  peekNext(): GameEvent | undefined {
    return this.queue[0];
  }

  clear(): void {
    this.queue = [];
  }

  size(): number {
    return this.queue.length;
  }

  getProcessedCount(): number {
    return this.processed;
  }

  drain(): GameEvent[] {
    const events = this.queue;
    this.queue = [];
    this.processed += events.length;
    return events;
  }
}

/**
 * Event dispatcher for pub/sub pattern
 */
export class EventDispatcher {
  private listeners = new Map<string, Set<(event: GameEvent) => void>>();

  on(eventType: string, listener: (event: GameEvent) => void): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener);

    // Return unsubscribe function
    return () => this.off(eventType, listener);
  }

  off(eventType: string, listener: (event: GameEvent) => void): void {
    const listeners = this.listeners.get(eventType);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  emit(event: GameEvent): void {
    // Emit to specific event type listeners
    const listeners = this.listeners.get(event.type);
    if (listeners) {
      for (const listener of listeners) {
        listener(event);
      }
    }

    // Emit to wildcard listeners
    const wildcardListeners = this.listeners.get('*');
    if (wildcardListeners) {
      for (const listener of wildcardListeners) {
        listener(event);
      }
    }
  }

  once(eventType: string, listener: (event: GameEvent) => void): () => void {
    const wrapper = (event: GameEvent) => {
      listener(event);
      this.off(eventType, wrapper);
    };
    return this.on(eventType, wrapper);
  }

  clear(): void {
    this.listeners.clear();
  }
}

/**
 * Event aggregator for batching related events
 */
export class EventAggregator {
  private events: GameEvent[] = [];
  private playerEventCounts = new Map<string, number>();

  addEvent(event: GameEvent): void {
    this.events.push(event);

    // Track events per player
    if ('playerId' in event) {
      const playerId = (event as any).playerId;
      this.playerEventCounts.set(playerId, (this.playerEventCounts.get(playerId) ?? 0) + 1);
    }
  }

  getEvents(): GameEvent[] {
    return [...this.events];
  }

  getPlayerEvents(playerId: string): GameEvent[] {
    return this.events.filter((e) => 'playerId' in e && (e as any).playerId === playerId);
  }

  getEventsByType(type: string): GameEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  getEventCount(): number {
    return this.events.length;
  }

  getPlayerEventCount(playerId: string): number {
    return this.playerEventCounts.get(playerId) ?? 0;
  }

  clear(): void {
    this.events = [];
    this.playerEventCounts.clear();
  }

  clearPlayerEvents(playerId: string): void {
    this.events = this.events.filter((e) => !('playerId' in e) || (e as any).playerId !== playerId);
    this.playerEventCounts.delete(playerId);
  }
}

/**
 * Event metrics collector for performance monitoring
 */
export class EventMetrics {
  private eventCounts = new Map<string, number>();
  private eventTimes = new Map<string, number[]>();
  private startTime = Date.now();

  recordEvent(event: GameEvent): void {
    const type = event.type;

    // Count
    this.eventCounts.set(type, (this.eventCounts.get(type) ?? 0) + 1);

    // Timing
    if (!this.eventTimes.has(type)) {
      this.eventTimes.set(type, []);
    }
    this.eventTimes.get(type)!.push(event.timestamp);
  }

  getEventCount(type?: string): number {
    if (type) {
      return this.eventCounts.get(type) ?? 0;
    }
    return Array.from(this.eventCounts.values()).reduce((a, b) => a + b, 0);
  }

  getEventsPerSecond(type?: string): number {
    const elapsed = (Date.now() - this.startTime) / 1000;
    if (elapsed === 0) return 0;
    return this.getEventCount(type) / elapsed;
  }

  getAverageTime(type: string): number {
    const times = this.eventTimes.get(type) ?? [];
    if (times.length === 0) return 0;

    if (times.length === 1) {
      return times[0];
    }

    const deltas = [];
    for (let i = 1; i < times.length; i++) {
      deltas.push(times[i] - times[i - 1]);
    }
    return deltas.reduce((a, b) => a + b, 0) / deltas.length;
  }

  getStatistics(): {
    eventType: string;
    count: number;
    avgTimeBetween: number;
    perSecond: number;
  }[] {
    const stats = [];
    for (const type of this.eventCounts.keys()) {
      stats.push({
        eventType: type,
        count: this.eventCounts.get(type) ?? 0,
        avgTimeBetween: this.getAverageTime(type),
        perSecond: this.getEventsPerSecond(type),
      });
    }
    return stats.sort((a, b) => b.count - a.count);
  }

  reset(): void {
    this.eventCounts.clear();
    this.eventTimes.clear();
    this.startTime = Date.now();
  }
}

/**
 * Event filter for selective processing
 */
export class EventFilter {
  private rules: Array<(event: GameEvent) => boolean> = [];

  addRule(rule: (event: GameEvent) => boolean): void {
    this.rules.push(rule);
  }

  addPlayerFilter(playerId: string): void {
    this.addRule((event) => 'playerId' in event && (event as any).playerId === playerId);
  }

  addTypeFilter(...types: string[]): void {
    const typeSet = new Set(types);
    this.addRule((event) => typeSet.has(event.type));
  }

  matches(event: GameEvent): boolean {
    return this.rules.every((rule) => rule(event));
  }

  filter(events: GameEvent[]): GameEvent[] {
    return events.filter((event) => this.matches(event));
  }

  clear(): void {
    this.rules = [];
  }
}

/**
 * Rate limiter for input or events
 */
export class RateLimiter {
  private lastEventTime = new Map<string, number>();
  private minInterval: number;

  constructor(minIntervalMs: number = 100) {
    this.minInterval = minIntervalMs;
  }

  canProcess(key: string): boolean {
    const now = Date.now();
    const last = this.lastEventTime.get(key) ?? 0;

    if (now - last >= this.minInterval) {
      this.lastEventTime.set(key, now);
      return true;
    }

    return false;
  }

  reset(key?: string): void {
    if (key) {
      this.lastEventTime.delete(key);
    } else {
      this.lastEventTime.clear();
    }
  }

  setInterval(intervalMs: number): void {
    this.minInterval = intervalMs;
  }
}

/**
 * Event sequencer for ensuring events are processed in correct order
 */
export class EventSequencer {
  private sequences = new Map<string, number>();
  private buffer: GameEvent[] = [];

  processEvent(event: GameEvent): GameEvent[] {
    const key = this.getSequenceKey(event);
    if (!key) {
      return [event];
    }

    const currentSeq = this.sequences.get(key) ?? 0;
    const expectedSeq = currentSeq + 1;

    // Event is in sequence
    if ((event as any).sequence === expectedSeq) {
      this.sequences.set(key, expectedSeq);

      const result = [event];

      // Check if any buffered events can now be processed
      let i = 0;
      while (i < this.buffer.length) {
        const buffered = this.buffer[i];
        const bufferedKey = this.getSequenceKey(buffered);
        if (bufferedKey === key && (buffered as any).sequence === this.sequences.get(key)! + 1) {
          this.sequences.set(key, (buffered as any).sequence);
          result.push(buffered);
          this.buffer.splice(i, 1);
        } else {
          i++;
        }
      }

      return result;
    }

    // Event is out of sequence - buffer it
    this.buffer.push(event);
    return [];
  }

  private getSequenceKey(event: GameEvent): string | null {
    if ('playerId' in event) {
      return `player:${(event as any).playerId}`;
    }
    return null;
  }

  getBufferSize(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.sequences.clear();
    this.buffer = [];
  }
}
