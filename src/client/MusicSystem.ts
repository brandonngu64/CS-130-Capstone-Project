// Dynamic music player for the three OST phases. Drop an .mp3 into
// src/assets/sounds/ost/<phase>/ and it's picked up automatically.
//
// Tracks listed in LOOP_CONFIG get sample-accurate gapless looping via
// AudioBufferSourceNode.loop + loopStart/loopEnd. Everything else plays
// through once and the next random track from the same folder starts.

export type MusicPhase = 'start' | 'lobby' | 'game';

type LoopPoints = {
  // Samples in the source file's native sample rate.
  loopStartSample: number;
  loopEndSample: number;
  sampleRate: number;
};

// Per-track loop metadata, keyed by the file's basename (no extension).
// Sample-based to survive decodeAudioData resampling: we convert to seconds
// once, and those seconds line up regardless of the AudioContext rate.
const LOOP_CONFIG: Record<string, LoopPoints | 'full'> = {
  ssbm_finalDest:      { loopStartSample: 172032,  loopEndSample: 2860033, sampleRate: 32000 },
  ssbu_finalDest:      { loopStartSample: 645120,  loopEndSample: 7496803, sampleRate: 48000 },
  ssb4_mapSelect:      { loopStartSample: 114688,  loopEndSample: 1075201, sampleRate: 47998 },
  ssb4_resultsDisplay: { loopStartSample: 143360,  loopEndSample: 2521623, sampleRate: 47999 },
  ssbb_mainTheme:      { loopStartSample: 186368,  loopEndSample: 3927061, sampleRate: 32000 },
  ssbb_menuTheme:      { loopStartSample: 114688,  loopEndSample: 3043122, sampleRate: 32000 },
  ssbb_finalDest:      { loopStartSample: 129024,  loopEndSample: 5302676, sampleRate: 32000 },
  lor_lobbyTheme:      'full',
};

// Eager glob so the bundler (and HMR in dev) wires up every track.
const OST_MODULES = import.meta.glob('../assets/sounds/ost/*/*.mp3', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

type Track = {
  url: string;
  basename: string;
  loop: LoopPoints | 'full' | null;
  buffer: AudioBuffer | null;
  decoding: Promise<AudioBuffer> | null;
  // ReplayGain (track) parsed from ID3v2 TXXX frames. null = unknown.
  rgGainDb: number | null;
  rgPeak: number | null;
};

// Standard ReplayGain reference is -18 LUFS; a small preamp brings playback
// back toward the levels people expect without re-clipping (we still cap by
// the per-track peak below).
const REPLAYGAIN_PREAMP_DB = 6;

type Folder = {
  tracks: Track[];
  lastIndex: number;
};

const PHASE_TO_FOLDER: Record<MusicPhase, string> = {
  start: 'startThemes',
  lobby: 'lobbyThemes',
  game:  'gameThemes',
};

function bucketTracks(): Record<string, Folder> {
  const folders: Record<string, Folder> = {};
  for (const [path, url] of Object.entries(OST_MODULES)) {
    // path looks like "../assets/sounds/ost/<folder>/<file>.mp3"
    const parts = path.split('/');
    const folderName = parts[parts.length - 2] ?? '';
    const file = parts[parts.length - 1] ?? '';
    const basename = file.replace(/\.mp3$/i, '');
    const loop = LOOP_CONFIG[basename] ?? null;
    const folder = folders[folderName] ?? (folders[folderName] = { tracks: [], lastIndex: -1 });
    folder.tracks.push({ url, basename, loop, buffer: null, decoding: null, rgGainDb: null, rgPeak: null });
  }
  return folders;
}

export class MusicSystem {
  private readonly folders = bucketTracks();
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private currentPhase: MusicPhase | null = null;
  private musicVolume = 1;
  private phaseVolume = 0.2;
  // Monotonic counter so a stale onended callback from a track we already
  // stopped can't trigger a follow-up play.
  private playToken = 0;
  // Pending phase queued while waiting for a user gesture to unlock audio.
  private pendingPhase: MusicPhase | null = null;
  private resumeHandlerAttached = false;

  setVolume(volume: number): void {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    this.applyVolume();
  }

  setPhase(phase: MusicPhase): void {
    if (phase === this.currentPhase) return;
    this.currentPhase = phase;
    this.phaseVolume = phase === 'game' ? 0.15 : 0.2;
    this.applyVolume();
    this.startRandomFromCurrentPhase();
  }

  stop(): void {
    this.playToken++;
    if (this.source) {
      try { this.source.onended = null; this.source.stop(); } catch { /* ignore */ }
      this.source.disconnect();
      this.source = null;
    }
  }

  dispose(): void {
    this.stop();
    if (this.ctx) {
      void this.ctx.close().catch(() => { /* ignore */ });
      this.ctx = null;
      this.gain = null;
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return null;
    const ctx = new Ctor();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    this.ctx = ctx;
    this.gain = gain;
    this.applyVolume();
    return ctx;
  }

  private applyVolume(): void {
    if (!this.gain || !this.ctx) return;
    this.gain.gain.setValueAtTime(this.musicVolume * this.phaseVolume, this.ctx.currentTime);
  }

  private startRandomFromCurrentPhase(): void {
    if (!this.currentPhase) return;
    const folderName = PHASE_TO_FOLDER[this.currentPhase];
    const folder = this.folders[folderName];
    if (!folder || folder.tracks.length === 0) {
      this.stop();
      return;
    }
    const track = this.pickRandom(folder);
    this.playTrack(track);
  }

  private pickRandom(folder: Folder): Track {
    const n = folder.tracks.length;
    if (n === 1) return folder.tracks[0]!;
    let i = Math.floor(Math.random() * n);
    if (i === folder.lastIndex) i = (i + 1) % n;
    folder.lastIndex = i;
    return folder.tracks[i]!;
  }

  private playTrack(track: Track): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    // Browsers suspend the context until a user gesture; queue the phase and
    // retry on the next pointer/keydown rather than fighting the policy.
    if (ctx.state === 'suspended') {
      this.pendingPhase = this.currentPhase;
      this.attachResumeHandler();
      void ctx.resume().catch(() => { /* ignore */ });
    }

    this.stop();
    const token = ++this.playToken;

    void this.decode(track).then((buffer) => {
      if (token !== this.playToken) return;
      if (!this.ctx || !this.gain) return;

      const src = this.ctx.createBufferSource();
      src.buffer = buffer;

      if (track.loop === 'full') {
        src.loop = true;
        src.loopStart = 0;
        src.loopEnd = buffer.duration;
      } else if (track.loop) {
        src.loop = true;
        // Sample → seconds against the source's native rate (decodeAudioData
        // resamples the buffer, but the time-domain offsets are preserved).
        src.loopStart = track.loop.loopStartSample / track.loop.sampleRate;
        src.loopEnd = track.loop.loopEndSample / track.loop.sampleRate;
      } else {
        src.loop = false;
        src.onended = () => {
          if (token !== this.playToken) return;
          // Pick a different random track from the same phase folder.
          this.startRandomFromCurrentPhase();
        };
      }

      const trackGainNode = this.ctx.createGain();
      trackGainNode.gain.setValueAtTime(this.computeReplayGain(track), this.ctx.currentTime);
      src.connect(trackGainNode).connect(this.gain);
      try { src.start(0); } catch { /* already started somehow */ }
      this.source = src;
    }).catch((err) => {
      console.warn(`Music: failed to decode ${track.basename}:`, err);
    });
  }

  private async decode(track: Track): Promise<AudioBuffer> {
    if (track.buffer) return track.buffer;
    if (track.decoding) return track.decoding;
    const ctx = this.ensureContext();
    if (!ctx) throw new Error('No AudioContext');
    track.decoding = (async () => {
      const res = await fetch(track.url);
      const bytes = await res.arrayBuffer();
      // Parse ReplayGain tags before handing the buffer to decodeAudioData
      // (which may detach it).
      const rg = parseReplayGainFromId3v2(bytes);
      track.rgGainDb = rg.gainDb;
      track.rgPeak = rg.peak;
      const buf = await ctx.decodeAudioData(bytes);
      track.buffer = buf;
      track.decoding = null;
      return buf;
    })();
    return track.decoding;
  }

  private attachResumeHandler(): void {
    if (this.resumeHandlerAttached) return;
    this.resumeHandlerAttached = true;
    const handler = (): void => {
      const ctx = this.ctx;
      if (!ctx) return;
      void ctx.resume().then(() => {
        if (this.pendingPhase && this.pendingPhase === this.currentPhase && !this.source) {
          this.startRandomFromCurrentPhase();
        }
        this.pendingPhase = null;
      }).catch(() => { /* ignore */ });
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
      this.resumeHandlerAttached = false;
    };
    window.addEventListener('pointerdown', handler, { once: true });
    window.addEventListener('keydown', handler, { once: true });
  }

  private computeReplayGain(track: Track): number {
    if (track.rgGainDb === null) return 1;
    const linear = Math.pow(10, (track.rgGainDb + REPLAYGAIN_PREAMP_DB) / 20);
    // Prevent clipping: if applying the gain would push the peak above 1.0,
    // scale back so the loudest sample lands exactly at full scale.
    if (track.rgPeak && track.rgPeak > 0 && linear * track.rgPeak > 1) {
      return 1 / track.rgPeak;
    }
    return linear;
  }
}

// Minimal ID3v2.3/2.4 reader that pulls REPLAYGAIN_TRACK_GAIN / _PEAK from
// TXXX frames. Returns { gainDb: null, peak: null } if no tag is present.
function parseReplayGainFromId3v2(buf: ArrayBuffer): { gainDb: number | null; peak: number | null } {
  const empty = { gainDb: null, peak: null };
  if (buf.byteLength < 10) return empty;
  const view = new DataView(buf);
  if (view.getUint8(0) !== 0x49 || view.getUint8(1) !== 0x44 || view.getUint8(2) !== 0x33) {
    return empty;
  }
  const major = view.getUint8(3);
  if (major !== 3 && major !== 4) return empty;
  const headerFlags = view.getUint8(5);
  const tagSize = readSynchsafe(view, 6);
  const tagEnd = Math.min(buf.byteLength, 10 + tagSize);
  let offset = 10;
  if (headerFlags & 0x40) {
    // Extended header — skip.
    if (offset + 4 > tagEnd) return empty;
    const extSize = major === 4 ? readSynchsafe(view, offset) : view.getUint32(offset);
    offset += extSize;
  }
  let gainDb: number | null = null;
  let peak: number | null = null;
  while (offset + 10 <= tagEnd) {
    const id =
      String.fromCharCode(view.getUint8(offset)) +
      String.fromCharCode(view.getUint8(offset + 1)) +
      String.fromCharCode(view.getUint8(offset + 2)) +
      String.fromCharCode(view.getUint8(offset + 3));
    if (id.charCodeAt(0) === 0) break;
    const size = major === 4 ? readSynchsafe(view, offset + 4) : view.getUint32(offset + 4);
    offset += 10;
    if (size <= 0 || offset + size > tagEnd) break;
    if (id === 'TXXX') {
      const parsed = parseTxxx(buf, offset, size);
      if (parsed) {
        const desc = parsed.description.toLowerCase();
        if (desc === 'replaygain_track_gain' && gainDb === null) {
          const m = parsed.value.match(/-?\d+(?:\.\d+)?/);
          if (m) gainDb = parseFloat(m[0]);
        } else if (desc === 'replaygain_track_peak' && peak === null) {
          const v = parseFloat(parsed.value);
          if (Number.isFinite(v) && v > 0) peak = v;
        }
      }
    }
    offset += size;
  }
  return { gainDb, peak };
}

function readSynchsafe(view: DataView, off: number): number {
  return (
    ((view.getUint8(off) & 0x7f) << 21) |
    ((view.getUint8(off + 1) & 0x7f) << 14) |
    ((view.getUint8(off + 2) & 0x7f) << 7) |
    (view.getUint8(off + 3) & 0x7f)
  );
}

function parseTxxx(
  buf: ArrayBuffer,
  start: number,
  size: number,
): { description: string; value: string } | null {
  if (size < 2) return null;
  const view = new DataView(buf, start, size);
  const encoding = view.getUint8(0);
  const bytes = new Uint8Array(buf, start + 1, size - 1);
  // Only handle the single-byte-terminator encodings; UTF-16 TXXX for
  // ReplayGain is extremely rare in MP3.
  if (encoding !== 0 && encoding !== 3) return null;
  let nul = -1;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) { nul = i; break; }
  }
  if (nul < 0) return null;
  let valueEnd = bytes.length;
  while (valueEnd > nul + 1 && bytes[valueEnd - 1] === 0) valueEnd--;
  const decoder = new TextDecoder(encoding === 3 ? 'utf-8' : 'latin1');
  return {
    description: decoder.decode(bytes.subarray(0, nul)),
    value: decoder.decode(bytes.subarray(nul + 1, valueEnd)),
  };
}
