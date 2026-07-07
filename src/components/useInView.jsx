import { useState, useRef, useEffect } from 'react';

// Stable module-level default so the effect doesn't re-run (and disconnect the
// observer before its async intersection callback fires) on every re-render.
const DEFAULT_OPTS = { threshold: 0.1 };

export const useInView = (opts = DEFAULT_OPTS) => {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setVisible(true);
    }, optsRef.current);

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return [ref, visible];
};

