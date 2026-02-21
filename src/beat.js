// Simple drum machine with synthesized sounds and lookahead scheduling.
// Has its own bus straight to destination (independent of pad compressor/limiter).

import { getAudioContext } from "./audio.js";

let playing = false;
let bpm = 100;
let currentStep = 0;
let nextStepTime = 0;
let timerID = null;
let pattern = "basic";
let beatGain = null;
let drumBus = null; // internal node synths connect to

// patterns: 16-step, each step has [kick, snare, hihat]
const PATTERNS = {
  basic: [
    [1, 0, 1],
    [0, 0, 1],
    [0, 1, 1],
    [0, 0, 1],
    [1, 0, 1],
    [0, 0, 1],
    [0, 1, 1],
    [0, 0, 1],
    [1, 0, 1],
    [0, 0, 1],
    [0, 1, 1],
    [0, 0, 1],
    [1, 0, 1],
    [0, 0, 1],
    [0, 1, 1],
    [0, 0, 1],
  ],
  hiphop: [
    [1, 0, 1],
    [0, 0, 0],
    [0, 0, 1],
    [0, 0, 0],
    [0, 1, 1],
    [0, 0, 0],
    [0, 0, 1],
    [1, 0, 0],
    [1, 0, 1],
    [0, 0, 0],
    [0, 0, 1],
    [0, 0, 0],
    [0, 1, 1],
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 0],
  ],
  halftime: [
    [1, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
    [0, 1, 1],
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
    [0, 1, 1],
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
  ],
};

// Soft-clip saturation curve
function makeSaturationCurve(amount, samples = 256) {
  const curve = new Float32Array(samples);
  const k = amount * 50;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

function initBus(ctx) {
  if (drumBus) return;

  // Low shelf: boost sub weight
  const lowShelf = ctx.createBiquadFilter();
  lowShelf.type = "lowshelf";
  lowShelf.frequency.value = 100;
  lowShelf.gain.value = 4;

  // High shelf: not so bright
  const hiShelf = ctx.createBiquadFilter();
  hiShelf.type = "highshelf";
  hiShelf.frequency.value = 6000;
  hiShelf.gain.value = -2.5;

  // Mid peak: snare body presence
  const midPeak = ctx.createBiquadFilter();
  midPeak.type = "peaking";
  midPeak.frequency.value = 3500;
  midPeak.Q.value = 1.2;
  midPeak.gain.value = 3;

  // Saturation
  const saturator = ctx.createWaveShaper();
  saturator.curve = makeSaturationCurve(0.05);
  // saturator.oversample = "16x";

  // Output gain
  beatGain = ctx.createGain();
  beatGain.gain.value = 0.6;

  // Drum bus is the entry point synths connect to
  drumBus = ctx.createGain();
  drumBus.gain.value = 1;

  // Chain: drumBus -> lowShelf -> midPeak -> saturator -> beatGain -> destination
  drumBus
    .connect(lowShelf)
    .connect(hiShelf)
    .connect(midPeak)
    .connect(saturator)
    .connect(beatGain)
    .connect(ctx.destination);
}

function synthKick(ctx, dest, time) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(150, time);
  osc.frequency.exponentialRampToValueAtTime(30, time + 0.12);
  g.gain.setValueAtTime(0.65, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
  osc.connect(g).connect(dest);
  osc.start(time);
  osc.stop(time + 0.3);
}

function synthSnare(ctx, dest, time) {
  // noise burst
  const len = ctx.sampleRate * 0.15;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const nG = ctx.createGain();
  nG.gain.setValueAtTime(0.5, time);
  nG.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1000;
  noise.connect(hp).connect(nG).connect(dest);
  noise.start(time);
  noise.stop(time + 0.15);
  // body tone
  const osc = ctx.createOscillator();
  const oG = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(200, time);
  osc.frequency.exponentialRampToValueAtTime(80, time + 0.07);
  oG.gain.setValueAtTime(0.5, time);
  oG.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
  osc.connect(oG).connect(dest);
  osc.start(time);
  osc.stop(time + 0.1);
}

function synthHihat(ctx, dest, time) {
  const len = ctx.sampleRate * 0.05;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.25, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 8000;
  bp.Q.value = 1;
  src.connect(bp).connect(g).connect(dest);
  src.start(time);
  src.stop(time + 0.05);
}

function scheduleStep(ctx, dest, step, time) {
  const pat = PATTERNS[pattern] || PATTERNS.basic;
  const s = pat[step % pat.length];
  if (s[0]) synthKick(ctx, dest, time);
  if (s[1]) synthSnare(ctx, dest, time);
  if (s[2]) synthHihat(ctx, dest, time);
}

const LOOKAHEAD = 0.1; // seconds
const INTERVAL = 25; // ms

async function scheduler() {
  const ctx = await getAudioContext();
  initBus(ctx);
  while (nextStepTime < ctx.currentTime + LOOKAHEAD) {
    scheduleStep(ctx, drumBus, currentStep, nextStepTime);
    const stepDur = 60 / bpm / 2; // 8th notes
    nextStepTime += stepDur;
    currentStep = (currentStep + 1) % 16;
  }
  if (playing) timerID = setTimeout(scheduler, INTERVAL);
}

export async function startBeat() {
  if (playing) return;
  const ctx = await getAudioContext();
  playing = true;
  currentStep = 0;
  nextStepTime = ctx.currentTime + 0.05;
  scheduler();
}

export function stopBeat() {
  playing = false;
  if (timerID) {
    clearTimeout(timerID);
    timerID = null;
  }
}

export function isPlaying() {
  return playing;
}

export function setBpm(v) {
  bpm = v;
}

export function setPattern(p) {
  pattern = p;
}

export function setBeatVolume(v) {
  if (beatGain) beatGain.gain.value = v;
}
