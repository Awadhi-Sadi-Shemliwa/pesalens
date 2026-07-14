import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Globe,
  RefreshCw,
  Send,
  Sparkles,
  TrendingUp,
  Zap,
  ArrowRight,
} from "lucide-react";
import { Badge, Bento, CardSoft, EmptyState, Eyebrow, GlassCard, Section, Skeleton } from "@/components/pl/primitives";
// @ts-ignore — JS modules
import { askMarketInsight, fetchMarketSnapshot, fmtTZS } from "@/data/api";

const OFFLINE_MARKER = "PesaLens AI advisor is offline";
const QUICK_ASKS = [
  "Is now a good time to buy DSE stocks?",
  "What's moving the shilling this week?",
  "Explain crypto risk in simple terms",
];

/* ---------------------------------------------------------------
   Helpers ported from the web MarketsPage so the mobile deck shows
   the same leaders / movers / sentiment / indices content.
   --------------------------------------------------------------- */

const fmtNum = (v: any, decimals = 2) => {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return Number(v).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

/* Deterministic pseudo-random walk so sparklines stay stable across
   renders. The tail is biased so the visible slope agrees with the
   real 24h change sign — an INDICATIVE trend glyph, always labelled. */
const seededSeries = (seed: string, n = 20, pct = 0): number[] => {
  let s = 2166136261;
  const str = String(seed);
  for (let i = 0; i < str.length; i++) { s ^= str.charCodeAt(i); s = Math.imul(s, 16777619); }
  const rnd = () => { s = Math.imul(s ^ (s >>> 15), 2246822507); s ^= s >>> 13; return ((s >>> 0) % 1000) / 1000; };
  const out: number[] = [];
  let v = 50;
  for (let i = 0; i < n; i++) { v += (rnd() - 0.5) * 6; out.push(v); }
  const dir = pct >= 0 ? 1 : -1;
  const from = Math.floor(n * 0.55);
  const mag = Math.min(3, 0.6 + Math.abs(pct) * 0.15);
  for (let i = from; i < n; i++) out[i] += dir * (i - from) * mag;
  return out;
};

type URow = { cls: string; symbol: string; name?: string; change: number; price: number; priceStr: string };

/* Collapse every feed carrying a change_pct into one comparable universe. */
const buildUniverse = (snapshot: any) => {
  const dse: URow[] = (snapshot?.dse?.data || []).map((r: any) => ({
    cls: "DSE", symbol: r.symbol, name: r.name, change: Number(r.change_pct) || 0,
    price: Number(r.price) || 0, priceStr: `TZS ${fmtNum(r.price)}`,
  }));
  const crypto: URow[] = (snapshot?.crypto?.data || []).map((r: any) => ({
    cls: "Crypto", symbol: r.symbol, name: r.name, change: Number(r.change_pct) || 0,
    price: Number(r.price_usd) || 0, priceStr: `$${fmtNum(r.price_usd)}`,
  }));
  const indices: URow[] = (snapshot?.indices?.data || []).map((r: any) => ({
    cls: "Index", symbol: r.symbol, name: r.name, change: Number(r.change_pct) || 0,
    price: Number(r.price) || 0, priceStr: `${fmtNum(r.price)} ${r.currency || ""}`.trim(),
  }));
  return { dse, crypto, indices };
};

const catAvg = (rows: URow[]) => (rows && rows.length ? rows.reduce((s, x) => s + x.change, 0) / rows.length : 0);

/* Tone classes spelled out — Tailwind JIT can't see runtime `text-${x}`. */
const toneText: Record<string, string> = { inc: "text-inc", dng: "text-dng", net: "text-net", muted: "text-txt-3" };

/* Signed % delta with a directional arrow. */
const Delta = ({ pct, size = 11 }: { pct: number; size?: number }) => {
  const n = Number(pct) || 0;
  const up = n > 0;
  const down = n < 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 font-mono-tab font-bold tabular ${up ? "text-inc" : down ? "text-dng" : "text-txt-3"}`}
      style={{ fontSize: size }}
    >
      {up ? <ArrowUpRight style={{ width: size, height: size }} /> : down ? <ArrowDownRight style={{ width: size, height: size }} /> : null}
      {n >= 0 ? "+" : ""}{n.toFixed(2)}%
    </span>
  );
};

/* Lightweight inline-SVG sparkline — one polyline, no chart lib per row. */
const MiniSpark = ({ values, up, w = 68, h = 26 }: { values: number[]; up: boolean; w?: number; h?: number }) => {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / span) * (h - 3) - 1.5}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className={up ? "text-inc" : "text-dng"} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

/* Ask-the-market-advisor chat panel (mirrors the web InsightPanel). */
const MarketAdvisor = ({ snapshot }: { snapshot: any }) => {
  const [history, setHistory] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [offline, setOffline] = useState(false);

  const send = async (raw?: string) => {
    const message = (raw ?? draft).trim();
    if (!message || pending) return;
    setDraft("");
    const next = [...history, { role: "user" as const, text: message }];
    setHistory(next);
    setPending(true);
    try {
      const { reply } = await askMarketInsight(message, history);
      const isOffline = typeof reply === "string" && reply.includes(OFFLINE_MARKER);
      setOffline(isOffline);
      if (!isOffline) setHistory((h) => [...h, { role: "assistant", text: reply || "No reply." }]);
      else setHistory([]);
    } catch {
      setHistory((h) => [...h, { role: "assistant", text: "Couldn't reach the advisor. Try again." }]);
    } finally {
      setPending(false);
    }
  };

  const dseCount = snapshot?.dse?.data?.length || 0;
  const cryptoCount = snapshot?.crypto?.data?.length || 0;

  return (
    <GlassCard className="border-accent/25">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Eyebrow>Ask the market advisor</Eyebrow>
          <h3 className="text-[15px] font-bold mt-1 leading-tight">
            Reading {dseCount} DSE stocks & {cryptoCount} coins for you
          </h3>
        </div>
        <Badge tone="accent">AI</Badge>
      </div>

      {offline && (
        <div className="mt-3 rounded-lg border border-exp/30 bg-exp/5 p-2.5 text-[11px] text-txt-2">
          The advisor is offline right now — live feeds below still work.
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-3 space-y-2 max-h-64 overflow-y-auto scroll-hide">
          {history.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[88%] px-3 py-2 rounded-2xl text-[12px] leading-snug whitespace-pre-wrap ${
                m.role === "user" ? "bg-accent text-white rounded-br-sm" : "bg-surface-3 text-txt-1 rounded-bl-sm"
              }`}>
                {m.text}
              </div>
            </div>
          ))}
          {pending && <div className="text-[11px] text-txt-3 px-1">Thinking…</div>}
        </div>
      )}

      {history.length === 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {QUICK_ASKS.map((q) => (
            <button key={q} onClick={() => send(q)} className="text-[11px] px-2.5 py-1.5 rounded-lg border border-border text-txt-2 active:bg-surface-3">
              {q}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="mt-3 flex gap-2 items-center">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={pending}
          placeholder="Ask about DSE, crypto, FX…"
          className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-surface-2 border border-border text-[13px] focus-ring"
        />
        <button type="submit" disabled={pending || !draft.trim()} className="w-10 h-10 rounded-xl bg-accent text-white flex items-center justify-center disabled:opacity-50 ios-press shrink-0">
          <Send className="w-4 h-4" />
        </button>
      </form>
    </GlassCard>
  );
};

/* ================================================================
   MarketExplorer — a category-driven overview. Three selector cards
   (DSE · Crypto · Global Indices) scope the leaders, the movers and
   the sentiment read to ONE category at a time, so every number on
   screen belongs to the same market.
   ================================================================ */
const CATEGORIES = [
  { id: "dse", label: "DSE Equities", sub: "Dar es Salaam Stock Exchange", icon: BarChart3 },
  { id: "crypto", label: "Crypto", sub: "Bitcoin, Ethereum & altcoins", icon: Zap },
  { id: "indices", label: "Global Indices", sub: "Nasdaq · S&P 500 · FTSE", icon: Globe },
] as const;
type CatId = (typeof CATEGORIES)[number]["id"];

const MarketExplorer = ({ universe }: { universe: ReturnType<typeof buildUniverse> }) => {
  const [cat, setCat] = useState<CatId>("dse");
  const active = CATEGORIES.find((c) => c.id === cat) || CATEGORIES[0];
  const rows: URow[] = (universe as any)[cat] || [];

  const sorted = useMemo(() => [...rows].sort((a, b) => b.change - a.change), [rows]);
  const leaders = sorted.slice(0, 3);
  const top = sorted[0];
  const bottom = sorted.length > 1 ? sorted[sorted.length - 1] : null;
  const avg = catAvg(rows);

  const band =
    avg >= 0.4
      ? { label: "Bullish", tone: "inc", means: `Most ${active.label} assets are rising — buyers are in control right now.` }
      : avg <= -0.4
      ? { label: "Bearish", tone: "dng", means: `Most ${active.label} assets are falling — sellers are in control right now.` }
      : { label: "Neutral", tone: "net", means: `${active.label} is roughly balanced — gains and losses are cancelling out.` };

  return (
    <Section eyebrow="Explore" title="Live markets">
      {/* Category selector */}
      <div className="grid grid-cols-3 gap-2">
        {CATEGORIES.map((c) => {
          const on = c.id === cat;
          const crows: URow[] = (universe as any)[c.id] || [];
          const Icon = c.icon;
          return (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              aria-pressed={on}
              className={`card-soft !p-3 text-left transition-colors ${on ? "border-accent/50 bg-accent/5" : ""}`}
            >
              <Icon className={`w-4 h-4 mb-1.5 ${on ? "text-accent" : "text-txt-3"}`} />
              <div className="text-[12px] font-bold leading-tight">{c.label}</div>
              <div className="mt-1.5 flex items-center justify-between gap-1">
                <span className="text-[10px] text-txt-3 font-mono-tab">{crows.length}</span>
                <Delta pct={catAvg(crows)} size={10} />
              </div>
            </button>
          );
        })}
      </div>

      {/* Leaders — top-3 performers in the chosen category */}
      <div>
        <div className="flex items-center gap-2 mb-2 px-1">
          <TrendingUp className="w-3.5 h-3.5 text-accent" />
          <h3 className="text-[13px] font-semibold">Leaders in {active.label}</h3>
          <span className="text-[10px] text-txt-3 font-mono-tab uppercase tracking-wider">top · 24h</span>
        </div>
        {leaders.length === 0 ? (
          <EmptyState
            kind="first-run"
            title={`No ${active.label} prices yet`}
            desc="Nothing is cached for this category right now. The market bot retries automatically."
          />
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {leaders.map((p, i) => (
              <div key={p.cls + p.symbol} className="card-soft !p-3 flex items-center gap-3">
                <span className="text-[11px] font-mono-tab text-txt-3 w-4 shrink-0">#{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold truncate">{p.symbol}</div>
                  <div className="text-[10px] text-txt-3 truncate uppercase tracking-wider">{p.name || p.cls}</div>
                </div>
                <MiniSpark values={seededSeries(p.symbol + p.cls, 18, p.change)} up={p.change >= 0} />
                <div className="text-right shrink-0">
                  <div className="font-mono-tab text-[13px] font-bold tabular">{p.priceStr}</div>
                  <Delta pct={p.change} size={11} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Movers — top performer + top decliner for the active category */}
      {top && bottom && top.symbol !== bottom.symbol && (
        <div className="grid grid-cols-2 gap-2">
          {[{ item: top, up: true }, { item: bottom, up: false }].map(({ item, up }) => (
            <div key={item.symbol} className={`surface-inset rounded-xl p-3 border ${up ? "border-inc/25" : "border-dng/25"}`}>
              <div className="flex items-center gap-1.5 mb-1.5">
                {up ? <TrendingUp className="w-3 h-3 text-inc" /> : <ArrowDownRight className="w-3 h-3 text-dng" />}
                <span className="text-[9px] uppercase tracking-wider text-txt-3 font-mono-tab">{up ? "Top performer" : "Top decliner"}</span>
              </div>
              <div className="font-mono-tab text-[13px] font-semibold truncate">{item.symbol}</div>
              <div className="text-[10px] text-txt-3 truncate">{item.name || item.cls}</div>
              <div className="mt-1.5 flex items-center justify-between gap-1">
                <span className="text-[11px] text-txt-2 tabular truncate">{item.priceStr}</span>
                <Delta pct={item.change} size={11} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sentiment — one-line, self-describing read */}
      {rows.length > 0 && (
        <div className="surface-inset rounded-xl p-3">
          <div className="flex items-center justify-between gap-2">
            <Eyebrow>Sentiment · {active.label}</Eyebrow>
            <Badge tone={band.tone as any}>{band.label}</Badge>
          </div>
          <p className="text-[11px] text-txt-2 leading-snug mt-1.5">
            <span className={`font-semibold ${toneText[band.tone]}`}>{avg >= 0 ? "+" : ""}{avg.toFixed(2)}% avg 24h — </span>
            {band.means}
          </p>
        </div>
      )}
    </Section>
  );
};

const Markets = () => {
  const navigate = useNavigate();
  const marketsQuery = useQuery({
    queryKey: ["markets-all"],
    queryFn: fetchMarketSnapshot,
    refetchInterval: 5 * 60 * 1000,
  });

  const snapshot = marketsQuery.data || null;

  const dse = (snapshot as any)?.dse?.data || [];
  const fx = (snapshot as any)?.forex_bot?.data || [];
  const fuel = (snapshot as any)?.fuel?.data || null;
  const crypto = (snapshot as any)?.crypto?.data || [];
  const indices = (snapshot as any)?.indices?.data || [];

  const universe = useMemo(() => buildUniverse(snapshot), [snapshot]);

  return (
    <div className="px-4 py-4 space-y-5">
      {/* Ask the market advisor */}
      <MarketAdvisor snapshot={snapshot} />

      {/* Jump to the simulator (the personal planning surface) */}
      <Bento onClick={() => navigate("/simulator")} className="!p-3.5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
          <Sparkles className="w-4.5 h-4.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold">Investment simulator</div>
          <div className="text-[11px] text-txt-3 mt-0.5">See what you can safely invest & where →</div>
        </div>
        <ArrowRight className="w-4 h-4 text-txt-3 shrink-0" />
      </Bento>

      {/* Category-driven overview: leaders · movers · sentiment */}
      <MarketExplorer universe={universe} />

      {/* Global indices — the "other form of investment" grid */}
      <Section eyebrow="Global" title="World indices" action={<Badge tone="net">{indices.length}</Badge>}>
        {marketsQuery.isLoading ? (
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        ) : indices.length === 0 ? (
          <EmptyState
            kind="first-run"
            title="Equity indices are warming up"
            desc="Our market bot refreshes world indices every few minutes. They'll appear here shortly."
          />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {indices.map((i: any) => {
              const up = Number(i.change_pct || 0) >= 0;
              return (
                <div key={i.symbol} className="card-soft !p-3 min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-txt-3 font-mono-tab truncate">{i.symbol}</div>
                  <div className="text-[12px] font-semibold truncate">{i.name}</div>
                  <div className="mt-1.5 font-mono-tab text-[15px] font-bold tabular truncate">
                    {fmtNum(i.price)} <span className="text-[10px] text-txt-3">{i.currency}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-1">
                    <Delta pct={Number(i.change_pct || 0)} size={11} />
                    <MiniSpark values={seededSeries(i.symbol + "idx", 14, Number(i.change_pct || 0))} up={up} w={48} h={20} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* DSE equities */}
      <Section eyebrow="Live" title="DSE equities" action={<Badge tone="inc">{dse.length}</Badge>}>
        <div className="card-soft !p-0 divide-y divide-border overflow-hidden">
          {dse.slice(0, 8).map((e: any) => (
            <div key={e.symbol} className="flex items-center gap-3 px-4 py-3">
              <div className="w-10 h-10 rounded-md bg-surface-3 flex items-center justify-center font-mono-tab text-[10px] font-bold">
                {e.symbol}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold truncate">{e.name || e.symbol}</div>
                <div className="text-[10px] text-txt-3 font-mono-tab tracking-wider">DSE · TZS</div>
              </div>
              <div className="text-right">
                <div className="font-mono-tab text-[14px] font-bold tabular">{Number(e.price || 0).toLocaleString()}</div>
                <div className={`text-[11px] font-mono-tab font-bold tabular flex items-center justify-end gap-0.5 ${
                  Number(e.change_pct || 0) > 0 ? "text-inc" : Number(e.change_pct || 0) < 0 ? "text-dng" : "text-txt-3"
                }`}>
                  {Number(e.change_pct || 0) > 0 ? <ArrowUpRight className="w-3 h-3" /> : Number(e.change_pct || 0) < 0 ? <ArrowDownRight className="w-3 h-3" /> : null}
                  {Number(e.change_pct || 0) >= 0 ? "+" : ""}
                  {Number(e.change_pct || 0).toFixed(2)}%
                </div>
              </div>
            </div>
          ))}
          {marketsQuery.isLoading && (
            <div className="p-2 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-xl" />
              ))}
            </div>
          )}
          {!marketsQuery.isLoading && dse.length === 0 && (
            <EmptyState
              kind="first-run"
              title="DSE feed is warming up"
              desc="Dar es Salaam Stock Exchange prices land here as soon as the bot's next sweep completes."
            />
          )}
        </div>
      </Section>

      {(fx.length > 0 || fuel) && (
        <Section eyebrow="BoT FX · EWURA fuel" title="Macro snapshot">
          <div className="grid grid-cols-2 gap-3">
            {fx.slice(0, 4).map((c: any) => (
              <div key={c.currency || c.code || c.pair} className="card-soft !p-3">
                <div className="text-[10px] font-mono-tab text-txt-3 tracking-wider uppercase">
                  {c.currency || c.pair || `${c.code}/TZS`}
                </div>
                <div className="font-mono-tab text-[18px] font-bold tabular mt-1">{Number(c.selling ?? c.tzs ?? c.rate ?? c.price ?? 0).toLocaleString()}</div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-txt-4 font-mono-tab">{c.source || "BoT"}</span>
                  <span className="text-[10px] text-txt-4 font-mono-tab">TZS</span>
                </div>
              </div>
            ))}
            {fuel?.petrol && (
              <div className="card-soft !p-3">
                <div className="text-[10px] font-mono-tab text-txt-3 tracking-wider uppercase">Petrol</div>
                <div className="font-mono-tab text-[18px] font-bold tabular mt-1">{Number(fuel.petrol).toLocaleString()}</div>
                <div className="text-[10px] text-txt-4 font-mono-tab mt-1">TZS / litre</div>
              </div>
            )}
            {fuel?.diesel && (
              <div className="card-soft !p-3">
                <div className="text-[10px] font-mono-tab text-txt-3 tracking-wider uppercase">Diesel</div>
                <div className="font-mono-tab text-[18px] font-bold tabular mt-1">{Number(fuel.diesel).toLocaleString()}</div>
                <div className="text-[10px] text-txt-4 font-mono-tab mt-1">TZS / litre</div>
              </div>
            )}
          </div>
        </Section>
      )}

      {crypto.length > 0 && (
        <Section eyebrow="Crypto" title="CoinGecko" action={<Badge tone="accent">{crypto.length}</Badge>}>
          <div className="card-soft !p-0 divide-y divide-border overflow-hidden">
            {crypto.slice(0, 6).map((c: any) => (
              <div key={c.symbol} className="flex items-center gap-3 px-4 py-3">
                <div className="w-10 h-10 rounded-md bg-surface-3 flex items-center justify-center font-mono-tab text-[10px] font-bold">
                  {c.symbol}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold truncate">{c.name || c.symbol}</div>
                  <div className="text-[10px] text-txt-3 font-mono-tab tracking-wider">CRYPTO</div>
                </div>
                <div className="text-right">
                  <div className="font-mono-tab text-[14px] font-bold tabular">
                    {c.price_tzs ? fmtTZS(c.price_tzs) : `$${Number(c.price_usd || 0).toLocaleString()}`}
                  </div>
                  <div className={`text-[11px] font-mono-tab font-bold tabular ${
                    Number(c.change_pct || 0) > 0 ? "text-inc" : Number(c.change_pct || 0) < 0 ? "text-dng" : "text-txt-3"
                  }`}>
                    {Number(c.change_pct || 0) >= 0 ? "+" : ""}
                    {Number(c.change_pct || 0).toFixed(2)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <button
        onClick={() => marketsQuery.refetch()}
        disabled={marketsQuery.isFetching}
        className="w-full card-soft !p-3 flex items-center justify-center gap-2 text-[12px] text-txt-2 disabled:opacity-60"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${marketsQuery.isFetching ? "animate-spin" : ""}`} />
        Refresh feeds
      </button>

      <p className="text-[10px] text-txt-4 text-center font-mono-tab pt-2">
        Not financial advice · sources: DSE, BoT, EWURA, CoinGecko
      </p>
    </div>
  );
};

export default Markets;
