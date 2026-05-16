import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

// PWA service worker. Chrome's `beforeinstallprompt` (the trigger that
// makes the install icon show in the URL bar AND wakes our
// PWAInstallPrompt component) only fires after the SW is registered
// and the manifest is fetched. We register on `window.load` so the
// initial render isn't blocked. The SW lives at /sw.js (root scope).
//
// Registered in BOTH dev and prod so phones hitting the dev server
// (npm run dev -- --host) over the LAN see the install prompt during
// testing — the install icon was previously gated to prod-only, which
// is why localhost stopped showing it. The SW itself is HMR-safe:
//   - /api/* and /auth/* are bypassed (live backend always wins)
//   - SPA navigations are network-first (Vite serves fresh /index.html)
//   - Vite dev modules under /src/ + /node_modules/ aren't /assets/ and
//     don't match the static-asset extension list, so the fetch handler
//     ignores them and HMR keeps working.
// Browsers gate install eligibility on a secure context — that's
// automatically true on localhost and on any HTTPS deploy.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch(() => { /* offline or sw fetch failed — ignored */ });
  });
}
