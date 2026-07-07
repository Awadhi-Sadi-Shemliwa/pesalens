import React, { useEffect, useState } from 'react';
import { AppShell } from '../components/navigation';
import { Icon } from '../components/Icon';
import { Badge, Eyebrow } from '../components/common';
import { TiltCard } from '../components/motion';
import { useT } from '../data/i18n';
import { fetchDashboardSummary, fetchMarketSnapshot } from '../data/api';
import InvestmentSimulator from '../components/InvestmentSimulator';

/* ----------------------------------------------------------------
   Simulator — the personal investment-decision surface.

   Split out of the Markets page so planning tools live on their own
   clean page: the InvestmentSimulator ("Your starting point" hero +
   Step 1/2/3 decision wizard), followed by two reference blocks —
   allocation playbooks and insurance providers — and a disclaimer.

   The simulator needs BOTH the dashboard summary (cash-flow capacity)
   and the market snapshot (the investable asset universe), so this
   page pulls the same two feeds the Markets page used to, on the same
   5-minute cache cadence.
   ---------------------------------------------------------------- */

const STRATEGIES = [
  { title: 'Low-Risk Preservation', desc: 'Capital preservation via fixed deposits, government bonds, and money-market funds. Suits conservative profiles.', risk: 'Low',    color: 'inc', icon: 'shield' },
  { title: 'Balanced Growth',       desc: 'Mix of fixed income and equities for steady growth with moderate risk. Suits medium-term goals.',                     risk: 'Medium', color: 'exp', icon: 'chart' },
  { title: 'Aggressive Growth',     desc: 'Equity-heavy portfolio targeting high returns. Best for long time horizons.',                                          risk: 'High',   color: 'dng', icon: 'trending' },
  { title: 'Emergency Fund First',  desc: 'Build 3–6 months of expenses in liquid savings before investing.',                                                     risk: 'Low',    color: 'inc', icon: 'wallet' },
  { title: '50 / 30 / 20 Allocation', desc: 'Divide income across needs, wants and savings — a starter framework for cash-flow management.',                       risk: 'Low',    color: 'net', icon: 'zap' },
];

const INSURANCE = [
  { name: 'Jubilee Insurance',   type: 'Life & Health',   desc: 'Comprehensive life and health insurance products for individuals and families.' },
  { name: 'AAR Insurance',       type: 'Health',          desc: 'Leading health insurance provider with extensive hospital networks across Tanzania.' },
  { name: 'UAP Insurance',       type: 'General',         desc: 'Property, motor, and business insurance solutions for individuals and enterprises.' },
  { name: 'MetLife Tanzania',    type: 'Life & Savings',  desc: 'Life insurance and long-term savings plans with flexible premium structures.' },
];

/* Static tone map for the strategy chips — Tailwind's JIT can't see
   runtime `text-${x}` strings, so the tone-driven classes are spelled
   out here (a trimmed copy of the Markets page's TONE map). */
const TONE = {
  inc: { text: 'text-inc', bg: 'bg-inc/10' },
  exp: { text: 'text-exp', bg: 'bg-exp/10' },
  dng: { text: 'text-dng', bg: 'bg-dng/10' },
  net: { text: 'text-net', bg: 'bg-net/10' },
};

const SimulatorPage = () => {
  const { t } = useT();
  const [snapshot, setSnapshot] = useState(null);
  const [summary, setSummary] = useState(null);

  const load = async () => {
    try {
      const [snap, sum] = await Promise.all([
        fetchMarketSnapshot().catch(() => null),
        fetchDashboardSummary().catch(() => null),
      ]);
      setSnapshot(snap);
      setSummary(sum);
    } catch {
      /* the simulator and reference cards degrade gracefully on null */
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60 * 1000); // pull cache every 5 minutes
    return () => clearInterval(id);
  }, []);

  return (
    <AppShell>
      <div className="space-y-5 sm:space-y-6">
        {/* Header */}
        <div className="min-w-0">
          <Eyebrow num="00">{t('sim.page.eyebrow')}</Eyebrow>
          <h1 className="mt-2 text-xl sm:text-2xl lg:text-3xl font-semibold tracking-tight break-words">{t('sim.page.title')}</h1>
          <p className="text-xs sm:text-sm text-txt-2 mt-1.5 max-w-xl leading-relaxed">
            {t('sim.page.desc')}
          </p>
        </div>

        {/* ---- The decision wizard: starting point + Step 1/2/3 ---- */}
        <InvestmentSimulator summary={summary} snapshot={snapshot} />

        {/* ---- Reference: allocation playbooks ---- */}
        <div className="bento p-4 sm:p-5 lg:p-6">
          <div className="mb-4"><Eyebrow num="01">{t('mk.strategies.title')}</Eyebrow>
            <p className="text-[11px] text-txt-3 mt-1.5 font-mono uppercase tracking-ticker">Allocation playbooks</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {STRATEGIES.map((strategy) => (
              <TiltCard key={strategy.title} max={5} className="surface-inset border border-bdr/50 rounded-xl p-3 sm:p-4 min-w-0">
                <div className="flex items-start justify-between mb-3 gap-2">
                  <div className={`p-2 rounded-lg flex-shrink-0 ${TONE[strategy.color].bg}`}>
                    <Icon name={strategy.icon} size={16} className={TONE[strategy.color].text} />
                  </div>
                  <Badge color={strategy.risk === 'Low' ? 'income' : strategy.risk === 'Medium' ? 'expense' : 'danger'} className="flex-shrink-0">{strategy.risk} Risk</Badge>
                </div>
                <h4 className="font-semibold text-sm mb-1.5 break-words">{strategy.title}</h4>
                <p className="text-xs text-txt-2 leading-relaxed">{strategy.desc}</p>
              </TiltCard>
            ))}
          </div>
        </div>

        {/* ---- Reference: insurance providers ---- */}
        <div className="bento p-4 sm:p-5 lg:p-6">
          <div className="mb-4"><Eyebrow num="02">{t('mk.cover.title')}</Eyebrow>
            <p className="text-[11px] text-txt-3 mt-1.5 font-mono uppercase tracking-ticker">Insurance providers</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
            {INSURANCE.map((provider) => (
              <div key={provider.name} className="surface-inset border border-bdr/50 rounded-xl p-3 sm:p-4 min-w-0">
                <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                  <h4 className="font-semibold text-sm min-w-0 break-words">{provider.name}</h4>
                  <Badge color="muted" className="flex-shrink-0">{provider.type}</Badge>
                </div>
                <p className="text-xs text-txt-2 leading-relaxed">{provider.desc}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-txt-3">
            Listed for reference — PesaLens is not affiliated with any provider and does not earn commission.
          </p>
        </div>

        {/* ---- Disclaimer ---- */}
        <div className="bento p-3 sm:p-5 lg:p-6 border border-dng/20 bg-dng/5">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-dng/15 text-dng flex-shrink-0">
              <Icon name="alert" size={16} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-txt-1">Not financial advice</h3>
              <p className="text-xs sm:text-sm text-txt-2 mt-1 leading-relaxed break-words">
                {snapshot?.disclaimer || (
                  <>
                    The projections and explanations on this page are educational summaries based on your statements and
                    public market sources, and are NOT financial advice. For investment, tax, or insurance decisions,
                    consult a CMSA-licensed advisor in Tanzania (or a similarly certified professional in your country) so
                    any future misunderstandings are avoided. PesaLens does not earn commission from any provider listed.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
};

export default SimulatorPage;
