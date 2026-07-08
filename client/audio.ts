// THRESHOLD — procedural Web Audio engine. No assets, no runtime imports.
// Ethereal painterly pads + chimes, readable combat cues. Everything synthesized.

export type SfxName =
  | 'portal' | 'shard' | 'solve' | 'plate' | 'lever' | 'switch' | 'pickup' | 'socket'
  | 'fire-pulse' | 'fire-freeze' | 'portal-place' | 'portal-traverse'
  | 'telegraph' | 'enemy-attack' | 'enemy-down' | 'shatter' | 'frozen'
  | 'hit' | 'hurt' | 'downed' | 'revived' | 'jump' | 'beacon' | 'locked' | 'unlock';

interface WorldMood {
  root: number;        // root frequency (Hz)
  scale: number[];     // semitone offsets for pad voices
  chime: number[];     // pentatonic offsets for arpeggio (relative to root, higher octave)
  cutoff: number;      // pad lowpass cutoff (Hz)
  color: number;       // pad detune spread (cents)
}

const SEMI = (n: number): number => Math.pow(2, n / 12);

const WORLDS: Record<string, WorldMood> = {
  nexus:       { root: 110.0, scale: [0, 7, 12, 15], chime: [12, 15, 19, 24, 27], cutoff: 900,  color: 8 },
  atrium:      { root: 146.8, scale: [0, 4, 7, 11],  chime: [12, 16, 19, 23, 28], cutoff: 1400, color: 6 },
  vaults:      { root: 92.5,  scale: [0, 3, 7, 10],  chime: [12, 15, 19, 22, 27], cutoff: 520,  color: 12 },
  gardens:     { root: 98.0,  scale: [0, 4, 7, 12],  chime: [12, 16, 19, 24, 28], cutoff: 1200, color: 5 },
  observatory: { root: 164.8, scale: [0, 7, 14, 19], chime: [19, 24, 26, 31, 36], cutoff: 1800, color: 10 },
};

interface Bed {
  gain: GainNode;
  lfo: OscillatorNode;
  oscs: OscillatorNode[];
  stopAt: (t: number) => void;
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private combatBus: GainNode | null = null;

  private masterVol = 0.8;
  private musicVol = 0.6;
  private sfxVol = 0.9;

  private world = 'nexus';
  private bed: Bed | null = null;
  private combatOn = false;
  private combatSources: OscillatorNode[] = [];
  private chimeTimer: number | null = null;

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state !== 'closed';
  }

  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.masterVol;
    master.connect(ctx.destination);

    const musicBus = ctx.createGain();
    musicBus.gain.value = this.musicVol;
    musicBus.connect(master);

    const combatBus = ctx.createGain();
    combatBus.gain.value = 0;
    combatBus.connect(musicBus);

    const sfxBus = ctx.createGain();
    sfxBus.gain.value = this.sfxVol;
    sfxBus.connect(master);

    this.master = master;
    this.musicBus = musicBus;
    this.combatBus = combatBus;
    this.sfxBus = sfxBus;

    void ctx.resume();
    this.startBed(this.world, ctx.currentTime, 2);
    this.scheduleChime();
  }

  setMasterVolume(v: number): void {
    this.masterVol = clamp01(v);
    if (this.master && this.ctx) this.ramp(this.master.gain, this.masterVol, 0.05);
  }
  setMusicVolume(v: number): void {
    this.musicVol = clamp01(v);
    if (this.musicBus && this.ctx) this.ramp(this.musicBus.gain, this.musicVol, 0.05);
  }
  setSfxVolume(v: number): void {
    this.sfxVol = clamp01(v);
    if (this.sfxBus && this.ctx) this.ramp(this.sfxBus.gain, this.sfxVol, 0.05);
  }

  setWorld(world: string): void {
    if (!WORLDS[world]) return;
    this.world = world;
    if (!this.ctx || !this.musicBus) return;
    const now = this.ctx.currentTime;
    if (this.bed) {
      const old = this.bed;
      this.ramp(old.gain.gain, 0, 2);
      old.stopAt(now + 2.3);
      this.bed = null;
    }
    this.startBed(world, now, 2);
  }

  setCombat(active: boolean): void {
    if (this.combatOn === active) return;
    this.combatOn = active;
    if (!this.ctx || !this.combatBus) return;
    const now = this.ctx.currentTime;
    if (active) {
      this.ramp(this.combatBus.gain, 0.9, 1.0);
      this.startCombat(now);
    } else {
      this.ramp(this.combatBus.gain, 0, 1.4);
      const srcs = this.combatSources;
      this.combatSources = [];
      for (const s of srcs) {
        try { s.stop(now + 1.6); } catch { /* already stopped */ }
      }
    }
  }

  updateListener(pos: [number, number, number], forward: [number, number, number]): void {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const t = this.ctx.currentTime;
    const withParam = L as unknown as {
      positionX?: AudioParam; positionY?: AudioParam; positionZ?: AudioParam;
      forwardX?: AudioParam; forwardY?: AudioParam; forwardZ?: AudioParam;
      upX?: AudioParam; upY?: AudioParam; upZ?: AudioParam;
    };
    if (withParam.positionX && withParam.forwardX) {
      withParam.positionX.setTargetAtTime(pos[0], t, 0.02);
      withParam.positionY!.setTargetAtTime(pos[1], t, 0.02);
      withParam.positionZ!.setTargetAtTime(pos[2], t, 0.02);
      withParam.forwardX!.setTargetAtTime(forward[0], t, 0.02);
      withParam.forwardY!.setTargetAtTime(forward[1], t, 0.02);
      withParam.forwardZ!.setTargetAtTime(forward[2], t, 0.02);
      withParam.upX!.setTargetAtTime(0, t, 0.02);
      withParam.upY!.setTargetAtTime(1, t, 0.02);
      withParam.upZ!.setTargetAtTime(0, t, 0.02);
    } else {
      const legacy = L as unknown as {
        setPosition: (x: number, y: number, z: number) => void;
        setOrientation: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void;
      };
      legacy.setPosition(pos[0], pos[1], pos[2]);
      legacy.setOrientation(forward[0], forward[1], forward[2], 0, 1, 0);
    }
  }

  play(name: SfxName, opts?: { pos?: [number, number, number] }): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 1;
    if (opts && opts.pos) {
      const panner = ctx.createPanner();
      panner.distanceModel = 'inverse';
      panner.refDistance = 4;
      panner.maxDistance = 60;
      panner.rolloffFactor = 1;
      panner.panningModel = 'HRTF';
      const p = panner as unknown as {
        positionX?: AudioParam; positionY?: AudioParam; positionZ?: AudioParam;
        setPosition?: (x: number, y: number, z: number) => void;
      };
      if (p.positionX) {
        p.positionX.value = opts.pos[0];
        p.positionY!.value = opts.pos[1];
        p.positionZ!.value = opts.pos[2];
      } else if (p.setPosition) {
        p.setPosition(opts.pos[0], opts.pos[1], opts.pos[2]);
      }
      out.connect(panner);
      panner.connect(this.sfxBus);
    } else {
      out.connect(this.sfxBus);
    }
    this.render(name, ctx, out, now);
  }

  // ---- internal: bed & combat ----------------------------------------------

  private startBed(world: string, now: number, fadeIn: number): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    const mood = WORLDS[world] ?? WORLDS.nexus;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + fadeIn);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = mood.cutoff;
    lp.Q.value = 0.4;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06 + Math.random() * 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = mood.cutoff * 0.35;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    lfo.start(now);

    const oscs: OscillatorNode[] = [];
    mood.scale.forEach((semi, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 === 0 ? 'sawtooth' : 'triangle';
      o.frequency.value = mood.root * SEMI(semi);
      o.detune.value = (i - 1.5) * mood.color;
      const vg = ctx.createGain();
      vg.gain.value = 0.25 / mood.scale.length + (i === 0 ? 0.1 : 0);
      o.connect(vg);
      vg.connect(lp);
      o.start(now);
      oscs.push(o);
    });

    lp.connect(gain);
    gain.connect(this.musicBus);

    this.bed = {
      gain, lfo, oscs,
      stopAt: (t: number) => {
        for (const o of oscs) { try { o.stop(t); } catch { /* noop */ } }
        try { lfo.stop(t); } catch { /* noop */ }
      },
    };
  }

  private startCombat(now: number): void {
    if (!this.ctx || !this.combatBus) return;
    const ctx = this.ctx;
    const mood = WORLDS[this.world] ?? WORLDS.nexus;

    // Low pulsing drone: sub oscillator amplitude-modulated by a slow square LFO.
    const sub = ctx.createOscillator();
    sub.type = 'sawtooth';
    sub.frequency.value = mood.root * 0.5;
    const subLp = ctx.createBiquadFilter();
    subLp.type = 'lowpass';
    subLp.frequency.value = 220;

    const pulseGain = ctx.createGain();
    pulseGain.gain.value = 0.4;
    const pulse = ctx.createOscillator();
    pulse.type = 'square';
    pulse.frequency.value = 2.6; // pulses per second
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = 0.35;
    pulse.connect(pulseDepth);
    pulseDepth.connect(pulseGain.gain);

    sub.connect(subLp);
    subLp.connect(pulseGain);
    pulseGain.connect(this.combatBus);

    // A tense fifth droning above.
    const fifth = ctx.createOscillator();
    fifth.type = 'triangle';
    fifth.frequency.value = mood.root * SEMI(7);
    fifth.detune.value = 6;
    const fifthGain = ctx.createGain();
    fifthGain.gain.value = 0.12;
    fifth.connect(fifthGain);
    fifthGain.connect(this.combatBus);

    sub.start(now); pulse.start(now); fifth.start(now);
    this.combatSources = [sub, pulse, fifth];
  }

  private scheduleChime(): void {
    if (!this.ctx) return;
    const delay = 6000 + Math.random() * 9000;
    this.chimeTimer = (setTimeout(() => {
      this.playChimeArp();
      this.scheduleChime();
    }, delay) as unknown) as number;
  }

  private playChimeArp(): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    const mood = WORLDS[this.world] ?? WORLDS.nexus;
    const notes = mood.chime;
    const count = 3 + Math.floor(Math.random() * 3);
    const base = ctx.currentTime + 0.05;
    for (let i = 0; i < count; i++) {
      const semi = notes[Math.floor(Math.random() * notes.length)] ?? 12;
      const t = base + i * (0.16 + Math.random() * 0.1);
      this.chimeVoice(ctx, this.musicBus, mood.root * SEMI(semi), t, 0.05);
    }
  }

  private chimeVoice(ctx: AudioContext, dest: AudioNode, freq: number, t: number, peak: number): void {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2.01;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    const g2 = ctx.createGain();
    g2.gain.value = 0.3;
    o.connect(g); o2.connect(g2); g2.connect(g);
    g.connect(dest);
    o.start(t); o2.start(t);
    o.stop(t + 1.5); o2.stop(t + 1.5);
  }

  // ---- internal: helpers ----------------------------------------------------

  private ramp(param: AudioParam, target: number, time: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(target, now + time);
  }

  private noise(ctx: AudioContext, dur: number): AudioBufferSourceNode {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  // Filtered noise burst with exponential decay.
  private burst(
    ctx: AudioContext, dest: AudioNode, t: number, dur: number, peak: number,
    type: BiquadFilterType, f0: number, f1: number, q: number,
  ): void {
    const n = this.noise(ctx, dur);
    const filt = ctx.createBiquadFilter();
    filt.type = type; filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(filt); filt.connect(g); g.connect(dest);
    n.start(t); n.stop(t + dur + 0.02);
  }

  // Basic tone with ADSR-ish envelope.
  private tone(
    ctx: AudioContext, dest: AudioNode, type: OscillatorType,
    freq: number, t: number, dur: number, peak: number,
    glideTo?: number,
  ): OscillatorNode {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
    return o;
  }

  private render(name: SfxName, ctx: AudioContext, out: GainNode, t: number): void {
    switch (name) {
      case 'shard':
        this.arp(ctx, out, [523.25, 659.25, 783.99, 1046.5], t, 0.11, 0.22);
        break;
      case 'solve':
        this.arp(ctx, out, [392, 523.25, 659.25, 783.99, 1046.5, 1318.5], t, 0.13, 0.3);
        this.chimeVoice(ctx, out, 1567.98, t + 0.7, 0.12);
        break;
      case 'pickup':
        this.arp(ctx, out, [659.25, 987.77], t, 0.07, 0.2);
        break;
      case 'plate':
        this.tone(ctx, out, 'sine', 174.6, t, 0.22, 0.3, 220);
        this.tone(ctx, out, 'triangle', 349.2, t + 0.02, 0.18, 0.12);
        break;
      case 'lever':
        this.tone(ctx, out, 'square', 220, t, 0.06, 0.14, 160);
        this.tone(ctx, out, 'square', 330, t + 0.07, 0.1, 0.16, 420);
        break;
      case 'switch':
        this.tone(ctx, out, 'square', 880, t, 0.04, 0.16, 1200);
        break;
      case 'socket':
        this.tone(ctx, out, 'sine', 440, t, 0.1, 0.2, 660);
        this.chimeVoice(ctx, out, 880, t + 0.08, 0.1);
        break;
      case 'unlock':
        this.arp(ctx, out, [440, 587.33, 880], t, 0.1, 0.24);
        break;
      case 'locked': // dull double-knock
        this.burst(ctx, out, t, 0.09, 0.4, 'lowpass', 260, 260, 0.7);
        this.burst(ctx, out, t + 0.13, 0.09, 0.4, 'lowpass', 260, 260, 0.7);
        break;
      case 'portal':
      case 'portal-place':
      case 'portal-traverse': {
        const dur = name === 'portal-traverse' ? 0.7 : 0.5;
        const up = name !== 'portal-place';
        this.burst(ctx, out, t, dur, 0.4, 'bandpass', up ? 300 : 2000, up ? 3000 : 300, 4);
        this.tone(ctx, out, 'sine', up ? 220 : 660, t, dur, 0.1, up ? 660 : 220);
        break;
      }
      case 'fire-pulse': // quick thump + zap
        this.tone(ctx, out, 'sine', 160, t, 0.14, 0.4, 60);
        this.burst(ctx, out, t, 0.12, 0.3, 'highpass', 1200, 1200, 1);
        this.tone(ctx, out, 'sawtooth', 900, t, 0.1, 0.16, 200);
        break;
      case 'fire-freeze': // airy descending shimmer
        this.burst(ctx, out, t, 0.6, 0.25, 'bandpass', 4000, 600, 6);
        this.arp(ctx, out, [1568, 1318.5, 1046.5, 783.99], t, 0.09, 0.12);
        break;
      case 'telegraph':
        // rising 2-note warning — fairness cue, must be clear
        this.tone(ctx, out, 'triangle', 494, t, 0.16, 0.4);
        this.tone(ctx, out, 'triangle', 740, t + 0.18, 0.24, 0.45);
        this.tone(ctx, out, 'sine', 988, t + 0.18, 0.24, 0.18);
        break;
      case 'enemy-attack':
        this.tone(ctx, out, 'sawtooth', 300, t, 0.16, 0.35, 90);
        this.burst(ctx, out, t, 0.1, 0.25, 'bandpass', 800, 800, 1);
        break;
      case 'enemy-down':
        this.tone(ctx, out, 'sawtooth', 330, t, 0.5, 0.35, 70);
        this.tone(ctx, out, 'triangle', 220, t + 0.05, 0.4, 0.2, 60);
        break;
      case 'shatter': // bright noise burst + ringing partials
        this.burst(ctx, out, t, 0.35, 0.5, 'highpass', 2000, 2000, 1);
        for (const f of [1760, 2637, 3520, 4699]) {
          this.tone(ctx, out, 'sine', f * (0.98 + Math.random() * 0.04), t, 0.5, 0.09);
        }
        break;
      case 'frozen':
        this.tone(ctx, out, 'sine', 1046.5, t, 0.4, 0.16, 1244.5);
        this.burst(ctx, out, t, 0.4, 0.12, 'highpass', 3000, 3000, 1);
        break;
      case 'hit': // tick
        this.tone(ctx, out, 'square', 1600, t, 0.03, 0.2, 900);
        break;
      case 'hurt': // soft low thud
        this.tone(ctx, out, 'sine', 180, t, 0.2, 0.4, 80);
        this.burst(ctx, out, t, 0.12, 0.2, 'lowpass', 400, 400, 0.7);
        break;
      case 'downed':
        // low falling tone
        this.tone(ctx, out, 'sine', 330, t, 0.9, 0.4, 70);
        this.tone(ctx, out, 'triangle', 165, t + 0.1, 0.8, 0.2, 55);
        break;
      case 'revived':
        // warm rising triad
        this.tone(ctx, out, 'sine', 261.6, t, 0.6, 0.3);
        this.tone(ctx, out, 'sine', 329.6, t + 0.12, 0.6, 0.28);
        this.tone(ctx, out, 'sine', 392, t + 0.24, 0.7, 0.3);
        this.chimeVoice(ctx, out, 784, t + 0.36, 0.14);
        break;
      case 'jump':
        this.tone(ctx, out, 'sine', 300, t, 0.14, 0.22, 620);
        break;
      case 'beacon':
        this.tone(ctx, out, 'sine', 587.33, t, 0.8, 0.22);
        this.tone(ctx, out, 'sine', 587.33 * 1.5, t, 0.8, 0.1);
        this.chimeVoice(ctx, out, 1174.66, t + 0.2, 0.1);
        break;
    }
  }

  private arp(ctx: AudioContext, out: AudioNode, freqs: number[], t: number, step: number, peak: number): void {
    freqs.forEach((f, i) => {
      this.chimeVoice(ctx, out, f, t + i * step, peak);
    });
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
