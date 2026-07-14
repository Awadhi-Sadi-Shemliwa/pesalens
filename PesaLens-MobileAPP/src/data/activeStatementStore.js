// Active-statement store (mobile) — the single statement the user is focused
// on, shared across Dashboard → Personal Spending → Reconciliation so all three
// surfaces scope to the same upload. Set by the Dashboard statement selector.
//
// Mirrors the web src/data/activeStatement.js and authStore.js's event shape.
// The job_id is a non-sensitive opaque id, so plain localStorage (available in
// the Capacitor WebView) is fine — no Preferences / Keystore needed here.

import { useEffect, useState } from 'react';

const KEY = 'pesalens.activeStatement';
const EVENT = 'pesalens:active-statement';

export const getActiveStatement = () => {
  try {
    return localStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
};

export const setActiveStatement = (jobId) => {
  try {
    if (jobId) localStorage.setItem(KEY, jobId);
    else localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: jobId || null }));
  } catch {
    // ignore — a failed write just means scoping falls back to "newest".
  }
};

export const useActiveStatement = () => {
  const [jobId, setLocal] = useState(getActiveStatement);

  useEffect(() => {
    const sync = () => setLocal(getActiveStatement());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return [jobId, setActiveStatement];
};
