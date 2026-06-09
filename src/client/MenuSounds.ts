// Delegated menu SFX. Plays hover/click/error sounds on buttons inside menu
// overlays. Scoped to `.overlay-backdrop` and `.lobby-overlay` so in-game HUD
// buttons stay silent.
//
// Audio path: bytes are fetched eagerly at module load so they're warm before
// the first user gesture. On the first interaction we lazily create an
// AudioContext, decode the cached bytes into AudioBuffers, and route plays
// through a dry/wet graph with a procedural decayed-noise impulse response
// for a subtle reverb tail.

const CURSOR_MOVE_OVER_URL = new URL(
  '../assets/sounds/menu/cursor_moveOver.wav',
  import.meta.url,
).href;
const NORMAL_SELECT_URL = new URL(
  '../assets/sounds/menu/normalSelect.wav',
  import.meta.url,
).href;
const START_GAME_URL = new URL(
  '../assets/sounds/menu/startgame_button.wav',
  import.meta.url,
).href;
const ERROR_SELECT_URL = new URL(
  '../assets/sounds/menu/error_select.wav',
  import.meta.url,
).href;

const MENU_SELECTOR = '.overlay-backdrop, .lobby-overlay';
const START_GAME_BUTTON_ID = 'startGameButton';

const IR_DURATION_SECONDS = 0.8;
const IR_DECAY = 4.0;
const DRY_LEVEL = 1.0;
const WET_LEVEL = 0.25;

const SOUND_URLS = [
  CURSOR_MOVE_OVER_URL,
  NORMAL_SELECT_URL,
  START_GAME_URL,
  ERROR_SELECT_URL,
];

// Kick off byte fetches at module load — no AudioContext / user gesture needed.
const bytePromises = new Map<string, Promise<ArrayBuffer>>();
for (const url of SOUND_URLS) {
  bytePromises.set(
    url,
    fetch(url)
      .then((res) => res.arrayBuffer())
      .catch((err) => {
        console.warn(`Failed to fetch sound ${url}:`, err);
        return new ArrayBuffer(0);
      }),
  );
}

interface AudioGraph {
  ctx: AudioContext;
  dryGain: GainNode;
  wetGain: GainNode;
  masterGain: GainNode;
  convolver: ConvolverNode;
  buffers: Map<string, AudioBuffer>;
}

let graph: AudioGraph | null = null;
let graphInitStarted = false;

function buildImpulseResponse(ctx: AudioContext): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * IR_DURATION_SECONDS));
  const ir = ctx.createBuffer(2, length, sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = ir.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const envelope = Math.exp(-IR_DECAY * t);
      data[i] = (Math.random() * 2 - 1) * envelope;
    }
  }
  return ir;
}

function ensureGraph(): AudioGraph | null {
  if (graph) return graph;
  if (graphInitStarted) return null;
  graphInitStarted = true;

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;

  const ctx = new Ctor();
  const masterGain = ctx.createGain();
  masterGain.gain.value = 1;
  masterGain.connect(ctx.destination);

  const dryGain = ctx.createGain();
  dryGain.gain.value = DRY_LEVEL;
  dryGain.connect(masterGain);

  const wetGain = ctx.createGain();
  wetGain.gain.value = WET_LEVEL;
  wetGain.connect(masterGain);

  const convolver = ctx.createConvolver();
  convolver.buffer = buildImpulseResponse(ctx);
  convolver.connect(wetGain);

  const buffers = new Map<string, AudioBuffer>();
  graph = { ctx, dryGain, wetGain, masterGain, convolver, buffers };

  for (const url of SOUND_URLS) {
    const bytes = bytePromises.get(url);
    if (!bytes) continue;
    void bytes
      .then((arr) => (arr.byteLength > 0 ? ctx.decodeAudioData(arr.slice(0)) : null))
      .then((buffer) => {
        if (buffer && graph) graph.buffers.set(url, buffer);
      })
      .catch(() => {
        // A failed decode just means this sound stays silent.
      });
  }

  return graph;
}

function playSound(url: string, volume: number): void {
  const g = ensureGraph();
  if (!g) return;

  // Resume audio context if suspended (required by browser autoplay policy)
  if (g.ctx.state === 'suspended') {
    void g.ctx.resume().catch(() => {
      console.warn('Failed to resume audio context');
    });
    // Return on first interaction to let context initialize
    return;
  }

  const buffer = g.buffers.get(url);
  if (!buffer) {
    // Still decoding or failed to load
    return;
  }

  g.masterGain.gain.value = Math.max(0, Math.min(1, volume));

  const source = g.ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(g.dryGain);
  source.connect(g.convolver);
  source.start(0);
}

function closestMenuButton(target: EventTarget | null): HTMLButtonElement | null {
  if (!(target instanceof Element)) return null;
  const button = target.closest('button');
  if (!button) return null;
  // Check if button is inside an overlay (menu selector)
  const inOverlay = button.closest(MENU_SELECTOR);
  if (!inOverlay) return null;
  return button as HTMLButtonElement;
}

export interface MenuSoundOptions {
  getSfxVolume: () => number;
}

export function attachMenuSounds(
  root: HTMLElement,
  options: MenuSoundOptions,
): void {
  const sfxVolume = (): number => options.getSfxVolume();

  // Hover: mouseover bubbles unlike mouseenter, so delegation works.
  root.addEventListener('mouseover', (event) => {
    const button = closestMenuButton(event.target);
    if (!button) return;
    const related = event.relatedTarget;
    if (related instanceof Node && button.contains(related)) return;
    if (button.disabled) return;
    playSound(CURSOR_MOVE_OVER_URL, sfxVolume() * 0.5);
  });

  // Disabled buttons don't fire `click`, but they do fire `mousedown`.
  root.addEventListener(
    'mousedown',
    (event) => {
      const button = closestMenuButton(event.target);
      if (!button) return;
      if (!button.disabled) return;
      playSound(ERROR_SELECT_URL, sfxVolume() * 0.7);
    },
    true,
  );

  root.addEventListener(
    'click',
    (event) => {
      const button = closestMenuButton(event.target);
      if (!button) return;
      if (button.disabled) return;
      if (button.id === START_GAME_BUTTON_ID) {
        playSound(START_GAME_URL, sfxVolume());
      } else {
        playSound(NORMAL_SELECT_URL, sfxVolume() * 0.7);
      }
    },
    true,
  );
}
