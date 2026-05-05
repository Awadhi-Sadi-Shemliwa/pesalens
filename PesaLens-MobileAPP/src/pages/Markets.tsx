import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, RefreshCw } from "lucide-react";
import { Badge, CardSoft, Eyebrow, Pill, Section } from "@/components/pl/primitives";
// @ts-ignore — JS modules
import { fetchDashboardSummary, fetchMarketSnapshot, fmtTZS, fmtTZSFull } from "@/data/api";
// @ts-ignore — JS modules
import {
  ASSET_CATEGORIES,
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

const categoryMeta: Record<CategoryId, { label: string; sub: string }> = {
  stable: { label: "Stable", sub: "USDT / USDC tokens" },
  stocks: { label: "Stocks", sub: "DSE listings" },
  crypto: { label: "Crypto", sub: "BTC, ETH, alts" },
};

// Single line in the math chain. Sign + tone make the cause-effect
// relationship visible at a glance — green +, amber −, etc.
const FlowRow = ({
  label,
  value,
  sign,
  tone = "muted",
  bold = false,
  indent = false,
}: {
  label: string;
  value: string;
  sign?: string;
  tone?: "inc" | "exp" | "net" | "accent" | "dng" | "muted";
  bold?: boolean;
  indent?: boolean;
}) => {
  const toneCls: Record<string, string> = {
    inc: "text-inc",
    exp: "text-exp",
    net: "text-net",
    accent: "text-accent",
    dng: "text-dng",
    muted: "text-txt-3",
  };
  return (
    <div className={`flex items-center gap-2 ${indent ? "pl-3" : ""}`}>
      <span className={`w-3 text-center font-mono-tab text-[11px] ${toneCls[tone]}`}>
        {sign || ""}
      </span>
      <span className={`flex-1 ${indent ? "text-txt-3 text-[11px]" : "text-txt-2"}`}>{label}</span>
      <span
        className={`font-mono-tab tabular text-right ${toneCls[tone]} ${
          bold ? "font-bold text-[14px]" : "text-[13px]"
        }`}
      >
        {value}
      </span>
    </div>
  );
};

const Markets = () => {
  const summaryQuery = useQuery({ queryKey: ["dashboard-summary"], queryFn: fetchDashboardSummary });
  const marketsQuery = useQuery({
    queryKey: ["markets-all"],
    queryFn: fetchMarketSnapshot,
    refetchInterval: 5 * 60 * 1000,
  });

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
  // Backend exposes a `transaction_costs.estimated_total` block — that's
  // the user's "fees" line. Spread across the same number of periods we
  // averaged income / expense over so the row stays apples-to-apples.
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

  const buyPlan = useMemo(
    () => (activeAsset ? computeBuyPlan(activeAsset, monthly, surplus) : null),
    [activeAsset, monthly, surplus]
  );

  const cheaper = useMemo(
    () => (activeAsset && buyPlan && !buyPlan.meetsMinimum
      ? suggestCheaperDseAsset(universe, activeAsset, monthly)
      : null),
    [universe, activeAsset, buyPlan, monthly]
  );

  const sim = useMemo(
    () => (activeAsset ? simulateInvestment({ summary, asset: activeAsset, monthly }) : null),
    [summary, activeAsset, monthly]
  );

  const dse = (snapshot as any)?.dse?.data || [];
  const fx = (snapshot as any)?.forex?.data || [];
  const fuel = (snapshot as any)?.fuel?.data || null;
  const crypto = (snapshot as any)?.crypto?.data || [];

  return (
    <div className="px-4 py-4 space-y-5">
      {/* Hero — explicit math chain. Money out is split into Spending
          and Fees so users can see fees aren't being subtracted twice
          (a previous "of which" sub-row was confusing). Full TZS
          amounts are shown so the rows actually reconcile when the
          user adds them up — rounded shorthand like "1.59M" hides the
          real precision and made the surplus look wrong. */}
      <CardSoft className="!p-0 overflow-hidden">
        <div className="p-4 bg-gradient-to-br from-accent/20 via-net/10 to-transparent">
          <Eyebrow>How much you can invest</Eyebrow>
          <p className="text-[12px] text-txt-2 mt-2 leading-snug">
            Here's the math from your statement — every line below is the average per month, computed from the actual transactions, not rounded estimates.
          </p>

          <div className="mt-3 surface-inset rounded-xl p-3 space-y-2 text-[12px]">
            <FlowRow label="Money you received" value={fmtTZSFull(monthlyIn)} sign="+" tone="inc" />
            <FlowRow label="Spending (excl. fees)" value={fmtTZSFull(Math.max(0, monthlyOut - fees))} sign="−" tone="exp" />
            <FlowRow label="Bank & wallet fees" value={fmtTZSFull(fees)} sign="−" tone="exp" />
            <div className="hairline my-1" />
            <FlowRow
              label="Surplus left at month-end"
              value={fmtTZSFull(surplus)}
              sign="="
              tone={surplus > 0 ? "net" : "dng"}
              bold
            />
            <FlowRow
              label={`Investable (${tierPct}% of surplus · ${tierMeta[tierId].label})`}
              value={fmtTZSFull(monthly)}
              sign="→"
              tone="accent"
              bold
            />
          </div>

          <p className="text-[10px] text-txt-3 mt-2 leading-snug">
            <span className="font-bold">Why these numbers:</span> "Money out" on the dashboard equals Spending + Fees — they aren't deducted twice. Surplus is what's literally left in your account each month after both.
          </p>

          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono-tab text-[28px] font-bold tabular text-accent">{fmtTZS(monthly)}</span>
            <span className="text-[12px] text-txt-3">/ month is yours to invest</span>
          </div>
          <p className="text-[11px] text-txt-3 mt-1">
            Recommended tier: <span className="text-accent font-semibold">{tierMeta[recommended.id].label}</span>.
            Pick a different tier below to see the same math at 5%, 15%, or 30%.
          </p>
        </div>
      </CardSoft>

      {/* Tier picker */}
      <Section eyebrow="Step 1" title="How much each month?">
        <div className="grid grid-cols-1 gap-2">
          {CAPACITY_TIERS.map((t: any) => {
            const id = t.id as TierId;
            const amount = cap.capacity[id] || 0;
            const active = tierId === id;
            return (
              <button
                key={id}
                onClick={() => setTierId(id)}
                className={`card-soft !p-3.5 flex items-center gap-3 text-left transition-colors ${
                  active ? "border-accent/50 bg-accent/5" : ""
                }`}
              >
                <div className={`w-10 h-10 rounded-md flex items-center justify-center font-mono-tab text-[10px] font-bold ${
                  active ? "bg-accent/15 text-accent" : "bg-surface-3 text-txt-3"
                }`}>
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
            );
          })}
        </div>
      </Section>

      {/* Category picker */}
      <Section eyebrow="Step 2" title="Where will the money go?">
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(categoryMeta) as CategoryId[]).map((id) => {
            const active = categoryId === id;
            return (
              <button
                key={id}
                onClick={() => {
                  setCategoryId(id);
                  setAssetId(null);
                }}
                className={`card-soft !p-3 text-left ${active ? "border-accent/50 bg-accent/5" : ""}`}
              >
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
            <Pill
              key={a.id}
              active={(activeAsset?.id || "") === a.id}
              onClick={() => setAssetId(a.id)}
            >
              {a.symbol} · {Number(a.change || 0) >= 0 ? "+" : ""}{Number(a.change || 0).toFixed(1)}%
            </Pill>
          ))}
        </div>
      </Section>

      {/* Buy breakdown */}
      {activeAsset && buyPlan && (
        <CardSoft>
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
                {buyPlan.fractional
                  ? `${Number(buyPlan.units).toFixed(buyPlan.units < 1 ? 6 : 4)}`
                  : buyPlan.lots > 0 ? `${buyPlan.lots * (buyPlan.lotQty || 1)}` : "0"}
              </div>
            </div>
          </div>
          {!buyPlan.meetsMinimum ? (
            <div className="mt-3 text-[12px] text-dng bg-dng/10 border border-dng/30 rounded-lg p-3">
              {buyPlan.kind === "DSE"
                ? `One board lot of ${activeAsset.symbol} costs ${fmtTZS(buyPlan.lotCost)}. You'd need ${buyPlan.monthsToAccumulate} month(s) at ${fmtTZS(buyPlan.cash)}/mo to afford one lot.`
                : `Most exchanges reject orders under ${fmtTZS(buyPlan.lotCost)}. Add to your monthly amount or switch to a stable.`}
              {cheaper && (
                <button
                  className="mt-2 inline-flex items-center gap-1 underline"
                  onClick={() => setAssetId(cheaper.asset.id)}
                >
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

      {/* Step 3 — projection */}
      {sim && (
        <Section eyebrow="Step 3" title="What actually happens?">
          <div className="grid grid-cols-1 gap-2">
            <CardSoft>
              <Eyebrow>Lifestyle impact</Eyebrow>
              <div className="text-[14px] font-semibold mt-1">{sim.statusLabel}</div>
              <p className="text-[12px] text-txt-3 mt-1">{sim.recommendation}</p>
            </CardSoft>
            <CardSoft>
              <Eyebrow>What it could grow into</Eyebrow>
              <div className="grid grid-cols-3 gap-2 mt-1 text-center">
                <div>
                  <div className="text-[10px] text-txt-3">12 mo</div>
                  <div className="font-mono-tab font-bold text-[13px] tabular">{fmtTZS(sim.fv12)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-txt-3">36 mo</div>
                  <div className="font-mono-tab font-bold text-[13px] tabular">{fmtTZS(sim.fv36)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-txt-3">60 mo</div>
                  <div className="font-mono-tab font-bold text-[13px] tabular">{fmtTZS(sim.fv60)}</div>
                </div>
              </div>
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

      {/* Live feeds */}
      <Section
        eyebrow="Live"
        title="DSE equities"
        action={<Badge tone="inc">{dse.length}</Badge>}
      >
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
          {dse.length === 0 && (
            <div className="px-4 py-6 text-[12px] text-txt-3 text-center">
              {marketsQuery.isLoading ? "Loading DSE…" : "DSE feed warming up."}
            </div>
          )}
        </div>
      </Section>

      {(fx.length > 0 || fuel) && (
        <Section eyebrow="BoT FX · EWURA fuel" title="Macro snapshot">
          <div className="grid grid-cols-2 gap-3">
            {fx.slice(0, 4).map((c: any) => (
              <div key={c.code || c.pair} className="card-soft !p-3">
                <div className="text-[10px] font-mono-tab text-txt-3 tracking-wider uppercase">
                  {c.pair || `${c.code}/TZS`}
                </div>
                <div className="font-mono-tab text-[18px] font-bold tabular mt-1">{Number(c.tzs ?? c.rate ?? c.price ?? 0).toLocaleString()}</div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-txt-4 font-mono-tab">{c.source || "BoT"}</span>
                  <span className={`text-[10px] font-mono-tab font-bold ${Number(c.change_pct || 0) >= 0 ? "text-inc" : "text-dng"}`}>
                    {Number(c.change_pct || 0) >= 0 ? "+" : ""}
                    {Number(c.change_pct || 0).toFixed(2)}%
                  </span>
                </div>
              </div>
            ))}
            {fuel?.petrol_dar && (
              <div className="card-soft !p-3">
                <div className="text-[10px] font-mono-tab text-txt-3 tracking-wider uppercase">Petrol Dar</div>
                <div className="font-mono-tab text-[18px] font-bold tabular mt-1">{Number(fuel.petrol_dar).toLocaleString()}</div>
                <div className="text-[10px] text-txt-4 font-mono-tab mt-1">TZS / litre</div>
              </div>
            )}
            {fuel?.diesel_dar && (
              <div className="card-soft !p-3">
                <div className="text-[10px] font-mono-tab text-txt-3 tracking-wider uppercase">Diesel Dar</div>
                <div className="font-mono-tab text-[18px] font-bold tabular mt-1">{Number(fuel.diesel_dar).toLocaleString()}</div>
                <div className="text-[10px] text-txt-4 font-mono-tab mt-1">TZS / litre</div>
              </div>
            )}
          </div>
        </Section>
      )}

      {crypto.length > 0 && (
        <Section eyebrow="Crypto" title="CoinGecko">
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
