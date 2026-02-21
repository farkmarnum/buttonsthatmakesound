// Shared audio graph:
// source -> autotuneNode -> compressor -> makeupGain -> dryGain -> destination
//                                                    -> reverbSend -> convolver -> wetGain -> destination

let ctx, autotuneNode, compressor, makeupGain, dryGain, wetGain, convolver, reverbSend;
let inputNode; // the node sources should connect to
let initPromise;

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
  autotuneNode = new AudioWorkletNode(ctx, "autotune-processor", {
    parameterData: { retune: 0 },
  });

  compressor = ctx.createDynamicsCompressor();
  compressor.knee.value = 12;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.15;
  compressor.ratio.value = 1 + 0.3 * 11;
  compressor.threshold.value = -6 + 0.3 * -30;

  makeupGain = ctx.createGain();
  makeupGain.gain.value = computeMakeup(0.3);

  dryGain = ctx.createGain();
  dryGain.gain.value = 1;

  wetGain = ctx.createGain();
  wetGain.gain.value = 0;

  reverbSend = ctx.createGain();
  reverbSend.gain.value = 1;

  convolver = ctx.createConvolver();
  convolver.buffer = generateIR(ctx);

  autotuneNode.connect(compressor);
  compressor.connect(makeupGain);
  makeupGain.connect(dryGain).connect(ctx.destination);
  makeupGain.connect(reverbSend).connect(convolver).connect(wetGain).connect(ctx.destination);

  inputNode = autotuneNode;
}

function ensureCtx() {
  if (!initPromise) initPromise = init();
  return initPromise;
}

export async function getAudioContext() {
  await ensureCtx();
  return ctx;
}

export async function getInputNode() {
  await ensureCtx();
  return inputNode;
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
  autotuneNode.parameters.get("retune").value = amount;
}

export async function setScale(tonic, scale) {
  await ensureCtx();
  autotuneNode.port.postMessage({ type: "setScale", tonic, scale });
}
