import { useEffect, useState } from 'react';

/* Extracted so `common.jsx` can read it without importing `motion.jsx`, which
   imports `common.jsx` back (readToken) and would form a cycle. */
export const useReducedMotion = () => {
  const [reduced, setReduced] = useState(
    typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
};
