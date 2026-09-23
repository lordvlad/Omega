import { useEffect, useRef, useState } from "react";

/**
 * Keeps `isSpinning` true for integer multiples of `cycleMs` (default 750ms)
 * so a rotating reload icon always completes at least 1 full 360° rotation
 * even if the network response resolves in a few milliseconds.
 */
export function useSpinning(loading: boolean, cycleMs = 750): boolean {
  const [spinning, setSpinning] = useState(false);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (loading) {
      startRef.current = Date.now();
      setSpinning(true);
    } else if (spinning && startRef.current !== null) {
      const elapsed = Date.now() - startRef.current;
      const remainder = elapsed % cycleMs;
      const delay = remainder === 0 ? 0 : cycleMs - remainder;
      const timer = setTimeout(() => {
        setSpinning(false);
        startRef.current = null;
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [loading, spinning, cycleMs]);

  return spinning;
}
