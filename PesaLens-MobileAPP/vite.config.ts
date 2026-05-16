import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  // Strip all console.* + debugger from the shipped APK bundle so log
  // pipes inside the WebView (including `chrome://inspect`) don't leak
  // statement contents, vendor names, or auth-error payloads. Dev mode
  // (`npm run dev` / `npm run build:dev`) keeps console intact.
  esbuild: mode === "production" ? { drop: ["console", "debugger"] } : undefined,
}));
