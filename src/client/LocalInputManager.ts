export interface InputState {
  moveLeft: boolean;
  moveRight: boolean;
  jump: boolean;
  duck: boolean;
  punch: boolean;
  dash: boolean;
  shoot: boolean;
}

export class InputManager {
  private currentInput: InputState = {
    moveLeft: false,
    moveRight: false,
    jump: false,
    duck: false,
    punch: false,
    dash: false,
    shoot: false,
  };

  private keysPressed = new Set<string>();

  constructor() {
    this.setupKeyboardListeners();
  }

  private setupKeyboardListeners(): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.addEventListener('keydown', (event) => {
      this.keysPressed.add(event.code);
      this.updateInputState();

      // Handle space and arrow keys to prevent page scroll
      if (
        event.code === 'Space' ||
        event.code.startsWith('Arrow') ||
        event.code === 'KeyW' ||
        event.code === 'KeyA' ||
        event.code === 'KeyS' ||
        event.code === 'KeyD'
      ) {
        event.preventDefault();
      }
    });

    window.addEventListener('keyup', (event) => {
      this.keysPressed.delete(event.code);
      this.updateInputState();
    });
  }

  private updateInputState(): void {
    // WASD controls
    this.currentInput.moveLeft = this.keysPressed.has('KeyA') || this.keysPressed.has('ArrowLeft');
    this.currentInput.moveRight =
      this.keysPressed.has('KeyD') || this.keysPressed.has('ArrowRight');
    this.currentInput.jump = this.keysPressed.has('Space') || this.keysPressed.has('KeyW');
    this.currentInput.duck = this.keysPressed.has('KeyS') || this.keysPressed.has('ArrowDown');

    // Attack controls
    this.currentInput.punch = this.keysPressed.has('KeyJ') || this.keysPressed.has('KeyZ');
    this.currentInput.dash = this.keysPressed.has('KeyK') || this.keysPressed.has('KeyX');
    this.currentInput.shoot = this.keysPressed.has('KeyL') || this.keysPressed.has('KeyC');
  }

  getCurrentInput(): InputState {
    return { ...this.currentInput };
  }

  setKeyPressed(code: string, pressed: boolean): void {
    if (pressed) {
      this.keysPressed.add(code);
    } else {
      this.keysPressed.delete(code);
    }
    this.updateInputState();
  }

  isKeyPressed(code: string): boolean {
    return this.keysPressed.has(code);
  }

  reset(): void {
    this.keysPressed.clear();
    this.currentInput = {
      moveLeft: false,
      moveRight: false,
      jump: false,
      duck: false,
      punch: false,
      dash: false,
      shoot: false,
    };
  }
}
