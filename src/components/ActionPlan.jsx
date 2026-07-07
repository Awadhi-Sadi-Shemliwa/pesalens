import React, { useMemo } from 'react';
import { Icon } from './Icon';
import { Eyebrow } from './common';
import { TiltCard } from './motion';
import { buildActionPlan, fmtTZS } from '../data/decisions';
import { useT, AutoT } from '../data/i18n';

/* ================================================================
   Action engine — glassmorphic BENTO edition.
   Red = money leaking out · Green = money you keep / can win.
   The colour + arrow language is the whole point: a glance tells you
   what's bleeding and what's winning before you read a word.
   Data + i18n keys unchanged (buildActionPlan(summary)).
   ================================================================ */

const SEVERITY = {
  critical: { chip: 'bg-dng/15 text-dng border-dng/30', glow: 'rgb(var(--c-dng) / 0.35)', ring: 'border-dng/30', label: 'common.critical' },
  warning:  { chip: 'bg-exp/15 text-exp border-exp/30', glow: 'rgb(var(--c-exp) / 0.30)', ring: 'border-exp/30', label: 'common.warning' },
  notice:   { chip: 'bg-net/15 text-net border-net/30', glow: 'rgb(var(--c-net) / 0.28)', ring: 'border-net/30', label: 'common.notice' },
};

/* Small red/green symbol chip — the shared visual token. */
const FlowSymbol = ({ dir }) => {
  const leak = dir === 'leak';
  return (
    <span
      className={`inline-flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0 border ${
        leak ? 'bg-dng/12 border-dng/30 text-dng' : 'bg-inc/12 border-inc/30 text-inc'
      }`}
    >
      <Icon name={leak ? 'arrowDownRight' : 'arrowUpRight'} size={16} />
    </span>
  );
};

/* ----------------------------------------------------------------
   Verdict hero — glass panel with a red/green cashflow bar + KPI tiles
   ---------------------------------------------------------------- */
const Hero = ({ flow, mistakeCount, oppCount, t }) => {
  const headline = (() => {
    if (flow.monthlySurplus < 0)        return t('act.hero.deficit');
    if (flow.savingsRate < 10)          return t('act.hero.tight');
    if (mistakeCount === 0 && flow.savingsRate >= 20) return t('act.hero.strong');
    if (mistakeCount === 0)             return t('act.hero.healthy');
    return t('act.hero.tight');
  })();

  const surplusPos = flow.monthlySurplus >= 0;
  const inAmt = Math.max(0, flow.monthlyIn || 0);
  const outPct = inAmt > 0 ? Math.min(100, ((flow.monthlyOut || 0) / inAmt) * 100) : 100;
  const keptPct = Math.max(0, 100 - outPct);

  const tiles = [
    { label: t('act.kpi.surplus'), value: fmtTZS(flow.monthlySurplus), dir: surplusPos ? 'win' : 'leak', tone: surplusPos ? 'text-inc' : 'text-dng' },
    { label: t('act.kpi.savings'), value: `${flow.savingsRate.toFixed(1)}%`, sub: t('act.kpi.savings.bench'), dir: flow.savingsRate >= 20 ? 'win' : 'leak', tone: 'text-txt-1' },
    { label: t('act.kpi.mistakes'), value: mistakeCount, dir: 'leak', tone: 'text-dng' },
    { label: t('act.kpi.wins'), value: oppCount, dir: 'win', tone: 'text-inc' },
  ];

  return (
    <TiltCard max={2} className="glass-pane rounded-[22px] p-5 sm:p-6 lg:p-7 relative overflow-hidden">
      <div className="absolute -right-24 -top-24 w-72 h-72 rounded-full blur-3xl pointer-events-none"
           style={{ background: surplusPos ? 'rgb(var(--c-inc) / 0.12)' : 'rgb(var(--c-dng) / 0.12)' }} />
      <div className="relative">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <Eyebrow>{t('act.eyebrow')}</Eyebrow>
            <h2 className="mt-2 text-lg sm:text-xl lg:text-2xl font-semibold tracking-tight break-words">{t('act.title')}</h2>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/10 border border-accent/25 text-accent text-[10px] font-mono uppercase tracking-ticker flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-accent anim-pulse-soft" />
            {t('act.badge')}
          </span>
        </div>

        <p className="text-sm sm:text-base text-txt-1 leading-relaxed max-w-2xl break-words">{headline}</p>
        <p className="text-xs sm:text-sm text-txt-3 leading-relaxed mt-1.5 mb-5 max-w-2xl break-words">{t('act.lede')}</p>

        {/* Red/green cashflow bar — the symbol of "what's happening" */}
        <div className="mb-5">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-ticker mb-1.5">
            <span className="text-dng inline-flex items-center gap-1"><Icon name="arrowDownRight" size={11} />{t('common.moneyOut')} · {outPct.toFixed(0)}%</span>
            <span className="text-inc inline-flex items-center gap-1">{keptPct.toFixed(0)}% {t('act.kpi.surplus')}<Icon name="arrowUpRight" size={11} /></span>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden flex bg-surface-4">
            <div className="h-full" style={{ width: `${outPct}%`, background: 'rgb(var(--c-dng))', boxShadow: '0 0 12px rgb(var(--c-dng) / 0.5)' }} />
            <div className="h-full" style={{ width: `${keptPct}%`, background: 'rgb(var(--c-inc))', boxShadow: '0 0 12px rgb(var(--c-inc) / 0.5)' }} />
          </div>
        </div>

        {/* KPI micro-tiles (glass) with red/green symbols */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {tiles.map((tile) => (
            <div key={tile.label} className="glass rounded-xl p-3 sm:p-3.5 border border-bdr/60 flex items-start gap-2.5">
              <FlowSymbol dir={tile.dir} />
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-ticker text-txt-3 font-mono truncate">{tile.label}</div>
                <div className={`mt-0.5 text-base sm:text-xl font-bold tabular break-all ${tile.tone}`}>{tile.value}</div>
                {tile.sub && <div className="text-[10px] text-txt-3">{tile.sub}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </TiltCard>
  );
};

/* ----------------------------------------------------------------
   Leak / Win card — glassmorphic, stacked (fits a 2-col bento).
   ---------------------------------------------------------------- */
const FlowCard = ({ item, idx, kind, t }) => {
  const leak = kind === 'leak';
  const sev = leak ? (SEVERITY[item.severity] || SEVERITY.notice) : null;
  const amount = leak ? item.cost : item.impact;
  const glow = leak ? (sev.glow) : 'rgb(var(--c-inc) / 0.32)';
  const ring = leak ? sev.ring : 'border-inc/30';
  const fixText = leak ? item.fix : item.action;
  const fixLabel = leak ? t('act.fix.label') : t('act.win.label');
  const fixIcon = leak ? 'zap' : 'check';

  return (
    <TiltCard max={5} className={`glass rounded-2xl border ${ring} p-4 sm:p-5 relative overflow-hidden h-full`}
              style={{ boxShadow: `0 8px 28px -14px ${glow}` }}>
      <span aria-hidden className="absolute -left-8 -top-8 w-32 h-32 rounded-full blur-2xl pointer-events-none"
            style={{ background: glow }} />
      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <FlowSymbol dir={kind} />
            <span className="text-[10px] uppercase tracking-ticker text-txt-3 font-mono">#{String(idx + 1).padStart(2, '0')}</span>
          </div>
          <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-ticker font-semibold px-2 py-0.5 rounded border ${leak ? sev.chip : 'bg-inc/15 text-inc border-inc/30'}`}>
            <Icon name={leak ? 'alert' : 'trending'} size={10} />
            {leak ? t(sev.label) : t('act.opps.potential')}
          </span>
        </div>

        {amount > 0 && (
          <div className="mb-3">
            <div className={`text-2xl sm:text-3xl font-bold tabular leading-tight break-all ${leak ? 'text-dng' : 'text-inc'}`}>
              {leak ? '−' : '+'}{fmtTZS(amount)}
            </div>
            <div className="text-[11px] text-txt-3 mt-0.5">{leak ? t('act.cost.monthly') : t('act.gain.year')}</div>
          </div>
        )}

        <h3 className="text-[15px] sm:text-base font-semibold text-txt-1 leading-snug mb-1.5 break-words">
          <AutoT>{item.title}</AutoT>
        </h3>
        <p className="text-[13px] text-txt-2 leading-relaxed mb-3.5 break-words">
          <AutoT>{item.body}</AutoT>
        </p>

        {fixText && (
          <div className={`rounded-xl border p-3 ${leak ? 'border-accent/25 bg-accent/5' : 'border-inc/25 bg-inc/5'}`}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`p-1 rounded-md ${leak ? 'bg-accent/15 text-accent' : 'bg-inc/15 text-inc'}`}>
                <Icon name={fixIcon} size={12} />
              </span>
              <span className={`text-[10px] uppercase tracking-ticker font-semibold ${leak ? 'text-accent' : 'text-inc'}`}>{fixLabel}</span>
            </div>
            <p className="text-[13px] text-txt-1 leading-relaxed break-words"><AutoT>{fixText}</AutoT></p>
          </div>
        )}
      </div>
    </TiltCard>
  );
};

/* ----------------------------------------------------------------
   Column header (red for leaks, green for wins).
   ---------------------------------------------------------------- */
const ColumnHead = ({ icon, title, lede, count, tone }) => {
  const leak = tone === 'leak';
  return (
    <div className="flex items-start gap-3 mb-4">
      <span className={`p-2.5 rounded-xl border flex-shrink-0 ${leak ? 'bg-dng/10 border-dng/25 text-dng' : 'bg-inc/10 border-inc/25 text-inc'}`}>
        <Icon name={icon} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-base sm:text-lg font-semibold tracking-tight break-words">{title}</h3>
          {count != null && (
            <span className={`text-[11px] tabular px-2 py-0.5 rounded-full border ${leak ? 'bg-dng/10 border-dng/25 text-dng' : 'bg-inc/10 border-inc/25 text-inc'}`}>{count}</span>
          )}
        </div>
        <p className="text-xs text-txt-3 leading-relaxed break-words mt-0.5">{lede}</p>
      </div>
    </div>
  );
};

/* ----------------------------------------------------------------
   30-day plan — glass timeline card.
   ---------------------------------------------------------------- */
const PlanStep = ({ step, idx, total }) => (
  <div className="flex gap-3 sm:gap-4">
    <div className="flex flex-col items-center flex-shrink-0">
      <div className="w-9 h-9 rounded-full border-2 border-accent/40 bg-accent/10 text-accent flex items-center justify-center text-sm font-bold tabular">{idx + 1}</div>
      {idx < total - 1 && <div className="w-0.5 flex-1 bg-bdr/50 mt-2" />}
    </div>
    <div className="flex-1 min-w-0 pb-6">
      <div className="text-[10px] uppercase tracking-ticker text-accent font-mono mb-1 font-semibold"><AutoT>{step.when}</AutoT></div>
      <h4 className="text-[15px] sm:text-base font-semibold text-txt-1 mb-1.5 leading-snug break-words"><AutoT>{step.title}</AutoT></h4>
      <p className="text-[13px] text-txt-2 leading-relaxed break-words"><AutoT>{step.detail}</AutoT></p>
    </div>
  </div>
);

/* ----------------------------------------------------------------
   Main component
   ---------------------------------------------------------------- */
const ActionPlan = ({ summary }) => {
  const { t } = useT();
  const result = useMemo(() => buildActionPlan(summary), [summary]);
  const { mistakes, opportunities, plan, flow } = result;

  if (!mistakes.length && !opportunities.length) return null;

  return (
    <div className="space-y-4 sm:space-y-5">
      <Hero flow={flow} mistakeCount={mistakes.length} oppCount={opportunities.length} t={t} />

      {/* ---- Leaks vs Wins — two-column bento ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        {mistakes.length > 0 && (
          <section className="min-w-0">
            <ColumnHead
              icon="alert" tone="leak"
              title={t('act.section.mistakes.title')}
              lede={t('act.section.mistakes.lede')}
              count={mistakes.length}
            />
            <div className="space-y-4">
              {mistakes.map((item, i) => <FlowCard key={i} item={item} idx={i} kind="leak" t={t} />)}
            </div>
          </section>
        )}

        {opportunities.length > 0 && (
          <section className="min-w-0">
            <ColumnHead
              icon="trending" tone="win"
              title={t('act.section.opps.title')}
              lede={t('act.section.opps.lede')}
              count={opportunities.length}
            />
            <div className="space-y-4">
              {opportunities.map((item, i) => <FlowCard key={i} item={item} idx={i} kind="win" t={t} />)}
            </div>
          </section>
        )}
      </div>

      {/* ---- 30-day plan + CTA — bento row ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
        {plan.length > 0 && (
          <div className="lg:col-span-7 glass rounded-2xl border border-bdr/60 p-5 sm:p-6">
            <div className="flex items-start gap-3 mb-5">
              <span className="p-2.5 rounded-xl border bg-accent/10 border-accent/25 text-accent flex-shrink-0">
                <Icon name="play" size={18} />
              </span>
              <div className="min-w-0">
                <h3 className="text-base sm:text-lg font-semibold tracking-tight">{t('act.section.plan.title')}</h3>
                <p className="text-xs text-txt-3 leading-relaxed mt-0.5 break-words">{t('act.section.plan.lede')}</p>
              </div>
            </div>
            {plan.map((step, i) => <PlanStep key={i} step={step} idx={i} total={plan.length} />)}
          </div>
        )}

        <TiltCard max={4} className={`glass rounded-2xl border border-accent/25 p-5 sm:p-6 relative overflow-hidden ${plan.length > 0 ? 'lg:col-span-5' : 'lg:col-span-12'}`}>
          <span aria-hidden className="absolute -right-10 -top-10 w-40 h-40 rounded-full blur-3xl bg-accent/12 pointer-events-none" />
          <div className="relative flex flex-col h-full">
            <span className="p-3 rounded-xl bg-accent/15 text-accent w-fit mb-4"><Icon name="sparkles" size={22} /></span>
            <h3 className="text-lg sm:text-xl font-semibold tracking-tight mb-2 break-words">{t('act.cta.title')}</h3>
            <p className="text-sm text-txt-2 leading-relaxed mb-5 break-words">{t('act.cta.body')}</p>
            <button
              onClick={() => { window.location.hash = '/markets'; }}
              className="btn-primary px-4 py-2.5 rounded-lg text-sm font-medium inline-flex items-center gap-2 w-fit mt-auto"
            >
              {t('act.cta.button')} <Icon name="arrowRight" size={14} />
            </button>
          </div>
        </TiltCard>
      </div>
    </div>
  );
};

export default ActionPlan;
