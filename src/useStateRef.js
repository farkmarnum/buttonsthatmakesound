import { useState, useRef, useCallback } from "react";

/** useState + useRef kept in sync. Ref is always current, avoids stale closures. */
export default function useStateRef(initial) {
  const [state, setState] = useState(initial);
  const ref = useRef(initial);
  const set = useCallback((v) => {
    const next = typeof v === "function" ? v(ref.current) : v;
    ref.current = next;
    setState(next);
  }, []);
  return [state, set, ref];
}
