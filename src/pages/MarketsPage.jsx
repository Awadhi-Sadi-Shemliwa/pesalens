import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../components/navigation';
import { Icon } from '../components/Icon';
import { Badge, Eyebrow, Sparkline, CountUp, readToken } from '../components/common';
import { TiltCard } from '../components/motion';
import { ChartJS, chartTheme } from '../components/ChartJS';
import { useT, AutoT } from '../data/i18n';
import { askMarketInsight, fetchMarketSnapshot } from '../data/api';

/* ----------------------------------------------------------------
   Markets — live data view backed by the PesaLens market bot.

   Layout follows the "Market UI" reference (SoSoValue-style command
   deck): a ticker strip, asset-class tabs driving one main table, a
   trending / movers / sentiment-gauge row, and a right rail of
   spotlight + sector heatmap + up/down distribution. The market-cap
   trend chart and per-row sparklines are borrowed from "Market UI2",
   and the summary index cards + performance graph from "Market UI3".

   Tanzanian feeds (DSE / BOT / EWURA) plus international references
   (crypto, equity indices, Polymarket) are pulled from the backend
   cache, which the scheduler refreshes on its own cadence. The page
   itself never scrapes anything live — it just reads the cache.
   ---------------------------------------------------------------- */

// Quick-ask keys; the actual labels come from t(...) at render time so
// they switch instantly when the user toggles language.
const QUICK_ASK_KEYS = ['mki.quick.1', 'mki.quick.2', 'mki.quick.3', 'mki.quick.4', 'mki.quick.5'];

// The backend returns this exact phrase in its offline fallback. We
// detect it client-side so the chat surface can show a status banner
// instead of treating the fallback like a normal AI reply.
const OFFLINE_MARKER = 'PesaLens AI advisor is offline';

const fmt = (v, decimals = 2) => {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return Number(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const fmtCompact = (v) => {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return n.toLocaleString('en-US');
};

const fmtAge = (iso) => {
  if (!iso) return 'never';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return 'never';
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

const Delta = ({ pct, size = 11 }) => {
  if (pct == null || Number.isNaN(Number(pct))) return <span className="text-txt-3">—</span>;
  const n = Number(pct);
  const up = n >= 0;
  return (
    <span className={`inline-flex items-center gap-1 font-mono tabular ${up ? 'text-inc' : 'text-dng'}`} style={{ fontSize: size }}>
      <Icon name={up ? 'arrowUpRight' : 'arrowDownRight'} size={size} />
      {up ? '+' : ''}{n.toFixed(2)}%
    </span>
  );
};

/* Deterministic pseudo-random walk so sparklines / area charts stay
   stable across renders (no flicker). The tail is biased so the visible
   slope agrees with the real 24h change sign — the line is an INDICATIVE
   trend glyph, not fabricated history, and is always labelled as such. */
const seededSeries = (seed, n = 24, pct = 0) => {
  let s = 2166136261;
  const str = String(seed);
  for (let i = 0; i < str.length; i++) { s ^= str.charCodeAt(i); s = Math.imul(s, 16777619); }
  const rnd = () => { s = Math.imul(s ^ (s >>> 15), 2246822507); s ^= s >>> 13; return ((s >>> 0) % 1000) / 1000; };
  const out = [];
  let v = 50;
  for (let i = 0; i < n; i++) { v += (rnd() - 0.5) * 6; out.push(v); }
  const dir = pct >= 0 ? 1 : -1;
  const from = Math.floor(n * 0.55);
  const mag = Math.min(3, 0.6 + Math.abs(pct) * 0.15);
  for (let i = from; i < n; i++) out[i] += dir * (i - from) * mag;
  return out;
};

const sparkColor = (pct) => (Number(pct) >= 0 ? readToken('--c-inc', '#10B981') : readToken('--c-dng', '#EF4444'));

/* Static class map — Tailwind's JIT can't see runtime `text-${x}` strings,
   so every tone-driven class is spelled out here. */
const TONE = {
  inc:     { text: 'text-inc',    bg: 'bg-inc/10',    badge: 'income' },
  exp:     { text: 'text-exp',    bg: 'bg-exp/10',    badge: 'expense' },
  dng:     { text: 'text-dng',    bg: 'bg-dng/10',    badge: 'danger' },
  net:     { text: 'text-net',    bg: 'bg-net/10',    badge: 'net' },
  accent:  { text: 'text-accent', bg: 'bg-accent/10', badge: 'accent' },
  'txt-1': { text: 'text-txt-1',  bg: '',             badge: 'muted' },
};

/* Collapse every feed that carries a change_pct into one comparable
   universe — used by trending / movers / gauge / spotlight / sector
   / distribution so those widgets always have something to show. */
const buildUniverse = (snapshot) => {
  const dse = (snapshot?.dse?.data || []).map((r) => ({
    cls: 'DSE', symbol: r.symbol, name: r.name, change: Number(r.change_pct) || 0,
    price: Number(r.price) || 0, priceStr: `TZS ${fmt(r.price)}`, vol: r.volume,
  }));
  const crypto = (snapshot?.crypto?.data || []).map((r) => ({
    cls: 'Crypto', symbol: r.symbol, name: r.name, change: Number(r.change_pct) || 0,
    price: Number(r.price_usd) || 0, priceStr: `$${fmt(r.price_usd)}`, vol: null,
  }));
  const indices = (snapshot?.indices?.data || []).map((r) => ({
    cls: 'Index', symbol: r.symbol, name: r.name, change: Number(r.change_pct) || 0,
    price: Number(r.price) || 0, priceStr: `${fmt(r.price)} ${r.currency || ''}`, vol: null,
  }));
  return { dse, crypto, indices, all: [...dse, ...crypto, ...indices] };
};

/* ================================================================
   MarketExplorer — a category-driven overview. Three selector cards
   (DSE · Crypto · Global Indices) scope the leaders, the pulse chart
   and the self-describing sentiment gauge to ONE category at a time,
   so every number on screen belongs to the same market.
   ================================================================ */
const CATEGORIES = [
  { id: 'dse',     label: 'DSE Equities',   sub: 'Dar es Salaam Stock Exchange', icon: 'chart' },
  { id: 'crypto',  label: 'Crypto',         sub: 'Bitcoin, Ethereum & altcoins', icon: 'zap' },
  { id: 'indices', label: 'Global Indices', sub: 'Nasdaq · S&P 500 · FTSE',       icon: 'globe' },
];

const catAvg = (rows) => (rows && rows.length ? rows.reduce((s, x) => s + x.change, 0) / rows.length : 0);

/* The three selectable category cards. */
const CategorySelector = ({ universe, active, onPick }) => (
  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
    {CATEGORIES.map((c) => {
      const rows = universe[c.id] || [];
      const avg = catAvg(rows);
      const on = c.id === active;
      return (
        <TiltCard key={c.id} max={6} className="h-full">
          <button
            type="button"
            onClick={() => onPick(c.id)}
            aria-pressed={on}
            className={`relative w-full h-full text-left glass-pane rounded-2xl border p-4 sm:p-5 overflow-hidden transition
              ${on ? 'border-accent/40 ring-2 ring-accent/40' : 'border-bdr/60 hover:border-bdr-hover'}`}
          >
            <span aria-hidden className={`absolute -right-10 -top-10 w-28 h-28 rounded-full blur-2xl bg-accent/15 pointer-events-none transition-opacity ${on ? 'opacity-100' : 'opacity-0'}`} />
            <div className="relative flex items-start justify-between gap-2 mb-3">
              <span className={`p-2 rounded-lg ${on ? 'bg-accent/15 text-accent' : 'bg-surface-4/60 text-txt-2'}`}><Icon name={c.icon} size={16} /></span>
              {on && <span className="text-[10px] uppercase tracking-ticker font-semibold text-accent">Viewing</span>}
            </div>
            <div className="relative font-semibold text-sm sm:text-base">{c.label}</div>
            <div className="relative text-[11px] text-txt-3 truncate">{c.sub}</div>
            <div className="relative mt-3 flex items-center justify-between gap-2">
              <span className="text-[11px] text-txt-3 font-mono tabular">{rows.length} assets</span>
              <Delta pct={avg} size={12} />
            </div>
          </button>
        </TiltCard>
      );
    })}
  </div>
);

/* Leaders of the chosen category — top performers by 24h move. */
const Leaders = ({ rows, label }) => {
  const picks = (rows || []).slice().sort((a, b) => b.change - a.change).slice(0, 3);
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Icon name="trending" size={14} className="text-accent" />
        <h3 className="text-sm font-semibold">Leaders in {label}</h3>
        <span className="text-[11px] text-txt-3 font-mono uppercase tracking-ticker">top performers · 24h</span>
      </div>
      {picks.length === 0 ? (
        <div className="bento p-6 text-center text-xs text-txt-3">No {label} data cached yet — the bot will retry.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {picks.map((p, i) => (
            <TiltCard key={p.cls + p.symbol} max={6} className="bento p-4 sm:p-5 relative overflow-hidden">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="min-w-0 flex items-center gap-2">
                  <span className="text-[11px] font-mono text-txt-3 w-4 flex-shrink-0">#{i + 1}</span>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{p.symbol}</div>
                    <div className="text-[10px] uppercase tracking-ticker text-txt-3 truncate">{p.name || p.cls}</div>
                  </div>
                </div>
                <Badge color={p.change >= 0 ? 'income' : 'danger'} className="flex-shrink-0">{p.change >= 0 ? 'Up' : 'Down'}</Badge>
              </div>
              <div className="text-xl sm:text-2xl font-semibold tabular truncate">{p.priceStr}</div>
              <div className="mt-1 mb-2"><Delta pct={p.change} /></div>
              <div className="-mx-1"><Sparkline values={seededSeries(p.symbol + p.cls, 20, p.change)} height={40} color={sparkColor(p.change)} strokeWidth={1.8} /></div>
            </TiltCard>
          ))}
        </div>
      )}
    </div>
  );
};

/* ================================================================
   Market-cap trend chart (Market UI2) — indicative, timeframe tabs.
   ================================================================ */
const TREND_TF = [
  { id: '24H', n: 24 },
  { id: '7D', n: 28 },
  { id: '30D', n: 30 },
];
const MarketPulse = ({ rows, label, catId }) => {
  const [tf, setTf] = useState('7D');
  const avgChange = catAvg(rows);
  const n = TREND_TF.find((t) => t.id === tf)?.n || 28;
  const th = chartTheme();

  const data = useMemo(() => {
    const series = seededSeries('pulse-' + catId + '-' + tf, n, avgChange);
    return {
      labels: series.map((_, i) => i),
      datasets: [{
        data: series,
        borderColor: th.accent,
        backgroundColor: th.accentFill,
        fill: true,
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: th.accent,
      }],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tf, avgChange, n, catId]);

  const options = {
    scales: {
      x: { display: false, grid: { display: false } },
      y: { display: false, grid: { display: false } },
    },
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    elements: { line: { borderJoinStyle: 'round' } },
  };

  return (
    <div className="bento p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div className="min-w-0">
          <Eyebrow num="01">Market pulse</Eyebrow>
          <h3 className="mt-2 text-sm sm:text-base font-semibold tracking-tight">{label} direction</h3>
          <p className="text-[11px] text-txt-3 mt-1">
            Indicative curve — reflects the average 24h move across {rows.length} {label} asset{rows.length === 1 ? '' : 's'}.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-bdr/60 p-0.5 self-start flex-shrink-0">
          {TREND_TF.map((t) => (
            <button
              key={t.id}
              onClick={() => setTf(t.id)}
              className={`text-[11px] px-2.5 py-1 rounded-md transition font-medium ${
                tf === t.id ? 'bg-accent/15 text-accent' : 'text-txt-3 hover:text-txt-1'
              }`}
            >
              {t.id}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-baseline gap-3 mb-3">
        <span className={`text-2xl sm:text-3xl font-semibold tabular ${avgChange >= 0 ? 'text-inc' : 'text-dng'}`}>
          {avgChange >= 0 ? '+' : ''}{avgChange.toFixed(2)}%
        </span>
        <span className="text-[11px] uppercase tracking-ticker text-txt-3 font-mono">avg 24h move · {label}</span>
      </div>
      <ChartJS type="line" data={data} options={options} height={180} />
    </div>
  );
};

/* ================================================================
   Sentiment gauge — a self-describing "Fear & Greed" dial scoped to
   the chosen category, with plain-English what-it-means / why-it-
   matters copy underneath.
   ================================================================ */
const Sentiment = ({ rows, label }) => {
  const avg = catAvg(rows);
  const score = Math.max(0, Math.min(100, Math.round(50 + avg * 7)));
  const band = score >= 66
    ? { label: 'Bullish', tone: 'inc', color: readToken('--c-inc', '#10B981'),
        means: `Most ${label} assets are rising — buyers are in control right now.` }
    : score >= 40
    ? { label: 'Neutral', tone: 'net', color: readToken('--c-net', '#3884F5'),
        means: `${label} is roughly balanced — gains and losses are cancelling out.` }
    : { label: 'Bearish', tone: 'dng', color: readToken('--c-dng', '#EF4444'),
        means: `Most ${label} assets are falling — sellers are in control right now.` };

  // Semicircle: angle from -90° (0) to +90° (100)
  const angle = -90 + (score / 100) * 180;
  const R = 62, cx = 80, cy = 78;
  const rad = (angle * Math.PI) / 180;
  const nx = cx + Math.sin(rad) * (R - 8);
  const ny = cy - Math.cos(rad) * (R - 8);

  return (
    <div className="bento p-4 sm:p-5 flex flex-col">
      <div className="flex items-center justify-between gap-2 mb-2">
        <Eyebrow>Sentiment · {label}</Eyebrow>
        <Badge color={TONE[band.tone].badge} dot>{band.label}</Badge>
      </div>
      <div className="flex items-center justify-center">
        <svg viewBox="0 0 160 96" className="w-full max-w-[190px]">
          <defs>
            <linearGradient id="gauge-arc" x1="0" x2="1">
              <stop offset="0%" stopColor={readToken('--c-dng', '#EF4444')} />
              <stop offset="50%" stopColor={readToken('--c-net', '#3884F5')} />
              <stop offset="100%" stopColor={readToken('--c-inc', '#10B981')} />
            </linearGradient>
          </defs>
          <path d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`}
                fill="none" stroke="url(#gauge-arc)" strokeWidth="10" strokeLinecap="round" opacity="0.85" />
          <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={band.color} strokeWidth="3" strokeLinecap="round" />
          <circle cx={cx} cy={cy} r="5" fill={band.color} />
        </svg>
      </div>
      <div className="text-center -mt-1 mb-3">
        <div className={`text-3xl font-semibold tabular ${TONE[band.tone].text}`}>
          <CountUp value={score} />
        </div>
        <div className="text-[10px] uppercase tracking-ticker text-txt-3 font-mono">/ 100 · {label} pulse</div>
      </div>
      <div className="surface-inset rounded-xl p-3 space-y-1.5 mt-auto">
        <p className="text-xs text-txt-2 leading-relaxed">
          <span className="font-semibold text-txt-1">What it means: </span>{band.means}
        </p>
        <p className="text-[11px] text-txt-3 leading-relaxed">
          <span className="font-semibold text-txt-2">Why it matters: </span>
          it folds dozens of price moves into one number, so you can read the mood of {label} at a glance instead of scanning every row.
        </p>
      </div>
    </div>
  );
};

/* Wrapper that owns the selected category and lays out the top block. */
const MarketExplorer = ({ universe }) => {
  const [cat, setCat] = useState('dse');
  const active = CATEGORIES.find((c) => c.id === cat) || CATEGORIES[0];
  const rows = universe[cat] || [];
  return (
    <div className="space-y-4 sm:space-y-5">
      <CategorySelector universe={universe} active={cat} onPick={setCat} />
      <Leaders rows={rows} label={active.label} />
      <div className="grid lg:grid-cols-3 gap-4 sm:gap-5">
        <div className="lg:col-span-2"><MarketPulse rows={rows} label={active.label} catId={cat} /></div>
        <Sentiment rows={rows} label={active.label} />
      </div>
    </div>
  );
};

/* ================================================================
   Per-market gainers / decliners — scoped to the ACTIVE tab so DSE,
   Crypto and Indices never get mixed together (Market UI's "Trending"
   + "Hot", but tied to the market you clicked).
   ================================================================ */
const HighlightCard = ({ item, kind }) => {
  const up = kind === 'gain';
  return (
    <div className={`surface-inset rounded-xl p-3 sm:p-4 border relative overflow-hidden ${up ? 'border-inc/25' : 'border-dng/25'}`}>
      <span aria-hidden className={`absolute -right-6 -top-6 w-20 h-20 rounded-full blur-2xl pointer-events-none ${up ? 'bg-inc/15' : 'bg-dng/15'}`} />
      <div className="relative flex items-center gap-1.5 mb-2">
        <Icon name={up ? 'trending' : 'arrowDownRight'} size={13} className={up ? 'text-inc' : 'text-dng'} />
        <span className="text-[10px] uppercase tracking-ticker text-txt-3 font-mono">{up ? 'Top performer' : 'Top decliner'}</span>
      </div>
      <div className="relative flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono font-semibold text-sm truncate">{item.symbol}</div>
          <div className="text-[10px] text-txt-3 truncate">{item.name || item.cls}</div>
          <div className="text-xs tabular text-txt-2 mt-1 truncate">{item.priceStr}</div>
        </div>
        <div className="text-right flex-shrink-0">
          <Delta pct={item.change} size={12} />
          <div className="w-16 mt-1.5 ml-auto">
            <Sparkline values={seededSeries(item.symbol + item.cls, 12, item.change)} height={22} color={sparkColor(item.change)} fill={false} strokeWidth={1.5} />
          </div>
        </div>
      </div>
    </div>
  );
};

const ClassMovers = ({ rows }) => {
  if (!rows || rows.length < 2) return null;
  const sorted = [...rows].sort((a, b) => b.change - a.change);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  if (top.symbol === bottom.symbol) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
      <HighlightCard item={top} kind="gain" />
      <HighlightCard item={bottom} kind="lose" />
    </div>
  );
};

/* ================================================================
   Right rail — Spotlight tags · Sector heatmap · Up/down histogram.
   ================================================================ */
const heatTone = (c) => {
  if (c >= 3) return 'bg-inc/25 text-inc border-inc/30';
  if (c >= 0.5) return 'bg-inc/12 text-inc border-inc/20';
  if (c > -0.5) return 'bg-surface-4/60 text-txt-2 border-bdr/50';
  if (c > -3) return 'bg-dng/12 text-dng border-dng/20';
  return 'bg-dng/25 text-dng border-dng/30';
};

const Spotlight = ({ universe }) => {
  const tags = universe.all
    .slice()
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 10);
  return (
    <div className="bento p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="sparkles" size={14} className="text-accent" />
        <h4 className="font-semibold text-sm">Spotlight</h4>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span key={t.cls + t.symbol}
                className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border ${heatTone(t.change)}`}>
            <span className="font-mono font-semibold">{t.symbol}</span>
            <span className="tabular">{t.change >= 0 ? '+' : ''}{t.change.toFixed(1)}%</span>
          </span>
        ))}
        {!tags.length && <p className="text-xs text-txt-3">No movers cached yet.</p>}
      </div>
    </div>
  );
};

const SectorMover = ({ universe }) => {
  const sectors = [
    { key: 'DSE', label: 'DSE Equities', rows: universe.dse },
    { key: 'Crypto', label: 'Crypto', rows: universe.crypto },
    { key: 'Index', label: 'World Indices', rows: universe.indices },
  ].map((s) => ({
    ...s,
    avg: s.rows.length ? s.rows.reduce((a, x) => a + x.change, 0) / s.rows.length : null,
    top: s.rows.slice().sort((a, b) => b.change - a.change)[0],
  }));
  return (
    <div className="bento p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="dashboard" size={14} className="text-net" />
        <h4 className="font-semibold text-sm">Sector movers</h4>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {sectors.map((s) => (
          <div key={s.key} className={`rounded-xl border p-2.5 ${s.avg == null ? 'bg-surface-4/40 border-bdr/50' : heatTone(s.avg)}`}>
            <div className="text-[10px] uppercase tracking-ticker opacity-80 truncate">{s.label}</div>
            <div className="text-sm font-semibold tabular mt-1">
              {s.avg == null ? '—' : `${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%`}
            </div>
            {s.top && <div className="text-[10px] font-mono opacity-70 truncate mt-0.5">▲ {s.top.symbol}</div>}
          </div>
        ))}
      </div>
    </div>
  );
};

const Distribution = ({ universe }) => {
  // Bucket every asset's 24h change into columns, colored red→green.
  const buckets = [
    { label: '≤-5', min: -Infinity, max: -5 },
    { label: '-5..-2', min: -5, max: -2 },
    { label: '-2..0', min: -2, max: 0 },
    { label: '0..2', min: 0, max: 2 },
    { label: '2..5', min: 2, max: 5 },
    { label: '≥5', min: 5, max: Infinity },
  ].map((b) => ({ ...b, n: universe.all.filter((x) => x.change > b.min && x.change <= b.max).length }));
  const peak = Math.max(1, ...buckets.map((b) => b.n));
  return (
    <div className="bento p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="chart" size={14} className="text-txt-2" />
        <h4 className="font-semibold text-sm">Distribution of moves</h4>
      </div>
      <div className="flex items-end justify-between gap-1.5 h-24">
        {buckets.map((b, i) => {
          const up = i >= 3;
          return (
            <div key={b.label} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <span className="text-[9px] text-txt-3 tabular">{b.n || ''}</span>
              <div className="w-full rounded-t-md transition-all"
                   style={{ height: `${(b.n / peak) * 100}%`, minHeight: b.n ? 4 : 0,
                            background: up ? readToken('--c-inc', '#10B981') : readToken('--c-dng', '#EF4444'),
                            opacity: 0.35 + (b.n / peak) * 0.6 }} />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1.5">
        {buckets.map((b) => (
          <span key={b.label} className="text-[8px] text-txt-3 tabular flex-1 text-center">{b.label}</span>
        ))}
      </div>
    </div>
  );
};

/* ================================================================
   AI insight panel — chat with the market advisor agent.
   ================================================================ */
const InsightPanel = ({ snapshot }) => {
  const { t } = useT();
  const [history, setHistory] = useState([]);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [lastAttempt, setLastAttempt] = useState('');
  const scrollerRef = useRef(null);

  const errorMessage = (err) => {
    if (!err) return t('mki.error.generic');
    if (err.status === 0)   return t('mki.error.network');
    if (err.status === 401) return t('mki.error.unauth');
    if (err.status === 402) return t('mki.error.plan');
    return err.message || t('mki.error.generic');
  };

  const send = async (raw) => {
    const message = (raw ?? draft).trim();
    if (!message || pending) return;
    setError('');
    setDraft('');
    setLastAttempt(message);
    const next = [...history, { role: 'user', text: message }];
    setHistory(next);
    setPending(true);
    try {
      const { reply } = await askMarketInsight(message, history);
      const isOffline = typeof reply === 'string' && reply.includes(OFFLINE_MARKER);
      setOffline(isOffline);
      if (!isOffline) {
        setHistory((h) => [...h, { role: 'assistant', text: reply || t('mki.error.generic') }]);
      } else {
        setHistory([]);
      }
    } catch (err) {
      setError(errorMessage(err));
      setHistory((h) => [...h, { role: 'assistant', text: errorMessage(err) }]);
    } finally {
      setPending(false);
    }
  };

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [history, pending]);

  const dseCount    = snapshot?.dse?.data?.length || 0;
  const fxCount     = snapshot?.forex_bot?.data?.length || 0;
  const cryptoCount = snapshot?.crypto?.data?.length || 0;
  const headingTpl  = t('mki.heading');
  const heading     = headingTpl
    .replace('{dse}', dseCount)
    .replace('{fx}', fxCount)
    .replace('{coins}', cryptoCount);

  return (
    <div className="glass-pane rounded-[22px] p-4 sm:p-5 lg:p-6 border border-accent/25 relative overflow-hidden">
      <span aria-hidden className="absolute -right-16 -top-16 w-56 h-56 rounded-full blur-3xl bg-accent/10 pointer-events-none" />
      <span aria-hidden className="absolute -left-20 bottom-0 w-56 h-56 rounded-full blur-3xl bg-net/10 pointer-events-none" />
      <div className="relative flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <Eyebrow>{t('mki.eyebrow')}</Eyebrow>
          <h3 className="mt-2 text-sm sm:text-base font-semibold tracking-tight break-words">
            {heading}
          </h3>
          <p className="text-xs text-txt-3 mt-1">{t('mki.sub')}</p>
        </div>
        <Badge color="accent" dot className="self-start flex-shrink-0">{t('mki.badge')}</Badge>
      </div>

      {offline && (
        <div className="mb-4 rounded-xl border border-exp/30 bg-exp/5 p-3 sm:p-4">
          <div className="flex items-start gap-3">
            <div className="p-1.5 rounded-md bg-exp/15 text-exp flex-shrink-0">
              <Icon name="alert" size={14} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-txt-1 mb-1">{t('mki.offline.title')}</div>
              <p className="text-xs sm:text-sm text-txt-2 leading-relaxed break-words">
                {t('mki.offline.body')}
              </p>
            </div>
          </div>
        </div>
      )}

      <div ref={scrollerRef} className="space-y-3 max-h-72 overflow-y-auto pr-1 mb-3">
        {history.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-xs text-txt-3 mb-3">{t('mki.try')}</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {QUICK_ASK_KEYS.map((key) => (
                <button
                  key={key}
                  onClick={() => send(t(key))}
                  className="text-[11px] px-2.5 py-1.5 rounded-lg border border-bdr hover:border-accent/40 hover:bg-accent/5 text-txt-2 transition"
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          history.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[90%] px-3 py-2 rounded-xl text-xs sm:text-sm leading-relaxed break-words whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'btn-primary rounded-br-sm'
                    : 'bg-surface-4/70 text-txt-1 border border-bdr/60 rounded-bl-sm'
                }`}
              >
                {m.role === 'assistant' ? <AutoT>{m.text}</AutoT> : m.text}
              </div>
            </div>
          ))
        )}
        {pending && (
          <div className="flex justify-start">
            <div className="bg-surface-4/70 border border-bdr/60 px-3 py-2 rounded-xl rounded-bl-sm text-sm text-txt-2">
              <span className="inline-flex gap-1 items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse [animation-delay:0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse [animation-delay:0.3s]" />
              </span>
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="flex gap-2 items-center"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={pending}
          placeholder={t('mki.placeholder')}
          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-surface-4/60 border border-bdr/60 focus:border-accent/40 outline-none text-sm placeholder:text-txt-3"
        />
        <button
          type="submit"
          disabled={pending || !draft.trim()}
          className="btn-primary px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition flex items-center gap-1.5 flex-shrink-0"
          aria-label={t('mki.ask')}
        >
          <Icon name="send" size={14} />
          <span className="hidden sm:inline">{t('mki.ask')}</span>
        </button>
      </form>
      {error && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <p className="text-xs text-dng">{error}</p>
          {lastAttempt && (
            <button
              type="button"
              onClick={() => send(lastAttempt)}
              className="text-[11px] px-2 py-1 rounded-md border border-dng/30 text-dng hover:bg-dng/10 transition"
            >
              {t('mki.retry')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/* ================================================================
   Asset-class panels (the body of the main tabbed table).
   ================================================================ */
const DSE_FILTERS = [
  { id: 'volume',  label: 'Most Active', hint: 'Highest trading volume' },
  { id: 'price',   label: 'Top Price',   hint: 'Most expensive shares' },
  { id: 'gainers', label: 'Top Gainers', hint: 'Biggest % rise' },
  { id: 'losers',  label: 'Top Losers',  hint: 'Biggest % drop' },
  { id: 'movers',  label: 'Big Movers',  hint: 'Largest move either way' },
];

const DSEPanel = ({ payload }) => {
  const rows = payload?.data || [];
  const [filter, setFilter] = useState('volume');

  const sorted = useMemo(() => {
    const list = [...rows];
    switch (filter) {
      case 'price':   return list.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
      case 'gainers': return list.sort((a, b) => (Number(b.change_pct) || 0) - (Number(a.change_pct) || 0));
      case 'losers':  return list.sort((a, b) => (Number(a.change_pct) || 0) - (Number(b.change_pct) || 0));
      case 'movers':  return list.sort((a, b) => Math.abs(b.change_pct || 0) - Math.abs(a.change_pct || 0));
      case 'volume':
      default:        return list.sort((a, b) => (Number(b.volume) || 0) - (Number(a.volume) || 0));
    }
  }, [rows, filter]);

  if (!rows.length) return <EmptyPanel label="DSE feed has no data yet — the bot will retry." />;

  const visible = sorted.slice(0, 12);
  const volumeAsOf = visible.find((s) => s.volume_as_of)?.volume_as_of;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {DSE_FILTERS.map((f) => {
          const active = f.id === filter;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              title={f.hint}
              className={`text-[11px] sm:text-xs px-2.5 py-1.5 rounded-lg border transition ${
                active
                  ? 'border-accent/50 bg-accent/10 text-txt-1 font-medium'
                  : 'border-bdr/60 text-txt-2 hover:border-accent/30 hover:bg-accent/5'
              }`}
            >
              {f.label}
            </button>
          );
        })}
        {volumeAsOf && (filter === 'volume' || filter === 'price') && (
          <span className="ml-auto text-[10px] sm:text-[11px] text-txt-3 font-mono uppercase tracking-ticker">
            Vol as of {volumeAsOf}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead className="text-[10px] sm:text-[11px] uppercase tracking-ticker text-txt-3">
            <tr className="border-b border-bdr/60">
              <th className="text-left px-2 sm:px-3 py-2.5 font-medium">#</th>
              <th className="text-left px-2 sm:px-3 py-2.5 font-medium">Company</th>
              <th className="text-right px-2 sm:px-3 py-2.5 font-medium">Price</th>
              <th className="text-right px-2 sm:px-3 py-2.5 font-medium">24H %</th>
              <th className="text-right px-2 sm:px-3 py-2.5 font-medium hidden sm:table-cell">Trend</th>
              <th className="text-right px-2 sm:px-3 py-2.5 font-medium">Volume</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s, i) => (
              <tr key={s.symbol} className="border-b border-bdr/30 hover:bg-surface-4/30 transition">
                <td className="px-2 sm:px-3 py-2.5 text-txt-3 tabular">{i + 1}</td>
                <td className="px-2 sm:px-3 py-2.5">
                  <div className="font-mono font-semibold whitespace-nowrap">{s.symbol}</div>
                  <div className="text-[10px] text-txt-3 truncate max-w-[160px]">{s.name}</div>
                </td>
                <td className="px-2 sm:px-3 py-2.5 text-right tabular whitespace-nowrap font-medium">{fmt(s.price)}</td>
                <td className="px-2 sm:px-3 py-2.5 text-right whitespace-nowrap"><Delta pct={s.change_pct} /></td>
                <td className="px-2 sm:px-3 py-2.5 hidden sm:table-cell">
                  <div className="w-16 ml-auto"><Sparkline values={seededSeries(s.symbol, 12, s.change_pct)} height={20} color={sparkColor(s.change_pct)} fill={false} strokeWidth={1.4} /></div>
                </td>
                <td className="px-2 sm:px-3 py-2.5 text-right tabular whitespace-nowrap text-txt-2">{fmtCompact(s.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const ForexPanel = ({ bot, global: globalFx }) => {
  const botRates = bot?.data || [];
  const globalRates = globalFx?.data || [];
  if (!botRates.length && !globalRates.length) {
    return <EmptyPanel label="Bank of Tanzania scrape returned no rates yet." />;
  }
  const sortedBot = [...botRates].sort(
    (a, b) => (Number(b.selling) || Number(b.buying) || 0) - (Number(a.selling) || Number(a.buying) || 0)
  );
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="min-w-0">
        <h4 className="text-[11px] sm:text-xs uppercase tracking-ticker text-txt-3 mb-2 break-words">Bank of Tanzania · 1 unit = TZS</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="text-[10px] sm:text-[11px] uppercase tracking-ticker text-txt-3">
              <tr className="border-b border-bdr/60">
                <th className="text-left px-2 sm:px-3 py-2 font-medium">Currency</th>
                <th className="text-right px-2 sm:px-3 py-2 font-medium">Buy</th>
                <th className="text-right px-2 sm:px-3 py-2 font-medium">Sell</th>
              </tr>
            </thead>
            <tbody>
              {sortedBot.length === 0 && (
                <tr><td colSpan="3" className="px-3 py-3 text-center text-xs text-txt-3">No rates cached yet.</td></tr>
              )}
              {sortedBot.map((r, i) => (
                <tr key={r.currency} className={`border-b border-bdr/30 ${i === 0 ? 'bg-net/5' : ''}`}>
                  <td className="px-2 sm:px-3 py-2 font-mono font-medium whitespace-nowrap">
                    {i === 0 && <span className="text-net mr-1">★</span>}{r.currency}
                  </td>
                  <td className="px-2 sm:px-3 py-2 text-right tabular whitespace-nowrap">{fmt(r.buying)}</td>
                  <td className={`px-2 sm:px-3 py-2 text-right tabular whitespace-nowrap ${i === 0 ? 'font-semibold text-txt-1' : ''}`}>{fmt(r.selling)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="min-w-0">
        <h4 className="text-[11px] sm:text-xs uppercase tracking-ticker text-txt-3 mb-2 break-words">Global cross-check (USD base · ECB)</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="text-[10px] sm:text-[11px] uppercase tracking-ticker text-txt-3">
              <tr className="border-b border-bdr/60">
                <th className="text-left px-2 sm:px-3 py-2 font-medium">Currency</th>
                <th className="text-right px-2 sm:px-3 py-2 font-medium">USD →</th>
              </tr>
            </thead>
            <tbody>
              {globalRates.map((r) => (
                <tr key={r.currency} className="border-b border-bdr/30">
                  <td className="px-2 sm:px-3 py-2 font-mono font-medium whitespace-nowrap">{r.currency}</td>
                  <td className="px-2 sm:px-3 py-2 text-right tabular whitespace-nowrap">{fmt(r.rate_usd, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const FuelPanel = ({ payload }) => {
  const data = payload?.data || {};
  const hasPrices = data.petrol || data.diesel || data.kerosene;
  if (!hasPrices) {
    return <EmptyPanel label={data.error ? `EWURA scrape: ${data.error}` : 'Latest EWURA cap-price PDF not parsed yet.'} />;
  }
  const items = [
    { label: 'Petrol',   value: data.petrol,   icon: 'zap',      color: 'exp' },
    { label: 'Diesel',   value: data.diesel,   icon: 'chart',    color: 'net' },
    { label: 'Kerosene', value: data.kerosene, icon: 'sparkles', color: 'dng' },
  ];
  return (
    <div>
      <p className="text-[11px] sm:text-xs text-txt-3 mb-3">Cap prices for {data.region || 'Dar es Salaam'} · TZS per litre</p>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {items.map((it) => (
          <div key={it.label} className="surface-inset border border-bdr/50 rounded-xl p-3 sm:p-4 min-w-0">
            <div className="flex items-center justify-between mb-2 gap-1">
              <span className="text-[10px] sm:text-[11px] uppercase tracking-ticker text-txt-3 truncate">{it.label}</span>
              <Icon name={it.icon} size={14} className={`${TONE[it.color].text} flex-shrink-0`} />
            </div>
            <div className="text-base sm:text-2xl font-semibold tabular truncate">
              {it.value ? fmt(it.value, 0) : '—'}
              <span className="text-[10px] sm:text-xs text-txt-3 ml-1">TZS/L</span>
            </div>
          </div>
        ))}
      </div>
      {data.pdf_url && (
        <a href={data.pdf_url} target="_blank" rel="noopener noreferrer"
           className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-accent hover:underline">
          <Icon name="arrowUpRight" size={11} /> Source PDF (EWURA)
        </a>
      )}
    </div>
  );
};

const CryptoPanel = ({ payload }) => {
  const rows = payload?.data || [];
  if (!rows.length) return <EmptyPanel label="Crypto feed warming up." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs sm:text-sm">
        <thead className="text-[10px] sm:text-[11px] uppercase tracking-ticker text-txt-3">
          <tr className="border-b border-bdr/60">
            <th className="text-left px-2 sm:px-3 py-2.5 font-medium">Coin</th>
            <th className="text-right px-2 sm:px-3 py-2.5 font-medium">Price (USD)</th>
            <th className="text-right px-2 sm:px-3 py-2.5 font-medium">24H %</th>
            <th className="text-right px-2 sm:px-3 py-2.5 font-medium hidden sm:table-cell">Trend</th>
            <th className="text-right px-2 sm:px-3 py-2.5 font-medium">≈ TZS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.symbol} className="border-b border-bdr/30 hover:bg-surface-4/30 transition">
              <td className="px-2 sm:px-3 py-2.5">
                <div className="font-mono font-semibold whitespace-nowrap">{c.symbol}</div>
                <div className="text-[10px] text-txt-3 capitalize truncate max-w-[140px]">{c.name}</div>
              </td>
              <td className="px-2 sm:px-3 py-2.5 text-right tabular whitespace-nowrap font-medium">${fmt(c.price_usd)}</td>
              <td className="px-2 sm:px-3 py-2.5 text-right whitespace-nowrap"><Delta pct={c.change_pct} /></td>
              <td className="px-2 sm:px-3 py-2.5 hidden sm:table-cell">
                <div className="w-16 ml-auto"><Sparkline values={seededSeries(c.symbol + 'x', 12, c.change_pct)} height={20} color={sparkColor(c.change_pct)} fill={false} strokeWidth={1.4} /></div>
              </td>
              <td className="px-2 sm:px-3 py-2.5 text-right tabular whitespace-nowrap text-txt-2">{fmtCompact(c.price_tzs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const IndicesPanel = ({ payload }) => {
  const rows = payload?.data || [];
  if (!rows.length) return <EmptyPanel label="Equity indices feed warming up." />;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {rows.map((i) => (
        <div key={i.symbol} className="surface-inset border border-bdr/50 rounded-xl p-3 sm:p-4 min-w-0">
          <div className="text-[11px] uppercase tracking-ticker text-txt-3 mb-1 truncate">{i.symbol}</div>
          <div className="font-semibold text-sm truncate">{i.name}</div>
          <div className="mt-2 text-base sm:text-lg tabular truncate font-medium">
            {fmt(i.price, 2)} <span className="text-[11px] text-txt-3">{i.currency}</span>
          </div>
          <div className="mt-1"><Delta pct={i.change_pct} /></div>
          <div className="mt-2 -mx-1"><Sparkline values={seededSeries(i.symbol + 'idx', 14, i.change_pct)} height={26} color={sparkColor(i.change_pct)} strokeWidth={1.5} /></div>
        </div>
      ))}
    </div>
  );
};

const PredictionsPanel = ({ payload }) => {
  const rows = payload?.data || [];
  if (!rows.length) return <EmptyPanel label="Polymarket feed warming up." />;
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {rows.slice(0, 6).map((m, i) => {
        const yes = Number(m.yes_pct) || 0;
        return (
          <div key={i} className="surface-inset border border-bdr/50 rounded-xl p-3">
            <div className="flex items-start justify-between gap-2 sm:gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <div className="text-xs sm:text-sm font-medium break-words leading-snug">{m.question}</div>
                <div className="text-[10px] sm:text-[11px] text-txt-3 mt-0.5 truncate">
                  {m.category} · vol {fmtCompact(m.volume)}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono text-base sm:text-lg tabular">{yes.toFixed(0)}%</div>
                <div className="text-[10px] text-txt-3 uppercase tracking-ticker">YES</div>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
              <div className="h-full bg-accent" style={{ width: `${Math.min(100, yes)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const EmptyPanel = ({ label }) => (
  <div className="border border-dashed border-bdr/60 rounded-xl p-6 text-center text-xs text-txt-3">
    {label}
  </div>
);

/* ================================================================
   Main tabbed table (the SoSoValue center column).
   ================================================================ */
const MainTable = ({ snapshot, ages, universe }) => {
  const TABS = [
    { id: 'dse',     label: 'DSE Stocks',  badge: 'TZS', tone: 'accent', count: snapshot?.dse?.data?.length,      age: ages.dse },
    { id: 'crypto',  label: 'Crypto',      badge: 'USD', tone: 'accent', count: snapshot?.crypto?.data?.length,   age: ages.crypto },
    { id: 'indices', label: 'Indices',     badge: 'EQ',  tone: 'net',    count: snapshot?.indices?.data?.length,  age: ages.indices },
    { id: 'forex',   label: 'FX Rates',    badge: 'FX',  tone: 'net',    count: snapshot?.forex_bot?.data?.length, age: ages.bot },
    { id: 'fuel',    label: 'Fuel',        badge: 'MO',  tone: 'expense',count: null,                             age: ages.fuel },
    { id: 'predict', label: 'Predictions', badge: '%',   tone: 'muted',  count: snapshot?.predictions?.data?.length, age: ages.predictions },
  ];
  const [tab, setTab] = useState('dse');
  const active = TABS.find((t) => t.id === tab) || TABS[0];

  return (
    <div className="bento p-4 sm:p-5 lg:p-6">
      {/* Category tabs — the horizontal switcher from Market UI */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none border-b border-bdr/60 -mx-1 px-1 mb-4 pb-px">
        {TABS.map((tItem) => {
          const on = tItem.id === tab;
          return (
            <button
              key={tItem.id}
              onClick={() => setTab(tItem.id)}
              className={`relative flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm whitespace-nowrap transition ${
                on ? 'text-txt-1 font-semibold' : 'text-txt-3 hover:text-txt-2'
              }`}
            >
              {tItem.label}
              {tItem.count != null && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-md tabular ${on ? 'bg-accent/15 text-accent' : 'bg-surface-4/60 text-txt-3'}`}>{tItem.count}</span>
              )}
              {on && <span className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-[10px] sm:text-[11px] text-txt-3 font-mono uppercase tracking-ticker">
          Updated {active.age}
        </p>
        <Badge color={active.tone === 'accent' ? 'accent' : active.tone === 'net' ? 'net' : active.tone === 'expense' ? 'expense' : 'muted'} dot>{active.badge}</Badge>
      </div>

      {/* Scoped gainers / decliners for the market you clicked */}
      {tab === 'dse'     && <ClassMovers rows={universe?.dse} />}
      {tab === 'crypto'  && <ClassMovers rows={universe?.crypto} />}
      {tab === 'indices' && <ClassMovers rows={universe?.indices} />}

      {tab === 'dse'     && <DSEPanel payload={snapshot?.dse} />}
      {tab === 'crypto'  && <CryptoPanel payload={snapshot?.crypto} />}
      {tab === 'indices' && <IndicesPanel payload={snapshot?.indices} />}
      {tab === 'forex'   && <ForexPanel bot={snapshot?.forex_bot} global={snapshot?.forex_global} />}
      {tab === 'fuel'    && <FuelPanel payload={snapshot?.fuel} />}
      {tab === 'predict' && <PredictionsPanel payload={snapshot?.predictions} />}
    </div>
  );
};

/* ================================================================
   Page
   ================================================================ */
const MarketsPage = () => {
  const { t } = useT();
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setError('');
      const snap = await fetchMarketSnapshot();
      setSnapshot(snap);
    } catch (err) {
      setError(err.message || 'Unable to load market data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60 * 1000); // pull cache every 5 minutes
    return () => clearInterval(id);
  }, []);

  const ages = useMemo(() => ({
    dse:         fmtAge(snapshot?.dse?.updated_at),
    bot:         fmtAge(snapshot?.forex_bot?.updated_at),
    fuel:        fmtAge(snapshot?.fuel?.updated_at),
    crypto:      fmtAge(snapshot?.crypto?.updated_at),
    indices:     fmtAge(snapshot?.indices?.updated_at),
    predictions: fmtAge(snapshot?.predictions?.updated_at),
  }), [snapshot]);

  const universe = useMemo(() => buildUniverse(snapshot), [snapshot]);

  return (
    <AppShell>
      <div className="space-y-5 sm:space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <Eyebrow num="00">{t('mk.eyebrow')}</Eyebrow>
            <h1 className="mt-2 text-xl sm:text-2xl lg:text-3xl font-semibold tracking-tight break-words">{t('mk.title')}</h1>
            <p className="text-xs sm:text-sm text-txt-2 mt-1.5 max-w-xl leading-relaxed">
              A live command deck for East African money — Dar es Salaam equities, the shilling, fuel, and the global markets that move them, in one glance.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-bdr hover:border-accent/40 text-xs text-txt-2 hover:text-txt-1 transition disabled:opacity-50 flex-shrink-0"
          >
            <Icon name="arrowRight" size={12} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div className="bento p-4 border border-dng/30 bg-dng/5 text-sm text-dng">
            {error} · The cache may be empty if the backend just started — try again in a minute.
          </div>
        )}

        {/* ---- TOP — ask the market advisor ---- */}
        <InsightPanel snapshot={snapshot} />

        {/* ---- CENTER — live markets & updates ----
            Category-driven overview: pick DSE / Crypto / Indices and the
            leaders, pulse chart and sentiment all scope to it. */}
        <MarketExplorer universe={universe} />

        {/* Main table (with per-market gainers/decliners) + right rail */}
        <div className="grid lg:grid-cols-12 gap-4 sm:gap-5">
          <div className="lg:col-span-8 min-w-0">
            <MainTable snapshot={snapshot} ages={ages} universe={universe} />
          </div>
          <div className="lg:col-span-4 space-y-4 sm:space-y-5">
            <Spotlight universe={universe} />
            <SectorMover universe={universe} />
            <Distribution universe={universe} />
          </div>
        </div>

        {/* ---- BOTTOM — fine print ---- */}
        {/* Disclaimer */}
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
                    The data and explanations on this page are educational summaries from public market sources and are NOT
                    financial advice. For investment, tax, or insurance decisions, consult a CMSA-licensed advisor in
                    Tanzania (or a similarly certified professional in your country) so any future misunderstandings are
                    avoided. PesaLens does not earn commission from any provider listed.
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

export default MarketsPage;
