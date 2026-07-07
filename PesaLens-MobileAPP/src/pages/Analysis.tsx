import { useEffect, useMemo, useState } from "react";
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
import { Badge, Bento, CardSoft, Eyebrow, Pill, Tilt } from "@/components/pl/primitives";
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
  if (!txn) return null;
  const credit = Number(txn.credit) || 0;
  const debit = Number(txn.debit) || 0;
  const isInc = credit > 0;
  const amount = isInc ? credit : debit;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 ios-press"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] bg-surface-2 rounded-t-3xl border-t border-border max-h-[85vh] overflow-y-auto pb-safe shadow-2xl"
      >
        <div className="sticky top-0 bg-surface-2 px-5 pt-4 pb-3 flex items-center justify-between border-b border-border/50">
          <div className="text-[13px] font-semibold text-txt-3 uppercase tracking-wide">Transaction Detail</div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-full bg-surface-3 flex items-center justify-center text-txt-2 active:bg-surface-4 ios-press"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          {/* Headline — full description, no truncation. */}
          <div className="bg-surface-3/50 rounded-2xl p-4">
            <div className="text-[12px] font-mono-tab text-txt-3 tabular tracking-wider mb-2">
              {formatDateLong(txn.txn_date)}
            </div>
            <div className="text-[18px] font-semibold mt-1.5 break-words leading-snug">
              {txn.description || "—"}
            </div>
            <div className="mt-3 flex items-center gap-2.5 flex-wrap">
              <Badge tone={isInc ? "inc" : "exp"}>
                {isInc ? "Income" : "Expense"}
              </Badge>
              {txn.category && <Badge tone="muted">{txn.category}</Badge>}
              {txn.needs_review && <Badge tone="dng">Needs review</Badge>}
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
                  {txn.balance != null ? fmtTZSFull(Number(txn.balance)) : "—"}
                </span>
              </div>
            </div>
            {txn.reference && (
              <div className="px-5 py-3 ios-group-item">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[14px] text-txt-3">Reference</span>
                  <span className="font-mono-tab text-[14px] text-right">{txn.reference}</span>
                </div>
              </div>
            )}
            {txn.method && (
              <div className="px-5 py-3 ios-group-item">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] text-txt-3">Method</span>
                  <span className="text-[14px]">{txn.method}</span>
                </div>
              </div>
            )}
            {txn.vendor && (
              <div className="px-5 py-3 ios-group-item">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] text-txt-3">Vendor</span>
                  <span className="text-[14px]">{txn.vendor}</span>
                </div>
              </div>
            )}
            {txn.page_number != null && (
              <div className="px-5 py-3 ios-group-item">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] text-txt-3">Page</span>
                  <span className="text-[14px]">{String(txn.page_number)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
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
  if (!category) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 ios-press"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] bg-surface-2 rounded-t-3xl border-t border-border max-h-[85vh] overflow-y-auto pb-safe shadow-2xl"
      >
        <div className="sticky top-0 bg-surface-2 px-5 pt-4 pb-3 flex items-center justify-between border-b border-border/50">
          <div className="min-w-0">
            <div className="text-[12px] font-mono-tab text-txt-3 tabular tracking-wider">
              {fmtTZSFull(Number(category.value) || 0)}
            </div>
            <div className="text-[16px] font-semibold truncate">{category.name}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-full bg-surface-3 flex items-center justify-center text-txt-2 active:bg-surface-4 ios-press shrink-0"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="text-[12px] font-mono-tab text-txt-3 mb-3">
            {txns.length} of {totalCount} transactions
          </div>
          {txns.length === 0 ? (
            <p className="text-[13px] text-txt-3 py-6 text-center">No transactions in this category.</p>
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
      </div>
    </div>
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
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<any | null>(null);
  const [activeCat, setActiveCat] = useState<any | null>(null);

  const jobIdParam = params.get("job_id");

  const uploadsQuery = useQuery({
    queryKey: ["uploads"],
    queryFn: fetchUploads,
  });

  const uploads: any[] = (uploadsQuery.data as any)?.uploads || (uploadsQuery.data as any) || [];
  const activeJobId = jobIdParam || uploads[0]?.job_id || null;

  useEffect(() => {
    if (!jobIdParam && uploads[0]?.job_id) {
      setParams({ job_id: uploads[0].job_id }, { replace: true });
    }
  }, [jobIdParam, uploads, setParams]);

  const { data: analysis, isLoading, isError } = useQuery({
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

  if (uploadsQuery.isLoading || isLoading) {
    return (
      <div className="px-5 py-6 space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="ios-group">
            <div className="px-5 py-4">
              <div className="h-4 bg-surface-3 rounded-full w-32 animate-pulse mb-2" />
              <div className="h-5 bg-surface-3 rounded-full w-48 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (uploads.length === 0) {
    return (
      <div className="px-5 py-6">
        <div className="ios-group">
          <div className="px-5 py-8 text-center">
            <div className="text-[13px] font-semibold text-txt-3 uppercase tracking-wide mb-2">No Uploads Yet</div>
            <h2 className="text-[20px] font-bold mt-1">Nothing to analyse yet</h2>
            <p className="text-[13px] text-txt-3 mt-3">Upload a statement to populate the explorer.</p>
            <button
              onClick={() => navigate("/upload")}
              className="mt-5 inline-flex items-center gap-2 bg-gradient-accent text-white rounded-full px-5 py-2.5 text-[13px] font-semibold ios-press"
            >
              <UploadIcon className="w-4 h-4" /> Upload statement
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isError || !analysis) {
    return (
      <div className="px-5 py-6">
        <div className="ios-group">
          <div className="px-5 py-8 text-center">
            <div className="text-[13px] font-semibold text-txt-3 uppercase tracking-wide mb-2">Backend</div>
            <h2 className="text-[20px] font-bold mt-1">Couldn't load analysis</h2>
            <p className="text-[13px] text-txt-3 mt-3">Try reloading or pick a different upload.</p>
          </div>
        </div>
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
        <div className="ios-group">
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

      <div className="ios-group flex items-center gap-3 px-4 py-2">
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

      <div className="flex gap-2.5 overflow-x-auto scroll-hide -mx-1 px-1">
        {filters.map((f) => (
          <Pill
            key={f}
            active={filter === f}
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
          >
            {f}
          </Pill>
        ))}
      </div>

      {categories.length > 0 && (
        <SpendingBreakdown
          data={categories}
          title="Tap a category for details"
          onSelect={(c) => setActiveCat(c)}
        />
      )}

      <div className="text-[12px] font-mono-tab text-txt-3 px-1">
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
            onClick={() => setPage(page - 1)}
            className="text-[12px] font-semibold text-txt-2 disabled:opacity-30"
          >
            ← Prev
          </button>
          <span className="text-[11px] font-mono-tab text-txt-3 tracking-wider">
            Page {page} of {Math.ceil(total / PAGE_SIZE)}
          </span>
          <button
            disabled={start + visible.length >= total}
            onClick={() => setPage(page + 1)}
            className="text-[12px] font-semibold text-txt-2 disabled:opacity-30"
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
