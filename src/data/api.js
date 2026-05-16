// Lightweight client helpers for the PesaLens FastAPI backend.
//
// All requests funnel through `request()` so we can attach the bearer
// token, transparently refresh expired access tokens, and clear the
// session + redirect to /signin on 401. Every call uses
// `credentials: 'include'` so the httpOnly refresh cookie travels with
// /auth/refresh and /auth/logout.

import {
  bootSession,
  clearSession,
  getAccessToken,
  getRefreshToken,
  setSession,
  updateUser,
} from './authStore';

// Default to a same-origin `/api` so:
//   • Laptop dev (https://localhost:5173)  → Vite proxies /api/* to the
//     local FastAPI backend on http://localhost:8000 (see vite.config.js).
//   • Phone hitting the dev server through a Cloudflare Tunnel → the
//     same /api/* path is proxied through Vite to the laptop backend,
//     so the phone never has to know the backend exists separately.
//   • Production deploy → VITE_API_URL is set to the public API origin
//     (e.g. https://api.pesalens.com/api) and overrides this default.
const RAW_URL = (import.meta.env && import.meta.env.VITE_API_URL) || '/api';
export const API_URL = RAW_URL.replace(/\/+$/, '');

const AUTH_PATHS = new Set(['/auth/signin', '/auth/signup', '/auth/refresh']);

let refreshInFlight = null;

const refreshAccessToken = async () => {
  if (refreshInFlight) return refreshInFlight;
  // Web: body is empty, cookie carries the refresh token.
  // Mobile: the persisted refresh token is sent in the body.
  const refresh = getRefreshToken();
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(refresh ? { refresh_token: refresh } : {}),
      });
      if (!res.ok) {
        clearSession();
        return null;
      }
      const body = await res.json();
      const data = body?.data;
      if (data?.access_token) {
        setSession(data);
        return data.access_token;
      }
      clearSession();
      return null;
    } catch {
      clearSession();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
};

// Called once at app start. Resolves when the silent-refresh round
// trip completes so protected routes can render with up-to-date auth.
export const bootAuth = () => bootSession(refreshAccessToken);

const handleResponse = async (res) => {
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok || data?.success === false) {
    const error = data?.errors?.[0] || data?.message || data?.detail || 'Request failed';
    const err = new Error(typeof error === 'string' ? error : 'Request failed');
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
};

const request = async (path, options = {}, { allowRetry = true } = {}) => {
  const url = `${API_URL}${path}`;
  const headers = new Headers(options.headers || {});
  // Only set JSON content type when sending a JSON body.
  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getAccessToken();
  if (token && !AUTH_PATHS.has(path) && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let res;
  try {
    res = await fetch(url, { credentials: 'include', ...options, headers });
  } catch (networkErr) {
    const err = new Error('Network error — backend unreachable.');
    err.cause = networkErr;
    err.status = 0;
    throw err;
  }

  if (res.status === 401 && allowRetry && !AUTH_PATHS.has(path)) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return request(path, options, { allowRetry: false });
    }
    clearSession();
    if (typeof window !== 'undefined' && window.location.hash !== '#/signin') {
      window.location.hash = '/signin';
    }
  }

  // 402 Payment Required — trial expired or Pro lapsed. Hand the caller
  // a typed error and route the user to the upgrade page so the feature
  // gate is unmistakable.
  if (res.status === 402) {
    let body = null;
    try { body = await res.json(); } catch { /* ignore */ }
    const detail = body?.detail || {};
    const err = new Error(detail.message || 'Subscription required');
    err.status = 402;
    err.code = detail.code || 'subscription_required';
    err.payload = body;
    if (typeof window !== 'undefined' && !window.location.hash.includes('/upgrade')) {
      window.location.hash = '/upgrade';
    }
    throw err;
  }

  return handleResponse(res);
};

const requestData = async (path, options) => {
  const body = await request(path, options);
  return body?.data;
};

// ---------- auth ----------

export const signUp = (payload) =>
  requestData('/auth/signup', { method: 'POST', body: JSON.stringify(payload) });

export const signIn = (payload) =>
  requestData('/auth/signin', { method: 'POST', body: JSON.stringify(payload) });

export const fetchMe = async () => {
  const me = await requestData('/auth/me');
  if (me) updateUser(me);
  return me;
};

// Server-aware logout: revokes the current access + refresh tokens
// before clearing the local session. Errors are swallowed — we always
// want the local session cleared, even if the server is unreachable.
export const signOut = async () => {
  const refresh = getRefreshToken();
  try {
    await request('/auth/logout', {
      method: 'POST',
      // Cookie carries the refresh token on web; mobile keeps a copy.
      body: JSON.stringify(refresh ? { refresh_token: refresh } : {}),
    }, { allowRetry: false });
  } catch {
    /* ignore */
  }
  clearSession();
};

// Email verification
export const sendVerifyEmail = () =>
  requestData('/auth/verify-email/send', { method: 'POST' });

export const confirmVerifyEmail = (code) =>
  requestData('/auth/verify-email/confirm', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

// Password reset
export const forgotPassword = (email) =>
  requestData('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });

export const resetPassword = ({ email, code, newPassword }) =>
  requestData('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ email, code, new_password: newPassword }),
  });

export const changePassword = ({ currentPassword, newPassword }) =>
  requestData('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });

// PDPA — data portability + right to erasure
export const exportMyData = () => requestData('/auth/me/export');

export const deleteMyAccount = async () => {
  await request('/auth/me', { method: 'DELETE' });
  clearSession();
};

// ---------- statements ----------

export const fetchDashboardSummary = () => requestData('/dashboard/summary');

export const fetchAnalysis = (jobId) =>
  requestData(`/analysis/${encodeURIComponent(jobId)}`);

export const fetchUploads = () => requestData('/uploads');

export const uploadStatement = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return requestData('/upload', { method: 'POST', body: formData });
};

// ---------- assistant ----------

export const sendAssistantMessage = async (message, history = []) => {
  const data = await requestData('/assistant/chat', {
    method: 'POST',
    body: JSON.stringify({ message, history }),
  });
  return data?.reply || '';
};

// ---------- receipts ----------

export const scanReceipt = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return requestData('/receipts/scan', { method: 'POST', body: formData });
};

export const fetchReceipts = async () => {
  const data = await requestData('/receipts');
  return data?.receipts || [];
};

export const fetchReceiptPatterns = () => requestData('/receipts/patterns');

export const parseReceiptText = (text, { save = false } = {}) =>
  requestData('/receipts/parse-text', {
    method: 'POST',
    body: JSON.stringify({ text, save }),
  });

// ---------- personal entries ----------

export const fetchPersonalEntries = async () => {
  const data = await requestData('/personal/entries');
  return data?.entries || [];
};

export const createPersonalEntry = (entry) =>
  requestData('/personal/entries', {
    method: 'POST',
    body: JSON.stringify(entry),
  });

export const deletePersonalEntry = (id) =>
  requestData(`/personal/entries/${id}`, { method: 'DELETE' });

// ---------- business ledger ----------

export const fetchBusinessEntries = async () => {
  const data = await requestData('/business/entries');
  return data?.entries || [];
};

export const createBusinessEntry = (entry) =>
  requestData('/business/entries', {
    method: 'POST',
    body: JSON.stringify(entry),
  });

export const deleteBusinessEntry = (id) =>
  requestData(`/business/entries/${id}`, { method: 'DELETE' });

export const fetchBusinessSummary = (month) => {
  const qs = month ? `?month=${encodeURIComponent(month)}` : '';
  return requestData(`/business/reports/summary${qs}`);
};

// ---------- reconciliation ----------
//
// Cross-source view: pairs every statement debit with the receipts and
// manual entries that plausibly explain it for [start_date, end_date].
// Backend caps the range at 365 days. Returns the deterministic result
// even when LLM is unavailable; the UI hides the insight slot when
// `llm_status !== 'ok'`.
export const fetchReconciliation = (start_date, end_date, scope = 'personal') =>
  requestData('/reconcile', {
    method: 'POST',
    body: JSON.stringify({ start_date, end_date, scope }),
  });

// Streams a PDF and triggers the browser download. Returns nothing —
// the caller just awaits to know when the download is in flight.
export const downloadBusinessReport = async (month) => {
  const qs = month ? `?month=${encodeURIComponent(month)}` : '';
  const token = getAccessToken();
  const res = await fetch(`${API_URL}/business/reports/monthly${qs}`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Could not download report');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pesalens-${month || 'current'}-financials.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// ---------- billing / subscription ----------

export const fetchBillingStatus = () => requestData('/billing/status');

export const startCheckout = (plan) =>
  requestData('/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ plan }),
  });

export const cancelSubscription = () =>
  requestData('/billing/cancel', { method: 'POST' });

export const requestPaymentConfirmation = (payment_id) =>
  requestData('/billing/manual/request-confirmation', {
    method: 'POST',
    body: JSON.stringify({ payment_id }),
  });

// ---------- markets ----------

export const fetchMarketSnapshot = () => requestData('/markets/all');

// Public ticker feed for the landing page — no auth required.
export const fetchPublicTicker = async () => {
  try {
    const res = await fetch(`${API_URL}/markets/ticker`);
    if (!res.ok) return [];
    const body = await res.json();
    return body?.data?.items || [];
  } catch {
    return [];
  }
};

export const askMarketInsight = async (message, history = []) => {
  const data = await requestData('/markets/insight', {
    method: 'POST',
    body: JSON.stringify({ message, history }),
  });
  return {
    reply: data?.reply || '',
    disclaimer: data?.disclaimer || '',
  };
};

export const refreshMarketSource = (source) =>
  requestData(`/markets/refresh/${encodeURIComponent(source)}`, { method: 'POST' });

// ---------- formatters ----------

export const fmtTZS = (value) => {
  if (value == null || Number.isNaN(value)) return '—';
  const v = Number(value);
  if (Math.abs(v) >= 1e6) return 'TZS ' + (v / 1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return 'TZS ' + (v / 1e3).toFixed(0) + 'K';
  return 'TZS ' + v.toLocaleString();
};

export const fmtTZSFull = (value) => {
  if (value == null || Number.isNaN(value)) return '—';
  return 'TZS ' + Number(value).toLocaleString();
};

// Convert a HTMLCanvasElement to a File so it can be uploaded to /receipts/scan
export const canvasToFile = (canvas, filename = `capture-${Date.now()}.jpg`, quality = 0.92) =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Failed to capture image from camera'));
        resolve(new File([blob], filename, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      quality,
    );
  });
