#!/usr/bin/env node
/*
 * tunnel-dev.mjs — open a public HTTPS tunnel to the local Vite dev
 * server so a phone can install the PWA against a TRUSTED cert.
 *
 * Why this exists:
 *   Chromium will register a service worker against a self-signed cert
 *   the user has bypassed via "Proceed (unsafe)", but it will NOT fire
 *   `beforeinstallprompt` against that same cert — Chromium considers
 *   a bypassed cert to be a "broken" security state, which is not a
 *   valid secure context for installability. So the in-app install
 *   banner and the URL-bar install icon stay hidden on the phone.
 *
 *   The fix is to serve the dev page over a real, trusted HTTPS URL.
 *   Cloudflare Tunnel does this for free with no signup — it spins up
 *   an https://<random>.trycloudflare.com hostname that proxies to
 *   localhost:5173. The phone hits that URL, gets a valid Cloudflare-
 *   issued cert, and Chromium happily fires beforeinstallprompt.
 *
 * Usage:
 *   1. Install cloudflared once (Windows: `winget install Cloudflare.cloudflared`
 *      or download from https://github.com/cloudflare/cloudflared/releases).
 *   2. In one terminal:  npm run dev
 *   3. In another:       npm run tunnel
 *   4. Open the printed https://*.trycloudflare.com URL on your phone.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const PORT = process.env.VITE_PORT ?? '5173';

// PATH lookup for cloudflared. The Windows MSI installer puts the
// binary in `C:\Program Files (x86)\cloudflared\cloudflared.exe` but
// only updates PATH for NEW shells — an already-open PowerShell won't
// see it without a restart. We probe the standard install locations
// directly so the user doesn't have to relaunch their terminal.
const isWin = process.platform === 'win32';
const exeName = isWin ? 'cloudflared.exe' : 'cloudflared';

const candidates = [
  // 1. Anything already on PATH wins.
  ...((process.env.PATH || '')
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, exeName))),
  // 2. Standard Windows install locations.
  ...(isWin
    ? [
        'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
        'C:\\Program Files\\cloudflared\\cloudflared.exe',
        join(process.env.LOCALAPPDATA || '', 'Programs', 'cloudflared', 'cloudflared.exe'),
        join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Programs', 'cloudflared', 'cloudflared.exe'),
      ]
    : []),
  // 3. Common Unix locations.
  '/usr/local/bin/cloudflared',
  '/opt/homebrew/bin/cloudflared',
  '/usr/bin/cloudflared',
];

const cloudflared = candidates.find((p) => p && existsSync(p));

if (!cloudflared) {
  console.error(
    '\n[tunnel] Could not find `cloudflared` on PATH or in any standard\n' +
      '         install location. Install it with one of:\n' +
      '           Windows:  winget install Cloudflare.cloudflared\n' +
      '           macOS:    brew install cloudflared\n' +
      '           Linux:    https://github.com/cloudflare/cloudflared/releases\n' +
      '\n' +
      '         If you just installed it, you may need to close + reopen\n' +
      '         this terminal so PATH refreshes — OR re-run `npm run tunnel`,\n' +
      '         this script probes common install dirs without needing PATH.',
  );
  process.exit(127);
}

console.log(`[tunnel] using ${cloudflared}`);
console.log(`[tunnel] proxying https://localhost:${PORT} → trycloudflare.com\n`);

// Vite is HTTPS in dev (see vite.config.js basicSsl()). cloudflared has
// to know that so it does its TLS bridging correctly. The
// `--no-tls-verify` flag tells cloudflared not to choke on the self-
// signed cert from basic-ssl — we still get a trusted cert on the
// public-facing trycloudflare.com side.
const child = spawn(
  cloudflared,
  ['tunnel', '--url', `https://localhost:${PORT}`, '--no-tls-verify'],
  { stdio: 'inherit' },
);

child.on('error', (err) => {
  console.error('[tunnel] cloudflared failed to start:', err);
  process.exit(1);
});

child.on('exit', (code) => process.exit(code ?? 0));
