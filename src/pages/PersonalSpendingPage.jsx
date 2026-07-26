import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../components/navigation';
import { Icon } from '../components/Icon';
import { Badge, EmptyState, Modal, Eyebrow, CountUp, Segmented, FilterChip, ChipRow, Skeleton, ProgressBar, ErrorState, toast } from '../components/common';
import { TiltCard } from '../components/motion';
import { ChartJS, chartTheme } from '../components/ChartJS';
import LiveTextScanner from '../components/LiveTextScanner';
import {
  fetchReceiptPatterns,
  fetchReceipts,
  scanReceipt,
  fetchReceiptByScan,
  deleteReceipt,
  fmtTZS,
  fmtAmount,
  fmtInCurrency,
  receiptAmountTZS,
  fetchPersonalEntries,
  createPersonalEntry,
  deletePersonalEntry,
  fetchStatementIndex,
} from '../data/api';
import { useT, AutoT } from '../data/i18n';
import { consumeNavIntent } from '../components/Router';
import { useActiveStatement } from '../data/activeStatement';
import { bankLabel } from '../data/bankLabels';

const isoDaysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const todayIso = () => new Date().toISOString().slice(0, 10);

// Manual-entry picker. Mirrors the statement categorizer's vocabulary
// (backend/app/services/analytics.py) so manual rows and extracted rows roll
// up together — and carries no "Other": every option names real spending.
const PERSONAL_CATEGORIES = [
  'Groceries', 'Transport', 'Dining', 'Utilities', 'Telecom', 'Health',
  'Housing', 'Education', 'Entertainment', 'Debt', 'Insurance',
  'Government & Tax', 'Fees & Charges', 'Transfers', 'Business',
];

// A recognisable glyph per category so transaction rows read like the
// avatar-led lists in premium finance apps (falls back to a wallet).
const CATEGORY_ICON = {
  Groceries: 'receipt', Transport: 'trending', Dining: 'wallet', Utilities: 'zap',
  Health: 'shield', Housing: 'dashboard', Entertainment: 'play', Other: 'dollar',
};
const iconForCategory = (c) => CATEGORY_ICON[c] || 'wallet';

// "Today" / "Yesterday" / long date for the grouped transaction headers.
const dayHeading = (isoKey) => {
  if (!isoKey || isoKey === '—') return 'Undated';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(isoKey + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return isoKey;
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'long' });
};

// Backend receipt categories are lowercase — map onto the Title-Case labels
// the ledger renders so a grocery receipt files under Groceries. Every value
// the vision model can emit is mapped to a real spending category: an "Other"
// slice tells the user nothing about where their money went, so the map
// covers the full enum (see the receipt prompt in backend/app/routers/
// receipts.py) rather than dumping the tail into a catch-all.
const RECEIPT_CATEGORY_MAP = {
  groceries: 'Groceries',
  restaurant: 'Dining',
  utilities: 'Utilities',
  transport: 'Transport',
  fuel: 'Transport',
  tax: 'Government & Tax',
  bank_transfer: 'Transfers',
  mobile_money: 'Transfers',
  stock: 'Business',
  health: 'Health',
  pharmacy: 'Health',
  education: 'Education',
  entertainment: 'Entertainment',
  telecom: 'Telecom',
  airtime: 'Telecom',
  rent: 'Housing',
  other: 'Uncategorized',
};

// Fingerprint used to dedup legacy shadow PersonalEntry rows against the
// receipt they were silently mirrored from (old scan flow, commit 03d0e2e).
const entryKey = (e) =>
  [
    (e.date || '').slice(0, 10),
    (e.vendor || '').toLowerCase().trim() || (e.category || '').toLowerCase().trim(),
    Math.round(Number(e.amount) || 0),
  ].join('|');

const formatLedgerDate = (raw) => {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    weekday: 'short',
  });
};

const blankEntry = () => ({
  date: new Date().toISOString().slice(0, 10),
  vendor: '',
  category: 'Groceries',
  description: '',
  amount: '',
});

/* ----------------------------------------------------------------
   ScanOverlay — HONEST receipt-scan feedback (design corpus §84–89,
   error-states.md #3). The instant a scan starts this blocks the surface so the
   user can't fire a second scan, shows indeterminate progress while the single
   vision-AI call runs, and resolves into a decisive success or a classified,
   timestamped failure with the right retry. It is NOT dismissable while scanning
   — the client-side scan timeout (110s, see scanReceipt in api.js) is the escape
   hatch, not a second upload.
   ---------------------------------------------------------------- */
const ScanOverlay = ({ job, onRetry, onClose }) => {
  if (!job || job.phase === 'idle') return null;
  const scanning = job.phase === 'scanning';
  const reconciling = job.phase === 'reconciling';
  const done = job.phase === 'done';
  const failed = job.phase === 'failed';
  const notReceipt = job.failure?.code === 'not_receipt';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md anim-in" />
      <div
        className="relative w-full max-w-md bg-surface-2 border border-bdr rounded-2xl p-6 anim-up"
        style={{ boxShadow: '0 40px 100px -20px rgba(0,0,0,0.7)' }}
      >
        {scanning && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2 h-2 rounded-full bg-accent anim-pulse-soft" />
              <span className="font-mono text-[10px] uppercase tracking-ticker text-txt-3">Scanning</span>
            </div>
            <h3 className="text-lg font-semibold tracking-tight mb-1 truncate">Reading your receipt</h3>
            <p className="text-sm text-txt-2 mb-5">
              Vision AI is pulling out the vendor, date, totals and line items…
            </p>
            <ProgressBar
              indeterminate
              tone="accent"
              label="Reading with vision AI"
              sublabel="This can take a moment — free-tier models are sometimes busy. Hang tight."
            />
          </>
        )}

        {reconciling && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2 h-2 rounded-full bg-exp anim-pulse-soft" />
              <span className="font-mono text-[10px] uppercase tracking-ticker text-txt-3">Still processing</span>
            </div>
            <h3 className="text-lg font-semibold tracking-tight mb-1 truncate">Taking longer than usual</h3>
            <p className="text-sm text-txt-2 mb-5">
              The connection dropped before we got an answer — checking whether your
              receipt was saved anyway…
            </p>
            <ProgressBar
              indeterminate
              tone="accent"
              label="Checking for your receipt"
              sublabel="This takes a few seconds. Don’t re-scan yet — we’ll tell you either way."
            />
          </>
        )}

        {done && (
          <div className="flex flex-col items-center text-center py-2">
            <div className="p-3 rounded-2xl bg-inc/10 border border-inc/25 mb-3">
              <Icon name="check" size={28} className="text-inc" />
            </div>
            <h3 className="text-lg font-semibold text-txt-1">Receipt captured</h3>
            <p className="text-sm text-txt-2 mt-1">
              {job.vendor || 'Saved'}{job.total != null ? ` · ${fmtAmount(job.receipt || job.total, { full: true })}` : ''}
            </p>
          </div>
        )}

        {failed && (
          <ErrorState
            icon={notReceipt ? 'image' : 'alert'}
            title={notReceipt ? 'That’s not a receipt' : 'Scan didn’t finish'}
            cause={job.failure?.message}
            code={job.failure?.code}
            timestamp={job.failure?.timestamp}
            onRetry={onRetry}
            retryLabel={notReceipt ? 'Choose another image' : 'Try again'}
          />
        )}

        {failed && (
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 p-1.5 rounded-lg text-txt-3 hover:text-txt-1 hover:bg-surface-4 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Icon name="x" size={18} />
          </button>
        )}
      </div>
    </div>
  );
};

const PersonalSpendingPage = () => {
  const [showScan, setShowScan] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  // Honest scan job state drives a prominent overlay: scanning → done, or a
  // classified failure with a reason + retry. `scanning` is derived so the
  // existing disabled/busy checks keep working unchanged.
  const [scanJob, setScanJob] = useState(null);
  const scanning = scanJob?.phase === 'scanning';
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [manualEntries, setManualEntries] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(blankEntry());
  const [patterns, setPatterns] = useState({ insights: [], by_category: {}, receipt_count: 0 });
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [txnFilter, setTxnFilter] = useState('all');   // all | receipt | manual
  const [catFilter, setCatFilter] = useState(null);    // null = every category
  const [trendRange, setTrendRange] = useState(14);     // 7 | 14 | 30 days
  const [loading, setLoading] = useState(true);
  const { t } = useT();

  // ── Per-statement scoping (Epic-2) ─────────────────────────────────────────
  // The ledger scopes to a single statement ("This statement", shared with the
  // Dashboard selector) or a broad "General" window. Default = statement; falls
  // back to General when the user has no uploads to scope to.
  const [activeJobId] = useActiveStatement();
  const [statements, setStatements] = useState([]);
  const [statementsReady, setStatementsReady] = useState(false);
  const [viewMode, setViewMode] = useState('statement'); // 'statement' | 'general'
  const [genStart, setGenStart] = useState(isoDaysAgo(90));
  const [genEnd, setGenEnd] = useState(todayIso());
  const showScope = statements.length > 0;
  // Only trust the active statement if it's actually one of THIS user's
  // statements — a stale id (e.g. left in storage by a previous account) would
  // otherwise scope to a foreign job. Fall back to the newest (index is
  // newest-first, matching the backend's null-resolution).
  const effectiveJobId =
    (activeJobId && statements.some((s) => s.job_id === activeJobId))
      ? activeJobId
      : (statements[0]?.job_id || null);
  const activeStatement = statements.find((s) => s.job_id === effectiveJobId) || null;
  // The statement a NEWLY created entry/receipt belongs to. This must follow
  // what the user is actually looking at, not merely which statement is
  // newest: in the 'general' view they are working outside any statement, so
  // the row is general and must stay unscoped. Stamping it anyway would make
  // deleting that statement destroy hand-typed entries and receipt images —
  // the delete cascade matches this id exactly.
  const scopedJobId =
    (showScope && viewMode === 'statement') ? effectiveJobId : null;
  const scopeOpts = useMemo(() => {
    if (!showScope) return {};                              // no uploads → unscoped (as before)
    if (viewMode === 'general') return { scope: 'general', start: genStart, end: genEnd };
    if (effectiveJobId) return { scope: 'statement', jobId: effectiveJobId };
    return {};
  }, [showScope, viewMode, effectiveJobId, genStart, genEnd]);
  const scopeKey = JSON.stringify(scopeOpts);

  const galleryRef = useRef(null);
  const modalGalleryRef = useRef(null);

  const setDraftField = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));

  const refreshEntries = async (opts = scopeOpts) => {
    try {
      const rows = await fetchPersonalEntries(opts);
      setManualEntries(
        (rows || []).map((row) => ({
          id: row.id,
          date: row.entry_date,
          vendor: row.vendor || '',
          category: row.category,
          description: row.description || '',
          amount: row.amount,
          source: 'manual',
        })),
      );
    } catch (err) {
      // Surface only if it's not the expected "not authed yet" case.
      if (err?.status && err.status !== 401) {
        setError(err.message || 'Could not load entries.');
      }
    }
  };

  const refreshReceipts = async (opts = scopeOpts) => {
    try {
      const rows = await fetchReceipts(opts);
      setReceipts(rows || []);
    } catch (err) {
      if (err?.status && err.status !== 401) {
        setError(err.message || 'Could not load receipts.');
      }
    }
  };

  const saveManualEntry = async () => {
    const amt = parseFloat(draft.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter a valid amount greater than 0.');
      return;
    }
    if (!draft.vendor.trim()) {
      setError('Vendor / payee is required.');
      return;
    }
    setError(null);
    try {
      const saved = await createPersonalEntry({
        entry_date: draft.date,
        vendor: draft.vendor.trim(),
        category: draft.category,
        description: draft.description.trim() || null,
        amount: amt,
        direction: 'expense',
        statement_job_id: scopedJobId || undefined,
      });
      setManualEntries((prev) => [
        {
          id: saved.id,
          date: saved.entry_date,
          vendor: saved.vendor || '',
          category: saved.category,
          description: saved.description || '',
          amount: saved.amount,
          source: 'manual',
        },
        ...prev,
      ]);
      setDraft(blankEntry());
      setShowAdd(false);
      toast.success('Entry saved');
    } catch (err) {
      setError(err?.message || 'Could not save entry.');
      toast.error(err?.message || 'Could not save entry.');
    }
  };

  const removeManualEntry = async (id) => {
    const previous = manualEntries;
    setManualEntries((prev) => prev.filter((e) => e.id !== id));
    try {
      await deletePersonalEntry(id);
      toast.success('Entry deleted');
    } catch (err) {
      setManualEntries(previous);
      setError(err?.message || 'Could not delete entry.');
      toast.error(err?.message || 'Could not delete entry.');
    }
  };

  const refreshPatterns = async () => {
    try {
      const data = await fetchReceiptPatterns();
      setPatterns(data);
    } catch (err) {
      // patterns endpoint optional; ignore
    }
  };

  useEffect(() => {
    /* Patterns + the statement index load once; the ledger itself reloads on
       every scope change (below). We gate the first ledger fetch on the index
       resolving so we don't fire an UNSCOPED request (statements still empty)
       and then immediately re-fetch scoped — which briefly flashed the full
       ledger before narrowing. */
    refreshPatterns();
    fetchStatementIndex()
      .then((rows) => setStatements(rows || []))
      .catch(() => { /* index is non-critical — fall back to unscoped */ })
      .finally(() => setStatementsReady(true));
  }, []);

  useEffect(() => {
    /* Only the first load draws a skeleton; later scope switches must not blank
       out a list the user is already reading (§80). Wait for the statement
       index so the very first fetch already carries the right scope. */
    if (!statementsReady) return;
    Promise.allSettled([refreshEntries(scopeOpts), refreshReceipts(scopeOpts)]).finally(() =>
      setLoading(false),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, statementsReady]);

  // Honour a one-shot intent handed over by another page (e.g. the
  // reconciliation "Scan a receipt" CTA). `scan` opens the gallery/camera
  // picker; `add` opens the manual-entry form — so a personal-scope action in
  // reconciliation lands exactly on the right personal action here.
  useEffect(() => {
    const intent = consumeNavIntent();
    if (intent === 'scan') setShowScan(true);
    else if (intent === 'add') { setError(null); setShowAdd(true); }
  }, []);

  // Success path shared by a normal scan response and a reconciled late save.
  const finishScanSuccess = async (data, file) => {
    setLatest(data);
    setHistory((prev) => [data, ...prev].slice(0, 10));
    await refreshPatterns();
    await refreshReceipts();
    setScanJob({ phase: 'done', file, vendor: data.vendor, total: data.total, receipt: data });
    toast.success('Receipt captured');
    // Let the success state land, then dismiss (the Latest card shows below).
    setTimeout(() => setScanJob((j) => (j?.phase === 'done' ? null : j)), 1400);
  };

  // A timed-out/aborted request does NOT mean the scan failed: the server may
  // have saved the receipt after the browser gave up (that race produced the
  // old "failed… then the receipt appears anyway" behavior). Before declaring
  // failure, poll the by-scan lookup for the receipt this attempt would have
  // saved.
  const reconcileScan = async (file, scanId, originalErr) => {
    setScanJob({ phase: 'reconciling', file, scanId });
    for (let attempt = 0; attempt < 7; attempt++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetchReceiptByScan(scanId);
        if (res?.found && res.receipt) {
          await finishScanSuccess(res.receipt, file);
          return;
        }
      } catch {
        // Lookup itself failing (still offline) — keep trying until the window closes.
      }
    }
    setScanJob({
      phase: 'failed', file, scanId,
      failure: {
        message: originalErr?.message || 'Receipt scan failed',
        code: originalErr?.code || 'scan_error',
        timestamp: Date.now(),
      },
    });
    toast.error(originalErr?.message || 'Receipt scan failed', { ttl: 10000 });
  };

  const handleScan = async (file, existingScanId = null) => {
    if (!file) return;
    setError(null);
    setNotice(null);
    // Idempotency key for this scan attempt. A retry reuses the same id so the
    // backend can short-circuit to the already-saved receipt instead of
    // scanning (and saving) twice.
    const scanId = existingScanId
      || (window.crypto?.randomUUID ? window.crypto.randomUUID()
          : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`);
    setScanJob({ phase: 'scanning', file, scanId });
    try {
      // Associate the receipt with the statement in focus (or newest when
      // viewing General) so it lands in the right per-statement scope.
      const data = await scanReceipt(file, { statementJobId: scopedJobId, scanId });
      if (data?.is_receipt === false) {
        // The backend returns 200 + is_receipt:false for TWO different reasons:
        // the model saw a non-receipt image (carries image_description), or every
        // vision model was busy/failed (message only). Surface either prominently
        // with the right next step — retrying a non-receipt is pointless, so that
        // case sends the user to pick another image instead.
        const notReceipt = !!data.image_description;
        setScanJob({
          phase: 'failed', file, scanId,
          failure: {
            message: data.message || 'That image is not a receipt.',
            code: notReceipt ? 'not_receipt' : 'vision_unavailable',
            timestamp: Date.now(),
          },
        });
        toast.warning(data.message || 'That image is not a receipt.');
        return;
      }
      await finishScanSuccess(data, file);
    } catch (err) {
      // Timeout / network drop: the server may have finished after we gave
      // up. Reconcile before showing a failure. Clean HTTP error responses
      // (4xx/5xx) are decisive and fail immediately as before.
      if (err?.code === 'scan_timeout' || err?.transient) {
        await reconcileScan(file, scanId, err);
        return;
      }
      setScanJob({
        phase: 'failed', file, scanId,
        failure: {
          message: err?.message || 'Receipt scan failed',
          code: err?.code || 'scan_error',
          timestamp: Date.now(),
        },
      });
      toast.error(err?.message || 'Receipt scan failed', { ttl: 10000 });
    }
  };

  // Retry from the failure overlay: re-scan the same image for transient
  // failures; for a "not a receipt" verdict, re-open the picker so the user can
  // choose a different image (re-scanning the same one would just fail again).
  // The retry reuses the failed attempt's scan_id — if the first attempt DID
  // save server-side, the backend returns that receipt instantly instead of
  // scanning (and saving) a duplicate.
  const retryScan = () => {
    const job = scanJob;
    if (!job?.file) { setScanJob(null); return; }
    if (job.failure?.code === 'not_receipt') {
      setScanJob(null);
      galleryRef.current?.click();
      return;
    }
    handleScan(job.file, job.scanId || null);
  };

  // Late-arrival dismissal: if the overlay is showing "failed" but a refresh
  // brings in the receipt this very scan saved (it arrived after the polling
  // window closed), clear the failure — the scan did succeed.
  useEffect(() => {
    if (scanJob?.phase !== 'failed' || !scanJob.scanId) return;
    const match = (receipts || []).find((r) => r.client_scan_id === scanJob.scanId);
    if (match) {
      setScanJob(null);
      toast.success('That receipt was saved after all — it’s in your ledger.');
    }
  }, [receipts, scanJob]);

  const handleCameraCapture = async (file) => {
    setShowCamera(false);
    setShowScan(false);
    await handleScan(file);
  };

  const handleTextResult = async (data) => {
    setShowCamera(false);
    setShowScan(false);
    if (!data) return;
    if (data.is_receipt === false) {
      setNotice(data.message || 'That image is not a receipt. Please add a receipt.');
      return;
    }
    setLatest(data);
    setHistory((prev) => [data, ...prev].slice(0, 10));
    await refreshPatterns();
    await refreshReceipts();
  };

  const onPick = (event, closeModal = false) => {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    if (closeModal) setShowScan(false);
    handleScan(picked);
  };

  const totalCategoryCounts = Object.entries(patterns.by_category || {});
  const totalScanned = patterns.receipt_count || 0;

  // Project receipts into the same shape as manualEntries so the ledger list
  // and detail modal can treat them uniformly. Receipts get `source: 'receipt'`
  // and the full payload nested under `receipt` for the line-item detail view.
  const receiptEntries = (receipts || []).map((r) => ({
    id: `receipt:${r.id}`,
    date: r.date || (r.scanned_at || '').slice(0, 10),
    vendor: r.vendor || 'Receipt',
    category: RECEIPT_CATEGORY_MAP[(r.category || 'other').toLowerCase()] || 'Uncategorized',
    description: (r.items || []).map((it) => it.name).filter(Boolean).join(', '),
    // amount is ALWAYS the TZS value used by the rollups below. receiptAmountTZS
    // mirrors the backend: a foreign receipt whose FX is still pending (no
    // amount_tzs) is valued at 0 here rather than having its printed foreign
    // `total` summed in as TZS — which would inflate the totals ~2600x. The row
    // still displays its true '140 USD' via fmtAmount.
    amount: receiptAmountTZS(r),
    currency: (r.currency || 'TZS').toUpperCase(),
    originalAmount: r.original_amount ?? null,
    fxRate: r.fx_rate ?? null,
    fxPending: r.fx_pending ?? false,
    source: 'receipt',
    receipt: r,
  }));

  // Drop manual rows that fingerprint-match a receipt (legacy shadow entries
  // from the old scan flow — see commit 03d0e2e).
  const receiptKeys = new Set(receiptEntries.map(entryKey));
  const dedupedManual = manualEntries.filter((e) => !receiptKeys.has(entryKey(e)));
  const allEntries = [...receiptEntries, ...dedupedManual].sort((a, b) =>
    (b.date || '').localeCompare(a.date || ''),
  );

  const today = new Date().toISOString().slice(0, 10);
  const todayExpenses = allEntries
    .filter((e) => e.date === today)
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const monthlyTotal = allEntries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const receiptSpend = allEntries.filter((e) => e.source === 'receipt').reduce((s, e) => s + (Number(e.amount) || 0), 0);

  /* ---- Derived analytics (all from real entries — nothing faked) ---- */
  const th = chartTheme();

  // Spend per category, biggest first, each with a stable palette colour.
  const catAgg = useMemo(() => {
    const m = {};
    for (const e of allEntries) {
      const k = e.category || 'Other';
      m[k] = (m[k] || 0) + (Number(e.amount) || 0);
    }
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEntries.length, monthlyTotal]);
  const palette = th.palette;
  const catColor = Object.fromEntries(catAgg.map((c, i) => [c.name, palette[i % palette.length]]));
  const topCategory = catAgg[0];

  // Daily spend for the trend area chart (last N days, zero-filled).
  const dailySeries = useMemo(() => {
    const m = {};
    for (const e of allEntries) {
      const k = (e.date || '').slice(0, 10);
      if (k) m[k] = (m[k] || 0) + (Number(e.amount) || 0);
    }
    const out = [];
    for (let i = trendRange - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = d.toISOString().slice(0, 10);
      out.push({ key: k, value: m[k] || 0 });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEntries.length, monthlyTotal, trendRange]);

  // Favourite spends — vendors you pay most, by total.
  const topVendors = useMemo(() => {
    const m = {};
    for (const e of allEntries) {
      const k = (e.vendor || '').trim() || 'Unlabelled';
      if (!m[k]) m[k] = { vendor: k, total: 0, count: 0, category: e.category };
      m[k].total += Number(e.amount) || 0;
      m[k].count += 1;
    }
    return Object.values(m).sort((a, b) => b.total - a.total).slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEntries.length, monthlyTotal]);

  // Two independent facets: source (all|receipt|manual) and category. Selecting
  // in a second facet intersects — AND across groups (filter-chips.md #3).
  const bySource = (e) =>
    txnFilter === 'all' ? true : txnFilter === 'receipt' ? e.source === 'receipt' : e.source !== 'receipt';
  const byCategory = (e) => (catFilter ? e.category === catFilter : true);
  const filteredEntries = allEntries.filter((e) => bySource(e) && byCategory(e));

  // Each facet's counts are measured against the OTHER facet's current
  // selection, so a chip never promises rows the sibling filter has already
  // excluded — tapping it would land on an empty list.
  const sourceCounts = {
    receipt: allEntries.filter((e) => e.source === 'receipt' && byCategory(e)).length,
    manual: allEntries.filter((e) => e.source !== 'receipt' && byCategory(e)).length,
  };
  const categoryCounts = useMemo(() => {
    const by = {};
    for (const e of allEntries) if (bySource(e)) by[e.category] = (by[e.category] || 0) + 1;
    return by;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEntries.length, txnFilter, monthlyTotal]);
  const categories = useMemo(
    () => [...new Set(allEntries.map((e) => e.category).filter(Boolean))].sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allEntries.length, monthlyTotal],
  );
  const activeFilterCount = (txnFilter !== 'all' ? 1 : 0) + (catFilter ? 1 : 0);

  const dayGroups = useMemo(() => {
    const by = {};
    for (const e of filteredEntries) {
      const k = (e.date || '').slice(0, 10) || '—';
      (by[k] || (by[k] = [])).push(e);
    }
    return Object.keys(by).sort((a, b) => b.localeCompare(a)).map((k) => ({
      key: k,
      heading: dayHeading(k),
      total: by[k].reduce((s, e) => s + (Number(e.amount) || 0), 0),
      items: by[k],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredEntries.length, txnFilter, catFilter, monthlyTotal]);

  const overviewTiles = [
    { label: t('pp.session'), sub: 'All recorded spend', val: monthlyTotal, grad: 'from-exp/25 via-exp/10 to-transparent', ring: 'border-exp/25', chip: 'bg-exp/15 text-exp', icon: 'wallet' },
    { label: t('pp.todayExpenses'), sub: "Spent so far today", val: todayExpenses, grad: 'from-accent/25 via-accent/10 to-transparent', ring: 'border-accent/25', chip: 'bg-accent/15 text-accent', icon: 'arrowDownRight' },
    { label: 'From receipts', sub: `${totalScanned} scanned`, val: receiptSpend, grad: 'from-net/25 via-net/10 to-transparent', ring: 'border-net/25', chip: 'bg-net/15 text-net', icon: 'receipt' },
  ];

  return (
    <AppShell>
      <div className="space-y-7">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <Eyebrow num="00">{t('pp.eyebrow')}</Eyebrow>
            <h1 className="mt-2 text-2xl lg:text-3xl font-semibold tracking-tight">{t('pp.title')}</h1>
            <p className="text-xs text-txt-3 mt-1.5 font-mono uppercase tracking-ticker">{t('pp.tagline')}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => { setError(null); setShowAdd(true); }} className="press btn-primary px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2">
              <Icon name="plus" size={14} />{t('bk.addEntry')}
            </button>
            <button onClick={() => setShowScan(true)} className="press btn-secondary px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2">
              <Icon name="receipt" size={14} />{t('bk.scanReceipt')}
            </button>
          </div>
        </div>

        {/* ===== SCOPE ============================================== */}
        {showScope && (
          <div className="rounded-2xl border border-bdr bg-surface-2/40 p-3 sm:p-3.5 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <Segmented
                label="Ledger scope"
                value={viewMode}
                onChange={setViewMode}
                options={[
                  { key: 'statement', label: 'This statement' },
                  { key: 'general', label: 'General' },
                ]}
              />
              {viewMode === 'statement' && activeStatement && (
                <div className="flex items-center gap-1.5 min-w-0">
                  <Badge color="net">{bankLabel(activeStatement.bank, 'Statement')}</Badge>
                  {activeStatement.period_end && (
                    <span className="text-[11px] text-txt-3 font-mono truncate">
                      {activeStatement.period_start || '—'} → {activeStatement.period_end}
                    </span>
                  )}
                </div>
              )}
            </div>
            {viewMode === 'general' && (
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-[11px] text-txt-3 uppercase tracking-wide">From</label>
                <input type="date" value={genStart} max={genEnd}
                  onChange={(e) => setGenStart(e.target.value)}
                  className="focus-ring bg-surface-1 border border-bdr rounded-lg px-2.5 py-1.5 text-xs text-txt-1" />
                <label className="text-[11px] text-txt-3 uppercase tracking-wide">To</label>
                <input type="date" value={genEnd} min={genStart} max={todayIso()}
                  onChange={(e) => setGenEnd(e.target.value)}
                  className="focus-ring bg-surface-1 border border-bdr rounded-lg px-2.5 py-1.5 text-xs text-txt-1" />
              </div>
            )}
          </div>
        )}

        {/* Top-level status banners (kept visible above the fold). */}
        {notice && (
          <div className="p-3 bg-net/10 border border-net/30 rounded-xl text-sm text-net flex items-start gap-2">
            <Icon name="alert" size={16} className="mt-0.5 flex-shrink-0" /><span>{notice}</span>
          </div>
        )}
        {error && (
          <div className="p-3 bg-exp/10 border border-exp/30 rounded-xl text-sm text-exp">{error}</div>
        )}

        {/* ===== OVERVIEW + ANALYTICS ================================= */}
        <div className="grid lg:grid-cols-12 gap-4 sm:gap-5">
          {/* Overview — gradient headline tiles */}
          <div className="lg:col-span-7 min-w-0">
            <Eyebrow num="01">Overview</Eyebrow>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              {overviewTiles.map((tile) => (
                <TiltCard key={tile.label} max={6} className="h-full">
                  <div className={`relative h-full overflow-hidden rounded-2xl border ${tile.ring} bg-gradient-to-br ${tile.grad} p-4 sm:p-5`}>
                    <span aria-hidden className="absolute -right-8 -top-8 w-24 h-24 rounded-full bg-white/5 blur-2xl pointer-events-none" />
                    <div className="relative flex items-center justify-between mb-3">
                      <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${tile.chip}`}>
                        <Icon name={tile.icon} size={16} />
                      </span>
                      <Icon name="chevRight" size={14} className="text-txt-4" />
                    </div>
                    <div className="relative text-xl sm:text-2xl font-bold tabular tracking-tight text-txt-1 truncate">
                      <CountUp value={tile.val} formatter={fmtTZS} />
                    </div>
                    <div className="relative text-[11px] font-medium text-txt-2 mt-1 truncate">{tile.label}</div>
                    <div className="relative text-[10px] text-txt-3 uppercase tracking-ticker font-mono mt-0.5 truncate">{tile.sub}</div>
                  </div>
                </TiltCard>
              ))}
            </div>

            {/* Spending trend area chart lives under the tiles (the
                "portfolio" area from the reference, but your real daily spend). */}
            <div className="bento p-4 sm:p-5 mt-3 sm:mt-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold tracking-tight">Spending trend</h3>
                  <p className="text-[11px] text-txt-3 mt-0.5">Daily out over the last {trendRange} days.</p>
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-bdr/60 p-0.5 flex-shrink-0">
                  {[7, 14, 30].map((r) => (
                    <button key={r} onClick={() => setTrendRange(r)}
                      className={`text-[11px] px-2.5 py-1 rounded-md transition font-medium ${trendRange === r ? 'bg-accent/15 text-accent' : 'text-txt-3 hover:text-txt-1'}`}>
                      {r}D
                    </button>
                  ))}
                </div>
              </div>
              <SpendTrend series={dailySeries} th={th} />
            </div>
          </div>

          {/* Analytics — spend by category */}
          <div className="lg:col-span-5 min-w-0">
            <div className="bento p-4 sm:p-5 h-full flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-1">
                <Eyebrow num="02">Analytics</Eyebrow>
                <Badge color="muted">{catAgg.length} categories</Badge>
              </div>
              <div className="mt-2 mb-3">
                <div className="text-[11px] text-txt-3 uppercase tracking-ticker font-mono">Top category</div>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="text-xl sm:text-2xl font-bold tabular tracking-tight">
                    {topCategory ? fmtTZS(topCategory.value) : fmtTZS(0)}
                  </span>
                  {topCategory && <span className="text-xs text-txt-2">· {topCategory.name}</span>}
                </div>
              </div>
              {catAgg.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-sm text-txt-3 py-8">
                  Add or scan an expense to see the breakdown.
                </div>
              ) : (
                <CategoryBars data={catAgg} colorFor={(n) => catColor[n]} total={monthlyTotal} />
              )}
            </div>
          </div>
        </div>

        {/* ===== TRANSACTIONS + ACTION =============================== */}
        <div className="grid lg:grid-cols-12 gap-4 sm:gap-5">
          {/* Grouped transactions */}
          <div className="lg:col-span-7 min-w-0 bento overflow-hidden flex flex-col">
            <div className="p-4 sm:p-5 border-b border-bdr/70 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <Eyebrow num="03">Transactions</Eyebrow>
                <h3 className="mt-1.5 text-base font-semibold tracking-tight">{allEntries.length} recorded</h3>
              </div>
              {/* An exclusive facet with three options is a segmented control, not a
                  chip row (tabs.md #10). The badge recounts on the same frame as the
                  click, so a toggle always has a visible consequence (filter-chips.md #4). */}
              <Segmented
                label="Transaction source"
                value={txnFilter}
                onChange={setTxnFilter}
                options={[
                  { key: 'all', label: 'All', badge: allEntries.length },
                  { key: 'receipt', label: 'Receipts', badge: sourceCounts.receipt },
                  { key: 'manual', label: 'Manual', badge: sourceCounts.manual },
                ]}
              />
            </div>

            {/* Category facet — a scrolling chip row, since the set is open-ended
                and would wrap into a wall (filter-chips.md #8). Counts honour the
                source facet above; a category with none is disabled, not dropped. */}
            {categories.length > 0 && (
              <div className="px-4 sm:px-5 pt-3 border-b border-bdr/50 pb-3">
                <ChipRow
                  activeCount={activeFilterCount}
                  onClear={() => { setTxnFilter('all'); setCatFilter(null); }}
                  resultCount={filteredEntries.length}
                  resultNoun="shown"
                >
                  <FilterChip active={!catFilter} onClick={() => setCatFilter(null)}>All</FilterChip>
                  {categories.map((c) => (
                    <FilterChip
                      key={c}
                      active={catFilter === c}
                      disabled={!categoryCounts[c]}
                      count={categoryCounts[c] || 0}
                      onClick={() => setCatFilter(catFilter === c ? null : c)}
                    >
                      {c}
                    </FilterChip>
                  ))}
                </ChipRow>
              </div>
            )}

            {loading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
              </div>
            ) : dayGroups.length === 0 ? (
              allEntries.length > 0 ? (
                /* Not an empty ledger — the active filters hid every row. Name the
                   hidden count and hand back an exit (empty-states.md #9). */
                <EmptyState
                  kind="filtered"
                  title="No transactions match these filters"
                  hiddenCount={allEntries.length}
                  action={
                    <button onClick={() => { setTxnFilter('all'); setCatFilter(null); }} className="press btn-secondary rounded-xl px-4 py-2 text-[13px] font-semibold focus-ring">
                      Clear filters
                    </button>
                  }
                />
              ) : (
              <EmptyState
                kind="first-run"
                title={showScope && viewMode === 'statement' && activeStatement
                  ? `0 — nothing recorded yet for this statement`
                  : t('pp.empty.title')}
                desc={showScope && viewMode === 'statement' && activeStatement
                  ? `No receipts or entries are tagged to ${bankLabel(activeStatement.bank, 'this statement')} yet. Scan a receipt or add an entry — it’ll be linked to this statement.`
                  : t('pp.empty.desc')}
                action={
                  <button onClick={() => setShowAdd(true)} className="press btn-primary rounded-xl px-4 py-2 text-[13px] font-semibold focus-ring">
                    {t('bk.addEntry')}
                  </button>
                }
                secondaryAction={
                  <button onClick={() => setShowScan(true)} className="underline underline-offset-2 hover:text-txt-2 transition focus-ring rounded">
                    {t('pp.empty.scan')}
                  </button>
                }
              />
              )
            ) : (
              <div className="max-h-[560px] overflow-y-auto scrollbar-none divide-y divide-bdr/40">
                {dayGroups.map((grp) => (
                  <div key={grp.key}>
                    <div className="sticky top-0 z-10 flex items-center justify-between px-4 sm:px-5 py-2 bg-surface-2/90 backdrop-blur-sm">
                      <span className="text-[11px] font-semibold text-txt-2 uppercase tracking-ticker">{grp.heading}</span>
                      <span className="text-[11px] font-mono tabular text-txt-3">−{fmtTZS(grp.total)}</span>
                    </div>
                    {grp.items.map((entry) => {
                      const isReceipt = entry.source === 'receipt';
                      const color = catColor[entry.category] || th.tick;
                      return (
                        <div
                          key={entry.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelected(entry)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(entry); } }}
                          className="group flex items-center gap-3 px-4 sm:px-5 py-3 cursor-pointer hover:bg-surface-4/30 transition-colors"
                        >
                          <span className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
                            <Icon name={isReceipt ? 'receipt' : iconForCategory(entry.category)} size={15} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-txt-1 truncate">{entry.vendor || entry.category}</p>
                            <p className="text-[11px] text-txt-3 truncate">
                              {entry.category}{entry.description ? ` · ${entry.description}` : ''}
                            </p>
                          </div>
                          <div className="text-sm font-semibold text-exp tabular flex-shrink-0">−{fmtAmount(entry)}</div>
                          {!isReceipt && (
                            <button
                              onClick={(e) => { e.stopPropagation(); removeManualEntry(entry.id); }}
                              className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-txt-3 hover:text-exp p-1 flex-shrink-0 transition"
                              aria-label="Delete entry"
                            >
                              <Icon name="x" size={14} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Action column */}
          <div className="lg:col-span-5 min-w-0 space-y-4 sm:space-y-5">
            {/* Quick actions */}
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <button onClick={() => { setError(null); setShowAdd(true); }}
                className="bento p-4 text-left hover:border-accent/40 transition group">
                <span className="w-10 h-10 rounded-xl bg-accent/12 text-accent flex items-center justify-center mb-3 group-hover:scale-105 transition">
                  <Icon name="plus" size={18} />
                </span>
                <div className="text-sm font-semibold">Add expense</div>
                <div className="text-[11px] text-txt-3 mt-0.5">Log a payment manually</div>
              </button>
              <button onClick={() => setShowScan(true)}
                className="bento p-4 text-left hover:border-accent/40 transition group">
                <span className="w-10 h-10 rounded-xl bg-net/12 text-net flex items-center justify-center mb-3 group-hover:scale-105 transition">
                  <Icon name="receipt" size={18} />
                </span>
                <div className="text-sm font-semibold">Scan receipt</div>
                <div className="text-[11px] text-txt-3 mt-0.5">Extract line items with AI</div>
              </button>
            </div>

            {/* Spending this period + segmented category bar */}
            <div className="bento p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[11px] text-txt-3 uppercase tracking-ticker font-mono">Total spending</span>
                <Icon name="chart" size={14} className="text-txt-3" />
              </div>
              <div className="text-2xl font-bold tabular tracking-tight mb-3">{fmtTZS(monthlyTotal)}</div>
              <SegmentedCategoryBar data={catAgg} colorFor={(n) => catColor[n]} total={monthlyTotal} />
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
                {catAgg.slice(0, 6).map((c) => (
                  <span key={c.name} className="inline-flex items-center gap-1.5 text-[11px] text-txt-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: catColor[c.name] }} />
                    {c.name}
                  </span>
                ))}
                {catAgg.length === 0 && <span className="text-xs text-txt-3">No spend recorded yet.</span>}
              </div>
            </div>

            {/* Favourite spends */}
            <div className="bento p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-[11px] text-txt-3 uppercase tracking-ticker font-mono">Favourite spends</span>
                <Icon name="sparkles" size={14} className="text-accent" />
              </div>
              {topVendors.length === 0 ? (
                <p className="text-xs text-txt-3">Your most-paid vendors will appear here.</p>
              ) : (
                <div className="space-y-2.5">
                  {topVendors.map((v) => {
                    const color = catColor[v.category] || th.tick;
                    return (
                      <div key={v.vendor} className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold uppercase"
                          style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
                          {v.vendor.slice(0, 2)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{v.vendor}</div>
                          <div className="text-[11px] text-txt-3">×{v.count} · {v.category || 'Other'}</div>
                        </div>
                        <div className="text-sm font-semibold tabular flex-shrink-0">{fmtTZS(v.total)}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bento p-5 lg:p-6">
          <Eyebrow num="04">{t('pp.capture.eyebrow')}</Eyebrow>
          <h3 className="mt-2 mb-4 text-base font-semibold tracking-tight">{t('pp.capture.title')}</h3>

          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onPick(e)}
          />

          <div className="grid sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setShowCamera(true)}
              disabled={scanning}
              className="border-2 border-dashed border-bdr hover:border-accent/40 rounded-xl p-6 text-center transition disabled:opacity-50"
            >
              <div className="p-3 rounded-2xl bg-accent/10 w-fit mx-auto mb-3">
                <Icon name="camera" size={24} className="text-accent" />
              </div>
              <p className="text-sm font-medium mb-1">Take Photo</p>
              <p className="text-xs text-txt-3">Live camera with text selection &amp; smart scan</p>
            </button>
            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              disabled={scanning}
              className="border-2 border-dashed border-bdr hover:border-accent/40 rounded-xl p-6 text-center transition disabled:opacity-50"
            >
              <div className="p-3 rounded-2xl bg-accent/10 w-fit mx-auto mb-3">
                <Icon name="image" size={24} className="text-accent" />
              </div>
              <p className="text-sm font-medium mb-1">Choose from Gallery</p>
              <p className="text-xs text-txt-3">Pick any image from your device</p>
            </button>
          </div>

          <p className="text-xs text-txt-3 mt-3">
            {scanning
              ? 'Scanning… reading the image with vision AI.'
              : 'Any image works. We will tell you if it is not a receipt.'}
          </p>
        </div>

        {latest && (
          <div className="bento p-5 lg:p-6">
            <Eyebrow num="05">{t('pp.latest.eyebrow')}</Eyebrow>
            <h3 className="mt-2 mb-4 text-base font-semibold tracking-tight">{t('pp.latest.title')}</h3>
            <div className="grid sm:grid-cols-2 gap-4 text-sm">
              <div className="space-y-2">
                <div className="flex justify-between"><span className="text-txt-3">Vendor</span><span className="font-medium">{latest.vendor || '—'}</span></div>
                <div className="flex justify-between"><span className="text-txt-3">Date</span><span className="font-medium">{latest.date || '—'}</span></div>
                <div className="flex justify-between"><span className="text-txt-3">Category</span><Badge color="muted">{latest.category || 'other'}</Badge></div>
                <div className="flex justify-between"><span className="text-txt-3">Subtotal</span><span className="font-medium">{fmtInCurrency(latest.subtotal, latest.currency)}</span></div>
                <div className="flex justify-between"><span className="text-txt-3">Tax</span><span className="font-medium">{fmtInCurrency(latest.tax, latest.currency)}</span></div>
                <div className="flex justify-between text-txt-1"><span>Total</span><span className="font-bold">{fmtAmount(latest, { full: true })}</span></div>
              </div>
              <div>
                <p className="text-xs text-txt-3 mb-2">Line items</p>
                <div className="space-y-1.5 max-h-48 overflow-auto pr-2">
                  {(latest.items || []).map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between py-1 border-b border-bdr/30 last:border-0 text-xs">
                      <span className="text-txt-2">{item.name || '—'} {item.quantity ? `×${item.quantity}` : ''} {item.unit || ''}</span>
                      <span className="font-medium">{fmtInCurrency(item.price, latest.currency)}</span>
                    </div>
                  ))}
                  {(!latest.items || latest.items.length === 0) && (
                    <p className="text-xs text-txt-3">No line items extracted.</p>
                  )}
                </div>
                {latest.warning && <p className="text-xs text-net mt-3">{latest.warning}</p>}
              </div>
            </div>
          </div>
        )}

        <div className="bento p-5 lg:p-6">
          <Eyebrow num="06">{t('pp.patterns.eyebrow')}</Eyebrow>
          <h3 className="mt-2 mb-5 text-base font-semibold tracking-tight">{t('pp.patterns.title')}</h3>
          {patterns.insights && patterns.insights.length > 0 ? (
            <div className="grid sm:grid-cols-2 gap-4">
              {patterns.insights.map((insight, idx) => (
                <div key={idx} className="bg-surface-4/50 border border-bdr/50 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge color="accent"><AutoT>{insight.category}</AutoT></Badge>
                    <span className="text-sm font-semibold"><AutoT>{insight.title}</AutoT></span>
                  </div>
                  <p className="text-xs text-txt-2 leading-relaxed"><AutoT>{insight.insight}</AutoT></p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-txt-3">
              <AutoT>Scan at least 3 receipts in the same category (e.g. fuel, groceries) to unlock pattern insights.</AutoT>
            </p>
          )}
          {totalCategoryCounts.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {totalCategoryCounts.map(([name, count]) => (
                <Badge key={name} color="muted">{name}: {count}</Badge>
              ))}
            </div>
          )}
        </div>

        <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Personal Expense">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-txt-2 mb-1.5">Date</label>
                <input
                  type="date"
                  value={draft.date}
                  onChange={(e) => setDraftField('date', e.target.value)}
                  className="w-full bg-surface-4 border border-bdr rounded-lg px-3 py-2.5 text-sm text-txt-1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-txt-2 mb-1.5">Amount (TZS)</label>
                <input
                  type="number"
                  min="0"
                  value={draft.amount}
                  onChange={(e) => setDraftField('amount', e.target.value)}
                  placeholder="0"
                  className="w-full bg-surface-4 border border-bdr rounded-lg px-3 py-2.5 text-sm text-txt-1 placeholder-txt-3"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-txt-2 mb-1.5">Vendor / Payee</label>
              <input
                value={draft.vendor}
                onChange={(e) => setDraftField('vendor', e.target.value)}
                placeholder="e.g. Shoprite, M-Pesa, Total Fuel"
                className="w-full bg-surface-4 border border-bdr rounded-lg px-3 py-2.5 text-sm text-txt-1 placeholder-txt-3"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-txt-2 mb-1.5">Category</label>
              <select
                value={draft.category}
                onChange={(e) => setDraftField('category', e.target.value)}
                className="w-full bg-surface-4 border border-bdr rounded-lg px-3 py-2.5 text-sm text-txt-1"
              >
                {PERSONAL_CATEGORIES.map((cat) => <option key={cat}>{cat}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-txt-2 mb-1.5">Description (optional)</label>
              <input
                value={draft.description}
                onChange={(e) => setDraftField('description', e.target.value)}
                placeholder="What was this for?"
                className="w-full bg-surface-4 border border-bdr rounded-lg px-3 py-2.5 text-sm text-txt-1 placeholder-txt-3"
              />
            </div>
            {error && (
              <div className="p-3 bg-exp/10 border border-exp/30 rounded-xl text-xs text-exp">{error}</div>
            )}
            <button onClick={saveManualEntry} className="w-full press btn-primary btn-block py-3 rounded-xl font-semibold text-sm">Save Entry</button>
          </div>
        </Modal>

        <Modal open={showScan} onClose={() => setShowScan(false)} title="Scan Receipt">
          <div className="space-y-4">
            <input
              ref={modalGalleryRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onPick(e, true)}
            />

            <button
              type="button"
              onClick={() => { setShowScan(false); setShowCamera(true); }}
              className="w-full border-2 border-dashed border-bdr rounded-xl p-6 text-center hover:border-accent/40 transition flex items-center gap-4"
            >
              <div className="p-3 rounded-2xl bg-accent/10">
                <Icon name="camera" size={24} className="text-accent" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium">Take Photo</p>
                <p className="text-xs text-txt-3">Live camera with Samsung-style text selection</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => modalGalleryRef.current?.click()}
              className="w-full border-2 border-dashed border-bdr rounded-xl p-6 text-center hover:border-accent/40 transition flex items-center gap-4"
            >
              <div className="p-3 rounded-2xl bg-accent/10">
                <Icon name="image" size={24} className="text-accent" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium">Choose from Gallery</p>
                <p className="text-xs text-txt-3">Pick any image saved on your device</p>
              </div>
            </button>

            <p className="text-xs text-txt-3 text-center">
              The image is sent to a vision model on OpenRouter for line-item extraction.
            </p>
          </div>
        </Modal>

        <LiveTextScanner
          open={showCamera}
          onClose={() => setShowCamera(false)}
          onCapture={handleCameraCapture}
          onTextResult={handleTextResult}
          busy={scanning}
        />

        <EntryDetailModal
          entry={selected}
          onClose={() => setSelected(null)}
          onDeleteReceipt={async (id) => {
            await deleteReceipt(id);
            toast.success('Receipt deleted');
            setSelected(null);
            await refreshReceipts();
          }}
        />

        <ScanOverlay job={scanJob} onRetry={retryScan} onClose={() => setScanJob(null)} />
      </div>
    </AppShell>
  );
};

/* ----------------------------------------------------------------
   Spend-by-category horizontal bars — top category highlighted.
   ---------------------------------------------------------------- */
const CategoryBars = ({ data, colorFor, total }) => {
  const peak = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2.5 flex-1">
      {data.slice(0, 6).map((c) => {
        const pct = total > 0 ? Math.round((c.value / total) * 100) : 0;
        return (
          <div key={c.name}>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="inline-flex items-center gap-1.5 text-xs text-txt-2 truncate">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: colorFor(c.name) }} />
                <span className="truncate">{c.name}</span>
              </span>
              <span className="text-[11px] font-mono tabular text-txt-3 flex-shrink-0">{fmtTZS(c.value)} · {pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-surface-4/60 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${(c.value / peak) * 100}%`, background: colorFor(c.name) }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* One-line stacked bar — every category's share of total spend. */
const SegmentedCategoryBar = ({ data, colorFor, total }) => {
  if (!total || data.length === 0) {
    return <div className="h-3 rounded-full bg-surface-4/60" />;
  }
  return (
    <div className="h-3 rounded-full overflow-hidden flex bg-surface-4/60">
      {data.map((c) => (
        <div
          key={c.name}
          title={`${c.name} · ${fmtTZS(c.value)}`}
          style={{ width: `${(c.value / total) * 100}%`, background: colorFor(c.name) }}
          className="h-full first:rounded-l-full last:rounded-r-full"
        />
      ))}
    </div>
  );
};

/* Daily-spend area chart (Chart.js, theme-aware). */
const SpendTrend = ({ series, th }) => {
  const data = {
    labels: series.map((d) => d.key),
    datasets: [{
      data: series.map((d) => d.value),
      borderColor: th.accent,
      backgroundColor: th.accentFill,
      fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4,
      pointHoverBackgroundColor: th.accent,
    }],
  };
  const options = {
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: th.tick, font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6,
          callback(v) {
            const raw = this.getLabelForValue(v);
            const d = new Date(raw + 'T00:00:00');
            return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
          },
        },
      },
      y: {
        grid: { color: th.grid, drawBorder: false },
        ticks: {
          color: th.tick, font: { size: 9 },
          callback: (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : v),
        },
      },
    },
    plugins: {
      tooltip: {
        callbacks: {
          title: (items) => {
            const d = new Date(items[0].label + 'T00:00:00');
            return Number.isNaN(d.getTime()) ? items[0].label : d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'long' });
          },
          label: (ctx) => `Spent: ${fmtTZS(ctx.parsed.y)}`,
        },
      },
    },
  };
  return <ChartJS type="line" data={data} options={options} height={170} ariaLabel="Daily spending trend" />;
};

const EntryDetailModal = ({ entry, onClose, onDeleteReceipt }) => {
  const [deleting, setDeleting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => { setConfirmDel(false); }, [entry?.id]);
  if (!entry) return null;
  const isReceipt = entry.source === 'receipt';
  const items = isReceipt && Array.isArray(entry.receipt?.items) ? entry.receipt.items : [];
  const amount = Number(entry.amount) || 0;
  const subtotal = Number(entry.receipt?.subtotal) || 0;
  const tax = Number(entry.receipt?.tax) || 0;
  const currency = (entry.currency || entry.receipt?.currency || 'TZS').toUpperCase();
  return (
    <Modal
      open={!!entry}
      onClose={onClose}
      eyebrow={isReceipt ? 'Receipt detail' : 'Entry detail'}
      title={entry.vendor || entry.category || '—'}
    >
      <div className="space-y-5">
        <div className="bg-surface-4/40 border border-bdr/40 rounded-xl p-4 space-y-2">
          <div className="text-[11px] font-mono uppercase tracking-ticker text-txt-3">
            {formatLedgerDate(entry.date)}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge color="expense">Expense</Badge>
            {entry.category && <Badge color="muted">{entry.category}</Badge>}
            {isReceipt && <Badge color="accent">Receipt</Badge>}
          </div>
          {entry.description && !isReceipt && (
            <p className="text-sm text-txt-2 mt-1 leading-snug">{entry.description}</p>
          )}
          <div className="flex items-center justify-between pt-2 border-t border-bdr/30 mt-2">
            <span className="text-sm text-txt-3">Amount</span>
            <span className="text-base font-bold text-exp tabular">−{fmtAmount(entry, { full: true })}</span>
          </div>
        </div>

        {isReceipt && (subtotal > 0 || tax > 0) && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-surface-4/30 rounded-lg p-3">
              <div className="text-[11px] font-mono uppercase tracking-ticker text-txt-3 mb-1">Subtotal</div>
              <div className="font-semibold tabular">{fmtInCurrency(subtotal, currency)}</div>
            </div>
            <div className="bg-surface-4/30 rounded-lg p-3">
              <div className="text-[11px] font-mono uppercase tracking-ticker text-txt-3 mb-1">Tax</div>
              <div className="font-semibold tabular">{fmtInCurrency(tax, currency)}</div>
            </div>
          </div>
        )}

        {isReceipt && (
          <div>
            <div className="text-[11px] font-mono uppercase tracking-ticker text-txt-3 mb-2">Line items</div>
            {items.length === 0 ? (
              <p className="text-xs text-txt-3 italic">No line items captured.</p>
            ) : (
              <div className="border border-bdr/40 rounded-lg divide-y divide-bdr/30 max-h-72 overflow-auto">
                {items.map((it, i) => {
                  const qty = Number(it.quantity) || 1;
                  const unit = (it.unit || '').trim();
                  const name = it.name || 'Item';
                  // OCR returns either `line_total` or a single `price` per row;
                  // both already cover the row total — don't multiply.
                  const price = Number(it.line_total) || Number(it.price) || 0;
                  return (
                    <div key={i} className="px-3 py-2.5 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-txt-1 break-words">{name}</div>
                        <div className="text-[11px] text-txt-3 font-mono tabular mt-0.5">
                          {qty}{unit ? ` ${unit}` : '×'}
                        </div>
                      </div>
                      {price > 0 && (
                        <span className="text-xs font-mono tabular shrink-0">{fmtInCurrency(price, currency)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Receipts had no delete path at all until now, so a bad scan was
            permanent. Two-step rather than type-to-confirm: one receipt is
            low-stakes and trivially re-scanned. */}
        {isReceipt && entry.receipt?.id && (
          <div className="pt-1 border-t border-bdr/30">
            {!confirmDel ? (
              <button
                type="button"
                onClick={() => setConfirmDel(true)}
                className="press focus-ring mt-4 w-full text-sm font-medium px-4 py-2.5 rounded-lg bg-surface-3 text-dng border border-dng/25 hover:bg-dng/10 transition-colors"
              >
                Delete this receipt
              </button>
            ) : (
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button" disabled={deleting}
                  onClick={async () => {
                    setDeleting(true);
                    try { await onDeleteReceipt(entry.receipt.id); } finally { setDeleting(false); }
                  }}
                  className="press focus-ring flex-1 text-sm font-semibold px-4 py-2.5 rounded-lg bg-dng text-white hover:bg-dng/90 transition-colors disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Delete forever'}
                </button>
                <button
                  type="button" disabled={deleting}
                  onClick={() => setConfirmDel(false)}
                  className="press focus-ring text-sm font-medium px-4 py-2.5 rounded-lg bg-surface-3 text-txt-2 border border-bdr hover:bg-surface-4 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default PersonalSpendingPage;
