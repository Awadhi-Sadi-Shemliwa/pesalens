/* MotionProvider — resolves how much motion this device/user should get.
   `lite` is the single downgrade switch consumed across the motion system:
   reduced-motion users, save-data connections, touch devices and narrow
   screens all get the lightweight treatment (no WebGL, fewer instances,
   no hover-only fx). */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useReducedMotion } from '../components/useReducedMotion';
import { MOTION } from './registry';

const MotionCtx = createContext({
  reduced: false,
  lite: false,
  isTouch: false,
  saveData: false,
});

const LITE_MAX_WIDTH = 768;

export const MotionProvider = ({ children }) => {
  const reduced = useReducedMotion();
  const [isTouch, setIsTouch] = useState(false);
  const [narrow, setNarrow] = useState(
    typeof window !== 'undefined' && window.innerWidth < LITE_MAX_WIDTH
  );

  useEffect(() => {
    const touchMq = window.matchMedia('(pointer: coarse)');
    const widthMq = window.matchMedia(`(max-width: ${LITE_MAX_WIDTH - 1}px)`);
    const sync = () => {
      setIsTouch(touchMq.matches);
      setNarrow(widthMq.matches);
    };
    sync();
    touchMq.addEventListener?.('change', sync);
    widthMq.addEventListener?.('change', sync);
    return () => {
      touchMq.removeEventListener?.('change', sync);
      widthMq.removeEventListener?.('change', sync);
    };
  }, []);

  const saveData = typeof navigator !== 'undefined' && !!navigator.connection?.saveData;

  const value = useMemo(
    () => ({
      reduced,
      isTouch,
      saveData,
      lite: reduced || saveData || isTouch || narrow,
    }),
    [reduced, isTouch, saveData, narrow]
  );

  return <MotionCtx.Provider value={value}>{children}</MotionCtx.Provider>;
};

export const useMotionEnv = () => useContext(MotionCtx);

/** Resolved motion config for a registry section — intensity applied. */
export const useMotion = (sectionId) => {
  const env = useMotionEnv();
  const base = MOTION[sectionId];
  return useMemo(() => {
    if (!base) return { id: sectionId, background: 'none', heading: 'none', card: 'none', ...env };
    return { ...base, intensity: env.lite ? 'lite' : 'full', ...env };
  }, [base, sectionId, env]);
};
