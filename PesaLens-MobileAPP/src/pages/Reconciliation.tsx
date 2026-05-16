import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownRight,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Wallet,
} from "lucide-react";
import { CardSoft, Eyebrow, Section, Badge, Pill } from "@/components/pl/primitives";
// @ts-ignore — JS module
import { fetchReconciliation, fmtTZS, fmtTZSFull } from "@/data/api";

/* ----------------------------------------------------------------------
   Reconciliation — mobile view of the cross-source reconciliation
   endpoint. Lives at /reconciliation, reachable from More → Workspace.
   Uses preset date chips (This month / Last month / Last 3 months) so
   we don't need a full date-range picker on the 440px shell. The
   deterministic table renders even when the LLM is unavailable.
---------------------------------------------------------------------- */

type Scope = "personal" | "business";

type Candidate = {
  source: "receipt" | "personal" | "business";
  date: string;
  date_inferred: boolean;
  vendor?: string | null;
  category?: string | null;
  amount: number;
  ref_id?: string | null;
};

type Group = {
  kind: "withdrawal" | "pos" | "transfer";
  txn_date: string;
  description: string;
  debit_amount: number;
  explained_amount: number;
  status: "fully_explained" | "partial" | "blind_spot";
  candidates: Candidate[];
  insight?: string | null;
};

type Kpis = {
  total_money_out: number;
  total_explained: number;
  blind_spot_ratio: number;
  group_count: number;
  fully_explained: number;
  partial: number;
  blind_spot: number;
};

type Patterns = {
  recurring_withdrawals: { weekday: string; band_label: string; occurrences: number; avg_amount: number; total: number }[];
  top_vendors: { vendor: string; total: number; occurrences: number; sources: string[] }[];
  blind_spot_by_month: { month: string; total_money_out: number; total_explained: number; blind_spot_ratio: number }[];
};

type ReconcileData = {
  range: { start: string; end: string };
  scope: Scope;
  kpis: Kpis;
  groups: Group[];
  patterns?: Patterns | null;
  overall_summary?: string | null;
  llm_status: "ok" | "unavailable" | "skipped";
  notes: string[];
};

type Preset = "this" | "last" | "3mo";

const STATUS_LABEL: Record<Group["status"], { label: string; tone: "inc" | "exp" | "dng" }> = {
  fully_explained: { label: "Explained", tone: "inc" },
  partial:         { label: "Partial",   tone: "exp" },
  blind_spot:      { label: "Blind",     tone: "dng" },
};

const KIND_LABEL: Record<Group["kind"], string> = {
  withdrawal: "Cash withdrawal",
  pos:        "Card / POS",
  transfer:   "Transfer",
};

const SOURCE_LABEL: Record<Candidate["source"], string> = {
  receipt:  "Receipt",
  personal: "Personal",
  business: "Business",
};

// Preset → first-of-month / last-of-month bounds.
const presetRange = (preset: Preset): { start: string; end: string } => {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  if (preset === "this") {
    return { start: fmt(new Date(Date.UTC(y, m, 1))), end: fmt(new Date(Date.UTC(y, m + 1, 0))) };
  }
  if (preset === "last") {
    return { start: fmt(new Date(Date.UTC(y, m - 1, 1))), end: fmt(new Date(Date.UTC(y, m, 0))) };
  }
  // 3mo — first of two-months-ago to last of this month
  return { start: fmt(new Date(Date.UTC(y, m - 2, 1))), end: fmt(new Date(Date.UTC(y, m + 1, 0))) };
};

const Reconciliation = () => {
  const [preset, setPreset] = useState<Preset>("3mo");
  const [scope, setScope] = useState<Scope>("personal");
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const { start, end } = useMemo(() => presetRange(preset), [preset]);

  const query = useQuery({
    queryKey: ["reconciliation", start, end, scope],
    queryFn: () => fetchReconciliation(start, end, scope),
    staleTime: 60_000,
  });

  const data = (query.data as ReconcileData | undefined) || null;
  const kpis = data?.kpis;
  const groups = data?.groups || [];
  const patterns = data?.patterns || null;
  const llmOk = data?.llm_status === "ok";
  const blindPct = kpis ? Math.round((kpis.blind_spot_ratio || 0) * 100) : 0;

  return (
    <div className="px-4 py-4 space-y-5">
      <div>
        <Eyebrow>Reconciliation</Eyebrow>
        <h1 className="text-[22px] font-bold tracking-tight mt-1">Where did the money go?</h1>
        <p className="text-[12.5px] text-txt-3 mt-1 leading-relaxed">
          Pairs every cash-out from your statement with the receipts and manual entries that
          explain it, and flags the gaps.
        </p>
      </div>

      {/* Preset chips + scope toggle ---------------------------------- */}
      <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1">
        <Pill active={preset === "this"} onClick={() => setPreset("this")}>This month</Pill>
        <Pill active={preset === "last"} onClick={() => setPreset("last")}>Last month</Pill>
        <Pill active={preset === "3mo"}  onClick={() => setPreset("3mo")}>Last 3 months</Pill>
      </div>
      <div className="flex items-center gap-1.5">
        <Pill active={scope === "personal"} onClick={() => setScope("personal")}>Personal</Pill>
        <Pill active={scope === "business"} onClick={() => setScope("business")}>Business</Pill>
      </div>

      {/* Notes / LLM banner ------------------------------------------ */}
      {data?.notes?.length ? (
        <div className="rounded-xl bg-surface-2 border border-border px-3 py-2 text-[11px] text-txt-2 space-y-1">
          {data.notes.map((n, i) => (
            <div key={i} className="flex items-start gap-2">
              <AlertTriangle className="w-3 h-3 text-txt-3 mt-0.5 shrink-0" />
              <span>{n}</span>
            </div>
          ))}
        </div>
      ) : null}

      {!llmOk && data && (
        <div className="rounded-lg bg-surface-3 border border-border/60 px-2.5 py-1.5 text-[10px] text-txt-3 inline-flex items-center gap-1.5 font-mono-tab uppercase tracking-wider">
          <AlertTriangle className="w-3 h-3" />
          AI insights offline
        </div>
      )}

      {query.isError && (
        <div className="rounded-xl border border-dng/30 bg-dng/10 text-dng px-3 py-2 text-[12px]">
          Could not load reconciliation. Pull to retry.
        </div>
      )}

      {/* KPI tiles ---------------------------------------------------- */}
      {kpis && (
        <div className="grid grid-cols-2 gap-3">
          <KpiTile label="Money out" value={fmtTZSFull(kpis.total_money_out)} icon={ArrowDownRight} />
          <KpiTile label="Explained" value={fmtTZSFull(kpis.total_explained)} icon={CheckCircle2} tone="inc" />
          <KpiTile label="Blind spot" value={`${blindPct}%`} icon={AlertTriangle} tone={blindPct >= 50 ? "dng" : "exp"} />
          <KpiTile label="Tracked" value={String(kpis.group_count)} icon={Wallet} />
        </div>
      )}

      {/* Overall summary --------------------------------------------- */}
      {data?.overall_summary && (
        <CardSoft className="!p-3.5">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-md bg-accent/15 text-accent flex items-center justify-center shrink-0">
              <Lightbulb className="w-4 h-4" />
            </div>
            <p className="text-[12.5px] leading-relaxed text-txt-1">{data.overall_summary}</p>
          </div>
        </CardSoft>
      )}

      {/* Groups ------------------------------------------------------- */}
      <Section eyebrow="Statement → potential usage">
        {query.isLoading && (
          <CardSoft className="!p-4 text-center text-[12px] text-txt-3">Loading…</CardSoft>
        )}
        {!query.isLoading && groups.length === 0 && (
          <CardSoft className="!p-4 text-center text-[12px] text-txt-3">
            No outflows in this range. Upload a statement that covers it, or pick a wider range.
          </CardSoft>
        )}
        <div className="space-y-2">
          {groups.map((g, idx) => (
            <GroupCard
              key={`${g.txn_date}-${idx}`}
              g={g}
              open={openIdx === idx}
              onToggle={() => setOpenIdx(openIdx === idx ? null : idx)}
            />
          ))}
        </div>
      </Section>

      {/* Patterns ----------------------------------------------------- */}
      {patterns && <PatternsList patterns={patterns} />}
    </div>
  );
};

const KpiTile = ({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: any;
  tone?: "inc" | "exp" | "dng";
}) => {
  const toneClass = tone === "inc" ? "text-inc"
                  : tone === "exp" ? "text-exp"
                  : tone === "dng" ? "text-dng"
                  :                   "text-txt-1";
  return (
    <div className="card-soft !p-3.5">
      <div className="flex items-center justify-between text-[10px] font-mono-tab uppercase tracking-ticker text-txt-3">
        <span>{label}</span>
        <Icon className="w-3 h-3" />
      </div>
      <div className={`mt-1.5 text-[18px] font-bold tabular ${toneClass}`}>{value}</div>
    </div>
  );
};

const GroupCard = ({ g, open, onToggle }: { g: Group; open: boolean; onToggle: () => void }) => {
  const status = STATUS_LABEL[g.status];
  const dateLabel = new Date(`${g.txn_date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
  return (
    <div className="card-soft !p-0 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-3.5 py-3 flex items-center gap-3 text-left active:bg-surface-3"
      >
        <div className="text-[10px] font-mono-tab uppercase tracking-ticker text-txt-3 w-16 shrink-0">
          {dateLabel}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold truncate">
            {KIND_LABEL[g.kind]} · {fmtTZS(g.debit_amount)}
          </div>
          <div className="text-[10.5px] text-txt-3 truncate">{g.description}</div>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-txt-3 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-txt-3 shrink-0" />}
      </button>

      {open && (
        <div className="px-3.5 pb-3.5 -mt-1 space-y-2.5 bg-surface-3/40">
          {g.candidates.length === 0 ? (
            <div className="text-[11.5px] text-txt-3 italic pt-2">
              No matching receipt or entry. Add one to explain this outflow.
            </div>
          ) : (
            <ul className="space-y-1.5 pt-1">
              {g.candidates.map((c, i) => (
                <li key={i} className="flex items-center gap-2 text-[11.5px] text-txt-2">
                  {c.source === "receipt" ? (
                    <Camera className="w-3 h-3 text-txt-3 shrink-0" />
                  ) : (
                    <Wallet className="w-3 h-3 text-txt-3 shrink-0" />
                  )}
                  <span className="text-[9px] font-mono-tab uppercase tracking-wider text-txt-3 w-14 shrink-0">
                    {SOURCE_LABEL[c.source]}
                  </span>
                  <span className="flex-1 truncate">
                    {c.vendor || c.category || "Unlabelled"}
                    {c.date_inferred && (
                      <span className="ml-1 text-[9px] text-txt-4 font-mono-tab uppercase tracking-wider">
                        (scan date)
                      </span>
                    )}
                  </span>
                  <span className="font-semibold tabular text-txt-1">{fmtTZS(c.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          {g.insight && (
            <div className="text-[11.5px] italic text-txt-1 border-l-2 border-accent/40 pl-2.5 py-0.5">
              {g.insight}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const PatternsList = ({ patterns }: { patterns: Patterns }) => {
  const recurring = patterns.recurring_withdrawals || [];
  const vendors = patterns.top_vendors || [];
  const monthly = patterns.blind_spot_by_month || [];
  return (
    <Section eyebrow="Patterns" title="Retrospective insight">
      <CardSoft className="!p-3.5">
        <Eyebrow>Recurring leaks</Eyebrow>
        {recurring.length === 0 ? (
          <p className="text-[12px] text-txt-3 mt-1.5">No recurring weekday-amount cluster detected.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-[12px]">
            {recurring.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="text-txt-2">
                  {r.weekday}s · {r.band_label}
                  <span className="text-txt-3"> · ×{r.occurrences}</span>
                </span>
                <span className="font-semibold tabular">{fmtTZS(r.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardSoft>

      <CardSoft className="!p-3.5">
        <Eyebrow>Top vendors</Eyebrow>
        {vendors.length === 0 ? (
          <p className="text-[12px] text-txt-3 mt-1.5">No receipts or entries in this range.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-[12px]">
            {vendors.map((v, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="text-txt-2 truncate">
                  {v.vendor}
                  <span className="text-txt-4"> · ×{v.occurrences}</span>
                </span>
                <span className="font-semibold tabular">{fmtTZS(v.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardSoft>

      <CardSoft className="!p-3.5">
        <Eyebrow>Monthly blind spot</Eyebrow>
        {monthly.length === 0 ? (
          <p className="text-[12px] text-txt-3 mt-1.5">Need at least one classified outflow per month.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-[12px]">
            {monthly.map((m) => {
              const pct = Math.round((m.blind_spot_ratio || 0) * 100);
              const tone = pct >= 50 ? "text-dng" : pct >= 25 ? "text-exp" : "text-inc";
              return (
                <li key={m.month} className="flex items-center justify-between gap-2">
                  <span className="text-txt-2 font-mono-tab">{m.month}</span>
                  <span className={`font-semibold tabular ${tone}`}>{pct}%</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardSoft>
    </Section>
  );
};

export default Reconciliation;
