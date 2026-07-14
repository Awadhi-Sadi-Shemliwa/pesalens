import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  Bot,
  Eye,
  Globe,
  Moon,
  Sun,
} from "lucide-react";
// @ts-ignore — JS module
import { fetchPublicTicker } from "@/data/api";
// @ts-ignore — JS module
import { useTheme } from "@/data/theme";
// @ts-ignore — JS module
import { useT, setLang as setI18nLang } from "@/data/i18n";
import AnimatedBackground from "@/components/pl/AnimatedBackground";
import StarBorder from "@/components/pl/StarBorder";
import ShinyText from "@/components/pl/ShinyText";
import RotatingText from "@/components/pl/RotatingText";
import TrueFocus from "@/components/pl/TrueFocus";
import OrbitRing from "@/components/pl/OrbitRing";
import TextType from "@/components/pl/TextType";
import NoteLayer, { NoteImg, useNoteManifest } from "@/components/pl/NoteLayer";

/* --------------------------------------------------------------------------
   Mobile Landing — a faithful, single-column port of the web LandingPage
   (src/pages/LandingPage.jsx). Same sections, cards, text and the real TSH
   banknote imagery (orbiting / floating / flipping), recomposed for a ~400px
   WebView. Effects use framer-motion + CSS (the web's own `lite`/`reduced`
   tier) — no GSAP / canvas particles. The lightweight CSS AnimatedBackground
   is kept exactly as-is (that was solved separately).
   Used by both the Capacitor APK and the PWA install as the guest home screen.
   -------------------------------------------------------------------------- */

type TickerRow = { sym: string; val: string; pct: number | null; kind?: string };

const FALLBACK_TICKER: TickerRow[] = [
  { sym: "CRDB",    val: "2 700",   pct: 3.45,  kind: "stock" },
  { sym: "NMB",     val: "4 600",   pct: -0.6,  kind: "stock" },
  { sym: "USD/TZS", val: "2 608",   pct: null,  kind: "fx" },
  { sym: "EUR/TZS", val: "3 057",   pct: null,  kind: "fx" },
  { sym: "BTC",     val: "$76,146", pct: -2.05, kind: "crypto" },
  { sym: "ETH",     val: "$2,269",  pct: -1.95, kind: "crypto" },
  { sym: "S&P 500", val: "7 174",   pct: 0.91,  kind: "index" },
];

/* Markets orbit seed — live ticker rows override per symbol (see orbitAssets). */
const FALLBACK_BY_SYM = Object.fromEntries(FALLBACK_TICKER.map((r) => [r.sym, r]));
const ORBIT_EXTRA: Record<string, { val: string; pct: number }> = {
  TBL:    { val: "10 900", pct: 0.0 },
  TPCC:   { val: "4 040",  pct: 1.2 },
  NASDAQ: { val: "23 411", pct: 1.14 },
};
const ORBIT_SEED: TickerRow[] = ["CRDB", "NMB", "TBL", "TPCC", "BTC", "ETH", "S&P 500", "NASDAQ"].map((sym) => {
  const base = (FALLBACK_BY_SYM[sym] as TickerRow) || ORBIT_EXTRA[sym] || {};
  return { sym, val: (base as any).val, pct: (base as any).pct ?? 0 };
});

const formatPct = (pct: number | null) => {
  if (pct == null || Number.isNaN(Number(pct))) return null;
  const n = Number(pct);
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(2)}%`;
};

/* Tiny SVG sparkline so cards don't pull recharts. */
const Spark = ({ values, color, width = 320, height = 64 }: { values: number[]; color: string; width?: number; height?: number }) => {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const dx = width / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => {
    const x = i * dx;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const path = `M${pts.join(" L")}`;
  const id = `spark-${Math.abs(values[0] + values.length)}-${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path className="pl-spark-draw" d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

/* Count-up figure. Eases 0 → target once on mount; jumps to value under reduced-motion. */
const CountUp = ({ to, decimals = 2, suffix = "", className }: { to: number; decimals?: number; suffix?: string; className?: string }) => {
  const reduce = useReducedMotion();
  const [val, setVal] = useState(reduce ? to : 0);
  useEffect(() => {
    if (reduce) { setVal(to); return; }
    let raf = 0;
    const dur = 1100;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(to * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, reduce]);
  return <span className={className} data-no-translate>{val.toFixed(decimals)}{suffix}</span>;
};

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <div className="inline-flex items-center gap-2.5">
    <span className="h-px w-5 bg-border" />
    <ShinyText text={String(children)} className="text-[10px] uppercase tracking-ticker font-semibold" color="hsl(var(--txt-2))" shineColor="hsl(var(--accent))" speed={4} />
  </div>
);

const TileLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center justify-between mb-4">
    <span className="text-[13px] text-txt-2">{children}</span>
    <span className="text-txt-4 text-lg leading-none">+</span>
  </div>
);

/* ======================================================================= */
/*  HERO — MoneyMate scene (ported): transactions rising/falling, balance   */
/* ======================================================================= */

const TX_ROWS = [
  { label: "M-Pesa float", amt: "+ TZS 235,000",   up: true },
  { label: "Bank charges", amt: "− TZS 4,800",     up: false },
  { label: "Invoice #218", amt: "+ TZS 1,180,000", up: true },
  { label: "Duka stock",   amt: "− TZS 320,000",   up: false },
];

const MoneyMateScene = ({ reduce }: { reduce: boolean | null }) => {
  const rise = (delay: number) =>
    reduce
      ? { initial: false as const }
      : { initial: { opacity: 0, y: 22, scale: 0.97 }, whileInView: { opacity: 1, y: 0, scale: 1 }, viewport: { once: true, margin: "-40px" }, transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as const } };
  return (
    <div className="relative h-[430px] select-none" aria-hidden>
      {/* decorative sparkles */}
      <div className="pointer-events-none">
        <span className="absolute left-[36%] top-[6%] text-accent text-lg anim-pulse-soft">✦</span>
        <span className="absolute right-[6%] top-[1%] text-net/70 text-xl anim-pulse-soft" style={{ animationDelay: "0.8s" }}>✧</span>
        <span className="absolute left-[4%] top-[48%] text-accent text-base anim-float" style={{ animationDelay: "0.4s" }}>+</span>
        <span className="absolute right-[10%] bottom-[6%] text-net/60 text-base anim-float" style={{ animationDelay: "1.2s" }}>+</span>
      </div>

      {/* Transactions card — money rising (green) / falling (red) */}
      <motion.div {...rise(0)} className="absolute left-0 top-0 w-[200px] rounded-[20px] bg-surface-1 border border-border shadow-lift p-4 z-10">
        {TX_ROWS.map((r, i) => (
          <div key={r.label} className={`flex items-center gap-3 py-2.5 ${i < TX_ROWS.length - 1 ? "border-b border-border/40" : ""}`}>
            <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${r.up ? "bg-inc/15 text-inc" : "bg-dng/15 text-dng"}`}>
              {r.up ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-txt-3 truncate">{r.label}</div>
              <div className={`text-[13px] font-semibold tabular ${r.up ? "text-inc" : "text-dng"}`} data-no-translate>{r.amt}</div>
            </div>
          </div>
        ))}
      </motion.div>

      {/* Balance card (gradient) + open-account CTA */}
      <motion.div {...rise(0.12)} className="absolute right-0 top-[5%] w-[168px] z-20">
        <div className="rounded-[20px] p-4 pb-8 shadow-lift relative overflow-hidden border border-accent/25" style={{ background: "linear-gradient(140deg, hsl(var(--accent) / 0.92), hsl(var(--net) / 0.92))" }}>
          <div className="text-[12px] text-white/85 text-center">Your balance</div>
          <div className="mt-1 text-center text-[24px] font-bold tabular text-white">
            TZS <CountUp to={1.74} decimals={2} suffix="M" />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="font-mono-tab text-[10px] text-white/75" data-no-translate>•• 4051</span>
            <span className="w-9 h-5 rounded-full bg-white/25 relative">
              <span className="absolute top-0.5 left-[18px] w-4 h-4 rounded-full bg-white" />
            </span>
          </div>
        </div>
        <div className="-mt-5 flex flex-col items-center gap-1.5">
          <Link to="/signup" tabIndex={-1} className="press w-11 h-11 rounded-full bg-gradient-accent text-primary-foreground flex items-center justify-center shadow-lift" aria-label="Open an account">
            <ArrowUpRight className="w-4 h-4" />
          </Link>
          <span className="text-[11px] text-txt-2 text-center leading-tight">Open your<br />account</span>
        </div>
      </motion.div>

      {/* "This week +5%" card with a drawing rising line */}
      <motion.div {...rise(0.22)} className="absolute left-0 top-[64%] w-[210px] rounded-[18px] bg-surface-1 border border-border shadow-lift px-4 pt-3 pb-2 z-10">
        <div className="flex items-center justify-between text-[12px] mb-1">
          <span className="text-txt-2">This week</span>
          <span className="text-inc font-semibold tabular" data-no-translate>+5%</span>
        </div>
        <svg viewBox="0 0 200 52" className="w-full h-[52px]">
          <path className="pl-spark-draw" d="M 4 44 C 36 44, 40 30, 66 32 S 106 44, 128 30 S 168 8, 196 10" fill="none" stroke="hsl(var(--accent))" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </motion.div>
    </div>
  );
};

const StageCard = ({ step, tag, title, desc }: { step: string; tag: string; title: string; desc: string }) => (
  <div className="ios-group p-4">
    <div className="flex items-center justify-between mb-2">
      <span className="font-semibold text-[13px] text-txt-1">{step}</span>
      <span className="font-mono-tab text-[10px] uppercase tracking-ticker text-accent">{tag}</span>
    </div>
    <h3 className="text-[16px] font-semibold tracking-tight mb-1.5">{title}</h3>
    <p className="text-[12.5px] text-txt-2 leading-relaxed flex gap-2">
      <span className="text-accent flex-shrink-0">+</span>
      <span>{desc}</span>
    </p>
  </div>
);

/* Bento data */
const BENTO_TX = [
  { name: "Shoprite Mlimani",     amt: "TZS 48,200",  ok: true,  note: "Groceries",    date: "26 Nov" },
  { name: "M-Pesa transfer",      amt: "TZS 235,000", ok: true,  note: "Money in",     date: "25 Nov" },
  { name: "LUKU electricity",     amt: "TZS 60,000",  ok: true,  note: "Utilities",    date: "24 Nov" },
  { name: "Receipt #4012",        amt: "TZS 55,553",  ok: true,  note: "OCR parsed",   date: "24 Nov" },
  { name: "Unknown counterparty", amt: "TZS 12,500",  ok: false, note: "Needs review", date: "23 Nov" },
];
const ACTIVITY = [
  { d: "Mon", v: 34 }, { d: "Tue", v: 78 }, { d: "Wed", v: 30 }, { d: "Thu", v: 26 },
  { d: "Fri", v: 42 }, { d: "Sat", v: 22 }, { d: "Sun", v: 30 },
];

/* A market chip for the orbit / grid */
const MarketChip = ({ row }: { row: TickerRow }) => {
  const pctText = formatPct(row.pct);
  const up = (row.pct ?? 0) >= 0;
  return (
    <div className="w-[108px] rounded-2xl border border-border/70 bg-surface-1/80 backdrop-blur-md px-3.5 py-2.5 text-left shadow-lift">
      <div className="font-mono-tab text-[9px] uppercase tracking-ticker text-txt-3" data-no-translate>{row.sym}</div>
      <div className="mt-1 text-[14px] font-semibold tabular text-foreground" data-no-translate>{row.val}</div>
      {pctText && <div className={`mt-0.5 font-mono-tab text-[10px] tabular ${up ? "text-inc" : "text-dng"}`} data-no-translate>{pctText}</div>}
    </div>
  );
};

/* Why-section banknote ring item (loads from the shared manifest cache) */
const WhyRingNote = ({ denom, side }: { denom: string; side: "front" | "back" }) => {
  const manifest = useNoteManifest();
  if (!manifest) return <span className="inline-block w-[120px] h-[58px]" />;
  return <NoteImg manifest={manifest} denom={denom} side={side} width={120} glow="accent" />;
};

/* ======================================================================= */

/* Markets heading — shared by the animated (TrueFocus) and reduced-motion paths
   so the two never drift. The non-breaking spaces keep "(DSE & CRYPTO)" as a
   single TrueFocus token (it splits on " "), so the focus frame never lands on
   a lone "&". */
const MK_HEADING_LEAD = "Start 'SAVING' and 'INVESTING'";
const MK_HEADING_TAIL = "(DSE\u00a0&\u00a0CRYPTO)";

const Landing = () => {
  const reduce = useReducedMotion();
  const [ticker, setTicker] = useState<TickerRow[]>(FALLBACK_TICKER);
  const [theme, toggleTheme] = useTheme() as [string, () => void];
  const { lang } = useT() as { lang: string };

  const flipLang = () => setI18nLang(lang === "en" ? "sw" : "en");

  useEffect(() => {
    let alive = true;
    fetchPublicTicker()
      .then((items: TickerRow[]) => { if (alive && items?.length) setTicker(items); })
      .catch(() => { /* fallback stays */ });
  }, []);

  /* Merge live ticker rows over the orbit seed (live value wins per symbol) */
  const orbitAssets = useMemo(() => {
    const bySym = new Map(ORBIT_SEED.map((r) => [r.sym, r]));
    ticker.forEach((r) => { if (r.sym && bySym.has(r.sym)) bySym.set(r.sym, { sym: r.sym, val: r.val, pct: r.pct }); });
    return [...bySym.values()];
  }, [ticker]);

  const inSeries  = [820, 940, 905, 1100, 1240, 1180, 1320, 1410, 1380, 1505, 1620, 1580];
  const outSeries = [610, 580, 720, 660, 790, 700, 830, 760, 900, 820, 940, 880];

  return (
    <div className="min-h-screen bg-deep text-foreground overflow-x-hidden">
      {/* Lightweight CSS hyperspeed (dark) / light-pillar (light) backdrop —
          fixed behind all content. Solved separately; do not modify. */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <AnimatedBackground />
      </div>

      <div className="relative z-10">
        {/* Solid status-bar spacer (Capacitor overlay-WebView mode) */}
        <div className="pt-safe bg-deep relative z-50" />

        {/* Floating glass top bar */}
        <header className="sticky top-0 z-40 px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="absolute inset-0 glass-pane border-b border-border/40 pointer-events-none" />
          <Link to="/" className="relative flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl overflow-hidden bg-surface-2 border border-border/60 shrink-0 flex items-center justify-center">
              <img src="/logo.png" alt="PesaLens" className="w-full h-full object-cover" />
            </div>
            <span className="text-[15px] font-bold tracking-tight" data-no-translate>Pesa<span className="text-accent">Lens</span></span>
          </Link>
          <div className="relative flex items-center gap-1">
            <button type="button" onClick={flipLang} aria-label="Toggle language" className="w-9 h-9 rounded-full bg-surface-2/80 border border-border/50 text-txt-2 hover:text-txt-1 inline-flex items-center justify-center gap-1 ios-press">
              <Globe className="w-4 h-4" />
              <span className="text-[10px] font-mono-tab uppercase tracking-wider" data-no-translate>{lang}</span>
            </button>
            <button type="button" onClick={toggleTheme} aria-label="Toggle theme" className="w-9 h-9 rounded-full bg-surface-2/80 border border-border/50 text-txt-2 hover:text-txt-1 inline-flex items-center justify-center ios-press">
              {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
            <Link to="/signup" className="ml-1 bg-gradient-accent text-primary-foreground text-[12px] font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1">
              Start <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </header>

        {/* HERO ----------------------------------------------------------- */}
        <section className="relative px-5 pt-6 pb-10">
          <div className="absolute inset-0 grid-faint opacity-50 pointer-events-none" />
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            <Eyebrow>Built for Tanzania · Made for clarity</Eyebrow>
            <h1 className="mt-4 text-[34px] leading-[1.05] font-bold tracking-tight">
              Read your money
              <br />
              <span className="font-serif-display italic font-light text-txt-2">like</span>{" "}
              <span className="gradient-text">a banker reads it.</span>
            </h1>
            <p className="mt-4 text-[14px] text-txt-2 leading-relaxed">
              PesaLens turns any bank statement — CRDB, NMB, NBC, M-Pesa, Airtel — into a
              clean ledger of every shilling, then walks you through it like a financial
              controller would. Without the spreadsheet.
            </p>

            <div className="mt-6 flex flex-col gap-2.5">
              <StarBorder color="hsl(var(--accent))" speed="4.5s" className="w-full block" innerClassName="rounded-xl">
                <Link to="/signup" className="bg-gradient-accent text-primary-foreground text-[14px] font-semibold px-5 py-3 rounded-xl inline-flex w-full items-center justify-center gap-2 shadow-lift">
                  Start 14-day free trial <ArrowRight className="w-4 h-4" />
                </Link>
              </StarBorder>
              <Link to="/signin" className="text-center text-[14px] font-semibold text-txt-2 hover:text-foreground py-2.5">
                Sign In
              </Link>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-txt-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" />
                System operational
              </span>
              <span>14-day trial · no card</span>
            </div>
          </motion.div>

          {/* MoneyMate scene with floating TSH banknotes behind it */}
          <div className="relative mt-8">
            <NoteLayer variant="float" denoms={["1k", "10k"]} glow="net" className="absolute -inset-2 z-0 opacity-80" />
            <div className="relative z-10">
              <MoneyMateScene reduce={reduce} />
            </div>
          </div>
        </section>

        {/* TICKER --------------------------------------------------------- */}
        <div className="relative border-y border-border/60 bg-surface-1/40 overflow-hidden">
          <div className="animate-ticker py-3 whitespace-nowrap">
            {[...ticker, ...ticker, ...ticker].map((row, i) => {
              const pctText = formatPct(row.pct);
              const up = (row.pct ?? 0) >= 0;
              return (
                <span key={i} className="inline-flex items-center gap-2 mx-5 font-mono-tab text-[11px]" data-no-translate>
                  <span className="text-txt-3 tracking-ticker">{row.sym}</span>
                  <span className="text-foreground tabular">{row.val}</span>
                  {pctText && <span className={`tabular ${up ? "text-inc" : "text-exp"}`}>{pctText}</span>}
                  <span className="text-txt-4 mx-2">·</span>
                </span>
              );
            })}
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-deep to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-deep to-transparent" />
        </div>

        {/* METHOD --------------------------------------------------------- */}
        <section className="px-5 py-12">
          <Eyebrow>Method</Eyebrow>
          <h2 className="mt-4 text-[26px] leading-[1.1] font-bold tracking-tight">
            Statement in.
            <br />
            <span className="font-serif-display italic font-light text-txt-2">Clarity</span> out.
          </h2>
          <p className="mt-4 text-[13.5px] text-txt-2 leading-relaxed">
            Three deliberate steps. No data entry, no spreadsheets, no exports to a generic
            dashboard you'll never open twice.
          </p>

          <div className="mt-8 relative">
            <div className="absolute left-[7px] top-3 bottom-3 w-px bg-gradient-to-b from-accent/60 via-border to-net/40" aria-hidden />
            <div className="space-y-4">
              {[
                { step: "Step 01", tag: "Ingest",    title: "Drop a statement",   desc: "PDFs from CRDB, NMB, NBC, Stanbic, M-Pesa, Airtel Money — even photographed pages." },
                { step: "Step 02", tag: "Reconcile", title: "We read every line", desc: "OCR + ledger logic extracts each transaction, classifies it, and balances against the closing figure." },
                { step: "Step 03", tag: "Decide",    title: "Ask, compare, act",  desc: "KPIs, anomalies, fee leakage, savings rate and an AI controller you can question in plain English." },
              ].map((s, idx) => (
                <motion.div
                  key={s.step}
                  initial={reduce ? false : { opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.45, delay: idx * 0.08 }}
                  className="relative pl-7"
                >
                  <span className="absolute left-0 top-4 w-3.5 h-3.5 rounded-full bg-surface-2 border-2 border-accent" />
                  <StageCard {...s} />
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* CAPABILITIES (BENTO) ------------------------------------------ */}
        <section className="px-5 py-12 bg-surface-1/40 border-y border-border/60">
          <Eyebrow>Capabilities</Eyebrow>
          <h2 className="mt-4 text-[26px] leading-[1.1] font-bold tracking-tight">
            One workspace.
            <br />
            Every <span className="font-serif-display italic font-light text-txt-2">money question.</span>
          </h2>
          <p className="mt-4 text-[13.5px] text-txt-2 leading-relaxed">
            Each module is built for the job it does — not stamped from the same template.
            Spend five minutes; you'll feel it.
          </p>

          <div className="mt-6 space-y-3">
            {/* Statements — gradient bank card */}
            <motion.div initial={reduce ? false : { opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.45 }} className="ios-group p-5">
              <TileLabel>Statements</TileLabel>
              <div className="rounded-2xl p-4 h-[132px] relative overflow-hidden border border-white/10" style={{ background: "linear-gradient(135deg, hsl(var(--accent) / 0.85), hsl(var(--net) / 0.85))" }}>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-white/90 font-medium">CRDB Bank</span>
                  <img src="/logo.png" alt="" className="w-5 h-5 rounded" />
                </div>
                <div className="mt-6 font-mono-tab text-[15px] tracking-[0.14em] text-white" data-no-translate>8763 2736 •••• ••29</div>
                <div className="mt-3 flex items-center justify-between text-[10px] text-white/75 font-mono-tab uppercase">
                  <span>statement · nov</span>
                  <span data-no-translate>142 tx</span>
                </div>
              </div>
              <p className="mt-3 text-[12px] text-txt-3 leading-relaxed">CRDB, NMB, NBC, Stanbic, M-Pesa, Airtel — PDFs or photos, in one ledger.</p>
            </motion.div>

            {/* Statement intelligence — transactions table */}
            <motion.div initial={reduce ? false : { opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.45 }} className="ios-group p-5">
              <TileLabel>Statement intelligence</TileLabel>
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 pb-2 border-b border-border/50 font-mono-tab text-[9px] uppercase tracking-ticker text-txt-4">
                <span>Transaction</span><span>Status</span><span>Date</span>
              </div>
              {BENTO_TX.map((r, i) => (
                <motion.div
                  key={r.name}
                  className="grid grid-cols-[1fr_auto_auto] gap-3 items-center py-[7px] border-b border-border/30 last:border-0"
                  initial={reduce ? false : { opacity: 0, x: -12 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, amount: 0.6 }}
                  transition={{ duration: 0.35, delay: 0.1 + i * 0.08 }}
                >
                  <span className="min-w-0">
                    <span className="block text-[12px] text-txt-1 truncate">{r.name}</span>
                    <span className="block text-[10px] text-txt-3 tabular" data-no-translate>{r.amt}</span>
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-medium ${r.ok ? "bg-inc/15 text-inc" : "bg-exp/15 text-exp"}`}>{r.note}</span>
                  <span className="text-[10px] text-txt-3 font-mono-tab" data-no-translate>{r.date}</span>
                </motion.div>
              ))}
            </motion.div>

            {/* KPI engine — weekly activity bars */}
            <motion.div initial={reduce ? false : { opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.45 }} className="ios-group p-5">
              <TileLabel>KPI engine</TileLabel>
              <div className="flex items-end justify-between gap-2 h-[130px] px-1">
                {ACTIVITY.map((b, i) => (
                  <div key={b.d} className="flex flex-col items-center gap-2 flex-1">
                    <div className="w-full h-[104px] rounded-full bg-surface-4/60 relative overflow-hidden flex items-end">
                      <motion.span
                        className={`w-full rounded-full ${i === 1 ? "" : "bg-surface-5"}`}
                        style={i === 1 ? { background: "linear-gradient(180deg, hsl(var(--accent-h)), hsl(var(--accent-d)))" } : undefined}
                        initial={reduce ? false : { height: 0 }}
                        whileInView={{ height: `${b.v}%` }}
                        viewport={{ once: true, amount: 0.6 }}
                        transition={{ duration: 0.6, delay: 0.15 + i * 0.06, ease: "easeOut" }}
                      />
                    </div>
                    <span className="font-mono-tab text-[9px] text-txt-4 uppercase">{b.d}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[12px] text-txt-3">Daily, monthly and quarterly KPIs from every upload.</p>
            </motion.div>

            {/* Money in / Money out */}
            <motion.div initial={reduce ? false : { opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.45 }} className="ios-group p-5">
              <TileLabel>Money in · Money out</TileLabel>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { l: "Money in",  to: 5.15, d: "+12.3%", up: true,  s: inSeries,  c: "hsl(var(--inc))" },
                  { l: "Money out", to: 2.53, d: "+4.1%",  up: false, s: outSeries, c: "hsl(var(--exp))" },
                ].map((k) => (
                  <div key={k.l} className="surface-inset p-3">
                    <div className="text-[10px] uppercase tracking-ticker text-txt-3 mb-1">{k.l}</div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-txt-3 text-[10px] font-mono-tab" data-no-translate>TZS</span>
                      <CountUp to={k.to} decimals={2} suffix="M" className="text-[18px] font-bold tabular" />
                      <span className={`ml-0.5 text-[10px] font-medium ${k.up ? "text-inc" : "text-exp"}`} data-no-translate>{k.d}</span>
                    </div>
                    <div className="mt-2 -mx-1">
                      <Spark values={k.s} color={k.c} height={26} />
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Bookkeeping — profit bars */}
            <motion.div initial={reduce ? false : { opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.45 }} className="ios-group p-5">
              <TileLabel>Bookkeeping</TileLabel>
              <div className="grid grid-cols-2 gap-4 mb-3">
                {[
                  { l: "Gross profit", v: "TZS 12.2M" },
                  { l: "Net profit",   v: "TZS 4.45M" },
                ].map((p) => (
                  <div key={p.l}>
                    <div className="text-[10px] uppercase tracking-ticker text-txt-3">{p.l}</div>
                    <div className="text-[18px] font-bold tabular text-txt-1" data-no-translate>{p.v}</div>
                  </div>
                ))}
              </div>
              <div className="flex items-end gap-4 h-[110px]">
                {[
                  { h: 58, g: "linear-gradient(180deg, hsl(var(--net) / 0.9), hsl(var(--net) / 0.4))" },
                  { h: 96, g: "linear-gradient(180deg, hsl(var(--accent-h)), hsl(var(--accent-d)))" },
                ].map((b, i) => (
                  <motion.div key={i} className="flex-1 rounded-xl" style={{ background: b.g }} initial={reduce ? false : { height: 0 }} whileInView={{ height: `${b.h}%` }} viewport={{ once: true, amount: 0.6 }} transition={{ duration: 0.7, delay: 0.2 + i * 0.15, ease: "easeOut" }} />
                ))}
              </div>
              <p className="mt-3 text-[12px] text-txt-3">Sales, expenses, debts, receipts — built for Tanzanian SMEs.</p>
            </motion.div>

            {/* Savings target — concentric arcs */}
            <motion.div initial={reduce ? false : { opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.45 }} className="ios-group p-5">
              <TileLabel>Savings target</TileLabel>
              <div className="flex items-center gap-4">
                <svg width="130" height="130" viewBox="0 0 130 130" className="shrink-0">
                  {[
                    { r: 52, pct: 0.72, color: "hsl(var(--accent))" },
                    { r: 40, pct: 0.55, color: "hsl(var(--net))" },
                    { r: 28, pct: 0.38, color: "hsl(var(--inc))" },
                  ].map((a, i) => (
                    <g key={i}>
                      <circle cx="65" cy="65" r={a.r} fill="none" stroke="hsl(var(--surface-4))" strokeWidth="7" strokeDasharray={`${2 * Math.PI * a.r * 0.75} ${2 * Math.PI * a.r}`} transform="rotate(135 65 65)" strokeLinecap="round" opacity="0.5" />
                      <motion.circle
                        cx="65" cy="65" r={a.r} fill="none" stroke={a.color} strokeWidth="7" strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * a.r} ${2 * Math.PI * a.r}`}
                        transform="rotate(135 65 65)"
                        initial={reduce ? { strokeDashoffset: 2 * Math.PI * a.r * (1 - 0.75 * a.pct) } : { strokeDashoffset: 2 * Math.PI * a.r }}
                        whileInView={{ strokeDashoffset: 2 * Math.PI * a.r * (1 - 0.75 * a.pct) }}
                        viewport={{ once: true, amount: 0.6 }}
                        transition={{ duration: 1, delay: 0.2 + i * 0.2, ease: "easeOut" }}
                      />
                    </g>
                  ))}
                </svg>
                <div className="space-y-2 text-[11px]">
                  {[["Savings rate", "hsl(var(--accent))"], ["Emergency fund", "hsl(var(--net))"], ["Investments", "hsl(var(--inc))"]].map(([l, c]) => (
                    <div key={l} className="flex items-center gap-2 text-txt-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: c }} />{l}
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-3 surface-inset px-3 py-2 flex items-center justify-between text-[11px]">
                <span className="text-txt-3">Daily limit</span>
                <span className="text-txt-1 font-semibold tabular" data-no-translate>TZS 138,500 <span className="text-txt-3 font-normal">of 200,000</span></span>
              </div>
            </motion.div>

            {/* AI controller */}
            <motion.div initial={reduce ? false : { opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.45 }} className="ios-group p-5">
              <div className="flex items-center gap-3 mb-3">
                <Bot className="w-6 h-6 text-accent shrink-0" />
                <div>
                  <div className="text-[13px] text-txt-1 font-semibold">AI controller</div>
                  <div className="text-[11px] text-txt-3">Ask anything in Kiswahili or English</div>
                </div>
              </div>
              <div className="surface-inset px-4 py-3 font-mono-tab text-[12.5px] text-txt-1 min-h-[44px] flex items-center">
                {reduce ? (
                  <span data-no-translate>Nimetumia kiasi gani kwenye chakula mwezi huu?</span>
                ) : (
                  <TextType
                    text={[
                      "Nimetumia kiasi gani kwenye chakula mwezi huu?",
                      "How much did I spend on food this month?",
                      "Ada gani zimefichwa kwenye taarifa yangu?",
                      "Which fees am I quietly paying?",
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
            </motion.div>
          </div>
        </section>

        {/* RECONCILIATION & PERSONAL SPENDING ---------------------------- */}
        <section className="px-5 py-12">
          <Eyebrow>Reconciliation · Personal spending</Eyebrow>
          <h2 className="mt-4 text-[26px] leading-[1.1] font-bold tracking-tight">
            Balanced books.
            <br />
            <span className="font-serif-display italic font-light text-txt-2">Honest budgets.</span>
          </h2>
          <p className="mt-4 text-[13.5px] text-txt-2 leading-relaxed">
            Every upload is balanced against the closing figure line by line, and every
            shilling you spend on yourself gets a category and a budget. Nothing slips through.
          </p>

          {/* Reconciliation card */}
          <motion.div initial={reduce ? false : { opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.45 }} className="mt-6 ios-group p-5">
            <div className="flex items-center justify-between mb-4">
              <Eyebrow>Reconciliation</Eyebrow>
              <motion.span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-inc/15 text-inc text-[11px] font-semibold"
                initial={reduce ? false : { opacity: 0, scale: 0.5 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ type: "spring", stiffness: 300, damping: 15, delay: 0.9 }}
              >
                ✓ Statement ties
              </motion.span>
            </div>
            {[
              { l: "Opening balance",     v: "TZS 1,240,000", c: "text-txt-1" },
              { l: "Money in",            v: "+ 5,150,000",   c: "text-inc" },
              { l: "Money out",           v: "− 2,530,000",   c: "text-dng" },
              { l: "Bank charges & fees", v: "− 38,200",      c: "text-dng" },
              { l: "Closing (statement)", v: "TZS 3,821,800", c: "text-txt-1", top: true },
              { l: "Closing (computed)",  v: "TZS 3,821,800", c: "text-accent" },
            ].map((r, i) => (
              <motion.div
                key={r.l}
                className={`flex items-center justify-between py-2 text-[13px] ${r.top ? "border-t border-border/60 mt-2 pt-3" : ""}`}
                initial={reduce ? false : { opacity: 0, x: -14 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 0.4, delay: 0.1 + i * 0.12 }}
              >
                <span className="text-txt-2">{r.l}</span>
                <span className={`font-semibold tabular ${r.c}`} data-no-translate>{r.v}</span>
              </motion.div>
            ))}
            <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-exp/10 text-exp text-[11px]">
              <Eye className="w-3 h-3" /> 2 duplicates flagged for review
            </div>
          </motion.div>

          {/* Personal spending card */}
          <motion.div initial={reduce ? false : { opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.45, delay: 0.08 }} className="mt-3 ios-group p-5">
            <div className="flex items-center justify-between mb-4">
              <Eyebrow>Personal spending</Eyebrow>
              <span className="font-mono-tab text-[10px] tracking-ticker text-txt-3" data-no-translate>NOV · 26</span>
            </div>
            <div className="space-y-4">
              {[
                { l: "Groceries",      pct: 34, c: "hsl(var(--accent))" },
                { l: "Transport",      pct: 22, c: "hsl(var(--net))" },
                { l: "Dining",         pct: 18, c: "hsl(var(--inc))" },
                { l: "Airtime & data", pct: 12, c: "hsl(var(--exp))" },
                { l: "Other",          pct: 14, c: "hsl(var(--surface-5))" },
              ].map((m, i) => (
                <div key={m.l}>
                  <div className="flex justify-between items-baseline mb-1.5 text-[13px]">
                    <span className="text-txt-2">{m.l}</span>
                    <span className="font-semibold tabular text-txt-1" data-no-translate>{m.pct}%</span>
                  </div>
                  <div className="h-1.5 bg-surface-4 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: m.c, boxShadow: `0 0 10px ${m.c}` }}
                      initial={reduce ? { width: `${m.pct * 2.4}%` } : { width: 0 }}
                      whileInView={{ width: `${m.pct * 2.4}%` }}
                      viewport={{ once: true, amount: 0.5 }}
                      transition={{ duration: 0.9, delay: 0.1 + i * 0.1, ease: "easeOut" }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 surface-inset px-4 py-3">
              <div className="flex justify-between items-baseline mb-2 text-[12px]">
                <span className="text-txt-3">Monthly budget used</span>
                <span className="font-semibold tabular text-txt-1" data-no-translate>68%</span>
              </div>
              <div className="h-2 bg-surface-4 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "linear-gradient(90deg, hsl(var(--accent)), hsl(var(--net)))" }}
                  initial={reduce ? { width: "68%" } : { width: 0 }}
                  whileInView={{ width: "68%" }}
                  viewport={{ once: true, amount: 0.5 }}
                  transition={{ duration: 1.1, delay: 0.4, ease: "easeOut" }}
                />
              </div>
            </div>
          </motion.div>
        </section>

        {/* MARKETS -------------------------------------------------------- */}
        <section className="relative px-5 py-14 bg-surface-1/40 border-y border-border/60 overflow-hidden">
          <div aria-hidden className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(60% 45% at 50% 55%, hsl(var(--accent) / 0.07), transparent 70%)" }} />
          <div className="relative text-center">
            <span className="inline-flex items-center gap-2 font-mono-tab text-[10px] uppercase tracking-ticker text-txt-3">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" />
              Markets ·{" "}
              {reduce ? (
                <span className="text-accent">DSE</span>
              ) : (
                <RotatingText texts={["DSE", "CRYPTO", "S&P 500", "FX · BONDS"]} mainClassName="text-accent" staggerFrom="last" staggerDuration={0.015} rotationInterval={2000} />
              )}
            </span>
            <h2 className="mt-4 text-[26px] leading-[1.1] font-bold tracking-tight">
              {reduce ? (
                <>{MK_HEADING_LEAD} <span className="gradient-text">{MK_HEADING_TAIL}</span></>
              ) : (
                <TrueFocus sentence={`${MK_HEADING_LEAD} ${MK_HEADING_TAIL}`} blurAmount={4} borderColor="hsl(var(--accent))" glowColor="hsl(var(--accent) / 0.6)" animationDuration={0.6} pauseBetweenAnimations={1.4} />
              )}
            </h2>
            <p className="mt-4 text-[13px] text-txt-3 leading-relaxed max-w-sm mx-auto">
              DSE equities, crypto, global indexes and forex — tracked live, next to the money
              you actually hold. One orbit, every asset that matters to a Tanzanian wallet.
            </p>
          </div>

          {/* Live market chips orbiting a flipping TZS banknote */}
          <div className="relative mt-6 h-[340px]">
            {reduce ? (
              <div className="grid grid-cols-2 gap-3">
                {orbitAssets.slice(0, 4).map((a) => <MarketChip key={a.sym} row={a} />)}
              </div>
            ) : (
              <>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <NoteLayer variant="flip" denoms={["10k"]} glow="accent" width={140} className="opacity-90" />
                </div>
                <OrbitRing className="absolute inset-0" radius={140} duration={44} tilt={-10} items={orbitAssets.slice(0, 6).map((a) => <MarketChip key={a.sym} row={a} />)} />
              </>
            )}
          </div>
          <p className="relative mt-4 text-center font-mono-tab text-[10px] uppercase tracking-ticker text-txt-3">
            DSE · Crypto · Indexes · Forex — refreshed through the trading day
          </p>
        </section>

        {/* WHY ------------------------------------------------------------ */}
        <section className="px-5 py-12">
          <Eyebrow>Why PesaLens</Eyebrow>
          <h2 className="mt-4 text-[26px] leading-[1.1] font-bold tracking-tight">
            Stop reading bank statements <span className="font-serif-display italic font-light text-txt-2">by hand.</span>
          </h2>
          <p className="mt-4 text-[13.5px] text-txt-2 leading-relaxed">
            Whether you're an individual tracking groceries or a vendor closing the books at
            the end of the day — PesaLens replaces a folder of PDFs with one
            continuously-reconciled view of your money.
          </p>

          {/* The nation's cash, in rotation */}
          <div className="relative h-[300px] my-4">
            {reduce ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <NoteLayer variant="flip" denoms={["1k"]} glow="net" width={220} />
              </div>
            ) : (
              <OrbitRing
                className="absolute inset-0"
                radius={128}
                duration={40}
                tilt={-12}
                items={["1k", "2k", "5k", "10k", "1k", "2k"].map((denom, i) => (
                  <WhyRingNote key={`${denom}-${i}`} denom={denom} side={i > 3 ? "back" : "front"} />
                ))}
              />
            )}
          </div>

          <div className="mt-2 space-y-3">
            {[
              ["CRDB · NMB · NBC · Stanbic", "bank statements — PDFs or photographed pages — parsed into one ledger"],
              ["M-Pesa · Airtel Money", "mobile-money statements reconciled right next to your bank"],
              ["TRA receipts", "snap a receipt; vendor, VAT and line items come back typed"],
              ["Kiswahili & English", "an AI controller grounded on your actual statement"],
              ["Auto-reconciliation", "every upload is balanced against the closing figure"],
              ["DSE · Crypto · Forex", "live markets and an investment simulator beside your cash flow"],
            ].map(([n, d]) => (
              <div key={n} className="flex items-baseline gap-3 border-b border-border/40 pb-2.5">
                <span className="font-mono-tab text-[10px] uppercase tracking-ticker text-accent w-28 shrink-0 leading-relaxed" data-no-translate>{n}</span>
                <span className="text-[12.5px] text-txt-2 leading-relaxed">{d}</span>
              </div>
            ))}
          </div>
        </section>

        {/* CTA ------------------------------------------------------------ */}
        <section className="px-5 pb-12">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.5 }}
            className="ios-group p-6 relative overflow-hidden"
            style={{ background: "linear-gradient(160deg, hsl(var(--surface-2)) 0%, hsl(var(--surface-1)) 100%)" }}
          >
            <div className="absolute inset-0 grid-dot opacity-40 pointer-events-none" />
            <div aria-hidden className="absolute -top-20 -right-20 w-60 h-60 rounded-full" style={{ background: "radial-gradient(closest-side, hsl(var(--accent) / 0.22), transparent 70%)", filter: "blur(40px)" }} />
            <div className="relative">
              <Eyebrow>Get started</Eyebrow>
              <h2 className="mt-4 text-[26px] leading-[1.1] font-bold tracking-tight">
                Open PesaLens.
                <br />
                <span className="font-serif-display italic font-light text-txt-2">Upload one statement.</span>
              </h2>
              <p className="mt-3 text-[13.5px] text-txt-2 leading-relaxed">
                Free trial for 14 days. No card. We'll have your numbers talking back to you in
                under a minute.
              </p>
              <div className="mt-5 flex flex-col gap-2.5">
                <StarBorder color="hsl(var(--accent))" speed="4.5s" className="w-full block" innerClassName="rounded-xl">
                  <Link to="/signup" className="bg-gradient-accent text-primary-foreground text-[14px] font-semibold px-5 py-3 rounded-xl inline-flex w-full items-center justify-center gap-2 shadow-lift">
                    Start 14-day free trial <ArrowRight className="w-4 h-4" />
                  </Link>
                </StarBorder>
                <Link to="/signin" className="border border-border/60 bg-surface-2 text-foreground text-[14px] font-semibold px-5 py-3 rounded-xl inline-flex items-center justify-center">
                  Sign In
                </Link>
              </div>
              <p className="mt-3 text-[11px] text-txt-3 text-center">
                Encrypted in transit · Statements never resold · Delete your data any time
              </p>
            </div>
          </motion.div>

          {/* FOOTER */}
          <div className="mt-10 pt-8 border-t border-border/60">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl overflow-hidden bg-surface-2 border border-border/60 flex items-center justify-center">
                <img src="/logo.png" alt="PesaLens" className="w-full h-full object-cover" />
              </div>
              <span className="text-[15px] font-bold tracking-tight" data-no-translate>Pesa<span className="text-accent">Lens</span></span>
            </div>
            <p className="mt-3 text-[12.5px] text-txt-3 leading-relaxed max-w-xs">
              Financial intelligence for individuals and small businesses across Tanzania.
            </p>

            <div className="mt-6 grid grid-cols-2 gap-6">
              <div>
                <h4 className="font-mono-tab text-[10px] uppercase tracking-ticker text-txt-3 mb-3">Product</h4>
                <div className="space-y-2 text-[13px] text-txt-2">
                  <Link to="/signup" className="block hover:text-foreground transition-colors">Start free trial</Link>
                  <Link to="/signup" className="block hover:text-foreground transition-colors">Open an account</Link>
                  <Link to="/signin" className="block hover:text-foreground transition-colors">Sign In</Link>
                </div>
              </div>
              <div>
                <h4 className="font-mono-tab text-[10px] uppercase tracking-ticker text-txt-3 mb-3">Legal</h4>
                <div className="space-y-2 text-[13px] text-txt-3">
                  <p>Terms of Service — coming soon</p>
                  <p>Privacy Policy — coming soon</p>
                </div>
              </div>
            </div>

            <div className="mt-7 pt-5 border-t border-border/60 flex items-center justify-between text-[10px] font-mono-tab uppercase tracking-ticker text-txt-3">
              <span data-no-translate>© 2026 PesaLens · All rights reserved</span>
              <span className="inline-flex items-center gap-2" data-no-translate>
                <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-accent to-net" />
                Built in Tanzania
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Landing;
