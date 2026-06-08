export enum InputBits {
  Left   = 1 << 0,
  Right  = 1 << 1,
  Jump   = 1 << 2,
  Duck   = 1 << 3,
  Punch  = 1 << 4,
  Dodge  = 1 << 5,
  Shield = 1 << 6,
}

export interface InputState {
  left: boolean;
  right: boolean;
  jump: boolean;
  duck: boolean;
  punch: boolean;
  dodge: boolean;
  shield: boolean;
}

export function encodeInput(state: InputState): Uint8Array {
  let bits = 0;
  if (state.left) {
    bits |= InputBits.Left;
  }
  if (state.right) {
    bits |= InputBits.Right;
  }
  if (state.jump) {
    bits |= InputBits.Jump;
  }
  if (state.duck) {
    bits |= InputBits.Duck;
  }
  if (state.punch) {
    bits |= InputBits.Punch;
  }
  if (state.dodge) {
    bits |= InputBits.Dodge;
  }
  if (state.shield) {
    bits |= InputBits.Shield;
  }
  return new Uint8Array([bits]);
}

export function decodeInputBits(input: Uint8Array | undefined): number {
  return input?.[0] ?? 0;
}
