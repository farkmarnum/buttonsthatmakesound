import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  saveGrid,
  updateGrid,
  renameGrid,
  listGrids,
  loadGrid,
  deleteGrid,
  getActiveId,
  setActiveId,
} from "./db.js";
import {
  setCompressorMix,
  setReverbMix,
  setRetune,
  setScale,
  initAll,
} from "./audio.js";
import {
  startBeat,
  stopBeat,
  isPlaying,
  setBpm,
  setPattern,
  setBeatVolume,
} from "./beat.js";
import { Pad } from "./Pad.jsx";
import useStateRef from "./useStateRef.js";
import "./App.css";

function StopIcon() {
  return (
    <svg style={{marginTop: "2px"}} width="14" height="14" viewBox="0 0 12 12" fill="currentColor">
      <rect x="1" y="1" width="10" height="10" rx="1" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg style={{marginTop: "2px"}} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />
    </svg>
  );
}

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
const SCALE_TYPES = ["chromatic", "major", "minor", "pentatonic"];
const BEAT_PATTERNS = ["basic", "hiphop", "halftime"];
const KEYS = [
  "q",
  "w",
  "e",
  "r",
  "a",
  "s",
  "d",
  "f",
  "u",
  "i",
  "o",
  "p",
  "j",
  "k",
  "l",
  ";",
];

const DEFAULT_FX = {
  compress: 30,
  reverb: 50,
  retune: 50,
  tonic: 0,
  scaleType: "chromatic",
  tempo: 100,
  beatVol: 60,
  beatPattern: "basic",
};

function nextGridName(grids) {
  if (grids.length === 0) return "Grid";

  const used = new Set(grids.map((g) => g.name));
  let n = 1;
  while (used.has(`Grid ${n}`)) n++;
  return `Grid ${n}`;
}

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
        <h1>Buttons that make sound</h1>
        <p>Hold the buttons to record.</p>
        <p>Press the buttons to play.</p>
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
          <button type="button" className="panel-close" onClick={onClose}>
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const heldKeys = useRef(new Set());
  const recordingLock = useRef(false);

  const padRefs = useMemo(() => KEYS.map(() => ({ current: null })), []);

  const [shiftHeld, setShiftHeld, shiftRef] = useStateRef(false);
  const [savedGrids, setSavedGrids, savedGridsRef] = useStateRef([]);
  const [activeId, setActiveIdLocal, activeIdRef] = useStateRef(null);
  const [openPanel, setOpenPanel, openPanelRef] = useStateRef(null);

  const [activeName, setActiveName] = useState("Grid 1");
  const [beatOn, setBeatOn] = useState(false);
  const [hasAnySounds, setHasAnySounds] = useState(false);
  const playingPads = useRef(new Set());
  const [anyPlaying, setAnyPlaying] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renamingTitle, setRenamingTitle] = useState(false);
  const pendingLoad = useRef(null);
  const autoSaveTimer = useRef(null);

  // FX state
  const [compress, setCompress] = useState(DEFAULT_FX.compress);
  const [reverb, setReverb] = useState(DEFAULT_FX.reverb);
  const [retune, setRetuneVal] = useState(DEFAULT_FX.retune);
  const [tonic, setTonic] = useState(DEFAULT_FX.tonic);
  const [scaleType, setScaleType] = useState(DEFAULT_FX.scaleType);
  const [tempo, setTempo] = useState(DEFAULT_FX.tempo);
  const [beatVol, setBeatVol] = useState(DEFAULT_FX.beatVol);
  const [beatPattern, setBeatPatternState] = useState(DEFAULT_FX.beatPattern);

  const fxRef = useRef({ ...DEFAULT_FX });

  const setActiveGrid = useCallback(
    async (id) => {
      setActiveIdLocal(id);
      await setActiveId(id);
    },
    [setActiveIdLocal]
  );

  const getPadStates = useCallback(() => {
    return padRefs.map(
      (r) => r.current?.getState() ?? { hue: null, blob: null }
    );
  }, [padRefs]);

  const loadPadStates = useCallback(
    (pads) => {
      pads.forEach((state, i) => {
        padRefs[i].current?.loadState(state);
      });
    },
    [padRefs]
  );

  const applyFx = useCallback((fx) => {
    if (!fx) return;
    const c = fx.compress ?? DEFAULT_FX.compress;
    const r = fx.reverb ?? DEFAULT_FX.reverb;
    const rt = fx.retune ?? DEFAULT_FX.retune;
    const t = fx.tonic ?? DEFAULT_FX.tonic;
    const s = fx.scaleType ?? DEFAULT_FX.scaleType;
    const tp = fx.tempo ?? DEFAULT_FX.tempo;
    const bv = fx.beatVol ?? DEFAULT_FX.beatVol;
    const bp = fx.beatPattern ?? DEFAULT_FX.beatPattern;
    setCompress(c);
    setReverb(r);
    setRetuneVal(rt);
    setTonic(t);
    setScaleType(s);
    setTempo(tp);
    setBeatVol(bv);
    setBeatPatternState(bp);
    setCompressorMix(c / 100);
    setReverbMix(r / 100);
    setRetune(rt / 100);
    setScale(t, s);
    setBpm(tp);
    setBeatVolume(bv / 100);
    setPattern(bp);
    fxRef.current = {
      compress: c,
      reverb: r,
      retune: rt,
      tonic: t,
      scaleType: s,
      tempo: tp,
      beatVol: bv,
      beatPattern: bp,
    };
  }, []);

  const refreshList = useCallback(async () => {
    const grids = await listGrids();
    setSavedGrids(grids);
  }, [setSavedGrids]);

  // is called before any grid switch, preventing stale-grid saves)
  const autoSave = useCallback(() => {
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      const pads = getPadStates();
      const id = activeIdRef.current;
      const fx = { ...fxRef.current };
      if (id) {
        await updateGrid(id, pads, fx);
      } else {
        const newId = crypto.randomUUID();
        const name = nextGridName(savedGridsRef.current);
        await saveGrid(newId, name, pads, fx);
        setActiveGrid(newId);
        setActiveName(name);
      }
      refreshList();
    }, 800);
  }, [getPadStates, activeIdRef, savedGridsRef, setActiveGrid, refreshList]);

  const flushAutoSave = useCallback(async () => {
    if (!autoSaveTimer.current) return;
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = null;
    const id = activeIdRef.current;
    if (id) {
      await updateGrid(id, getPadStates(), { ...fxRef.current });
    }
  }, [getPadStates, activeIdRef]);

  useEffect(() => () => clearTimeout(autoSaveTimer.current), []);

  const saveFxChange = useCallback(
    (key, value) => {
      fxRef.current = { ...fxRef.current, [key]: value };
      if (activeIdRef.current) autoSave();
    },
    [autoSave, activeIdRef]
  );

  const recheckSounds = useCallback(() => {
    setHasAnySounds(padRefs.some((r) => r.current?.getState()?.blob));
  }, [padRefs]);

  const onPadChanged = useCallback(() => {
    recheckSounds();
    autoSave();
  }, [autoSave, recheckSounds]);

  const onPadPlayingChange = useCallback((padLabel, isPlaying) => {
    if (isPlaying) {
      playingPads.current.add(padLabel);
    } else {
      playingPads.current.delete(padLabel);
    }
    setAnyPlaying(playingPads.current.size > 0);
  }, []);

  const stopAllSounds = useCallback(() => {
    padRefs.forEach((r) => r.current?.release());
    padRefs.forEach((r) => r.current?.stopPlayback());
  }, [padRefs]);

  const togglePanel = useCallback(
    (name) => {
      setOpenPanel((cur) => (cur === name ? null : name));
    },
    [setOpenPanel]
  );

  const toggleBeat = useCallback(async () => {
    if (isPlaying()) {
      stopBeat();
      setBeatOn(false);
    } else {
      await startBeat();
      setBeatOn(true);
    }
  }, []);

  // Apply pending grid once pads are mounted
  useEffect(() => {
    if (ready && pendingLoad.current) {
      loadPadStates(pendingLoad.current.pads);
      applyFx(pendingLoad.current.fx);
      pendingLoad.current = null;
    }
  }, [ready, loadPadStates, applyFx]);

  // Load last active grid on startup
  useEffect(() => {
    (async () => {
      const grids = await listGrids();
      setSavedGrids(grids);
      const id = await getActiveId();
      if (id) {
        const grid = await loadGrid(id);
        if (grid) {
          setActiveIdLocal(id);
          setActiveName(grid.name);
          setHasAnySounds(grid.pads.some((p) => p?.blob));
          pendingLoad.current = { pads: grid.pads, fx: grid.fx };
          return;
        }
      }
      setActiveIdLocal(null);
      setActiveName(nextGridName(grids));
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.target.tagName === "INPUT") return;
      if (e.repeat || e.metaKey || e.ctrlKey) return;
      if (e.key.toLowerCase() === "x") {
        e.preventDefault();
        setShiftHeld((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (openPanelRef.current) {
          setOpenPanel(null);
          return;
        }
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
  }, [toggleBeat, padRefs, setShiftHeld, shiftRef, openPanelRef, setOpenPanel]);

  const checkEraseOff = useCallback(() => {
    const anyHaveSound = padRefs.some((r) => r.current?.getState()?.blob);
    if (!anyHaveSound) setShiftHeld(false);
    onPadChanged();
  }, [padRefs, setShiftHeld, onPadChanged]);

  const handleNew = useCallback(async () => {
    await flushAutoSave();
    padRefs.forEach((r) => r.current?.loadState(null));
    setShiftHeld(false);
    applyFx(DEFAULT_FX);
    const newId = crypto.randomUUID();
    const name = nextGridName(savedGridsRef.current);
    await saveGrid(newId, name, getPadStates(), DEFAULT_FX);
    await setActiveGrid(newId);
    setActiveName(name);
    refreshList();
  }, [
    flushAutoSave,
    padRefs,
    setShiftHeld,
    applyFx,
    savedGridsRef,
    getPadStates,
    setActiveGrid,
    refreshList,
  ]);

  const handleLoad = useCallback(
    async (id) => {
      await flushAutoSave();
      const grid = await loadGrid(id);
      if (!grid) return;
      loadPadStates(grid.pads);
      applyFx(grid.fx);
      await setActiveGrid(id);
      setActiveName(grid.name);
      setOpenPanel(null);
      recheckSounds();
    },
    [
      flushAutoSave,
      loadPadStates,
      applyFx,
      setActiveGrid,
      setOpenPanel,
      recheckSounds,
    ]
  );

  const handleDelete = useCallback(
    async (id) => {
      await flushAutoSave();
      await deleteGrid(id);
      if (activeIdRef.current === id) {
        padRefs.forEach((r) => r.current?.loadState(null));
        await setActiveGrid(null);
        const remaining = savedGridsRef.current.filter((g) => g.id !== id);
        setActiveName(nextGridName(remaining));
      }
      refreshList();
    },
    [
      flushAutoSave,
      activeIdRef,
      padRefs,
      savedGridsRef,
      setActiveGrid,
      refreshList,
    ]
  );

  const handleRename = useCallback(
    async (id, newName) => {
      if (!newName.trim()) return;
      await renameGrid(id, newName.trim());
      if (activeIdRef.current === id) setActiveName(newName.trim());
      refreshList();
      setRenamingId(null);
      setRenamingTitle(false);
    },
    [activeIdRef, refreshList]
  );

  if (!ready) return <StartModal onReady={() => setReady(true)} />;

  return (
    <div className="app">
      <div className="grid-name">
        {renamingTitle ? (
          <form
            className="rename-form"
            onSubmit={(e) => {
              e.preventDefault();
              handleRename(activeIdRef.current, e.target.elements.name.value);
            }}
          >
            <input
              name="name"
              defaultValue={activeName}
              autoFocus
              maxLength={40}
              onBlur={(e) => handleRename(activeIdRef.current, e.target.value)}
            />
          </form>
        ) : (
          <>
            {activeName}
            {activeId && (
              <button
                type="button"
                className="rename-btn"
                onClick={() => setRenamingTitle(true)}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  width="11"
                  height="11"
                >
                  <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                </svg>
              </button>
            )}
          </>
        )}
      </div>
      <div className="board-area">
        <button
          type="button"
          className="board-pill stop-pill"
          disabled={!anyPlaying}
          onClick={stopAllSounds}
        >
          <StopIcon />
        </button>
        <button
          type="button"
          className={`board-pill erase-pill ${shiftHeld ? "on" : ""}`}
          disabled={!hasAnySounds}
          onClick={() => setShiftHeld((v) => !v)}
        >
          {shiftHeld ? "done" : <TrashIcon />}
        </button>
        <div className="board">
          {KEYS.map((key, i) => (
            <Pad
              key={key}
              label={key}
              shiftHeld={shiftHeld}
              recordingLockRef={recordingLock}
              onErase={checkEraseOff}
              onChanged={onPadChanged}
              onPlayingChange={onPadPlayingChange}
              ref={padRefs[i]}
            />
          ))}
        </div>
      </div>
      <div className="toolbar">
        <button
          type="button"
          className={`toolbar-btn ${openPanel === "saved" ? "active" : ""}`}
          onClick={() => togglePanel("saved")}
        >
          grids
        </button>
        <button
          type="button"
          className={`toolbar-btn ${openPanel === "fx" ? "active" : ""}`}
          onClick={() => togglePanel("fx")}
        >
          fx
        </button>
        <button
          type="button"
          className={`toolbar-btn ${beatOn ? "on" : ""}`}
          onClick={toggleBeat}
        >
          {beatOn ? "stop" : "beat"}
        </button>
        <button
          type="button"
          className={`toolbar-btn ${openPanel === "beat" ? "active" : ""}`}
          onClick={() => togglePanel("beat")}
        >
          bpm
        </button>
      </div>

      <Panel
        open={openPanel === "saved"}
        onClose={() => setOpenPanel(null)}
        title="Saved Grids"
      >
        <button type="button" className="new-grid-btn" onClick={handleNew}>
          + new grid
        </button>
        <div className="saved-list">
          {savedGrids.length === 0 && (
            <p className="empty">No saved grids yet</p>
          )}
          {savedGrids.map((g) => (
            <div
              key={g.id}
              className={`saved-item ${g.id === activeId ? "active" : ""}`}
            >
              {renamingId === g.id ? (
                <form
                  className="rename-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleRename(g.id, e.target.elements.name.value);
                  }}
                >
                  <input
                    name="name"
                    defaultValue={g.name}
                    autoFocus
                    maxLength={40}
                    onBlur={(e) => handleRename(g.id, e.target.value)}
                  />
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="saved-name"
                    onClick={() => handleLoad(g.id)}
                  >
                    {g.id === activeId && <span className="active-dot" />}
                    {g.name}
                  </button>
                  <button
                    type="button"
                    className="rename-btn"
                    onClick={() => setRenamingId(g.id)}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      width="11"
                      height="11"
                    >
                      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    </svg>
                  </button>
                </>
              )}
              <button
                type="button"
                className="saved-delete"
                onClick={() => handleDelete(g.id)}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        open={openPanel === "fx"}
        onClose={() => setOpenPanel(null)}
        title="Effects"
      >
        <div className="controls">
          <label className="slider-label">
            compress
            <input
              type="range"
              min="0"
              max="100"
              value={compress}
              onChange={(e) => {
                const v = Number(e.target.value);
                setCompress(v);
                setCompressorMix(v / 100);
                saveFxChange("compress", v);
              }}
            />
          </label>
          <label className="slider-label">
            reverb
            <input
              type="range"
              min="0"
              max="100"
              value={reverb}
              onChange={(e) => {
                const v = Number(e.target.value);
                setReverb(v);
                setReverbMix(v / 100);
                saveFxChange("reverb", v);
              }}
            />
          </label>
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={retune > 0}
              onChange={(e) => {
                const v = e.target.checked ? 100 : 0;
                setRetuneVal(v);
                setRetune(v / 100);
                saveFxChange("retune", v);
              }}
            />
            autotune
          </label>
          {retune > 0 && (
            <div className="scale-controls">
              <label className="select-label">
                key
                <select
                  value={tonic}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    setTonic(v);
                    setScale(v, scaleType);
                    saveFxChange("tonic", v);
                  }}
                >
                  {NOTE_NAMES.map((n, i) => (
                    <option key={n} value={i}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="select-label">
                scale
                <select
                  value={scaleType}
                  onChange={(e) => {
                    setScaleType(e.target.value);
                    setScale(tonic, e.target.value);
                    saveFxChange("scaleType", e.target.value);
                  }}
                >
                  {SCALE_TYPES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      </Panel>

      <Panel
        open={openPanel === "beat"}
        onClose={() => setOpenPanel(null)}
        title="Beat Settings"
      >
        <div className="controls">
          <label className="slider-label">
            {tempo} bpm
            <input
              type="range"
              min="60"
              max="180"
              value={tempo}
              onChange={(e) => {
                const v = Number(e.target.value);
                setTempo(v);
                setBpm(v);
                saveFxChange("tempo", v);
              }}
            />
          </label>
          <label className="slider-label">
            volume {beatVol}%
            <input
              type="range"
              min="0"
              max="100"
              value={beatVol}
              onChange={(e) => {
                const v = Number(e.target.value);
                setBeatVol(v);
                setBeatVolume(v / 100);
                saveFxChange("beatVol", v);
              }}
            />
          </label>
          <label className="select-label">
            pattern
            <select
              value={beatPattern}
              onChange={(e) => {
                setBeatPatternState(e.target.value);
                setPattern(e.target.value);
                saveFxChange("beatPattern", e.target.value);
              }}
            >
              {BEAT_PATTERNS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Panel>
    </div>
  );
}
