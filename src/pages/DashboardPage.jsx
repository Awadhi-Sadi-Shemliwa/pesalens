import React, { useEffect, useRef, useState } from 'react';
import { AppShell } from '../components/navigation';
import { useRouter } from '../components/Router';
import { Icon } from '../components/Icon';
import { Badge, EmptyState, Eyebrow, Sparkline, CountUp, Segmented, ProgressBar, ErrorState, InfoHint, Skeleton, toast } from '../components/common';
import { ChartJS, chartTheme } from '../components/ChartJS';
import { TiltCard } from '../components/motion';
import ActionPlan from '../components/ActionPlan';
import TextType from '../components/reactbits/TextType';
import SignOutConfirm from '../components/SignOutConfirm';
import { fetchDashboardSummary, fetchStatementIndex, fetchBankIntel, uploadStatement, fetchUploadStatus, fmtTZS, fmtTZSFull } from '../data/api';
import { useTheme } from '../data/theme';
import { setActiveStatement } from '../data/activeStatement';
import { bankLabel as sharedBankLabel } from '../data/bankLabels';
import { useT, AutoT } from '../data/i18n';

/* Brand-aligned fallback palette (green-first, no purple).
   Live theme colors come from chartTheme().palette at render. */
const PALETTE = ['#30DC82', '#3884F5', '#10B981', '#F59E0B', '#EF4444', '#8B95A8', '#4AEB96', '#0EA5E9'];

/* Deterministic mini-series so per-row sparklines don't jitter on re-render.
   (Category totals have no time dimension — the sparkline is decorative,
   exactly like the "Top Token & Assets" rows in the reference UIs.) */
const seededSeries = (seed, n = 10) => {
  let s = Math.abs(Math.round(Number(seed) || 1)) % 9973 || 7;
  const out = [];
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    out.push(0.35 + (s / 233280) * 0.65);
  }
  return out;
};

const issueAccent = (severity) => {
  // Static class strings so Tailwind's scanner keeps these utilities.
  if (severity === 'warning')  return { bar: 'rgb(var(--c-exp))', labelKey: 'common.warning',  cls: 'bg-exp/10 text-exp border-exp/25', ring: 'border-exp/30', icon: 'alert' };
  if (severity === 'critical') return { bar: 'rgb(var(--c-dng))', labelKey: 'common.critical', cls: 'bg-dng/10 text-dng border-dng/25', ring: 'border-dng/30', icon: 'alert' };
  return                       { bar: 'rgb(var(--c-net))', labelKey: 'common.notice',   cls: 'bg-net/10 text-net border-net/25', ring: 'border-net/30', icon: 'sparkles' };
};

/* ----------------------------------------------------------------
   Action pill — the Buy / Sell / Deposit / Withdraw row (Finvero).
   ---------------------------------------------------------------- */
const ActionPill = ({ icon, label, onClick, primary, as = 'button', htmlFor }) => {
  const cls = `press inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-semibold whitespace-nowrap ${
    primary
      ? 'btn-primary'
      : 'bg-surface-3 text-txt-1 border border-bdr hover:border-accent/40 hover:bg-surface-4'
  }`;
  if (as === 'label') {
    return (
      <label htmlFor={htmlFor} className={`${cls} cursor-pointer`}>
        <Icon name={icon} size={15} />
        {label}
      </label>
    );
  }
  return (
    <button onClick={onClick} className={cls}>
      <Icon name={icon} size={15} />
      {label}
    </button>
  );
};

/* ----------------------------------------------------------------
   Mini KPI tile — colored dot + label + value + sparkline
   (TradeXpert "Invested Money" row). Locked state when Pro-gated.
   ---------------------------------------------------------------- */
const MiniTile = ({ label, value, tone = 'accent', spark, locked, remaining, hint }) => {
  const dot = { accent: 'bg-accent', inc: 'bg-inc', exp: 'bg-exp', net: 'bg-net' }[tone] || 'bg-accent';
  const col = { accent: 'rgb(var(--c-accent))', inc: 'rgb(var(--c-inc))', exp: 'rgb(var(--c-exp))', net: 'rgb(var(--c-net))' }[tone];
  if (locked) {
    return (
      <div className="bento p-4 relative overflow-hidden opacity-80">
        <div className="absolute inset-0 grid-faint opacity-40 pointer-events-none" />
        <div className="flex items-center gap-1.5 mb-2 relative">
          <span className="w-1.5 h-1.5 rounded-full bg-txt-4" />
          <span className="text-[10px] uppercase tracking-ticker text-txt-3 truncate">{label}</span>
        </div>
        <div className="flex items-center gap-1.5 text-txt-3 relative">
          <Icon name="zap" size={13} />
          <span className="text-sm font-semibold">Locked</span>
        </div>
        <p className="text-[10px] text-txt-3 mt-1 relative">{remaining} more to unlock</p>
      </div>
    );
  }
  return (
    <TiltCard max={6} className="bento p-4">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span className="text-[10px] uppercase tracking-ticker text-txt-3 truncate">{label}</span>
        {hint && <InfoHint content={hint} />}
      </div>
      <div className="text-lg sm:text-xl font-bold tabular text-txt-1 truncate">{value}</div>
      {spark && (
        <div className="mt-2 -mx-1">
          <Sparkline values={spark} color={col} width={150} height={26} strokeWidth={1.6} />
        </div>
      )}
    </TiltCard>
  );
};

const UploadZone = ({ onFile, busy, error }) => {
  const [file, setFile] = useState(null);
  const [drag, setDrag] = useState(false);
  const { t } = useT();

  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && dropped.type === 'application/pdf') setFile(dropped);
  };

  const onPick = (e) => {
    const picked = e.target.files?.[0];
    if (picked && picked.type === 'application/pdf') setFile(picked);
  };

  return (
    <div className="bento p-4 sm:p-6 lg:p-7 relative overflow-hidden">
      <div className="absolute inset-0 grid-dot opacity-50 pointer-events-none" />
      <div className="relative">
        <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
          <div className="min-w-0">
            <Eyebrow>{t('dash.upload.eyebrow')}</Eyebrow>
            <h3 className="mt-2 text-base sm:text-lg font-semibold tracking-tight">{t('dash.upload.title')}</h3>
          </div>
          <span className="hidden sm:inline-flex font-mono text-[10px] uppercase tracking-ticker text-txt-3">
            {t('dash.upload.subtitle')}
          </span>
        </div>

        <div
          className={`relative border-2 border-dashed rounded-xl p-6 sm:p-10 text-center transition-all cursor-pointer ${
            drag ? 'dragging' : 'border-bdr hover:border-accent/40 hover:bg-surface-4/30'
          }`}
          onClick={() => document.getElementById('dash-pdf').click()}
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
        >
          <input id="dash-pdf" type="file" accept=".pdf" className="hidden" onChange={onPick} />
          <div className="relative w-fit mx-auto mb-4">
            <span className="absolute inset-0 rounded-2xl bg-accent/15 blur-xl" />
            <div className="relative p-4 rounded-2xl bg-accent/10 border border-accent/25">
              <Icon name="upload" size={26} className="text-accent" />
            </div>
          </div>
          {file ? (
            <>
              <p className="font-medium text-txt-1 mb-1 break-all">{file.name}</p>
              <p className="text-xs text-txt-3 font-mono">{(file.size / 1024).toFixed(0)} KB · {t('dash.upload.ready')}</p>
            </>
          ) : (
            <>
              <p className="font-medium text-txt-1 mb-1">{t('dash.upload.drop')}</p>
              <p className="text-xs text-txt-3">{t('dash.upload.banks')}</p>
            </>
          )}
        </div>
        {file && (
          <div className="mt-5 flex justify-center">
            <button
              onClick={() => onFile(file)}
              disabled={busy}
              className="press btn-primary px-7 py-3 rounded-xl text-sm font-semibold inline-flex items-center gap-2"
            >
              {busy ? t('dash.upload.extracting') : (<>{t('dash.upload.extract')} <Icon name="arrowRight" size={14} /></>)}
            </button>
          </div>
        )}
        {error && (
          <div className="mt-4 p-3 bg-exp/10 border border-exp/30 rounded-xl text-sm text-exp flex items-start gap-2">
            <Icon name="alert" size={16} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
};

/* ----------------------------------------------------------------
   Upload overlay — HONEST progress (byte upload → extraction stages) with a
   decisive completion state and a real, timestamped failure state + retry.
   (design corpus §84–89, error-states.md #3)
   ---------------------------------------------------------------- */
// Cap on how long we poll a job before calling it a (retryable) timeout, so a
// stranded backend job can't spin the overlay forever. Extraction incl. LLM
// repair is normally far quicker; this is a generous safety net.
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

const fmtBytes = (n) => {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const UploadOverlay = ({ job, onRetry, onClose }) => {
  const { t } = useT();
  if (!job || job.phase === 'idle') return null;
  const uploading = job.phase === 'uploading';
  const processing = job.phase === 'processing';
  const done = job.phase === 'done';
  const failed = job.phase === 'failed';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md anim-in" />
      <div
        className="relative w-full max-w-md bg-surface-2 border border-bdr rounded-2xl p-6 anim-up"
        style={{ boxShadow: '0 40px 100px -20px rgba(0,0,0,0.7)' }}
      >
        {(uploading || processing) && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2 h-2 rounded-full bg-accent anim-pulse-soft" />
              <span className="font-mono text-[10px] uppercase tracking-ticker text-txt-3">
                {uploading ? t('dash.upload.uploading') : t('dash.upload.processing')}
              </span>
            </div>
            <h3 className="text-lg font-semibold tracking-tight mb-1 truncate">{job.file?.name}</h3>
            <p className="text-sm text-txt-2 mb-5">
              {uploading ? t('dash.upload.sending') : (job.stage || t('dash.upload.working'))}
            </p>
            <ProgressBar
              value={job.pct}
              tone="accent"
              label={uploading ? t('dash.upload.uploading') : job.stage}
              sublabel={
                uploading && job.rate
                  ? `${fmtBytes(job.rate)}/s · ${job.eta != null ? `${job.eta}s ${t('dash.upload.left')}` : ''}`
                  : t('dash.upload.keepOpen')
              }
            />
          </>
        )}

        {done && (
          <div className="flex flex-col items-center text-center py-2">
            <div className="p-3 rounded-2xl bg-inc/10 border border-inc/25 mb-3">
              <Icon name="check" size={28} className="text-inc" />
            </div>
            <h3 className="text-lg font-semibold text-txt-1">{t('dash.upload.done')}</h3>
            <p className="text-sm text-txt-2 mt-1">
              {job.total != null ? `${job.total} ${t('common.transactions').toLowerCase()}` : ''}
            </p>
          </div>
        )}

        {failed && (
          <ErrorState
            title={t('dash.upload.failedTitle')}
            cause={job.failure?.message}
            code={job.failure?.code}
            stage={job.failure?.stage}
            progress={job.failure?.progress}
            timestamp={job.failure?.timestamp}
            onRetry={job.file ? onRetry : undefined}
            retryLabel={t('common.retry')}
            onContactSupport={onClose}
          />
        )}

        {(processing || failed) && (
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

// Shared label map (src/data/bankLabels.js); the Dashboard shows "Statement"
// when a bank is unknown.
const bankLabel = (b) => sharedBankLabel(b, 'Statement');
const fmtDay = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return String(iso).slice(0, 10); }
};
const periodLabel = (s) => {
  const a = s.period_start ? String(s.period_start).slice(0, 10) : null;
  const b = s.period_end ? String(s.period_end).slice(0, 10) : null;
  return a && b ? `${a} → ${b}` : (a || b || 'Period n/a');
};

/* Premium statement selector — the "type of statement" heading becomes a
   dropdown of every uploaded statement, grouped Recent / Past. Selecting one
   re-scopes the whole dashboard to that upload. */
const StatementSelector = ({ statements, selectedJobId, currentBank, onSelect }) => {
  const [open, setOpen] = useState(false);
  const recent = statements.filter((s) => s.recency === 'recent');
  const past = statements.filter((s) => s.recency !== 'recent');
  const activeId = selectedJobId || (statements[0] && statements[0].job_id);

  const Group = ({ label, items }) => (items.length ? (
    <div className="py-1">
      <div className="px-3 py-1 text-[10px] font-mono uppercase tracking-ticker text-txt-4">{label}</div>
      {items.map((s) => (
        <button
          key={s.job_id}
          type="button"
          onClick={() => { onSelect(s.job_id); setOpen(false); }}
          className={`w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-surface-3/60 transition ${s.job_id === activeId ? 'bg-accent/10' : ''}`}
        >
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-semibold text-txt-1 truncate">{bankLabel(s.bank)}</span>
            <span className="block text-[10.5px] text-txt-3 truncate">
              {periodLabel(s)} · {s.txn_count || 0} txns · uploaded {fmtDay(s.created_at)}
            </span>
          </span>
          {s.job_id === activeId && <Icon name="check" size={14} className="text-accent flex-shrink-0" />}
        </button>
      ))}
    </div>
  ) : null);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => statements.length > 0 && setOpen((v) => !v)}
        className="group flex items-center gap-2 text-left focus-ring rounded-lg"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <h1 className="text-xl sm:text-2xl lg:text-[28px] font-semibold tracking-tight break-words">
          {bankLabel(currentBank)}
        </h1>
        {statements.length > 0 && (
          <Icon name="chevDown" size={18} className="text-txt-3 group-hover:text-txt-1 transition flex-shrink-0" />
        )}
      </button>
      {open && statements.length > 0 && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 top-full mt-2 z-50 w-[min(92vw,380px)] max-h-[60vh] overflow-y-auto scrollbar-none rounded-xl border border-bdr bg-surface-2 shadow-2xl anim-in">
            <Group label="Recent" items={recent} />
            <Group label="Past" items={past} />
          </div>
        </>
      )}
    </div>
  );
};

/* ----------------------------------------------------------------
   MoneyMap — "Where your money goes by service" (Slice 3, Part J-2)

   Per-bank spend / fees / fee-rate leaderboard + deterministic saving
   suggestions + an optional LLM coaching line. A service selector lets the
   user focus one provider or see them all. Deterministic facts render even
   when the LLM is unavailable (intel.llm_status !== 'ok').
   ---------------------------------------------------------------- */
const SUGGESTION_STYLE = {
  most_expensive: { icon: 'alert',    ring: 'border-exp/25',    chip: 'bg-exp/15 text-exp' },
  cheapest:       { icon: 'check',    ring: 'border-inc/25',    chip: 'bg-inc/15 text-inc' },
  saving_estimate:{ icon: 'sparkles', ring: 'border-accent/25', chip: 'bg-accent/15 text-accent' },
};

const MoneyMap = ({ intel, focus, onFocus }) => {
  const banks = intel?.banks || [];
  if (banks.length === 0) return null;
  const totals = intel.totals || {};
  const maxCharges = Math.max(...banks.map((b) => b.charges || 0), 1);
  const shown = focus === 'all' ? banks : banks.filter((b) => b.bank === focus);
  const coach = intel.llm_status === 'ok' && intel.overall_summary ? intel.overall_summary : null;

  return (
    <div className="bento p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <Eyebrow>Money map</Eyebrow>
          <h3 className="mt-1.5 text-sm sm:text-base font-semibold tracking-tight">Where your money goes by service</h3>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-txt-3 font-mono uppercase tracking-ticker">Fees across {totals.bank_count || banks.length} services</div>
          <div className="text-lg font-bold tabular text-exp">{fmtTZS(totals.total_charges || 0)}</div>
        </div>
      </div>

      {/* Service selector — All + one pill per provider (single scrolling line). */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-1 mb-4">
        {[{ bank: 'all', label: 'All services' }, ...banks].map((b) => {
          const active = focus === b.bank;
          return (
            <button
              key={b.bank}
              type="button"
              onClick={() => onFocus(b.bank)}
              className={`press focus-ring shrink-0 rounded-full border px-3.5 min-h-[34px] text-xs font-medium transition ${
                active ? 'bg-accent border-accent text-deep font-semibold' : 'bg-surface-2 border-bdr text-txt-2 hover:text-txt-1'
              }`}
            >
              {b.bank === 'all' ? 'All services' : bankLabel(b.bank)}
            </button>
          );
        })}
      </div>

      {/* Per-service cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {shown.map((b) => {
          const feePct = (b.fee_rate || 0) * 100;
          return (
            <div key={b.bank} className="surface-inset rounded-2xl p-4 border border-bdr">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <Badge color="net">{bankLabel(b.bank)}</Badge>
                  <span className="text-[10px] text-txt-3 font-mono">{b.txn_count} txns</span>
                </div>
                {b.charges > 0 && (
                  <span className="text-[10px] font-mono uppercase tracking-ticker text-exp">{feePct.toFixed(1)}% fees</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] text-txt-3 uppercase tracking-ticker">Spent</div>
                  <div className="text-base font-bold tabular text-txt-1">{fmtTZS(b.spend || 0)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-txt-3 uppercase tracking-ticker">Fees</div>
                  <div className={`text-base font-bold tabular ${b.charges > 0 ? 'text-exp' : 'text-txt-2'}`}>{fmtTZS(b.charges || 0)}</div>
                </div>
              </div>
              {/* Fee-leaderboard bar (relative to the priciest service). */}
              <div className="mt-3 h-1.5 rounded-full bg-surface-4 overflow-hidden">
                <div className="h-full rounded-full bg-exp/70" style={{ width: `${Math.min(100, ((b.charges || 0) / maxCharges) * 100)}%` }} />
              </div>
              <div className="mt-1.5 text-[10px] text-txt-3 font-mono">
                {b.avg_fee_per_txn > 0 ? `~${fmtTZS(b.avg_fee_per_txn)} per transaction` : 'No fees detected'}
              </div>
            </div>
          );
        })}
      </div>

      {/* Deterministic suggestions */}
      {(intel.suggestions || []).length > 0 && (
        <div className="mt-4 space-y-2.5">
          {intel.suggestions.map((s, i) => {
            const st = SUGGESTION_STYLE[s.kind] || SUGGESTION_STYLE.saving_estimate;
            return (
              <div key={i} className={`flex items-start gap-3 surface-inset rounded-xl p-3 border ${st.ring}`}>
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${st.chip}`}>
                  <Icon name={st.icon} size={14} />
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-txt-1">{s.title}</div>
                  <p className="text-xs text-txt-2 leading-relaxed break-words">{s.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* LLM coach (optional) */}
      {coach && (
        <div className="mt-4 flex items-start gap-3 surface-inset rounded-lg p-3 border-l-2 border-accent/50">
          <span className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 bg-accent/10 border border-accent/25 mt-0.5">
            <Icon name="sparkles" size={13} className="text-accent" />
          </span>
          <p className="text-xs sm:text-sm text-txt-2 leading-relaxed break-words"><AutoT>{coach}</AutoT></p>
        </div>
      )}
    </div>
  );
};

/* ----------------------------------------------------------------
   StatementTimeline — statement history grouped Recent vs Past, then by bank
   (Slice 3, Part K). Tapping a row focuses that statement and opens Analysis.
   ---------------------------------------------------------------- */
const StatementTimeline = ({ statements, onOpen }) => {
  if (!statements || statements.length === 0) return null;
  const groups = [
    { key: 'recent', label: 'Recent', rows: statements.filter((s) => s.recency === 'recent') },
    { key: 'past',   label: 'Past',   rows: statements.filter((s) => s.recency !== 'recent') },
  ].filter((g) => g.rows.length > 0);

  return (
    <div className="bento p-5 sm:p-6">
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div>
          <Eyebrow>Statements</Eyebrow>
          <h3 className="mt-1.5 text-sm sm:text-base font-semibold tracking-tight">Your upload history</h3>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-ticker text-txt-3">{statements.length} uploaded</span>
      </div>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="text-[10px] text-txt-3 font-mono uppercase tracking-ticker mb-2">{g.label}</div>
            <div className="space-y-2">
              {g.rows.map((s) => (
                <button
                  key={s.job_id}
                  type="button"
                  onClick={() => onOpen(s.job_id)}
                  className="press focus-ring w-full text-left flex items-center gap-3 surface-inset rounded-xl p-3 hover:bg-surface-4/50 transition-colors"
                >
                  <Badge color={g.key === 'recent' ? 'accent' : 'muted'}>{bankLabel(s.bank)}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-txt-1 truncate">
                      {s.period_start ? `${s.period_start} → ${s.period_end || '—'}` : (s.filename || 'Statement')}
                    </div>
                    <div className="text-[10px] text-txt-3 font-mono">{s.txn_count || 0} transactions · {fmtDay(s.created_at)}</div>
                  </div>
                  <Icon name="chevRight" size={14} className="text-txt-4 flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const DashboardPage = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState(null); // honest upload/extraction job state
  const [error, setError] = useState(null);
  const busy = !!job && (job.phase === 'uploading' || job.phase === 'processing');
  const [timeView, setTimeView] = useState('monthly');
  // Statement selector / history: null selection = latest upload (default).
  const [statements, setStatements] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  // Per-bank money map (Slice 3). `bankFocus` = which service the panel is
  // focused on ('all' = the full leaderboard).
  const [bankIntel, setBankIntel] = useState(null);
  const [bankFocus, setBankFocus] = useState('all');
  const { t } = useT();
  const { navigate } = useRouter();
  const [theme] = useTheme(); // re-render (and recolor charts) on theme toggle
  void theme;

  const refresh = async (jobId = null) => {
    try {
      setLoading(true);
      const summary = await fetchDashboardSummary(jobId);
      setData(summary);
      setError(null);
    } catch (err) {
      // A scoped request can fail if that statement is now gone or still
      // processing (backend returns 409/404). Fall back to the latest statement
      // and drop the stale selection rather than stranding the dashboard or
      // rendering another statement's numbers under the requested id.
      if (jobId && (err.status === 409 || err.status === 404)) {
        setSelectedJobId(null);
        setActiveStatement(null);
        try {
          setData(await fetchDashboardSummary(null));
          setError(null);
          return;
        } catch (e2) {
          setError(e2.message || 'Failed to load dashboard');
          return;
        }
      }
      setError(err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  const loadStatements = async () => {
    try {
      setStatements(await fetchStatementIndex());
    } catch { /* selector is non-critical — leave it empty on failure */ }
  };

  const loadBankIntel = async () => {
    try {
      setBankIntel(await fetchBankIntel());
    } catch { /* money map is non-critical — leave it hidden on failure */ }
  };

  // Switch the whole dashboard to a chosen statement (or null = latest), and
  // publish it as the app-wide active statement so Personal Spending and
  // Reconciliation scope to the same upload.
  const selectStatement = (jobId) => {
    setSelectedJobId(jobId);
    setActiveStatement(jobId || null);
    refresh(jobId);
  };

  useEffect(() => { refresh(null); loadStatements(); loadBankIntel(); }, []);

  // Poll lifecycle guard: a ref-held timer + generation token. Bumping the
  // generation cancels any in-flight poll — on unmount, and whenever a new
  // upload supersedes an older one — so we never leak an endless timer chain.
  const pollRef = useRef({ timer: null, gen: 0 });
  useEffect(() => () => {
    pollRef.current.gen += 1;
    if (pollRef.current.timer) clearTimeout(pollRef.current.timer);
  }, []);

  // Drive the full honest flow: byte upload → poll extraction stages →
  // decisive done, or a timestamped classified failure with retry.
  const startUpload = async (file) => {
    if (!file) return;
    setError(null);
    const started = Date.now();
    setJob({ phase: 'uploading', pct: 0, file, rate: 0, eta: null });

    const onProgress = (loaded, total) => {
      const pct = total ? Math.round((loaded / total) * 100) : 0;
      const elapsed = (Date.now() - started) / 1000 || 1;
      const rate = loaded / elapsed;
      const eta = rate > 0 ? Math.max(0, Math.round((total - loaded) / rate)) : null;
      setJob((j) => (j && j.phase === 'uploading' ? { ...j, pct, rate, eta } : j));
    };

    let jobId;
    try {
      const res = await uploadStatement(file, onProgress);
      jobId = res?.job_id;
    } catch (err) {
      if (err?.status === 402) { setJob(null); return; } // api routed to /upgrade
      setJob({
        phase: 'failed', file,
        failure: { message: err?.message || 'Upload failed', code: err?.code, timestamp: Date.now() },
      });
      toast.error(err?.message || 'Upload failed');
      return;
    }

    if (!jobId) { setJob(null); await refresh(null); return; }

    // Phase B — poll the extraction job for real stage + percentage. The
    // generation token invalidates this loop if the component unmounts or a
    // newer upload starts; the deadline turns a job that never resolves into an
    // honest, retryable failure instead of an infinite spinner.
    const gen = ++pollRef.current.gen;
    if (pollRef.current.timer) clearTimeout(pollRef.current.timer);
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    const schedule = (fn, ms) => { pollRef.current.timer = setTimeout(fn, ms); };
    const alive = () => pollRef.current.gen === gen;

    setJob((j) => ({ ...(j || {}), phase: 'processing', file, pct: 0, stage: 'Queued' }));
    // Turn a job that never resolves into an honest, retryable failure. Shared so
    // BOTH the in-progress path and the transient-error path honour the deadline
    // — otherwise a status endpoint that keeps failing would poll forever.
    const failTimeout = (status) => {
      setJob((j) => ({
        ...(j || {}), phase: 'failed',
        failure: {
          message: 'This is taking longer than expected. The extraction may still be running — check back shortly, or try again.',
          code: 'timeout',
          stage: status?.stage,
          progress: status?.progress,
          timestamp: Date.now(),
        },
      }));
      toast.error('Extraction timed out');
    };
    const poll = async () => {
      if (!alive()) return; // superseded or unmounted
      let status;
      try {
        status = await fetchUploadStatus(jobId);
      } catch {
        if (!alive()) return;
        // A persistently unreachable status endpoint must still time out, or the
        // overlay spins forever on a dead network.
        if (Date.now() > deadline) { failTimeout(null); return; }
        schedule(poll, 1500); // transient — keep polling
        return;
      }
      if (!alive()) return;
      if (status?.status === 'done') {
        setJob((j) => ({ ...(j || {}), phase: 'done', pct: 100, total: status.total_transactions }));
        toast.success('Statement extracted');
        // A fresh upload becomes the latest — snap the view back to it and
        // refresh the selector so the new statement appears in the history.
        setSelectedJobId(null);
        await refresh(null);
        await loadStatements();
        schedule(() => setJob(null), 1400); // let the success state land (§85)
        return;
      }
      if (status?.status === 'failed') {
        setJob((j) => ({
          ...(j || {}), phase: 'failed',
          failure: {
            message: status.error_message || 'Extraction failed',
            code: status.error_code,
            stage: status.failed_stage,
            progress: status.failed_progress,
            timestamp: status.finished_at,
          },
        }));
        toast.error(status.error_message || 'Extraction failed');
        return;
      }
      if (Date.now() > deadline) { failTimeout(status); return; }
      setJob((j) => (j ? { ...j, phase: 'processing', pct: status?.progress ?? j.pct, stage: status?.stage || j.stage } : j));
      schedule(poll, 1000);
    };
    poll();
  };

  if (loading && !data) {
    // Layout-matching skeleton (design corpus §81–83) — the shape maps onto
    // the real dashboard so the resolve is a fill-in, not a reflow.
    return (
      <AppShell>
        <div className="space-y-4 sm:space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-2"><Skeleton className="h-3 w-20" /><Skeleton className="h-7 w-40" /></div>
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
            <Skeleton className="lg:col-span-8 h-64 rounded-[22px]" />
            <Skeleton className="lg:col-span-4 h-64 rounded-[22px]" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
          </div>
        </div>
        <SignOutConfirm />
      </AppShell>
    );
  }

  const uploadCount = data?.upload_count || 0;
  const k           = data?.kpis || {};
  const balance     = data?.balance_comparison;
  const issues      = data?.issues || [];
  const categories  = data?.categories || [];
  const availableViews = data?.available_views?.length ? data.available_views : ['monthly'];
  const activeView  = availableViews.includes(timeView) ? timeView : availableViews[availableViews.length - 1];
  const timeSeries  = data?.time_series?.[activeView] || data?.monthly_data || [];
  const txCosts     = data?.transaction_costs;
  const remaining   = Math.max(0, 3 - uploadCount);

  if (uploadCount === 0) {
    return (
      <AppShell>
        <div className="space-y-7 max-w-3xl mx-auto">
          <div>
            <Eyebrow>{t('dash.eyebrow')}</Eyebrow>
            <h1 className="mt-3 text-2xl sm:text-3xl font-semibold tracking-tight">
              <TextType
                as="span"
                text={t('dash.welcome')}
                typingSpeed={42}
                loop={false}
                showCursor
                cursorCharacter="▌"
                cursorClassName="text-accent"
                startOnVisible
              />
            </h1>
            <p className="text-sm text-txt-2 mt-2 max-w-md">
              {t('dash.welcomeSub')}
            </p>
          </div>
          <UploadZone onFile={startUpload} busy={busy} error={error} />
          <EmptyState
            icon="chart"
            title={t('dash.empty.title')}
            desc={t('dash.empty.desc')}
          />
        </div>
        <UploadOverlay job={job} onRetry={() => startUpload(job?.file)} onClose={() => setJob(null)} />
        <SignOutConfirm />
      </AppShell>
    );
  }

  /* Series for KPI sparklines */
  const inSpark  = timeSeries.length > 1 ? timeSeries.map((m) => m.income  || 0) : seededSeries(k.money_in);
  const outSpark = timeSeries.length > 1 ? timeSeries.map((m) => m.expense || 0) : seededSeries(k.money_out);

  const th = chartTheme();          // live theme-aware chart colors
  const catPalette = th.palette;    // green-first, follows light/dark

  // A doughnut stops being legible past ~5 wedges — the eye can't rank arcs
  // beyond that (charts.md #3). Show the five biggest categories and fold the
  // long tail into a single "Other" wedge rather than drawing every category.
  const topCategories = (() => {
    if (categories.length <= 6) return categories;
    const head = categories.slice(0, 5);
    const tail = categories.slice(5);
    const otherValue = tail.reduce((s, c) => s + (c.value || 0), 0);
    return [...head, { name: `Other (${tail.length})`, value: otherValue, color: th.tick }];
  })();
  const catTotal = topCategories.reduce((s, c) => s + (c.value || 0), 0) || 1;

  const netUp = (k.net_flow || 0) >= 0;

  return (
    <AppShell>
      <div className="space-y-4 sm:space-y-5">
        {/* ============================================================ HEADER */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow>{t('dash.eyebrow')}</Eyebrow>
            <div className="mt-1.5">
              <StatementSelector
                statements={statements}
                selectedJobId={selectedJobId}
                currentBank={data.latest_upload?.bank}
                onSelect={selectStatement}
              />
            </div>
            {data.same_day_siblings?.length > 0 && (
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-txt-4 font-mono uppercase tracking-ticker">
                  Also uploaded {fmtDay(data.same_day_siblings[0].created_at)}:
                </span>
                {data.same_day_siblings.map((s) => (
                  <button
                    key={s.job_id}
                    type="button"
                    onClick={() => selectStatement(s.job_id)}
                    className="press text-[11px] px-2 py-0.5 rounded-md bg-accent/10 text-accent hover:bg-accent/20 transition focus-ring"
                  >
                    {bankLabel(s.bank)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="inline-flex items-center gap-2 text-[11px] text-txt-3 font-mono uppercase tracking-ticker self-start sm:self-auto">
            <span className="w-1.5 h-1.5 rounded-full bg-accent anim-pulse-soft" />
            {data.latest_upload?.total_transactions || 0} {t('common.transactions').toLowerCase()}
          </span>
        </div>

        {error && (
          <div className="p-3 bg-exp/10 border border-exp/30 rounded-xl text-sm text-exp flex items-start gap-2">
            <Icon name="alert" size={16} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ==================================================== A · HERO BENTO */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
          {/* A1 — Balance hero + action pills + overview area chart */}
          <TiltCard max={3} className="lg:col-span-8 surface-hero rounded-[22px] p-5 sm:p-6 relative overflow-hidden">
            <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full blur-3xl opacity-20"
                 style={{ background: netUp ? 'rgb(var(--c-accent))' : 'rgb(var(--c-exp))' }} />
            <div className="relative">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-ticker text-txt-3 mb-1">
                    {t('common.netFlow')}
                    <InfoHint content={t('hint.netFlow')} side="bottom" />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-txt-3 text-base font-mono">TZS</span>
                    <span className="text-3xl sm:text-4xl lg:text-5xl font-bold tabular tracking-tight text-txt-1">
                      <CountUp value={Math.abs(k.net_flow || 0)} formatter={(v) => fmtTZS(v).replace('TZS ', '')} duration={1100} />
                    </span>
                  </div>
                  <div className={`mt-1.5 inline-flex items-center gap-1.5 text-[12px] font-semibold ${netUp ? 'text-inc' : 'text-exp'}`}>
                    <Icon name={netUp ? 'arrowUpRight' : 'arrowDownRight'} size={13} />
                    {k.expense_growth != null ? `${Math.abs(Number(k.expense_growth)).toFixed(1)}% ` : ''}
                    <span className="text-txt-3 font-normal">vs last period</span>
                  </div>
                </div>
                {availableViews.length > 1 && (
                  <Segmented
                    options={availableViews.map((v) => ({ key: v, label: v[0].toUpperCase() + v.slice(1) }))}
                    value={activeView}
                    onChange={setTimeView}
                  />
                )}
              </div>

              {/* Upload + income/expense legend (nav lives in the sidebar) */}
              <div className="mt-5 flex items-center justify-between gap-3 flex-wrap">
                <ActionPill icon="upload" label={t('dash.uploadAnother')} as="label" htmlFor="dash-hero-upload" />
                <input id="dash-hero-upload" type="file" accept=".pdf" className="hidden"
                       onChange={(e) => { const f = e.target.files?.[0]; if (f) startUpload(f); }} />
                <div className="flex gap-4 text-xs text-txt-2">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-inc" />{t('common.income')}</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-exp" />{t('common.expense')}</span>
                </div>
              </div>

              {/* Overview area chart */}
              <div className="mt-5">
                {timeSeries.length > 0 ? (
                  <ChartJS
                    type="line"
                    ariaLabel={`Income versus expense over ${timeSeries.length} periods`}
                    height={190}
                    data={{
                      labels: timeSeries.map((m) => m.label || m.month),
                      datasets: [
                        { label: 'Income',  data: timeSeries.map((m) => m.income),  borderColor: th.income,  backgroundColor: th.incomeFill,  fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2 },
                        { label: 'Expense', data: timeSeries.map((m) => m.expense), borderColor: th.expense, backgroundColor: th.expenseFill, fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2 },
                      ],
                    }}
                    options={{
                      interaction: { intersect: false, mode: 'index' },
                      scales: {
                        x: { grid: { display: false }, ticks: { color: th.tick, font: { size: 10 } } },
                        y: { grid: { color: th.grid }, ticks: { color: th.tick, font: { size: 10 }, callback: (v) => fmtTZS(v) } },
                      },
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          backgroundColor: th.tooltipBg, borderColor: th.tooltipBorder, borderWidth: 1, padding: 10,
                          titleColor: th.tooltipTitle, bodyColor: th.tooltipBody,
                          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtTZSFull(ctx.raw)}` },
                        },
                      },
                    }}
                  />
                ) : (
                  <p className="text-sm text-txt-3 py-10 text-center">No dated transactions to chart yet.</p>
                )}
              </div>
            </div>
          </TiltCard>

          {/* A2 — Category gauge (doughnut with centered total + legend) */}
          <TiltCard max={4} className="lg:col-span-4 bento p-5 sm:p-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <Eyebrow>{t('dash.mix.eyebrow')}</Eyebrow>
                <h3 className="mt-1.5 text-sm font-semibold tracking-tight">{t('dash.mix.title')}</h3>
              </div>
              <Icon name="chart" size={16} className="text-txt-3" />
            </div>
            {topCategories.length > 0 ? (
              <>
                <div className="relative">
                  <ChartJS
                    type="doughnut"
                    ariaLabel={`Spending by category. Total ${fmtTZS(catTotal)}.`}
                    height={180}
                    data={{
                      labels: topCategories.map((c) => c.name),
                      datasets: [{
                        data: topCategories.map((c) => c.value),
                        backgroundColor: topCategories.map((c, i) => c.color || catPalette[i % catPalette.length]),
                        borderWidth: 0,
                      }],
                    }}
                    options={{
                      cutout: '72%',
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          backgroundColor: th.tooltipBg, borderColor: th.tooltipBorder, borderWidth: 1, padding: 10,
                          titleColor: th.tooltipTitle, bodyColor: th.tooltipBody,
                          callbacks: { label: (ctx) => `${ctx.label}: ${fmtTZSFull(ctx.raw)}` },
                        },
                      },
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="text-center">
                      <div className="text-[10px] uppercase tracking-ticker text-txt-3 font-mono">{t('dash.mix.total')}</div>
                      <div className="text-lg font-bold tabular text-txt-1">{fmtTZS(catTotal)}</div>
                    </div>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {topCategories.slice(0, 5).map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: c.color || catPalette[i % catPalette.length] }} />
                        <span className="text-txt-2 truncate">{c.name}</span>
                      </div>
                      <span className="text-txt-3 tabular flex-shrink-0 ml-2">{((c.value / catTotal) * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-txt-3 py-10 text-center">No categorized spending yet.</p>
            )}
          </TiltCard>
        </div>

        {/* ==================================================== B · KPI TILES */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
          <MiniTile label={t('common.moneyIn')}  value={fmtTZS(k.money_in || 0)}  tone="inc" spark={inSpark} />
          <MiniTile label={t('common.moneyOut')} value={fmtTZS(k.money_out || 0)} tone="exp" spark={outSpark} />
          {k.savings_rate != null
            ? <MiniTile label={t('common.savingsRate')} value={`${Number(k.savings_rate).toFixed(1)}%`} tone="accent" spark={seededSeries(k.savings_rate * 137)} hint={t('hint.savingsRate')} />
            : <MiniTile label={t('common.savingsRate')} locked remaining={remaining} />}
          <MiniTile label={t('common.balanceNow')} value={fmtTZS(k.closing_balance || 0)} tone="net" spark={seededSeries(k.closing_balance)} hint={t('hint.closingBalance')} />
        </div>

        {/* ==================================== C · TOP SPENDING + FEE LEAKAGE */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
          {/* Top spending rail (Top Token & Assets style) */}
          <div className={`bento p-5 sm:p-6 min-w-0 ${txCosts && txCosts.estimated_total > 0 ? 'lg:col-span-7' : 'lg:col-span-12'}`}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <Eyebrow>Top spending</Eyebrow>
                <h3 className="mt-1.5 text-sm sm:text-base font-semibold tracking-tight">Where money goes</h3>
              </div>
              <button onClick={() => navigate('/analysis')} className="text-[11px] font-mono uppercase tracking-ticker text-accent hover:text-accent-hover inline-flex items-center gap-1">
                View all <Icon name="arrowRight" size={11} />
              </button>
            </div>
            {topCategories.length > 0 ? (
              <div className="space-y-2">
                {topCategories.slice(0, 5).map((c, i) => {
                  const color = c.color || catPalette[i % catPalette.length];
                  const pct = ((c.value / catTotal) * 100).toFixed(0);
                  return (
                    <div key={i} className="flex items-center gap-3 surface-inset rounded-xl p-2.5 hover:bg-surface-4/50 transition-colors">
                      <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-[11px] font-bold"
                            style={{ background: `${color}22`, color, border: `1px solid ${color}40` }}>
                        {c.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-txt-1 truncate">{c.name}</div>
                        <div className="text-[10px] text-txt-3 font-mono">{pct}% of spend</div>
                      </div>
                      <div className="w-16 flex-shrink-0 hidden sm:block">
                        <Sparkline values={seededSeries(c.value, 12)} color={color} width={64} height={22} strokeWidth={1.5} fill={false} />
                      </div>
                      <div className="text-[13px] font-semibold tabular text-txt-1 flex-shrink-0">{fmtTZS(c.value)}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-txt-3 py-8 text-center">No categorized spending yet.</p>
            )}
          </div>

          {/* Bank fees pull-quote */}
          {txCosts && txCosts.estimated_total > 0 && (
            <TiltCard max={4} className="lg:col-span-5 bento p-5 sm:p-6 relative overflow-hidden">
              <div className="absolute -right-12 -top-12 w-48 h-48 bg-exp/10 rounded-full blur-3xl" />
              <div className="relative">
                <Eyebrow>{t('dash.fee.eyebrow')}</Eyebrow>
                <div className="mt-2 flex items-baseline gap-2 flex-wrap">
                  <span className="text-txt-3 text-sm font-mono">TZS</span>
                  <span className="text-2xl sm:text-3xl font-bold tabular text-exp break-all">
                    <CountUp value={txCosts.estimated_total} formatter={(v) => fmtTZS(v).replace('TZS ', '')} />
                  </span>
                </div>
                <p className="text-[10px] text-txt-3 font-mono uppercase tracking-ticker mt-1">
                  {t('common.estimated')} · {txCosts.fee_occurrences} {t('dash.fee.occurrences')}
                </p>
                <div className="mt-3 flex items-start gap-2.5 surface-inset rounded-lg p-3">
                  <Icon name="alert" size={14} className="text-exp mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-txt-2 leading-relaxed break-words"><AutoT>{txCosts.insight}</AutoT></p>
                </div>
              </div>
            </TiltCard>
          )}
        </div>

        {/* ================================ C2 · MONEY MAP (per-service fees) */}
        <MoneyMap intel={bankIntel} focus={bankFocus} onFocus={setBankFocus} />

        {/* ==================================== D · BALANCE CHECK (full width) */}
        {balance && (
          <div className="bento p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
              <Eyebrow>{t('dash.recon.eyebrow')}</Eyebrow>
              <span className="font-mono text-[10px] uppercase tracking-ticker text-txt-3">{t('dash.recon.balance')}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-bdr/60 rounded-xl overflow-hidden border border-bdr mb-4">
              {[
                { l: t('dash.recon.closing'),     v: balance.closing_balance_from_statement, accent: 'text-txt-1' },
                { l: t('dash.recon.computed'),    v: balance.computed_remaining,             accent: 'text-txt-1' },
                { l: t('dash.recon.discrepancy'), v: balance.discrepancy,                    accent: Math.abs(balance.discrepancy || 0) > 1 ? 'text-exp' : 'text-inc' },
              ].map((s) => (
                <div key={s.l} className="bg-surface-2 p-3 sm:p-4 min-w-0">
                  <div className="text-[10px] tracking-ticker uppercase text-txt-3 mb-1 truncate">{s.l}</div>
                  <div className={`text-base sm:text-lg font-bold tabular ${s.accent} break-all`}>{fmtTZSFull(s.v)}</div>
                </div>
              ))}
            </div>
            <div className="flex items-start gap-3 surface-inset rounded-lg p-3 border-l-2 border-accent/50">
              <span className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 bg-accent/10 border border-accent/25 mt-0.5">
                <Icon name="sparkles" size={13} className="text-accent" />
              </span>
              <p className="text-xs sm:text-sm text-txt-2 leading-relaxed break-words"><AutoT>{balance.insight}</AutoT></p>
            </div>
          </div>
        )}

        {/* ==================================== E · ANOMALIES BENTO GRID */}
        {issues.length > 0 && (
          <div>
            <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
              <div>
                <Eyebrow>{t('dash.anom.eyebrow')}</Eyebrow>
                <h3 className="mt-1.5 text-sm sm:text-base font-semibold tracking-tight">Flagged for your attention</h3>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-ticker text-txt-3">{issues.length} {t('dash.anom.flagged')}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {issues.map((issue, idx) => {
                const a = issueAccent(issue.severity);
                return (
                  <TiltCard
                    key={idx}
                    max={6}
                    className={`glass rounded-2xl border ${a.ring} p-4 sm:p-5 relative overflow-hidden h-full`}
                    style={{ boxShadow: `0 8px 28px -16px ${a.bar}` }}
                  >
                    <span aria-hidden className="absolute -right-8 -top-8 w-28 h-28 rounded-full blur-2xl pointer-events-none"
                          style={{ background: a.bar, opacity: 0.16 }} />
                    <div className="relative">
                      <div className="flex items-center justify-between mb-3">
                        <span className={`w-9 h-9 rounded-xl flex items-center justify-center border ${a.cls}`}>
                          <Icon name={a.icon} size={16} />
                        </span>
                        <span className={`text-[10px] uppercase tracking-ticker font-semibold px-2 py-0.5 rounded border ${a.cls}`}>
                          {t(a.labelKey)}
                        </span>
                      </div>
                      <h4 className="text-sm font-semibold text-txt-1 leading-snug mb-1.5 break-words"><AutoT>{issue.title}</AutoT></h4>
                      <p className="text-xs text-txt-2 leading-relaxed break-words"><AutoT>{issue.description}</AutoT></p>
                    </div>
                  </TiltCard>
                );
              })}
            </div>
          </div>
        )}

        {/* ================================ E2 · STATEMENT HISTORY TIMELINE */}
        <StatementTimeline
          statements={statements}
          onOpen={(jobId) => { setActiveStatement(jobId); navigate('/analysis'); }}
        />

        {/* ================================================ F · ACTION ENGINE */}
        <ActionPlan summary={data} />
      </div>
      <UploadOverlay job={job} onRetry={() => startUpload(job?.file)} onClose={() => setJob(null)} />
      <SignOutConfirm />
    </AppShell>
  );
};

export default DashboardPage;
