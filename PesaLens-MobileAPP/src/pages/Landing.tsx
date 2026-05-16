import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  BookOpen,
  Eye,
  Globe,
  LineChart,
  Moon,
  ScanLine,
  Sparkles,
  Sun,
  Upload as UploadIcon,
  Wallet,
  Zap,
} from "lucide-react";
// @ts-ignore — JS module
import { fetchPublicTicker } from "@/data/api";
// @ts-ignore — JS module
import { useTheme } from "@/data/theme";
// @ts-ignore — JS module
import { useT, setLang as setI18nLang } from "@/data/i18n";

/* --------------------------------------------------------------------------
   Mobile Landing — port of the web LandingPage, recomposed for a 440px
   single-column WebView. Keeps the same Dark Editorial language: surface
   hero with KPI mock, marquee ticker, three-step ledger, bento feature
   grid, "why" stats column, and a sealing CTA. Used by both:
     • the Capacitor APK (first screen for unauthenticated users)
     • the PWA install (same bundle, same code path)
   Auth flow is unchanged — Get started / Sign in route to the existing
   /signup and /signin pages.
   -------------------------------------------------------------------------- */

type TickerRow = { sym: string; val: string; pct: number | null; kind?: string };

const FALLBACK_TICKER: TickerRow[] = [
  { sym: "CRDB",    val: "2,700",   pct: 3.45,  kind: "stock" },
  { sym: "NMB",     val: "4,600",   pct: -0.6,  kind: "stock" },
  { sym: "USD/TZS", val: "2,608",   pct: null,  kind: "fx" },
  { sym: "BTC",     val: "$76,146", pct: -2.05, kind: "crypto" },
  { sym: "ETH",     val: "$2,269",  pct: -1.95, kind: "crypto" },
  { sym: "S&P 500", val: "7,174",   pct: 0.91,  kind: "index" },
];

const formatPct = (pct: number | null) => {
  if (pct == null || Number.isNaN(Number(pct))) return null;
  const n = Number(pct);
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(2)}%`;
};

// Tiny SVG sparkline so the hero card doesn't pull recharts.
const Spark = ({
  values,
  color,
  width = 320,
  height = 64,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
}) => {
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
  const id = `spark-${color.replace("#", "")}`;
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block"
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <div className="inline-flex items-center gap-2.5">
    <span className="h-px w-5 bg-border" />
    <span className="text-[10px] uppercase tracking-ticker font-semibold text-txt-2">
      {children}
    </span>
  </div>
);

const Landing = () => {
  const reduce = useReducedMotion();
  const [ticker, setTicker] = useState<TickerRow[]>(FALLBACK_TICKER);
  const [theme, toggleTheme] = useTheme() as [string, () => void];
  const { lang } = useT() as { lang: string };

  const flipLang = () => setI18nLang(lang === "en" ? "sw" : "en");

  useEffect(() => {
    let alive = true;
    fetchPublicTicker()
      .then((items: TickerRow[]) => {
        if (alive && items?.length) setTicker(items);
      })
      .catch(() => { /* fallback stays */ });
  }, []);

  const inSeries  = [820, 940, 905, 1100, 1240, 1180, 1320, 1410, 1380, 1505, 1620, 1580];
  const outSeries = [610, 580, 720, 660, 790, 700, 830, 760, 900, 820, 940, 880];
  const netSeries = inSeries.map((v, i) => v - outSeries[i]);

  return (
    <div className="min-h-screen bg-deep text-foreground overflow-x-hidden">
      {/* Solid status-bar spacer. Capacitor's overlay-WebView mode lets
          content draw behind the OS clock/battery — without this strip,
          scrolling past the top makes hero text appear under the status
          bar. The spacer paints the same deep tone as the page so the
          status bar stays legible and content can never overlap it. */}
      <div className="pt-safe bg-deep relative z-50" />

      {/* Floating glass top bar — slim, edge-aware */}
      <header className="sticky top-0 z-40 px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="absolute inset-0 glass-pane border-b border-border/40 pointer-events-none" />
        <Link to="/" className="relative flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl overflow-hidden bg-surface-2 border border-border/60 shrink-0 flex items-center justify-center">
            <img src="/logo.svg" alt="PesaLens" className="w-full h-full object-contain p-[2px]" />
          </div>
          <span className="text-[15px] font-bold tracking-tight" data-no-translate>
            Pesa<span className="text-accent">Lens</span>
          </span>
        </Link>
        <div className="relative flex items-center gap-1">
          <button
            type="button"
            onClick={flipLang}
            aria-label="Toggle language"
            className="w-9 h-9 rounded-full bg-surface-2/80 border border-border/50 text-txt-2 hover:text-txt-1 inline-flex items-center justify-center gap-1 ios-press"
          >
            <Globe className="w-4 h-4" />
            <span className="text-[10px] font-mono-tab uppercase tracking-wider" data-no-translate>
              {lang}
            </span>
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="w-9 h-9 rounded-full bg-surface-2/80 border border-border/50 text-txt-2 hover:text-txt-1 inline-flex items-center justify-center ios-press"
          >
            {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
          <Link
            to="/signup"
            className="ml-1 bg-gradient-accent text-white text-[12px] font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1"
          >
            Start <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </header>

      {/* HERO ----------------------------------------------------------- */}
      <section className="relative px-5 pt-6 pb-10">
        <div
          aria-hidden
          className="absolute -top-10 -left-10 w-72 h-72 rounded-full"
          style={{ background: "radial-gradient(closest-side, hsl(var(--accent) / 0.18), transparent 70%)", filter: "blur(40px)" }}
        />
        <div
          aria-hidden
          className="absolute -bottom-20 -right-20 w-72 h-72 rounded-full"
          style={{ background: "radial-gradient(closest-side, hsl(var(--net) / 0.14), transparent 70%)", filter: "blur(40px)" }}
        />

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative"
        >
          <Eyebrow>Tanzania · TZS</Eyebrow>
          <h1 className="mt-4 text-[34px] leading-[1.05] font-bold tracking-tight">
            Read your statement
            <br />
            <span className="font-serif-display italic font-light text-txt-2">like</span>{" "}
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: "linear-gradient(135deg, hsl(var(--foreground)) 0%, hsl(var(--accent)) 60%, hsl(var(--net)) 100%)" }}>
              an analyst.
            </span>
          </h1>
          <p className="mt-4 text-[14px] text-txt-2 leading-relaxed">
            Upload a Tanzanian bank or mobile-money PDF. PesaLens reconstructs your ledger,
            categorises every transaction, surfaces hidden fees, and tells you what to fix.
          </p>

          <div className="mt-6 flex flex-col gap-2.5">
            <Link
              to="/signup"
              className="bg-gradient-accent text-white text-[14px] font-semibold px-5 py-3 rounded-xl inline-flex items-center justify-center gap-2 shadow-lift"
            >
              Start your free trial <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/signin"
              className="text-center text-[14px] font-semibold text-txt-2 hover:text-foreground py-2.5"
            >
              I already have an account
            </Link>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-txt-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-inc animate-pulse-dot" />
              Live system
            </span>
            <span>14-day free trial · no card</span>
          </div>
        </motion.div>

        {/* Hero KPI mock — surfaces the value before sign-up */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
          className="relative mt-8 ios-group p-5"
          style={{
            background: "linear-gradient(160deg, hsl(var(--surface-2)) 0%, hsl(var(--surface-1)) 100%)",
            boxShadow: "0 30px 60px -30px hsl(var(--accent) / 0.25), inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-inc" />
              <span className="text-[10px] uppercase tracking-ticker font-mono-tab text-txt-3" data-no-translate>
                Live preview
              </span>
            </div>
            <span className="text-[10px] font-mono-tab text-txt-3" data-no-translate>CRDB · 142 tx</span>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-ticker text-txt-3 mb-1">Net flow this month</div>
            <div className="flex items-baseline gap-2">
              <span className="text-txt-3 text-[15px] font-mono-tab" data-no-translate>TZS</span>
              <span className="text-[40px] font-bold tabular tracking-tight" data-no-translate>2.62M</span>
            </div>
            <div className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-inc">
              <ArrowUpRight className="w-3 h-3" />
              <span data-no-translate>+18.4% vs Oct</span>
            </div>
            <div className="mt-3 -mx-1">
              <Spark values={netSeries} color="hsl(230 89% 63%)" />
            </div>
          </div>

          <div className="hairline my-4" />

          <div className="grid grid-cols-2 gap-3">
            {[
              { l: "Money in",  v: "5.15M", d: "+12.3%", up: true,  c: "hsl(var(--inc))", s: inSeries },
              { l: "Money out", v: "2.53M", d: "+4.1%",  up: false, c: "hsl(var(--exp))", s: outSeries },
            ].map((k) => (
              <div key={k.l} className="surface-inset p-3">
                <div className="text-[10px] uppercase tracking-ticker text-txt-3">{k.l}</div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-txt-3 text-[10px] font-mono-tab" data-no-translate>TZS</span>
                  <span className="text-[18px] font-bold tabular" data-no-translate>{k.v}</span>
                </div>
                <div className={`mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold ${k.up ? "text-inc" : "text-exp"}`}>
                  {k.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  <span data-no-translate>{k.d}</span>
                </div>
                <div className="mt-2 -mx-1">
                  <Spark values={k.s} color={k.c} height={26} />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between text-[10px] text-txt-3 font-mono-tab uppercase tracking-ticker">
            <span data-no-translate>auto-categorized</span>
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-accent" />
              <span data-no-translate>pesalens.ai</span>
            </span>
          </div>
        </motion.div>
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
                {pctText && (
                  <span className={`tabular ${up ? "text-inc" : "text-exp"}`}>{pctText}</span>
                )}
                <span className="text-txt-4 mx-2">·</span>
              </span>
            );
          })}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-deep to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-deep to-transparent" />
      </div>

      {/* HOW IT WORKS --------------------------------------------------- */}
      <section className="px-5 py-12">
        <Eyebrow>Method</Eyebrow>
        <h2 className="mt-4 text-[26px] leading-[1.1] font-bold tracking-tight">
          From PDF to verdict,
          <br />
          <span className="font-serif-display italic font-light text-txt-2">in seconds.</span>
        </h2>

        <div className="mt-6 space-y-3">
          {[
            { tag: "Ingest",    title: "Upload your statement",        desc: "Bank or mobile-money PDF. We extract every line, even messy multi-page exports.", Icon: UploadIcon },
            { tag: "Reconcile", title: "Numbers tied to the closing",  desc: "Categorised, deduped, fees flagged, balance reconciled to the statement closing.", Icon: Eye },
            { tag: "Decide",    title: "Get an actionable plan",       desc: "Top mistakes, real opportunities, a 30-day plan — phrased for Tanzanian SMEs and individuals.", Icon: Sparkles },
          ].map((step, idx) => (
            <motion.div
              key={step.tag}
              initial={reduce ? false : { opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.45, delay: idx * 0.08 }}
              className="ios-group p-4 flex gap-3.5 items-start"
            >
              <div className="w-10 h-10 rounded-xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
                <step.Icon className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-mono-tab uppercase tracking-ticker text-accent">{step.tag}</div>
                <div className="text-[15px] font-semibold tracking-tight mt-0.5">{step.title}</div>
                <p className="text-[12.5px] text-txt-2 leading-relaxed mt-1">{step.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* FEATURES (BENTO) ---------------------------------------------- */}
      <section className="px-5 py-12 bg-surface-1/40 border-y border-border/60">
        <Eyebrow>What's in it</Eyebrow>
        <h2 className="mt-4 text-[26px] leading-[1.1] font-bold tracking-tight">
          Built for the way
          <br />
          <span className="font-serif-display italic font-light text-txt-2">money moves</span> here.
        </h2>

        <div className="mt-6 grid grid-cols-2 gap-3">
          {/* Feature 1 — full-width */}
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.45 }}
            className="col-span-2 ios-group p-4"
          >
            <div className="text-[10px] font-mono-tab uppercase tracking-ticker text-accent">Statement intelligence</div>
            <h3 className="mt-1.5 text-[18px] font-bold tracking-tight leading-tight">
              Every transaction gets a category, a counter-party, and a verdict.
            </h3>
            <p className="mt-2 text-[12.5px] text-txt-2 leading-relaxed">
              Reconstructs the ledger, flags duplicates, surfaces fees you didn't know you paid,
              explains why the balance doesn't tie.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { l: "Avg fee leak",   v: "TZS 38K" },
                { l: "Mis-classified", v: "< 2.7%" },
                { l: "Reconcile time", v: "6.4s" },
              ].map((s) => (
                <div key={s.l} className="surface-inset p-2.5">
                  <div className="text-[9px] uppercase tracking-ticker text-txt-3">{s.l}</div>
                  <div className="text-[14px] font-semibold tabular mt-0.5" data-no-translate>{s.v}</div>
                </div>
              ))}
            </div>
          </motion.div>

          {[
            { Icon: Zap,        tag: "KPI engine",  title: "Money-in, money-out, savings rate, expense growth — daily, monthly, quarterly." },
            { Icon: LineChart,  tag: "Markets",     title: "DSE, crypto, S&P, forex with strategies tailored to your cash flow." },
            { Icon: Wallet,     tag: "Receipts",    title: "Snap a TRA receipt → typed line items in seconds." },
            { Icon: BookOpen,   tag: "Bookkeeping", title: "Sales, expenses, debts — purpose-built for Tanzanian SMEs." },
          ].map((f, idx) => (
            <motion.div
              key={f.tag}
              initial={reduce ? false : { opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.45, delay: 0.05 + idx * 0.06 }}
              className="ios-group p-3.5 flex flex-col gap-2.5"
            >
              <div className="flex items-center justify-between">
                <f.Icon className="w-4.5 h-4.5 text-foreground" />
                <span className="text-[9px] font-mono-tab uppercase tracking-ticker text-txt-3">{f.tag}</span>
              </div>
              <p className="text-[12.5px] text-foreground leading-snug">{f.title}</p>
            </motion.div>
          ))}

          {/* Receipt scanner row */}
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.45 }}
            className="col-span-2 ios-group p-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <ScanLine className="w-4 h-4 text-accent animate-pulse-dot" />
              <span className="text-[10px] font-mono-tab uppercase tracking-ticker text-accent" data-no-translate>OCR · #4012</span>
            </div>
            <h3 className="text-[16px] font-semibold tracking-tight">Receipts scanned in seconds</h3>
            {[
              ["Shoprite Mlimani", "TZS 48,200"],
              ["VAT 18%",          "TZS 7,353"],
              ["Category",         "Groceries"],
            ].map(([l, v]) => (
              <div key={l} className="flex items-center justify-between py-1.5 text-[13px] border-b border-border/40 last:border-0">
                <span className="text-txt-2">{l}</span>
                <span className="text-foreground font-semibold tabular" data-no-translate>{v}</span>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* WHY ------------------------------------------------------------ */}
      <section className="px-5 py-12">
        <Eyebrow>Why us</Eyebrow>
        <h2 className="mt-4 text-[26px] leading-[1.1] font-bold tracking-tight">
          Numbers you can <span className="font-serif-display italic font-light text-txt-2">trust.</span>
        </h2>
        <p className="mt-3 text-[13.5px] text-txt-2 leading-relaxed">
          Everything is grounded in your real statement. Nothing fabricated, nothing rounded
          beyond recognition. Built specifically for Tanzanian banks and mobile-money providers.
        </p>

        <div className="mt-6 space-y-3">
          {[
            ["10+ hrs",  "monthly, recovered from manual reconciliation"],
            ["97.3%",    "extraction accuracy on Tanzanian bank PDFs"],
            ["Sub-7s",   "from upload to first KPI rendered"],
            ["Built",    "for individuals, freelancers, vendors and SMEs"],
          ].map(([n, d]) => (
            <div key={n} className="flex items-baseline gap-4 border-b border-border/40 pb-2.5">
              <span className="font-serif-display italic text-[22px] font-light text-foreground w-20 shrink-0" data-no-translate>{n}</span>
              <span className="text-[13px] text-txt-2 leading-relaxed">{d}</span>
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
          style={{
            background: "linear-gradient(160deg, hsl(var(--surface-2)) 0%, hsl(var(--surface-1)) 100%)",
          }}
        >
          <div
            aria-hidden
            className="absolute -top-20 -right-20 w-60 h-60 rounded-full"
            style={{ background: "radial-gradient(closest-side, hsl(var(--accent) / 0.22), transparent 70%)", filter: "blur(40px)" }}
          />
          <div className="relative">
            <Eyebrow>Start now</Eyebrow>
            <h2 className="mt-4 text-[26px] leading-[1.1] font-bold tracking-tight">
              Stop guessing where
              <br />
              <span className="font-serif-display italic font-light text-txt-2">your money went.</span>
            </h2>
            <p className="mt-3 text-[13.5px] text-txt-2 leading-relaxed">
              14 days free, no card needed. Cancel anytime, export everything if you do.
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              <Link
                to="/signup"
                className="bg-gradient-accent text-white text-[14px] font-semibold px-5 py-3 rounded-xl inline-flex items-center justify-center gap-2 shadow-lift"
              >
                Start your free trial <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to="/signin"
                className="border border-border/60 bg-surface-2 text-foreground text-[14px] font-semibold px-5 py-3 rounded-xl inline-flex items-center justify-center"
              >
                Sign in
              </Link>
            </div>
            <p className="mt-3 text-[11px] text-txt-3 text-center">
              By continuing you agree to our{" "}
              <Link to="/terms" className="text-accent font-semibold">Terms</Link>{" "}
              and{" "}
              <Link to="/privacy" className="text-accent font-semibold">Privacy Policy</Link>.
            </p>
          </div>
        </motion.div>

        <div className="mt-8 text-center">
          <div className="text-[10px] font-mono-tab uppercase tracking-ticker text-txt-3" data-no-translate>
            PESALENS · v1.0.0
          </div>
          <p className="text-[11px] text-txt-4 mt-1 font-mono-tab">Built in Tanzania</p>
          <div className="mt-3 flex items-center justify-center gap-3 text-[11px] text-txt-3">
            <Link to="/terms" className="hover:text-foreground">Terms</Link>
            <span className="text-txt-4">·</span>
            <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Landing;
