// Mobile auth store — refresh token in Capacitor Preferences (Android
// Keystore-backed on Capacitor 6+), access token in module memory only.
//
// Earlier versions persisted both tokens to localStorage; any XSS in the
// WebView could exfil the refresh and re-mint access tokens forever.
// Mirroring the web client's posture (access in memory, refresh in
// httpOnly cookie) is impossible here because Capacitor's WebView
// rejects Set-Cookie from cross-origin /api responses, so we use
// Preferences as the closest secure equivalent.
//
// Keys:
//   pesalens.refresh — refresh JWT, persisted to Preferences
//   pesalens.user    — non-sensitive cached profile (name, plan, email),
//                      kept in localStorage so the UI doesn't have to
//                      await for a sync read on every render
//
// Migration: a one-time pass at module load picks up any tokens left in
// localStorage from the previous build and moves the refresh into
// Preferences (the access is dropped — a silent /auth/refresh on launch
// reissues a fresh one). Both old keys are then deleted.

import { useEffect, useState } from 'react';
import { Preferences } from '@capacitor/preferences';
import { setActiveStatement } from './activeStatementStore';

const REFRESH_KEY = 'pesalens.refresh';
const LEGACY_ACCESS_KEY = 'pesalens.accessToken';
const LEGACY_REFRESH_KEY = 'pesalens.refreshToken';
const USER_KEY = 'pesalens.user';
const LAST_ACTIVE_KEY = 'pesalens.lastActiveAt';
const EVENT_NAME = 'pesalens:auth';

// Background grace before the session is dropped. The user's spec:
// "the system in the background should hold the session for about 30
// seconds before signing out automatically". The same window covers a
// kill-from-recents cold start — if the gap between the last foreground
// heartbeat and the next launch exceeds this, bootSession() drops the
// refresh token before any protected route can render.
export const BACKGROUND_GRACE_MS = 30_000;

// Access token lives only in module scope. Cleared on every reload, on
// logout, and after a /auth/refresh failure.
let _accessToken = null;

const safeRead = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeWrite = (key, value) => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
};

const broadcast = () => {
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  } catch {
    /* ignore */
  }
};

// ---------- public API -----------------------------------------------------

// Synchronous — `request()` in api.js calls this on every request.
export const getAccessToken = () => _accessToken;

// Async — both callers (`refreshAccessToken` and `signOut`) already await.
export const getRefreshToken = async () => {
  try {
    const { value } = await Preferences.get({ key: REFRESH_KEY });
    return value || null;
  } catch {
    return null;
  }
};

export const getCurrentUser = () => {
  const raw = safeRead(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const setSession = ({ access_token, refresh_token, user }) => {
  if (access_token !== undefined) _accessToken = access_token || null;
  if (refresh_token !== undefined) {
    if (refresh_token) {
      // Fire-and-forget; failures fall through to next /auth/refresh
      // which will simply find no token and bounce to /signin.
      Preferences.set({ key: REFRESH_KEY, value: refresh_token }).catch(() => {});
    } else {
      Preferences.remove({ key: REFRESH_KEY }).catch(() => {});
    }
  }
  if (user) safeWrite(USER_KEY, JSON.stringify(user));
  // Anchor the background-grace heartbeat to "now" whenever a session
  // is installed. Without this, signing in and immediately killing the
  // app would leave no timestamp behind, so bootSession would skip the
  // staleness check and restore the dashboard.
  if (_accessToken) {
    Preferences.set({ key: LAST_ACTIVE_KEY, value: String(Date.now()) }).catch(() => {});
  }
  broadcast();
};

export const clearSession = () => {
  _accessToken = null;
  Preferences.remove({ key: REFRESH_KEY }).catch(() => {});
  Preferences.remove({ key: LAST_ACTIVE_KEY }).catch(() => {});
  safeWrite(USER_KEY, null);
  // Drop the per-user active statement so a NEXT user in this WebView can't
  // inherit a foreign job_id (which would 404 owner-checked endpoints).
  setActiveStatement(null);
  broadcast();
};

// ---------- background-grace bookkeeping --------------------------------
//
// touchLastActive() is called by the foreground heartbeat in
// use-background-signout.ts (and on every app-state transition) so the
// stored timestamp tracks the last moment the WebView was actually
// running. readLastActive() / clearLastActive() are used by bootSession
// and the resume listener to decide whether the grace window has lapsed.
export const touchLastActive = () => {
  try {
    Preferences.set({ key: LAST_ACTIVE_KEY, value: String(Date.now()) }).catch(() => {});
  } catch {
    /* ignore */
  }
};

export const readLastActive = async () => {
  try {
    const { value } = await Preferences.get({ key: LAST_ACTIVE_KEY });
    if (!value) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
};

export const clearLastActive = () => {
  Preferences.remove({ key: LAST_ACTIVE_KEY }).catch(() => {});
};

// Merge a partial update into the cached user (used to refresh
// `subscription` after billing endpoints respond) without churning tokens.
export const updateUser = (patch) => {
  const current = getCurrentUser() || {};
  safeWrite(USER_KEY, JSON.stringify({ ...current, ...patch }));
  broadcast();
};

export const isAuthenticated = () => Boolean(_accessToken);

// One-time migration of legacy localStorage tokens. Runs from the boot
// path below; safe to call repeatedly (no-op once cleared).
const migrateLegacyTokens = async () => {
  const legacyRefresh = safeRead(LEGACY_REFRESH_KEY);
  const legacyAccess = safeRead(LEGACY_ACCESS_KEY);
  if (legacyRefresh) {
    try {
      await Preferences.set({ key: REFRESH_KEY, value: legacyRefresh });
    } catch {
      /* ignore — leave legacy in place so a future boot can retry */
      return;
    }
  }
  // Drop both legacy keys regardless: access goes to memory only, and
  // we've moved refresh to Preferences. Worst case a single forced
  // /auth/refresh on next launch.
  if (legacyAccess !== null) safeWrite(LEGACY_ACCESS_KEY, null);
  if (legacyRefresh !== null) safeWrite(LEGACY_REFRESH_KEY, null);
};

// Call from the app shell at startup. Resolves after we've either
// recovered a fresh access token (silent /auth/refresh) or determined
// there's no session to recover. The shell should gate first render on
// this so ProtectedRoute doesn't bounce a returning user to /signin
// before the access token lands.
export const bootSession = async () => {
  try {
    await migrateLegacyTokens();
    const refresh = await getRefreshToken();
    if (!refresh) return;
    // Background-grace check on cold start: if the gap between the last
    // foreground heartbeat and now exceeds the grace window, treat the
    // session as expired. This covers both "killed from recents" and
    // "left in background overnight" — the WebView's setTimeout cannot
    // be trusted to fire while the process is paused, so we re-check on
    // every boot before restoring an access token.
    const lastActive = await readLastActive();
    if (lastActive !== null && Date.now() - lastActive > BACKGROUND_GRACE_MS) {
      clearSession();
      return;
    }
    // Late import — `data/api.js` imports this module, so a top-level
    // import would create a cycle. Dynamic import resolves cleanly
    // because by the time bootSession() runs the module is fully loaded.
    const apiModule = await import('./api.js');
    if (apiModule.refreshAccessToken) {
      await apiModule.refreshAccessToken();
    }
    // Refresh succeeded — start the heartbeat from a known-good baseline
    // so the next cold start's grace check is anchored to "now".
    touchLastActive();
  } catch {
    /* startup failure is non-fatal — user just sees the landing page */
  }
};

export const useAuth = () => {
  const [state, setState] = useState(() => ({
    user: getCurrentUser(),
    token: getAccessToken(),
  }));

  useEffect(() => {
    const sync = () => setState({ user: getCurrentUser(), token: getAccessToken() });
    window.addEventListener(EVENT_NAME, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT_NAME, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return state;
};
