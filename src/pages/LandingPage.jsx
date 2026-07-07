import React, { useState, useEffect } from 'react';
import { Link } from '../components/Router';
import { PublicNav } from '../components/navigation';
import { Icon } from '../components/Icon';
import { Eyebrow, FadeIn, Sparkline, Mark, CountUp } from '../components/common';
import { TiltCard, CoinField, CashflowRiver } from '../components/motion';
import DownloadAPK from '../components/DownloadAPK';
import { useT, AutoT } from '../data/i18n';
import { fetchPublicTicker } from '../data/api';

/* Deterministic mini-series so charts don't jitter on every render */
const SERIES = {
  in:   [820, 940, 905, 1100, 1240, 1180, 1320, 1410, 1380, 1505, 1620, 1580],
  out:  [610, 580, 720, 660, 790, 700, 830, 760, 900, 820, 940, 880],
  net:  [210, 360, 185, 440, 450, 480, 490, 650, 480, 685, 680, 700],
};

/* Fallback shown only while the live ticker is loading or if the
   backend is unreachable — keeps the marquee from looking empty on
   first paint. Replaced as soon as /api/markets/ticker responds. */
const TICKER_FALLBACK = [
  { sym: 'CRDB',    val: '2 700',   pct: 3.45,  kind: 'stock' },
  { sym: 'NMB',     val: '4 600',   pct: -0.6,  kind: 'stock' },
  { sym: 'USD/TZS', val: '2 608',   pct: null,  kind: 'fx' },
  { sym: 'EUR/TZS', val: '3 057',   pct: null,  kind: 'fx' },
  { sym: 'BTC',     val: '$76,146', pct: -2.05, kind: 'crypto' },
  { sym: 'ETH',     val: '$2,269',  pct: -1.95, kind: 'crypto' },
  { sym: 'S&P 500', val: '7 174',   pct: 0.91,  kind: 'index' },
];

const formatPct = (pct) => {
  if (pct == null || Number.isNaN(Number(pct))) return null;
  const n = Number(pct);
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
};

/* Compact TZS formatter for hero count-ups (2 620 000 -> "2.62M") */
const compact = (v) => {
  const n = Number(v) || 0;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
};

const LandingPage = () => {
  const [heroVis, setHeroVis] = useState(false);
  const [ticker, setTicker] = useState(TICKER_FALLBACK);
  const { t } = useT();
  useEffect(() => {
    const tm = setTimeout(() => setHeroVis(true), 80);
    return () => clearTimeout(tm);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const items = await fetchPublicTicker();
      if (alive && items.length) setTicker(items);
    };
    load();
    const id = setInterval(load, 5 * 60 * 1000); // refresh every 5 min
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <div className="min-h-screen bg-deep overflow-hidden">
      <PublicNav />

      {/* ----------------------------------------------------------- HERO */}
      <section className="relative pt-28 pb-14 lg:pt-36 lg:pb-20">
        {/* Living background: coins drifting up + brand glow + faint grid */}
        <div className="absolute inset-0 pointer-events-none">
          <CoinField className="absolute inset-0" density={30} />
          <div className="hero-glow bg-accent" style={{ top: '-6%', left: '6%' }} />
          <div className="hero-glow bg-net" style={{ top: '18%', right: '2%', opacity: 0.12 }} />
          <div className="absolute inset-0 grid-faint opacity-50" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            {/* Hero copy — 6 cols */}
            <div className="lg:col-span-6">
              <div
                className={`transition-all duration-700 ${
                  heroVis ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                }`}
              >
                <Eyebrow>{t('land.eyebrow')}</Eyebrow>
              </div>

              <h1
                className={`mt-5 sm:mt-6 text-[34px] sm:text-6xl lg:text-[76px] leading-[1.02] sm:leading-[0.95] font-semibold tracking-tightest text-txt-1 break-words transition-all duration-700 delay-75 ${
                  heroVis ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
                }`}
              >
                {t('land.title.l1')}
                <br />
                <span className="font-serif-i text-txt-2">{t('land.title.like')}</span>{' '}
                <span className="gradient-text">{t('land.title.l2')}</span>
              </h1>

              <p
                className={`mt-6 text-base sm:text-lg text-txt-2 max-w-xl leading-relaxed transition-all duration-700 delay-150 ${
                  heroVis ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
                }`}
              >
                {t('land.lede')}
              </p>

              <div
                className={`mt-8 flex flex-col sm:flex-row gap-3 transition-all duration-700 delay-200 ${
                  heroVis ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
                }`}
              >
                <Link
                  to="/signup"
                  className="btn-primary px-6 py-3 rounded-xl text-[15px] font-semibold inline-flex items-center justify-center gap-2"
                >
                  {t('land.startTrial')}
                  <Icon name="arrowRight" size={16} />
                </Link>
                <Link
                  to="/signin"
                  className="btn-secondary px-6 py-3 rounded-xl text-[15px] font-semibold inline-flex items-center justify-center gap-2"
                >
                  {t('nav.signin')}
                </Link>
                <DownloadAPK variant="ghost" />
              </div>

              {/* Trust chips */}
              <div
                className={`mt-9 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-txt-3 transition-all duration-700 delay-300 ${
                  heroVis ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent anim-pulse-soft" />
                  {t('land.systemOk')}
                </span>
                <span>{t('land.trial')}</span>
              </div>
            </div>

            {/* Hero bento cluster — 6 cols. A living "money OS" snapshot. */}
            <div
              className={`lg:col-span-6 transition-all duration-1000 delay-300 ${
                heroVis ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
              }`}
            >
              <div className="relative">
                <div className="absolute -inset-4 bg-gradient-to-br from-accent/15 via-net/8 to-transparent rounded-[32px] blur-2xl" />

                <div className="relative grid grid-cols-2 gap-3 sm:gap-4">
                  {/* Big net-flow tile (spans both cols) */}
                  <TiltCard glare max={7} className="col-span-2 surface-hero rounded-[22px] p-5 lg:p-6 relative overflow-hidden">
                    <div className="flex items-center justify-between mb-4 relative z-10">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-accent anim-pulse-soft" />
                        <span className="text-[10px] uppercase tracking-ticker font-mono text-txt-3">
                          {t('land.heroSub')}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-txt-3">CRDB · 142 tx</span>
                    </div>

                    <div className="relative z-10">
                      <div className="text-[11px] uppercase tracking-ticker text-txt-3 mb-1">
                        {t('land.heroLabel')}
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-txt-3 text-lg font-mono">TZS</span>
                        <span className="text-4xl lg:text-5xl font-bold tabular tracking-tight text-txt-1">
                          <CountUp value={2620000} formatter={compact} duration={1300} />
                        </span>
                      </div>
                      <div className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-medium text-accent">
                        <Icon name="arrowUpRight" size={12} />
                        +18.4% vs Oct
                      </div>
                    </div>

                    {/* Flowing cashflow river across the bottom */}
                    <div className="mt-3 -mx-5 lg:-mx-6 -mb-5 lg:-mb-6 relative">
                      <CashflowRiver height={96} />
                    </div>
                  </TiltCard>

                  {/* Money-in / money-out tiles */}
                  {[
                    { l: t('common.moneyIn'),  v: 5150000, d: '+12.3%', up: true,  accent: 'text-inc', dot: 'bg-inc', s: SERIES.in,  tok: 'rgb(var(--c-inc))' },
                    { l: t('common.moneyOut'), v: 2530000, d: '+4.1%',  up: false, accent: 'text-exp', dot: 'bg-exp', s: SERIES.out, tok: 'rgb(var(--c-exp))' },
                  ].map((k) => (
                    <TiltCard key={k.l} max={6} className="card-soft p-4 relative overflow-hidden">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${k.dot}`} />
                        <span className="text-[10px] uppercase tracking-ticker text-txt-3">{k.l}</span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-txt-3 text-[10px] font-mono">TZS</span>
                        <span className="text-xl font-bold tabular text-txt-1">
                          <CountUp value={k.v} formatter={compact} duration={1200} />
                        </span>
                      </div>
                      <div className={`mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium ${k.up ? 'text-inc' : 'text-exp'}`}>
                        <Icon name={k.up ? 'arrowUpRight' : 'arrowDownRight'} size={10} />
                        {k.d}
                      </div>
                      <div className="mt-2 -mx-1">
                        <Sparkline values={k.s} color={k.tok} width={170} height={30} strokeWidth={1.6} />
                      </div>
                    </TiltCard>
                  ))}

                  {/* AI + auto-categorize strip */}
                  <div className="col-span-2 glass-pane rounded-[18px] px-4 py-3 flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-ticker text-txt-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                      auto-categorized
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-ticker text-txt-2">
                      <Icon name="sparkles" size={12} className="text-accent" />
                      pesalens.ai
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- TICKER */}
      <div className="relative border-y border-bdr/70 bg-surface-2/40 overflow-hidden">
        <div className="ticker-track py-3.5 whitespace-nowrap">
          {[...ticker, ...ticker, ...ticker].map((row, i) => {
            const pctText = formatPct(row.pct);
            const up = (row.pct ?? 0) >= 0;
            return (
              <span key={i} className="inline-flex items-center gap-2 mx-6 font-mono text-xs">
                <span className="text-txt-3 tracking-ticker">{row.sym}</span>
                <span className="text-txt-1 tabular">{row.val}</span>
                {pctText && (
                  <span className={`tabular ${up ? 'text-inc' : 'text-exp'}`}>{pctText}</span>
                )}
                <span className="text-txt-4 mx-2">·</span>
              </span>
            );
          })}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-deep to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-deep to-transparent" />
      </div>

      {/* ----------------------------------------------- HOW IT WORKS */}
      <section className="py-16 lg:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="grid lg:grid-cols-12 gap-6 mb-10">
              <div className="lg:col-span-6">
                <Eyebrow>{t('land.method.eyebrow')}</Eyebrow>
                <h2 className="mt-4 text-3xl lg:text-5xl font-semibold tracking-tightest leading-[1.05]">
                  {t('land.method.title.l1')}<br />
                  <span className="font-serif-i text-txt-2">{t('land.method.title.l2')}</span> {t('land.method.title.l3')}
                </h2>
              </div>
              <div className="lg:col-span-5 lg:col-start-8 self-end">
                <p className="text-base text-txt-2 leading-relaxed">
                  {t('land.method.lede')}
                </p>
              </div>
            </div>
          </FadeIn>

          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-px bg-bdr/60 rounded-2xl overflow-hidden border border-bdr">
            {[
              { step: '01', tag: t('land.step.ingest'),    title: t('land.step.1.title'), desc: t('land.step.1.desc'), icon: 'upload' },
              { step: '02', tag: t('land.step.reconcile'), title: t('land.step.2.title'), desc: t('land.step.2.desc'), icon: 'eye' },
              { step: '03', tag: t('land.step.decide'),    title: t('land.step.3.title'), desc: t('land.step.3.desc'), icon: 'sparkles' },
            ].map((item, idx) => (
              <FadeIn key={item.step} delay={idx * 0.1}>
                <div className="bg-surface-2 p-6 sm:p-7 lg:p-8 h-full relative group">
                  <div className="flex items-center justify-between mb-6">
                    <span className="font-serif-i text-2xl text-txt-3 group-hover:text-accent transition-colors">{item.step}</span>
                    <span className="font-mono text-[10px] uppercase tracking-ticker text-accent">
                      {item.tag}
                    </span>
                  </div>
                  <Icon name={item.icon} size={26} className="text-txt-1 mb-5 transition-transform duration-300 group-hover:-translate-y-1" />
                  <h3 className="text-xl font-semibold mb-2 tracking-tight">{item.title}</h3>
                  <p className="text-sm text-txt-2 leading-relaxed">{item.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- FEATURES */}
      <section id="features" className="py-16 lg:py-20 bg-surface-1/40 border-y border-bdr/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-12">
              <div>
                <Eyebrow>{t('land.cap.eyebrow')}</Eyebrow>
                <h2 className="mt-4 text-3xl lg:text-5xl font-semibold tracking-tightest leading-[1.05] max-w-xl">
                  {t('land.cap.title.l1')}<br />
                  <span className="font-serif-i text-txt-2">{t('land.cap.title.l2')}</span> {t('land.cap.title.l3')}
                </h2>
              </div>
              <p className="text-sm text-txt-2 max-w-sm">
                {t('land.cap.lede')}
              </p>
            </div>
          </FadeIn>

          {/* Bento grid — varied sizes */}
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4 sm:gap-5">
            {/* Big feature */}
            <FadeIn className="md:col-span-4">
              <TiltCard max={4} glare className="card-soft p-6 lg:p-8 h-full relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-72 h-72 bg-accent/8 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                <div className="relative">
                  <Eyebrow>Statement intelligence</Eyebrow>
                  <h3 className="mt-3 text-2xl lg:text-[28px] font-semibold tracking-tight max-w-md">
                    Every transaction gets a category, a counter-party, and a verdict.
                  </h3>
                  <p className="mt-3 text-sm text-txt-2 max-w-md leading-relaxed">
                    PesaLens reconstructs your statement as a clean ledger,
                    flags duplicates, surfaces fees you didn't know you paid,
                    and explains why the balance doesn't tie.
                  </p>
                  <div className="mt-6 grid grid-cols-3 gap-3 max-w-md">
                    {[
                      { l: 'Avg fee leak',     v: 'TZS 38K' },
                      { l: 'Mis-classified',   v: '< 2.7%' },
                      { l: 'Reconcile time',   v: '6.4s' },
                    ].map((s) => (
                      <div key={s.l} className="card-inset p-3 rounded-lg">
                        <div className="text-[10px] uppercase tracking-ticker text-txt-3 mb-0.5">{s.l}</div>
                        <div className="text-base font-semibold tabular text-accent">{s.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </TiltCard>
            </FadeIn>

            {/* Side feature */}
            <FadeIn delay={0.1} className="md:col-span-2">
              <TiltCard max={6} className="card-soft p-6 h-full">
                <Icon name="bot" size={26} className="text-accent mb-5" />
                <Eyebrow>AI controller</Eyebrow>
                <h3 className="mt-3 text-lg font-semibold">Ask anything in Kiswahili or English</h3>
                <p className="mt-2 text-sm text-txt-2 leading-relaxed">
                  Grounded on your real statement. Not a chatbot — a co-pilot
                  with the numbers in front of it.
                </p>
              </TiltCard>
            </FadeIn>

            {/* Three small */}
            {[
              { icon: 'zap',      tag: 'KPI engine',   title: 'Money-in, money-out, savings rate, expense growth — daily, monthly, quarterly.' },
              { icon: 'trending', tag: 'Markets',      title: 'DSE, crypto, S&P, forex with strategies tailored to your cash flow.' },
              { icon: 'book',     tag: 'Bookkeeping',  title: 'Sales, expenses, debts, receipts — purpose-built for Tanzanian SMEs.' },
            ].map((f, idx) => (
              <FadeIn key={f.tag} delay={0.15 + idx * 0.08} className="md:col-span-2">
                <TiltCard max={7} className="card-soft p-5 h-full group">
                  <div className="flex items-center justify-between mb-4">
                    <Icon name={f.icon} size={20} className="text-accent transition-transform group-hover:-translate-y-0.5" />
                    <span className="font-mono text-[10px] uppercase tracking-ticker text-txt-3">{f.tag}</span>
                  </div>
                  <p className="text-[14px] text-txt-1 leading-snug">{f.title}</p>
                </TiltCard>
              </FadeIn>
            ))}

            {/* Wide bottom feature */}
            <FadeIn delay={0.3} className="md:col-span-6">
              <div className="card-soft p-6 lg:p-8 card-hover relative overflow-hidden">
                <div className="grid lg:grid-cols-12 gap-8 items-center">
                  <div className="lg:col-span-7">
                    <Eyebrow>Receipt capture</Eyebrow>
                    <h3 className="mt-3 text-xl lg:text-2xl font-semibold tracking-tight max-w-md">
                      Snap a TRA receipt. Get a fully-typed line-item ledger in seconds.
                    </h3>
                    <p className="mt-2 text-sm text-txt-2 max-w-lg leading-relaxed">
                      Vendor, total, VAT, line items, suggested category — extracted
                      from photos, gallery uploads, or live camera with text selection.
                    </p>
                  </div>
                  <div className="lg:col-span-5">
                    <div className="card-inset p-4 rounded-xl">
                      <div className="flex items-center justify-between mb-3 text-[10px] uppercase tracking-ticker text-txt-3 font-mono">
                        <span>RECEIPT · #4012</span>
                        <span className="inline-flex items-center gap-1.5 text-inc">
                          <span className="w-1.5 h-1.5 rounded-full bg-inc" />
                          parsed
                        </span>
                      </div>
                      {[
                        ['Shoprite Mlimani', 'TZS 48,200'],
                        ['VAT 18%',          'TZS 7,353'],
                        ['Category',         'Groceries'],
                      ].map(([l, v]) => (
                        <div key={l} className="flex items-center justify-between py-1.5 text-sm border-b border-bdr/40 last:border-0">
                          <span className="text-txt-2">{l}</span>
                          <span className="text-txt-1 font-medium tabular">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ------------------------------------------- WHY / STATS COLUMN */}
      <section className="py-16 lg:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-12 items-start">
            <FadeIn className="lg:col-span-6">
              <Eyebrow>{t('land.why.eyebrow')}</Eyebrow>
              <h2 className="mt-4 text-3xl lg:text-5xl font-semibold tracking-tightest leading-[1.05]">
                {t('land.why.title.l1')} <span className="font-serif-i text-txt-2">{t('land.why.title.l2')}</span>
              </h2>
              <p className="mt-6 text-base text-txt-2 leading-relaxed max-w-xl">
                {t('land.why.lede')}
              </p>
              <div className="mt-8 space-y-4 max-w-xl">
                {[
                  ['10+ hrs',  'monthly, recovered from manual reconciliation'],
                  ['97.3%',    'extraction accuracy on Tanzanian bank PDFs'],
                  ['Sub-7s',   'from upload to first KPI rendered'],
                  ['Built',    'for individuals, freelancers, vendors and SMEs'],
                ].map(([n, d]) => (
                  <div key={n} className="flex items-baseline gap-5 border-b border-bdr/50 pb-3">
                    <span className="font-serif-i text-2xl text-accent w-24 flex-shrink-0">{n}</span>
                    <span className="text-sm text-txt-2 leading-relaxed">{d}</span>
                  </div>
                ))}
              </div>
            </FadeIn>

            <FadeIn delay={0.15} className="lg:col-span-5 lg:col-start-8">
              <TiltCard max={5} glare className="card-soft p-6 lg:p-7 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-40 h-40 bg-accent/10 rounded-full blur-3xl" />
                <div className="relative">
                  <div className="flex items-center justify-between mb-5">
                    <Eyebrow>Monthly snapshot</Eyebrow>
                    <span className="font-mono text-[10px] tracking-ticker text-txt-3">NOV · 26</span>
                  </div>
                  <div className="space-y-5">
                    {[
                      { l: 'Time saved',          v: '12 hrs/mo', pct: 85, c: 'rgb(var(--c-accent))' },
                      { l: 'Extraction accuracy', v: '97.3%',     pct: 97, c: 'rgb(var(--c-inc))' },
                      { l: 'Cost reduction',      v: '68%',       pct: 68, c: 'rgb(var(--c-net))' },
                      { l: 'Insights generated',  v: 'Instant',   pct: 95, c: 'rgb(var(--c-accent))' },
                    ].map((m, i) => (
                      <div key={m.l}>
                        <div className="flex justify-between items-baseline mb-1.5 text-sm">
                          <span className="text-txt-2"><AutoT>{m.l}</AutoT></span>
                          <span className="font-semibold tabular"><AutoT>{m.v}</AutoT></span>
                        </div>
                        <div className="h-1 bg-surface-4 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-1000"
                            style={{
                              width: `${m.pct}%`,
                              background: m.c,
                              transitionDelay: `${i * 120}ms`,
                              boxShadow: `0 0 12px ${m.c}`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </TiltCard>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- CTA */}
      <section className="py-16 lg:py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="relative card-soft p-10 lg:p-16 overflow-hidden">
              <div className="absolute inset-0 grid-dot opacity-50" />
              <div className="absolute -top-20 -right-20 w-72 h-72 bg-accent/15 rounded-full blur-3xl" />
              <div className="absolute -bottom-20 -left-10 w-72 h-72 bg-net/12 rounded-full blur-3xl" />
              <div className="relative grid lg:grid-cols-12 gap-8 items-center">
                <div className="lg:col-span-7">
                  <Eyebrow>{t('land.cta.eyebrow')}</Eyebrow>
                  <h2 className="mt-4 text-3xl lg:text-[44px] font-semibold tracking-tightest leading-[1.05]">
                    {t('land.cta.title.l1')}<br />
                    <span className="font-serif-i text-txt-2">{t('land.cta.title.l2')}</span>
                  </h2>
                  <p className="mt-4 text-sm lg:text-base text-txt-2 max-w-md leading-relaxed">
                    {t('land.cta.lede')}
                  </p>
                </div>
                <div className="lg:col-span-5 flex flex-col gap-3">
                  <Link to="/signup" className="btn-primary px-6 py-3.5 rounded-xl font-semibold inline-flex items-center justify-center gap-2">
                    {t('land.startTrial')}
                    <Icon name="arrowRight" size={16} />
                  </Link>
                  <Link to="/signin" className="btn-secondary px-6 py-3.5 rounded-xl font-semibold inline-flex items-center justify-center">
                    {t('nav.signin')}
                  </Link>
                  <p className="text-[11px] text-txt-3 text-center pt-1">
                    {t('land.cta.fine')}
                  </p>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* -------------------------------------------------------- FOOTER */}
      <footer className="border-t border-bdr py-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid sm:grid-cols-2 lg:grid-cols-12 gap-8 mb-10">
            <div className="lg:col-span-6">
              <Mark size={32} />
              <p className="mt-4 text-sm text-txt-3 leading-relaxed max-w-md">
                {t('foot.tag')}
              </p>
            </div>
            <div className="lg:col-span-3">
              <h4 className="font-mono text-[10px] uppercase tracking-ticker text-txt-3 mb-4">{t('foot.product')}</h4>
              <div className="space-y-2.5 text-sm text-txt-2">
                <Link to="/signup" className="block hover:text-txt-1 transition">{t('nav.startTrial')}</Link>
                <Link to="/signup" className="block hover:text-txt-1 transition">{t('nav.openAccount')}</Link>
                <Link to="/signin" className="block hover:text-txt-1 transition">{t('nav.signin')}</Link>
              </div>
            </div>
            <div className="lg:col-span-3">
              <h4 className="font-mono text-[10px] uppercase tracking-ticker text-txt-3 mb-4">{t('foot.legal')}</h4>
              <div className="space-y-2.5 text-sm text-txt-2">
                <p className="text-txt-3">Terms of Service — coming soon</p>
                <p className="text-txt-3">Privacy Policy — coming soon</p>
              </div>
            </div>
          </div>
          <div className="border-t border-bdr pt-7 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-txt-3 font-mono uppercase tracking-ticker">
            <p>{t('foot.copy')}</p>
            <p>{t('foot.built')}</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
