// Procedural audio via WebAudio: engine tone, tyre hiss on slip, impact thuds. No assets.
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(ctx.destination);

    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc.frequency.value = 60;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0.05;
    this.osc.connect(lp).connect(this.engGain).connect(this.master);
    this.osc.start();

    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buf;
    this.noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.7;
    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    this.noise.connect(bp).connect(this.tyreGain).connect(this.master);
    this.noise.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.05);
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  update(speedKmh, throttle, slip) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 52 + speedKmh * 1.7 + throttle * 18;
    this.osc.frequency.setTargetAtTime(f, t, 0.08);
    this.engGain.gain.setTargetAtTime(0.035 + throttle * 0.03, t, 0.1);
    this.tyreGain.gain.setTargetAtTime(Math.min(0.22, Math.max(0, slip - 0.12) * 0.6), t, 0.08);
  }

  impact(strength = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.35);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.value = Math.min(1, 0.25 + strength * 0.5);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
  }

  chime(up = true) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t = ctx.currentTime;
    o.type = 'sine';
    o.frequency.setValueAtTime(up ? 660 : 330, t);
    o.frequency.exponentialRampToValueAtTime(up ? 990 : 220, t + 0.25);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.45);
  }
}
