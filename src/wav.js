const SILENCE_THRESHOLD = 0.1;

export async function trimSilence(blob) {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const data = buf.getChannelData(0);

  let start = 0;
  while (start < data.length && Math.abs(data[start]) < SILENCE_THRESHOLD)
    start++;
  const end = data.length - 1;

  if (start >= end) return blob;

  const len = end - start + 1;
  const fadeSamples = Math.min(Math.ceil(buf.sampleRate * 0.005), len);
  // AudioBuffer constructor avoids creating a throwaway AudioContext
  const trimBuf = new AudioBuffer({
    numberOfChannels: buf.numberOfChannels,
    length: len,
    sampleRate: buf.sampleRate,
  });
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const slice = buf.getChannelData(ch).slice(start, end + 1);
    for (let i = 0; i < fadeSamples; i++) {
      slice[i] *= i / fadeSamples;
      slice[slice.length - 1 - i] *= i / fadeSamples;
    }
    trimBuf.copyToChannel(slice, ch);
  }

  const numCh = trimBuf.numberOfChannels;
  const sr = trimBuf.sampleRate;
  const samples = trimBuf.length;
  const bitsPerSample = 16;
  const byteRate = sr * numCh * (bitsPerSample / 8);
  const dataSize = samples * numCh * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (off, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, numCh * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, trimBuf.getChannelData(ch)[i]));
      view.setInt16(offset, s * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}
