import React, { useMemo } from 'react';
import { Icon } from './Icon';
import { Eyebrow, Badge } from './common';
import { buildActionPlan, fmtTZS } from '../data/decisions';
import { useT, AutoT } from '../data/i18n';

/* ----------------------------------------------------------------
   Action engine — Top mistakes, top opportunities, 30-day plan.
   ----------------------------------------------------------------
   Layout decisions:
     • Linear, full-width vertical scroll. The previous tabbed view
       hid two-thirds of the value behind a click — most users
       never visited the plan tab. Scrolling beats clicking when
       every card matters.
     • Each mistake / opportunity is a wide card with a coloured
       severity stripe, a giant TZS impact number, the explanation,
       and a clear "How to fix" footer. The point is to make the
       "do this" feel as important as the "what is wrong".
     • Mobile-first: single column, big tap targets, body text at
       least 14px. Three-up KPI strips stay 2-up on phones.
   ---------------------------------------------------------------- */

const SEVERITY = {
  critical: { stripe: '#EF4444', label: 'common.critical', chip: 'bg-dng/15 text-dng border-dng/30', glow: 'rgba(239,68,68,0.35)', icon: 'alert' },
  warning:  { stripe: '#F59E0B', label: 'common.warning',  chip: 'bg-exp/15 text-exp border-exp/30', glow: 'rgba(245,158,11,0.30)', icon: 'alert' },
  notice:   { stripe: '#06B6D4', label: 'common.notice',   chip: 'bg-net/15 text-net border-net/30', glow: 'rgba(6,182,212,0.30)',  icon: 'sparkles' },
};

/* ----------------------------------------------------------------
   Hero — one-sentence summary tuned to the user's actual state.
   ---------------------------------------------------------------- */
const Hero = ({ flow, mistakeCount, oppCount, t }) => {
  const headline = (() => {
    if (flow.monthlySurplus < 0)        return t('act.hero.deficit');
    if (flow.savingsRate < 10)          return t('act.hero.tight');
    if (mistakeCount === 0 && flow.savingsRate >= 20) return t('act.hero.strong');
    if (mistakeCount === 0)             return t('act.hero.healthy');
    return t('act.hero.tight');
  })();

  const surplusTone = flow.monthlySurplus >= 0 ? 'text-inc' : 'text-dng';

  return (
    <section className="card-soft p-4 sm:p-6 lg:p-8 relative overflow-hidden">
      <div className="absolute -right-20 -top-20 w-64 h-64 bg-accent/10 rounded-full blur-3xl pointer-events-none" />
      <div className="relative">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-5 sm:mb-6">
          <div className="min-w-0 flex-1">
            <Eyebrow>{t('act.eyebrow')}</Eyebrow>
            <h2 className="mt-2.5 text-lg sm:text-xl lg:text-2xl font-semibold tracking-tight break-words">
              {t('act.title')}
            </h2>
          </div>
          <Badge color="accent" dot className="self-start flex-shrink-0">{t('act.badge')}</Badge>
        </div>

        <p className="text-sm sm:text-base text-txt-1 leading-relaxed mb-2 max-w-2xl break-words">
          {headline}
        </p>
        <p className="text-xs sm:text-sm text-txt-3 leading-relaxed mb-5 sm:mb-6 max-w-2xl break-words">
          {t('act.lede')}
        </p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="surface-inset rounded-xl p-3 sm:p-4">
            <div className="text-[10px] sm:text-[11px] uppercase tracking-ticker text-txt-3 font-mono">
              {t('act.kpi.surplus')}
            </div>
            <div className={`mt-1 text-lg sm:text-2xl font-bold tabular break-all ${surplusTone}`}>
              {fmtTZS(flow.monthlySurplus)}
            </div>
          </div>
          <div className="surface-inset rounded-xl p-3 sm:p-4">
            <div className="text-[10px] sm:text-[11px] uppercase tracking-ticker text-txt-3 font-mono">
              {t('act.kpi.savings')}
            </div>
            <div className="mt-1 text-lg sm:text-2xl font-bold tabular text-txt-1">
              {flow.savingsRate.toFixed(1)}%
            </div>
            <div className="text-[10px] text-txt-3 mt-0.5">{t('act.kpi.savings.bench')}</div>
          </div>
          <div className="surface-inset rounded-xl p-3 sm:p-4">
            <div className="text-[10px] sm:text-[11px] uppercase tracking-ticker text-txt-3 font-mono">
              {t('act.kpi.mistakes')}
            </div>
            <div className="mt-1 text-lg sm:text-2xl font-bold tabular text-exp">{mistakeCount}</div>
          </div>
          <div className="surface-inset rounded-xl p-3 sm:p-4">
            <div className="text-[10px] sm:text-[11px] uppercase tracking-ticker text-txt-3 font-mono">
              {t('act.kpi.wins')}
            </div>
            <div className="mt-1 text-lg sm:text-2xl font-bold tabular text-inc">{oppCount}</div>
          </div>
        </div>
      </div>
    </section>
  );
};

/* ----------------------------------------------------------------
   MistakeCard — wide, full-bleed, with prominent monthly cost.
   ---------------------------------------------------------------- */
const MistakeCard = ({ item, idx, t }) => {
  const sev = SEVERITY[item.severity] || SEVERITY.notice;
  return (
    <article
      className="rounded-2xl border border-bdr/60 bg-surface-2 overflow-hidden flex flex-col sm:flex-row"
      style={{ boxShadow: `0 6px 22px -10px ${sev.glow}` }}
    >
      {/* Severity stripe — full bar on mobile, vertical strip on tablet+ */}
      <div
        className="h-1.5 sm:h-auto sm:w-1.5 flex-shrink-0"
        style={{ background: sev.stripe, boxShadow: `0 0 18px ${sev.glow}` }}
      />

      <div className="p-4 sm:p-5 lg:p-6 flex-1 min-w-0">
        <div className="flex flex-col lg:flex-row lg:items-start lg:gap-6">
          {/* Big monthly-cost number — leads the card */}
          <div className="flex-shrink-0 mb-4 lg:mb-0 lg:min-w-[180px]">
            <div className="text-[10px] uppercase tracking-ticker text-txt-3 font-mono mb-1">
              #{String(idx + 1).padStart(2, '0')}
            </div>
            {item.cost > 0 && (
              <>
                <div className="text-2xl sm:text-3xl lg:text-4xl font-bold tabular text-txt-1 leading-tight break-all">
                  −{fmtTZS(item.cost)}
                </div>
                <div className="text-[11px] text-txt-3 mt-1">{t('act.cost.monthly')}</div>
              </>
            )}
            <span className={`inline-flex items-center gap-1 mt-3 text-[10px] uppercase tracking-ticker font-semibold px-2 py-0.5 rounded border ${sev.chip}`}>
              <Icon name={sev.icon} size={10} />
              {t(sev.label)}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="text-base sm:text-lg font-semibold text-txt-1 leading-snug mb-2 break-words">
              <AutoT>{item.title}</AutoT>
            </h3>
            <p className="text-sm text-txt-2 leading-relaxed mb-4 break-words">
              <AutoT>{item.body}</AutoT>
            </p>
            {item.fix && (
              <div className="rounded-xl border border-accent/25 bg-accent/5 p-3 sm:p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="p-1 rounded-md bg-accent/15 text-accent">
                    <Icon name="zap" size={12} />
                  </div>
                  <span className="text-[10px] uppercase tracking-ticker font-semibold text-accent">
                    {t('act.fix.label')}
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-txt-1 leading-relaxed break-words">
                  <AutoT>{item.fix}</AutoT>
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
};

/* ----------------------------------------------------------------
   OpportunityCard — green-leaning, with prominent annual gain.
   ---------------------------------------------------------------- */
const OpportunityCard = ({ item, idx, t }) => (
  <article
    className="rounded-2xl border border-inc/25 bg-surface-2 overflow-hidden flex flex-col sm:flex-row"
    style={{ boxShadow: '0 6px 22px -10px rgba(16,185,129,0.30)' }}
  >
    <div className="h-1.5 sm:h-auto sm:w-1.5 bg-inc flex-shrink-0" style={{ boxShadow: '0 0 18px rgba(16,185,129,0.35)' }} />
    <div className="p-4 sm:p-5 lg:p-6 flex-1 min-w-0">
      <div className="flex flex-col lg:flex-row lg:items-start lg:gap-6">
        <div className="flex-shrink-0 mb-4 lg:mb-0 lg:min-w-[180px]">
          <div className="text-[10px] uppercase tracking-ticker text-txt-3 font-mono mb-1">
            #{String(idx + 1).padStart(2, '0')}
          </div>
          {item.impact > 0 && (
            <>
              <div className="text-2xl sm:text-3xl lg:text-4xl font-bold tabular text-inc leading-tight break-all">
                +{fmtTZS(item.impact)}
              </div>
              <div className="text-[11px] text-txt-3 mt-1">{t('act.gain.year')}</div>
            </>
          )}
          <span className="inline-flex items-center gap-1 mt-3 text-[10px] uppercase tracking-ticker font-semibold px-2 py-0.5 rounded border bg-inc/15 text-inc border-inc/30">
            <Icon name="trending" size={10} />
            {t('act.opps.potential')}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-base sm:text-lg font-semibold text-txt-1 leading-snug mb-2 break-words">
            <AutoT>{item.title}</AutoT>
          </h3>
          <p className="text-sm text-txt-2 leading-relaxed mb-4 break-words">
            <AutoT>{item.body}</AutoT>
          </p>
          {item.action && (
            <div className="rounded-xl border border-inc/25 bg-inc/5 p-3 sm:p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="p-1 rounded-md bg-inc/15 text-inc">
                  <Icon name="check" size={12} />
                </div>
                <span className="text-[10px] uppercase tracking-ticker font-semibold text-inc">
                  {t('act.win.label')}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-txt-1 leading-relaxed break-words">
                <AutoT>{item.action}</AutoT>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  </article>
);

/* ----------------------------------------------------------------
   PlanStep — vertical timeline entry.
   ---------------------------------------------------------------- */
const PlanStep = ({ step, idx, total }) => (
  <div className="flex gap-3 sm:gap-4">
    <div className="flex flex-col items-center flex-shrink-0">
      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full border-2 border-accent/40 bg-accent/10 text-accent flex items-center justify-center text-sm sm:text-base font-bold tabular shadow-sm">
        {idx + 1}
      </div>
      {idx < total - 1 && <div className="w-0.5 flex-1 bg-bdr/50 mt-2" />}
    </div>
    <div className="flex-1 min-w-0 pb-6 sm:pb-7">
      <div className="text-[10px] uppercase tracking-ticker text-accent font-mono mb-1.5 font-semibold">
        <AutoT>{step.when}</AutoT>
      </div>
      <h4 className="text-base sm:text-lg font-semibold text-txt-1 mb-2 leading-snug break-words">
        <AutoT>{step.title}</AutoT>
      </h4>
      <p className="text-sm text-txt-2 leading-relaxed break-words">
        <AutoT>{step.detail}</AutoT>
      </p>
    </div>
  </div>
);

/* ----------------------------------------------------------------
   Section header — used for all three sections.
   ---------------------------------------------------------------- */
const SectionHeader = ({ icon, title, lede, count, color = 'accent' }) => {
  const colors = {
    accent:  { bg: 'bg-accent/10 border-accent/25 text-accent', dot: 'bg-accent' },
    expense: { bg: 'bg-exp/10 border-exp/25 text-exp',          dot: 'bg-exp'    },
    income:  { bg: 'bg-inc/10 border-inc/25 text-inc',          dot: 'bg-inc'    },
    danger:  { bg: 'bg-dng/10 border-dng/25 text-dng',          dot: 'bg-dng'    },
  };
  const c = colors[color] || colors.accent;
  return (
    <div className="flex items-start gap-3 sm:gap-4 mb-4 sm:mb-5">
      <div className={`p-2.5 sm:p-3 rounded-xl border flex-shrink-0 ${c.bg}`}>
        <Icon name={icon} size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-lg sm:text-xl lg:text-2xl font-semibold tracking-tight break-words">
            {title}
          </h2>
          {count != null && (
            <span className={`text-[11px] tabular px-2 py-0.5 rounded-full border ${c.bg}`}>
              {count}
            </span>
          )}
        </div>
        <p className="text-xs sm:text-sm text-txt-3 leading-relaxed max-w-2xl break-words">
          {lede}
        </p>
      </div>
    </div>
  );
};

/* ----------------------------------------------------------------
   Main component
   ---------------------------------------------------------------- */
const ActionPlan = ({ summary }) => {
  const { t } = useT();
  const result = useMemo(() => buildActionPlan(summary), [summary]);
  const { mistakes, opportunities, plan, flow } = result;

  // Show nothing if neither flag fired — the dashboard already has
  // its KPIs above. Padding the page with empty state cards is noise.
  if (!mistakes.length && !opportunities.length) return null;

  return (
    <div className="space-y-5 sm:space-y-7">
      <Hero
        flow={flow}
        mistakeCount={mistakes.length}
        oppCount={opportunities.length}
        t={t}
      />

      {/* ---- Mistakes section ---- */}
      {mistakes.length > 0 && (
        <section>
          <SectionHeader
            icon="alert"
            title={t('act.section.mistakes.title')}
            lede={t('act.section.mistakes.lede')}
            count={mistakes.length}
            color="expense"
          />
          <div className="space-y-3 sm:space-y-4">
            {mistakes.map((item, i) => <MistakeCard key={i} item={item} idx={i} t={t} />)}
          </div>
        </section>
      )}

      {/* ---- Opportunities section ---- */}
      {opportunities.length > 0 && (
        <section>
          <SectionHeader
            icon="trending"
            title={t('act.section.opps.title')}
            lede={t('act.section.opps.lede')}
            count={opportunities.length}
            color="income"
          />
          <div className="space-y-3 sm:space-y-4">
            {opportunities.map((item, i) => <OpportunityCard key={i} item={item} idx={i} t={t} />)}
          </div>
        </section>
      )}

      {/* ---- 30-day plan section ---- */}
      {plan.length > 0 && (
        <section>
          <SectionHeader
            icon="play"
            title={t('act.section.plan.title')}
            lede={t('act.section.plan.lede')}
            count={plan.length}
            color="accent"
          />
          <div className="card-soft p-4 sm:p-6 lg:p-8">
            {plan.map((step, i) => <PlanStep key={i} step={step} idx={i} total={plan.length} />)}
          </div>
        </section>
      )}

      {/* ---- CTA to simulator ---- */}
      <section className="rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/8 to-transparent p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 items-start">
          <div className="p-3 rounded-xl bg-accent/15 text-accent flex-shrink-0">
            <Icon name="sparkles" size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg sm:text-xl font-semibold tracking-tight mb-2 break-words">
              {t('act.cta.title')}
            </h3>
            <p className="text-sm text-txt-2 leading-relaxed mb-4 max-w-2xl break-words">
              {t('act.cta.body')}
            </p>
            <button
              onClick={() => { window.location.hash = '/markets'; }}
              className="btn-primary px-4 py-2.5 rounded-lg text-sm font-medium inline-flex items-center gap-2"
            >
              {t('act.cta.button')} <Icon name="arrowRight" size={14} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default ActionPlan;
