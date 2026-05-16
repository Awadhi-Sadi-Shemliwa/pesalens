// Release-build sanity check. Run before `vite build && cap sync android`
// when assembling a signed APK for the Play Store.
//
// Fails the build if any of these conditions are true:
//   1. PESALENS_BUILD !== 'prod'         — Capacitor config falls back to
//                                           cleartext-permitting dev settings
//                                           without it.
//   2. VITE_API_URL is empty or LAN      — would ship an APK that points at
//                                           the developer's laptop.
//   3. VITE_API_URL is non-HTTPS         — cleartext is blocked by
//                                           network_security_config.xml.
//
// Pin-placeholder enforcement is intentionally skipped while certificate
// pinning is deferred (see android/app/src/main/res/xml/
// network_security_config.xml). Re-add a `<pin-set>` block + the pin
// check below once the production cert exists.
//
// Invoke via `npm run release` (see package.json).

const errors = [];

const buildFlag = process.env.PESALENS_BUILD || "";
if (buildFlag !== "prod") {
  errors.push(
    `PESALENS_BUILD is "${buildFlag}". Set PESALENS_BUILD=prod when ` +
      "building a release APK so Capacitor uses HTTPS-only / no-cleartext " +
      "settings (see capacitor.config.ts)."
  );
}

const apiUrl = process.env.VITE_API_URL || "";
if (!apiUrl) {
  errors.push(
    "VITE_API_URL is empty. Set it to the public backend URL (e.g. " +
      "https://api.pesalens.com/api) before building the release APK, " +
      "either in .env.production or as an env var passed to npm run release."
  );
} else if (/^https?:\/\/(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(apiUrl)) {
  errors.push(
    `VITE_API_URL points at a LAN / loopback address ("${apiUrl}"). ` +
      "Release APKs must talk to a public HTTPS endpoint."
  );
} else if (!/^https:\/\//i.test(apiUrl)) {
  errors.push(
    `VITE_API_URL must use https:// (got "${apiUrl}"). Cleartext is ` +
      "blocked by network_security_config.xml in release builds."
  );
}

if (errors.length > 0) {
  console.error("\n[release-guard] Release build blocked:\n");
  for (const e of errors) console.error("  - " + e + "\n");
  process.exit(1);
}

console.log("[release-guard] OK — release build preflight passed.");
