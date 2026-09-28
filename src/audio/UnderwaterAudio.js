/**
 * Self-contained Web Audio API Synthesizer for Underwater Ambience & Shark Feeding SFX
 */

export class UnderwaterAudio {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.isInitialized = false;

    // Ambient loop nodes
    this.ambientGain = null;
    this.whooshGain = null;
  }

  init() {
    if (this.isInitialized) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      // Master Gain
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.5;
      this.masterGain.connect(this.ctx.destination);

      // 1. Ambient Deep Ocean Rumble
      this.setupAmbience();

      this.isInitialized = true;
    } catch (e) {
      console.warn('Web Audio not supported or blocked:', e);
    }
  }

  setupAmbience() {
    if (!this.ctx) return;

    // Brown noise generator for deep water hydrophone drone
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let lastOut = 0.0;

    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = output[i];
      output[i] *= 3.5; // Gain compensation
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    // Deep low-pass filter (simulates water muffling)
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 160;

    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0.35;

    whiteNoise.connect(filter);
    filter.connect(this.ambientGain);
    this.ambientGain.connect(this.masterGain);

    whiteNoise.start(0);

    // Dynamic water whoosh synth
    this.whooshFilter = this.ctx.createBiquadFilter();
    this.whooshFilter.type = 'bandpass';
    this.whooshFilter.frequency.value = 240;
    this.whooshFilter.Q.value = 2.0;

    this.whooshGain = this.ctx.createGain();
    this.whooshGain.gain.value = 0.0;

    const whooshNoise = this.ctx.createBufferSource();
    whooshNoise.buffer = noiseBuffer;
    whooshNoise.loop = true;

    whooshNoise.connect(this.whooshFilter);
    this.whooshFilter.connect(this.whooshGain);
    this.whooshGain.connect(this.masterGain);
    whooshNoise.start(0);
  }

  updateSpeed(speedRatio) {
    if (!this.ctx || !this.whooshGain) return;
    const targetWhoosh = Math.min(0.5, speedRatio * 0.25);
    this.whooshGain.gain.setTargetAtTime(targetWhoosh, this.ctx.currentTime, 0.2);
  }

  playBiteSnap() {
    if (!this.ctx || this.isMuted) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const now = this.ctx.currentTime;

    // 1. Heavy low impact transient
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.12);

    oscGain.gain.setValueAtTime(0.7, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.2);

    // 2. High snap / bone-crunch burst
    const snapOsc = this.ctx.createOscillator();
    const snapGain = this.ctx.createGain();
    snapOsc.type = 'sawtooth';
    snapOsc.frequency.setValueAtTime(800, now);
    snapOsc.frequency.exponentialRampToValueAtTime(140, now + 0.08);

    snapGain.gain.setValueAtTime(0.4, now);
    snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    snapOsc.connect(snapGain);
    snapGain.connect(this.masterGain);
    snapOsc.start(now);
    snapOsc.stop(now + 0.1);
  }

  playThrash() {
    if (!this.ctx || this.isMuted) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const now = this.ctx.currentTime;
    // Violent water churning burst
    for (let i = 0; i < 4; i++) {
      const burstTime = now + i * 0.18;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(90 + Math.random() * 40, burstTime);
      osc.frequency.linearRampToValueAtTime(40, burstTime + 0.15);

      gain.gain.setValueAtTime(0.45, burstTime);
      gain.gain.exponentialRampToValueAtTime(0.001, burstTime + 0.16);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(burstTime);
      osc.stop(burstTime + 0.18);
    }
  }

  playRush() {
    if (!this.ctx || this.isMuted) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(60, now);
    osc.frequency.linearRampToValueAtTime(110, now + 0.5);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.linearRampToValueAtTime(0.5, now + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.65);
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.masterGain) {
      this.masterGain.gain.value = this.isMuted ? 0 : 0.5;
    }
    return this.isMuted;
  }
}
