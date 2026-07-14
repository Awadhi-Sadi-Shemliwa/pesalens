import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowUpDown,
  ArrowUpRight,
  Search,
  Upload as UploadIcon,
  X,
} from "lucide-react";
import { Badge, Bento, CardSoft, ChipRow, EmptyState, ErrorState, Eyebrow, Pill, Sheet, Skeleton, Tilt } from "@/components/pl/primitives";
import { SpendingBreakdown } from "@/components/pl/SpendingBreakdown";
// @ts-ignore — JS modules
import { fetchAnalysis, fetchUploads, fmtTZS, fmtTZSFull } from "@/data/api";

type Filter = "All" | "Income" | "Expense" | "Review";
const filters: Filter[] = ["All", "Income", "Expense", "Review"];

type Sort = "date_desc" | "date_asc" | "amt_desc" | "amt_asc";
const sortLabel: Record<Sort, string> = {
  date_desc: "Newest first",
  date_asc: "Oldest first",
  amt_desc: "Largest first",
  amt_asc: "Smallest first",
};

const PAGE_SIZE = 50;

const parseDate = (raw: any) => {
  if (!raw) return 0;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
};

// Format a transaction date as "12 Mar" — short, locale-friendly,
// preserves the month so users can see the distribution at a glance.
const formatDateShort = (raw: any) => {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
};

const formatDateLong = (raw: any) => {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "long",
    year: "numeric",
    weekday: "short",
  });
};

// ---------- detail drawer ----------
// Mirrors the webapp's Drawer behaviour: tapping a row opens a sheet
// with the full description and metadata. We keep it inline so the
// mobile bundle does not pull in another component dep.
const TxnDetailDrawer = ({
  txn,
  onClose,
}: {
  txn: any | null;
  onClose: () => void;
}) => {
  /* Retain the last txn so the sheet still has content to render while it
     animates out — clearing it on close would make the panel blank mid-exit. */
  const lastRef = useRef<any>(txn);
  if (txn) lastRef.current = txn;
  const d = lastRef.current;

  if (!d) return null;
  const credit = Number(d.credit) || 0;
  const debit = Number(d.debit) || 0;
  const isInc = credit > 0;
  const amount = isInc ? credit : debit;
  return (
    <Sheet open={!!txn} onClose={onClose} eyebrow="Transaction detail">
        <div className="space-y-5">
          {/* Headline — full description, no truncation. */}
          <div className="bg-surface-3/50 rounded-2xl p-4">
            <div className="text-[12px] font-mono-tab text-txt-3 tabular tracking-wider mb-2">
              {formatDateLong(d.txn_date)}
            </div>
            <div className="text-[18px] font-semibold mt-1.5 break-words leading-snug">
              {d.description || "—"}
            </div>
            <div className="mt-3 flex items-center gap-2.5 flex-wrap">
              <Badge tone={isInc ? "inc" : "exp"}>
                {isInc ? "Income" : "Expense"}
              </Badge>
              {d.category && <Badge tone="muted">{d.category}</Badge>}
              {d.needs_review && <Badge tone="dng">Needs review</Badge>}
            </div>
          </div>

          <div className="ios-group">
            <div className="px-5 py-3 ios-group-item">
              <div className="flex items-center justify-between">
                <span className="text-[14px] text-txt-3">Amount</span>
                <span className={`font-mono-tab font-bold tabular text-[16px] ${isInc ? "text-inc" : "text-exp"}`}>
                  {isInc ? "+" : "−"} {fmtTZSFull(amount)}
                </span>
              </div>
            </div>
            <div className="px-5 py-3 ios-group-item">
              <div className="flex items-center justify-between">
                <span className="text-[14px] text-txt-3">Balance after</span>
                <span className="font-mono-tab tabular text-[16px]">
                  {d.balance != null ? fmtTZSFull(Number(d.balance)) : "—"}
                </span>
              </div>
            </div>
            {d.reference && (
              <div className="px-5 py-3 ios-group-item">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[14px] text-txt-3">Reference</span>
                  <span className="font-mono-tab text-[14px] text-right">{d.reference}</span>
                </div>
              </div>
            )}
            {d.method && (
              <div className="px-5 py-3 ios-group-item">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] text-txt-3">Method</span>
                  <span className="text-[14px]">{d.method}</span>
                </div>
              </div>
            )}
            {d.vendor && (
              <div className="px-5 py-3 ios-group-item">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] text-txt-3">Vendor</span>
                  <span className="text-[14px]">{d.vendor}</span>
                </div>
              </div>
            )}
            {d.page_number != null && (
              <div className="px-5 py-3 ios-group-item">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] text-txt-3">Page</span>
                  <span className="text-[14px]">{String(d.page_number)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
    </Sheet>
  );
};

// ---------- category drill-down drawer ----------
// Full transaction list for a tapped category. Tapping a row hands off to
// the transaction detail sheet. Mirrors the webapp's category Drawer.
const CategoryDrawer = ({
  category,
  txns,
  totalCount,
  onClose,
  onPick,
}: {
  category: any | null;
  txns: any[];
  totalCount: number;
  onClose: () => void;
  onPick: (txn: any) => void;
}) => {
  /* Retain the last category so the sheet still has content while it animates out. */
  const lastRef = useRef<any>(category);
  if (category) lastRef.current = category;
  const c = lastRef.current;

  if (!c) return null;
  return (
    <Sheet
      open={!!category}
      onClose={onClose}
      eyebrow={fmtTZSFull(Number(c.value) || 0)}
      title={c.name}
    >
        <div>
          <div className="text-[12px] font-mono-tab text-txt-3 mb-3">
            {txns.length} of {totalCount} transactions
          </div>
          {txns.length === 0 ? (
            <EmptyState kind="first-run" title="No transactions here" desc="Nothing was categorised under this heading in the selected statement." />
          ) : (
            <div className="space-y-2.5">
              {txns.map((t: any, i: number) => (
                <button
                  key={`${t.row_index ?? i}-${t.txn_date}`}
                  type="button"
                  onClick={() => onPick(t)}
                  className="ios-group w-full text-left ios-press"
                >
                  <div className="px-4 py-3 ios-group-item">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[14px] font-semibold truncate">{t.description || "—"}</span>
                      <span className="font-mono-tab text-[14px] font-bold tabular shrink-0 text-exp">
                        − {fmtTZS(Number(t.debit) || 0)}
                      </span>
                    </div>
                    <div className="text-[12px] text-txt-3 font-mono-tab mt-1.5">{formatDateShort(t.txn_date)}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
    </Sheet>
  );
};

const DetailRow = ({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) => (
  <div className="flex items-start justify-between gap-3 py-2 border-b border-border/50 last:border-0">
    <span className="text-txt-3">{label}</span>
    <span className="text-right text-txt-1 max-w-[60%]">{value}</span>
  </div>
);

const Analysis = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>(
    (params.get("filter") as Filter) || "All"
  );
  const [sort, setSort] = useState<Sort>("date_desc");
  const [q, setQ] = useState("");
  // Page lives in the URL so a deep position survives a reload or a shared link
  // and a back-navigation from a txn detail returns to the same page (pagination.md #7).
  const page = Math.max(1, Number(params.get("page")) || 1);
  const setPage = (p: number) => setParams((prev) => { prev.set("page", String(p)); return prev; }, { replace: true });
  const listTopRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [activeCat, setActiveCat] = useState<any | null>(null);

  const jobIdParam = params.get("job_id");

  // Only EXTRACTED statements can be analysed — a failed/queued upload row has
  // no result JSON and would 404 on /analysis. Ask the backend for done rows so
  // the default `activeJobId` never lands on a failed upload.
  const uploadsQuery = useQuery({
    queryKey: ["uploads", "done"],
    queryFn: () => fetchUploads("done"),
  });

  const uploads: any[] = (uploadsQuery.data as any)?.uploads || (uploadsQuery.data as any) || [];
  const activeJobId = jobIdParam || uploads[0]?.job_id || null;

  useEffect(() => {
    if (!jobIdParam && uploads[0]?.job_id) {
      setParams({ job_id: uploads[0].job_id }, { replace: true });
    }
  }, [jobIdParam, uploads, setParams]);

  const { data: analysis, isLoading, isError, refetch } = useQuery({
    queryKey: ["analysis", activeJobId],
    queryFn: () => fetchAnalysis(activeJobId),
    enabled: Boolean(activeJobId),
  });

  const transactions: any[] = (analysis as any)?.transactions || [];
  const categories: any[] = (analysis as any)?.categories || [];

  const incomeTotal = transactions.reduce((s: number, t: any) => s + (Number(t.credit) || 0), 0);
  const expenseTotal = transactions.reduce((s: number, t: any) => s + (Number(t.debit) || 0), 0);
  const analysisTiles = [
    { label: "Transactions", val: transactions.length, money: false, grad: "from-net/25 via-net/10 to-transparent", chip: "bg-net/15 text-net" },
    { label: "Money in", val: incomeTotal, money: true, grad: "from-inc/25 via-inc/10 to-transparent", chip: "bg-inc/15 text-inc", tone: "text-inc" },
    { label: "Money out", val: expenseTotal, money: true, grad: "from-exp/25 via-exp/10 to-transparent", chip: "bg-exp/15 text-exp", tone: "text-exp" },
  ];

  // Transactions for the drilled-in category. Filter on debit so the list
  // reconciles with category.value (the breakdown sums debits only).
  const catTxns = useMemo(() => {
    if (!activeCat) return [];
    return transactions
      .filter((tx: any) => tx.category === activeCat.name && tx.debit)
      .sort((a: any, b: any) => (Number(b.debit) || 0) - (Number(a.debit) || 0));
  }, [transactions, activeCat]);

  const filtered = useMemo(() => {
    const debounced = q.trim().toLowerCase();
    return transactions
      .filter((t: any) => {
        const amt = Number(t.credit) || -Number(t.debit) || Number(t.amount) || 0;
        if (filter === "Income" && amt <= 0) return false;
        if (filter === "Expense" && amt >= 0) return false;
        if (filter === "Review" && !t.needs_review) return false;
        if (debounced) {
          const hay = `${t.description || ""} ${t.reference || ""} ${amt}`.toLowerCase();
          if (!hay.includes(debounced)) return false;
        }
        return true;
      })
      .sort((a: any, b: any) => {
        const amtA = Number(a.credit) || -Number(a.debit) || Number(a.amount) || 0;
        const amtB = Number(b.credit) || -Number(b.debit) || Number(b.amount) || 0;
        if (sort === "date_desc") return parseDate(b.txn_date) - parseDate(a.txn_date);
        if (sort === "date_asc") return parseDate(a.txn_date) - parseDate(b.txn_date);
        if (sort === "amt_desc") return Math.abs(amtB) - Math.abs(amtA);
        return Math.abs(amtA) - Math.abs(amtB);
      });
  }, [transactions, filter, q, sort]);

  const total = filtered.length;
  const start = (page - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);

  /* Per-chip counts, measured against the SEARCH-filtered set rather than the
     whole statement — otherwise a chip promises rows the active query has
     already excluded, and tapping it lands on an empty list. */
  const filterCounts = useMemo(() => {
    const debounced = q.trim().toLowerCase();
    const searched = transactions.filter((t: any) => {
      if (!debounced) return true;
      const amt = Number(t.credit) || -Number(t.debit) || Number(t.amount) || 0;
      return `${t.description || ""} ${t.reference || ""} ${amt}`.toLowerCase().includes(debounced);
    });
    const amtOf = (t: any) => Number(t.credit) || -Number(t.debit) || Number(t.amount) || 0;
    return {
      All: searched.length,
      Income: searched.filter((t: any) => amtOf(t) > 0).length,
      Expense: searched.filter((t: any) => amtOf(t) < 0).length,
      Review: searched.filter((t: any) => t.needs_review).length,
    } as Record<Filter, number>;
  }, [transactions, q]);

  /* Skeleton mirrors the real layout below: KPI hero row, then the txn list (§81–83). */
  if (uploadsQuery.isLoading || isLoading) {
    return (
      <div className="px-4 py-6 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-10 rounded-xl" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (uploads.length === 0) {
    return (
      <div className="px-4 py-6">
        <EmptyState
          kind="first-run"
          title="Nothing to analyse yet"
          desc="Upload a statement and PesaLens will break down every transaction for you."
          action={
            <button
              onClick={() => navigate("/upload")}
              className="inline-flex items-center gap-2 bg-gradient-accent text-primary-foreground rounded-full px-5 py-2.5 text-[13px] font-semibold ios-press"
            >
              <UploadIcon className="w-4 h-4" /> Upload statement
            </button>
          }
        />
      </div>
    );
  }

  if (isError || !analysis) {
    return (
      <div className="px-4 py-6">
        <ErrorState
          title="Couldn't load analysis"
          cause="We couldn't fetch the breakdown for this statement. Retry, or pick a different upload."
          timestamp={Date.now()}
          onRetry={() => refetch()}
          retryLabel="Retry"
        />
      </div>
    );
  }

  return (
    <div className="px-5 py-5 space-y-5">
      {/* KPI hero — premium at-a-glance totals for this statement */}
      <div className="grid grid-cols-3 gap-2.5">
        {analysisTiles.map((tile) => (
          <Tilt key={tile.label} max={5}>
            <div className={`rounded-2xl border border-border bg-gradient-to-br ${tile.grad} p-3`}>
              <div className={`w-7 h-7 rounded-lg ${tile.chip} flex items-center justify-center mb-2 text-[11px] font-bold font-mono-tab`}>
                {tile.label[0]}
              </div>
              <div className={`font-mono-tab text-[15px] font-bold tabular truncate ${tile.tone || "text-txt-1"}`}>
                {tile.money ? fmtTZS(tile.val) : tile.val}
              </div>
              <div className="text-[10px] text-txt-3 uppercase tracking-wider font-mono-tab truncate mt-0.5">{tile.label}</div>
            </div>
          </Tilt>
        ))}
      </div>

      {uploads.length > 1 && (
        <div className="ios-group focus-ring-within rounded-xl">
          <select
            value={activeJobId || ""}
            onChange={(e) => {
              setParams({ job_id: e.target.value }, { replace: true });
              setPage(1);
            }}
            className="w-full bg-transparent text-[14px] text-txt-1 outline-none px-5 py-3.5"
          >
            {uploads.map((u: any) => (
              <option key={u.job_id} value={u.job_id}>
                {u.filename} · {String(u.bank || "").toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="ios-group flex items-center gap-3 px-4 py-2 focus-ring-within rounded-xl">
        <Search className="w-4.5 h-4.5 text-txt-3 shrink-0" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Search description, ref, or amount"
          className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-txt-4 py-2"
        />
        <button
          onClick={() => {
            const order: Sort[] = ["date_desc", "date_asc", "amt_desc", "amt_asc"];
            const idx = order.indexOf(sort);
            setSort(order[(idx + 1) % order.length]);
          }}
          className="px-3 py-1.5 rounded-lg bg-surface-3 hover:bg-surface-4 flex items-center gap-1.5 text-[11px] font-semibold text-txt-2 ios-press"
          aria-label="Sort"
          title={sortLabel[sort]}
        >
          <ArrowUpDown className="w-3.5 h-3.5" />
          {sortLabel[sort]}
        </button>
      </div>

      <ChipRow
        className="-mx-1 px-1"
        activeCount={filter === "All" ? 0 : 1}
        onClear={() => { setFilter("All"); setPage(1); }}
        resultCount={total}
        resultNoun={total === 1 ? "transaction" : "transactions"}
      >
        {filters.map((f) => (
          <Pill
            key={f}
            active={filter === f}
            disabled={f !== "All" && !filterCounts[f]}
            count={f === "All" ? null : filterCounts[f]}
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
          >
            {f}
          </Pill>
        ))}
      </ChipRow>

      {categories.length > 0 && (
        <SpendingBreakdown
          data={categories}
          title="Tap a category for details"
          onSelect={(c) => setActiveCat(c)}
        />
      )}

      {/* Anchor so paging returns the reader to the top of the list, not wherever
          they had scrolled the previous page to (pagination.md #6). */}
      <div ref={listTopRef} className="text-[12px] font-mono-tab text-txt-3 px-1 scroll-mt-24">
        Showing {Math.min(total, start + 1)}–{Math.min(total, start + visible.length)} of {total}
      </div>

      <div className="space-y-2.5">
        {visible.map((t: any, i: number) => {
          const amt = Number(t.credit) || -Number(t.debit) || Number(t.amount) || 0;
          const isInc = amt > 0;
          const Icon = isInc ? ArrowDownLeft : ArrowUpRight;
          return (
            <button
              key={`${t.row_index ?? i}-${t.txn_date}`}
              type="button"
              onClick={() => setSelected(t)}
              className="ios-group w-full text-left ios-press"
            >
              <div className="px-5 py-3.5 ios-group-item">
                <div className="flex items-start gap-3.5">
                  <div
                    className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                      isInc ? "bg-inc/15 text-inc" : "bg-exp/15 text-exp"
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[14px] font-semibold truncate">{t.description || "—"}</span>
                      <span className={`font-mono-tab text-[14px] font-bold tabular shrink-0 ${isInc ? "text-inc" : "text-exp"}`}>
                        {isInc ? "+" : "−"} {fmtTZS(Math.abs(amt))}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1.5">
                      <span className="text-[12px] text-txt-3 font-mono-tab">{formatDateShort(t.txn_date)}</span>
                      {t.category && <Badge tone="muted">{t.category}</Badge>}
                    </div>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between pt-2">
          <button
            disabled={page <= 1}
            onClick={() => { setPage(page - 1); listTopRef.current?.scrollIntoView({ block: "start" }); }}
            className="press min-h-[44px] px-3 inline-flex items-center gap-1 rounded-xl border border-border bg-surface-2 text-[12px] font-semibold text-txt-2 disabled:opacity-30"
          >
            ← Prev
          </button>
          <span className="text-[11px] font-mono-tab text-txt-3 tracking-wider">
            Page {page} of {Math.ceil(total / PAGE_SIZE)}
          </span>
          <button
            disabled={start + visible.length >= total}
            onClick={() => { setPage(page + 1); listTopRef.current?.scrollIntoView({ block: "start" }); }}
            className="press min-h-[44px] px-3 inline-flex items-center gap-1 rounded-xl border border-border bg-surface-2 text-[12px] font-semibold text-txt-2 disabled:opacity-30"
          >
            Next →
          </button>
        </div>
      )}

      <CategoryDrawer
        category={activeCat}
        txns={catTxns}
        totalCount={transactions.length}
        onClose={() => setActiveCat(null)}
        onPick={(t) => { setActiveCat(null); setSelected(t); }}
      />

      <TxnDetailDrawer txn={selected} onClose={() => setSelected(null)} />
    </div>
  );
};

export default Analysis;
