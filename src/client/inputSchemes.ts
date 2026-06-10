export type GameAction =
  | 'left'
  | 'right'
  | 'jump'
  | 'duck'
  | 'punch'
  | 'dodge'
  | 'shield';

export type InputSchemeId = 'keyboard2hand' | 'mk' | 'onehand';

export interface BindingRow {
  action: string;
  key: string;
}

export interface InputScheme {
  id: InputSchemeId;
  displayName: string;
  keys: Partial<Record<string, GameAction>>;
  mouse?: Partial<Record<number, GameAction>>;
  bindings: BindingRow[];
}

export const INPUT_SCHEMES: Record<InputSchemeId, InputScheme> = {
  keyboard2hand: {
    id: 'keyboard2hand',
    displayName: 'Keyboard (two-hand)',
    keys: {
      KeyA: 'left',
      ArrowLeft: 'left',
      KeyD: 'right',
      ArrowRight: 'right',
      KeyW: 'jump',
      Space: 'jump',
      ArrowUp: 'jump',
      KeyS: 'duck',
      ArrowDown: 'duck',
      KeyU: 'punch',
      ShiftLeft: 'dodge',
      ShiftRight: 'dodge',
      KeyI: 'shield',
    },
    bindings: [
      { action: 'Move', key: 'WASD / Arrows' },
      { action: 'Jump', key: 'W / Space / Up' },
      { action: 'Duck', key: 'S / Down' },
      { action: 'Attack', key: 'U' },
      { action: 'Block', key: 'I' },
      { action: 'Dodge / Dash', key: 'Shift' },
    ],
  },
  mk: {
    id: 'mk',
    displayName: 'Mouse + Keyboard',
    keys: {
      KeyA: 'left',
      KeyD: 'right',
      KeyW: 'jump',
      Space: 'jump',
      KeyS: 'duck',
      ShiftLeft: 'dodge',
      ShiftRight: 'dodge',
    },
    mouse: {
      0: 'punch',
      2: 'shield',
    },
    bindings: [
      { action: 'Move', key: 'WASD' },
      { action: 'Jump', key: 'W / Space' },
      { action: 'Duck', key: 'S' },
      { action: 'Attack', key: 'Left Click' },
      { action: 'Block', key: 'Right Click' },
      { action: 'Dodge / Dash', key: 'Shift' },
    ],
  },
  onehand: {
    id: 'onehand',
    displayName: 'One-hand',
    keys: {
      KeyA: 'left',
      KeyD: 'right',
      KeyW: 'jump',
      KeyS: 'duck',
      ShiftLeft: 'dodge',
      ShiftRight: 'dodge',
      KeyE: 'punch',
      KeyQ: 'shield',
    },
    bindings: [
      { action: 'Move', key: 'WASD' },
      { action: 'Jump', key: 'W' },
      { action: 'Duck', key: 'S' },
      { action: 'Shoot', key: 'E' },
      { action: 'Block', key: 'Q' },
      { action: 'Dodge / Dash', key: 'Shift' },
    ],
  },
};

export const DEFAULT_INPUT_SCHEME_ID: InputSchemeId = 'keyboard2hand';

export function isInputSchemeId(value: string): value is InputSchemeId {
  return value === 'keyboard2hand' || value === 'mk' || value === 'onehand';
}

// Fixed key bindings used when split-screen (2 local players) is active. The
// regular INPUT_SCHEMES setting is ignored for the duration of the match —
// each local key is statically routed to either the primary or secondary
// player's InputState.
export type SplitScreenSlot = 'primary' | 'secondary';

export interface SplitScreenBinding {
  slot: SplitScreenSlot;
  action: GameAction;
}

export const SPLIT_SCREEN_KEYMAP: Partial<Record<string, SplitScreenBinding>> = {
  // Primary: WASD + Q (block) + E (shoot) + Left Shift (dash)
  KeyA: { slot: 'primary', action: 'left' },
  KeyD: { slot: 'primary', action: 'right' },
  KeyW: { slot: 'primary', action: 'jump' },
  KeyS: { slot: 'primary', action: 'duck' },
  KeyE: { slot: 'primary', action: 'punch' },
  KeyQ: { slot: 'primary', action: 'shield' },
  ShiftLeft: { slot: 'primary', action: 'dodge' },
  // Secondary: Arrow keys + Right Shift (shoot) + Right Ctrl (dash) + / (block)
  ArrowLeft: { slot: 'secondary', action: 'left' },
  ArrowRight: { slot: 'secondary', action: 'right' },
  ArrowUp: { slot: 'secondary', action: 'jump' },
  ArrowDown: { slot: 'secondary', action: 'duck' },
  ShiftRight: { slot: 'secondary', action: 'punch' },
  ControlRight: { slot: 'secondary', action: 'dodge' },
  Slash: { slot: 'secondary', action: 'shield' },
};

export const SPLIT_SCREEN_BINDINGS: BindingRow[] = [
  { action: 'P1 Move', key: 'WASD' },
  { action: 'P1 Attack / Block / Dash', key: 'E / Q / Left Shift' },
  { action: 'P2 Move', key: 'Arrow Keys' },
  { action: 'P2 Attack / Block / Dash', key: 'Right Shift / / / Right Ctrl' },
];
