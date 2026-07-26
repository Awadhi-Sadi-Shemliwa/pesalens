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

// ---- Shared status-classification (used by BOTH the fetch `request()` path
// and the XHR `uploadStatement` path, so auth/paywall/error semantics are
// defined once and can't drift between them) ----

// Path-based redirect (History API). The app uses path routing, so we push a
// real path and synthesize a popstate so the client router picks it up without
// a full reload. No-op when already on the target path.
const redirectTo = (path) => {
  if (typeof window === 'undefined') return;
  if (window.location.pathname === path) return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

// Shape a failed response body into an Error (matches the old handleResponse).
const makeApiError = (status, body, fallback = 'Request failed') => {
  const raw =
    body?.errors?.[0] || body?.message || body?.detail?.message || body?.detail || fallback;
  const err = new Error(typeof raw === 'string' ? raw : fallback);
  err.status = status;
  err.payload = body;
  if (body?.detail?.code) err.code = body.detail.code;
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
  redirectTo('/upgrade');
  return err;
};

// A 401 that survived a refresh attempt: clear the session, route to sign-in,
// and hand back a typed error.
const sessionExpiredError = () => {
  clearSession();
  redirectTo('/signin');
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
    redirectTo('/signin');
  }

  // 402 Payment Required — trial expired or Pro lapsed.
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

// Dashboard summary. With a jobId it's scoped to that uploaded statement;
// without, it reflects the latest upload (unchanged default).
export const fetchDashboardSummary = (jobId) =>
  requestData(`/dashboard/summary${jobId ? `?job_id=${encodeURIComponent(jobId)}` : ''}`);

// Every uploaded statement (bank, period, recency, counts) for the Dashboard
// statement selector / history.
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
// uploads, payments.
export const fetchActivity = () => requestData('/auth/me/activity');

// Upload via XHR so we can report REAL byte-upload progress (fetch can't
// stream upload progress). `onProgress(loaded, total)` fires as bytes leave
// the browser. Returns the UploadResponse data ({ job_id, filename,
// status:"processing" }); the caller then polls fetchUploadStatus(job_id).
//
// Mirrors request()'s auth handling: a 401 on an expired access token silently
// refreshes and retries ONCE, and a still-401 clears the session and routes to
// sign-in — so a long-idle tab doesn't dead-end the upload with a raw error.
export const uploadStatement = (file, onProgress) => {
  const attempt = (token, allowRetry) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_URL}/upload`);
      xhr.withCredentials = true;
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

// ---------- admin / owner dashboard ----------

// Build a querystring from an object, dropping empty values so an unset filter
// never reaches the server as `?code=` (which would match nothing rather than
// everything — the opposite of what an empty filter chip means).
const adminQuery = (params = {}) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

export const fetchAdminStats = () => requestData('/admin/stats');
export const fetchAdminUsers = (params = {}) => requestData(`/admin/users${adminQuery(params)}`);
// `code` stays positional-compatible with the original single-argument call so
// existing callers keep working; everything else arrives in the options bag.
export const fetchAdminErrors = (code, params = {}) =>
  requestData(`/admin/errors${adminQuery({ code, ...params })}`);
export const fetchAdminActivity = (params = {}) => requestData(`/admin/activity${adminQuery(params)}`);
export const fetchAdminFeedback = (params = {}) => requestData(`/admin/feedback${adminQuery(params)}`);
export const fetchAdminUserTimeline = (userId) =>
  requestData(`/admin/users/${encodeURIComponent(userId)}/timeline`);

// ---------- feedback + client-side error reporting ----------

// Asked once per account, on the first sign-out. Checked BEFORE the sign-out
// flow opens so a returning user never sees the form flash on screen.
export const fetchFeedbackPending = () => requestData('/feedback/pending');

export const submitFeedback = (payload) =>
  requestData('/feedback', { method: 'POST', body: JSON.stringify({ ...payload, client: 'web' }) });

// An explicit "Skip" — worth one of three chances, snoozes for 3 days.
export const skipFeedback = () => requestData('/feedback/skip', { method: 'POST' });

// An INCIDENTAL close — backdrop click, Escape, navigating away. Snoozes for a
// day and spends none of the three chances. Keeping this separate from skip is
// the whole fix for the original defect: the modal's onClose used to call skip,
// so mis-clicking beside the dialog opted you out of the form permanently.
export const dismissFeedback = () => requestData('/feedback/dismiss', { method: 'POST' });

// Report a crash the BROWSER saw. A React render error or a failed fetch never
// reaches the server's exception handler, so without this the owner console
// shows nothing however often it fires.
//
// Deliberately swallows its own failure: this is called from error paths (an
// error boundary, a catch block), and a reporter that can throw would replace
// the original error with its own and lose the thing we were trying to record.
export const reportClientError = async (message, { code, path } = {}) => {
  // Deliberately NOT routed through `request()`. That helper reacts to a 401 by
  // clearing the session and redirecting to /signin — correct for a user
  // action, catastrophic here. This runs from the ErrorBoundary, so it would
  // turn any render crash into a silent bounce to sign-in instead of the
  // boundary's own recovery screen: on a public page (landing, /terms,
  // /privacy, /signin, /signup) where there is no token at all, and equally on
  // an expired session whose refresh fails. The try/catch below cannot save us
  // either way — the redirect happens inside `request()`, before the error ever
  // propagates back here. A bare fetch has no such side effects: it reports
  // when it can, and is silently dropped by the server when it cannot.
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
        path: path || (typeof window !== 'undefined' ? window.location.hash || window.location.pathname : null),
        client: 'web',
      }),
    });
  } catch {
    // Nothing to do — an unreported error is strictly better than a crash
    // inside the reporter.
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
  // the client reconcile a timed-out scan via fetchReceiptByScan.
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
// scan_id after the client gave up? Returns { found, receipt }.
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
//
// Cross-source view: pairs every statement debit with the receipts and
// manual entries that plausibly explain it for [start_date, end_date].
// Backend caps the range at 365 days. Returns the deterministic result
// even when LLM is unavailable; the UI hides the insight slot when
// `llm_status !== 'ok'`.
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
  // summing the line items. `total ?? amount` only falls through on
  // null/undefined, so it would stop at that 0 and value the receipt at
  // nothing — and a legacy TZS receipt never gets a stamped `amount_tzs` to
  // rescue it, because _needs_fx returns False for TZS.
  const printed = [r.total, r.amount, r.subtotal]
    .map(Number)
    .find((v) => Number.isFinite(v) && v > 0);
  return printed ?? 0;
};

// Currency-aware amount for a ledger entry / receipt. TZS entries render as
// before; foreign-currency ones show the printed amount plus the TZS
// equivalent that actually counts in the totals: "140 USD (≈ TZS 373,100)".
// Accepts either a projected entry ({ amount, currency, originalAmount,
// fxPending }) or a raw receipt ({ amount_tzs|total, currency, original_amount,
// fx_pending }).
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

// Sub-amounts (subtotal, tax, line items) stay in the receipt's printed
// currency — only the headline total shows the TZS equivalent (fmtAmount).
export const fmtInCurrency = (value, currency) => {
  const cur = (currency || 'TZS').toUpperCase();
  if (cur === 'TZS') return fmtTZSFull(value);
  return `${Number(value || 0).toLocaleString()} ${cur}`;
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
