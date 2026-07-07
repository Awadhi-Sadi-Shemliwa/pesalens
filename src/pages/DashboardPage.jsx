import React, { useEffect, useState } from 'react';
import { AppShell } from '../components/navigation';
import { useRouter } from '../components/Router';
import { Icon } from '../components/Icon';
import { EmptyState, Eyebrow, Sparkline, CountUp, Segmented } from '../components/common';
import { ChartJS, chartTheme } from '../components/ChartJS';
import { TiltCard } from '../components/motion';
import ActionPlan from '../components/ActionPlan';
import SignOutConfirm from '../components/SignOutConfirm';
import { fetchDashboardSummary, uploadStatement, fmtTZS, fmtTZSFull } from '../data/api';
import { useTheme } from '../data/theme';
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
  const cls = `inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-semibold transition-all whitespace-nowrap ${
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
const MiniTile = ({ label, value, tone = 'accent', spark, locked, remaining }) => {
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
              className="btn-primary px-7 py-3 rounded-xl text-sm font-semibold inline-flex items-center gap-2"
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

const DashboardPage = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [timeView, setTimeView] = useState('monthly');
  const { t } = useT();
  const { navigate } = useRouter();
  const [theme] = useTheme(); // re-render (and recolor charts) on theme toggle
  void theme;

  const refresh = async () => {
    try {
      setLoading(true);
      const summary = await fetchDashboardSummary();
      setData(summary);
    } catch (err) {
      setError(err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleUpload = async (file) => {
    setBusy(true);
    setError(null);
    try {
      await uploadStatement(file);
      await refresh();
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-full">
          <div className="flex items-center gap-3 text-sm text-txt-2 font-mono uppercase tracking-ticker">
            <span className="w-1.5 h-1.5 rounded-full bg-accent anim-pulse-soft" />
            {t('common.loading')} {t('nav.dashboard').toLowerCase()}
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
            <h1 className="mt-3 text-2xl sm:text-3xl font-semibold tracking-tight">{t('dash.welcome')}</h1>
            <p className="text-sm text-txt-2 mt-2 max-w-md">
              {t('dash.welcomeSub')}
            </p>
          </div>
          <UploadZone onFile={handleUpload} busy={busy} error={error} />
          <EmptyState
            icon="chart"
            title={t('dash.empty.title')}
            desc={t('dash.empty.desc')}
          />
        </div>
        <SignOutConfirm />
      </AppShell>
    );
  }

  /* Series for KPI sparklines */
  const inSpark  = timeSeries.length > 1 ? timeSeries.map((m) => m.income  || 0) : seededSeries(k.money_in);
  const outSpark = timeSeries.length > 1 ? timeSeries.map((m) => m.expense || 0) : seededSeries(k.money_out);

  const topCategories = categories.slice(0, 6);
  const catTotal = topCategories.reduce((s, c) => s + (c.value || 0), 0) || 1;
  const th = chartTheme();          // live theme-aware chart colors
  const catPalette = th.palette;    // green-first, follows light/dark

  const netUp = (k.net_flow || 0) >= 0;

  return (
    <AppShell>
      <div className="space-y-4 sm:space-y-5">
        {/* ============================================================ HEADER */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow>{t('dash.eyebrow')}</Eyebrow>
            <h1 className="mt-1.5 text-xl sm:text-2xl lg:text-[28px] font-semibold tracking-tight break-words">
              {data.latest_upload?.bank ? data.latest_upload.bank.toUpperCase() : t('common.bank')}
            </h1>
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
                  <div className="text-[11px] uppercase tracking-ticker text-txt-3 mb-1">{t('common.netFlow')}</div>
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
                       onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
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
            ? <MiniTile label={t('common.savingsRate')} value={`${Number(k.savings_rate).toFixed(1)}%`} tone="accent" spark={seededSeries(k.savings_rate * 137)} />
            : <MiniTile label={t('common.savingsRate')} locked remaining={remaining} />}
          <MiniTile label={t('common.balanceNow')} value={fmtTZS(k.closing_balance || 0)} tone="net" spark={seededSeries(k.closing_balance)} />
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

        {/* ================================================ F · ACTION ENGINE */}
        <ActionPlan summary={data} />
      </div>
      <SignOutConfirm />
    </AppShell>
  );
};

export default DashboardPage;
