import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronDown,
  FileText,
  Info,
  Plus,
  RefreshCw,
  Sparkles,
  Upload as UploadIcon,
} from "lucide-react";
import { Badge, Bento, CardSoft, EmptyState, ErrorState, Eyebrow, InfoHint, Section, Skeleton } from "@/components/pl/primitives";
import { KpiTile, Sparkline } from "@/components/pl/KpiTile";
import { IncomeExpenseChart } from "@/components/pl/IncomeExpenseChart";
import { SpendingBreakdown } from "@/components/pl/SpendingBreakdown";
// @ts-ignore — JS modules
import { fetchDashboardSummary, fetchStatementIndex, fetchBankIntel, fmtTZS } from "@/data/api";
// @ts-ignore — JS module
import { setActiveStatement } from "@/data/activeStatementStore";
import { bankLabel as sharedBankLabel } from "@/data/bankLabels";

// Shared label map (src/data/bankLabels.ts); Dashboard shows "Statement" when
// the bank is unknown.
const bankLabel = (b?: string | null): string => sharedBankLabel(b, "Statement") as string;
const fmtDay = (iso?: string | null): string => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  } catch { return String(iso).slice(0, 10); }
};
// @ts-ignore — JS modules
import { buildActionPlan } from "@/data/decisions";

const sevIcon: Record<string, any> = { critical: AlertTriangle, warning: AlertCircle, info: Info, notice: Info };
const sevTone: Record<string, "dng" | "exp" | "net"> = { critical: "dng", warning: "exp", info: "net", notice: "net" };

const relativeTime = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
};

/* MoneyMap — "Where your money goes by service" (Slice 3, Part J-2c).
   Per-service spend/fees leaderboard + deterministic suggestions + optional
   LLM coach. Facts render even when intel.llm_status !== 'ok'. */
const SUGGESTION_ICON: Record<string, any> = {
  most_expensive: AlertTriangle, cheapest: Check, saving_estimate: Sparkles,
};
const SUGGESTION_TONE: Record<string, string> = {
  most_expensive: "bg-exp/15 text-exp", cheapest: "bg-inc/15 text-inc", saving_estimate: "bg-accent/15 text-accent",
};

const MoneyMap = ({ intel, focus, onFocus }: { intel: any; focus: string; onFocus: (b: string) => void }) => {
  const banks: any[] = intel?.banks || [];
  if (banks.length === 0) return null;
  const totals = intel.totals || {};
  const maxCharges = Math.max(...banks.map((b: any) => b.charges || 0), 1);
  const shown = focus === "all" ? banks : banks.filter((b: any) => b.bank === focus);
  const coach = intel.llm_status === "ok" && intel.overall_summary ? intel.overall_summary : null;

  return (
    <div className="ios-group p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Eyebrow>Money map</Eyebrow>
          <h3 className="text-[15px] font-bold tracking-tight mt-0.5">Money by service</h3>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-txt-3 uppercase tracking-wider font-mono-tab">Fees · {totals.bank_count || banks.length} services</div>
          <div className="text-[15px] font-bold tabular text-exp">{fmtTZS(totals.total_charges || 0)}</div>
        </div>
      </div>

      {/* Service selector — single scrolling line of pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none -mx-1 px-1">
        {[{ bank: "all", label: "All" }, ...banks].map((b: any) => {
          const active = focus === b.bank;
          return (
            <button
              key={b.bank}
              type="button"
              onClick={() => onFocus(b.bank)}
              className={`press shrink-0 rounded-full border px-3 min-h-[32px] text-[12px] font-medium ${
                active ? "bg-accent border-accent text-primary-foreground font-semibold" : "bg-surface-2 border-border text-txt-2"
              }`}
            >
              {b.bank === "all" ? "All" : bankLabel(b.bank)}
            </button>
          );
        })}
      </div>

      {/* Per-service cards */}
      <div className="space-y-2">
        {shown.map((b: any) => (
          <div key={b.bank} className="bg-surface-2 rounded-2xl p-3 border border-border">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Badge tone="net">{bankLabel(b.bank)}</Badge>
                <span className="text-[10px] text-txt-3 font-mono-tab">{b.txn_count} txns</span>
              </div>
              {b.charges > 0 && (
                <span className="text-[10px] font-mono-tab uppercase tracking-wider text-exp">{((b.fee_rate || 0) * 100).toFixed(1)}% fees</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[9px] text-txt-3 uppercase tracking-wider">Spent</div>
                <div className="text-[14px] font-bold tabular">{fmtTZS(b.spend || 0)}</div>
              </div>
              <div>
                <div className="text-[9px] text-txt-3 uppercase tracking-wider">Fees</div>
                <div className={`text-[14px] font-bold tabular ${b.charges > 0 ? "text-exp" : "text-txt-2"}`}>{fmtTZS(b.charges || 0)}</div>
              </div>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-surface-4 overflow-hidden">
              <div className="h-full rounded-full bg-exp/70" style={{ width: `${Math.min(100, ((b.charges || 0) / maxCharges) * 100)}%` }} />
            </div>
            <div className="mt-1 text-[10px] text-txt-3 font-mono-tab">
              {b.avg_fee_per_txn > 0 ? `~${fmtTZS(b.avg_fee_per_txn)} per transaction` : "No fees detected"}
            </div>
          </div>
        ))}
      </div>

      {/* Deterministic suggestions */}
      {(intel.suggestions || []).map((s: any, i: number) => {
        const SIcon = SUGGESTION_ICON[s.kind] || Sparkles;
        return (
          <div key={i} className="flex items-start gap-3 bg-surface-2 rounded-2xl p-3">
            <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${SUGGESTION_TONE[s.kind] || SUGGESTION_TONE.saving_estimate}`}>
              <SIcon className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold">{s.title}</div>
              <p className="text-[12px] text-txt-3 leading-relaxed">{s.detail}</p>
            </div>
          </div>
        );
      })}

      {coach && (
        <div className="flex items-start gap-2.5 bg-surface-2 rounded-2xl p-3 border-l-2 border-accent/50">
          <Sparkles className="w-4 h-4 text-accent mt-0.5 shrink-0" />
          <p className="text-[12.5px] text-txt-2 leading-relaxed">{coach}</p>
        </div>
      )}
    </div>
  );
};

/* StatementTimeline — upload history grouped Recent vs Past (Slice 3, Part K).
   Tapping focuses the statement and opens Analysis. */
const StatementTimeline = ({ statements, onOpen }: { statements: any[]; onOpen: (jobId: string) => void }) => {
  if (!statements || statements.length === 0) return null;
  const groups = [
    { key: "recent", label: "Recent", rows: statements.filter((s) => s.recency === "recent") },
    { key: "past", label: "Past", rows: statements.filter((s) => s.recency !== "recent") },
  ].filter((g) => g.rows.length > 0);

  return (
    <div className="ios-group p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <Eyebrow>Statements</Eyebrow>
          <h3 className="text-[15px] font-bold tracking-tight mt-0.5">Upload history</h3>
        </div>
        <span className="text-[10px] text-txt-3 font-mono-tab uppercase tracking-wider">{statements.length} uploaded</span>
      </div>
      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="text-[10px] text-txt-3 font-mono-tab uppercase tracking-wider mb-1.5">{g.label}</div>
            <div className="space-y-2">
              {g.rows.map((s) => (
                <button
                  key={s.job_id}
                  type="button"
                  onClick={() => onOpen(s.job_id)}
                  className="press w-full text-left flex items-center gap-3 bg-surface-2 rounded-2xl p-3"
                >
                  <Badge tone={g.key === "recent" ? "accent" : "muted"}>{bankLabel(s.bank)}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">
                      {s.period_start ? `${s.period_start} → ${s.period_end || "—"}` : (s.filename || "Statement")}
                    </div>
                    <div className="text-[10px] text-txt-3 font-mono-tab">{s.txn_count || 0} txns · {fmtDay(s.created_at)}</div>
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-txt-4 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const Dashboard = () => {
  const navigate = useNavigate();
  // Statement selector: null selection = latest upload (default).
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const selectStatement = (jobId: string) => {
    setSelectedJobId(jobId);
    setActiveStatement(jobId || null);
    setSelectorOpen(false);
  };
  const { data: summary, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["dashboard-summary", selectedJobId],
    // A scoped request can fail if that statement is now gone or still
    // processing (backend 409/404). Fall back to the latest statement and drop
    // the stale selection rather than stranding the dashboard.
    queryFn: async () => {
      try {
        return await fetchDashboardSummary(selectedJobId);
      } catch (err: any) {
        if (selectedJobId && (err?.status === 409 || err?.status === 404)) {
          setSelectedJobId(null);
          setActiveStatement(null);
          return await fetchDashboardSummary(null);
        }
        throw err;
      }
    },
  });
  const { data: statements = [] } = useQuery<any[]>({
    queryKey: ["statements-index"],
    queryFn: fetchStatementIndex,
  });
  // Per-bank money map (Slice 3). `bankFocus` = focused service ('all' = all).
  const { data: bankIntel } = useQuery({ queryKey: ["bank-intel"], queryFn: fetchBankIntel });
  const [bankFocus, setBankFocus] = useState<string>("all");

  /* Skeleton mirrors the real layout below: net-flow hero, 2×2 KPI grid,
     income/expense chart, then the breakdown section (§81–83). */
  if (isLoading) {
    return (
      <div className="px-4 py-6 space-y-4">
        <Skeleton className="h-40 rounded-[22px]" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }

  if (isError || !summary) {
    return (
      <div className="px-4 py-6">
        <ErrorState
          title="Couldn't reach PesaLens"
          cause="We couldn't load your dashboard. Check your connection, then retry."
          timestamp={Date.now()}
          onRetry={() => refetch()}
          retryLabel="Retry"
          retryDisabled={isFetching}
        />
      </div>
    );
  }

  const upload = (summary as any)?.latest_upload;
  if (!upload) {
    return (
      <div className="px-4 py-6">
        <EmptyState
          kind="first-run"
          title="Upload a statement to begin"
          desc="PesaLens needs at least one bank or mobile-money PDF before it can compute your KPIs."
          action={
            <button
              onClick={() => navigate("/upload")}
              className="inline-flex items-center gap-2 bg-gradient-accent text-primary-foreground rounded-full px-4 py-2.5 text-[13px] font-semibold press"
            >
              <UploadIcon className="w-4 h-4" /> Upload statement
            </button>
          }
        />
      </div>
    );
  }

  const kpis = (summary as any)?.kpis || {};
  const time = (summary as any)?.time_series?.monthly || (summary as any)?.monthly_data || [];
  const categories = (summary as any)?.categories || [];
  const issues = (summary as any)?.issues || [];
  const balance = (summary as any)?.balance_check || (summary as any)?.balance || null;
  const trends = (summary as any)?.trends || {};

  const incSpark = time.map((m: any) => Number(m.income ?? m.inc ?? 0));
  const expSpark = time.map((m: any) => Number(m.expense ?? m.exp ?? 0));
  const netSpark = time.map((m: any) => Number(m.income ?? m.inc ?? 0) - Number(m.expense ?? m.exp ?? 0));
  const savSpark = time.map((m: any) => {
    const inc = Number(m.income ?? m.inc ?? 0);
    if (inc <= 0) return 0;
    const net = inc - Number(m.expense ?? m.exp ?? 0);
    return (net / inc) * 100;
  });

  const action = buildActionPlan(summary);
  const totalSavings =
    action?.opportunities?.reduce((s: number, o: any) => s + (Number(o.impact) || 0), 0) || 0;

  return (
    <div className="px-5 py-5 space-y-6">
      {/* Upload status card — iOS/Chase style */}
      <div className="ios-press">
        <CardSoft className="flex items-center gap-3.5 !p-4">
          <div className="w-11 h-11 rounded-xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
            <FileText className="w-5.5 h-5.5" />
          </div>
          <div className="flex-1 min-w-0 relative">
            <button
              type="button"
              onClick={() => statements.length > 0 && setSelectorOpen((v: boolean) => !v)}
              className="flex items-center gap-2 text-left max-w-full"
              aria-haspopup="listbox"
              aria-expanded={selectorOpen}
            >
              <span className="text-[14px] font-semibold truncate">{bankLabel(upload.bank)}</span>
              {statements.length > 0 && <ChevronDown className="w-3.5 h-3.5 text-txt-3 shrink-0" />}
            </button>
            <div className="text-[12px] text-txt-3 font-mono-tab mt-0.5 truncate">
              {upload.total_transactions ?? upload.transaction_count ?? 0} txns ·{" "}
              {relativeTime(upload.created_at || upload.uploaded_at)}
            </div>

            {/* Same-day siblings — "you also uploaded NMB today". */}
            {(summary as any)?.same_day_siblings?.length > 0 && (
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                <span className="text-[9px] text-txt-4 font-mono-tab uppercase tracking-wider">
                  Also {fmtDay((summary as any).same_day_siblings[0].created_at)}:
                </span>
                {(summary as any).same_day_siblings.map((s: any) => (
                  <button
                    key={s.job_id}
                    type="button"
                    onClick={() => selectStatement(s.job_id)}
                    className="text-[10px] px-2 py-0.5 rounded-md bg-accent/12 text-accent press"
                  >
                    {bankLabel(s.bank)}
                  </button>
                ))}
              </div>
            )}

            {selectorOpen && statements.length > 0 && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSelectorOpen(false)} aria-hidden />
                <div className="absolute left-0 top-full mt-2 z-50 w-[min(88vw,320px)] max-h-[56vh] overflow-y-auto rounded-2xl border border-border bg-surface-2 shadow-2xl">
                  {(["recent", "past"] as const).map((rec) => {
                    const items = statements.filter((s: any) => (rec === "recent" ? s.recency === "recent" : s.recency !== "recent"));
                    if (!items.length) return null;
                    const activeId = selectedJobId || statements[0]?.job_id;
                    return (
                      <div key={rec} className="py-1">
                        <div className="px-3 py-1 text-[9px] font-mono-tab uppercase tracking-wider text-txt-4">
                          {rec === "recent" ? "Recent" : "Past"}
                        </div>
                        {items.map((s: any) => (
                          <button
                            key={s.job_id}
                            type="button"
                            onClick={() => selectStatement(s.job_id)}
                            className={`w-full px-3 py-2 flex items-center gap-2 text-left active:bg-surface-3 ${s.job_id === activeId ? "bg-accent/10" : ""}`}
                          >
                            <span className="flex-1 min-w-0">
                              <span className="block text-[12.5px] font-semibold text-txt-1 truncate">{bankLabel(s.bank)}</span>
                              <span className="block text-[10px] text-txt-3 truncate">
                                {s.txn_count || 0} txns · uploaded {fmtDay(s.created_at)}
                              </span>
                            </span>
                            {s.job_id === activeId && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="w-10 h-10 rounded-full bg-surface-3 hover:bg-surface-4 flex items-center justify-center transition-colors disabled:opacity-60 ios-press"
            aria-label="Refresh"
          >
            <RefreshCw className={`w-4.5 h-4.5 text-txt-2 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </CardSoft>
      </div>

      {/* Net-flow hero — the premium headline */}
      <Bento className="!p-0 overflow-hidden">
        <div className="p-4 bg-gradient-to-br from-accent/20 via-net/10 to-transparent">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5">
              <Eyebrow>Net flow · this period</Eyebrow>
              <InfoHint content="Money in minus money out for this period. It excludes your opening balance." side="bottom" />
            </span>
            {trends.net_pct !== undefined && (
              <span className={`inline-flex items-center gap-0.5 text-[11px] font-mono-tab font-bold px-2 py-0.5 rounded-full ${Number(trends.net_pct) >= 0 ? "bg-inc/15 text-inc" : "bg-dng/15 text-dng"}`}>
                {Number(trends.net_pct) >= 0 ? "+" : ""}{Math.abs(Number(trends.net_pct) || 0).toFixed(1)}%
              </span>
            )}
          </div>
          <div className={`mt-1.5 font-mono-tab text-[34px] font-bold leading-none tabular ${Number(kpis.net_flow) >= 0 ? "text-accent" : "text-dng"}`}>
            {Number(kpis.net_flow) >= 0 ? "+" : ""}{fmtTZS(Number(kpis.net_flow) || 0)}
          </div>
          <div className="mt-2 flex items-center gap-4 text-[11px] font-mono-tab">
            <span className="inline-flex items-center gap-1.5 text-inc"><span className="w-2 h-2 rounded-full bg-inc" />In {fmtTZS(Number(kpis.money_in) || 0)}</span>
            <span className="inline-flex items-center gap-1.5 text-exp"><span className="w-2 h-2 rounded-full bg-exp" />Out {fmtTZS(Number(kpis.money_out) || 0)}</span>
          </div>
          {netSpark.length > 1 && <div className="mt-2"><Sparkline data={netSpark} color="hsl(var(--accent))" /></div>}
        </div>
      </Bento>

      {/* Cash Flow Section — iOS style with large title */}
      <div className="space-y-4">
        <div className="ios-section-header">Cash Flow</div>
        <div className="grid grid-cols-2 gap-3">
          <KpiTile label="Money in" value={Number(kpis.money_in) || 0} delta={trends.income_pct} tone="inc" spark={incSpark} />
          <KpiTile label="Money out" value={Number(kpis.money_out) || 0} delta={trends.expense_pct} tone="exp" spark={expSpark} />
          <KpiTile label="Net flow" value={Number(kpis.net_flow) || 0} delta={trends.net_pct} tone="net" spark={netSpark} />
          <KpiTile
            label="Savings rate"
            value={0}
            hint={kpis.savings_rate != null ? `${Number(kpis.savings_rate).toFixed(1)}%` : "—"}
            delta={trends.savings_pct}
            tone="accent"
            spark={savSpark}
          />
        </div>
      </div>

      {/* Standing Balance — opening → period end */}
      {(kpis.opening_balance != null || kpis.closing_balance != null) && (
        <div className="space-y-4">
          <div className="ios-section-header">Standing Balance</div>
          <div className="grid grid-cols-2 gap-3">
            <KpiTile label="Opening balance" value={Number(kpis.opening_balance) || 0} tone="net" />
            <KpiTile label="Balance now" value={Number(kpis.closing_balance) || 0} tone="accent" />
          </div>
        </div>
      )}

      {/* Balance Check — Chase-style large display */}
      {balance && (
        <div className="ios-group ios-press">
          <div className="px-5 py-4">
            <div className="text-[13px] font-semibold text-txt-3 uppercase tracking-wide mb-3">Balance Check</div>
            <div className="space-y-4">
              <div>
                <div className="text-[12px] text-txt-3 mb-1">Statement closing</div>
                <div className="chase-balance text-foreground">
                  {fmtTZS(Number(balance.statement_closing ?? balance.closing_balance ?? 0))}
                </div>
              </div>
              <div className="hairline my-1" />
              <div>
                <div className="text-[12px] text-txt-3 mb-1">PesaLens computed</div>
                <div className="text-[28px] font-bold tabular text-inc">
                  {fmtTZS(Number(balance.computed_remaining ?? balance.computed ?? 0))}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2.5 text-[13px] text-txt-2 mt-4 bg-surface-3/50 rounded-xl p-3">
              <span className="w-2 h-2 rounded-full bg-inc shrink-0" />
              {balance.insight || balance.message || "Closing balance reconciled."}
            </div>
          </div>
        </div>
      )}

      {/* Flagged Issues — iOS grouped list style */}
      {issues.length > 0 && (
        <div className="space-y-4">
          <div className="ios-section-header">Things to Look At</div>
          <div className="ios-group">
            {issues.slice(0, 5).map((i: any, idx: number) => {
              const severity = (i.severity || "info") as keyof typeof sevIcon;
              const Icon = sevIcon[severity] || Info;
              const tone = sevTone[severity] || "net";
              return (
                <div key={i.id || idx} className="ios-group-item">
                  <div className="flex items-start gap-3.5">
                    <div className={`w-10 h-10 rounded-xl bg-${tone}/15 text-${tone} flex items-center justify-center shrink-0`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-semibold">{i.title || "Anomaly"}</span>
                        <Badge tone={tone}>{severity}</Badge>
                      </div>
                      <p className="text-[13px] text-txt-3 mt-1 leading-relaxed">{i.description || i.desc || ""}</p>
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="ios-group-item">
              <Link to="/analysis" className="text-[14px] text-accent font-semibold flex items-center justify-between">
                View all issues
                <ArrowUpRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      )}

      <IncomeExpenseChart data={time} />
      <SpendingBreakdown data={categories} title="Top categories" />

      {/* Money map — per-service fees (Slice 3) */}
      <MoneyMap intel={bankIntel} focus={bankFocus} onFocus={setBankFocus} />

      {/* Statement history timeline (Slice 3) */}
      <StatementTimeline
        statements={statements}
        onOpen={(jobId: string) => { setActiveStatement(jobId); navigate(`/analysis?job_id=${encodeURIComponent(jobId)}`); }}
      />

      {/* Action Plan — Chase-style gradient card */}
      {(action?.mistakes?.length > 0 || action?.opportunities?.length > 0) && (
        <Link to="/action-plan" className="block ios-press">
          <div className="ios-group overflow-hidden">
            <div className="bg-gradient-accent p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <div className="text-[11px] font-bold tracking-widest uppercase text-white/80 mb-1">
                  Action Plan
                </div>
                <div className="text-[17px] font-bold text-white">
                  {action.opportunities.length} ways to save · {fmtTZS(totalSavings / 12)}/mo
                </div>
              </div>
              <ArrowUpRight className="w-6 h-6 text-white shrink-0" />
            </div>
          </div>
        </Link>
      )}

      <p className="text-[11px] text-txt-4 text-center font-mono-tab pt-2 pb-4">
        {isFetching ? "Refreshing…" : "Pull to refresh"}
      </p>

      {/* Floating Action Button — iOS style */}
      <button
        onClick={() => navigate("/upload")}
        className="fixed md:absolute bottom-24 right-5 w-16 h-16 rounded-2xl bg-gradient-accent shadow-lg flex items-center justify-center text-primary-foreground z-10 press"
        aria-label="New upload"
      >
        <Plus className="w-7 h-7" strokeWidth={2.5} />
      </button>
    </div>
  );
};

export default Dashboard;
