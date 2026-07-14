import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownRight,
  Camera,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Wallet,
} from "lucide-react";
import { CardSoft, EmptyState, ErrorState, Eyebrow, Section, Badge, Segmented, Skeleton } from "@/components/pl/primitives";
// @ts-ignore — JS module
import { fetchReconciliation, fetchStatementIndex, fmtTZS, fmtTZSFull } from "@/data/api";
// @ts-ignore — JS module
import { useActiveStatement } from "@/data/activeStatementStore";
import { bankLabel } from "@/data/bankLabels";

type ViewMode = "statement" | "general";

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
  // Provider + time-of-day of the statement debit, and why it was attributed
  // to this service over a competing one.
  bank?: string | null;
  time?: string | null;
  attribution_note?: string | null;
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

type ChargeItem = { date?: string | null; description: string; amount: number };

type ChargesSummary = {
  total_charges: number;
  charge_occurrences: number;
  total_interest: number;
  interest_occurrences: number;
  charges: ChargeItem[];
  interest: ChargeItem[];
};

type ReconcileData = {
  range: { start: string; end: string };
  scope: Scope;
  kpis: Kpis;
  groups: Group[];
  unmatched_candidates?: Candidate[];
  patterns?: Patterns | null;
  charges_summary?: ChargesSummary | null;
  overall_summary?: string | null;
  llm_status: "ok" | "unavailable" | "skipped";
  notes: string[];
};

type Preset = "this" | "last" | "3mo";

const STATUS_LABEL: Record<Group["status"], { label: string; tone: "inc" | "exp" | "dng" }> = {
  fully_explained: { label: "Matched", tone: "inc" },
  partial:         { label: "Partial", tone: "exp" },
  blind_spot:      { label: "Missing", tone: "dng" },
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

// "NMB · 13:40", "NMB", "13:40", or null.
const bankTimeLabel = (bank?: string | null, time?: string | null): string | null =>
  [bankLabel(bank), time].filter(Boolean).join(" · ") || null;

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

  // ── Per-statement scoping (Epic-2) ────────────────────────────────────────
  const [activeJobId] = useActiveStatement();
  const [viewMode, setViewMode] = useState<ViewMode>("statement");
  const statementsQuery = useQuery<any[]>({ queryKey: ["statements-index"], queryFn: fetchStatementIndex });
  const statements: any[] = (statementsQuery.data as any[]) || [];
  const showScope = statements.length > 0;
  // Only trust the active statement if it's one of THIS user's statements (a
  // stale id would 404 the owner-checked statement-mode reconcile). Fall back
  // to the newest.
  const effectiveJobId: string | null =
    (activeJobId && statements.some((s) => s.job_id === activeJobId))
      ? activeJobId
      : (statements[0]?.job_id || null);
  const activeStatement = statements.find((s) => s.job_id === effectiveJobId) || null;
  const statementMode = showScope && viewMode === "statement" && !!effectiveJobId;

  const { start, end } = useMemo(() => presetRange(preset), [preset]);

  const query = useQuery({
    queryKey: ["reconciliation", start, end, scope, statementMode ? effectiveJobId : "general"],
    queryFn: () => (statementMode
      ? fetchReconciliation(start, end, scope, { mode: "statement", jobId: effectiveJobId })
      : fetchReconciliation(start, end, scope, { mode: "general" })),
    staleTime: 60_000,
    // Wait for the statement index so the first (LLM-backed) reconcile fires
    // ONCE in the right mode, not general-then-statement.
    enabled: statementsQuery.isFetched,
  });

  const data = (query.data as ReconcileData | undefined) || null;
  // The reconcile query is disabled until the statement index resolves, so
  // treat "not yet fetched" as busy — otherwise the empty state would flash
  // before the first (correct-mode) reconcile fires.
  const busy = query.isLoading || !statementsQuery.isFetched;
  const kpis = data?.kpis;
  const groups = data?.groups || [];
  const patterns = data?.patterns || null;
  const llmOk = data?.llm_status === "ok";
  const blindPct = kpis ? Math.round((kpis.blind_spot_ratio || 0) * 100) : 0;

  // Flatten candidates into one ledger view + split into receipt/entry halves
  // so the two balance panels read like a bank-reconciliation equation.
  const candidates = useMemo(
    () => groups.flatMap((g) => (g.candidates || []).map((c) => ({ ...c })))
      .sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    [groups],
  );
  // Receipts / entries with no statement debit to pair against — still shown in
  // the ledger (tagged unmatched) so a scanned receipt is always visible here.
  const unmatched = data?.unmatched_candidates || [];
  const ledgerItems = useMemo(
    () => [
      ...candidates.map((c) => ({ ...c, matched: true })),
      ...unmatched.map((c) => ({ ...c, matched: false })),
    ].sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    [candidates, unmatched],
  );
  // "Your records" must equal the ledger rows shown below — sum over
  // ledgerItems (matched + unmatched), not just matched candidates, so the
  // Recorded figure never contradicts the visible receipts. Blind-spot math
  // uses kpis.total_explained and is unaffected.
  const receiptTotal = ledgerItems.filter((c) => c.source === "receipt").reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const entryTotal = ledgerItems.filter((c) => c.source !== "receipt").reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const recorded = receiptTotal + entryTotal;
  const moneyOut = kpis?.total_money_out || 0;
  const explained = kpis?.total_explained || 0;
  const blindSpot = Math.max(0, moneyOut - explained);

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

      {/* View: a single statement (its own period) vs a general date range. */}
      {showScope && (
        <Segmented<ViewMode>
          label="Reconciliation view"
          value={viewMode}
          onChange={setViewMode}
          className="w-full"
          options={[
            { key: "statement", label: "This statement" },
            { key: "general", label: "General" },
          ]}
        />
      )}
      {statementMode ? (
        <div className="flex items-center gap-2">
          <Badge tone="net">{bankLabel(activeStatement?.bank) || "Statement"}</Badge>
          {activeStatement?.period_end && (
            <span className="text-[11px] text-txt-3 font-mono-tab truncate">
              {activeStatement.period_start || "—"} → {activeStatement.period_end}
            </span>
          )}
        </div>
      ) : (
        /* Both are exclusive facets under five options, so each collapses into a
           segmented control rather than a chip row (tabs.md #10). */
        <Segmented<Preset>
          label="Date range"
          value={preset}
          onChange={setPreset}
          className="w-full"
          options={[
            { key: "this", label: "This month" },
            { key: "last", label: "Last month" },
            { key: "3mo", label: "Last 3 months" },
          ]}
        />
      )}
      <Segmented<Scope>
        label="Ledger scope"
        value={scope}
        onChange={setScope}
        options={[
          { key: "personal", label: "Personal" },
          { key: "business", label: "Business" },
        ]}
      />

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
        <ErrorState
          title="Couldn't load reconciliation"
          cause="We couldn't match your statement against your ledger. Retry, or widen the date range."
          timestamp={Date.now()}
          onRetry={() => query.refetch()}
          retryLabel="Retry"
          retryDisabled={query.isFetching}
        />
      )}

      {/* Balance equations — Ledger vs Statement --------------------- */}
      {kpis && (
        <div className="space-y-3">
          <BalanceEquation
            title="Ledger balance"
            sideLabel="Your records"
            icon={Wallet}
            figures={[
              { label: "Receipts", value: receiptTotal },
              { op: "+" },
              { label: "Entries", value: entryTotal },
              { op: "=" },
              { label: "Recorded", value: recorded, tone: "accent" },
            ]}
          />
          <BalanceEquation
            title="Statement balance"
            sideLabel="From your bank"
            icon={ArrowDownRight}
            figures={[
              { label: "Money out", value: moneyOut },
              { op: "−" },
              { label: "Explained", value: explained, tone: "inc" },
              { op: "i" },
              { label: "Blind spot", value: blindSpot, tone: blindPct >= 50 ? "dng" : "exp" },
            ]}
          />

          {/* Coverage meter */}
          <div className="card-soft !p-3.5">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[10px] text-txt-3 font-mono-tab uppercase tracking-ticker">Coverage · {kpis.group_count} events</span>
              <span className="text-[11px] font-semibold">
                <span className="text-inc">{100 - blindPct}% explained</span>
                <span className="text-txt-3"> · </span>
                <span className={blindPct >= 50 ? "text-dng" : "text-exp"}>{blindPct}% blind</span>
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-dng/20 overflow-hidden flex">
              <div className="h-full bg-inc rounded-l-full" style={{ width: `${100 - blindPct}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Bank charges & interest ------------------------------------- */}
      {data?.charges_summary && <ChargesCard summary={data.charges_summary} />}

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

      {/* Statement — money out (tap to see what explains it) --------- */}
      <Section eyebrow="Statement · money out" title="Tap a row to see its matches">
        {busy && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-2xl" />
            ))}
          </div>
        )}
        {/* A date range that matched nothing must hand back an exit, not strand the
           user in their own dead-end query (empty-states.md #8). */}
        {!busy && !query.isError && groups.length === 0 && (
          <EmptyState
            kind="no-results"
            title="No outflows in this range"
            desc="Nothing was paid out between these dates. Widen the range, or upload a statement that covers it."
            action={
              preset !== "3mo" ? (
                <button
                  onClick={() => setPreset("3mo")}
                  className="rounded-full border border-border px-4 py-2 text-[13px] font-semibold text-txt-1 press"
                >
                  Widen to 3 months
                </button>
              ) : undefined
            }
          />
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

      {/* Ledger — receipts & entries --------------------------------- */}
      {ledgerItems.length > 0 && (
        <Section eyebrow="Ledger · receipts & entries" title={`${ledgerItems.length} backing items`}>
          <div className="card-soft !p-0 overflow-hidden">
            {ledgerItems.map((c, i) => (
              <div key={`${c.source}-${c.ref_id || i}-${c.matched ? "m" : "u"}`} className="flex items-center gap-3 px-4 py-2.5 border-b border-border/30 last:border-0">
                <span className="text-[10px] font-mono-tab uppercase tracking-wider text-txt-3 w-12 shrink-0">
                  {(c.date || "—").slice(5) || "—"}
                </span>
                {c.source === "receipt" ? <Camera className="w-3.5 h-3.5 text-txt-3 shrink-0" /> : <Wallet className="w-3.5 h-3.5 text-txt-3 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] text-txt-1 truncate">{c.vendor || c.category || "Unlabelled"}</div>
                  <div className="text-[9px] font-mono-tab uppercase tracking-wider text-txt-4">
                    {SOURCE_LABEL[c.source]}{c.date_inferred ? " · scan date" : ""}
                  </div>
                </div>
                <span className={`text-[8.5px] font-mono-tab uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0 ${c.matched ? "bg-inc/12 text-inc" : "bg-txt-4/12 text-txt-3"}`}>
                  {c.matched ? "Matched" : "Unmatched"}
                </span>
                <span className="text-[12.5px] font-semibold tabular text-txt-1 shrink-0">{fmtTZS(c.amount)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Patterns ----------------------------------------------------- */}
      {patterns && <PatternsList patterns={patterns} />}
    </div>
  );
};

type Figure = { label?: string; value?: number; tone?: "inc" | "exp" | "dng" | "accent"; op?: string };

const toneText: Record<string, string> = { inc: "text-inc", exp: "text-exp", dng: "text-dng", accent: "text-accent" };

// A bank-style balance "equation": figures separated by circular
// operator badges (− + = i), mirroring the web reconciliation panel.
const BalanceEquation = ({ title, sideLabel, icon: Icon, figures }: { title: string; sideLabel: string; icon: any; figures: Figure[] }) => (
  <div className="card-soft !p-4">
    <div className="flex items-center justify-between gap-2 mb-3.5">
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-accent/15 text-accent flex items-center justify-center shrink-0">
          <Icon className="w-3.5 h-3.5" />
        </span>
        <Eyebrow>{title}</Eyebrow>
      </div>
      <Badge tone="muted">{sideLabel}</Badge>
    </div>
    <div className="flex items-center gap-1">
      {figures.map((f, i) =>
        f.op ? (
          <span key={i} className="w-5 h-5 rounded-full border border-border text-txt-3 flex items-center justify-center text-[11px] font-mono-tab shrink-0">
            {f.op === "i" ? <AlertTriangle className="w-2.5 h-2.5" /> : f.op}
          </span>
        ) : (
          <div key={i} className="flex-1 min-w-0 text-center">
            <div className={`text-[14px] font-bold tabular font-mono-tab truncate ${f.tone ? toneText[f.tone] : "text-txt-1"}`}>
              {fmtTZS(f.value || 0)}
            </div>
            <div className="text-[8px] uppercase tracking-wider text-txt-3 font-mono-tab mt-0.5 truncate">{f.label}</div>
          </div>
        ),
      )}
    </div>
  </div>
);

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
          <div className="text-[10.5px] text-txt-3 truncate">
            {bankTimeLabel(g.bank, g.time) && (
              <span className="text-accent font-mono-tab uppercase tracking-wider mr-1.5">
                {bankTimeLabel(g.bank, g.time)}
              </span>
            )}
            {g.description}
          </div>
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
          {g.attribution_note && (
            <div className="text-[11.5px] text-txt-2 border-l-2 border-net/40 pl-2.5 py-0.5">
              {g.attribution_note}
            </div>
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

// Bank charges (balance dropped more than the listed debit) + interest
// (balance rose more than listed), detected from running-balance gaps.
const ChargesCard = ({ summary }: { summary: ChargesSummary }) => {
  const [tab, setTab] = useState<"charges" | "interest">("charges");
  const items = tab === "charges" ? (summary.charges || []) : (summary.interest || []);
  const hasAny = (summary.charge_occurrences || 0) > 0 || (summary.interest_occurrences || 0) > 0;

  return (
    <div className="card-soft !p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-border/50">
        <Eyebrow>Bank charges & interest</Eyebrow>
        <p className="text-[11px] text-txt-3 mt-1">Money your bank quietly deducted or added.</p>
      </div>
      <div className="grid grid-cols-2 gap-px bg-border/60">
        <div className="bg-surface-2 p-3">
          <div className="text-[10px] font-mono-tab uppercase tracking-ticker text-txt-3">Charges</div>
          <div className="mt-1 text-[17px] font-bold tabular text-dng">{fmtTZSFull(summary.total_charges)}</div>
          <div className="text-[9px] font-mono-tab uppercase tracking-wider text-txt-4 mt-0.5">
            {summary.charge_occurrences} occ.
          </div>
        </div>
        <div className="bg-surface-2 p-3">
          <div className="text-[10px] font-mono-tab uppercase tracking-ticker text-txt-3">Interest</div>
          <div className="mt-1 text-[17px] font-bold tabular text-inc">{fmtTZSFull(summary.total_interest)}</div>
          <div className="text-[9px] font-mono-tab uppercase tracking-wider text-txt-4 mt-0.5">
            {summary.interest_occurrences} occ.
          </div>
        </div>
      </div>

      {hasAny ? (
        <>
          <div className="px-3 pt-2.5">
            <Segmented<"charges" | "interest">
              label="Charges or interest"
              value={tab}
              onChange={setTab}
              options={[
                { key: "charges", label: `Charges (${summary.charges?.length || 0})` },
                { key: "interest", label: `Interest (${summary.interest?.length || 0})` },
              ]}
            />
          </div>
          {items.length === 0 ? (
            <div className="px-4 py-5 text-center text-[11.5px] text-txt-3">None in this range.</div>
          ) : (
            <ul className="px-2 py-2 space-y-0.5">
              {items.map((it, i) => (
                <li key={i} className="flex items-center gap-2.5 px-2 py-2 text-[11.5px]">
                  <span className="text-[9px] font-mono-tab uppercase tracking-wider text-txt-3 w-16 shrink-0">
                    {it.date || "—"}
                  </span>
                  <span className="flex-1 truncate text-txt-2">{it.description || "Unlabelled"}</span>
                  <span className={`font-semibold tabular ${tab === "charges" ? "text-dng" : "text-inc"}`}>
                    {fmtTZS(it.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="px-4 py-5 text-center text-[11.5px] text-txt-3">
          No bank charges or interest detected in this range.
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
