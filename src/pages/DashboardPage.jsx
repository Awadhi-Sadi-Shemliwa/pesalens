import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../components/navigation';
import { Icon } from '../components/Icon';
import { KpiCard, EmptyState, Eyebrow, Sparkline, CountUp, Segmented } from '../components/common';
import { ChartJS } from '../components/ChartJS';
import ActionPlan from '../components/ActionPlan';
import SignOutConfirm from '../components/SignOutConfirm';
import { fetchDashboardSummary, uploadStatement, fmtTZS, fmtTZSFull } from '../data/api';
import { useT, AutoT } from '../data/i18n';

/* No purple. Brand-aligned palette. */
const PALETTE = ['#4C6EF5', '#06B6D4', '#10B981', '#F59E0B', '#EF4444', '#8B95A8', '#5B7CFA', '#0EA5E9'];

const LockedKpi = ({ label, remaining }) => {
  const { t } = useT();
  return (
    <div className="card-soft p-5 opacity-70 relative overflow-hidden">
      <div className="absolute inset-0 grid-faint opacity-40 pointer-events-none" />
      <div className="flex items-start justify-between mb-3 relative">
        <span className="text-[11px] tracking-ticker uppercase text-txt-3 font-medium">{label}</span>
        <span className="w-7 h-7 rounded-lg flex items-center justify-center bg-surface-4 border border-bdr">
          <Icon name="zap" size={14} className="text-txt-3" />
        </span>
      </div>
      <div className="text-base font-semibold text-txt-3 mb-1 relative">{t('common.locked')}</div>
      <p className="text-[11px] text-txt-3 relative">
        {remaining} {remaining === 1 ? t('dash.lockedHint') : t('dash.lockedHint.p')}
      </p>
    </div>
  );
};

const issueAccent = (severity) => {
  if (severity === 'warning')  return { bar: '#F59E0B', labelKey: 'common.warning',  color: 'expense' };
  if (severity === 'critical') return { bar: '#EF4444', labelKey: 'common.critical', color: 'danger' };
  return                       { bar: '#06B6D4', labelKey: 'common.notice',   color: 'net' };
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
    <div className="card-soft p-4 sm:p-6 lg:p-7 relative overflow-hidden">
      <div className="absolute inset-0 grid-dot opacity-50 pointer-events-none" />
      <div className="relative">
        <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
          <div className="min-w-0">
            <Eyebrow num="01">{t('dash.upload.eyebrow')}</Eyebrow>
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
            <Eyebrow num="00">{t('dash.eyebrow')}</Eyebrow>
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

  /* Pull or synthesize sparkline series for KPIs */
  const inSpark  = timeSeries.length > 1 ? timeSeries.map((m) => m.income  || 0) : [k.money_in   || 0, k.money_in   || 0];
  const outSpark = timeSeries.length > 1 ? timeSeries.map((m) => m.expense || 0) : [k.money_out  || 0, k.money_out  || 0];
  const netSpark = timeSeries.length > 1 ? timeSeries.map((m, i) => (m.income || 0) - (m.expense || 0)) : [k.net_flow || 0, k.net_flow || 0];

  const topCategories = categories.slice(0, 6);

  return (
    <AppShell>
      <div className="space-y-5 sm:space-y-7">
        {/* ----------- Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 sm:gap-4">
          <div className="min-w-0">
            <Eyebrow num="00">{t('dash.eyebrow')}</Eyebrow>
            <h1 className="mt-2 text-xl sm:text-2xl lg:text-3xl font-semibold tracking-tight break-words">
              {data.latest_upload?.bank ? data.latest_upload.bank.toUpperCase() : t('common.bank')}
            </h1>
            <p className="text-[11px] sm:text-xs text-txt-3 mt-1.5 font-mono uppercase tracking-ticker break-words">
              {data.latest_upload?.total_transactions || 0} {t('common.transactions').toLowerCase()}
              <span className="mx-2">·</span>
              {t('dash.recon.balance')}
            </p>
          </div>
          <label className="btn-primary px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 cursor-pointer self-start sm:self-auto">
            <Icon name="upload" size={14} />
            {busy ? t('dash.uploading') : t('dash.uploadAnother')}
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) handleUpload(picked);
              }}
            />
          </label>
        </div>

        {error && (
          <div className="p-3 bg-exp/10 border border-exp/30 rounded-xl text-sm text-exp flex items-start gap-2">
            <Icon name="alert" size={16} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ----------- Hero KPI band — 62/38 split (Skill.md golden ratio) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-5">
          <div className="lg:col-span-7">
            <KpiCard
              variant="hero"
              label={t('common.netFlow')}
              icon="trending"
              accent="accent"
              rawNumber={k.net_flow || 0}
              formatter={(v) => fmtTZS(v)}
              spark={netSpark}
              change={k.expense_growth != null ? `${Math.abs(Number(k.expense_growth)).toFixed(1)}%` : undefined}
              changeDir={k.expense_growth <= 0 ? 'up' : 'down'}
            />
          </div>
          <div className="lg:col-span-5 grid grid-cols-2 gap-3 sm:gap-5">
            <KpiCard
              label={t('common.moneyIn')}
              icon="arrowUpRight"
              accent="income"
              rawNumber={k.money_in || 0}
              formatter={(v) => fmtTZS(v)}
              spark={inSpark}
            />
            <KpiCard
              label={t('common.moneyOut')}
              icon="arrowDownRight"
              accent="expense"
              rawNumber={k.money_out || 0}
              formatter={(v) => fmtTZS(v)}
              spark={outSpark}
            />
          </div>
        </div>

        {/* ----------- Secondary KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
          {k.savings_rate != null ? (
            <KpiCard variant="compact" label={t('common.savingsRate')} value={`${Number(k.savings_rate).toFixed(1)}%`} icon="zap" accent="accent" />
          ) : <LockedKpi label={t('common.savingsRate')} remaining={remaining} />}
          {k.savings != null ? (
            <KpiCard variant="compact" label={t('common.savings')} value={fmtTZS(k.savings)} icon="wallet" accent="income" />
          ) : <LockedKpi label={t('common.savings')} remaining={remaining} />}
          {k.expense_growth != null ? (
            <KpiCard variant="compact" label={t('common.expenseGrowth')} value={`${Number(k.expense_growth).toFixed(1)}%`} changeDir={Number(k.expense_growth) <= 0 ? 'down' : 'up'} icon="chart" accent="expense" />
          ) : <LockedKpi label={t('common.expenseGrowth')} remaining={remaining} />}
          {k.income_growth != null ? (
            <KpiCard variant="compact" label={t('common.incomeGrowth')} value={`${Number(k.income_growth).toFixed(1)}%`} changeDir={Number(k.income_growth) >= 0 ? 'up' : 'down'} icon="trending" accent="income" />
          ) : <LockedKpi label={t('common.incomeGrowth')} remaining={remaining} />}
        </div>

        {/* ----------- Action engine — Top mistakes, opportunities, 30-day plan */}
        <ActionPlan summary={data} />

        {/* ----------- Bank fees pull-quote (only if relevant) */}
        {txCosts && txCosts.estimated_total > 0 && (
          <div className="card-soft p-3 sm:p-5 lg:p-6 relative overflow-hidden">
            <div className="absolute -right-12 -top-12 w-48 h-48 bg-exp/10 rounded-full blur-3xl" />
            <div className="relative grid lg:grid-cols-12 gap-4 lg:gap-6 items-center">
              <div className="lg:col-span-4 min-w-0">
                <Eyebrow>{t('dash.fee.eyebrow')}</Eyebrow>
                <div className="mt-2 flex items-baseline gap-2 flex-wrap">
                  <span className="text-txt-3 text-sm font-mono">TZS</span>
                  <span className="text-2xl sm:text-3xl lg:text-4xl font-bold tabular text-exp break-all">
                    <CountUp value={txCosts.estimated_total} formatter={(v) => fmtTZS(v).replace('TZS ', '')} />
                  </span>
                </div>
                <p className="text-[11px] text-txt-3 font-mono uppercase tracking-ticker mt-1 break-words">
                  {t('common.estimated')} · {txCosts.fee_occurrences} {t('dash.fee.occurrences')}
                </p>
              </div>
              <div className="lg:col-span-8 min-w-0">
                <p className="text-xs sm:text-sm text-txt-2 leading-relaxed break-words"><AutoT>{txCosts.insight}</AutoT></p>
              </div>
            </div>
          </div>
        )}

        {/* ----------- Balance check */}
        {balance && (
          <div className="card-soft p-3 sm:p-5 lg:p-6">
            <div className="flex items-center justify-between gap-2 mb-5 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <Eyebrow num="02">{t('dash.recon.eyebrow')}</Eyebrow>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-ticker text-txt-3 truncate">{t('dash.recon.balance')}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-bdr/60 rounded-xl overflow-hidden border border-bdr mb-4">
              {[
                { l: t('dash.recon.closing'),     v: balance.closing_balance_from_statement, accent: 'text-txt-1' },
                { l: t('dash.recon.computed'),    v: balance.computed_remaining,             accent: 'text-txt-1' },
                { l: t('dash.recon.discrepancy'), v: balance.discrepancy,                    accent: Math.abs(balance.discrepancy || 0) > 1 ? 'text-exp' : 'text-inc' },
              ].map((s) => (
                <div key={s.l} className="bg-surface-2 p-3 sm:p-4 min-w-0">
                  <div className="text-[10px] sm:text-[11px] tracking-ticker uppercase text-txt-3 mb-1 truncate">{s.l}</div>
                  <div className={`text-base sm:text-lg lg:text-xl font-bold tabular ${s.accent} break-all`}>
                    {fmtTZSFull(s.v)}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs sm:text-sm text-txt-2 leading-relaxed surface-inset rounded-lg p-3 sm:p-3.5 break-words">
              <AutoT>{balance.insight}</AutoT>
            </p>
          </div>
        )}

        {/* ----------- Issues */}
        {issues.length > 0 && (
          <div className="card-soft p-3 sm:p-5 lg:p-6">
            <div className="flex items-center justify-between gap-2 mb-5 flex-wrap">
              <Eyebrow num="03">{t('dash.anom.eyebrow')}</Eyebrow>
              <span className="font-mono text-[10px] uppercase tracking-ticker text-txt-3">{issues.length} {t('dash.anom.flagged')}</span>
            </div>
            <div className="space-y-2.5">
              {issues.map((issue, idx) => {
                const a = issueAccent(issue.severity);
                return (
                  <div
                    key={idx}
                    className="flex items-start gap-3 sm:gap-4 surface-inset rounded-lg p-3 sm:p-4 hover:bg-surface-4/50 transition-colors group"
                  >
                    <div
                      className="w-1 self-stretch rounded-full flex-shrink-0"
                      style={{ background: a.bar, boxShadow: `0 0 12px ${a.bar}66` }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span
                          className={`text-[10px] uppercase tracking-ticker font-semibold px-2 py-0.5 rounded border flex-shrink-0`}
                          style={{
                            background: `${a.bar}15`,
                            color: a.bar,
                            borderColor: `${a.bar}30`,
                          }}
                        >
                          {t(a.labelKey)}
                        </span>
                        <span className="text-xs sm:text-sm font-medium text-txt-1 break-words min-w-0"><AutoT>{issue.title}</AutoT></span>
                      </div>
                      <p className="text-xs text-txt-2 leading-relaxed break-words"><AutoT>{issue.description}</AutoT></p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ----------- Charts row — 62/38 */}
        <div className="grid lg:grid-cols-12 gap-3 sm:gap-5">
          <div className="lg:col-span-8 card-soft p-3 sm:p-5 lg:p-6 min-w-0">
            <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
              <div className="min-w-0">
                <Eyebrow num="04">{t('dash.cf.eyebrow')}</Eyebrow>
                <h3 className="mt-2 text-sm sm:text-base font-semibold tracking-tight break-words">{t('dash.cf.title')}</h3>
              </div>
              <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
                {availableViews.length > 1 && (
                  <Segmented
                    options={availableViews.map((v) => ({ key: v, label: v[0].toUpperCase() + v.slice(1) }))}
                    value={activeView}
                    onChange={setTimeView}
                  />
                )}
                <div className="flex gap-4 text-xs text-txt-2">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-inc" />{t('common.income')}</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-exp" />{t('common.expense')}</span>
                </div>
              </div>
            </div>
            {timeSeries.length > 0 ? (
              <ChartJS
                type="bar"
                height={280}
                data={{
                  labels: timeSeries.map((m) => m.label || m.month),
                  datasets: [
                    { label: 'Income',  data: timeSeries.map((m) => m.income),  backgroundColor: '#10B981', borderRadius: 6, barPercentage: 0.55 },
                    { label: 'Expense', data: timeSeries.map((m) => m.expense), backgroundColor: '#F59E0B', borderRadius: 6, barPercentage: 0.55 },
                  ],
                }}
                options={{
                  scales: {
                    x: { grid: { color: '#1E1F2D' }, ticks: { color: '#5E6078', font: { size: 11 } } },
                    y: { grid: { color: '#1E1F2D' }, ticks: { color: '#5E6078', font: { size: 11 }, callback: (v) => fmtTZS(v) } },
                  },
                  plugins: {
                    tooltip: {
                      backgroundColor: '#0C0D12',
                      borderColor: '#252636',
                      borderWidth: 1,
                      padding: 10,
                      titleColor: '#EEEEF0',
                      bodyColor: '#9496A8',
                      callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtTZSFull(ctx.raw)}` },
                    },
                  },
                }}
              />
            ) : (
              <p className="text-sm text-txt-3 py-8 text-center">No dated transactions to chart yet.</p>
            )}
          </div>

          <div className="lg:col-span-4 card-soft p-3 sm:p-5 lg:p-6 min-w-0">
            <div className="mb-5">
              <Eyebrow num="05">{t('dash.mix.eyebrow')}</Eyebrow>
              <h3 className="mt-2 text-sm sm:text-base font-semibold tracking-tight break-words">{t('dash.mix.title')}</h3>
            </div>
            {topCategories.length > 0 ? (
              <>
                <div className="relative">
                  <ChartJS
                    type="doughnut"
                    height={210}
                    data={{
                      labels: topCategories.map((c) => c.name),
                      datasets: [{
                        data: topCategories.map((c) => c.value),
                        backgroundColor: topCategories.map((c, i) => c.color || PALETTE[i % PALETTE.length]),
                        borderWidth: 0,
                        borderRadius: 4,
                      }],
                    }}
                    options={{
                      cutout: '70%',
                      plugins: {
                        tooltip: {
                          backgroundColor: '#0C0D12',
                          borderColor: '#252636',
                          borderWidth: 1,
                          padding: 10,
                          titleColor: '#EEEEF0',
                          bodyColor: '#9496A8',
                          callbacks: { label: (ctx) => `${ctx.label}: ${fmtTZSFull(ctx.raw)}` },
                        },
                      },
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="text-center">
                      <div className="text-[10px] uppercase tracking-ticker text-txt-3 font-mono">{t('dash.mix.total')}</div>
                      <div className="text-base font-bold tabular text-txt-1">
                        {fmtTZS(topCategories.reduce((s, c) => s + (c.value || 0), 0))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-5 space-y-2">
                  {topCategories.slice(0, 5).map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-xs group">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2 h-2 rounded-sm flex-shrink-0"
                          style={{ background: c.color || PALETTE[i % PALETTE.length] }}
                        />
                        <span className="text-txt-2 truncate group-hover:text-txt-1 transition-colors">{c.name}</span>
                      </div>
                      <span className="font-medium tabular text-txt-1">{fmtTZS(c.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-txt-3 py-8 text-center">No categorized spending yet.</p>
            )}
          </div>
        </div>
      </div>
      <SignOutConfirm />
    </AppShell>
  );
};

export default DashboardPage;
