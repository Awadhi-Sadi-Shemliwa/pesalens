import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  FileText,
  Info,
  Plus,
  RefreshCw,
  Sparkles,
  Upload as UploadIcon,
} from "lucide-react";
import { Badge, CardSoft, Divider, Eyebrow, Section } from "@/components/pl/primitives";
import { KpiTile } from "@/components/pl/KpiTile";
import { IncomeExpenseChart } from "@/components/pl/IncomeExpenseChart";
import { SpendingBreakdown } from "@/components/pl/SpendingBreakdown";
// @ts-ignore — JS modules
import { fetchDashboardSummary, fmtTZS } from "@/data/api";
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

const Dashboard = () => {
  const navigate = useNavigate();
  const { data: summary, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: fetchDashboardSummary,
  });

  if (isLoading) {
    return (
      <div className="px-5 py-6 space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="ios-group">
            <div className="px-5 py-4">
              <div className="h-4 bg-surface-3 rounded-full w-24 animate-pulse mb-3" />
              <div className="h-8 bg-surface-3 rounded-full w-48 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError || !summary) {
    return (
      <div className="px-4 py-6">
        <CardSoft className="text-center !py-8">
          <Eyebrow>Backend</Eyebrow>
          <h2 className="text-[18px] font-bold mt-1">Couldn't reach PesaLens</h2>
          <p className="text-[12px] text-txt-3 mt-2">Check connectivity and try again. Tap Refresh to retry.</p>
          <button
            onClick={() => refetch()}
            className="mt-4 inline-flex items-center gap-2 bg-foreground text-background rounded-full px-3.5 py-2 text-[12px] font-semibold"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </CardSoft>
      </div>
    );
  }

  const upload = (summary as any)?.latest_upload;
  if (!upload) {
    return (
      <div className="px-4 py-6">
        <CardSoft className="text-center !py-8">
          <div className="w-12 h-12 rounded-2xl bg-gradient-accent mx-auto flex items-center justify-center mb-3">
            <UploadIcon className="w-6 h-6 text-white" />
          </div>
          <Eyebrow>Your first upload</Eyebrow>
          <h2 className="text-[20px] font-bold mt-2">Upload a statement to begin</h2>
          <p className="text-[13px] text-txt-3 mt-2 max-w-xs mx-auto">
            PesaLens needs at least one bank or mobile-money PDF before it can compute your KPIs.
          </p>
          <button
            onClick={() => navigate("/upload")}
            className="mt-5 inline-flex items-center gap-2 bg-gradient-accent text-white rounded-full px-4 py-2.5 text-[13px] font-semibold"
          >
            <UploadIcon className="w-4 h-4" /> Upload statement
          </button>
        </CardSoft>
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
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold truncate">{upload.filename || "Latest upload"}</span>
              {upload.bank && <Badge tone="accent">{String(upload.bank).toUpperCase()}</Badge>}
            </div>
            <div className="text-[12px] text-txt-3 font-mono-tab mt-0.5">
              {upload.total_transactions ?? upload.transaction_count ?? 0} txns ·{" "}
              {relativeTime(upload.created_at || upload.uploaded_at)}
            </div>
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
        className="fixed md:absolute bottom-24 right-5 w-16 h-16 rounded-2xl bg-gradient-accent shadow-lg flex items-center justify-center text-white z-10 active:scale-95 transition-transform ios-press"
        aria-label="New upload"
      >
        <Plus className="w-7 h-7" strokeWidth={2.5} />
      </button>
    </div>
  );
};

export default Dashboard;
