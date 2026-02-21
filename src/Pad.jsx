import { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from "react";
import { getAudioContext, createPadNode, destroyPadNode, flushPadNode, getMicStream } from "./audio.js";
import { trimSilence } from "./wav.js";

function randomHue() {
  return Math.floor(Math.random() * 360);
}

export const Pad = forwardRef(function Pad({ label, shiftHeld, onErase, onChanged }, ref) {
  const [hue, setHue] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [hasSound, setHasSound] = useState(false);
  const audioRef = useRef(null);
  const blobRef = useRef(null);
  const mediaRecRef = useRef(null);
  const playerRef = useRef(null);
  const recordingRef = useRef(false);
  const decodedRef = useRef(null);
  const autotuneRef = useRef(null);

  const ensureAutotuneNode = useCallback(async () => {
    if (!autotuneRef.current) {
      autotuneRef.current = await createPadNode();
    }
    return autotuneRef.current;
  }, []);

  useEffect(() => () => destroyPadNode(autotuneRef.current), []);

  const stopPlayback = useCallback(() => {
    if (playerRef.current) {
      try { playerRef.current.stop(); } catch { /* already stopped */ }
      playerRef.current.disconnect();
      playerRef.current = null;
    }
    flushPadNode(autotuneRef.current);
    setPlaying(false);
  }, []);

  const play = useCallback(async () => {
    stopPlayback();
    const actx = await getAudioContext();
    if (!decodedRef.current && blobRef.current) {
      decodedRef.current = await actx.decodeAudioData(await blobRef.current.arrayBuffer());
    }
    if (!decodedRef.current) return;
    const node = await ensureAutotuneNode();
    const src = actx.createBufferSource();
    src.buffer = decodedRef.current;
    src.connect(node);
    src.onended = () => setPlaying(false);
    playerRef.current = src;
    setPlaying(true);
    src.start();
  }, [stopPlayback, ensureAutotuneNode]);

  const startRecording = useCallback(() => {
    stopPlayback();
    let stream;
    try { stream = getMicStream(); } catch { return; }
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

  const trigger = useCallback(
    (shiftKey) => {
      if (shiftKey) { loadState(null); onErase?.(); return; }
      if (hasSound) { play(); return; }
      startRecording();
    },
    [hasSound, play, startRecording, loadState, onErase],
  );

  const release = useCallback(() => {
    if (recordingRef.current) stopRecording();
  }, [stopRecording]);

  const getState = useCallback(() => ({
    hue,
    blob: blobRef.current,
  }), [hue]);

  useImperativeHandle(ref, () => ({
    trigger, release, stopPlayback, getState, loadState,
  }), [trigger, release, stopPlayback, getState, loadState]);

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
