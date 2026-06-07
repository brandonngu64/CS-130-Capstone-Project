export type VFXPackDef = {
  id: string;
  jsonPaths: string[];
  pngPaths: string[];
};

export const RING_OUT_PACK: VFXPackDef = {
  id: 'ringOutFull',
  jsonPaths: [
    '../../assets/vfx/ringOutFull/ringOutFullFix-0.json',
    '../../assets/vfx/ringOutFull/ringOutFullFix-1.json',
    '../../assets/vfx/ringOutFull/ringOutFullFix-2.json',
  ],
  pngPaths: [
    '../../assets/vfx/ringOutFull/ringOutFullFix-0.png',
    '../../assets/vfx/ringOutFull/ringOutFullFix-1.png',
    '../../assets/vfx/ringOutFull/ringOutFullFix-2.png',
  ],
};

export const COUNTDOWN_PACK: VFXPackDef = {
  id: 'countdown321',
  jsonPaths: Array.from(
    { length: 10 },
    (_, i) => `../../assets/vfx/321GoSequence/321GoSequence-${i}.json`,
  ),
  pngPaths: Array.from(
    { length: 10 },
    (_, i) => `../../assets/vfx/321GoSequence/321GoSequence-${i}.png`,
  ),
};

// Animation frames per real second for the 3-2-1 sequence. The pack has 325
// frames; with a 4-second countdown the natural rate is ~81.25 fps, but the
// art is designed for 60 fps playback — the asset is built to fit the window
// at that rate. Tune here if the art is ever re-cut.
export const COUNTDOWN_VFX_FPS = 60;
export const COUNTDOWN_VFX_FRAME_OFFSET = 0;
