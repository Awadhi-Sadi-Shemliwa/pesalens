// PesaLens mobile API client.
//
// Mirrors the webapp client (src/data/api.js) so every feature stays in
// parity. All requests funnel through `request()` so we can attach the
// bearer token, transparently refresh expired access tokens, and clear
// the session + bounce to /signin on 401.

import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  setSession,
  updateUser,
} from './authStore';

// Resolve API URL for the mobile build with three layers, in order of
// priority. We need this layered because the APK runs on a phone where
// `localhost` always means the phone itself — not the laptop running
// the FastAPI dev server.
//
//   1. localStorage override (`pesalens.apiUrl`) — settable from the
//      More page so a tester can point the APK at a LAN IP without
//      rebuilding the APK.
//   2. Build-time env var (`VITE_API_URL`) — set in CI / `.env` for
//      release builds that target a public backend.
//   3. Default by platform:
//        • Capacitor native build → empty string (forces the user to
//          configure a backend URL; we surface this in the UI).
//        • Browser dev → http://localhost:8000/api (the standard
//          local FastAPI dev server).
const isCapacitor = () => {
  if (typeof window === 'undefined') return false;
  const cap = window.Capacitor;
  if (cap && typeof cap.isNativePlatform === 'function') {
    return cap.isNativePlatform();
  }
  // Fallback heuristic for older Capacitor builds: WebViews on Android
  // identify themselves with "; wv)" in the UA string.
  return /;\s*wv\)/i.test(window.navigator?.userAgent || '');
};

const STORAGE_KEY = 'pesalens.apiUrl';

const readStoredUrl = () => {
  try {
    if (typeof window === 'undefined') return '';
    return (window.localStorage?.getItem(STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
};

const envUrl =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || '';

const defaultUrl = isCapacitor() ? '' : 'http://localhost:8000/api';

const normalize = (raw) => (raw || '').trim().replace(/\/+$/, '');

export const getApiUrl = () => normalize(readStoredUrl() || envUrl || defaultUrl);

export const setApiUrl = (url) => {
  try {
    if (typeof window === 'undefined') return;
    const trimmed = normalize(url);
    if (!trimmed) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, trimmed);
    }
    window.dispatchEvent(new CustomEvent('pesalens:apiUrl', { detail: trimmed }));
  } catch {
    /* ignore storage failures */
  }
};

// Kept as a getter (named export) so callers always read the latest
// value after a runtime change. The historical `API_URL` constant is
// preserved for any consumer that imported it directly.
export const API_URL = getApiUrl();

const AUTH_PATHS = new Set(['/auth/signin', '/auth/signup', '/auth/refresh']);

let refreshInFlight = null;

const navigate = (path) => {
  if (typeof window === 'undefined') return;
  if (window.location.pathname !== path) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
};

// Exported so the auth-store boot path can drive a silent /auth/refresh
// on cold launch. `getRefreshToken()` is async (Capacitor Preferences) so
// we await it instead of reading sync the way earlier builds did.
export const refreshAccessToken = async () => {
  if (refreshInFlight) return refreshInFlight;
  const refresh = await getRefreshToken();
  if (!refresh) return null;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${getApiUrl()}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
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

const handleResponse = async (res) => {
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok || data?.success === false) {
    // FastAPI's structured detail ({code, message}) — used by the upload
    // PDF-unlock flow and other error codes that the UI branches on.
    const detailObj = data?.detail && typeof data.detail === 'object' ? data.detail : null;
    const error =
      data?.errors?.[0] ||
      data?.message ||
      detailObj?.message ||
      (typeof data?.detail === 'string' ? data.detail : null) ||
      'Request failed';
    const err = new Error(typeof error === 'string' ? error : 'Request failed');
    err.status = res.status;
    err.code = detailObj?.code || data?.errors?.[0] || null;
    err.payload = data;
    throw err;
  }
  return data;
};

const request = async (path, options = {}, { allowRetry = true } = {}) => {
  const base = getApiUrl();
  if (!base) {
    const err = new Error('Backend URL not configured. Open More → Backend to set it.');
    err.status = 0;
    throw err;
  }
  const url = `${base}${path}`;
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getAccessToken();
  if (token && !AUTH_PATHS.has(path) && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let res;
  try {
    res = await fetch(url, { ...options, headers });
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
    navigate('/signin');
  }

  if (res.status === 402) {
    let body = null;
    try { body = await res.json(); } catch { /* ignore */ }
    const detail = body?.detail || {};
    const err = new Error(detail.message || 'Subscription required');
    err.status = 402;
    err.code = detail.code || 'subscription_required';
    err.payload = body;
    navigate('/upgrade');
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
  const refresh = await getRefreshToken();
  try {
    await request('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refresh || '' }),
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

// Encrypted PDFs are unlocked transparently by the backend (no password
// field — the server brute-forces the 6-digit numeric keyspace used by
// Tanzanian bank statements). Adds ~5–30s to the request when triggered.
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

// Cross-source view: pairs every statement debit with the receipts and
// manual entries that plausibly explain it for [start_date, end_date].
// Backend caps the range at 365 days; LLM coaching is best-effort and
// the deterministic shape always ships even when llm_status !== 'ok'.
export const fetchReconciliation = (start_date, end_date, scope = 'personal') =>
  requestData('/reconcile', {
    method: 'POST',
    body: JSON.stringify({ start_date, end_date, scope }),
  });

// Streams the PDF and triggers a download in the WebView/browser.
export const downloadBusinessReport = async (month) => {
  const base = getApiUrl();
  if (!base) throw new Error('Backend URL not configured. Open More → Backend to set it.');
  const token = getAccessToken();
  const qs = month ? `?month=${encodeURIComponent(month)}` : '';
  const res = await fetch(`${base}/business/reports/monthly${qs}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 402) {
    navigate('/upgrade');
    throw new Error('Subscription required for downloads.');
  }
  if (!res.ok) {
    let detail = 'Could not generate report.';
    try {
      const body = await res.json();
      detail = body?.detail || body?.message || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const filename = (month || new Date().toISOString().slice(0, 7)) + '-pesalens-financials.pdf';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return { filename };
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

// Mobile-only: server-side verification of Apple/Google IAP receipts.
export const verifyMobileReceipt = (payload) =>
  requestData('/billing/verify', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

// ---------- markets ----------

export const fetchMarketSnapshot = () => requestData('/markets/all');

export const fetchPublicTicker = async () => {
  try {
    const base = getApiUrl();
    if (!base) return [];
    const res = await fetch(`${base}/markets/ticker`);
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
