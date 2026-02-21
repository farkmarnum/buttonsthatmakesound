// Shared audio graph (per-pad autotune):
// source -> [pad autotuneNode] -> compressor -> makeupGain -> dryGain  -> limiter -> destination
//                                                           -> reverbSend -> convolver -> wetGain -> limiter
// beat -> beatGain -> destination (separate)

let ctx, compressor, makeupGain, dryGain, wetGain, convolver, reverbSend, limiter;
let compressorInput; // node that per-pad autotune nodes connect to
let initPromise;
let micStream = null;

// Track all live per-pad autotune nodes for broadcasting retune/scale changes
const padNodes = new Set();
let currentRetune = 0.5;
let currentTonic = 0;
let currentScale = "chromatic";

function generateIR(ctx, duration = 2, decay = 2) {
  const len = ctx.sampleRate * duration;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

function computeMakeup(amount) {
  const threshold = -6 + amount * -30;
  const ratio = 1 + amount * 11;
  const over = Math.max(0, -12 - threshold);
  const reductionDb = over - over / ratio;
  return Math.pow(10, (reductionDb * 1.5) / 20);
}

async function init() {
  if (ctx) return;
  ctx = new AudioContext();

  await ctx.audioWorklet.addModule("/autotune-processor.js");

  compressor = ctx.createDynamicsCompressor();
  compressor.knee.value = 12;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.15;
  compressor.ratio.value = 1 + 0.3 * 11;
  compressor.threshold.value = -6 + 0.3 * -30;

  makeupGain = ctx.createGain();
  makeupGain.gain.value = computeMakeup(0.3);

  dryGain = ctx.createGain();
  dryGain.gain.value = 1 - 0.5 * 0.5;

  wetGain = ctx.createGain();
  wetGain.gain.value = 0.5;

  reverbSend = ctx.createGain();
  reverbSend.gain.value = 1;

  convolver = ctx.createConvolver();
  convolver.buffer = generateIR(ctx);

  // Master limiter — brickwall at -3dB
  // Soft knee + slow release to avoid distortion when we're hitting the limits
  limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 6;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.2;

  // Per-pad autotune nodes will connect to compressorInput
  compressorInput = compressor;
  compressor.connect(makeupGain);
  makeupGain.connect(dryGain).connect(limiter);
  makeupGain.connect(reverbSend).connect(convolver).connect(wetGain).connect(limiter);
  limiter.connect(ctx.destination);
}

function ensureCtx() {
  if (!initPromise) initPromise = init();
  return initPromise;
}

export async function getAudioContext() {
  await ensureCtx();
  return ctx;
}

export async function getMasterNode() {
  await ensureCtx();
  return limiter;
}

// Create a per-pad autotune node wired to the compressor input.
// Caller is responsible for connecting their source to the returned node.
export async function createPadNode() {
  await ensureCtx();
  const node = new AudioWorkletNode(ctx, "autotune-processor", {
    parameterData: { retune: currentRetune },
  });
  node.port.postMessage({ type: "setScale", tonic: currentTonic, scale: currentScale });
  node.connect(compressorInput);
  padNodes.add(node);
  return node;
}

// Remove a pad node from tracking and disconnect it
export function destroyPadNode(node) {
  if (!node) return;
  padNodes.delete(node);
  try { node.disconnect(); } catch { /* already disconnected */ }
}

// Flush a specific pad's autotune buffers
export function flushPadNode(node) {
  if (node) node.port.postMessage({ type: "flush" });
}

export async function setCompressorMix(amount) {
  await ensureCtx();
  compressor.ratio.value = 1 + amount * 11;
  compressor.threshold.value = -6 + amount * -30;
  makeupGain.gain.value = computeMakeup(amount);
}

export async function setReverbMix(amount) {
  await ensureCtx();
  dryGain.gain.value = 1 - amount * 0.5;
  wetGain.gain.value = amount;
}

export async function setRetune(amount) {
  await ensureCtx();
  currentRetune = amount;
  for (const node of padNodes) {
    node.parameters.get("retune").value = amount;
  }
}

export async function setScale(tonic, scale) {
  await ensureCtx();
  currentTonic = tonic;
  currentScale = scale;
  for (const node of padNodes) {
    node.port.postMessage({ type: "setScale", tonic, scale });
  }
}

// Shared mic stream — acquired once, kept warm for instant recording
export async function acquireMic() {
  if (micStream) return micStream;
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return micStream;
}

export function releaseMic() {
  if (!micStream) return;
  micStream.getTracks().forEach((t) => t.stop());
  micStream = null;
}

export function getMicStream() {
  if (!micStream) throw new Error("Microphone not available. Please grant mic access and reload.");
  return micStream;
}

export async function checkMicPermission() {
  if (navigator.permissions?.query) {
    try {
      const status = await navigator.permissions.query({ name: "microphone" });
      return status.state;
    } catch { /* some browsers don't support this query */ }
  }
  return "prompt";
}

// Release mic when page is hidden, re-acquire when visible
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      releaseMic();
    } else if (ctx) {
      acquireMic();
    }
  });
}

// Call this from the start modal — initializes audio context + mic in one gesture
export async function initAll() {
  await ensureCtx();
  await acquireMic();
}
