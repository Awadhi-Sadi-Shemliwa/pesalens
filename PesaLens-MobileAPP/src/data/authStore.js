// Token + current-user storage with cross-tab sync.
//
// Tokens live in localStorage so the page survives a refresh; for a
// financial product moving the access token to memory + an httpOnly
// refresh cookie is the next hardening step (requires backend cookie
// flow). Today's setup at minimum keeps every API call authenticated
// and lets us log the user out cleanly.

import { useEffect, useState } from 'react';

const ACCESS_KEY = 'pesalens.accessToken';
const REFRESH_KEY = 'pesalens.refreshToken';
const USER_KEY = 'pesalens.user';
const EVENT_NAME = 'pesalens:auth';

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

export const getAccessToken = () => safeRead(ACCESS_KEY);
export const getRefreshToken = () => safeRead(REFRESH_KEY);

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
  if (access_token) safeWrite(ACCESS_KEY, access_token);
  if (refresh_token) safeWrite(REFRESH_KEY, refresh_token);
  if (user) safeWrite(USER_KEY, JSON.stringify(user));
  broadcast();
};

export const clearSession = () => {
  safeWrite(ACCESS_KEY, null);
  safeWrite(REFRESH_KEY, null);
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

export const isAuthenticated = () => Boolean(getAccessToken());

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
