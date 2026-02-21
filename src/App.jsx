import { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from "react";
import "./App.css";

const KEYS = ["q","w","e","r","a","s","d","f","u","i","o","p","j","k","l",";"];
const GRID_SIZE = KEYS.length;
const SILENCE_THRESHOLD = 0.02;

function randomHue() {
  return Math.floor(Math.random() * 360);
}

async function trimSilence(blob) {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const data = buf.getChannelData(0);

  let start = 0;
  while (start < data.length && Math.abs(data[start]) < SILENCE_THRESHOLD)
    start++;
  let end = data.length - 1;
  while (end > start && Math.abs(data[end]) < SILENCE_THRESHOLD) end--;

  if (start >= end) return blob;

  const trimmed = new AudioContext();
  const len = end - start + 1;
  const trimBuf = trimmed.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    trimBuf.copyToChannel(buf.getChannelData(ch).slice(start, end + 1), ch);
  }
  trimmed.close();

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

const Pad = forwardRef(function Pad({ label }, ref) {
  const [hue, setHue] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const audioRef = useRef(null);
  const mediaRecRef = useRef(null);
  const playerRef = useRef(null);
  const recordingRef = useRef(false);

  const hasSound = audioRef.current !== null;

  const stopPlayback = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.pause();
      playerRef.current.currentTime = 0;
      playerRef.current = null;
    }
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    stopPlayback();
    const a = new Audio(audioRef.current);
    a.onended = () => setPlaying(false);
    playerRef.current = a;
    setPlaying(true);
    a.play();
  }, [stopPlayback]);

  const startRecording = useCallback(async () => {
    stopPlayback();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    const chunks = [];
    mr.ondataavailable = (e) => chunks.push(e.data);
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (chunks.length) {
        const raw = new Blob(chunks, { type: "audio/webm" });
        const trimmed = await trimSilence(raw);
        if (audioRef.current) URL.revokeObjectURL(audioRef.current);
        audioRef.current = URL.createObjectURL(trimmed);
        setHue(randomHue());
      }
      setRecording(false);
      recordingRef.current = false;
    };
    mediaRecRef.current = mr;
    mr.start();
    setRecording(true);
    recordingRef.current = true;
  }, [stopPlayback]);

  const stopRecording = useCallback(() => {
    if (mediaRecRef.current?.state === "recording") {
      mediaRecRef.current.stop();
      mediaRecRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stopPlayback();
    if (audioRef.current) URL.revokeObjectURL(audioRef.current);
    audioRef.current = null;
    setHue(null);
  }, [stopPlayback]);

  const trigger = useCallback(
    (shiftKey) => {
      if (shiftKey) { reset(); return; }
      if (hasSound) { play(); return; }
      startRecording();
    },
    [hasSound, play, startRecording, reset],
  );

  const release = useCallback(() => {
    if (recordingRef.current) stopRecording();
  }, [stopRecording]);

  useImperativeHandle(ref, () => ({ trigger, release }), [trigger, release]);

  const onPointerDown = useCallback((e) => trigger(e.shiftKey), [trigger]);
  const onPointerUp = useCallback(() => release(), [release]);

  let bg;
  if (recording) {
    bg = "hsl(0 90% 50%)";
  } else if (hue !== null) {
    bg = playing ? `hsl(${hue} 90% 60%)` : `hsl(${hue} 50% 40%)`;
  } else {
    bg = "#555";
  }

  return (
    <button
      type="button"
      className="pad"
      style={{ background: bg }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {recording ? "REC" : label}
    </button>
  );
});

export default function App() {
  const padRefs = useRef(KEYS.map(() => ({ current: null })));
  const heldKeys = useRef(new Set());

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.repeat) return;
      const idx = KEYS.indexOf(e.key.toLowerCase());
      if (idx === -1) return;
      e.preventDefault();
      heldKeys.current.add(e.key.toLowerCase());
      padRefs.current[idx].current?.trigger(e.shiftKey);
    };
    const onKeyUp = (e) => {
      const key = e.key.toLowerCase();
      if (!heldKeys.current.has(key)) return;
      heldKeys.current.delete(key);
      const idx = KEYS.indexOf(key);
      if (idx === -1) return;
      padRefs.current[idx].current?.release();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  return (
    <div className="board">
      {KEYS.map((key, i) => (
        <Pad key={key} label={key} ref={padRefs.current[i]} />
      ))}
    </div>
  );
}
