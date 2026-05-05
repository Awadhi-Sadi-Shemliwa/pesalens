import { useEffect, useState } from 'react';

const KEY = 'pesalens.userType';
const VALID = new Set(['individual', 'business']);

const read = () => {
  try {
    const raw = localStorage.getItem(KEY);
    return VALID.has(raw) ? raw : 'individual';
  } catch {
    return 'individual';
  }
};

export const getUserType = read;

export const setUserType = (value) => {
  const safe = VALID.has(value) ? value : 'individual';
  try {
    localStorage.setItem(KEY, safe);
    window.dispatchEvent(new CustomEvent('pesalens:user-type', { detail: safe }));
  } catch {
    // localStorage unavailable
  }
};

export const useUserType = () => {
  const [type, setType] = useState(read);

  useEffect(() => {
    const sync = () => setType(read());
    window.addEventListener('pesalens:user-type', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('pesalens:user-type', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return [type, (next) => { setUserType(next); setType(next); }];
};
