// Autotune AudioWorklet: YIN pitch detection + Bernsee phase-vocoder pitch shifting
// Based on Stephan Bernsee's "Pitch Shifting Using The Fourier Transform"

const FFT_SIZE = 2048;
const HALF = FFT_SIZE / 2;
const OSAMP = 8;
const HOP = FFT_SIZE / OSAMP;
const TWO_PI = 2 * Math.PI;
const EXPECT = TWO_PI * HOP / FFT_SIZE;

// scale intervals (semitones from tonic)
const SCALES = {
  chromatic:  [0,1,2,3,4,5,6,7,8,9,10,11],
  major:      [0,2,4,5,7,9,11],
  minor:      [0,2,3,5,7,8,10],
  pentatonic: [0,2,4,7,9],
};

function buildNoteTable(tonic, scale) {
  const intervals = SCALES[scale] || SCALES.chromatic;
  const notes = [];
  // generate all octaves C1(midi 24) through C7(midi 96)
  for (let oct = 0; oct < 8; oct++) {
    for (const iv of intervals) {
      const midi = tonic + iv + (oct * 12);
      if (midi < 24 || midi > 96) continue;
      notes.push(440 * Math.pow(2, (midi - 69) / 12));
    }
  }
  return notes;
}

function nearestNote(freq, notes) {
  let best = notes[0], bestD = Infinity;
  for (const n of notes) {
    const d = Math.abs(1200 * Math.log2(freq / n));
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

// ---- in-place radix-2 FFT (Cooley-Tukey) ----
function fft(re, im, inv) {
  const n = re.length;
  // bit-reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inv ? TWO_PI : -TWO_PI) / len;
    const wR = Math.cos(ang), wI = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curR = 1, curI = 0;
      for (let j = 0; j < len / 2; j++) {
        const uR = re[i + j], uI = im[i + j];
        const vR = re[i + j + len / 2] * curR - im[i + j + len / 2] * curI;
        const vI = re[i + j + len / 2] * curI + im[i + j + len / 2] * curR;
        re[i + j] = uR + vR; im[i + j] = uI + vI;
        re[i + j + len / 2] = uR - vR; im[i + j + len / 2] = uI - vI;
        const tmpR = curR * wR - curI * wI;
        curI = curR * wI + curI * wR;
        curR = tmpR;
      }
    }
  }
  if (inv) { for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; } }
}

// ---- YIN pitch detection ----
function detectPitch(buf, sr) {
  const half = buf.length >> 1;
  const d = new Float32Array(half);
  for (let tau = 0; tau < half; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) { const x = buf[i] - buf[i + tau]; sum += x * x; }
    d[tau] = sum;
  }
  d[0] = 1;
  let run = 0;
  for (let tau = 1; tau < half; tau++) { run += d[tau]; d[tau] = d[tau] * tau / run; }
  for (let tau = 2; tau < half; tau++) {
    if (d[tau] < 0.2) {
      while (tau + 1 < half && d[tau + 1] < d[tau]) tau++;
      const s0 = d[tau - 1], s1 = d[tau], s2 = tau + 1 < half ? d[tau + 1] : s1;
      const off = (s0 - s2) / (2 * (s0 - 2 * s1 + s2)) || 0;
      return sr / (tau + off);
    }
  }
  return 0;
}

// ---- Bernsee phase vocoder pitch shifting ----
function pitchShift(shiftFactor, buf, sr, lastPhase, sumPhase) {
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const mag = new Float32Array(HALF + 1);
  const freq = new Float32Array(HALF + 1);
  const sMag = new Float32Array(HALF + 1);
  const sFreq = new Float32Array(HALF + 1);
  const freqPerBin = sr / FFT_SIZE;

  // window input
  for (let i = 0; i < FFT_SIZE; i++) {
    const w = -0.5 * Math.cos(TWO_PI * i / FFT_SIZE) + 0.5;
    re[i] = buf[i] * w;
    im[i] = 0;
  }

  fft(re, im, false);

  // analysis
  for (let k = 0; k <= HALF; k++) {
    mag[k] = 2 * Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    const phase = Math.atan2(im[k], re[k]);
    let dp = phase - lastPhase[k];
    lastPhase[k] = phase;
    dp -= k * EXPECT;
    // map into +/- pi
    let qpd = (dp / Math.PI) | 0;
    if (qpd >= 0) qpd += qpd & 1; else qpd -= qpd & 1;
    dp -= Math.PI * qpd;
    dp = OSAMP * dp / TWO_PI;
    freq[k] = k * freqPerBin + dp * freqPerBin;
  }

  // shift
  for (let k = 0; k <= HALF; k++) {
    const idx = Math.round(k * shiftFactor);
    if (idx <= HALF) {
      sMag[idx] += mag[k];
      sFreq[idx] = freq[k] * shiftFactor;
    }
  }

  // synthesis
  for (let k = 0; k <= HALF; k++) {
    let dp = sFreq[k];
    dp -= k * freqPerBin;
    dp /= freqPerBin;
    dp = TWO_PI * dp / OSAMP;
    dp += k * EXPECT;
    sumPhase[k] += dp;
    const ph = sumPhase[k];
    re[k] = sMag[k] * Math.cos(ph);
    im[k] = sMag[k] * Math.sin(ph);
  }
  // zero negative freqs
  for (let k = HALF + 1; k < FFT_SIZE; k++) { re[k] = 0; im[k] = 0; }

  fft(re, im, true);

  // window output and normalize for overlap-add
  // with Hann window and OSAMP oversampling, the OLA normalization is 2/3 * 1/OSAMP * 4
  // empirically: scale = 2.0 / OSAMP gives unity gain
  const scale = 2.0 / OSAMP;
  const out = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    const w = -0.5 * Math.cos(TWO_PI * i / FFT_SIZE) + 0.5;
    out[i] = re[i] * w * scale;
  }
  return out;
}

class AutotuneProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.fifoIn = new Float32Array(FFT_SIZE);
    this.fifoOut = new Float32Array(FFT_SIZE);
    this.fifoPos = 0;
    this.lastPhase = new Float32Array(HALF + 1);
    this.sumPhase = new Float32Array(HALF + 1);
    this.currentShift = 1.0;
    this.fifoPos = FFT_SIZE - HOP;
    // default: C chromatic
    this.notes = buildNoteTable(0, "chromatic");
    this.port.onmessage = (e) => {
      if (e.data.type === "setScale") {
        this.notes = buildNoteTable(e.data.tonic, e.data.scale);
      } else if (e.data.type === "flush") {
        this.fifoIn.fill(0);
        this.fifoOut.fill(0);
        this.lastPhase.fill(0);
        this.sumPhase.fill(0);
        this.fifoPos = FFT_SIZE - HOP;
        this.currentShift = 1.0;
      }
    };
  }

  static get parameterDescriptors() {
    return [{ name: "retune", defaultValue: 0, minValue: 0, maxValue: 1 }];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;

    const retune = parameters.retune.length > 1 ? parameters.retune[0] : parameters.retune[0];
    if (retune === 0) {
      output.set(input);
      return true;
    }

    const sr = sampleRate;

    for (let s = 0; s < input.length; s++) {
      // push sample into FIFO
      this.fifoIn[this.fifoPos] = input[s];
      output[s] = this.fifoOut[this.fifoPos - (FFT_SIZE - HOP)];
      this.fifoPos++;

      if (this.fifoPos >= FFT_SIZE) {
        this.fifoPos = FFT_SIZE - HOP;

        // detect pitch on the current frame
        const freq = detectPitch(this.fifoIn, sr);
        let targetShift = 1.0;
        if (freq > 60 && freq < 1200) {
          targetShift = nearestNote(freq, this.notes) / freq;
        }

        // smooth toward target — retune controls speed
        // 1 = instant snap, small values = gentle drift
        const speed = 0.05 + retune * 0.95;
        this.currentShift += (targetShift - this.currentShift) * speed;

        // phase vocoder pitch shift
        const shifted = pitchShift(this.currentShift, this.fifoIn, sr, this.lastPhase, this.sumPhase);

        // overlap-add into output FIFO
        for (let i = 0; i < FFT_SIZE; i++) {
          this.fifoOut[i] += shifted[i];
        }

        // shift FIFOs
        for (let i = 0; i < FFT_SIZE - HOP; i++) {
          this.fifoIn[i] = this.fifoIn[i + HOP];
          this.fifoOut[i] = this.fifoOut[i + HOP];
        }
        for (let i = FFT_SIZE - HOP; i < FFT_SIZE; i++) {
          this.fifoOut[i] = 0;
        }

      }
    }

    return true;
  }
}

registerProcessor("autotune-processor", AutotuneProcessor);
