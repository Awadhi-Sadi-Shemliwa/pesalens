import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from '../components/Router';
import { PublicNav } from '../components/navigation';
import { Icon } from '../components/Icon';
import { Eyebrow, FadeIn, Sparkline, Mark, CountUp } from '../components/common';
import DownloadAPK from '../components/DownloadAPK';
import { useT } from '../data/i18n';
import { fetchPublicTicker } from '../data/api';
import {
  MotionProvider,
  useMotion,
  useMotionEnv,
  PageBackground,
  MotionHeading,
  NoteLayer,
  NoteImg,
  useNoteManifest,
  OrbitRing,
  tokenHex,
  tokenChannels,
} from '../motion';
import { ParticleCard, GlobalSpotlight } from '../components/reactbits/MagicBento';
import TextType from '../components/reactbits/TextType';
import RotatingText from '../components/reactbits/RotatingText';
import TrueFocus from '../components/reactbits/TrueFocus';
import StarBorder from '../components/reactbits/StarBorder';
import Magnet from '../components/reactbits/Magnet';
import ClickSpark from '../components/reactbits/ClickSpark';
import ScrollReveal from '../components/reactbits/ScrollReveal';

/* Fallback shown only while the live ticker is loading or if the
   backend is unreachable — replaced as soon as /api/markets/ticker responds. */
const TICKER_FALLBACK = [
  { sym: 'CRDB',    val: '2 700',   pct: 3.45,  kind: 'stock' },
  { sym: 'NMB',     val: '4 600',   pct: -0.6,  kind: 'stock' },
  { sym: 'USD/TZS', val: '2 608',   pct: null,  kind: 'fx' },
  { sym: 'EUR/TZS', val: '3 057',   pct: null,  kind: 'fx' },
  { sym: 'BTC',     val: '$76,146', pct: -2.05, kind: 'crypto' },
  { sym: 'ETH',     val: '$2,269',  pct: -1.95, kind: 'crypto' },
  { sym: 'S&P 500', val: '7 174',   pct: 0.91,  kind: 'index' },
];

/* Static seed for the markets orbit — live ticker rows override per symbol.
   Symbols shared with the hero ticker inherit their placeholder price/pct from
   TICKER_FALLBACK so the two seeds can't drift; the orbit just adds a few local
   symbols (TBL / TPCC / NASDAQ) the ticker doesn't carry. */
const _FALLBACK_BY_SYM = Object.fromEntries(TICKER_FALLBACK.map((r) => [r.sym, r]));
const ORBIT_EXTRA = {
  TBL:    { val: '10 900', pct: 0.0 },
  TPCC:   { val: '4 040',  pct: 1.2 },
  NASDAQ: { val: '23 411', pct: 1.14 },
};
const ORBIT_SEED = ['CRDB', 'NMB', 'TBL', 'TPCC', 'BTC', 'ETH', 'S&P 500', 'NASDAQ'].map((sym) => {
  const base = _FALLBACK_BY_SYM[sym] || ORBIT_EXTRA[sym] || {};
  return { sym, val: base.val, pct: base.pct ?? 0 };
});

const formatPct = (pct) => {
  if (pct == null || Number.isNaN(Number(pct))) return null;
  const n = Number(pct);
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
};

/* Staggered entrance (MoneyMate assemble) — pure CSS, reliable across HMR */
const assembleCls = (vis) =>
  `transition-all duration-700 ease-out ${vis ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-7 scale-[0.97]'}`;
const assembleDelay = (i) => ({ transitionDelay: `${150 + i * 110}ms` });

/* Reveal-once helper for framer draws */
const viewportOnce = { once: true, amount: 0.5 };

/* ======================================================================= */
/*  HERO — MoneyMate scene: transactions rising/falling, balance, charts   */
/* ======================================================================= */

const TX_ROWS = [
  { label: 'M-Pesa float',  amt: '+ TZS 235,000',   up: true },
  { label: 'Bank charges',  amt: '− TZS 4,800',     up: false },
  { label: 'Invoice #218',  amt: '+ TZS 1,180,000', up: true },
  { label: 'Duka stock',    amt: '− TZS 320,000',   up: false },
];

const MoneyMateScene = ({ vis, reduced }) => (
  <div className="relative h-[430px] sm:h-[520px] select-none" aria-hidden>
    {/* elbow connector lines (MoneyMate's orange threads → accent) */}
    <svg
      viewBox="0 0 600 520"
      preserveAspectRatio="none"
      className={`hidden sm:block absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-1000 delay-[800ms] ${vis ? 'opacity-60' : 'opacity-0'}`}
    >
      <path d="M 205 300 L 205 352 L 96 352" fill="none" stroke="rgb(var(--c-accent))" strokeWidth="1.4" />
      <circle cx="205" cy="300" r="3.5" fill="rgb(var(--c-accent))" />
      <path d="M 330 250 L 400 250 L 400 205" fill="none" stroke="rgb(var(--c-accent))" strokeWidth="1.4" />
      <circle cx="400" cy="205" r="3.5" fill="rgb(var(--c-accent))" />
    </svg>

    {/* floating sparkles / plus signs / squiggle (decor) */}
    <div className={`transition-opacity duration-1000 delay-700 ${vis ? 'opacity-100' : 'opacity-0'}`}>
      <svg className="absolute left-[2%] top-[2%] w-14 h-14 text-net/50 anim-float" viewBox="0 0 48 48" fill="none">
        <path d="M4 40 C14 26, 10 20, 22 10 M10 44 C20 30, 16 24, 28 14 M16 46 C26 34, 22 28, 34 18" stroke="currentColor" strokeWidth="1.4" />
      </svg>
      <span className="absolute left-[38%] top-[10%] text-accent text-xl anim-pulse-soft">✦</span>
      <span className="absolute left-[55%] top-[2%] text-net/70 text-2xl anim-pulse-soft" style={{ animationDelay: '0.8s' }}>✧</span>
      <span className="absolute left-[6%] top-[46%] text-accent text-lg anim-float" style={{ animationDelay: '0.4s' }}>+</span>
      <span className="absolute right-[4%] bottom-[8%] text-net/60 text-lg anim-float" style={{ animationDelay: '1.2s' }}>+</span>
    </div>

    {/* Transactions card — money visibly rising (green) and falling (red) */}
    <div
      className={`absolute left-0 sm:left-[10%] top-0 w-[200px] sm:w-[230px] rounded-[20px] bg-ink border border-bdr shadow-float p-4 z-10 ${assembleCls(vis)}`}
      style={assembleDelay(0)}
    >
      {TX_ROWS.map((r, i) => (
        <div
          key={r.label}
          className={`flex items-center gap-3 py-2.5 ${i < TX_ROWS.length - 1 ? 'border-b border-bdr/40' : ''} ${assembleCls(vis)}`}
          style={assembleDelay(2 + i)}
        >
          <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${r.up ? 'bg-inc/15 text-inc' : 'bg-dng/15 text-dng'}`}>
            <Icon name={r.up ? 'arrowUpRight' : 'arrowDownRight'} size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-txt-3 truncate">{r.label}</div>
            <div className={`text-[13px] font-semibold tabular ${r.up ? 'text-inc' : 'text-dng'}`}>{r.amt}</div>
          </div>
        </div>
      ))}
    </div>

    {/* "This week +5%" card with a drawing rising line */}
    <div
      className={`absolute left-0 sm:left-[2%] top-[66%] sm:top-[62%] w-[200px] sm:w-[240px] rounded-[18px] bg-ink border border-bdr shadow-float px-4 pt-3 pb-2 z-10 ${assembleCls(vis)}`}
      style={assembleDelay(6)}
    >
      <div className="flex items-center justify-between text-[12px] mb-1">
        <span className="text-txt-2">This week</span>
        <span className="text-inc font-semibold tabular">+5%</span>
      </div>
      <svg viewBox="0 0 200 52" className="w-full h-[52px]">
        <path
          d="M 4 44 C 36 44, 40 30, 66 32 S 106 44, 128 30 S 168 8, 196 10"
          fill="none"
          stroke="rgb(var(--c-accent))"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="300"
          strokeDashoffset={reduced || vis ? 0 : 300}
          style={{ transition: 'stroke-dashoffset 1.4s ease-in-out 1s' }}
        />
      </svg>
    </div>

    {/* Date card with mini bars + "cursor" clicking the tall bar */}
    <div
      className={`hidden sm:block absolute left-[46%] top-[38%] w-[164px] rounded-[18px] bg-surface-2 border border-bdr shadow-float p-3.5 z-20 ${assembleCls(vis)}`}
      style={assembleDelay(4)}
    >
      <div className="mx-auto mb-2.5 w-max rounded-lg border border-bdr px-3 py-1 text-[12px] font-semibold text-txt-1">
        Nov 26
      </div>
      <div className="flex items-end justify-center gap-1.5 h-[46px]">
        {[22, 34, 46, 28, 38].map((h, i) => (
          <span
            key={i}
            className={`w-3 rounded-sm ${i === 2 ? 'bg-accent' : 'bg-net/50'}`}
            style={{
              height: reduced || vis ? h : 0,
              transition: `height 0.5s ease-out ${0.9 + i * 0.1}s`,
            }}
          />
        ))}
      </div>
      <svg
        className={`absolute -bottom-3 left-1/2 w-6 h-6 text-txt-1 drop-shadow transition-all duration-500 delay-[1600ms] ${vis ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-6'}`}
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M5 3l14 7-6 2-2 6z" />
      </svg>
    </div>

    {/* Balance card (gradient) + register/open CTA circle */}
    <div className={`absolute right-0 top-[6%] w-[164px] sm:w-[196px] z-10 ${assembleCls(vis)}`} style={assembleDelay(1)}>
      <div className="rounded-[20px] p-4 pb-9 shadow-float relative overflow-hidden border border-accent/25"
        style={{ background: 'linear-gradient(140deg, rgb(var(--c-accent) / 0.9), rgb(var(--c-net) / 0.9))' }}
      >
        <div className="text-[12px] text-white/85 text-center">Your balance</div>
        <div className="mt-1 text-center text-[26px] font-bold tabular text-white">
          TZS <CountUp value={1.74} decimals={2} duration={1400} />M
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="font-mono text-[10px] text-white/75">•• 4051</span>
          <span className="w-9 h-5 rounded-full bg-white/25 relative">
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all duration-500 delay-[1300ms] ${vis ? 'left-[18px]' : 'left-0.5'}`} />
          </span>
        </div>
      </div>
      <div className={`-mt-6 flex flex-col items-center gap-1.5 ${assembleCls(vis)}`} style={assembleDelay(7)}>
        <Link
          to="/signup"
          className="press w-12 h-12 rounded-full btn-primary flex items-center justify-center shadow-ring pointer-events-auto"
          aria-label="Open an account"
        >
          <Icon name="arrowUpRight" size={18} />
        </Link>
        <span className="text-[11px] text-txt-2 text-center leading-tight">Open your<br />account</span>
      </div>
    </div>

    {/* Category donut */}
    <div className={`hidden sm:block absolute left-[48%] bottom-0 z-0 ${assembleCls(vis)}`} style={assembleDelay(8)}>
      <svg width="132" height="132" viewBox="0 0 132 132" className="drop-shadow-lg">
        {[
          { from: 0, len: 52, color: 'rgb(var(--c-accent))' },
          { from: 52, len: 26, color: 'rgb(var(--c-net))' },
          { from: 78, len: 22, color: 'rgb(var(--c-s5))' },
        ].map((s, i) => (
          <circle
            key={i}
            cx="66" cy="66" r="44"
            fill="none"
            stroke={s.color}
            strokeWidth="26"
            strokeDasharray={`${(s.len / 100) * 276.5} 276.5`}
            strokeDashoffset={-((s.from / 100) * 276.5)}
            transform="rotate(-90 66 66)"
            opacity={reduced || vis ? 1 : 0}
            style={{ transition: `opacity 0.6s ease ${1.2 + i * 0.22}s` }}
          />
        ))}
      </svg>
    </div>
  </div>
);

/* ======================================================================= */
/*  METHOD — Taiko roadmap: staggered glass stage-cards + flowing streaks  */
/* ======================================================================= */

/* METHOD ladder — a single continuous diagonal staircase of parallel "rungs"
   (green→blue) with a light that flows smoothly down it. Modelled on the Taiko
   roadmap ladder, tightened so it connects the three stage cards without the
   big empty gaps. The rungs step down-right in lock-step; a staggered opacity
   wave (see .pl-rung in motion.css) sends a bright band travelling down the
   ladder on a loop, which reads as the smooth continuous movement. */
const LADDER_RUNGS = 46;
const MethodLadder = () => {
  const angle = (-14 * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rungs = Array.from({ length: LADDER_RUNGS }, (_, i) => {
    const cx = 118 + i * 19.8 + Math.sin(i * 0.17) * 34;   // step right, gentle S-sway
    const cy = 54 + i * 8.9;                                 // step down
    const len = 128 + 30 * Math.sin(i * 0.32);              // tapered rung lengths
    return {
      i,
      x1: cx,
      y1: cy,
      x2: cx + len * cos,
      y2: cy + len * sin,
      delay: (i * 0.06).toFixed(2),
    };
  });
  return (
    <motion.svg
      viewBox="0 0 1200 520"
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full pointer-events-none"
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={viewportOnce}
      transition={{ duration: 0.9, ease: 'easeOut' }}
    >
      <defs>
        <linearGradient id="pl-ladder" gradientUnits="userSpaceOnUse" x1="118" y1="54" x2="1030" y2="470">
          <stop offset="0%" stopColor="rgb(var(--c-accent-h))" />
          <stop offset="52%" stopColor="rgb(var(--c-accent))" />
          <stop offset="100%" stopColor="rgb(var(--c-net))" />
        </linearGradient>
      </defs>
      {rungs.map((r) => (
        <line
          key={r.i}
          className="pl-rung"
          x1={r.x1}
          y1={r.y1}
          x2={r.x2}
          y2={r.y2}
          stroke="url(#pl-ladder)"
          strokeWidth="1.5"
          strokeLinecap="round"
          style={{ animationDelay: `${r.delay}s` }}
        />
      ))}
    </motion.svg>
  );
};

const StageCard = ({ step, tag, title, desc, className = '', delay = 0, children }) => (
  <motion.div
    className={`w-[300px] max-w-full rounded-2xl border border-accent/20 bg-surface-2/75 backdrop-blur-md shadow-float p-5 ${className}`}
    initial={{ opacity: 0, y: 34 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, amount: 0.4 }}
    transition={{ duration: 0.7, delay, ease: 'easeOut' }}
  >
    <div className="flex items-center justify-between mb-3">
      <span className="font-semibold text-[15px] text-txt-1">{step}</span>
      <span className="font-mono text-[10px] uppercase tracking-ticker text-accent">{tag}</span>
    </div>
    <h3 className="text-lg font-semibold tracking-tight mb-2">{title}</h3>
    <p className="text-[13px] text-txt-2 leading-relaxed flex gap-2">
      <span className="text-accent flex-shrink-0">+</span>
      <span>{desc}</span>
    </p>
    {children}
  </motion.div>
);

/* ======================================================================= */
/*  CAPABILITIES — bento dashboard replicating the reference screenshot    */
/* ======================================================================= */

const BENTO_TX = [
  { name: 'Shoprite Mlimani',   amt: 'TZS 48,200',  ok: true,  note: 'Groceries',        date: '26 Nov' },
  { name: 'M-Pesa transfer',    amt: 'TZS 235,000', ok: true,  note: 'Money in',         date: '25 Nov' },
  { name: 'LUKU electricity',   amt: 'TZS 60,000',  ok: true,  note: 'Utilities',        date: '24 Nov' },
  { name: 'Receipt #4012',      amt: 'TZS 55,553',  ok: true,  note: 'OCR parsed',       date: '24 Nov' },
  { name: 'Unknown counterparty', amt: 'TZS 12,500', ok: false, note: 'Needs review',    date: '23 Nov' },
];

const ACTIVITY = [
  { d: 'Mon', v: 34 }, { d: 'Tue', v: 78 }, { d: 'Wed', v: 30 }, { d: 'Thu', v: 26 },
  { d: 'Fri', v: 42 }, { d: 'Sat', v: 22 }, { d: 'Sun', v: 30 },
];

/* Bento tile — MagicBento ParticleCard on desktop, calm glass card on lite */
const BentoTile = ({ lite, glowChannels, className = '', children }) => {
  if (lite) {
    return <div className={`card card-soft rounded-[18px] ${className}`}>{children}</div>;
  }
  return (
    <ParticleCard
      className={`card card--border-glow card-soft rounded-[18px] ${className}`}
      glowColor={glowChannels}
      particleCount={7}
      enableTilt={false}
      enableMagnetism={false}
      clickEffect={false}
    >
      {children}
    </ParticleCard>
  );
};

const TileLabel = ({ children }) => (
  <div className="flex items-center justify-between mb-4">
    <span className="text-[13px] text-txt-2">{children}</span>
    <span className="text-txt-4 text-lg leading-none">+</span>
  </div>
);

/* ======================================================================= */

const LandingInner = () => {
  const [heroVis, setHeroVis] = useState(false);
  const [ticker, setTicker] = useState(TICKER_FALLBACK);
  const { t } = useT();
  const env = useMotionEnv();

  const heroRef = useRef(null);
  const methodRef = useRef(null);
  const capRef = useRef(null);
  const reconRef = useRef(null);
  const marketsRef = useRef(null);
  const whyRef = useRef(null);
  const ctaRef = useRef(null);
  const bentoRef = useRef(null);

  const heroMotion = useMotion('hero');
  const methodMotion = useMotion('method');
  const capMotion = useMotion('capabilities');
  const reconMotion = useMotion('recon');
  const marketsMotion = useMotion('markets');
  const whyMotion = useMotion('why');
  const ctaMotion = useMotion('cta');

  useEffect(() => {
    const tm = setTimeout(() => setHeroVis(true), 30);
    return () => clearTimeout(tm);
  }, []);

  /* gsap ScrollTriggers are positioned before web fonts / lazy canvases load;
     stale positions make above-the-fold text look "held" until the user
     scrolls. Refresh them once the layout has truly settled. */
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const { ScrollTrigger } = await import('gsap/ScrollTrigger');
        if (document.fonts?.ready) await document.fonts.ready;
        if (alive) ScrollTrigger.refresh();
      } catch { /* gsap not loaded yet — triggers will self-correct */ }
    };
    if (document.readyState === 'complete') refresh();
    else window.addEventListener('load', refresh, { once: true });
    return () => {
      alive = false;
      window.removeEventListener('load', refresh);
    };
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

  /* Merge live ticker rows over the orbit seed (live value wins per symbol) */
  const orbitAssets = useMemo(() => {
    const bySym = new Map(ORBIT_SEED.map((r) => [r.sym, r]));
    ticker.forEach((r) => {
      if (r.sym && bySym.has(r.sym)) bySym.set(r.sym, { sym: r.sym, val: r.val, pct: r.pct });
    });
    return [...bySym.values()];
  }, [ticker]);

  const glowChannels = tokenChannels('--c-accent');

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* One unified background for the whole landing:
          light theme → Light Pillar · dark theme → Hyperspeed (guarded + lazy). */}
      <PageBackground />
      <div className="relative z-[1]">
      <PublicNav />

      {/* ----------------------------------------------------------- HERO */}
      <section id="hero" ref={heroRef} className="relative pt-28 pb-14 lg:pt-36 lg:pb-20 scroll-mt-24">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 grid-faint opacity-60" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-6 items-center">
            {/* Hero copy — 5 cols */}
            <div className="lg:col-span-5">
              <div className={`transition-all duration-700 ${heroVis ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
                <Eyebrow>
                  <MotionHeading fx="shiny" text={t('land.eyebrow')} />
                </Eyebrow>
              </div>

              <h1 className="mt-5 sm:mt-6 text-[34px] sm:text-6xl lg:text-[64px] leading-[1.02] sm:leading-[0.97] font-semibold tracking-tightest text-txt-1 break-words">
                <MotionHeading fx={heroMotion.heading} tag="span" text={t('land.title.l1')} className="block" />
                <span className={`block transition-all duration-700 delay-200 ${heroVis ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
                  <span className="font-serif-i text-txt-2">{t('land.title.like')}</span>{' '}
                  <span className="gradient-text">{t('land.title.l2')}</span>
                </span>
              </h1>

              <p className={`mt-6 text-base sm:text-lg text-txt-2 max-w-xl leading-relaxed transition-all duration-700 delay-150 ${heroVis ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
                {t('land.lede')}
              </p>

              <div className={`mt-8 flex flex-col sm:flex-row gap-3 transition-all duration-700 delay-200 ${heroVis ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
                <ClickSpark sparkColor={tokenHex('--c-accent-h')} sparkRadius={22} sparkCount={9}>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Magnet disabled={env.lite} magnetStrength={7} padding={60}>
                      <Link
                        to="/signup"
                        className="press btn-primary px-6 py-3 rounded-xl text-[15px] font-semibold inline-flex items-center justify-center gap-2"
                      >
                        {t('land.startTrial')}
                        <Icon name="arrowRight" size={16} />
                      </Link>
                    </Magnet>
                    <Link
                      to="/signin"
                      className="press btn-secondary px-6 py-3 rounded-xl text-[15px] font-semibold inline-flex items-center justify-center gap-2"
                    >
                      {t('nav.signin')}
                    </Link>
                    <DownloadAPK variant="ghost" />
                  </div>
                </ClickSpark>
              </div>

              <div className={`mt-9 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-txt-3 transition-all duration-700 delay-300 ${heroVis ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
                <span className="inline-flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent anim-pulse-soft" />
                  {t('land.systemOk')}
                </span>
                <span>{t('land.trial')}</span>
              </div>
            </div>

            {/* MoneyMate scene — 7 cols */}
            <div className="lg:col-span-7 relative">
              {heroMotion.notes && (
                <NoteLayer
                  variant={heroMotion.notes}
                  denoms={heroMotion.noteProps?.denoms}
                  glow={heroMotion.noteProps?.glow}
                  className="absolute -inset-4 lg:-inset-8 z-0 hidden md:block opacity-80"
                />
              )}
              <div className="relative z-10">
                <MoneyMateScene vis={heroVis} reduced={env.reduced} />
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

      {/* -------------------------------------- METHOD — Taiko roadmap */}
      <section id="method" ref={methodRef} className="relative py-16 lg:py-20 overflow-hidden scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <FadeIn>
            <div className="grid lg:grid-cols-12 gap-6 mb-6">
              <div className="lg:col-span-6">
                <Eyebrow>{t('land.method.eyebrow')}</Eyebrow>
                <h2 className="mt-4 text-3xl lg:text-5xl font-semibold tracking-tightest leading-[1.05]">
                  {t('land.method.title.l1')}<br />
                  <span className="font-serif-i text-txt-2">{t('land.method.title.l2')}</span> {t('land.method.title.l3')}
                </h2>
              </div>
              <div className="lg:col-span-5 lg:col-start-8 self-end">
                {env.reduced ? (
                  <p className="text-base text-txt-2 leading-relaxed">{t('land.method.lede')}</p>
                ) : (
                  <ScrollReveal
                    baseOpacity={0.14}
                    baseRotation={1.5}
                    enableBlur={!env.lite}
                    blurStrength={2}
                    containerClassName="!my-0"
                    textClassName="!text-base !font-normal text-txt-2 leading-relaxed"
                  >
                    {t('land.method.lede')}
                  </ScrollReveal>
                )}
              </div>
            </div>
          </FadeIn>

          {/* Desktop roadmap: three stage cards docked along one flowing ladder */}
          <div className="relative hidden md:block h-[500px]">
            {env.reduced ? (
              <div
                aria-hidden
                className="absolute inset-0 pointer-events-none opacity-60"
                style={{ background: 'linear-gradient(120deg, transparent, rgb(var(--c-accent) / 0.10), rgb(var(--c-net) / 0.10), transparent)' }}
              />
            ) : (
              <MethodLadder />
            )}

            <div className="absolute left-[3%] top-[2%]">
              <StageCard step="Step 01" tag={t('land.step.ingest')} title={t('land.step.1.title')} desc={t('land.step.1.desc')} delay={0.05}>
                {/* real cash flies in and stacks — statement becomes ledger */}
                {methodMotion.notes && !env.reduced && (
                  <div className="absolute -bottom-14 -right-14 scale-[0.55] opacity-90 pointer-events-none">
                    <NoteLayer variant="assemble" denoms={['1k', '1k', '1k']} glow="accent" />
                  </div>
                )}
              </StageCard>
            </div>
            <div className="absolute left-[39%] top-[39%]">
              <StageCard step="Step 02" tag={t('land.step.reconcile')} title={t('land.step.2.title')} desc={t('land.step.2.desc')} delay={0.2} />
            </div>
            <div className="absolute left-[66%] top-[72%]">
              <StageCard step="Step 03" tag={t('land.step.decide')} title={t('land.step.3.title')} desc={t('land.step.3.desc')} delay={0.35} />
            </div>

            {/* stage markers along the flow (Taiko's H1/Q labels) */}
            {[['left-[8%] top-[46%]', '01 → 02'], ['left-[50%] top-[26%]', 'ledger check'], ['left-[62%] top-[92%]', 'decision-ready']].map(([pos, label]) => (
              <span key={label} className={`absolute ${pos} font-mono text-[10px] uppercase tracking-ticker text-txt-3`}>{label}</span>
            ))}
          </div>

          {/* Mobile: simple vertical timeline */}
          <div className="md:hidden relative pl-6 space-y-5 mt-4">
            <span className="absolute left-2 top-2 bottom-2 w-px bg-gradient-to-b from-accent to-net opacity-60" />
            {[
              { step: 'Step 01', tag: t('land.step.ingest'),    title: t('land.step.1.title'), desc: t('land.step.1.desc') },
              { step: 'Step 02', tag: t('land.step.reconcile'), title: t('land.step.2.title'), desc: t('land.step.2.desc') },
              { step: 'Step 03', tag: t('land.step.decide'),    title: t('land.step.3.title'), desc: t('land.step.3.desc') },
            ].map((s, i) => (
              <FadeIn key={s.step} delay={i * 0.08}>
                <StageCard {...s} className="!w-full" />
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------- CAPABILITIES — bento dashboard */}
      <section ref={capRef} id="features" className="relative py-16 lg:py-20 bg-surface-1/40 border-y border-bdr/60 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <FadeIn>
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-12">
              <div>
                <Eyebrow>{t('land.cap.eyebrow')}</Eyebrow>
                <h2 className="mt-4 text-3xl lg:text-5xl font-semibold tracking-tightest leading-[1.05] max-w-xl">
                  {t('land.cap.title.l1')}<br />
                  <span className="font-serif-i text-txt-2">{t('land.cap.title.l2')}</span> {t('land.cap.title.l3')}
                </h2>
              </div>
              <p className="text-sm text-txt-2 max-w-sm">{t('land.cap.lede')}</p>
            </div>
          </FadeIn>

          {!env.lite && (
            <GlobalSpotlight gridRef={bentoRef} enabled spotlightRadius={320} glowColor={glowChannels} />
          )}

          <div ref={bentoRef} className="bento-section pl-bento grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
            {/* Statements — gradient bank card (ref: "Cards") */}
            <FadeIn>
              <BentoTile lite={env.lite} glowChannels={glowChannels} className="p-5 h-full">
                <TileLabel>Statements</TileLabel>
                <div className="rounded-2xl p-4 h-[132px] relative overflow-hidden border border-white/10"
                  style={{ background: 'linear-gradient(135deg, rgb(var(--c-accent) / 0.85), rgb(var(--c-net) / 0.85))' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-white/90 font-medium">CRDB Bank</span>
                    <Mark size={22} withWord={false} />
                  </div>
                  <div className="mt-6 font-mono text-[15px] tracking-[0.14em] text-white">8763 2736 •••• ••29</div>
                  <div className="mt-3 flex items-center justify-between text-[10px] text-white/75 font-mono uppercase">
                    <span>statement · nov</span>
                    <span>142 tx</span>
                  </div>
                </div>
                <p className="mt-3 text-[12px] text-txt-3 leading-relaxed">
                  CRDB, NMB, NBC, Stanbic, M-Pesa, Airtel — PDFs or photos, in one ledger.
                </p>
              </BentoTile>
            </FadeIn>

            {/* Statement intelligence — transactions table (ref: "All Transactions History") */}
            <FadeIn delay={0.08}>
              <BentoTile lite={env.lite} glowChannels={glowChannels} className="p-5 h-full">
                <TileLabel>Statement intelligence</TileLabel>
                <div className="space-y-0.5">
                  <div className="grid grid-cols-[1fr_auto_auto] gap-3 pb-2 border-b border-bdr/50 font-mono text-[9px] uppercase tracking-ticker text-txt-4">
                    <span>Transaction</span><span>Status</span><span>Date</span>
                  </div>
                  {BENTO_TX.map((r, i) => (
                    <motion.div
                      key={r.name}
                      className="grid grid-cols-[1fr_auto_auto] gap-3 items-center py-[7px] border-b border-bdr/30 last:border-0"
                      initial={env.reduced ? false : { opacity: 0, x: -12 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true, amount: 0.6 }}
                      transition={{ duration: 0.35, delay: 0.15 + i * 0.1 }}
                    >
                      <span className="min-w-0">
                        <span className="block text-[12px] text-txt-1 truncate">{r.name}</span>
                        <span className="block text-[10px] text-txt-3 tabular">{r.amt}</span>
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-medium ${r.ok ? 'bg-inc/15 text-inc' : 'bg-exp/15 text-exp'}`}>
                        {r.note}
                      </span>
                      <span className="text-[10px] text-txt-3 font-mono">{r.date}</span>
                    </motion.div>
                  ))}
                </div>
              </BentoTile>
            </FadeIn>

            {/* KPI engine — weekly activity bars (ref: "My activity") */}
            <FadeIn delay={0.16}>
              <BentoTile lite={env.lite} glowChannels={glowChannels} className="p-5 h-full">
                <TileLabel>KPI engine</TileLabel>
                <div className="flex items-end justify-between gap-2 h-[150px] px-1">
                  {ACTIVITY.map((b, i) => (
                    <div key={b.d} className="flex flex-col items-center gap-2 flex-1">
                      <div className="w-full h-[120px] rounded-full bg-surface-4/60 relative overflow-hidden flex items-end">
                        <motion.span
                          className={`w-full rounded-full ${i === 1 ? '' : 'bg-surface-5'}`}
                          style={i === 1 ? { background: 'linear-gradient(180deg, rgb(var(--c-accent-h)), rgb(var(--c-accent-d)))' } : undefined}
                          initial={env.reduced ? false : { height: 0 }}
                          whileInView={{ height: `${b.v}%` }}
                          viewport={{ once: true, amount: 0.6 }}
                          transition={{ duration: 0.6, delay: 0.2 + i * 0.07, ease: 'easeOut' }}
                        />
                      </div>
                      <span className="font-mono text-[9px] text-txt-4 uppercase">{b.d}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[12px] text-txt-3">Daily, monthly and quarterly KPIs from every upload.</p>
              </BentoTile>
            </FadeIn>

            {/* Money in / Money out (ref: "Total Equation") — moved from the old hero */}
            <FadeIn delay={0.2}>
              <BentoTile lite={env.lite} glowChannels={glowChannels} className="p-5 h-full">
                <TileLabel>Money in · Money out</TileLabel>
                <div className="space-y-3">
                  {[
                    { l: t('common.moneyIn'),  v: 5150000, d: '+12.3%', up: true,  s: [820, 940, 905, 1100, 1240, 1180, 1320, 1410, 1380, 1505, 1620, 1580], c: 'rgb(var(--c-inc))' },
                    { l: t('common.moneyOut'), v: 2530000, d: '+4.1%',  up: false, s: [610, 580, 720, 660, 790, 700, 830, 760, 900, 820, 940, 880],           c: 'rgb(var(--c-exp))' },
                  ].map((k) => (
                    <div key={k.l} className="card-inset rounded-xl p-3.5">
                      <div className="text-[10px] uppercase tracking-ticker text-txt-3 mb-1">{k.l}</div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-txt-3 text-[10px] font-mono">TZS</span>
                        <span className="text-xl font-bold tabular text-txt-1">
                          <CountUp value={k.v} formatter={(v) => `${(v / 1e6).toFixed(2)}M`} duration={1200} />
                        </span>
                        <span className={`ml-1 text-[10px] font-medium ${k.up ? 'text-inc' : 'text-exp'}`}>{k.d}</span>
                      </div>
                      <div className="mt-1.5 -mx-1">
                        <Sparkline values={k.s} color={k.c} width={190} height={26} strokeWidth={1.5} />
                      </div>
                    </div>
                  ))}
                </div>
              </BentoTile>
            </FadeIn>

            {/* Bookkeeping — profit bars (ref: "Profits") */}
            <FadeIn delay={0.26}>
              <BentoTile lite={env.lite} glowChannels={glowChannels} className="p-5 h-full">
                <TileLabel>Bookkeeping</TileLabel>
                <div className="grid grid-cols-2 gap-4 mb-3">
                  {[
                    { l: 'Gross profit', v: 'TZS 12.2M' },
                    { l: 'Net profit',   v: 'TZS 4.45M' },
                  ].map((p) => (
                    <div key={p.l}>
                      <div className="text-[10px] uppercase tracking-ticker text-txt-3">{p.l}</div>
                      <div className="text-lg font-bold tabular text-txt-1">{p.v}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-end gap-4 h-[120px]">
                  {[{ h: 58, g: 'linear-gradient(180deg, rgb(var(--c-net) / 0.9), rgb(var(--c-net) / 0.4))' },
                    { h: 96, g: 'linear-gradient(180deg, rgb(var(--c-accent-h)), rgb(var(--c-accent-d)))' }].map((b, i) => (
                    <motion.div
                      key={i}
                      className="flex-1 rounded-xl"
                      style={{ background: b.g }}
                      initial={env.reduced ? false : { height: 0 }}
                      whileInView={{ height: `${b.h}%` }}
                      viewport={{ once: true, amount: 0.6 }}
                      transition={{ duration: 0.7, delay: 0.25 + i * 0.15, ease: 'easeOut' }}
                    />
                  ))}
                </div>
                <p className="mt-3 text-[12px] text-txt-3">Sales, expenses, debts, receipts — built for Tanzanian SMEs.</p>
              </BentoTile>
            </FadeIn>

            {/* Savings target — concentric arcs (ref: "Sales target") */}
            <FadeIn delay={0.32}>
              <BentoTile lite={env.lite} glowChannels={glowChannels} className="p-5 h-full">
                <TileLabel>Savings target</TileLabel>
                <div className="flex items-center gap-4">
                  <svg width="130" height="130" viewBox="0 0 130 130">
                    {[
                      { r: 52, pct: 0.72, color: 'rgb(var(--c-accent))' },
                      { r: 40, pct: 0.55, color: 'rgb(var(--c-net))' },
                      { r: 28, pct: 0.38, color: 'rgb(var(--c-inc))' },
                    ].map((a, i) => (
                      <g key={i}>
                        <circle cx="65" cy="65" r={a.r} fill="none" stroke="rgb(var(--c-s4))" strokeWidth="7" strokeDasharray={`${2 * Math.PI * a.r * 0.75} ${2 * Math.PI * a.r}`} transform="rotate(135 65 65)" strokeLinecap="round" opacity="0.5" />
                        <motion.circle
                          cx="65" cy="65" r={a.r} fill="none" stroke={a.color} strokeWidth="7" strokeLinecap="round"
                          strokeDasharray={`${2 * Math.PI * a.r} ${2 * Math.PI * a.r}`}
                          transform="rotate(135 65 65)"
                          initial={env.reduced ? { strokeDashoffset: 2 * Math.PI * a.r * (1 - 0.75 * a.pct) } : { strokeDashoffset: 2 * Math.PI * a.r }}
                          whileInView={{ strokeDashoffset: 2 * Math.PI * a.r * (1 - 0.75 * a.pct) }}
                          viewport={{ once: true, amount: 0.6 }}
                          transition={{ duration: 1, delay: 0.25 + i * 0.2, ease: 'easeOut' }}
                        />
                      </g>
                    ))}
                  </svg>
                  <div className="space-y-2 text-[11px]">
                    {[['Savings rate', 'rgb(var(--c-accent))'], ['Emergency fund', 'rgb(var(--c-net))'], ['Investments', 'rgb(var(--c-inc))']].map(([l, c]) => (
                      <div key={l} className="flex items-center gap-2 text-txt-2">
                        <span className="w-2 h-2 rounded-full" style={{ background: c }} />{l}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-3 card-inset rounded-lg px-3 py-2 flex items-center justify-between text-[11px]">
                  <span className="text-txt-3">Daily limit</span>
                  <span className="text-txt-1 font-semibold tabular">TZS 138,500 <span className="text-txt-3 font-normal">of 200,000</span></span>
                </div>
              </BentoTile>
            </FadeIn>

            {/* AI controller strip — full width */}
            <FadeIn delay={0.36} className="md:col-span-3">
              <BentoTile lite={env.lite} glowChannels={glowChannels} className="p-5">
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                  <div className="flex items-center gap-3 md:w-64 flex-shrink-0">
                    <Icon name="bot" size={24} className="text-accent" />
                    <div>
                      <div className="text-[13px] text-txt-1 font-semibold">AI controller</div>
                      <div className="text-[11px] text-txt-3">Ask anything in Kiswahili or English</div>
                    </div>
                  </div>
                  <div className="flex-1 card-inset rounded-xl px-4 py-3 font-mono text-[13px] text-txt-1 min-h-[44px]">
                    {env.reduced ? (
                      <span>Nimetumia kiasi gani kwenye chakula mwezi huu?</span>
                    ) : (
                      <TextType
                        as="span"
                        text={[
                          'Nimetumia kiasi gani kwenye chakula mwezi huu?',
                          'How much did I spend on food this month?',
                          'Ada gani zimefichwa kwenye taarifa yangu?',
                          'Which fees am I quietly paying?',
                        ]}
                        typingSpeed={38}
                        deletingSpeed={16}
                        pauseDuration={2200}
                        showCursor
                        cursorCharacter="▌"
                        cursorClassName="text-accent"
                      />
                    )}
                  </div>
                </div>
              </BentoTile>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* --------------------- RECONCILIATION & PERSONAL SPENDING ------- */}
      <section id="recon" ref={reconRef} className="relative py-16 lg:py-20 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <FadeIn>
            <div className="max-w-2xl mb-10">
              <Eyebrow>{t('land.recon.eyebrow')}</Eyebrow>
              <h2 className="mt-4 text-3xl lg:text-5xl font-semibold tracking-tightest leading-[1.05]">
                {t('land.recon.title.l1')}{' '}
                <span className="font-serif-i text-txt-2">{t('land.recon.title.l2')}</span>
              </h2>
              <p className="mt-5 text-base text-txt-2 leading-relaxed">{t('land.recon.lede')}</p>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-2 gap-5">
            {/* Reconciliation — the books tie, line by line */}
            <FadeIn>
              <div className="card-soft p-6 lg:p-7 h-full relative overflow-hidden">
                <div className="flex items-center justify-between mb-5">
                  <Eyebrow>Reconciliation</Eyebrow>
                  <motion.span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-inc/15 text-inc text-[11px] font-semibold"
                    initial={env.reduced ? false : { opacity: 0, scale: 0.5 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={viewportOnce}
                    transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 1.4 }}
                  >
                    ✓ {t('land.recon.ties')}
                  </motion.span>
                </div>
                {[
                  { l: 'Opening balance',      v: 'TZS 1,240,000',  c: 'text-txt-1' },
                  { l: 'Money in',             v: '+ 5,150,000',    c: 'text-inc' },
                  { l: 'Money out',            v: '− 2,530,000',    c: 'text-dng' },
                  { l: 'Bank charges & fees',  v: '− 38,200',       c: 'text-dng' },
                  { l: 'Closing (statement)',  v: 'TZS 3,821,800',  c: 'text-txt-1', top: true },
                  { l: 'Closing (computed)',   v: 'TZS 3,821,800',  c: 'text-accent' },
                ].map((r, i) => (
                  <motion.div
                    key={r.l}
                    className={`flex items-center justify-between py-2 text-sm ${r.top ? 'border-t border-bdr/60 mt-2 pt-3' : ''}`}
                    initial={env.reduced ? false : { opacity: 0, x: -14 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true, amount: 0.5 }}
                    transition={{ duration: 0.4, delay: 0.15 + i * 0.18 }}
                  >
                    <span className="text-txt-2">{r.l}</span>
                    <span className={`font-semibold tabular ${r.c}`}>{r.v}</span>
                  </motion.div>
                ))}
                <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-exp/10 text-exp text-[11px]">
                  <Icon name="eye" size={12} /> 2 {t('land.recon.flagged')}
                </div>
              </div>
            </FadeIn>

            {/* Personal spending — categories + budget */}
            <FadeIn delay={0.12}>
              <div className="card-soft p-6 lg:p-7 h-full">
                <div className="flex items-center justify-between mb-5">
                  <Eyebrow>{t('land.recon.spend')}</Eyebrow>
                  <span className="font-mono text-[10px] tracking-ticker text-txt-3">NOV · 26</span>
                </div>
                <div className="space-y-4">
                  {[
                    { l: 'Groceries', pct: 34, c: 'rgb(var(--c-accent))' },
                    { l: 'Transport', pct: 22, c: 'rgb(var(--c-net))' },
                    { l: 'Dining',    pct: 18, c: 'rgb(var(--c-inc))' },
                    { l: 'Airtime & data', pct: 12, c: 'rgb(var(--c-exp))' },
                    { l: 'Other',     pct: 14, c: 'rgb(var(--c-s5))' },
                  ].map((m, i) => (
                    <div key={m.l}>
                      <div className="flex justify-between items-baseline mb-1.5 text-sm">
                        <span className="text-txt-2">{m.l}</span>
                        <span className="font-semibold tabular text-txt-1">{m.pct}%</span>
                      </div>
                      <div className="h-1.5 bg-surface-4 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: m.c, boxShadow: `0 0 10px ${m.c}` }}
                          initial={env.reduced ? { width: `${m.pct * 2.4}%` } : { width: 0 }}
                          whileInView={{ width: `${m.pct * 2.4}%` }}
                          viewport={{ once: true, amount: 0.5 }}
                          transition={{ duration: 0.9, delay: 0.15 + i * 0.12, ease: 'easeOut' }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-6 card-inset rounded-xl px-4 py-3">
                  <div className="flex justify-between items-baseline mb-2 text-[12px]">
                    <span className="text-txt-3">{t('land.recon.budget')}</span>
                    <span className="font-semibold tabular text-txt-1">68%</span>
                  </div>
                  <div className="h-2 bg-surface-4 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: 'linear-gradient(90deg, rgb(var(--c-accent)), rgb(var(--c-net)))' }}
                      initial={env.reduced ? { width: '68%' } : { width: 0 }}
                      whileInView={{ width: '68%' }}
                      viewport={{ once: true, amount: 0.5 }}
                      transition={{ duration: 1.1, delay: 0.5, ease: 'easeOut' }}
                    />
                  </div>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* --------------------------------------------- MARKETS SHOWCASE */}
      {/* Real TZS notes in orbit with DSE, crypto and world indexes. Shares
          the unified page background (Light Pillar / Hyperspeed) like every
          other section — theme-adaptive via tokens. */}
      <section
        id="markets"
        ref={marketsRef}
        className="relative overflow-hidden py-20 lg:py-28 scroll-mt-16"
      >
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(60% 50% at 50% 60%, rgb(var(--c-accent) / 0.06), transparent 70%)',
        }} />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <FadeIn>
            <div className="text-center max-w-2xl mx-auto">
              <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-ticker text-txt-3">
                <span className="w-1.5 h-1.5 rounded-full bg-accent anim-pulse-soft" />
                {t('land.markets.eyebrow')} ·
                {env.reduced ? (
                  <span className="text-accent">DSE</span>
                ) : (
                  <RotatingText
                    texts={['DSE', 'CRYPTO', 'S&P 500', 'FX · BONDS']}
                    mainClassName="text-accent"
                    splitBy="characters"
                    staggerFrom="last"
                    staggerDuration={0.015}
                    rotationInterval={2000}
                    transition={{ type: 'spring', damping: 28, stiffness: 340 }}
                  />
                )}
              </span>
              <h2 className="mt-4 text-3xl lg:text-5xl font-semibold tracking-tightest leading-[1.05] text-txt-1">
                {env.reduced ? (
                  <>
                    {t('land.markets.title.l1')}{' '}
                    <span className="gradient-text">{t('land.markets.title.l2')}</span>
                  </>
                ) : (
                  <TrueFocus
                    sentence={`${t('land.markets.title.l1')} ${t('land.markets.title.l2')}`}
                    blurAmount={4}
                    borderColor={tokenHex('--c-accent')}
                    glowColor={`rgba(${tokenChannels('--c-accent')}, 0.6)`}
                    animationDuration={0.6}
                    pauseBetweenAnimations={1.4}
                  />
                )}
              </h2>
              <p className="mt-5 text-base text-txt-3 leading-relaxed">
                {t('land.markets.lede')}
              </p>
            </div>
          </FadeIn>

          <div className="relative mt-10 lg:mt-14 h-[380px] sm:h-[440px] lg:h-[500px]">
            {marketsMotion.notes && !env.reduced && (
              <NoteLayer
                variant={marketsMotion.notes}
                denoms={marketsMotion.noteProps?.denoms}
                count={marketsMotion.noteProps?.count}
                glow={marketsMotion.noteProps?.glow}
                className="absolute inset-0"
              />
            )}
            {env.reduced && (
              <div className="absolute inset-0 flex items-center justify-center">
                <NoteLayer variant="flip" denoms={['10k']} glow="accent" width={260} />
              </div>
            )}

            {!env.reduced && (
              <OrbitRing
                className="absolute inset-0"
                radius={env.lite ? 220 : 430}
                duration={64}
                tilt={-9}
                items={orbitAssets.slice(0, env.lite ? 5 : 8).map((a) => {
                  const pctText = formatPct(a.pct);
                  const up = (a.pct ?? 0) >= 0;
                  return (
                    <div
                      key={a.sym}
                      className="w-[132px] rounded-2xl border border-bdr/70 bg-surface-1/70 backdrop-blur-md px-4 py-3 text-left shadow-[0_18px_40px_-18px_rgba(0,0,0,0.55)]"
                    >
                      <div className="font-mono text-[10px] uppercase tracking-ticker text-txt-3">{a.sym}</div>
                      <div className="mt-1 text-[15px] font-semibold tabular text-txt-1">{a.val}</div>
                      {pctText && (
                        <div className={`mt-0.5 font-mono text-[11px] tabular ${up ? 'text-inc' : 'text-dng'}`}>
                          {pctText}
                        </div>
                      )}
                    </div>
                  );
                })}
              />
            )}
          </div>

          <FadeIn delay={0.1}>
            <p className="mt-8 text-center font-mono text-[10px] uppercase tracking-ticker text-txt-3">
              {t('land.markets.fine')}
            </p>
          </FadeIn>
        </div>
      </section>

      {/* --------------------- WHY — Swyftx note ring + real system facts */}
      <section id="why" ref={whyRef} className="relative py-16 lg:py-24 overflow-hidden scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-6 items-center">
            <FadeIn className="lg:col-span-5">
              <Eyebrow>{t('land.why.eyebrow')}</Eyebrow>
              <h2 className="mt-4 text-3xl lg:text-5xl font-semibold tracking-tightest leading-[1.05]">
                {t('land.why.title.l1')} <span className="font-serif-i text-txt-2">{t('land.why.title.l2')}</span>
              </h2>
              <p className="mt-6 text-base text-txt-2 leading-relaxed max-w-xl">
                {t('land.why.lede')}
              </p>
              {/* Real, shipping capabilities — no invented numbers */}
              <div className="mt-8 space-y-4 max-w-xl">
                {[
                  ['CRDB · NMB · NBC · Stanbic', 'bank statements — PDFs or photographed pages — parsed into one ledger'],
                  ['M-Pesa · Airtel Money', 'mobile-money statements reconciled right next to your bank'],
                  ['TRA receipts', 'snap a receipt; vendor, VAT and line items come back typed'],
                  ['Kiswahili & English', 'an AI controller grounded on your actual statement'],
                  ['Auto-reconciliation', 'every upload is balanced against the closing figure'],
                  ['DSE · Crypto · Forex', 'live markets and an investment simulator beside your cash flow'],
                ].map(([n, d], i) => (
                  <FadeIn key={n} delay={i * 0.06}>
                    <div className="flex items-baseline gap-4 border-b border-bdr/50 pb-3">
                      <span className="font-mono text-[11px] uppercase tracking-ticker text-accent w-44 flex-shrink-0 leading-relaxed">{n}</span>
                      <span className="text-sm text-txt-2 leading-relaxed">
                        <MotionHeading fx={whyMotion.heading} text={d} />
                      </span>
                    </div>
                  </FadeIn>
                ))}
              </div>
            </FadeIn>

            {/* The Swyftx ring — the nation's cash, in rotation */}
            <div className="lg:col-span-7 relative h-[360px] sm:h-[440px] lg:h-[520px]">
              {env.reduced ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <NoteLayer variant="flip" denoms={['1k']} glow="net" width={280} />
                </div>
              ) : (
                <OrbitRing
                  className="absolute inset-0"
                  radius={env.lite ? 150 : 300}
                  duration={40}
                  tilt={-12}
                  items={(env.lite ? ['1k', '5k', '10k'] : ['1k', '2k', '5k', '10k', '1k', '2k', '5k', '10k']).map((denom, i) => (
                    <WhyRingNote key={`${denom}-${i}`} denom={denom} side={i > 3 ? 'back' : 'front'} lite={env.lite} />
                  ))}
                />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- CTA */}
      <section ref={ctaRef} className="relative py-16 lg:py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="relative card-soft p-10 lg:p-16 overflow-hidden">
              <div className="absolute inset-0 grid-dot opacity-40" />

              <div className="relative grid lg:grid-cols-12 gap-8 items-center">
                <div className="lg:col-span-7">
                  <Eyebrow>{t('land.cta.eyebrow')}</Eyebrow>
                  <h2 className="mt-4 text-3xl lg:text-[44px] font-semibold tracking-tightest leading-[1.05]">
                    <MotionHeading fx={ctaMotion.heading} tag="span" text={t('land.cta.title.l1')} className="block" />
                    <span className="block font-serif-i text-txt-2">{t('land.cta.title.l2')}</span>
                  </h2>
                  <p className="mt-4 text-sm lg:text-base text-txt-2 max-w-md leading-relaxed">
                    {t('land.cta.lede')}
                  </p>

                  {ctaMotion.notes && !env.reduced && (
                    <div className="mt-8 hidden lg:block" aria-hidden>
                      <NoteLayer
                        variant={ctaMotion.notes}
                        denoms={ctaMotion.noteProps?.denoms}
                        glow={ctaMotion.noteProps?.glow}
                      />
                    </div>
                  )}
                </div>
                <div className="lg:col-span-5 flex flex-col gap-3">
                  <ClickSpark sparkColor={tokenHex('--c-accent-h')} sparkRadius={24} sparkCount={10}>
                    <div className="flex flex-col gap-3">
                      <Magnet disabled={env.lite} magnetStrength={8} padding={50}>
                        <StarBorder
                          as={Link}
                          to="/signup"
                          color={tokenHex('--c-accent-h')}
                          speed="4.5s"
                          className="w-full"
                          innerClassName="btn-primary px-6 py-3.5 font-semibold flex items-center justify-center gap-2 !rounded-[18px]"
                        >
                          {t('land.startTrial')}
                          <Icon name="arrowRight" size={16} />
                        </StarBorder>
                      </Magnet>
                      <Link to="/signin" className="press btn-secondary px-6 py-3.5 rounded-xl font-semibold inline-flex items-center justify-center">
                        {t('nav.signin')}
                      </Link>
                    </div>
                  </ClickSpark>
                  <FadeIn delay={0.25}>
                    <p className="text-[11px] text-txt-3 text-center pt-1">
                      {t('land.cta.fine')}
                    </p>
                  </FadeIn>
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
            <p className="inline-flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-accent to-net" />
              {t('foot.built')}
            </p>
          </div>
        </div>
      </footer>
      </div>
    </div>
  );
};

/* Why-ring item: a banknote loaded from the shared manifest cache */
const WhyRingNote = ({ denom, side, lite }) => {
  const manifest = useNoteManifest();
  if (!manifest) return <span className="inline-block w-[150px] h-[72px]" />;
  return <NoteImg manifest={manifest} denom={denom} side={side} width={lite ? 120 : 180} glow="accent" />;
};

const LandingPage = () => (
  <MotionProvider>
    <LandingInner />
  </MotionProvider>
);

export default LandingPage;
