/* Theme-token helpers for animated components.
   Tokens live as space-separated RGB channels (e.g. `--c-accent: 48 220 130`)
   on :root — see index.css. These readers convert them into the formats the
   animation components need, and re-read when the theme flips. */
import { useEffect, useState } from 'react';

const FALLBACKS = {
  '--c-accent': '48 220 130',
  '--c-accent-h': '74 235 150',
  '--c-accent-d': '28 180 104',
  '--c-net': '56 132 245',
  '--c-inc': '16 185 129',
  '--c-deep': '7 11 10',
  '--c-t1': '236 240 238',
};

const channels = (name) => {
  if (typeof window === 'undefined') return FALLBACKS[name] || '255 255 255';
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return (raw || FALLBACKS[name] || '255 255 255').replace(/\s+/g, ' ');
};

/** "48, 220, 130" — for `rgba(${x}, 0.4)` string interpolation (MagicBento etc.) */
export const tokenChannels = (name) => channels(name).split(' ').join(', ');

/** "#30dc82" — for shader color props (ogl Color, gradient stops) */
export const tokenHex = (name) => {
  const [r, g, b] = channels(name).split(' ').map((n) => Math.max(0, Math.min(255, Number(n) || 0)));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
};

/** "rgb(48 220 130)" — for canvas/CSS color values */
export const tokenRgb = (name) => `rgb(${channels(name)})`;

/** Re-render when the PesaLens theme flips so animated colors follow the theme.
    Returns a monotonically increasing key you can pass as a React `key` or dep. */
export const useThemeVersion = () => {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener('pesalens:theme', bump);
    window.addEventListener('storage', bump);
    return () => {
      window.removeEventListener('pesalens:theme', bump);
      window.removeEventListener('storage', bump);
    };
  }, []);
  return version;
};
