import { useState, useRef, useEffect } from 'react';

export const useInView = (opts = { threshold: 0.1 }) => {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setVisible(true);
    }, opts);

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [opts]);

  return [ref, visible];
};

