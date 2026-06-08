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
