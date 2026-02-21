import { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from "react";
import { saveGrid, listGrids, loadGrid, deleteGrid } from "./db.js";
import { getAudioContext, getInputNode, setCompressorMix, setReverbMix, setRetune, setScale, checkMicPermission, initAll, getMicStream } from "./audio.js";
import { startBeat, stopBeat, isPlaying, setBpm, setPattern } from "./beat.js";
import "./App.css";

const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const SCALE_TYPES = ["chromatic","major","minor","pentatonic"];
const BEAT_PATTERNS = ["basic","hiphop","halftime"];

const KEYS = ["q","w","e","r","a","s","d","f","u","i","o","p","j","k","l",";"];
const SILENCE_THRESHOLD = 0.04;

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
  const fadeSamples = Math.min(Math.ceil(buf.sampleRate * 0.002), len); // 2ms
  const trimBuf = trimmed.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const slice = buf.getChannelData(ch).slice(start, end + 1);
    for (let i = 0; i < fadeSamples; i++) {
      slice[i] *= i / fadeSamples;
      slice[slice.length - 1 - i] *= i / fadeSamples;
    }
    trimBuf.copyToChannel(slice, ch);
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

const Pad = forwardRef(function Pad({ label, shiftHeld, onErase }, ref) {
  const [hue, setHue] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [hasSound, setHasSound] = useState(false);
  const audioRef = useRef(null);   // blob URL
  const blobRef = useRef(null);    // raw blob for serialization
  const mediaRecRef = useRef(null);
  const playerRef = useRef(null);
  const recordingRef = useRef(false);

  const decodedRef = useRef(null); // cached AudioBuffer

  const stopPlayback = useCallback(() => {
    if (playerRef.current) {
      try { playerRef.current.stop(); } catch { /* already stopped */ }
      playerRef.current.disconnect();
      playerRef.current = null;
    }
    setPlaying(false);
  }, []);

  const play = useCallback(async () => {
    stopPlayback();
    const actx = await getAudioContext();
    if (!decodedRef.current && blobRef.current) {
      decodedRef.current = await actx.decodeAudioData(await blobRef.current.arrayBuffer());
    }
    if (!decodedRef.current) return;
    const src = actx.createBufferSource();
    src.buffer = decodedRef.current;
    src.connect(await getInputNode());
    src.onended = () => setPlaying(false);
    playerRef.current = src;
    setPlaying(true);
    src.start();
  }, [stopPlayback]);

  const startRecording = useCallback(() => {
    stopPlayback();
    const stream = getMicStream();
    if (!stream) return;
    const mr = new MediaRecorder(stream);
    const chunks = [];
    mr.ondataavailable = (e) => chunks.push(e.data);
    mr.onstop = async () => {
      if (chunks.length) {
        const raw = new Blob(chunks, { type: "audio/webm" });
        const trimmed = await trimSilence(raw);
        if (audioRef.current) URL.revokeObjectURL(audioRef.current);
        blobRef.current = trimmed;
        decodedRef.current = null;
        audioRef.current = URL.createObjectURL(trimmed);
        setHasSound(true);
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
    blobRef.current = null;
    decodedRef.current = null;
    setHasSound(false);
    setHue(null);
  }, [stopPlayback]);

  const trigger = useCallback(
    (shiftKey) => {
      if (shiftKey) { reset(); onErase?.(); return; }
      if (hasSound) { play(); return; }
      startRecording();
    },
    [hasSound, play, startRecording, reset, onErase],
  );

  const release = useCallback(() => {
    if (recordingRef.current) stopRecording();
  }, [stopRecording]);

  const getState = useCallback(() => ({
    hue,
    blob: blobRef.current,
  }), [hue]);

  const loadState = useCallback((state) => {
    stopPlayback();
    if (audioRef.current) URL.revokeObjectURL(audioRef.current);
    decodedRef.current = null;
    if (state?.blob) {
      blobRef.current = state.blob;
      audioRef.current = URL.createObjectURL(state.blob);
      setHasSound(true);
      setHue(state.hue);
    } else {
      blobRef.current = null;
      audioRef.current = null;
      setHasSound(false);
      setHue(null);
    }
  }, [stopPlayback]);

  useImperativeHandle(ref, () => ({ trigger, release, reset, stopPlayback, getState, loadState }), [trigger, release, reset, stopPlayback, getState, loadState]);

  const onPointerDown = useCallback(() => trigger(shiftHeld), [trigger, shiftHeld]);
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
      {shiftHeld && hasSound && <span className="pad-delete">-</span>}
      {recording ? "REC" : label}
    </button>
  );
});

function StartModal({ onReady }) {
  const [error, setError] = useState(null);

  const handleStart = useCallback(async () => {
    try {
      await initAll();
      onReady();
    } catch {
      setError("Microphone access is required to record sounds.");
    }
  }, [onReady]);

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h1>buttons that make sound</h1>
        {error && <p className="modal-error">{error}</p>}
        <button type="button" className="modal-start" onClick={handleStart}>
          Start
        </button>
      </div>
    </div>
  );
}

function BeatControls({ beatOn, onToggleBeat }) {
  const [tempo, setTempo] = useState(100);

  const handleTempo = useCallback((e) => {
    const v = Number(e.target.value);
    setTempo(v);
    setBpm(v);
  }, []);

  const handlePattern = useCallback((e) => {
    setPattern(e.target.value);
  }, []);

  return (
    <div className="beat-controls">
      <button type="button" className={`beat-toggle ${beatOn ? "on" : ""}`} onClick={onToggleBeat}>
        {beatOn ? "stop" : "beat"}
      </button>
      <label className="slider-label beat-tempo">
        {tempo} bpm
        <input type="range" min="60" max="180" value={tempo} onChange={handleTempo} />
      </label>
      <label className="select-label">
        pattern
        <select defaultValue="basic" onChange={handlePattern}>
          {BEAT_PATTERNS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
    </div>
  );
}

const padRefs = KEYS.map(() => ({ current: null }));

export default function App() {
  const [ready, setReady] = useState(false);
  const heldKeys = useRef(new Set());
  const [savedGrids, setSavedGrids] = useState([]);
  const [shiftHeld, setShiftHeld] = useState(false);
  const shiftRef = useRef(false);
  const [beatOn, setBeatOn] = useState(false);

  // Auto-skip modal if mic permission already granted
  useEffect(() => {
    checkMicPermission().then(async (state) => {
      if (state === "granted") {
        await initAll();
        setReady(true);
      }
    });
  }, []);

  const toggleBeat = useCallback(async () => {
    if (isPlaying()) {
      stopBeat();
      setBeatOn(false);
    } else {
      await startBeat();
      setBeatOn(true);
    }
  }, []);

  const refreshList = useCallback(async () => {
    setSavedGrids(await listGrids());
  }, []);

  useEffect(() => { listGrids().then(setSavedGrids); }, []);

  useEffect(() => {
    const onBeforeUnload = (e) => {
      const hasWork = padRefs.some((r) => r.current?.getState()?.blob);
      if (hasWork) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Shift") {
        shiftRef.current = !shiftRef.current;
        setShiftHeld(shiftRef.current);
        return;
      }
      if (e.repeat || e.metaKey || e.ctrlKey) return;
      if (e.key === "Escape") {
        e.preventDefault();
        padRefs.forEach((r) => r.current?.release());
        padRefs.forEach((r) => r.current?.stopPlayback());
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        toggleBeat();
        return;
      }
      const idx = KEYS.indexOf(e.key.toLowerCase());
      if (idx === -1) return;
      e.preventDefault();
      heldKeys.current.add(e.key.toLowerCase());
      padRefs[idx].current?.trigger(shiftRef.current);
    };
    const onKeyUp = (e) => {
      if (e.key === "Shift") return;
      const key = e.key.toLowerCase();
      if (!heldKeys.current.has(key)) return;
      heldKeys.current.delete(key);
      const idx = KEYS.indexOf(key);
      if (idx === -1) return;
      padRefs[idx].current?.release();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [toggleBeat]);

  const checkEraseOff = useCallback(() => {
    const anyHaveSound = padRefs.some((r) => r.current?.getState()?.blob);
    if (!anyHaveSound) {
      shiftRef.current = false;
      setShiftHeld(false);
    }
  }, []);

  const clearAll = useCallback(() => {
    padRefs.forEach((r) => r.current?.reset());
    shiftRef.current = false;
    setShiftHeld(false);
  }, []);

  const handleSave = useCallback(async () => {
    const name = prompt("Name this grid:");
    if (!name) return;
    const pads = padRefs.map((r) => r.current?.getState() ?? { hue: null, blob: null });
    await saveGrid(crypto.randomUUID(), name, pads);
    refreshList();
  }, [refreshList]);

  const handleLoad = useCallback(async (id) => {
    const grid = await loadGrid(id);
    if (!grid) return;
    grid.pads.forEach((state, i) => {
      padRefs[i].current?.loadState(state);
    });
  }, []);

  const handleDelete = useCallback(async (id) => {
    await deleteGrid(id);
    refreshList();
  }, [refreshList]);

  if (!ready) return <StartModal onReady={() => setReady(true)} />;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-inner">
          <h2>Saved</h2>
          <div className="saved-list">
            {savedGrids.length === 0 && <p className="empty">No saved grids</p>}
            {savedGrids.map((g) => (
              <div key={g.id} className="saved-item">
                <button type="button" className="saved-name" onClick={() => handleLoad(g.id)}>
                  {g.name}
                </button>
                <button type="button" className="saved-delete" onClick={() => handleDelete(g.id)}>
                  &times;
                </button>
              </div>
            ))}
          </div>
          <div className="controls">
            <label className="slider-label">
              compress
              <input type="range" min="0" max="100" defaultValue="30"
                onChange={(e) => setCompressorMix(e.target.value / 100)} />
            </label>
            <label className="slider-label">
              reverb
              <input type="range" min="0" max="100" defaultValue="0"
                onChange={(e) => setReverbMix(e.target.value / 100)} />
            </label>
            <label className="slider-label">
              retune
              <input type="range" min="0" max="100" defaultValue="0"
                onChange={(e) => setRetune(e.target.value / 100)} />
            </label>
            <div className="scale-controls">
              <label className="select-label">
                key
                <select defaultValue="0" onChange={(e) => {
                  const tonic = parseInt(e.target.value);
                  const scaleEl = e.target.closest(".scale-controls").querySelector("[data-role=scale]");
                  setScale(tonic, scaleEl.value);
                }}>
                  {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
                </select>
              </label>
              <label className="select-label">
                scale
                <select defaultValue="chromatic" data-role="scale" onChange={(e) => {
                  const scale = e.target.value;
                  const tonicEl = e.target.closest(".scale-controls").querySelector("select:not([data-role])");
                  setScale(parseInt(tonicEl.value), scale);
                }}>
                  {SCALE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>
          </div>
        </div>
      </aside>
      <main>
        <div className="board">
          {KEYS.map((key, i) => (
            <Pad key={key} label={key} shiftHeld={shiftHeld} onErase={checkEraseOff} ref={padRefs[i]} />
          ))}
          <button type="button" className="board-btn save-btn" onClick={handleSave}>
            save
          </button>
          <button type="button" className={`board-btn erase-btn ${shiftHeld ? "on" : ""}`}
            onClick={() => setShiftHeld((v) => { shiftRef.current = !v; return !v; })}>
            erase
          </button>
          <button type="button" className="board-btn clear-btn" onClick={clearAll}>
            clear
          </button>
        </div>
        <BeatControls beatOn={beatOn} onToggleBeat={toggleBeat} />
      </main>
    </div>
  );
}
