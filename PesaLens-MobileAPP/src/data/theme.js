import { useEffect, useState } from 'react';

const KEY = 'pesalens-theme';

const apply = (theme) => {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('light', theme === 'light');
  document.documentElement.dataset.theme = theme;
  // sync mobile address-bar color
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#FAFAFC' : '#08090C');
};

export const getTheme = () => {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
};

export const setTheme = (theme) => {
  try {
    localStorage.setItem(KEY, theme);
    apply(theme);
    window.dispatchEvent(new CustomEvent('pesalens:theme', { detail: theme }));
  } catch {
    // ignore
  }
};

export const useTheme = () => {
  const [theme, setLocal] = useState(getTheme);

  useEffect(() => {
    apply(theme);
    const sync = () => setLocal(getTheme());
    window.addEventListener('pesalens:theme', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('pesalens:theme', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const toggle = () => setTheme(theme === 'light' ? 'dark' : 'light');

  return [theme, toggle, setTheme];
};
