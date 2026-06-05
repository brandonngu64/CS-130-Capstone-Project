import type { InputState } from './LocalInputManager';
import type { PlayerState } from './ClientGameState';

/**
 * Client-side prediction for smoother local player movement
 * This predicts the local player's movement based on input before receiving server confirmation
 */
export class ClientPrediction {
  /**
   * Predict player position based on velocity and time delta
   */
  static predictPosition(
    x: number,
    y: number,
    vx: number,
    vy: number,
    deltaTime: number,
  ): { x: number; y: number } {
    return {
      x: x + vx * deltaTime,
      y: y + vy * deltaTime,
    };
  }

  /**
   * Predict velocity based on acceleration
   */
  static predictVelocity(vx: number, vy: number, ax: number, ay: number, deltaTime: number): {
    x: number;
    y: number;
  } {
    return {
      x: vx + ax * deltaTime,
      y: vy + ay * deltaTime,
    };
  }

  /**
   * Apply movement input to velocity
   */
  static applyMovementInput(
    vx: number,
    maxSpeed: number,
    moveLeft: boolean,
    moveRight: boolean,
  ): number {
    let newVx = vx;

    if (moveLeft) {
      newVx = Math.max(newVx - 2, -maxSpeed);
    }
    if (moveRight) {
      newVx = Math.min(newVx + 2, maxSpeed);
    }

    // Natural deceleration
    if (!moveLeft && !moveRight) {
      newVx *= 0.9;
      if (Math.abs(newVx) < 0.1) {
        newVx = 0;
      }
    }

    return newVx;
  }

  /**
   * Interpolate between two positions
   */
  static interpolate(
    from: { x: number; y: number },
    to: { x: number; y: number },
    t: number, // 0 to 1
  ): { x: number; y: number } {
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    };
  }

  /**
   * Smooth interpolation (easing)
   */
  static smoothstep(t: number): number {
    return t * t * (3 - 2 * t);
  }

  /**
   * Catmull-Rom interpolation for smooth curves
   */
  static catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const v0 = (p2 - p0) * 0.5;
    const v1 = (p3 - p1) * 0.5;
    const t2 = t * t;
    const t3 = t * t2;

    return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
  }
}

/**
 * Reconciliation between predicted and server state
 */
export class StateReconciliation {
  private localStates: Array<{ tick: number; state: PlayerState }> = [];
  private serverStates: Array<{ tick: number; state: PlayerState }> = [];
  private lastServerTick = 0;

  addLocalState(tick: number, state: PlayerState): void {
    // Keep only recent local states (last 10 ticks)
    this.localStates.push({ tick, state });
    if (this.localStates.length > 10) {
      this.localStates.shift();
    }
  }

  addServerState(tick: number, state: PlayerState): void {
    this.serverStates.push({ tick, state });
    this.lastServerTick = tick;

    // Keep only recent server states
    if (this.serverStates.length > 10) {
      this.serverStates.shift();
    }
  }

  /**
   * Check if there's a desync and get correction vector
   */
  getCorrection(
    localState: PlayerState,
    serverState: PlayerState,
  ): { x: number; y: number; magnitude: number } {
    const dx = serverState.x - localState.x;
    const dy = serverState.y - localState.y;
    const magnitude = Math.sqrt(dx * dx + dy * dy);

    return { x: dx, y: dy, magnitude };
  }

  /**
   * Reconcile local state with server state (smooth correction)
   */
  reconcile(
    localState: PlayerState,
    serverState: PlayerState,
    maxCorrectionPerFrame: number = 0.5,
  ): PlayerState {
    const correction = this.getCorrection(localState, serverState);

    // If desync is small, ignore it (within error tolerance)
    if (correction.magnitude < 0.1) {
      return localState;
    }

    // Apply partial correction
    const correctionScale = Math.min(1, maxCorrectionPerFrame / (correction.magnitude + 0.001));

    return {
      ...localState,
      x: localState.x + correction.x * correctionScale,
      y: localState.y + correction.y * correctionScale,
    };
  }

  /**
   * Get interpolated state for rendering
   */
  getInterpolatedState(
    currentState: PlayerState,
    nextState: PlayerState | null,
    interpolationAlpha: number,
  ): PlayerState {
    if (!nextState) {
      return currentState;
    }

    return {
      ...currentState,
      x: ClientPrediction.interpolate(
        { x: currentState.x, y: 0 },
        { x: nextState.x, y: 0 },
        interpolationAlpha,
      ).x,
      y: ClientPrediction.interpolate(
        { x: 0, y: currentState.y },
        { x: 0, y: nextState.y },
        interpolationAlpha,
      ).y,
      vx: currentState.vx + (nextState.vx - currentState.vx) * interpolationAlpha,
      vy: currentState.vy + (nextState.vy - currentState.vy) * interpolationAlpha,
    };
  }

  clear(): void {
    this.localStates = [];
    this.serverStates = [];
    this.lastServerTick = 0;
  }
}

/**
 * Lag compensation / lead target prediction
 */
export class LagCompensation {
  private estimatedLatency = 100; // ms
  private latencySamples: number[] = [];

  recordLatency(latency: number): void {
    this.latencySamples.push(latency);
    if (this.latencySamples.length > 30) {
      this.latencySamples.shift();
    }

    // Update estimated latency (average of recent samples)
    this.estimatedLatency =
      this.latencySamples.reduce((a, b) => a + b, 0) / this.latencySamples.length;
  }

  getEstimatedLatency(): number {
    return this.estimatedLatency;
  }

  /**
   * Predict where a moving target will be by the time a projectile reaches it
   */
  predictTargetPosition(
    targetX: number,
    targetY: number,
    targetVx: number,
    targetVy: number,
  ): { x: number; y: number } {
    const predictionTime = this.estimatedLatency / 1000; // Convert to seconds

    return {
      x: targetX + targetVx * predictionTime,
      y: targetY + targetVy * predictionTime,
    };
  }

  /**
   * Get aim lead based on target velocity and latency
   */
  getAimLead(
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
    targetVx: number,
    targetVy: number,
    projectileSpeed: number,
  ): { x: number; y: number } | null {
    // Calculate position where target will be when projectile arrives
    const predictedPos = this.predictTargetPosition(targetX, targetY, targetVx, targetVy);

    // Calculate distance to predicted position
    const dx = predictedPos.x - sourceX;
    const dy = predictedPos.y - sourceY;
    const distToTarget = Math.sqrt(dx * dx + dy * dy);

    // Calculate time for projectile to reach target
    const timeToHit = distToTarget / projectileSpeed;

    if (timeToHit <= 0) {
      return null;
    }

    // Refine prediction for more accuracy (iterative)
    let refineX = predictedPos.x;
    let refineY = predictedPos.y;

    for (let i = 0; i < 2; i++) {
      const refinedDx = refineX - sourceX;
      const refinedDy = refineY - sourceY;
      const refinedDist = Math.sqrt(refinedDx * refinedDx + refinedDy * refinedDy);
      const refinedTime = refinedDist / projectileSpeed;

      refineX = targetX + targetVx * refinedTime;
      refineY = targetY + targetVy * refinedTime;
    }

    return {
      x: refineX,
      y: refineY,
    };
  }

  clear(): void {
    this.latencySamples = [];
    this.estimatedLatency = 100;
  }
}

/**
 * Network state synchronization helper
 */
export class NetworkSync {
  private lastAckedTick = 0;
  private lastSentTick = 0;
  private ticksInFlight = 0;

  recordSentInput(tick: number): void {
    this.lastSentTick = tick;
    this.ticksInFlight++;
  }

  recordAcknowledgment(tick: number): void {
    if (tick >= this.lastAckedTick) {
      this.lastAckedTick = tick;
      this.ticksInFlight = Math.max(0, this.ticksInFlight - 1);
    }
  }

  getTicksInFlight(): number {
    return this.ticksInFlight;
  }

  isAcked(tick: number): boolean {
    return tick <= this.lastAckedTick;
  }

  shouldBuffer(tick: number): boolean {
    // Buffer if we have too many unacknowledged ticks
    return this.ticksInFlight > 10;
  }

  clear(): void {
    this.lastAckedTick = 0;
    this.lastSentTick = 0;
    this.ticksInFlight = 0;
  }
}

/**
 * Input prediction for smoother local feel
 */
export class InputPrediction {
  private previousInput: InputState | null = null;

  /**
   * Predict next input based on current input pattern
   */
  predictNextInput(currentInput: InputState): InputState {
    if (!this.previousInput) {
      this.previousInput = currentInput;
      return currentInput;
    }

    // Simple prediction: continue same direction if player is moving
    const predicted = { ...currentInput };

    // Maintain momentum
    if (this.previousInput.moveLeft && !currentInput.moveLeft) {
      // Player released left, but might press it again
      // Don't predict continuation
    }

    this.previousInput = currentInput;
    return predicted;
  }

  clear(): void {
    this.previousInput = null;
  }
}
