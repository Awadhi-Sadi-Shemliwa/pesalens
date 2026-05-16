import { useEffect } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { toast } from "@/hooks/use-toast";

/**
 * Hardware-back-button bridge for the Capacitor APK.
 *
 * The Android back button steps through PesaLens by hierarchy, not by raw
 * history, so a deep-link or a tap-shortcut into /reconciliation still
 * lands on /more on the way out. Spec:
 *
 *   1. More sub-pages (workspace tiles: upload, reconciliation, personal
 *      spending, action plan, bookkeeping, business ledger, upgrade,
 *      profile, backend) → /more.
 *   2. /more → / (Dashboard).
 *   3. Other top-level shell tabs (/analysis, /assistant, /markets) → /.
 *   4. / → first Back shows a "Press Back again to exit" toast, second
 *      Back within EXIT_WINDOW_MS minimises the app. Minimising (not
 *      exitApp) keeps the task in recents so the 30s background-grace
 *      timer in use-background-signout.ts can hold the session.
 *   5. Auth / landing / legal roots (/signin, /signup, /landing, /terms,
 *      /privacy, /backend) → minimise immediately.
 *
 * No-op on web — the listener attaches only when running native.
 */

// Tabs that live behind the More menu. Pressing Back from any of these
// should snap to /more rather than walking SPA history (which might
// otherwise jump straight to Dashboard if the page was deep-linked).
const MORE_SUB_PATHS = new Set<string>([
  "/upload",
  "/reconciliation",
  "/personal-spending",
  "/bookkeeping",
  "/business-ledger",
  "/action-plan",
  "/upgrade",
  "/profile",
  "/backend",
]);

// Auth + standalone pages where Back should drop straight to the OS
// (no in-app destination behind them).
const ROOT_AUTH_PATHS = new Set<string>([
  "/signin",
  "/signup",
  "/landing",
  "/terms",
  "/privacy",
]);

// Window during which a second Back press is treated as "yes, exit".
// 2s matches the de-facto Android pattern (WhatsApp, Telegram, Chrome).
const EXIT_WINDOW_MS = 2000;

let _exitArmedUntil = 0;

export function useBackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let active = true;
    let detach: (() => void) | undefined;

    (async () => {
      try {
        const handle = await CapacitorApp.addListener("backButton", async () => {
          if (!active) return;
          const path = location.pathname;

          // 1. Auth / landing / legal roots → minimise immediately.
          if (ROOT_AUTH_PATHS.has(path)) {
            void CapacitorApp.minimizeApp();
            return;
          }

          // 2. More sub-pages → snap to /more.
          if (MORE_SUB_PATHS.has(path)) {
            navigate("/more", { replace: true });
            return;
          }

          // 3. /more → Dashboard.
          if (path === "/more") {
            navigate("/", { replace: true });
            return;
          }

          // 4. Other top-level shell tabs → Dashboard.
          if (path === "/analysis" || path === "/assistant" || path === "/markets") {
            navigate("/", { replace: true });
            return;
          }

          // 5. Dashboard → press-again-to-exit pattern.
          if (path === "/") {
            const now = Date.now();
            if (now <= _exitArmedUntil) {
              _exitArmedUntil = 0;
              // Minimise (not exitApp) — keeps the task in recents so the
              // 30s background grace timer can run. If the user swipes the
              // task from recents, the native onTaskRemoved handler
              // (Android: PesaLensCleanupService) wipes the refresh token.
              void CapacitorApp.minimizeApp();
              return;
            }
            _exitArmedUntil = now + EXIT_WINDOW_MS;
            toast({
              title: "Press Back again to exit",
              description: "Your session stays active for 30s before signing out.",
            });
            return;
          }

          // 6. Fallback for any unknown in-app route — walk history once,
          //    else drop to Dashboard so the user is never stuck.
          if (window.history.length > 1) {
            navigate(-1);
            return;
          }
          navigate("/", { replace: true });
        });
        detach = () => {
          void handle.remove();
        };
      } catch {
        /* plugin not available — web build, ignore */
      }
    })();

    return () => {
      active = false;
      if (detach) detach();
    };
  }, [navigate, location.pathname]);
}
