import { useEffect } from "react";
import { App as CapacitorApp, type AppState } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useNavigate } from "react-router-dom";
// @ts-ignore — JS module
import { signOut } from "@/data/api";
// @ts-ignore — JS module
import {
  BACKGROUND_GRACE_MS,
  clearLastActive,
  clearSession,
  getAccessToken,
  readLastActive,
  touchLastActive,
} from "@/data/authStore";

/**
 * 30-second background-then-sign-out timer + heartbeat.
 *
 * The user's spec: when the app moves to the background (Home, recents,
 * lock screen), hold the session for ~30 seconds. If the user comes back
 * within that window, nothing happens — they keep their place. If they
 * don't, the session is revoked silently so a stolen device or
 * shoulder-surf attack can't open recents minutes later and find
 * PesaLens still logged in.
 *
 * Implementation:
 *
 *   1. Foreground heartbeat — every HEARTBEAT_MS we persist `Date.now()`
 *      to Capacitor Preferences. bootSession() reads this on cold start
 *      and drops the refresh token if the timestamp is stale, so a
 *      kill-from-recents followed by a >30s pause lands on the landing
 *      page instead of the dashboard.
 *
 *   2. Background-arming — on `isActive=false` we stamp the timestamp
 *      one more time and arm a setTimeout(BACKGROUND_GRACE_MS) that
 *      revokes the session if it ever fires. Android WebViews routinely
 *      pause JS timers when backgrounded, so this is best-effort.
 *
 *   3. Resume re-check — on `isActive=true` we compute the gap between
 *      the persisted timestamp and `Date.now()`. If it exceeds the
 *      grace window, we sign out immediately and bounce to /. This is
 *      what actually saves us when Android pauses the WebView: the
 *      timer didn't fire, but the timestamp is stale, so we catch it
 *      on resume.
 *
 * No-op on web — the listener attaches only when running native, and
 * we additionally gate on `getAccessToken()` so the timer never starts
 * for a guest who hasn't signed in.
 */
const HEARTBEAT_MS = 10_000;

const revokeAndBounce = async (
  navigate: ReturnType<typeof useNavigate>,
) => {
  try {
    await signOut();
  } catch {
    /* even if the network call failed, clearSession() inside signOut()
       ran — local state is wiped. */
  }
  // Belt-and-braces: clearSession is called by signOut, but on a network
  // failure path some refresh tokens have been seen to linger. Wipe again.
  try {
    clearSession();
    clearLastActive();
  } catch {
    /* ignore */
  }
  try {
    navigate("/", { replace: true });
  } catch {
    /* navigation may be detached if the WebView is mid-pause */
  }
};

export function useBackgroundSignout() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let detach: (() => void) | undefined;

    const clearArmed = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const startHeartbeat = () => {
      if (heartbeat) return;
      touchLastActive();
      heartbeat = setInterval(() => {
        if (!active) return;
        // Only beat while there is actually a session to protect — a
        // guest viewing /signin doesn't need a heartbeat.
        if (getAccessToken()) touchLastActive();
      }, HEARTBEAT_MS);
    };

    const stopHeartbeat = () => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    };

    // App starts in foreground — begin heartbeat immediately if signed in.
    if (getAccessToken()) startHeartbeat();

    (async () => {
      try {
        const handle = await CapacitorApp.addListener(
          "appStateChange",
          async (state: AppState) => {
            if (!active) return;

            if (state.isActive) {
              // Resuming. First, check the persisted timestamp — the
              // setTimeout below may not have fired (Android suspends
              // WebView JS while backgrounded), so we re-validate here.
              clearArmed();
              if (getAccessToken()) {
                const last = await readLastActive();
                if (last !== null && Date.now() - last > BACKGROUND_GRACE_MS) {
                  await revokeAndBounce(navigate);
                  stopHeartbeat();
                  return;
                }
                // Within the grace window — keep the session and reset
                // the heartbeat baseline.
                touchLastActive();
                startHeartbeat();
              }
              return;
            }

            // Going to background. Stamp the timestamp once more so the
            // grace check on next resume / cold start is anchored to
            // the moment we lost foreground.
            stopHeartbeat();
            if (!getAccessToken()) return;
            touchLastActive();
            clearArmed();
            timer = setTimeout(async () => {
              timer = null;
              await revokeAndBounce(navigate);
            }, BACKGROUND_GRACE_MS);
          },
        );
        detach = () => {
          void handle.remove();
        };
      } catch {
        /* plugin not available — web build, ignore */
      }
    })();

    return () => {
      active = false;
      clearArmed();
      stopHeartbeat();
      if (detach) detach();
    };
  }, [navigate]);
}
