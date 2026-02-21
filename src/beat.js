// Simple drum machine with synthesized sounds and lookahead scheduling.
// Connects directly to ctx.destination (bypasses autotune/compressor chain).

import { getAudioContext, getMasterNode } from "./audio.js";

let playing = false;
let bpm = 100;
let currentStep = 0;
let nextStepTime = 0;
let timerID = null;
let pattern = "basic";
let beatGain = null;

// patterns: 16-step, each step has [kick, snare, hihat]
const PATTERNS = {
  basic: [
    [1,0,1],[0,0,1],[0,1,1],[0,0,1],
    [1,0,1],[0,0,1],[0,1,1],[0,0,1],
    [1,0,1],[0,0,1],[0,1,1],[0,0,1],
    [1,0,1],[0,0,1],[0,1,1],[0,0,1],
  ],
  hiphop: [
    [1,0,1],[0,0,0],[0,0,1],[0,0,0],
    [0,1,1],[0,0,0],[0,0,1],[1,0,0],
    [1,0,1],[0,0,0],[0,0,1],[0,0,0],
    [0,1,1],[0,0,1],[0,0,1],[0,0,0],
  ],
  halftime: [
    [1,0,1],[0,0,1],[0,0,1],[0,0,1],
    [0,1,1],[0,0,1],[0,0,1],[0,0,1],
    [0,0,1],[0,0,1],[0,0,1],[0,0,1],
    [0,1,1],[0,0,1],[0,0,1],[0,0,1],
  ],
};



function synthKick(ctx, dest, time) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(150, time);
  osc.frequency.exponentialRampToValueAtTime(30, time + 0.12);
  g.gain.setValueAtTime(0.8, time);
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
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1);
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
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1);
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
const INTERVAL = 25;   // ms

async function scheduler() {
  const ctx = await getAudioContext();
  if (!beatGain) {
    beatGain = ctx.createGain();
    beatGain.gain.value = 0.6;
    beatGain.connect(await getMasterNode());
  }
  while (nextStepTime < ctx.currentTime + LOOKAHEAD) {
    scheduleStep(ctx, beatGain, currentStep, nextStepTime);
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
  if (timerID) { clearTimeout(timerID); timerID = null; }
}

export function isPlaying() { return playing; }

export function setBpm(v) { bpm = v; }

export function setPattern(p) { pattern = p; }

export function setBeatVolume(v) { if (beatGain) beatGain.gain.value = v; }
