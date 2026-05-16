import React, { useEffect, useRef, useState } from 'react';
import { AppShell } from '../components/navigation';
import { Icon } from '../components/Icon';
import { Badge, Modal, Eyebrow } from '../components/common';
import LiveTextScanner from '../components/LiveTextScanner';
import {
  fetchReceiptPatterns,
  fetchReceipts,
  scanReceipt,
  fmtTZS,
  fmtTZSFull,
  fetchPersonalEntries,
  createPersonalEntry,
  deletePersonalEntry,
} from '../data/api';
import { useT, AutoT } from '../data/i18n';

const PERSONAL_CATEGORIES = ['Groceries', 'Transport', 'Dining', 'Utilities', 'Health', 'Housing', 'Entertainment', 'Other'];

// Backend receipt categories are lowercase — map onto the Title-Case labels
// the ledger renders so a grocery receipt files under Groceries, not "other".
const RECEIPT_CATEGORY_MAP = {
  groceries: 'Groceries',
  restaurant: 'Dining',
  utilities: 'Utilities',
  transport: 'Transport',
  fuel: 'Transport',
  stock: 'Other',
  other: 'Other',
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

const PersonalSpendingPage = () => {
  const [showScan, setShowScan] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [manualEntries, setManualEntries] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(blankEntry());
  const [patterns, setPatterns] = useState({ insights: [], by_category: {}, receipt_count: 0 });
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const { t } = useT();

  const galleryRef = useRef(null);
  const modalGalleryRef = useRef(null);

  const setDraftField = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));

  const refreshEntries = async () => {
    try {
      const rows = await fetchPersonalEntries();
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

  const refreshReceipts = async () => {
    try {
      const rows = await fetchReceipts();
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
    } catch (err) {
      setError(err?.message || 'Could not save entry.');
    }
  };

  const removeManualEntry = async (id) => {
    const previous = manualEntries;
    setManualEntries((prev) => prev.filter((e) => e.id !== id));
    try {
      await deletePersonalEntry(id);
    } catch (err) {
      setManualEntries(previous);
      setError(err?.message || 'Could not delete entry.');
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
    refreshPatterns();
    refreshEntries();
    refreshReceipts();
  }, []);

  const handleScan = async (file) => {
    if (!file) return;
    setScanning(true);
    setError(null);
    setNotice(null);
    try {
      const data = await scanReceipt(file);
      if (data?.is_receipt === false) {
        setNotice(data.message || 'That image is not a receipt. Please add a receipt.');
        return;
      }
      setLatest(data);
      setHistory((prev) => [data, ...prev].slice(0, 10));
      await refreshPatterns();
      await refreshReceipts();
    } catch (err) {
      setError(err.message || 'Receipt scan failed');
    } finally {
      setScanning(false);
    }
  };

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
    category: RECEIPT_CATEGORY_MAP[(r.category || 'other').toLowerCase()] || 'Other',
    description: (r.items || []).map((it) => it.name).filter(Boolean).join(', '),
    amount: Number(r.total) || Number(r.amount) || 0,
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
            <button onClick={() => { setError(null); setShowAdd(true); }} className="btn-primary px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2">
              <Icon name="plus" size={14} />{t('bk.addEntry')}
            </button>
            <button onClick={() => setShowScan(true)} className="btn-secondary px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2">
              <Icon name="receipt" size={14} />{t('bk.scanReceipt')}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[
            { label: t('pp.todayExpenses'),    val: fmtTZS(todayExpenses),            icon: 'arrowDownRight', c: 'exp' },
            { label: t('pp.scanned'),          val: totalScanned,                     icon: 'receipt',        c: 'accent' },
            { label: t('pp.session'),          val: fmtTZS(monthlyTotal),             icon: 'wallet',         c: 'net' },
            { label: t('pp.patternInsights'),  val: (patterns.insights || []).length, icon: 'sparkles',       c: 'inc' },
          ].map((stat, idx) => (
            <div key={idx} className="card-soft p-4 card-hover">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] uppercase tracking-ticker text-txt-3">{stat.label}</span>
                <Icon name={stat.icon} size={14} className={stat.c === 'inc' ? 'text-inc' : stat.c === 'exp' ? 'text-exp' : stat.c === 'net' ? 'text-net' : 'text-accent'} />
              </div>
              <div className={`text-lg lg:text-xl font-bold tabular tracking-tight ${stat.c === 'inc' ? 'text-inc' : stat.c === 'exp' ? 'text-exp' : stat.c === 'net' ? 'text-net' : 'text-txt-1'}`}>{stat.val}</div>
            </div>
          ))}
        </div>

        <div className="card-soft p-5 lg:p-6">
          <Eyebrow num="01">{t('pp.capture.eyebrow')}</Eyebrow>
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

          {notice && (
            <div className="mt-4 p-3 bg-net/10 border border-net/30 rounded-xl text-sm text-net flex items-start gap-2">
              <Icon name="alert" size={16} className="mt-0.5 flex-shrink-0" />
              <span>{notice}</span>
            </div>
          )}
          {error && (
            <div className="mt-4 p-3 bg-exp/10 border border-exp/30 rounded-xl text-sm text-exp">{error}</div>
          )}
        </div>

        {latest && (
          <div className="card-soft p-5 lg:p-6">
            <Eyebrow num="02">{t('pp.latest.eyebrow')}</Eyebrow>
            <h3 className="mt-2 mb-4 text-base font-semibold tracking-tight">{t('pp.latest.title')}</h3>
            <div className="grid sm:grid-cols-2 gap-4 text-sm">
              <div className="space-y-2">
                <div className="flex justify-between"><span className="text-txt-3">Vendor</span><span className="font-medium">{latest.vendor || '—'}</span></div>
                <div className="flex justify-between"><span className="text-txt-3">Date</span><span className="font-medium">{latest.date || '—'}</span></div>
                <div className="flex justify-between"><span className="text-txt-3">Category</span><Badge color="muted">{latest.category || 'other'}</Badge></div>
                <div className="flex justify-between"><span className="text-txt-3">Subtotal</span><span className="font-medium">{fmtTZSFull(latest.subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-txt-3">Tax</span><span className="font-medium">{fmtTZSFull(latest.tax)}</span></div>
                <div className="flex justify-between text-txt-1"><span>Total</span><span className="font-bold">{fmtTZSFull(latest.total)}</span></div>
              </div>
              <div>
                <p className="text-xs text-txt-3 mb-2">Line items</p>
                <div className="space-y-1.5 max-h-48 overflow-auto pr-2">
                  {(latest.items || []).map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between py-1 border-b border-bdr/30 last:border-0 text-xs">
                      <span className="text-txt-2">{item.name || '—'} {item.quantity ? `×${item.quantity}` : ''} {item.unit || ''}</span>
                      <span className="font-medium">{fmtTZSFull(item.price)}</span>
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

        <div className="card-soft overflow-hidden">
          <div className="p-5 border-b border-bdr/70 flex items-center justify-between">
            <div>
              <Eyebrow num="03">{t('pp.manual.eyebrow')}</Eyebrow>
              <h3 className="mt-2 text-base font-semibold tracking-tight">{t('pp.manual.title')}</h3>
            </div>
            <span className="text-xs text-txt-3 font-mono uppercase tracking-ticker">{allEntries.length}</span>
          </div>
          {allEntries.length === 0 ? (
            <div className="p-8 text-center text-sm text-txt-3">
              {t('pp.entriesEmpty')} <span className="text-accent font-medium">{t('bk.addEntry')}</span>.
            </div>
          ) : (
            <>
              {/* MOBILE — card stack */}
              <div className="md:hidden divide-y divide-bdr/40">
                {allEntries.map((entry) => {
                  const isReceipt = entry.source === 'receipt';
                  return (
                    <div
                      key={entry.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelected(entry)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(entry); } }}
                      className="px-4 py-3.5 cursor-pointer hover:bg-surface-4/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3 mb-1.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-txt-1 leading-snug truncate">{entry.vendor}</p>
                          <p className="text-[11px] text-txt-3 font-mono mt-0.5 tabular">{entry.date}</p>
                        </div>
                        <div className="text-sm font-semibold text-exp tabular flex-shrink-0">−{fmtTZSFull(entry.amount)}</div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge color="muted">{entry.category}</Badge>
                          {isReceipt && <Badge color="accent">Receipt</Badge>}
                        </div>
                        {!isReceipt && (
                          <button
                            onClick={(e) => { e.stopPropagation(); removeManualEntry(entry.id); }}
                            className="text-xs text-txt-3 hover:text-exp p-1"
                            aria-label="Delete entry"
                          >
                            <Icon name="x" size={14} />
                          </button>
                        )}
                      </div>
                      {entry.description && <p className="text-xs text-txt-2 mt-1 line-clamp-2">{entry.description}</p>}
                    </div>
                  );
                })}
              </div>
              {/* DESKTOP — table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-bdr bg-surface-4/50 text-txt-3 text-left">
                      <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-ticker font-medium">{t('common.date')}</th>
                      <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-ticker font-medium">{t('common.vendor')}</th>
                      <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-ticker font-medium">{t('common.category')}</th>
                      <th className="hidden lg:table-cell px-4 py-3 font-mono text-[10px] uppercase tracking-ticker font-medium">{t('common.description')}</th>
                      <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-ticker font-medium text-right">{t('common.amount')}</th>
                      <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-ticker font-medium text-right">&nbsp;</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allEntries.map((entry) => {
                      const isReceipt = entry.source === 'receipt';
                      return (
                        <tr
                          key={entry.id}
                          onClick={() => setSelected(entry)}
                          className="border-b border-bdr/30 hover:bg-surface-4/30 transition-colors cursor-pointer"
                        >
                          <td className="px-4 py-3 text-txt-3 whitespace-nowrap font-mono text-xs tabular">{entry.date}</td>
                          <td className="px-4 py-3 font-medium text-txt-1 max-w-[16ch] truncate">{entry.vendor}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge color="muted">{entry.category}</Badge>
                              {isReceipt && <Badge color="accent">Receipt</Badge>}
                            </div>
                          </td>
                          <td className="hidden lg:table-cell px-4 py-3 text-txt-2">{entry.description || '—'}</td>
                          <td className="px-4 py-3 text-right font-semibold text-exp tabular whitespace-nowrap">−{fmtTZSFull(entry.amount)}</td>
                          <td className="px-4 py-3 text-right">
                            {!isReceipt && (
                              <button
                                onClick={(e) => { e.stopPropagation(); removeManualEntry(entry.id); }}
                                className="text-xs text-txt-3 hover:text-exp"
                                aria-label="Delete entry"
                              >
                                <Icon name="x" size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="card-soft p-5 lg:p-6">
          <Eyebrow num="04">{t('pp.patterns.eyebrow')}</Eyebrow>
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
            <button onClick={saveManualEntry} className="w-full btn-primary py-3 rounded-xl font-semibold text-sm">Save Entry</button>
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

        <EntryDetailModal entry={selected} onClose={() => setSelected(null)} />
      </div>
    </AppShell>
  );
};

const EntryDetailModal = ({ entry, onClose }) => {
  if (!entry) return null;
  const isReceipt = entry.source === 'receipt';
  const items = isReceipt && Array.isArray(entry.receipt?.items) ? entry.receipt.items : [];
  const amount = Number(entry.amount) || 0;
  const subtotal = Number(entry.receipt?.subtotal) || 0;
  const tax = Number(entry.receipt?.tax) || 0;
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
            <span className="text-base font-bold text-exp tabular">−{fmtTZSFull(amount)}</span>
          </div>
        </div>

        {isReceipt && (subtotal > 0 || tax > 0) && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-surface-4/30 rounded-lg p-3">
              <div className="text-[11px] font-mono uppercase tracking-ticker text-txt-3 mb-1">Subtotal</div>
              <div className="font-semibold tabular">{fmtTZSFull(subtotal)}</div>
            </div>
            <div className="bg-surface-4/30 rounded-lg p-3">
              <div className="text-[11px] font-mono uppercase tracking-ticker text-txt-3 mb-1">Tax</div>
              <div className="font-semibold tabular">{fmtTZSFull(tax)}</div>
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
                        <span className="text-xs font-mono tabular shrink-0">{fmtTZSFull(price)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default PersonalSpendingPage;
