import React, { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/navigation';
import { Icon } from '../components/Icon';
import { Eyebrow, Badge } from '../components/common';
import { TiltCard } from '../components/motion';
import { useT } from '../data/i18n';
import { fetchReconciliation, fmtTZS, fmtTZSFull } from '../data/api';

/* map internal tone → Badge color name */
const BADGE_COLOR = { inc: 'income', exp: 'expense', dng: 'danger', net: 'net' };

/* ----------------------------------------------------------------------
   Reconciliation — connects statements + receipts + manual entries
   for a chosen date range and produces a per-debit explanation table
   plus a "blind-spot" KPI and (when range ≥ 30 days) historical
   patterns. The deterministic part always renders; the LLM coaching
   notes appear only when llm_status === 'ok'.
---------------------------------------------------------------------- */

const todayISO = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => todayISO().slice(0, 7);

const monthsAgo = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 7);
};

// YYYY-MM → first / last day of that month, in ISO YYYY-MM-DD.
const monthBounds = (ym) => {
  const [y, m] = ym.split('-').map((s) => parseInt(s, 10));
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
};

const STATUS_TONE = {
  fully_explained: { label: 'Matched', tone: 'inc' },
  partial:         { label: 'Partial', tone: 'exp' },
  blind_spot:      { label: 'Missing', tone: 'dng' },
};

const KIND_LABEL = {
  withdrawal: 'Cash withdrawal',
  pos:        'Card / POS',
  transfer:   'Transfer',
};

const SOURCE_LABEL = {
  receipt:  'Receipt',
  personal: 'Personal entry',
  business: 'Business entry',
};

const ReconciliationPage = () => {
  const { t } = useT();
  const [startMonth, setStartMonth] = useState(monthsAgo(2));
  const [endMonth, setEndMonth] = useState(currentMonth());
  const [scope, setScope] = useState('personal');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const range = useMemo(() => {
    const { start } = monthBounds(startMonth);
    const { end } = monthBounds(endMonth);
    return { start, end };
  }, [startMonth, endMonth]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchReconciliation(range.start, range.end, scope);
      setData(result);
    } catch (err) {
      // The 365-day cap surfaces here too — the message is server-side.
      setError(err?.message || 'Could not run reconciliation.');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [range.start, range.end, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const kpis = data?.kpis;
  const groups = data?.groups || [];
  const patterns = data?.patterns;
  const llmOk = data?.llm_status === 'ok';
  const blindPct = kpis ? Math.round((kpis.blind_spot_ratio || 0) * 100) : 0;

  // Flatten every explanation candidate into a single ledger view, and split
  // the recorded total into its receipt vs manual-entry halves so the two
  // balance panels read like a real bank-reconciliation equation.
  const candidates = useMemo(
    () => groups.flatMap((g) => (g.candidates || []).map((c) => ({ ...c, groupStatus: g.status, groupDate: g.txn_date })))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [groups],
  );
  const receiptTotal = candidates.filter((c) => c.source === 'receipt').reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const entryTotal   = candidates.filter((c) => c.source !== 'receipt').reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const recorded     = receiptTotal + entryTotal;
  const moneyOut     = kpis?.total_money_out || 0;
  const explained    = kpis?.total_explained || 0;
  const blindSpot    = Math.max(0, moneyOut - explained);

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Header + controls -------------------------------------------- */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>{t('nav.reconcile')}</Eyebrow>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mt-1">
              Where did the money go?
            </h1>
            <p className="text-[13px] text-txt-3 mt-1 max-w-xl">
              Pairs every cash-out event from your statement with the receipts and manual entries
              that explain it, and flags the gaps.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2.5">
            <label className="text-xs">
              <div className="text-txt-3 font-mono uppercase tracking-ticker mb-1">From</div>
              <input
                type="month"
                value={startMonth}
                max={endMonth}
                onChange={(e) => setStartMonth(e.target.value)}
                className="bg-surface-2 border border-bdr rounded-lg px-3 py-2 text-sm text-txt-1"
              />
            </label>
            <label className="text-xs">
              <div className="text-txt-3 font-mono uppercase tracking-ticker mb-1">To</div>
              <input
                type="month"
                value={endMonth}
                min={startMonth}
                onChange={(e) => setEndMonth(e.target.value)}
                className="bg-surface-2 border border-bdr rounded-lg px-3 py-2 text-sm text-txt-1"
              />
            </label>
            <label className="text-xs">
              <div className="text-txt-3 font-mono uppercase tracking-ticker mb-1">Scope</div>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="bg-surface-2 border border-bdr rounded-lg px-3 py-2 text-sm text-txt-1"
              >
                <option value="personal">Personal</option>
                <option value="business">Business</option>
              </select>
            </label>
          </div>
        </div>

        {/* Notes + LLM banner ------------------------------------------- */}
        {data?.notes?.length > 0 && (
          <div className="rounded-xl border border-bdr bg-surface-2 px-3 py-2 text-[12px] text-txt-2">
            {data.notes.map((n, i) => (
              <div key={i} className="flex items-start gap-2">
                <Icon name="alert" size={13} className="text-txt-3 mt-0.5 flex-shrink-0" />
                <span>{n}</span>
              </div>
            ))}
          </div>
        )}

        {!llmOk && data && (
          <div className="rounded-xl border border-bdr/60 bg-surface-2 px-3 py-2 text-[11px] text-txt-3 inline-flex items-center gap-2">
            <Icon name="alert" size={11} />
            AI coaching notes are offline — the table and KPIs are computed locally.
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-dng/30 bg-dng/8 text-dng px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {/* Balance equations — Ledger vs Statement ---------------------- */}
        {kpis && (
          <div className="grid lg:grid-cols-2 gap-3 sm:gap-4">
            <BalanceEquation
              title="Ledger balance"
              sideLabel="Your records"
              icon="wallet"
              figures={[
                { label: 'Receipts', value: receiptTotal, tone: 'txt-1' },
                { op: '+' },
                { label: 'Entries', value: entryTotal, tone: 'txt-1' },
                { op: '=' },
                { label: 'Recorded', value: recorded, tone: 'accent' },
              ]}
            />
            <BalanceEquation
              title="Statement balance"
              sideLabel="From your bank"
              icon="file"
              figures={[
                { label: 'Money out', value: moneyOut, tone: 'txt-1' },
                { op: '−' },
                { label: 'Explained', value: explained, tone: 'inc' },
                { op: 'i' },
                { label: 'Blind spot', value: blindSpot, tone: blindPct >= 50 ? 'dng' : 'exp' },
              ]}
            />
          </div>
        )}

        {/* Coverage meter — how much of money-out is explained ----------- */}
        {kpis && (
          <div className="bento p-4">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <span className="text-[11px] text-txt-3 font-mono uppercase tracking-ticker">Coverage · {kpis.group_count} tracked events</span>
              <span className="text-[12px] font-semibold">
                <span className="text-inc">{100 - blindPct}% explained</span>
                <span className="text-txt-3"> · </span>
                <span className={blindPct >= 50 ? 'text-dng' : 'text-exp'}>{blindPct}% blind spot</span>
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-dng/20 overflow-hidden flex">
              <div className="h-full bg-inc rounded-l-full transition-all" style={{ width: `${100 - blindPct}%` }} />
            </div>
            <div className="mt-2 flex items-center gap-4 text-[11px] text-txt-3">
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-inc" />Explained {fmtTZSFull(explained)}</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-dng" />Blind spot {fmtTZSFull(blindSpot)}</span>
            </div>
          </div>
        )}

        {/* Bank charges & interest -------------------------------------- */}
        {data?.charges_summary && (
          <ChargesPanel summary={data.charges_summary} />
        )}

        {/* Overall summary ---------------------------------------------- */}
        {data?.overall_summary && (
          <TiltCard max={3} className="glass rounded-2xl border border-accent/25 p-4 relative overflow-hidden">
            <span aria-hidden className="absolute -right-10 -top-10 w-40 h-40 rounded-full blur-3xl bg-accent/12 pointer-events-none" />
            <div className="relative flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-accent/15 text-accent flex items-center justify-center flex-shrink-0 border border-accent/25">
                <Icon name="bot" size={16} />
              </div>
              <div className="text-[13px] text-txt-1 leading-relaxed">{data.overall_summary}</div>
            </div>
          </TiltCard>
        )}

        {/* Side-by-side ledgers ----------------------------------------- */}
        <div className="grid lg:grid-cols-2 gap-4 sm:gap-5 items-start">
          {/* Statement — money out (expand a row for its matches) */}
          <div className="bento overflow-hidden">
            <div className="px-4 py-3 border-b border-bdr flex items-center justify-between gap-2">
              <div>
                <Eyebrow>Statement · money out</Eyebrow>
                <p className="text-[11px] text-txt-3 mt-0.5">Tap a row to see what explains it.</p>
              </div>
              {loading && <span className="text-[11px] text-txt-3">Loading…</span>}
            </div>
            <div className="grid grid-cols-[auto_1fr_auto] px-4 py-2 border-b border-bdr/60 text-[10px] font-mono uppercase tracking-ticker text-txt-3">
              <span>Date</span><span className="pl-3">Description</span><span className="text-right">Amount</span>
            </div>
            {!loading && groups.length === 0 ? (
              <div className="px-4 py-12 text-center text-[13px] text-txt-3">
                No outflows found in this range. Upload a statement that covers it, or pick a wider range.
              </div>
            ) : (
              <ul className="divide-y divide-bdr/50 max-h-[560px] overflow-y-auto scrollbar-none">
                {groups.map((g, idx) => (
                  <GroupRow key={`${g.txn_date}-${idx}`} g={g} />
                ))}
              </ul>
            )}
          </div>

          {/* Ledger — receipts & entries that back the outflows */}
          <div className="bento overflow-hidden">
            <div className="px-4 py-3 border-b border-bdr flex items-center justify-between gap-2">
              <div>
                <Eyebrow>Ledger · receipts &amp; entries</Eyebrow>
                <p className="text-[11px] text-txt-3 mt-0.5">Everything that could explain the money out.</p>
              </div>
              <span className="text-[11px] text-txt-3 font-mono">{candidates.length}</span>
            </div>
            <div className="grid grid-cols-[auto_1fr_auto] px-4 py-2 border-b border-bdr/60 text-[10px] font-mono uppercase tracking-ticker text-txt-3">
              <span>Date</span><span className="pl-3">Vendor · source</span><span className="text-right">Amount</span>
            </div>
            {candidates.length === 0 ? (
              <div className="px-4 py-12 text-center text-[13px] text-txt-3">
                No receipts or entries in this range. Scan a receipt or add an entry to close the gap.
              </div>
            ) : (
              <ul className="divide-y divide-bdr/50 max-h-[560px] overflow-y-auto scrollbar-none">
                {candidates.map((c, i) => (
                  <LedgerRow key={`${c.source}-${c.ref_id || i}`} c={c} />
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Patterns ----------------------------------------------------- */}
        {patterns && (
          <PatternsPanel patterns={patterns} />
        )}
      </div>
    </AppShell>
  );
};

const TONE_TEXT = { inc: 'text-inc', exp: 'text-exp', dng: 'text-dng', net: 'text-net', accent: 'text-accent', 'txt-1': 'text-txt-1' };

/* A bank-style balance "equation": figures separated by circular
   operator badges (− + = i), mirroring the reference reconciliation panel. */
const BalanceEquation = ({ title, sideLabel, icon, figures }) => (
  <TiltCard max={3} className="bento p-4 sm:p-5">
    <div className="flex items-center justify-between gap-2 mb-4">
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-accent/12 text-accent border border-accent/25 flex items-center justify-center flex-shrink-0">
          <Icon name={icon} size={13} />
        </span>
        <Eyebrow>{title}</Eyebrow>
      </div>
      <Badge color="muted">{sideLabel}</Badge>
    </div>
    <div className="flex items-center gap-1.5 sm:gap-2.5">
      {figures.map((f, i) =>
        f.op ? (
          <span key={i} className="w-6 h-6 rounded-full border border-bdr text-txt-3 flex items-center justify-center text-xs flex-shrink-0 font-mono">
            {f.op === 'i' ? <Icon name="alert" size={11} /> : f.op}
          </span>
        ) : (
          <div key={i} className="flex-1 min-w-0 text-center">
            <div className={`text-base sm:text-xl font-bold tabular truncate ${TONE_TEXT[f.tone] || 'text-txt-1'}`}>
              {fmtTZS(f.value)}
            </div>
            <div className="text-[9px] sm:text-[10px] uppercase tracking-ticker text-txt-3 font-mono mt-1 truncate">
              {f.label}
            </div>
          </div>
        ),
      )}
    </div>
  </TiltCard>
);

/* A single ledger row (receipt or manual entry) in the right-hand table. */
const LedgerRow = ({ c }) => {
  const isReceipt = c.source === 'receipt';
  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5">
      <span className="text-[11px] font-mono uppercase tracking-ticker text-txt-3 w-16 flex-shrink-0">
        {(c.date || '—').slice(5) || '—'}
      </span>
      <div className="min-w-0 flex items-center gap-2">
        <Icon name={isReceipt ? 'camera' : 'wallet'} size={12} className="text-txt-3 flex-shrink-0" />
        <span className="min-w-0">
          <span className="block text-[13px] text-txt-1 truncate">{c.vendor || c.category || 'Unlabelled'}</span>
          <span className="block text-[10px] font-mono uppercase tracking-ticker text-txt-4">
            {SOURCE_LABEL[c.source] || c.source}{c.date_inferred ? ' · scan date' : ''}
          </span>
        </span>
      </div>
      <span className="text-[13px] font-semibold tabular text-txt-1 text-right flex-shrink-0">{fmtTZS(c.amount)}</span>
    </li>
  );
};

const GroupRow = ({ g }) => {
  const [open, setOpen] = useState(false);
  const status = STATUS_TONE[g.status] || STATUS_TONE.blind_spot;
  const dateLabel = new Date(g.txn_date + 'T00:00:00').toLocaleDateString(undefined, {
    day: '2-digit', month: 'short',
  });
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 grid grid-cols-[auto_1fr_auto] items-center gap-3 text-left hover:bg-surface-3/40"
      >
        <div className="text-[11px] font-mono uppercase tracking-ticker text-txt-3 w-14 flex-shrink-0">
          {dateLabel}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-txt-1 truncate">{KIND_LABEL[g.kind] || 'Debit'}</span>
            <Badge color={BADGE_COLOR[status.tone] || 'muted'} dot>{status.label}</Badge>
          </div>
          <div className="text-[11px] text-txt-3 truncate">{g.description}</div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[13px] font-semibold tabular text-txt-1">{fmtTZS(g.debit_amount)}</span>
          <Icon name={open ? 'chevDown' : 'chevRight'} size={14} className="text-txt-3" />
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 -mt-1 space-y-2.5 bg-surface-3/30">
          {g.candidates.length === 0 ? (
            <div className="text-[12px] text-txt-3 italic">
              No matching receipt or entry. Add one to explain this outflow.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {g.candidates.map((c, i) => (
                <li key={i} className="flex items-center gap-2 text-[12px] text-txt-2">
                  <Icon
                    name={c.source === 'receipt' ? 'camera' : 'wallet'}
                    size={12}
                    className="text-txt-3 flex-shrink-0"
                  />
                  <span className="font-mono uppercase tracking-ticker text-[10px] text-txt-3 w-24 flex-shrink-0">
                    {SOURCE_LABEL[c.source] || c.source}
                  </span>
                  <span className="flex-1 truncate">
                    {c.vendor || c.category || 'Unlabelled'}
                    {c.date_inferred && (
                      <span className="ml-1 text-[10px] text-txt-4 font-mono uppercase tracking-ticker">
                        (scan date)
                      </span>
                    )}
                  </span>
                  <span className="font-semibold tabular text-txt-1">{fmtTZS(c.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          {g.insight && (
            <div className="text-[12px] italic text-txt-1 border-l-2 border-accent/40 pl-2.5 py-1">
              {g.insight}
            </div>
          )}
        </div>
      )}
    </li>
  );
};

const PatternsPanel = ({ patterns }) => {
  const recurring = patterns.recurring_withdrawals || [];
  const vendors   = patterns.top_vendors || [];
  const monthly   = patterns.blind_spot_by_month || [];

  return (
    <div className="grid md:grid-cols-3 gap-3">
      <div className="bento p-4">
        <Eyebrow>Recurring leaks</Eyebrow>
        <h3 className="text-[14px] font-bold mt-1">Withdrawal patterns</h3>
        {recurring.length === 0 ? (
          <p className="mt-2 text-[12px] text-txt-3">No recurring weekday-amount cluster detected.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-[12px]">
            {recurring.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="text-txt-2">
                  {r.weekday}s · {r.band_label}
                  <span className="text-txt-3"> · ×{r.occurrences}</span>
                </span>
                <span className="font-semibold tabular">{fmtTZS(r.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bento p-4">
        <Eyebrow>Top vendors</Eyebrow>
        <h3 className="text-[14px] font-bold mt-1">Where receipts/entries land</h3>
        {vendors.length === 0 ? (
          <p className="mt-2 text-[12px] text-txt-3">No receipts or entries in this range.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-[12px]">
            {vendors.map((v, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="text-txt-2 truncate">
                  {v.vendor}
                  <span className="text-txt-4"> · ×{v.occurrences}</span>
                </span>
                <span className="font-semibold tabular">{fmtTZS(v.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bento p-4">
        <Eyebrow>Trend</Eyebrow>
        <h3 className="text-[14px] font-bold mt-1">Monthly blind spot</h3>
        {monthly.length === 0 ? (
          <p className="mt-2 text-[12px] text-txt-3">Need at least one classified outflow per month.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-[12px]">
            {monthly.map((m) => {
              const pct = Math.round((m.blind_spot_ratio || 0) * 100);
              return (
                <li key={m.month} className="flex items-center justify-between gap-2">
                  <span className="text-txt-2 font-mono">{m.month}</span>
                  <span className={`font-semibold tabular ${pct >= 50 ? 'text-dng' : pct >= 25 ? 'text-exp' : 'text-inc'}`}>
                    {pct}%
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

// Bank charges & interest identified from running-balance gaps for the range.
// Charges = balance dropped more than the listed debit (fees / VAT / excise);
// interest = balance rose more than listed (interest / uncredited amounts).
const ChargesPanel = ({ summary }) => {
  const [tab, setTab] = useState('charges');
  const charges = summary.charges || [];
  const interest = summary.interest || [];
  const items = tab === 'charges' ? charges : interest;

  const hasAny = (summary.charge_occurrences || 0) > 0 || (summary.interest_occurrences || 0) > 0;

  return (
    <div className="bento overflow-hidden">
      <div className="px-4 py-3 border-b border-bdr">
        <Eyebrow>Bank charges &amp; interest</Eyebrow>
        <p className="text-[11px] text-txt-3 mt-1">
          Detected from balance gaps — money your bank quietly deducted or added.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-px bg-bdr/60">
        <div className="bg-surface-2 p-3.5">
          <div className="text-[11px] text-txt-3 font-mono uppercase tracking-ticker">Charges</div>
          <div className="mt-1.5 text-lg sm:text-xl font-bold tabular text-dng">{fmtTZSFull(summary.total_charges)}</div>
          <div className="text-[10px] text-txt-4 font-mono uppercase tracking-ticker mt-0.5">
            {summary.charge_occurrences} occurrence(s)
          </div>
        </div>
        <div className="bg-surface-2 p-3.5">
          <div className="text-[11px] text-txt-3 font-mono uppercase tracking-ticker">Interest</div>
          <div className="mt-1.5 text-lg sm:text-xl font-bold tabular text-inc">{fmtTZSFull(summary.total_interest)}</div>
          <div className="text-[10px] text-txt-4 font-mono uppercase tracking-ticker mt-0.5">
            {summary.interest_occurrences} occurrence(s)
          </div>
        </div>
      </div>

      {hasAny ? (
        <>
          <div className="flex gap-1 px-3 pt-3">
            {[
              { key: 'charges', label: `Charges (${charges.length})` },
              { key: 'interest', label: `Interest (${interest.length})` },
            ].map((tb) => (
              <button
                key={tb.key}
                type="button"
                onClick={() => setTab(tb.key)}
                className={`px-3 py-1.5 text-[12px] rounded-lg transition-colors ${
                  tab === tb.key ? 'bg-surface-3 text-txt-1 font-semibold' : 'text-txt-3 hover:text-txt-1'
                }`}
              >
                {tb.label}
              </button>
            ))}
          </div>
          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-txt-3">
              None detected in this range.
            </div>
          ) : (
            <ul className="divide-y divide-bdr px-1 pb-2">
              {items.map((it, i) => (
                <li key={i} className="flex items-center gap-3 px-3 py-2.5 text-[12px]">
                  <span className="font-mono uppercase tracking-ticker text-[10px] text-txt-3 w-20 flex-shrink-0">
                    {it.date || '—'}
                  </span>
                  <span className="flex-1 truncate text-txt-2">{it.description || 'Unlabelled'}</span>
                  <span className={`font-semibold tabular ${tab === 'charges' ? 'text-dng' : 'text-inc'}`}>
                    {fmtTZS(it.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="px-4 py-6 text-center text-[12px] text-txt-3">
          No bank charges or interest detected in this range.
        </div>
      )}
    </div>
  );
};

export default ReconciliationPage;
