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

// ---- Shared status-classification (used by BOTH the fetch `request()` path
// and the XHR `uploadStatement` path, so auth/paywall/error semantics stay
// defined once and can't drift between them) ----

// Shape a failed response body into an Error. FastAPI's structured detail
// ({code, message}) — used by the upload PDF-unlock flow and other error codes
// the UI branches on — is preserved on `err.code`.
const makeApiError = (status, body, fallback = 'Request failed') => {
  const detailObj = body?.detail && typeof body.detail === 'object' ? body.detail : null;
  const error =
    body?.errors?.[0] ||
    body?.message ||
    detailObj?.message ||
    (typeof body?.detail === 'string' ? body.detail : null) ||
    fallback;
  const err = new Error(typeof error === 'string' ? error : fallback);
  err.status = status;
  err.code = detailObj?.code || body?.errors?.[0] || null;
  err.payload = body;
  return err;
};

// 402 Payment Required — trial expired or Pro lapsed. Route to /upgrade and
// return a typed error so the feature gate is unmistakable.
const makePaywallError = (body) => {
  const detail = body?.detail || {};
  const err = new Error(detail.message || 'Subscription required');
  err.status = 402;
  err.code = detail.code || 'subscription_required';
  err.payload = body;
  navigate('/upgrade');
  return err;
};

// A 401 that survived a refresh attempt: clear the session, bounce to sign-in,
// and hand back a typed error.
const sessionExpiredError = () => {
  clearSession();
  navigate('/signin');
  const err = new Error('Your session expired. Please sign in again.');
  err.status = 401;
  return err;
};

const handleResponse = async (res) => {
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok || data?.success === false) {
    throw makeApiError(res.status, data);
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
    throw makePaywallError(body);
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

// Dashboard summary. With a jobId it's scoped to that uploaded statement;
// without, it reflects the latest upload (unchanged default).
export const fetchDashboardSummary = (jobId) =>
  requestData(`/dashboard/summary${jobId ? `?job_id=${encodeURIComponent(jobId)}` : ''}`);

// Every uploaded statement (bank, period, recency, counts) for the statement
// selector / history.
export const fetchStatementIndex = async () => {
  const data = await requestData('/statements/index');
  return data?.statements || [];
};

// Extracted transactions are READ-ONLY — there is no update call by design.
// PesaLens's promise is that it reads the statement for you; an edit box on an
// extracted figure hands that job back to the user. Low-confidence rows are
// surfaced (payload.quality) so the user can upload a cleaner copy or delete
// the statement, never so they can retype the bank's numbers.
export const fetchAnalysis = (jobId) =>
  requestData(`/analysis/${encodeURIComponent(jobId)}`);

// Per-bank "money map": spend, fees, fee-rate + saving suggestions per service.
// Deterministic facts always ship; `llm_status !== 'ok'` → hide the coach slot.
export const fetchBankIntel = () => requestData('/banks/intel');

// Uploads history. Rows are created at QUEUE time, so pass status='done' when
// you need only extracted statements (a failed/queued row has no result JSON
// and would 404 on /analysis).
export const fetchUploads = (status) =>
  requestData(`/uploads${status ? `?status=${encodeURIComponent(status)}` : ''}`);

// What deleting a statement would remove: { transactions, receipts,
// personal_entries }. Always call this BEFORE offering the delete, so the
// confirmation states real counts instead of a vague warning.
export const fetchDeleteImpact = (jobId) =>
  requestData(`/uploads/${encodeURIComponent(jobId)}/impact`);

// Delete a statement AND everything derived from it — the receipts filed
// against it and the manual entries scoped to it. Irreversible; the caller
// must have confirmed. Entries the user added outside any statement are never
// touched (see the safety note in backend/app/routers/upload.py).
export const deleteStatement = (jobId) =>
  requestData(`/uploads/${encodeURIComponent(jobId)}`, { method: 'DELETE' });

// Is the once-per-30-days bulk clear available, and what would it remove?
// → { eligible, reason, receipts, personal_entries, next_available_at, ... }
// `reason` is 'attached' | 'cooldown' | 'nothing_to_clear' | null.
export const fetchStartOverEligibility = () =>
  requestData('/data/start-over/eligibility');

// Clear every receipt and manual personal entry. Statements and the business
// ledger are NOT touched. Only for accounts where nothing is linked to a
// statement — the server refuses otherwise (409) and enforces the cooldown (429).
export const startOver = () =>
  requestData('/data/start-over', { method: 'POST' });

// Per-user activity history (timestamped): sign-ins, password changes,
// uploads, payments. Powers the notifications bell.
export const fetchActivity = () => requestData('/auth/me/activity');

// Upload via XHR so we can report REAL byte-upload progress (fetch can't).
// `onProgress(loaded, total)` fires as bytes leave the device. Returns the
// UploadResponse data ({ job_id, filename, status:"processing" }); the caller
// then polls fetchUploadStatus(job_id) for extraction progress. Encrypted PDFs
// are unlocked transparently server-side in the background job.
export const uploadStatement = (file, onProgress) => {
  const base = getApiUrl();
  if (!base) {
    const err = new Error('Backend URL not configured. Open More → Backend to set it.');
    err.status = 0;
    return Promise.reject(err);
  }
  // Mirror requestData's auth handling: a 401 on an expired access token silently
  // refreshes and retries ONCE; a still-401 clears the session and routes to
  // sign-in, so a long-idle session doesn't dead-end the upload with a raw error.
  const attempt = (token, allowRetry) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${base}/upload`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) onProgress(e.loaded, e.total);
      };
      xhr.onload = async () => {
        let body = null;
        try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        // Auth/paywall/error semantics are shared with request() via the helpers
        // above, so a change to refresh/redirect/error-shaping applies to both.
        if (xhr.status === 401 && allowRetry) {
          const newToken = await refreshAccessToken();
          if (newToken) {
            attempt(newToken, false).then(resolve, reject);
            return;
          }
          return reject(sessionExpiredError());
        }
        if (xhr.status === 402) {
          return reject(makePaywallError(body));
        }
        if (xhr.status >= 200 && xhr.status < 300 && body?.success !== false) {
          return resolve(body?.data);
        }
        reject(makeApiError(xhr.status, body, 'Upload failed'));
      };
      xhr.onerror = () => {
        const err = new Error('Network error — backend unreachable.');
        err.status = 0;
        reject(err);
      };
      const formData = new FormData();
      formData.append('file', file);
      xhr.send(formData);
    });
  return attempt(getAccessToken(), true);
};

// Poll extraction progress for a job — real stage + percentage, or the
// stage/percentage + reason it failed at.
export const fetchUploadStatus = (jobId) =>
  requestData(`/upload/status/${encodeURIComponent(jobId)}`);

// ---------- admin / owner (allowlisted emails only; 404 otherwise) ----------

// Build a querystring, dropping empty values so an unset filter never reaches
// the server as `?code=` — which would match nothing rather than everything,
// the opposite of what an empty filter chip means.
const adminQuery = (params = {}) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

export const fetchAdminStats = () => requestData('/admin/stats');
export const fetchAdminUsers = (params = {}) => requestData(`/admin/users${adminQuery(params)}`);
export const fetchAdminErrors = (params = {}) => requestData(`/admin/errors${adminQuery(params)}`);
export const fetchAdminActivity = (params = {}) => requestData(`/admin/activity${adminQuery(params)}`);
export const fetchAdminFeedback = (params = {}) => requestData(`/admin/feedback${adminQuery(params)}`);
export const fetchAdminUserTimeline = (userId) =>
  requestData(`/admin/users/${encodeURIComponent(userId)}/timeline`);

// ---------- feedback + client-side error reporting ----------

// Asked once per account, on the first sign-out. Checked BEFORE the sign-out
// sheet opens so a returning user never sees the form flash on screen.
export const fetchFeedbackPending = () => requestData('/feedback/pending');

export const submitFeedback = (payload) =>
  requestData('/feedback', { method: 'POST', body: JSON.stringify({ ...payload, client: 'mobile' }) });

// An explicit "Skip" — worth one of three chances, snoozes for 3 days.
export const skipFeedback = () => requestData('/feedback/skip', { method: 'POST' });

// An INCIDENTAL close — backdrop tap, swipe-down, navigating away. Snoozes for
// a day and spends none of the three chances. Keeping this separate from skip
// is the whole fix for the original defect: the sheet's onClose used to call
// skip, so a stray tap outside the sheet opted you out of the form permanently
// — and on a phone, tapping outside a sheet is how people close things.
export const dismissFeedback = () => requestData('/feedback/dismiss', { method: 'POST' });

// Report a crash the APP saw. A React render error never reaches the server's
// exception handler, so without this the owner console shows nothing however
// often it fires — and on mobile, where we cannot look at the user's console,
// that is the only way a client-side bug is ever going to reach us.
//
// Deliberately swallows its own failure: it is called from error paths, and a
// reporter that can throw would replace the original error with its own.
export const reportClientError = async (message, { code, path } = {}) => {
  // Deliberately NOT routed through `request()` — see the web client for the
  // full reasoning. Short version: a 401 in there clears the session and
  // bounces to /signin, so reporting a render crash would swallow the
  // ErrorBoundary's own recovery UI — on a pre-auth screen with no token, and
  // on an expired session whose refresh fails. The try/catch below is too late
  // to stop that; a bare fetch has no session side effects at all.
  const token = getAccessToken();
  if (!token) return; // endpoint requires auth — nothing to send
  try {
    await fetch(`${API_URL}/telemetry/client-error`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        message: String(message ?? 'unknown').slice(0, 2000),
        error_code: code || 'client_error',
        path: path || (typeof window !== 'undefined' ? window.location?.pathname : null),
        client: 'mobile',
      }),
    });
  } catch {
    // An unreported error beats a crash inside the reporter.
  }
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

// The scan is a single blocking vision-AI call that can stall for a while when
// the free-tier models are busy (upstream 429/503 + retries). The backend now
// caps its whole vision cascade at a 75s wall-clock budget (SCAN_BUDGET_SEC) and
// runs it off the event loop, so it ALWAYS returns a decisive answer within
// ~80s. This abort is deliberately set above that budget so the backend wins the
// race — the client only aborts if the request truly hangs (dead network), and
// the caller shows the classified failure with a retry.
export const scanReceipt = async (file, { timeoutMs = 110000, statementJobId, scanId } = {}) => {
  const formData = new FormData();
  formData.append('file', file);
  // Associate the scanned receipt with the statement the user is focused on
  // (Epic-2 per-statement scoping). Omitted → the receipt is saved general,
  // belonging to no statement; the backend does not substitute the newest one.
  if (statementJobId) formData.append('statement_job_id', statementJobId);
  // Idempotency key: lets the backend recognise a retry of a scan whose first
  // attempt already saved (client aborted after the server finished), and lets
  // the client reconcile a timed-out scan via fetchReceiptByScan. Matters more
  // on mobile than on web — this races on exactly the flaky phone networks the
  // app runs on.
  if (scanId) formData.append('scan_id', scanId);
  const controller = new AbortController();
  const timedOut = { v: false };
  const timer = setTimeout(() => { timedOut.v = true; controller.abort(); }, timeoutMs);
  try {
    return await requestData('/receipts/scan', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
  } catch (err) {
    if (timedOut.v) {
      const e = new Error('The scan is taking longer than expected — the vision AI may be busy. Please try again in a moment.');
      e.code = 'scan_timeout';
      e.status = 0;
      e.transient = true;
      throw e;
    }
    // Transport-level failures (network drop, aborted fetch — status 0, never
    // a real HTTP response) — the server may still have completed the scan;
    // callers should reconcile before declaring failure.
    if (err && err.status === 0) {
      err.transient = true;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

// Reconcile a timed-out/aborted scan: did the server save a receipt for this
// scan_id after the client gave up? Returns { found, receipt }. Always 200, so
// the client can poll quietly without painting errors.
export const fetchReceiptByScan = (scanId) =>
  requestData(`/receipts/by-scan/${encodeURIComponent(scanId)}`);

// Scope opts (all optional): { scope:'statement'|'general', jobId, day, start, end }.
// No opts → the full gallery (unchanged default). See backend list_receipts.
const scopeQuery = (opts = {}) => {
  const { scope, jobId, day, start, end } = opts;
  const p = new URLSearchParams();
  if (scope) p.set('scope', scope);
  if (jobId) p.set('job_id', jobId);
  if (day) p.set('day', day);
  if (start) p.set('start', start);
  if (end) p.set('end', end);
  const qs = p.toString();
  return qs ? `?${qs}` : '';
};

export const fetchReceipts = async (opts = {}) => {
  const data = await requestData(`/receipts${scopeQuery(opts)}`);
  return data?.receipts || [];
};

export const fetchReceiptPatterns = () => requestData('/receipts/patterns');

// Delete one scanned receipt (its JSON, image and scan marker).
export const deleteReceipt = (receiptId) =>
  requestData(`/receipts/${encodeURIComponent(receiptId)}`, { method: 'DELETE' });

export const parseReceiptText = (text, { save = false } = {}) =>
  requestData('/receipts/parse-text', {
    method: 'POST',
    body: JSON.stringify({ text, save }),
  });

// ---------- personal entries ----------

export const fetchPersonalEntries = async (opts = {}) => {
  const data = await requestData(`/personal/entries${scopeQuery(opts)}`);
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
// `opts` (optional): { mode:'statement'|'general', jobId }. Statement mode
// scopes to a single upload over its own period (the date range is then only a
// hint — the backend derives the real period). Default general = today.
export const fetchReconciliation = (start_date, end_date, scope = 'personal', opts = {}) =>
  requestData('/reconcile', {
    method: 'POST',
    body: JSON.stringify({
      start_date,
      end_date,
      scope,
      mode: opts.mode || 'general',
      ...(opts.jobId ? { job_id: opts.jobId } : {}),
    }),
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

// What a receipt is worth in TZS for AGGREGATES (spend rollups, totals). The
// single front-end definition — mirrors the backend's receipt_amount_tzs so the
// two never disagree. A stamped `amount_tzs` wins; a TZS receipt uses its
// printed total; a foreign receipt with no amount_tzs (FX was unreachable at
// scan/heal time — it carries fx_pending) is valued at 0, NOT its printed
// foreign figure. Counting a 140-USD slip's `total` as TZS 140 would corrupt
// the sum by ~2600x; under-counting a known-unknown is recoverable, a silently
// wrong total is not. The row still DISPLAYS correctly via fmtAmount ('140 USD')
// — only the rollup drops it until the rate heals.
export const receiptAmountTZS = (r) => {
  if (r == null) return 0;
  const stamped = Number(r.amount_tzs);
  if (Number.isFinite(stamped) && stamped > 0) return stamped;
  if ((r.currency || 'TZS').toUpperCase() !== 'TZS') return 0;
  // First POSITIVE candidate wins, mirroring fx.receipt_printed_amount. A
  // receipt whose printed `total` was read as literal 0 (no total line on the
  // page) is still worth its subtotal, or the amount the backend computed by
  // summing the line items.
  const printed = [r.total, r.amount, r.subtotal]
    .map(Number)
    .find((v) => Number.isFinite(v) && v > 0);
  return printed ?? 0;
};

// Render ONE entry/receipt, honouring the currency it was printed in.
//
// PesaLens is TZS-first, but receipts arrive in USD/EUR/GBP (university fees,
// IOM medicals). The backend stamps `currency` + `original_amount` at save time
// and keeps `amount` in TZS, so formatting a foreign receipt's printed total
// with fmtTZS renders a flatly wrong number ("TZS 140" for a 140-USD receipt).
//
// Use this for a single entry; keep fmtTZS/fmtTZSFull for AGGREGATES, which are
// TZS by definition — mixing currencies into one sum would be meaningless.
export const fmtAmount = (entry, { full = false } = {}) => {
  const tz = full ? fmtTZSFull : fmtTZS;
  if (entry == null) return '—';
  if (typeof entry === 'number') return tz(entry);
  const cur = (entry.currency || 'TZS').toUpperCase();
  const original = Number(entry.originalAmount ?? entry.original_amount);
  const tzs = Number(
    entry.amount ?? entry.amount_tzs ?? entry.total ?? entry.subtotal ?? 0,
  );
  if (cur === 'TZS' || !Number.isFinite(original) || original <= 0) return tz(tzs);
  // FX still pending (rate was unreachable at scan time): the record carries an
  // explicit fx_pending flag and no converted amount_tzs, so `tzs` falls back
  // to the printed total. Trust that flag (plus a non-positive TZS as a legacy
  // fallback) — NOT `tzs === original`, which wrongly suppressed the equivalent
  // whenever a genuine conversion happened to round back to the printed amount
  // (a near-1 rate or a rounding coincidence).
  const fxPending = entry.fxPending ?? entry.fx_pending ?? false;
  if (fxPending || !Number.isFinite(tzs) || tzs <= 0) {
    return `${original.toLocaleString()} ${cur}`;
  }
  return `${original.toLocaleString()} ${cur} (≈ ${tz(tzs)})`;
};

// Sub-amounts of a receipt (subtotal, tax, line-item prices) stay in the
// currency actually printed on the paper — converting them individually would
// invite rounding drift against the stamped total.
export const fmtInCurrency = (value, currency) => {
  const cur = (currency || 'TZS').toUpperCase();
  if (cur === 'TZS') return fmtTZSFull(value);
  return `${Number(value || 0).toLocaleString()} ${cur}`;
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
