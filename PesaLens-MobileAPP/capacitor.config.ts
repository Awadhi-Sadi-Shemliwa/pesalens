import type { CapacitorConfig } from '@capacitor/cli';

// Cleartext + mixed content default ON so a phone APK can reach a LAN dev
// backend (e.g. http://192.168.x.x:8000/api). Flip OFF for store-bound
// release builds by setting `PESALENS_BUILD=prod` before `npx cap sync`.
const isProdBuild = process.env.PESALENS_BUILD === 'prod';

// Debug builds load from http://localhost so that fetch() to a plain-http
// LAN backend is same-scheme — Chromium WebViews drop "active mixed
// content" (fetch / XHR) from an https origin to an http target even
// when allowMixedContent is true, so the only reliable answer is to
// match schemes. Release builds keep https://localhost (secure context,
// service workers, crypto.subtle, etc.).
const config: CapacitorConfig = {
  appId: 'com.pesalens.mobile',
  appName: 'PesaLens',
  webDir: 'dist',
  server: {
    androidScheme: isProdBuild ? 'https' : 'http',
    cleartext: !isProdBuild,
  },
  android: {
    allowMixedContent: !isProdBuild,
  },
};

export default config;
