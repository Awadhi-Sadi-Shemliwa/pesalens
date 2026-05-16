#!/usr/bin/env node
/*
 * copy-apk.mjs — stage the Capacitor Android APK for /downloads/pesalens.apk.
 *
 * Source (debug build):
 *   PesaLens-MobileAPP/android/app/build/outputs/apk/debug/app-debug.apk
 * Source (release build, preferred when present):
 *   PesaLens-MobileAPP/android/app/build/outputs/apk/release/app-release.apk
 *   (or app-release-unsigned.apk if signing isn't configured)
 *
 * Destination:
 *   public/downloads/pesalens.apk
 *   public/downloads/pesalens.apk.json   (size + mtime sidecar; consumed
 *                                         by src/components/DownloadAPK.jsx)
 *
 * Wired into npm scripts as `apk:stage` and as a `prebuild` hook so a
 * fresh `npm run build` always picks up the latest APK if one exists.
 *
 * Soft-fails: if no APK is present (clean checkout, never built the
 * Capacitor project), prints a warning and exits 0 so `npm run build`
 * still succeeds. The Download APK button on the landing page
 * gracefully renders without size info when the sidecar is missing.
 */

import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const candidates = [
  join(
    repoRoot,
    'PesaLens-MobileAPP/android/app/build/outputs/apk/release/app-release.apk',
  ),
  join(
    repoRoot,
    'PesaLens-MobileAPP/android/app/build/outputs/apk/release/app-release-unsigned.apk',
  ),
  join(
    repoRoot,
    'PesaLens-MobileAPP/android/app/build/outputs/apk/debug/app-debug.apk',
  ),
];

const source = candidates.find((p) => existsSync(p));
if (!source) {
  console.warn(
    '[copy-apk] No APK found under PesaLens-MobileAPP/android/.../outputs/apk.\n' +
      '          Build one with `cd PesaLens-MobileAPP && npx cap sync android && \\\n' +
      '          cd android && ./gradlew assembleDebug` (or assembleRelease).\n' +
      '          Skipping APK staging — Download APK button will hide its size.',
  );
  process.exit(0);
}

const destDir = join(repoRoot, 'public/downloads');
const destApk = join(destDir, 'pesalens.apk');
const destMeta = join(destDir, 'pesalens.apk.json');

mkdirSync(destDir, { recursive: true });
copyFileSync(source, destApk);

const stat = statSync(destApk);
const sizeMb = stat.size / (1024 * 1024);
const sizeLabel = sizeMb >= 1
  ? `${sizeMb.toFixed(1)} MB`
  : `${Math.round(stat.size / 1024)} KB`;

const meta = {
  source,
  bytes: stat.size,
  sizeLabel,
  updatedAt: new Date(stat.mtime).toISOString(),
  variant: source.includes('/release/') ? 'release' : 'debug',
};
writeFileSync(destMeta, JSON.stringify(meta, null, 2) + '\n');

console.log(
  `[copy-apk] Staged ${meta.variant} APK (${sizeLabel}) ` +
    `→ public/downloads/pesalens.apk`,
);
