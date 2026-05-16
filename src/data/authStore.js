// Token + current-user storage with cross-tab sync.
//
// Web flow: access token lives in a JS module variable (memory only),
// the refresh token is held by the backend as an httpOnly + SameSite
// cookie. JS cannot read either token directly, which closes off the
// XSS-exfil hole that used to exist when both tokens were in
// localStorage. On page load we silently call /auth/refresh — the
// browser sends the cookie, the backend hands back a fresh access
// token, and the SPA boots authenticated. Mobile (Capacitor) is the
// exception: cookies don't carry across the WebView <-> remote API
// boundary reliably, so the mobile app keeps the refresh token in
// localStorage and sends it in the request body.
//
// `user` metadata stays in localStorage so we can render headers
// without a network round-trip on first paint.

import { useEffect, useState } from 'react';

const REFRESH_KEY = 'pesalens.refreshToken';
const USER_KEY = 'pesalens.user';
const EVENT_NAME = 'pesalens:auth';

// Capacitor injects a global on iOS/Android — used to detect the
// mobile shell and fall back to localStorage-based refresh.
const isMobile = () => {
  try {
    return typeof window !== 'undefined' && Boolean(window.Capacitor);
  } catch {
    return false;
  }
};

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

// Module-scoped tokens — never persisted on web. A page refresh
// drops them; the boot flow restores them from the httpOnly cookie.
let _accessToken = null;
let _refreshTokenMem = null;

export const getAccessToken = () => _accessToken;

export const getRefreshToken = () => {
  // On mobile we read the persisted refresh token; on web there is
  // nothing JS can read — the cookie is httpOnly.
  if (_refreshTokenMem) return _refreshTokenMem;
  if (isMobile()) return safeRead(REFRESH_KEY);
  return null;
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

const broadcast = () => {
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  } catch {
    /* ignore */
  }
};

export const setSession = ({ access_token, refresh_token, user }) => {
  if (access_token) _accessToken = access_token;
  if (refresh_token) {
    _refreshTokenMem = refresh_token;
    if (isMobile()) safeWrite(REFRESH_KEY, refresh_token);
  }
  if (user) safeWrite(USER_KEY, JSON.stringify(user));
  broadcast();
};

export const clearSession = () => {
  _accessToken = null;
  _refreshTokenMem = null;
  if (isMobile()) safeWrite(REFRESH_KEY, null);
  safeWrite(USER_KEY, null);
  broadcast();
};

// Merge a partial update into the cached user (used to refresh
// `subscription` after billing endpoints respond) without churning tokens.
export const updateUser = (patch) => {
  const current = getCurrentUser() || {};
  safeWrite(USER_KEY, JSON.stringify({ ...current, ...patch }));
  broadcast();
};

// Until boot completes we don't know yet whether the user is signed in.
// `bootSession()` flips this when the silent-refresh attempt resolves.
let _bootDone = false;
let _bootInFlight = null;

export const isBootComplete = () => _bootDone;

export const isAuthenticated = () => Boolean(_accessToken);

// Performs the silent-refresh handshake on app start. Resolves once an
// access token has been recovered from the cookie (web) or the
// persisted refresh token (mobile), or the attempt has failed.
export const bootSession = async (refreshFn) => {
  if (_bootDone) return Boolean(_accessToken);
  if (_bootInFlight) return _bootInFlight;
  _bootInFlight = (async () => {
    try {
      await refreshFn();
    } catch {
      /* network errors fall through — caller treats as anon */
    } finally {
      _bootDone = true;
      _bootInFlight = null;
      broadcast();
    }
    return Boolean(_accessToken);
  })();
  return _bootInFlight;
};

// Tab/window-close auto sign-out. Registers a `pagehide` listener that
// fires a one-shot beacon to /auth/logout so the backend can revoke the
// refresh token immediately, then clears the in-memory access token.
//
// `pagehide` (rather than `beforeunload`) is the right primitive on
// iOS Safari and inside Capacitor/PWA WebViews — `beforeunload` doesn't
// fire reliably there. We skip the beacon when `event.persisted === true`
// (the page is being moved into the bfcache, not actually closed) so we
// don't kill the session on a back-forward navigation that would have
// kept the user signed in.
//
// The refresh cookie is also issued without `Max-Age` (see backend
// `_set_refresh_cookie`), making it a session cookie. So even if the
// beacon is dropped by the OS, closing the browser tears the session
// down on the server's next refresh attempt.
let _unloadSubscribed = false;
export const subscribeUnload = (apiBaseUrl) => {
  if (_unloadSubscribed) return;
  if (typeof window === 'undefined') return;
  _unloadSubscribed = true;

  const handler = (event) => {
    if (event && event.persisted) return;          // bfcache stash, not a close
    if (!_accessToken && !_refreshTokenMem) return; // already signed out
    try {
      // sendBeacon ignores its body but still fires a POST with the
      // session cookie attached. The backend's /auth/logout reads the
      // refresh token from the cookie (web) or body (mobile) and
      // revokes the JTI before the request connection is torn down.
      const url = `${apiBaseUrl.replace(/\/+$/, '')}/auth/logout`;
      const blob = new Blob([JSON.stringify({})], { type: 'application/json' });
      navigator.sendBeacon?.(url, blob);
    } catch {
      /* nothing useful we can do mid-unload */
    }
    // Wipe synchronously so a same-tab back-navigation can't read
    // the token from memory after the unload listener fires.
    _accessToken = null;
    _refreshTokenMem = null;
  };

  window.addEventListener('pagehide', handler);
};

export const useAuth = () => {
  const [state, setState] = useState(() => ({
    user: getCurrentUser(),
    token: getAccessToken(),
    booted: isBootComplete(),
  }));

  useEffect(() => {
    const sync = () => setState({
      user: getCurrentUser(),
      token: getAccessToken(),
      booted: isBootComplete(),
    });
    window.addEventListener(EVENT_NAME, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT_NAME, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return state;
};
