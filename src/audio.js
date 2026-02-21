// Shared audio graph:
// source -> compressor -> dryGain -\
//                      -> reverbSend -> convolver -> wetGain -\-> destination

let ctx, compressor, makeupGain, dryGain, wetGain, convolver, reverbSend;

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

// estimate makeup gain from compression amount (0-1)
// as threshold drops and ratio rises, we boost to compensate
function computeMakeup(amount) {
  const threshold = -6 + amount * -30;
  const ratio = 1 + amount * 11;
  // approximate gain reduction at -12dBFS input level, with extra boost
  const over = Math.max(0, -12 - threshold);
  const reductionDb = over - over / ratio;
  return Math.pow(10, (reductionDb * 1.5) / 20);
}

function ensureCtx() {
  if (ctx) return;
  ctx = new AudioContext();

  compressor = ctx.createDynamicsCompressor();
  compressor.knee.value = 12;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.15;
  // defaults matching slider at 30%
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

  compressor.connect(makeupGain);
  makeupGain.connect(dryGain).connect(ctx.destination);
  makeupGain.connect(reverbSend).connect(convolver).connect(wetGain).connect(ctx.destination);
}

export function getAudioContext() {
  ensureCtx();
  return ctx;
}

export function getInputNode() {
  ensureCtx();
  return compressor;
}

export function setCompressorMix(amount) {
  // amount 0-1: 0 = no compression, 1 = full compression
  ensureCtx();
  compressor.ratio.value = 1 + amount * 11;
  compressor.threshold.value = -6 + amount * -30;
  makeupGain.gain.value = computeMakeup(amount);
}

export function setReverbMix(amount) {
  // amount 0-1: dry/wet crossfade
  ensureCtx();
  dryGain.gain.value = 1 - amount * 0.5; // keep some dry always
  wetGain.gain.value = amount;
}
