import type { CapacitorConfig } from '@capacitor/cli';

// Production builds must talk to https://api.pesalens.com only.
// Cleartext + mixed content stay OFF by default — flip them on locally
// when you need to point a debug device at a LAN dev backend, but never
// ship a release APK with these enabled.
const isDevBuild = process.env.PESALENS_BUILD === 'dev';

const config: CapacitorConfig = {
  appId: 'com.pesalens.mobile',
  appName: 'PesaLens',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: isDevBuild,
  },
  android: {
    allowMixedContent: isDevBuild,
  },
};

export default config;
