import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Vite picks up sensible React + JSX defaults from package.json + the
// auto-resolved Babel preset. We override:
//
//   1. Bind the dev server to all interfaces so a phone on the same
//      Wi-Fi can reach `https://<laptop-ip>:5173`. Useful for the
//      install banner UI itself, BUT note the install prompt only
//      fires under a TRUSTED HTTPS cert — see comment 2 below.
//
//   2. Run dev over HTTPS via @vitejs/plugin-basic-ssl so service
//      workers register on LAN IPs (Chrome treats localhost as
//      secure but not bare 192.168.x.x). The basic-ssl cert is
//      self-signed and the user must "Proceed (unsafe)" once. That
//      is enough for SW registration but Chromium will NOT fire
//      `beforeinstallprompt` against a self-signed cert. To get the
//      install prompt on the phone, run a real-cert tunnel — see
//      `npm run tunnel` (scripts/tunnel-dev.mjs) which spins up a
//      Cloudflare Tunnel pointed at the dev server and gives back a
//      `https://*.trycloudflare.com` URL the phone can hit with full
//      install eligibility.
//
//   3. Serve `.apk` files from /downloads/ with the correct
//      Content-Type so Android's package installer recognises them
//      instead of treating the file as a generic ZIP. Without this
//      header Chrome on Android downloads the APK as `pesalens.zip`
//      and the user is offered "Extract" instead of "Install".
//
//   4. Strip `console.*` + `debugger` from the production bundle so
//      the shipped PWA never logs stack traces, statement contents,
//      or token bodies. Dev (`npm run dev`) is untouched.

const apkMimeMiddleware = () => ({
  name: 'pesalens-apk-mime',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      // Match /downloads/*.apk (case-insensitive).
      if (req.url && /\/downloads\/.+\.apk(\?|$)/i.test(req.url)) {
        res.setHeader(
          'Content-Type',
          'application/vnd.android.package-archive',
        );
        res.setHeader(
          'Content-Disposition',
          'attachment; filename="pesalens.apk"',
        );
      }
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url && /\/downloads\/.+\.apk(\?|$)/i.test(req.url)) {
        res.setHeader(
          'Content-Type',
          'application/vnd.android.package-archive',
        );
        res.setHeader(
          'Content-Disposition',
          'attachment; filename="pesalens.apk"',
        );
      }
      next();
    });
  },
});

// Where the FastAPI backend listens during dev. Override with
// `VITE_BACKEND_PROXY=http://other-host:8001 npm run dev` if you ever
// need to point the proxy at something other than the default uvicorn.
const BACKEND_TARGET =
  process.env.VITE_BACKEND_PROXY || 'http://localhost:8000';

export default defineConfig(({ mode }) => ({
  plugins: [basicSsl(), apkMimeMiddleware()],
  server: {
    host: true,
    port: 5173,
    https: true,
    // Proxy /api/* to the FastAPI backend so the SPA can use a same-
    // origin URL ('/api') and Just Work in three places:
    //   1. Laptop browser at https://localhost:5173
    //   2. Phone hitting a `https://*.trycloudflare.com` tunnel
    //   3. Phone on the LAN at https://<laptop-ip>:5173
    // Without this, the phone tries `http://localhost:8000/api/...`
    // which resolves to the phone itself and fails with "Network error
    // — backend unreachable".
    proxy: {
      '/api': {
        target: BACKEND_TARGET,
        changeOrigin: true,
        // Backend is HTTP in dev; we don't need cert checks for
        // localhost loopback.
        secure: false,
      },
    },
  },
  preview: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: BACKEND_TARGET,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  esbuild: mode === 'production'
    ? { drop: ['console', 'debugger'] }
    : undefined,
}));
