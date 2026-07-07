import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shield, TrendingUp, Zap, Wallet, LineChart as LineIcon } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge, Bento, CardSoft, Eyebrow, GlassCard, Pill, Section, Tilt } from "@/components/pl/primitives";
// @ts-ignore — JS modules
import { fetchDashboardSummary, fetchMarketSnapshot, fmtTZS, fmtTZSFull } from "@/data/api";
// @ts-ignore — JS modules
import {
  assetsInCategory,
  buildAssetUniverse,
  CAPACITY_TIERS,
  computeBuyPlan,
  investmentCapacity,
  recommendTier,
  simulateInvestment,
  suggestCheaperDseAsset,
} from "@/data/decisions";

type TierId = "safe" | "moderate" | "aggressive";
type CategoryId = "stable" | "stocks" | "crypto";

const tierMeta: Record<TierId, { label: string; subtitle: string }> = {
  safe: { label: "Just dip a toe", subtitle: "5% of surplus · low pressure" },
  moderate: { label: "Build the habit", subtitle: "15% of surplus · default" },
  aggressive: { label: "Go bigger", subtitle: "30% of surplus · OK with swings" },
};

const categoryMeta: Record<CategoryId, { label: string; sub: string; icon: any }> = {
  stable: { label: "Stable", sub: "USDT / USDC tokens", icon: Shield },
  stocks: { label: "Stocks", sub: "DSE listings", icon: LineIcon },
  crypto: { label: "Crypto", sub: "BTC, ETH, alts", icon: Zap },
};

const STRATEGIES = [
  { title: "Low-Risk Preservation", desc: "Fixed deposits, government bonds & money-market funds. For conservative profiles.", risk: "Low", tone: "inc" as const, icon: Shield },
  { title: "Balanced Growth", desc: "Fixed income + equities for steady growth at moderate risk. Medium-term goals.", risk: "Medium", tone: "exp" as const, icon: LineIcon },
  { title: "Aggressive Growth", desc: "Equity-heavy portfolio targeting high returns. Long time horizons only.", risk: "High", tone: "dng" as const, icon: TrendingUp },
  { title: "Emergency Fund First", desc: "Build 3–6 months of expenses in liquid savings before investing.", risk: "Low", tone: "inc" as const, icon: Wallet },
  { title: "50 / 30 / 20 Allocation", desc: "Split income across needs, wants & savings — a starter cash-flow framework.", risk: "Low", tone: "net" as const, icon: Zap },
];

const INSURANCE = [
  { name: "Jubilee Insurance", type: "Life & Health", desc: "Comprehensive life and health cover for individuals and families." },
  { name: "AAR Insurance", type: "Health", desc: "Health insurance with an extensive hospital network across Tanzania." },
  { name: "UAP Insurance", type: "General", desc: "Property, motor and business insurance for individuals and enterprises." },
  { name: "MetLife Tanzania", type: "Life & Savings", desc: "Life insurance and long-term savings with flexible premiums." },
];

const toneText: Record<string, string> = { inc: "text-inc", exp: "text-exp", dng: "text-dng", net: "text-net", accent: "text-accent", muted: "text-txt-3" };
const toneChip: Record<string, string> = { inc: "bg-inc/15 text-inc", exp: "bg-exp/15 text-exp", dng: "bg-dng/15 text-dng", net: "bg-net/15 text-net", accent: "bg-accent/15 text-accent" };

const FlowRow = ({ label, value, sign, tone = "muted", bold = false }: { label: string; value: string; sign?: string; tone?: string; bold?: boolean }) => (
  <div className="flex items-center gap-2">
    <span className={`w-3 text-center font-mono-tab text-[11px] ${toneText[tone]}`}>{sign || ""}</span>
    <span className="flex-1 text-txt-2">{label}</span>
    <span className={`font-mono-tab tabular text-right ${toneText[tone]} ${bold ? "font-bold text-[14px]" : "text-[13px]"}`}>{value}</span>
  </div>
);

/* Compounding projection — the "alive" money-growth curve (recharts). */
const ProjectionChart = ({ monthly, annual, drawdown }: { monthly: number; annual: number; drawdown: number }) => {
  const rows = useMemo(() => {
    const r = Math.pow(1 + (annual || 0), 1 / 12) - 1;
    const out = [];
    for (let m = 0; m <= 60; m++) {
      const fv = r === 0 ? monthly * m : monthly * ((Math.pow(1 + r, m) - 1) / r);
      out.push({ m, value: fv, invested: monthly * m, floor: fv * (1 - (drawdown || 0)) });
    }
    return out;
  }, [monthly, annual, drawdown]);

  const compact = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n)));

  return (
    <div className="h-52 -mx-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="simfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.16} />
              <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="m" stroke="hsl(var(--txt-3))" fontSize={10} tickLine={false} axisLine={false}
            ticks={[0, 12, 24, 36, 48, 60]} tickFormatter={(v) => (v === 0 ? "now" : `${v / 12}y`)} />
          <YAxis stroke="hsl(var(--txt-3))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={compact} width={38} />
          <Tooltip
            cursor={{ stroke: "hsl(var(--border))" }}
            content={({ active, payload }: any) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload;
              return (
                <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 shadow-lift text-[11px] font-mono-tab">
                  <div className="text-txt-3 uppercase tracking-wider text-[10px] mb-1">Month {p.m}</div>
                  <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-sm bg-accent" /><span className="text-txt-2">Value</span><span className="ml-auto font-bold">{fmtTZS(p.value)}</span></div>
                  <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-sm bg-txt-3" /><span className="text-txt-2">Put in</span><span className="ml-auto font-bold">{fmtTZS(p.invested)}</span></div>
                  <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-sm bg-dng" /><span className="text-txt-2">Bad month</span><span className="ml-auto font-bold">{fmtTZS(p.floor)}</span></div>
                </div>
              );
            }}
          />
          <Area type="monotone" dataKey="value" stroke="hsl(var(--accent))" strokeWidth={2.4} fill="url(#simfill)" />
          <Line type="monotone" dataKey="invested" stroke="hsl(var(--txt-3))" strokeWidth={2} strokeDasharray="6 4" dot={false} />
          <Line type="monotone" dataKey="floor" stroke="hsl(var(--dng))" strokeWidth={2} strokeDasharray="6 4" strokeOpacity={0.95} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

const Simulator = () => {
  const summaryQuery = useQuery({ queryKey: ["dashboard-summary"], queryFn: fetchDashboardSummary });
  const marketsQuery = useQuery({ queryKey: ["markets-all"], queryFn: fetchMarketSnapshot, refetchInterval: 5 * 60 * 1000 });

  const summary = summaryQuery.data || null;
  const snapshot = marketsQuery.data || null;

  const universe = useMemo(() => buildAssetUniverse(snapshot), [snapshot]);
  const cap = useMemo(() => investmentCapacity(summary), [summary]);
  const recommended: { id: TierId } = useMemo(() => recommendTier(summary), [summary]);

  const [tierId, setTierId] = useState<TierId>(recommended.id);
  const [categoryId, setCategoryId] = useState<CategoryId>("stocks");
  const [assetId, setAssetId] = useState<string | null>(null);

  const monthly = cap.capacity[tierId] || 0;
  const surplus = cap.flow.monthlySurplus || 0;
  const monthlyIn = cap.flow.monthlyIn || 0;
  const monthlyOut = cap.flow.monthlyOut || 0;
  const fees = useMemo(() => {
    const tc: any = (summary as any)?.transaction_costs || {};
    const total = Number(tc.estimated_total) || 0;
    const periods = Math.max(1, cap.flow.periods || 1);
    return total / periods;
  }, [summary, cap.flow.periods]);
  const tierPct = Math.round((CAPACITY_TIERS.find((t: any) => t.id === tierId)?.pct || 0) * 100);

  const assetsForCat = useMemo(() => assetsInCategory(universe, categoryId), [universe, categoryId]);
  const activeAsset = useMemo(() => {
    if (assetId) return assetsForCat.find((a: any) => a.id === assetId) || assetsForCat[0] || null;
    return assetsForCat[0] || null;
  }, [assetsForCat, assetId]);

  const buyPlan = useMemo(() => (activeAsset ? computeBuyPlan(activeAsset, monthly, surplus) : null), [activeAsset, monthly, surplus]);
  const cheaper = useMemo(
    () => (activeAsset && buyPlan && !buyPlan.meetsMinimum ? suggestCheaperDseAsset(universe, activeAsset, monthly) : null),
    [universe, activeAsset, buyPlan, monthly],
  );
  const sim = useMemo(() => (activeAsset ? simulateInvestment({ summary, asset: activeAsset, monthly }) : null), [summary, activeAsset, monthly]);

  const hasStatement = !!summary && !!(summary as any).upload_count;

  return (
    <div className="px-4 py-4 space-y-5">
      {/* Header */}
      <div className="px-1">
        <Eyebrow>Simulator</Eyebrow>
        <h1 className="text-[22px] font-bold leading-tight mt-0.5">Plan your first investment</h1>
        <p className="text-[12px] text-txt-3 mt-1 leading-snug">
          Turn your statement into a decision — how much to invest, where to put it, and what it could become.
        </p>
      </div>

      {!hasStatement ? (
        <Bento className="!p-0 overflow-hidden">
          <div className="p-5 bg-gradient-to-br from-accent/20 via-net/10 to-transparent">
            <Eyebrow>Your starting point</Eyebrow>
            <h3 className="text-[16px] font-bold mt-1.5">Upload a statement to begin</h3>
            <p className="text-[12px] text-txt-2 mt-2 leading-snug">
              The simulator reads your real cash flow to work out what you can safely invest. Add a statement and it lights up.
            </p>
            <button
              onClick={() => { window.location.hash = "#/upload"; }}
              className="mt-4 bg-accent text-white px-4 py-2.5 rounded-xl text-[13px] font-semibold ios-press"
            >
              Upload statement
            </button>
          </div>
        </Bento>
      ) : (
        <>
          {/* Hero — your starting point + the math chain */}
          <Bento className="!p-0 overflow-hidden">
            <div className="p-4 bg-gradient-to-br from-accent/20 via-net/10 to-transparent">
              <Eyebrow>Your starting point</Eyebrow>
              <div className="mt-2 flex items-baseline gap-2 flex-wrap">
                <span className="font-mono-tab text-[30px] font-bold tabular text-accent">{fmtTZS(monthly)}</span>
                <span className="text-[12px] text-txt-2">/ month is yours to invest</span>
              </div>

              <div className="mt-3 surface-inset rounded-xl p-3 space-y-2 text-[12px]">
                <div className="text-[10px] uppercase tracking-wider text-txt-3 font-mono-tab mb-1">How we got there (per month)</div>
                <FlowRow label="Money you received" value={fmtTZSFull(monthlyIn)} sign="+" tone="inc" />
                <FlowRow label="Spending (excl. fees)" value={fmtTZSFull(Math.max(0, monthlyOut - fees))} sign="−" tone="exp" />
                <FlowRow label="Bank & wallet fees" value={fmtTZSFull(fees)} sign="−" tone="exp" />
                <div className="hairline my-1" />
                <FlowRow label="Surplus left at month-end" value={fmtTZSFull(surplus)} sign="=" tone={surplus > 0 ? "net" : "dng"} bold />
                <FlowRow label={`Investable (${tierPct}% · ${tierMeta[tierId].label})`} value={fmtTZSFull(monthly)} sign="→" tone="accent" bold />
              </div>
              <p className="text-[10px] text-txt-3 mt-2 leading-snug">
                <span className="font-bold">Why these numbers:</span> "Money out" = Spending + Fees — not deducted twice. Surplus is what's literally left each month.
              </p>
            </div>
          </Bento>

          {/* Step 1 — tier */}
          <Section eyebrow="Step 1" title="How much each month?">
            <div className="grid grid-cols-1 gap-2">
              {CAPACITY_TIERS.map((t: any) => {
                const id = t.id as TierId;
                const amount = cap.capacity[id] || 0;
                const active = tierId === id;
                return (
                  <Tilt key={id} max={5}>
                    <button
                      onClick={() => setTierId(id)}
                      className={`w-full card-soft !p-3.5 flex items-center gap-3 text-left transition-colors ${active ? "border-accent/50 bg-accent/5" : ""}`}
                    >
                      <div className={`w-10 h-10 rounded-md flex items-center justify-center font-mono-tab text-[10px] font-bold ${active ? "bg-accent/15 text-accent" : "bg-surface-3 text-txt-3"}`}>
                        {Math.round(t.pct * 100)}%
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold">{tierMeta[id].label}</span>
                          {recommended.id === id && <Badge tone="accent">Recommended</Badge>}
                        </div>
                        <div className="text-[11px] text-txt-3 mt-0.5">{tierMeta[id].subtitle}</div>
                      </div>
                      <div className="font-mono-tab text-[14px] font-bold tabular shrink-0">{fmtTZS(amount)}</div>
                    </button>
                  </Tilt>
                );
              })}
            </div>
          </Section>

          {/* Step 2 — where + asset + buy plan */}
          <Section eyebrow="Step 2" title="Where will the money go?">
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(categoryMeta) as CategoryId[]).map((id) => {
                const active = categoryId === id;
                const Icon = categoryMeta[id].icon;
                return (
                  <button
                    key={id}
                    onClick={() => { setCategoryId(id); setAssetId(null); }}
                    className={`card-soft !p-3 text-left ${active ? "border-accent/50 bg-accent/5" : ""}`}
                  >
                    <Icon className={`w-4 h-4 mb-1.5 ${active ? "text-accent" : "text-txt-3"}`} />
                    <div className="text-[13px] font-bold">{categoryMeta[id].label}</div>
                    <div className="text-[10px] text-txt-3 mt-0.5">{categoryMeta[id].sub}</div>
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2 overflow-x-auto scroll-hide -mx-1 px-1 mt-3">
              {assetsForCat.length === 0 && (
                <span className="text-[11px] font-mono-tab text-txt-3 px-1">
                  {marketsQuery.isLoading ? "Loading assets…" : "No assets in this category yet."}
                </span>
              )}
              {assetsForCat.map((a: any) => (
                <Pill key={a.id} active={(activeAsset?.id || "") === a.id} onClick={() => setAssetId(a.id)}>
                  {a.symbol} · {Number(a.change || 0) >= 0 ? "+" : ""}{Number(a.change || 0).toFixed(1)}%
                </Pill>
              ))}
            </div>

            {activeAsset && buyPlan && (
              <CardSoft className="mt-3">
                <Eyebrow>Buy breakdown</Eyebrow>
                <div className="mt-2 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <div className="text-[10px] font-mono-tab text-txt-3 tracking-wider uppercase">Budget</div>
                    <div className="font-mono-tab text-[14px] font-bold tabular mt-1">{fmtTZS(buyPlan.cash)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono-tab text-txt-3 tracking-wider uppercase">Unit price</div>
                    <div className="font-mono-tab text-[14px] font-bold tabular mt-1">
                      {activeAsset.currency === "USD" ? `$${Number(activeAsset.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : fmtTZS(activeAsset.price)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono-tab text-txt-3 tracking-wider uppercase">You get</div>
                    <div className={`font-mono-tab text-[14px] font-bold tabular mt-1 ${buyPlan.meetsMinimum ? "text-inc" : "text-dng"}`}>
                      {buyPlan.fractional ? `${Number(buyPlan.units).toFixed(buyPlan.units < 1 ? 6 : 4)}` : buyPlan.lots > 0 ? `${buyPlan.lots * (buyPlan.lotQty || 1)}` : "0"}
                    </div>
                  </div>
                </div>
                {!buyPlan.meetsMinimum ? (
                  <div className="mt-3 text-[12px] text-dng bg-dng/10 border border-dng/30 rounded-lg p-3">
                    {buyPlan.kind === "DSE"
                      ? `One board lot of ${activeAsset.symbol} costs ${fmtTZS(buyPlan.lotCost)}. You'd need ${buyPlan.monthsToAccumulate} month(s) at ${fmtTZS(buyPlan.cash)}/mo to afford one lot.`
                      : `Most exchanges reject orders under ${fmtTZS(buyPlan.lotCost)}. Add to your monthly amount or switch to a stable.`}
                    {cheaper && (
                      <button className="mt-2 inline-flex items-center gap-1 underline" onClick={() => setAssetId(cheaper.asset.id)}>
                        Switch to {cheaper.asset.symbol} (lot {fmtTZS(cheaper.lotCost)}) →
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 text-[12px] text-txt-2 bg-inc/5 border border-inc/20 rounded-lg p-3">
                    You'd spend {fmtTZS(buyPlan.actualCost)} this month and have {fmtTZS(buyPlan.leftover)} idle.
                  </div>
                )}
              </CardSoft>
            )}
          </Section>

          {/* Step 3 — projection + answers */}
          {sim && (
            <Section eyebrow="Step 3" title="What actually happens?">
              <Bento>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <Eyebrow>Projected growth</Eyebrow>
                    <p className="text-[11px] text-txt-3 mt-0.5">Compounded at {activeAsset?.symbol}'s typical return.</p>
                  </div>
                  <div className="flex gap-2 text-center">
                    {[{ k: "1y", v: sim.fv12 }, { k: "3y", v: sim.fv36 }, { k: "5y", v: sim.fv60 }].map((p) => (
                      <div key={p.k} className="surface-inset rounded-lg px-2 py-1">
                        <div className="text-[9px] uppercase tracking-wider text-txt-3 font-mono-tab">{p.k}</div>
                        <div className="font-mono-tab text-[12px] font-bold tabular text-accent">{fmtTZS(p.v)}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <ProjectionChart monthly={monthly} annual={Number(sim.profile?.annual || 0)} drawdown={Number(sim.profile?.drawdown || 0)} />
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2 text-[11px] text-txt-2">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded-full bg-accent" />Projected value</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded-full bg-txt-3" />Money you put in</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded-full bg-dng" />Bad-month floor</span>
                </div>
              </Bento>

              <div className="grid grid-cols-1 gap-2 mt-2">
                <CardSoft>
                  <Eyebrow>Lifestyle impact</Eyebrow>
                  <div className="text-[14px] font-semibold mt-1">{sim.statusLabel}</div>
                  <p className="text-[12px] text-txt-3 mt-1">{sim.recommendation}</p>
                </CardSoft>
                <CardSoft>
                  <Eyebrow>Worst case (12 mo)</Eyebrow>
                  <div className="font-mono-tab text-[14px] font-bold text-dng tabular mt-1">{fmtTZS(sim.downside12)}</div>
                  <p className="text-[12px] text-txt-3 mt-1">
                    Drawdown on {sim.profile?.label}: {(Number(sim.profile?.drawdown || 0) * 100).toFixed(0)}%.
                  </p>
                </CardSoft>
              </div>
            </Section>
          )}
        </>
      )}

      {/* Allocation playbooks */}
      <Section eyebrow="Playbooks" title="Allocation playbooks">
        <div className="grid grid-cols-1 gap-2">
          {STRATEGIES.map((s) => {
            const Icon = s.icon;
            return (
              <Tilt key={s.title} max={4}>
                <div className="card-soft !p-3.5 flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${toneChip[s.tone]}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold">{s.title}</span>
                      <Badge tone={s.risk === "Low" ? "inc" : s.risk === "Medium" ? "exp" : "dng"}>{s.risk} risk</Badge>
                    </div>
                    <p className="text-[11px] text-txt-3 mt-1 leading-snug">{s.desc}</p>
                  </div>
                </div>
              </Tilt>
            );
          })}
        </div>
      </Section>

      {/* Insurance providers */}
      <Section eyebrow="Cover" title="Insurance providers">
        <div className="grid grid-cols-1 gap-2">
          {INSURANCE.map((p) => (
            <div key={p.name} className="card-soft !p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold">{p.name}</span>
                <Badge tone="muted">{p.type}</Badge>
              </div>
              <p className="text-[11px] text-txt-3 mt-1 leading-snug">{p.desc}</p>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-txt-4 mt-2 px-1">
          Listed for reference — PesaLens is not affiliated with any provider and earns no commission.
        </p>
      </Section>

      {/* Disclaimer */}
      <GlassCard className="border-dng/25">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-dng/15 text-dng flex items-center justify-center shrink-0">!</div>
          <div>
            <div className="text-[13px] font-semibold">Not financial advice</div>
            <p className="text-[11px] text-txt-3 mt-1 leading-snug">
              These projections are educational summaries from your statements and public market data — not financial advice. For
              investment, tax or insurance decisions, consult a CMSA-licensed advisor.
            </p>
          </div>
        </div>
      </GlassCard>
    </div>
  );
};

export default Simulator;
