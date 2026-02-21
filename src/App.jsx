import { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from "react";
import { saveGrid, updateGrid, renameGrid, listGrids, loadGrid, deleteGrid, getActiveId, setActiveId } from "./db.js";
import { getAudioContext, getInputNode, setCompressorMix, setReverbMix, setRetune, setScale, initAll, getMicStream, flushAutotune } from "./audio.js";
import { startBeat, stopBeat, isPlaying, setBpm, setPattern, setBeatVolume } from "./beat.js";
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

const Pad = forwardRef(function Pad({ label, shiftHeld, onErase, onChanged }, ref) {
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
    flushAutotune();
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
        onChanged?.();
      }
      setRecording(false);
      recordingRef.current = false;
    };
    mediaRecRef.current = mr;
    mr.start();
    setRecording(true);
    recordingRef.current = true;
  }, [stopPlayback, onChanged]);

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

function Panel({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <h2>{title}</h2>
          <button type="button" className="panel-close" onClick={onClose}>&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const padRefs = KEYS.map(() => ({ current: null }));

function nextGridName(grids) {
  const used = new Set(grids.map((g) => g.name));
  let n = 1;
  while (used.has(`Grid ${n}`)) n++;
  return `Grid ${n}`;
}

function getPadStates() {
  return padRefs.map((r) => r.current?.getState() ?? { hue: null, blob: null });
}

function loadPadStates(pads) {
  pads.forEach((state, i) => { padRefs[i].current?.loadState(state); });
}

export default function App() {
  const [ready, setReady] = useState(false);
  const heldKeys = useRef(new Set());
  const [savedGrids, setSavedGrids] = useState([]);
  const [shiftHeld, setShiftHeld] = useState(false);
  const shiftRef = useRef(false);
  const [beatOn, setBeatOn] = useState(false);
  const [openPanel, setOpenPanel] = useState(null);
  const [tempo, setTempo] = useState(100);
  const [beatVol, setBeatVol] = useState(60);
  const [hasAnySounds, setHasAnySounds] = useState(false);

  // Active grid tracking
  const [activeId, setActiveIdState] = useState(null);
  const [activeName, setActiveName] = useState("Grid 1");
  const activeIdRef = useRef(null);
  const autoSaveTimer = useRef(null);
  const [renamingId, setRenamingId] = useState(null);
  const savedGridsRef = useRef([]);

  const refreshList = useCallback(async () => {
    const grids = await listGrids();
    savedGridsRef.current = grids;
    setSavedGrids(grids);
  }, []);

  // Auto-save: debounced persist of current grid
  const autoSave = useCallback(() => {
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      const pads = getPadStates();
      const id = activeIdRef.current;
      if (id) {
        await updateGrid(id, pads);
      } else {
        // Create a new grid
        const newId = crypto.randomUUID();
        const name = nextGridName(savedGridsRef.current);
        await saveGrid(newId, name, pads);
        await setActiveId(newId);
        activeIdRef.current = newId;
        setActiveIdState(newId);
        setActiveName(name);
      }
      refreshList();
    }, 800);
  }, [refreshList]);

  const recheckSounds = useCallback(() => {
    setHasAnySounds(padRefs.some((r) => r.current?.getState()?.blob));
  }, []);

  // Notify auto-save after pad changes
  const onPadChanged = useCallback(() => {
    recheckSounds();
    autoSave();
  }, [autoSave, recheckSounds]);

  const togglePanel = useCallback((name) => {
    setOpenPanel((cur) => cur === name ? null : name);
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

  // Load last active grid on startup
  useEffect(() => {
    (async () => {
      const grids = await listGrids();
      savedGridsRef.current = grids;
      setSavedGrids(grids);
      const id = await getActiveId();
      if (id) {
        const grid = await loadGrid(id);
        if (grid) {
          activeIdRef.current = id;
          setActiveIdState(id);
          setActiveName(grid.name);
          // Defer loading until pads are mounted
          setTimeout(() => {
            loadPadStates(grid.pads);
            setHasAnySounds(grid.pads.some((p) => p?.blob));
          }, 0);
          return;
        }
      }
      // No active grid — start fresh
      activeIdRef.current = null;
      setActiveIdState(null);
      setActiveName(nextGridName(grids));
    })();
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey) return;
      if (e.key.toLowerCase() === "x") {
        e.preventDefault();
        shiftRef.current = !shiftRef.current;
        setShiftHeld(shiftRef.current);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (openPanel) { setOpenPanel(null); return; }
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
  }, [toggleBeat, openPanel]);

  const checkEraseOff = useCallback(() => {
    const anyHaveSound = padRefs.some((r) => r.current?.getState()?.blob);
    if (!anyHaveSound) {
      shiftRef.current = false;
      setShiftHeld(false);
    }
    onPadChanged();
  }, [onPadChanged]);

  // "New" — blank grid, new slot
  const handleNew = useCallback(async () => {
    padRefs.forEach((r) => r.current?.reset());
    shiftRef.current = false;
    setShiftHeld(false);
    const newId = crypto.randomUUID();
    const name = nextGridName(savedGridsRef.current);
    await saveGrid(newId, name, getPadStates());
    await setActiveId(newId);
    activeIdRef.current = newId;
    setActiveIdState(newId);
    setActiveName(name);
    refreshList();
  }, [refreshList]);

  // "Save as" — copy current grid to a new named slot
  const handleSaveAs = useCallback(async () => {
    const name = prompt("Name this grid:");
    if (!name) return;
    const pads = getPadStates();
    const newId = crypto.randomUUID();
    await saveGrid(newId, name, pads);
    await setActiveId(newId);
    activeIdRef.current = newId;
    setActiveIdState(newId);
    setActiveName(name);
    refreshList();
  }, [refreshList]);

  const handleLoad = useCallback(async (id) => {
    const grid = await loadGrid(id);
    if (!grid) return;
    loadPadStates(grid.pads);
    await setActiveId(id);
    activeIdRef.current = id;
    setActiveIdState(id);
    setActiveName(grid.name);
    setOpenPanel(null);
    recheckSounds();
  }, [recheckSounds]);

  const handleDelete = useCallback(async (id) => {
    await deleteGrid(id);
    if (activeIdRef.current === id) {
      // Deleted the active grid — start fresh
      padRefs.forEach((r) => r.current?.reset());
      activeIdRef.current = null;
      setActiveIdState(null);
      await setActiveId(null);
      // Name will update after refreshList, compute with current knowledge
      const remaining = savedGridsRef.current.filter((g) => g.id !== id);
      setActiveName(nextGridName(remaining));
    }
    refreshList();
  }, [refreshList]);

  const handleRename = useCallback(async (id, newName) => {
    if (!newName.trim()) return;
    await renameGrid(id, newName.trim());
    if (activeIdRef.current === id) setActiveName(newName.trim());
    refreshList();
    setRenamingId(null);
  }, [refreshList]);

  if (!ready) return <StartModal onReady={() => setReady(true)} />;

  return (
    <div className="app">
      <div className="grid-name">{activeName}</div>
      <div className="board">
        {KEYS.map((key, i) => (
          <Pad key={key} label={key} shiftHeld={shiftHeld} onErase={checkEraseOff}
            onChanged={onPadChanged} ref={padRefs[i]} />
        ))}
        <button type="button" className="board-btn save-btn" onClick={handleSaveAs}>save as</button>
        <button type="button" className={`board-btn erase-btn ${shiftHeld ? "on" : ""}`}
          disabled={!hasAnySounds}
          onClick={() => setShiftHeld((v) => { shiftRef.current = !v; return !v; })}>
          erase
        </button>
        <button type="button" className="board-btn clear-btn" disabled={!hasAnySounds}
          onClick={handleNew}>new</button>
      </div>
      <div className="toolbar">
        <button type="button" className={`toolbar-btn ${openPanel === "saved" ? "active" : ""}`}
          onClick={() => togglePanel("saved")}>load</button>
        <button type="button" className={`toolbar-btn ${openPanel === "fx" ? "active" : ""}`}
          onClick={() => togglePanel("fx")}>fx</button>
        <button type="button" className={`toolbar-btn ${beatOn ? "on" : ""}`}
          onClick={toggleBeat}>{beatOn ? "stop" : "beat"}</button>
        <button type="button" className={`toolbar-btn ${openPanel === "beat" ? "active" : ""}`}
          onClick={() => togglePanel("beat")}>bpm</button>
      </div>

      <Panel open={openPanel === "saved"} onClose={() => setOpenPanel(null)} title="Saved Grids">
        <div className="saved-list">
          {savedGrids.length === 0 && <p className="empty">No saved grids yet</p>}
          {savedGrids.map((g) => (
            <div key={g.id} className={`saved-item ${g.id === activeId ? "active" : ""}`}>
              {renamingId === g.id ? (
                <form className="rename-form" onSubmit={(e) => {
                  e.preventDefault();
                  handleRename(g.id, e.target.elements.name.value);
                }}>
                  <input name="name" defaultValue={g.name} autoFocus
                    onBlur={(e) => handleRename(g.id, e.target.value)} />
                </form>
              ) : (
                <button type="button" className="saved-name" onClick={() => handleLoad(g.id)}
                  onDoubleClick={(e) => { e.preventDefault(); setRenamingId(g.id); }}>
                  {g.id === activeId && <span className="active-dot" />}
                  {g.name}
                </button>
              )}
              <button type="button" className="saved-delete" onClick={() => handleDelete(g.id)}>
                &times;
              </button>
            </div>
          ))}
        </div>
      </Panel>

      <Panel open={openPanel === "fx"} onClose={() => setOpenPanel(null)} title="Effects">
        <div className="controls">
          <label className="slider-label">
            compress
            <input type="range" min="0" max="100" defaultValue="30"
              onChange={(e) => setCompressorMix(e.target.value / 100)} />
          </label>
          <label className="slider-label">
            reverb
            <input type="range" min="0" max="100" defaultValue="50"
              onChange={(e) => setReverbMix(e.target.value / 100)} />
          </label>
          <label className="slider-label">
            retune
            <input type="range" min="0" max="100" defaultValue="50"
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
      </Panel>

      <Panel open={openPanel === "beat"} onClose={() => setOpenPanel(null)} title="Beat Settings">
        <div className="controls">
          <label className="slider-label">
            {tempo} bpm
            <input type="range" min="60" max="180" value={tempo} onChange={(e) => {
              const v = Number(e.target.value);
              setTempo(v);
              setBpm(v);
            }} />
          </label>
          <label className="slider-label">
            volume {beatVol}%
            <input type="range" min="0" max="100" value={beatVol} onChange={(e) => {
              const v = Number(e.target.value);
              setBeatVol(v);
              setBeatVolume(v / 100);
            }} />
          </label>
          <label className="select-label">
            pattern
            <select defaultValue="basic" onChange={(e) => setPattern(e.target.value)}>
              {BEAT_PATTERNS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        </div>
      </Panel>
    </div>
  );
}
