import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../components/navigation';
import { Icon } from '../components/Icon';
import { Eyebrow, Badge, Modal } from '../components/common';
import { useT } from '../data/i18n';
import LiveTextScanner from '../components/LiveTextScanner';
import {
  fetchReceiptPatterns,
  scanReceipt,
  fmtTZS,
  fmtTZSFull,
  fetchBusinessEntries,
  createBusinessEntry,
  deleteBusinessEntry,
  fetchBusinessSummary,
  downloadBusinessReport,
} from '../data/api';

// Account-class → suggested category list. Mirrors the chart-of-accounts
// in BUSINESS_VALUE_PROPOSITION.md so monthly P&L / Balance Sheet roll up
// cleanly.
const CATEGORY_SUGGESTIONS = {
  revenue:   ['Sales', 'Service Income', 'Other Income'],
  expense:   ['COGS', 'Rent & Utilities', 'Salaries & Wages', 'Transport & Fuel', 'Office Supplies', 'Marketing & Advertising', 'Bank Fees', 'Other'],
  asset:     ['Cash', 'Bank Account', 'Receivables', 'Inventory', 'Equipment'],
  liability: ['Payables', 'Loan', 'Tax Payable'],
  equity:    ['Owner Capital', 'Retained Earnings'],
};

const ACCOUNT_CLASSES = ['expense', 'revenue', 'asset', 'liability', 'equity'];

const todayISO = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => todayISO().slice(0, 7);

const blankEntry = () => ({
  entry_date: todayISO(),
  vendor: '',
  account_class: 'expense',
  category: 'COGS',
  description: '',
  amount: '',
});

/**
 * Bookkeeping (Business). Web parity with the mobile app:
 *  - Manual ledger entries (P&L + Balance Sheet rows)
 *  - Receipt OCR (existing flow, kept)
 *  - Monthly summary preview (revenue / expenses / net income)
 *  - PDF download of the monthly P&L + Balance Sheet
 */
const BookkeepingPage = () => {
  const { t } = useT();
  const [showCamera, setShowCamera] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);
  const [latest, setLatest] = useState(null);
  const [entries, setEntries] = useState([]);
  const [draft, setDraft] = useState(blankEntry());
  const [month, setMonth] = useState(currentMonth());
  const [summary, setSummary] = useState(null);
  const [patterns, setPatterns] = useState({ insights: [], by_category: {}, receipt_count: 0 });
  const galleryRef = useRef(null);

  const setDraftField = (key, value) =>
    setDraft((prev) => {
      const next = { ...prev, [key]: value };
      // Switching account class resets the category to the first
      // suggestion for that class so the user never lands on an invalid
      // pairing (e.g. Liability + COGS).
      if (key === 'account_class') {
        next.category = CATEGORY_SUGGESTIONS[value]?.[0] || '';
      }
      return next;
    });

  const loadPatterns = async () => {
    try {
      const data = await fetchReceiptPatterns();
      setPatterns(data || { insights: [], by_category: {}, receipt_count: 0 });
    } catch (err) {
      if (err?.status && err.status !== 401) {
        setError(err.message || 'Could not load receipt patterns.');
      }
    }
  };

  const loadEntries = async () => {
    try {
      const rows = await fetchBusinessEntries();
      setEntries(rows || []);
    } catch (err) {
      if (err?.status && err.status !== 401) {
        setError(err.message || 'Could not load entries.');
      }
    }
  };

  const loadSummary = async (m) => {
    try {
      const data = await fetchBusinessSummary(m || month);
      setSummary(data);
    } catch (err) {
      if (err?.status && err.status !== 401) {
        setError(err.message || 'Could not load summary.');
      }
    }
  };

  useEffect(() => {
    loadPatterns();
    loadEntries();
    loadSummary(month);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadSummary(month); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveEntry = async () => {
    const amt = parseFloat(draft.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter a valid amount greater than 0.');
      return;
    }
    if (!draft.category.trim()) {
      setError('Category is required.');
      return;
    }
    setError(null);
    try {
      await createBusinessEntry({
        entry_date: draft.entry_date,
        vendor: draft.vendor.trim() || null,
        category: draft.category.trim(),
        description: draft.description.trim() || null,
        amount: amt,
        account_class: draft.account_class,
      });
      setDraft(blankEntry());
      setShowAdd(false);
      await Promise.all([loadEntries(), loadSummary(month)]);
    } catch (err) {
      setError(err?.message || 'Could not save entry.');
    }
  };

  const removeEntry = async (id) => {
    const previous = entries;
    setEntries((prev) => prev.filter((e) => e.id !== id));
    try {
      await deleteBusinessEntry(id);
      loadSummary(month);
    } catch (err) {
      setEntries(previous);
      setError(err?.message || 'Could not delete entry.');
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      await downloadBusinessReport(month);
    } catch (err) {
      setError(err?.message || 'Could not download report.');
    } finally {
      setDownloading(false);
    }
  };

  const handleScan = async (file) => {
    if (!file) return;
    setScanning(true);
    setError(null);
    try {
      const data = await scanReceipt(file);
      if (data?.is_receipt === false) {
        setError(data.message || 'That image is not a receipt.');
        return;
      }
      setLatest(data);
      await Promise.all([loadPatterns(), loadSummary(month)]);
    } catch (err) {
      setError(err?.message || 'Receipt scan failed.');
    } finally {
      setScanning(false);
    }
  };

  const onPick = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) handleScan(file);
  };

  const monthly = summary?.monthly || { revenue_total: 0, expense_total: 0, net_income: 0, by_class: {} };
  const balance = summary?.balance_sheet || { asset_total: 0, liability_total: 0, equity_total: 0, retained_earnings: 0, by_class: {} };
  const totalEquityWithRetained = (balance.equity_total || 0) + (balance.retained_earnings || 0);
  const reconciles = Math.abs(balance.asset_total - (balance.liability_total + totalEquityWithRetained)) < 1;

  const monthEntries = useMemo(() => {
    const start = `${month}-01`;
    const end = `${month}-31`;
    return entries.filter((e) => e.entry_date >= start && e.entry_date <= end);
  }, [entries, month]);

  return (
    <AppShell>
      <div className="space-y-7">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <Eyebrow num="00">{t('nav.bookkeeping')}</Eyebrow>
            <h1 className="mt-2 text-2xl lg:text-3xl font-semibold tracking-tight">Business Bookkeeping</h1>
            <p className="text-xs text-txt-3 mt-1.5 font-mono uppercase tracking-ticker">Manual ledger · receipts · P&amp;L · balance sheet</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => { setError(null); setShowAdd(true); }} className="btn-primary px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2">
              <Icon name="plus" size={14} />Add Entry
            </button>
            <button onClick={() => setShowCamera(true)} className="btn-secondary px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2">
              <Icon name="receipt" size={14} />Scan Receipt
            </button>
          </div>
        </div>

        {/* ---- Month picker + PDF download ---- */}
        <div className="card-soft p-5 lg:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <Eyebrow num="01">Reporting period</Eyebrow>
            <h3 className="mt-2 text-base font-semibold tracking-tight">Monthly P&amp;L &amp; Balance Sheet</h3>
            <p className="text-xs text-txt-3 mt-1">Combines manual ledger entries + scanned receipts.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value || currentMonth())}
              className="bg-surface-4 border border-bdr rounded-lg px-3 py-2 text-sm text-txt-1"
            />
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="btn-primary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
            >
              <Icon name="download" size={14} />
              {downloading ? 'Preparing…' : 'Download PDF'}
            </button>
          </div>
        </div>

        {/* ---- KPI tiles from summary ---- */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[
            { label: 'Revenue',    val: fmtTZS(monthly.revenue_total),  c: 'inc' },
            { label: 'Expenses',   val: fmtTZS(monthly.expense_total),  c: 'exp' },
            { label: 'Net Income', val: fmtTZS(monthly.net_income),     c: monthly.net_income >= 0 ? 'inc' : 'exp' },
            { label: 'Assets (cum.)', val: fmtTZS(balance.asset_total), c: 'accent' },
          ].map((stat, idx) => (
            <div key={idx} className="card-soft p-4 card-hover">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] uppercase tracking-ticker text-txt-3">{stat.label}</span>
              </div>
              <div className={`text-lg lg:text-xl font-bold tabular tracking-tight ${stat.c === 'inc' ? 'text-inc' : stat.c === 'exp' ? 'text-exp' : 'text-txt-1'}`}>{stat.val}</div>
            </div>
          ))}
        </div>

        {/* ---- P&L preview ---- */}
        <div className="card-soft overflow-hidden">
          <div className="p-5 border-b border-bdr/70">
            <Eyebrow num="02">Income Statement</Eyebrow>
            <h3 className="mt-2 text-base font-semibold tracking-tight">Profit &amp; Loss · {month}</h3>
          </div>
          <div className="grid sm:grid-cols-2 gap-0">
            <div className="p-5 border-b sm:border-b-0 sm:border-r border-bdr/70">
              <p className="text-xs font-mono uppercase tracking-ticker text-inc mb-2">Revenue</p>
              {Object.entries(monthly.by_class?.revenue || {}).length === 0 ? (
                <p className="text-sm text-txt-3">No revenue recorded this month.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {Object.entries(monthly.by_class.revenue).map(([cat, val]) => (
                    <li key={cat} className="flex justify-between"><span className="text-txt-2">{cat}</span><span className="font-medium tabular">{fmtTZSFull(val)}</span></li>
                  ))}
                </ul>
              )}
              <div className="mt-3 pt-2 border-t border-bdr/40 flex justify-between text-sm font-semibold">
                <span>Total Revenue</span><span className="tabular text-inc">{fmtTZSFull(monthly.revenue_total)}</span>
              </div>
            </div>
            <div className="p-5">
              <p className="text-xs font-mono uppercase tracking-ticker text-exp mb-2">Expenses</p>
              {Object.entries(monthly.by_class?.expense || {}).length === 0 ? (
                <p className="text-sm text-txt-3">No expenses recorded this month.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {Object.entries(monthly.by_class.expense).map(([cat, val]) => (
                    <li key={cat} className="flex justify-between"><span className="text-txt-2">{cat}</span><span className="font-medium tabular">{fmtTZSFull(val)}</span></li>
                  ))}
                </ul>
              )}
              <div className="mt-3 pt-2 border-t border-bdr/40 flex justify-between text-sm font-semibold">
                <span>Total Expenses</span><span className="tabular text-exp">{fmtTZSFull(monthly.expense_total)}</span>
              </div>
            </div>
          </div>
          <div className="px-5 py-4 border-t border-bdr/70 bg-surface-3/40 flex justify-between text-sm font-semibold">
            <span>Net Income</span>
            <span className={`tabular ${monthly.net_income >= 0 ? 'text-inc' : 'text-exp'}`}>{fmtTZSFull(monthly.net_income)}</span>
          </div>
        </div>

        {/* ---- Balance sheet preview ---- */}
        <div className="card-soft overflow-hidden">
          <div className="p-5 border-b border-bdr/70 flex items-center justify-between">
            <div>
              <Eyebrow num="03">Balance Sheet</Eyebrow>
              <h3 className="mt-2 text-base font-semibold tracking-tight">As of end of {month}</h3>
            </div>
            <Badge color={reconciles ? 'income' : 'expense'}>{reconciles ? 'Balanced' : 'Mismatch'}</Badge>
          </div>
          <div className="grid sm:grid-cols-3 gap-0">
            {[
              { label: 'Assets', total: balance.asset_total, rows: balance.by_class?.asset, color: 'text-accent' },
              { label: 'Liabilities', total: balance.liability_total, rows: balance.by_class?.liability, color: 'text-exp' },
              { label: 'Equity', total: totalEquityWithRetained, rows: { ...(balance.by_class?.equity || {}), 'Retained Earnings': balance.retained_earnings || 0 }, color: 'text-inc' },
            ].map((col, idx) => (
              <div key={idx} className="p-5 border-b sm:border-b-0 sm:border-r last:border-r-0 border-bdr/70">
                <p className={`text-xs font-mono uppercase tracking-ticker ${col.color} mb-2`}>{col.label}</p>
                {Object.entries(col.rows || {}).length === 0 ? (
                  <p className="text-sm text-txt-3">None recorded.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {Object.entries(col.rows).map(([cat, val]) => (
                      <li key={cat} className="flex justify-between"><span className="text-txt-2 truncate pr-2">{cat}</span><span className="font-medium tabular">{fmtTZSFull(val)}</span></li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 pt-2 border-t border-bdr/40 flex justify-between text-sm font-semibold">
                  <span>Total</span><span className="tabular">{fmtTZSFull(col.total)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ---- Manual ledger entries ---- */}
        <div className="card-soft overflow-hidden">
          <div className="p-5 border-b border-bdr/70 flex items-center justify-between">
            <div>
              <Eyebrow num="04">Ledger</Eyebrow>
              <h3 className="mt-2 text-base font-semibold tracking-tight">Manual entries · {month}</h3>
            </div>
            <span className="text-xs text-txt-3 font-mono uppercase tracking-ticker">{monthEntries.length}</span>
          </div>
          {monthEntries.length === 0 ? (
            <div className="p-8 text-center text-sm text-txt-3">
              No entries this month yet. Click <span className="text-accent font-medium">Add Entry</span> to record revenue, expenses, assets, liabilities, or equity.
            </div>
          ) : (
            <>
              <div className="md:hidden divide-y divide-bdr/40">
                {monthEntries.map((entry) => (
                  <div key={entry.id} className="px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3 mb-1.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-txt-1 leading-snug truncate">{entry.vendor || entry.category}</p>
                        <p className="text-[11px] text-txt-3 font-mono mt-0.5 tabular">{entry.entry_date}</p>
                      </div>
                      <div className={`text-sm font-semibold tabular flex-shrink-0 ${entry.account_class === 'revenue' ? 'text-inc' : entry.account_class === 'expense' ? 'text-exp' : 'text-txt-1'}`}>
                        {entry.account_class === 'revenue' ? '+' : entry.account_class === 'expense' ? '−' : ''}{fmtTZSFull(entry.amount)}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Badge color="muted">{entry.account_class}</Badge>
                        <Badge color="muted">{entry.category}</Badge>
                      </div>
                      <button onClick={() => removeEntry(entry.id)} className="text-xs text-txt-3 hover:text-exp p-1">
                        <Icon name="x" size={14} />
                      </button>
                    </div>
                    {entry.description && <p className="text-xs text-txt-2 mt-1 line-clamp-2">{entry.description}</p>}
                  </div>
                ))}
              </div>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-bdr bg-surface-4/50 text-txt-3 text-left">
                      <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-ticker font-medium">Date</th>
                      <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-ticker font-medium">Class</th>
                      <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-ticker font-medium">Vendor</th>
                      <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-ticker font-medium">Category</th>
                      <th className="hidden lg:table-cell px-4 py-3 font-mono text-[10px] uppercase tracking-ticker font-medium">Description</th>
                      <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-ticker font-medium text-right">Amount</th>
                      <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-ticker font-medium text-right">&nbsp;</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthEntries.map((entry) => (
                      <tr key={entry.id} className="border-b border-bdr/30 hover:bg-surface-4/30 transition-colors">
                        <td className="px-4 py-3 text-txt-3 whitespace-nowrap font-mono text-xs tabular">{entry.entry_date}</td>
                        <td className="px-4 py-3"><Badge color="muted">{entry.account_class}</Badge></td>
                        <td className="px-4 py-3 font-medium text-txt-1 max-w-[16ch] truncate">{entry.vendor || '—'}</td>
                        <td className="px-4 py-3"><Badge color="muted">{entry.category}</Badge></td>
                        <td className="hidden lg:table-cell px-4 py-3 text-txt-2">{entry.description || '—'}</td>
                        <td className={`px-4 py-3 text-right font-semibold tabular whitespace-nowrap ${entry.account_class === 'revenue' ? 'text-inc' : entry.account_class === 'expense' ? 'text-exp' : 'text-txt-1'}`}>
                          {entry.account_class === 'revenue' ? '+' : entry.account_class === 'expense' ? '−' : ''}{fmtTZSFull(entry.amount)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => removeEntry(entry.id)} className="text-xs text-txt-3 hover:text-exp">
                            <Icon name="x" size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* ---- Receipt scan tools ---- */}
        <div className="card-soft p-5 lg:p-6">
          <Eyebrow num="05">Capture a receipt</Eyebrow>
          <h3 className="mt-2 mb-4 text-base font-semibold tracking-tight">Add expenses by photo</h3>
          <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
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
              <p className="text-xs text-txt-3">Live camera with smart receipt detection</p>
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
              <p className="text-xs text-txt-3">Pick an image from your device</p>
            </button>
          </div>
          {scanning && (
            <p className="text-xs text-txt-3 mt-3">Scanning… reading the image with vision AI.</p>
          )}
          {error && (
            <div className="mt-4 p-3 bg-exp/10 border border-exp/30 rounded-xl text-sm text-exp">{error}</div>
          )}
        </div>

        {latest && (
          <div className="card-soft p-5 lg:p-6">
            <Eyebrow num="06">Latest receipt</Eyebrow>
            <h3 className="mt-2 mb-4 text-base font-semibold tracking-tight">Parsed details</h3>
            <div className="grid sm:grid-cols-2 gap-4 text-sm">
              <div className="space-y-2">
                <div className="flex justify-between"><span className="text-txt-3">Vendor</span><span className="font-medium">{latest.vendor || '—'}</span></div>
                <div className="flex justify-between"><span className="text-txt-3">Date</span><span className="font-medium">{latest.date || '—'}</span></div>
                <div className="flex justify-between"><span className="text-txt-3">Category</span><Badge color="muted">{latest.category || 'other'}</Badge></div>
                {latest.tax_line && (
                  <div className="flex justify-between"><span className="text-txt-3">Tax line</span><Badge color="muted">{latest.tax_line}</Badge></div>
                )}
                {'efd_compliant' in latest && (
                  <div className="flex justify-between"><span className="text-txt-3">EFD</span><Badge color={latest.efd_compliant ? 'income' : 'expense'}>{latest.efd_compliant ? 'Compliant' : 'Missing'}</Badge></div>
                )}
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
              </div>
            </div>
          </div>
        )}

        <div className="card-soft p-5 lg:p-6">
          <Eyebrow num="07">Patterns from your receipts</Eyebrow>
          <h3 className="mt-2 text-base font-semibold tracking-tight">
            {patterns.receipt_count || 0} receipt{patterns.receipt_count === 1 ? '' : 's'} on file
          </h3>
          {(patterns.insights || []).length === 0 ? (
            <p className="text-sm text-txt-3 mt-3">
              Scan at least three receipts in a category to surface patterns here.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {patterns.insights.map((insight, idx) => (
                <li key={idx} className="bg-surface-3/40 border border-bdr/40 rounded-xl p-4">
                  <div className="text-xs font-mono uppercase tracking-ticker text-accent">{insight.category}</div>
                  <div className="text-sm font-semibold text-txt-1 mt-1">{insight.title}</div>
                  <p className="text-sm text-txt-2 mt-1">{insight.insight}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ---- Add-entry modal ---- */}
        <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Ledger Entry">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-txt-2 mb-1.5">Date</label>
                <input
                  type="date"
                  value={draft.entry_date}
                  onChange={(e) => setDraftField('entry_date', e.target.value)}
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-txt-2 mb-1.5">Account class</label>
                <select
                  value={draft.account_class}
                  onChange={(e) => setDraftField('account_class', e.target.value)}
                  className="w-full bg-surface-4 border border-bdr rounded-lg px-3 py-2.5 text-sm text-txt-1 capitalize"
                >
                  {ACCOUNT_CLASSES.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-txt-2 mb-1.5">Category</label>
                <input
                  list="bk-cat-options"
                  value={draft.category}
                  onChange={(e) => setDraftField('category', e.target.value)}
                  className="w-full bg-surface-4 border border-bdr rounded-lg px-3 py-2.5 text-sm text-txt-1"
                />
                <datalist id="bk-cat-options">
                  {(CATEGORY_SUGGESTIONS[draft.account_class] || []).map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-txt-2 mb-1.5">Vendor / counterparty (optional)</label>
              <input
                value={draft.vendor}
                onChange={(e) => setDraftField('vendor', e.target.value)}
                placeholder="e.g. CRDB Bank, Total Energies, Aisha (client)"
                className="w-full bg-surface-4 border border-bdr rounded-lg px-3 py-2.5 text-sm text-txt-1 placeholder-txt-3"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-txt-2 mb-1.5">Description (optional)</label>
              <input
                value={draft.description}
                onChange={(e) => setDraftField('description', e.target.value)}
                placeholder="What is this for?"
                className="w-full bg-surface-4 border border-bdr rounded-lg px-3 py-2.5 text-sm text-txt-1 placeholder-txt-3"
              />
            </div>
            {error && (
              <div className="p-3 bg-exp/10 border border-exp/30 rounded-xl text-xs text-exp">{error}</div>
            )}
            <button onClick={saveEntry} className="w-full btn-primary py-3 rounded-xl font-semibold text-sm">Save Entry</button>
          </div>
        </Modal>

        <LiveTextScanner
          open={showCamera}
          busy={scanning}
          onCapture={async (file) => { setShowCamera(false); await handleScan(file); }}
          onTextResult={async (data) => {
            setShowCamera(false);
            if (!data || data.is_receipt === false) {
              setError(data?.message || 'That capture is not a receipt.');
              return;
            }
            setLatest(data);
            await Promise.all([loadPatterns(), loadSummary(month)]);
          }}
          onClose={() => setShowCamera(false)}
        />
      </div>
    </AppShell>
  );
};

export default BookkeepingPage;
