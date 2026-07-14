// Active-statement store — the single statement the user is currently focused
// on, shared across Dashboard → Personal Spending → Reconciliation so all three
// surfaces scope to the same upload. Set by the Dashboard statement selector.
//
// Mirrors the theme.js pattern: localStorage for persistence + a CustomEvent so
// every mounted `useActiveStatement()` re-renders the instant the selection
// changes (and the `storage` event keeps other tabs in sync). Holding only the
// job_id (a non-sensitive opaque id) is enough — pages fetch the statement's
// details from the API.

import { useEffect, useState } from 'react';

const KEY = 'pesalens-active-statement';
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
