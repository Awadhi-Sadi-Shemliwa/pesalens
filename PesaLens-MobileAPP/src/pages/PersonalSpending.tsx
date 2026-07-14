import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Camera, Plus, Trash2, X, Wallet, Receipt as ReceiptIcon, ArrowDownRight,
  ShoppingCart, Car, UtensilsCrossed, Zap, HeartPulse, Home, Clapperboard, ChevronRight,
  ScanLine, CheckCircle2,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Badge, Bento, Button, CardSoft, ChipRow, EmptyState, Eyebrow, Pill, Section, Segmented, Sheet, Skeleton, Tilt, ProgressBar, ErrorState } from "@/components/pl/primitives";
// @ts-ignore — JS modules
import {
  createPersonalEntry,
  deletePersonalEntry,
  fetchPersonalEntries,
  fetchReceipts,
  fetchStatementIndex,
  fmtTZS,
  fmtTZSFull,
  scanReceipt,
} from "@/data/api";
// @ts-ignore — JS module
import { useActiveStatement } from "@/data/activeStatementStore";
import { bankLabel as sharedBankLabel } from "@/data/bankLabels";

const bankLabel = (b?: string | null): string => sharedBankLabel(b, "Statement") as string;
const isoDaysAgo = (n: number): string => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const todayIso = (): string => new Date().toISOString().slice(0, 10);
type ViewMode = "statement" | "general";

const CATEGORIES = [
  "Groceries",
  "Transport",
  "Dining",
  "Utilities",
  "Health",
  "Housing",
  "Entertainment",
  "Other",
];

// Backend receipt categories are lowercase (see backend/app/routers/receipts.py
// PROMPT). Map them onto the Title-Case labels PersonalSpending renders so a
// scanned grocery receipt actually shows under the Groceries pill.
const RECEIPT_CATEGORY_MAP: Record<string, string> = {
  groceries: "Groceries",
  restaurant: "Dining",
  utilities: "Utilities",
  transport: "Transport",
  fuel: "Transport", // no Fuel pill — fold into Transport
  stock: "Other", // business inventory — keep out of personal pills
  other: "Other",
};

// Recognisable glyph + brand-palette colour per category, so the ledger
// reads like the avatar-led lists in premium finance apps.
const CATEGORY_ICON: Record<string, any> = {
  Groceries: ShoppingCart, Transport: Car, Dining: UtensilsCrossed, Utilities: Zap,
  Health: HeartPulse, Housing: Home, Entertainment: Clapperboard, Other: Wallet,
};
const CAT_VARS = ["--accent", "--net", "--inc", "--exp", "--dng", "--txt-3"];
const catColorAt = (i: number) => `hsl(var(${CAT_VARS[i % CAT_VARS.length]}))`;

const dayHeading = (isoKey: string) => {
  if (!isoKey || isoKey === "—") return "Undated";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(isoKey + "T00:00:00");
  if (Number.isNaN(d.getTime())) return isoKey;
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "long" });
};

const compactTzs = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n)));

// Fingerprint for dedup: legacy shadow PersonalEntry rows match a receipt
// when (date, vendor-or-category, rounded amount) line up.
const entryKey = (e: any) =>
  [
    (e.entry_date || "").slice(0, 10),
    (e.vendor || "").toLowerCase().trim() || (e.category || "").toLowerCase().trim(),
    Math.round(Number(e.amount) || 0),
  ].join("|");

const formatEntryDate = (raw: any) => {
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

type Direction = "income" | "expense";

type ScanFailure = { message: string; code?: string; timestamp?: number };
type ScanJob =
  | { phase: "scanning" | "done" | "failed"; file?: File | null; vendor?: string; total?: number; failure?: ScanFailure }
  | null;

// Bottom-sheet detail drawer for a personal-spending row. Mirrors the
// TxnDetailDrawer in Analysis.tsx so the interaction feels identical. When
// the row comes from a scanned receipt (source === "receipt") the drawer
// also surfaces the line items so the user can see what was purchased.
const EntryDetailDrawer = ({
  entry,
  onClose,
}: {
  entry: any | null;
  onClose: () => void;
}) => {
  /* Retain the last entry so the sheet still has content while it animates out. */
  const lastRef = useRef<any>(entry);
  if (entry) lastRef.current = entry;
  const en = lastRef.current;

  if (!en) return null;
  const isInc = en.direction === "income";
  const isReceipt = en.source === "receipt";
  const items: any[] = isReceipt && Array.isArray(en.receipt?.items) ? en.receipt.items : [];
  const amount = Number(en.amount) || 0;
  return (
    <Sheet open={!!entry} onClose={onClose} eyebrow={isReceipt ? "Receipt detail" : "Entry detail"}>
        <div className="space-y-5">
          <div className="bg-surface-3/50 rounded-2xl p-4">
            <div className="text-[12px] font-mono-tab text-txt-3 tabular tracking-wider mb-2">
              {formatEntryDate(en.entry_date)}
            </div>
            <div className="text-[18px] font-semibold mt-1.5 break-words leading-snug">
              {en.vendor || en.category || "—"}
            </div>
            {en.description && !isReceipt && (
              <div className="text-[13px] text-txt-2 mt-1.5 break-words leading-snug">
                {en.description}
              </div>
            )}
            <div className="mt-3 flex items-center gap-2.5 flex-wrap">
              <Badge tone={isInc ? "inc" : "exp"}>{isInc ? "Income" : "Expense"}</Badge>
              {en.category && <Badge tone="muted">{en.category}</Badge>}
              {isReceipt && <Badge tone="accent">Receipt</Badge>}
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
          </div>

          {isReceipt && (
            <div>
              <div className="text-[11px] font-mono-tab text-txt-3 uppercase tracking-wider mb-2">
                Items purchased
              </div>
              {items.length === 0 ? (
                <div className="text-[12px] text-txt-3 italic px-1">No line items captured.</div>
              ) : (
                <div className="ios-group">
                  {items.map((it: any, i: number) => {
                    const qty = Number(it.quantity) || 1;
                    const unit = (it.unit || "").trim();
                    const name = it.name || "Item";
                    // OCR returns either `line_total` or a single `price` per
                    // item; both already cover the row total — don't multiply.
                    const price = Number(it.line_total) || Number(it.price) || 0;
                    return (
                      <div key={i} className="px-5 py-3 ios-group-item">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-[14px] font-medium break-words">{name}</div>
                            <div className="text-[11px] text-txt-3 font-mono-tab mt-0.5">
                              {qty}
                              {unit ? ` ${unit}` : "×"}
                            </div>
                          </div>
                          {price > 0 && (
                            <span className="font-mono-tab tabular text-[13px] shrink-0">
                              {fmtTZSFull(price)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
    </Sheet>
  );
};

/* Spend-by-category horizontal bars. */
const CategoryBars = ({ data, total }: { data: { name: string; value: number }[]; total: number }) => {
  const peak = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2.5">
      {data.slice(0, 6).map((c, i) => {
        const pct = total > 0 ? Math.round((c.value / total) * 100) : 0;
        return (
          <div key={c.name}>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="inline-flex items-center gap-1.5 text-[12px] text-txt-2 truncate">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: catColorAt(i) }} />
                <span className="truncate">{c.name}</span>
              </span>
              <span className="text-[11px] font-mono-tab tabular text-txt-3 shrink-0">{fmtTZS(c.value)} · {pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-surface-3 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(c.value / peak) * 100}%`, background: catColorAt(i) }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* One-line stacked category bar. */
const SegBar = ({ data, total }: { data: { name: string; value: number }[]; total: number }) => {
  if (!total || data.length === 0) return <div className="h-3 rounded-full bg-surface-3" />;
  return (
    <div className="h-3 rounded-full overflow-hidden flex bg-surface-3">
      {data.map((c, i) => (
        <div key={c.name} style={{ width: `${(c.value / total) * 100}%`, background: catColorAt(i) }} className="h-full" />
      ))}
    </div>
  );
};

/* Daily-spend area chart (recharts, theme-aware). */
const SpendTrend = ({ series }: { series: { key: string; value: number }[] }) => (
  <div className="h-40 -mx-1" role="img" aria-label="Daily spending trend">
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={series} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="spendfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.28} />
            <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="key" stroke="hsl(var(--txt-3))" fontSize={9} tickLine={false} axisLine={false}
          interval="preserveStartEnd" minTickGap={24}
          tickFormatter={(v) => { const d = new Date(v + "T00:00:00"); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "2-digit", month: "short" }); }} />
        <YAxis stroke="hsl(var(--txt-3))" fontSize={9} tickLine={false} axisLine={false} tickFormatter={compactTzs} width={34} />
        <Tooltip
          cursor={{ stroke: "hsl(var(--border))" }}
          content={({ active, payload, label }: any) => {
            if (!active || !payload?.length) return null;
            const d = new Date(label + "T00:00:00");
            const title = Number.isNaN(d.getTime()) ? label : d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "long" });
            return (
              <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 shadow-lift text-[11px] font-mono-tab">
                <div className="text-txt-3 uppercase tracking-wider text-[10px] mb-1">{title}</div>
                <div className="font-bold">Spent {fmtTZS(payload[0].value)}</div>
              </div>
            );
          }}
        />
        <Area type="monotone" dataKey="value" stroke="hsl(var(--accent))" strokeWidth={2.2} fill="url(#spendfill)" />
      </AreaChart>
    </ResponsiveContainer>
  </div>
);

const PersonalSpending = () => {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [trendRange, setTrendRange] = useState(14);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Honest scan job state drives a prominent overlay: scanning → done, or a
  // classified failure with a reason + retry. `scanning` is derived so existing
  // disabled checks keep working unchanged.
  const [scanJob, setScanJob] = useState<ScanJob>(null);
  const scanning = scanJob?.phase === "scanning";
  const reduce = useReducedMotion();
  const [selected, setSelected] = useState<any | null>(null);
  const [form, setForm] = useState({
    entry_date: new Date().toISOString().slice(0, 10),
    vendor: "",
    category: "Groceries",
    description: "",
    amount: "",
    direction: "expense" as Direction,
  });

  // ── Per-statement scoping (Epic-2) ────────────────────────────────────────
  const [activeJobId] = useActiveStatement();
  const [viewMode, setViewMode] = useState<ViewMode>("statement");
  const [genStart, setGenStart] = useState(isoDaysAgo(90));
  const [genEnd, setGenEnd] = useState(todayIso());
  const statementsQuery = useQuery<any[]>({ queryKey: ["statements-index"], queryFn: fetchStatementIndex });
  const statements: any[] = (statementsQuery.data as any[]) || [];
  const showScope = statements.length > 0;
  // Only trust the active statement if it's one of THIS user's statements (a
  // stale id would scope to a foreign job). Fall back to the newest.
  const effectiveJobId: string | null =
    (activeJobId && statements.some((s) => s.job_id === activeJobId))
      ? activeJobId
      : (statements[0]?.job_id || null);
  const activeStatement = statements.find((s) => s.job_id === effectiveJobId) || null;
  const scopeOpts = useMemo(() => {
    if (!showScope) return {};
    if (viewMode === "general") return { scope: "general", start: genStart, end: genEnd };
    if (effectiveJobId) return { scope: "statement", jobId: effectiveJobId };
    return {};
  }, [showScope, viewMode, effectiveJobId, genStart, genEnd]);
  const scopeKey = JSON.stringify(scopeOpts);

  // Gate the ledger fetches until the statement index has resolved so the FIRST
  // request already carries the right scope — otherwise we'd fetch unscoped
  // (statements still empty) then immediately refetch scoped.
  const scopeReady = statementsQuery.isFetched;
  const entriesQuery = useQuery({ queryKey: ["personal-entries", scopeKey], queryFn: () => fetchPersonalEntries(scopeOpts), enabled: scopeReady });
  const entries: any[] = (entriesQuery.data as any[]) || [];
  const receiptsQuery = useQuery({ queryKey: ["receipts", scopeKey], queryFn: () => fetchReceipts(scopeOpts), enabled: scopeReady });
  const receipts: any[] = (receiptsQuery.data as any[]) || [];

  const create = useMutation({
    mutationFn: (entry: any) => createPersonalEntry(entry),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["personal-entries"] });
      setShowForm(false);
      setForm({ ...form, vendor: "", description: "", amount: "" });
      toast.success("Entry saved");
    },
    onError: (err: any) => {
      setError(err?.message || "Could not save entry.");
      toast.error(err?.message || "Could not save entry.");
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => deletePersonalEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["personal-entries"] });
      toast.success("Entry deleted");
    },
    onError: (err: any) => toast.error(err?.message || "Could not delete entry."),
  });

  const handleScan = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setNotice(null);
    setScanJob({ phase: "scanning", file });
    try {
      // Associate the receipt with the statement in focus (or newest in General).
      const data = await scanReceipt(file, { statementJobId: effectiveJobId });
      if (data?.is_receipt === false) {
        // The backend returns 200 + is_receipt:false for TWO reasons: the model
        // saw a non-receipt image (carries image_description), or every vision
        // model was busy/failed (message only). Surface either prominently with
        // the right next step — retrying a non-receipt is pointless.
        const notReceipt = !!data.image_description;
        setScanJob({
          phase: "failed", file,
          failure: {
            message: data.message || "That image is not a receipt.",
            code: notReceipt ? "not_receipt" : "vision_unavailable",
            timestamp: Date.now(),
          },
        });
        toast.warning(data.message || "That image is not a receipt.");
        return;
      }
      const amount = Number(data.total) || 0;
      // /receipts/scan already persists the receipt server-side. We used to
      // also create a shadow personal entry here, but since the per-category
      // view now merges receipts in directly that would render the scan
      // twice. Just refresh the receipts query and let it flow through.
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      queryClient.invalidateQueries({ queryKey: ["receipt-patterns"] });
      setScanJob({ phase: "done", file, vendor: data.vendor, total: amount });
      toast.success("Receipt captured");
      setTimeout(() => setScanJob((j) => (j?.phase === "done" ? null : j)), 1400);
    } catch (err: any) {
      setScanJob({
        phase: "failed", file,
        failure: {
          message: err?.message || "Receipt scan failed.",
          code: err?.code || "scan_error",
          timestamp: Date.now(),
        },
      });
      toast.error(err?.message || "Receipt scan failed.");
    }
  };

  // Retry from the failure overlay: re-scan the same image for transient
  // failures; for a "not a receipt" verdict, re-open the picker so the user can
  // choose a different image (re-scanning the same one would just fail again).
  const retryScan = () => {
    const job = scanJob;
    if (!job?.file) { setScanJob(null); return; }
    if (job.failure?.code === "not_receipt") {
      setScanJob(null);
      fileRef.current?.click();
      return;
    }
    handleScan(job.file);
  };

  // Project scanned receipts into the same shape personal entries use so
  // the existing list + filter UI doesn't need a parallel code path. The
  // full receipt payload is kept under `receipt` so the detail drawer can
  // show its line items.
  const receiptEntries = useMemo(
    () =>
      receipts.map((r: any) => ({
        id: `receipt:${r.id}`,
        entry_date: r.date || (r.scanned_at || "").slice(0, 10),
        vendor: r.vendor || "Receipt",
        category: RECEIPT_CATEGORY_MAP[(r.category || "other").toLowerCase()] || "Other",
        description: (r.items || [])
          .map((it: any) => it.name)
          .filter(Boolean)
          .join(", ") || null,
        amount: Number(r.total) || Number(r.amount) || 0,
        direction: "expense" as const,
        source: "receipt" as const,
        receipt: r,
      })),
    [receipts]
  );

  // Receipts saved by the old scan flow also left a shadow PersonalEntry row
  // behind (commit 03d0e2e). Drop manual entries that fingerprint-match a
  // receipt so old accounts don't see every receipt twice.
  const allEntries = useMemo(() => {
    const receiptKeys = new Set(receiptEntries.map(entryKey));
    const dedupedManual = entries.filter((e: any) => !receiptKeys.has(entryKey(e)));
    return [...receiptEntries, ...dedupedManual].sort((a: any, b: any) =>
      (b.entry_date || "").localeCompare(a.entry_date || "")
    );
  }, [receiptEntries, entries]);

  const filtered = filter ? allEntries.filter((e: any) => e.category === filter) : allEntries;

  /* How many entries sit behind each category chip. A chip with none is rendered
     disabled rather than dropped, so the option set does not reshuffle under the
     thumb every time the filter changes (filter-chips.md #1). */
  const categoryCounts = useMemo(() => {
    const by: Record<string, number> = {};
    for (const e of allEntries) by[e.category] = (by[e.category] || 0) + 1;
    return by;
  }, [allEntries]);

  /* ---- Derived analytics (real data; expenses drive the breakdown) ---- */
  const expenses = useMemo(() => allEntries.filter((e: any) => e.direction !== "income"), [allEntries]);
  const monthSpend = expenses.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
  const todayISO = new Date().toISOString().slice(0, 10);
  const todaySpend = expenses.filter((e: any) => (e.entry_date || "").slice(0, 10) === todayISO).reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
  const receiptSpend = expenses.filter((e: any) => e.source === "receipt").reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);

  const catAgg = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of expenses) { const k = e.category || "Other"; m[k] = (m[k] || 0) + (Number(e.amount) || 0); }
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [expenses]);
  const catColor: Record<string, string> = {};
  catAgg.forEach((c, i) => { catColor[c.name] = catColorAt(i); });
  const topCategory = catAgg[0];

  const dailySeries = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of expenses) { const k = (e.entry_date || "").slice(0, 10); if (k) m[k] = (m[k] || 0) + (Number(e.amount) || 0); }
    const out = [];
    for (let i = trendRange - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const k = d.toISOString().slice(0, 10); out.push({ key: k, value: m[k] || 0 }); }
    return out;
  }, [expenses, trendRange]);

  const topVendors = useMemo(() => {
    const m: Record<string, { vendor: string; total: number; count: number; category: string }> = {};
    for (const e of expenses) {
      const k = (e.vendor || "").trim() || "Unlabelled";
      if (!m[k]) m[k] = { vendor: k, total: 0, count: 0, category: e.category };
      m[k].total += Number(e.amount) || 0; m[k].count += 1;
    }
    return Object.values(m).sort((a, b) => b.total - a.total).slice(0, 5);
  }, [expenses]);

  const dayGroups = useMemo(() => {
    const by: Record<string, any[]> = {};
    for (const e of filtered) { const k = (e.entry_date || "").slice(0, 10) || "—"; (by[k] || (by[k] = [])).push(e); }
    return Object.keys(by).sort((a, b) => b.localeCompare(a)).map((k) => ({
      key: k, heading: dayHeading(k),
      total: by[k].reduce((s, e) => s + (Number(e.amount) || 0), 0),
      items: by[k],
    }));
  }, [filtered]);

  const overviewTiles = [
    { label: "This month", sub: "All spend", val: monthSpend, grad: "from-exp/25 via-exp/10 to-transparent", chip: "bg-exp/15 text-exp", icon: Wallet },
    { label: "Today", sub: "So far", val: todaySpend, grad: "from-accent/25 via-accent/10 to-transparent", chip: "bg-accent/15 text-accent", icon: ArrowDownRight },
    { label: "Receipts", sub: `${receipts.length} scanned`, val: receiptSpend, grad: "from-net/25 via-net/10 to-transparent", chip: "bg-net/15 text-net", icon: ReceiptIcon },
  ];

  return (
    <div className="px-4 py-4 space-y-5">
      <div>
        <Eyebrow>Personal spending</Eyebrow>
        <h1 className="text-[22px] font-bold tracking-tight mt-1">Daily ledger</h1>
        <p className="text-[13px] text-txt-3 mt-1">Track cash, daladala, tips, street vendors — anything not on a bank statement.</p>
      </div>

      {/* Scope — this statement vs a general window (Epic-2) */}
      {showScope && (
        <div className="space-y-2.5">
          <Segmented<ViewMode>
            label="Ledger scope"
            value={viewMode}
            onChange={setViewMode}
            className="w-full"
            options={[
              { key: "statement", label: "This statement" },
              { key: "general", label: "General" },
            ]}
          />
          {viewMode === "statement" && activeStatement ? (
            <div className="flex items-center gap-2">
              <Badge tone="net">{bankLabel(activeStatement.bank)}</Badge>
              {activeStatement.period_end && (
                <span className="text-[11px] text-txt-3 font-mono-tab truncate">
                  {activeStatement.period_start || "—"} → {activeStatement.period_end}
                </span>
              )}
            </div>
          ) : viewMode === "general" ? (
            <div className="flex items-center gap-2">
              <input type="date" value={genStart} max={genEnd}
                onChange={(e) => setGenStart(e.target.value)}
                className="flex-1 bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-[12px] text-txt-1" />
              <span className="text-[11px] text-txt-3">to</span>
              <input type="date" value={genEnd} min={genStart} max={todayIso()}
                onChange={(e) => setGenEnd(e.target.value)}
                className="flex-1 bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-[12px] text-txt-1" />
            </div>
          ) : null}
        </div>
      )}

      {/* Overview — gradient headline tiles */}
      <div className="grid grid-cols-3 gap-2.5">
        {overviewTiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <Tilt key={tile.label} max={5}>
              <div className={`relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br ${tile.grad} p-3`}>
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${tile.chip}`}>
                  <Icon className="w-4 h-4" />
                </span>
                <div className="font-mono-tab text-[15px] font-bold tabular truncate">{fmtTZS(tile.val)}</div>
                <div className="text-[10px] text-txt-2 font-medium truncate mt-0.5">{tile.label}</div>
                <div className="text-[9px] text-txt-3 uppercase tracking-wider font-mono-tab truncate">{tile.sub}</div>
              </div>
            </Tilt>
          );
        })}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-2.5">
        <button onClick={() => setShowForm((v) => !v)} className="card-soft !p-3.5 text-left active:bg-surface-3">
          <span className="w-9 h-9 rounded-xl bg-accent/15 text-accent flex items-center justify-center mb-2"><Plus className="w-4 h-4" /></span>
          <div className="text-[13px] font-semibold">Add expense</div>
          <div className="text-[10px] text-txt-3 mt-0.5">Log a payment</div>
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={scanning} className="card-soft !p-3.5 text-left active:bg-surface-3 disabled:opacity-60">
          <span className="w-9 h-9 rounded-xl bg-net/15 text-net flex items-center justify-center mb-2"><Camera className="w-4 h-4" /></span>
          <div className="text-[13px] font-semibold">Scan receipt</div>
          <div className="text-[10px] text-txt-3 mt-0.5">Extract line items</div>
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleScan(e.target.files?.[0] || null)}
      />

      {/* Spending trend */}
      <Bento>
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <Eyebrow>Spending trend</Eyebrow>
            <p className="text-[11px] text-txt-3 mt-0.5">Daily out · last {trendRange} days</p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
            {[7, 14, 30].map((r) => (
              <button key={r} onClick={() => setTrendRange(r)}
                className={`text-[10px] px-2 py-1 rounded-md font-medium ${trendRange === r ? "bg-accent/15 text-accent" : "text-txt-3"}`}>
                {r}D
              </button>
            ))}
          </div>
        </div>
        <SpendTrend series={dailySeries} />
      </Bento>

      {/* Analytics — spend by category */}
      <Bento>
        <div className="flex items-center justify-between gap-2 mb-2">
          <Eyebrow>Analytics · by category</Eyebrow>
          {topCategory && <Badge tone="muted">Top: {topCategory.name}</Badge>}
        </div>
        {catAgg.length === 0 ? (
          <p className="text-[12px] text-txt-3 py-4 text-center">Add or scan an expense to see the breakdown.</p>
        ) : (
          <CategoryBars data={catAgg} total={monthSpend} />
        )}
      </Bento>

      {/* Total spending + segmented bar */}
      <Bento>
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[10px] text-txt-3 uppercase tracking-wider font-mono-tab">Total spending</span>
        </div>
        <div className="font-mono-tab text-[22px] font-bold tabular mb-2.5">{fmtTZS(monthSpend)}</div>
        <SegBar data={catAgg} total={monthSpend} />
        <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1.5">
          {catAgg.slice(0, 6).map((c, i) => (
            <span key={c.name} className="inline-flex items-center gap-1.5 text-[11px] text-txt-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: catColorAt(i) }} />{c.name}
            </span>
          ))}
          {catAgg.length === 0 && <span className="text-[11px] text-txt-3">No spend recorded yet.</span>}
        </div>
      </Bento>

      {/* Favourite spends */}
      {topVendors.length > 0 && (
        <Bento>
          <Eyebrow>Favourite spends</Eyebrow>
          <div className="mt-2.5 space-y-2.5">
            {topVendors.map((v) => {
              const color = catColor[v.category] || "hsl(var(--txt-3))";
              return (
                <div key={v.vendor} className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold uppercase"
                    style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
                    {v.vendor.slice(0, 2)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">{v.vendor}</div>
                    <div className="text-[11px] text-txt-3">×{v.count} · {v.category || "Other"}</div>
                  </div>
                  <div className="text-[13px] font-semibold font-mono-tab tabular shrink-0">{fmtTZS(v.total)}</div>
                </div>
              );
            })}
          </div>
        </Bento>
      )}

      {notice && !scanning && (
        <div className="text-[12px] text-inc bg-inc/10 border border-inc/30 rounded-lg px-3 py-2">{notice}</div>
      )}
      {error && (
        <div className="text-[12px] text-dng bg-dng/10 border border-dng/30 rounded-lg px-3 py-2">{error}</div>
      )}

      {showForm && (
        <CardSoft>
          <Eyebrow>NEW ENTRY</Eyebrow>
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={form.entry_date}
                onChange={(e) => setForm({ ...form, entry_date: e.target.value })}
                className="bg-surface-3 border border-border rounded-lg px-3 py-2 text-[13px]"
              />
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="bg-surface-3 border border-border rounded-lg px-3 py-2 text-[13px]"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={form.vendor}
              onChange={(e) => setForm({ ...form, vendor: e.target.value })}
              placeholder="Vendor"
              className="w-full bg-surface-3 border border-border rounded-lg px-3 py-2 text-[13px]"
            />
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Note (optional)"
              className="w-full bg-surface-3 border border-border rounded-lg px-3 py-2 text-[13px]"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="Amount (TZS)"
                className="bg-surface-3 border border-border rounded-lg px-3 py-2 text-[13px]"
              />
              <select
                value={form.direction}
                onChange={(e) => setForm({ ...form, direction: e.target.value as Direction })}
                className="bg-surface-3 border border-border rounded-lg px-3 py-2 text-[13px]"
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </div>
            <Button
              block
              loading={create.isPending}
              loadingLabel="Saving…"
              onClick={() => {
                const amount = Number(form.amount);
                if (!Number.isFinite(amount) || amount <= 0) {
                  setError("Enter a positive amount.");
                  return;
                }
                setError(null);
                create.mutate({
                  entry_date: form.entry_date,
                  vendor: form.vendor || null,
                  category: form.category,
                  description: form.description || null,
                  amount,
                  direction: form.direction,
                  statement_job_id: effectiveJobId || undefined,
                });
              }}
            >
              Save entry
            </Button>
          </div>
        </CardSoft>
      )}

      {/* Transactions */}
      <Section eyebrow="Transactions" title={`${allEntries.length} recorded`}>
        {/* The count recomputes on the same frame as the tap, so a toggle always
            has a visible consequence (filter-chips.md #4–#5). */}
        <ChipRow
          className="-mx-1 px-1 pb-1"
          activeCount={filter ? 1 : 0}
          onClear={() => setFilter(null)}
          resultCount={filtered.length}
          resultNoun={filtered.length === 1 ? "transaction" : "transactions"}
        >
          <Pill active={filter === null} onClick={() => setFilter(null)}>All</Pill>
          {CATEGORIES.map((c) => (
            <Pill
              key={c}
              active={filter === c}
              disabled={!categoryCounts[c]}
              count={categoryCounts[c] || 0}
              onClick={() => setFilter(c)}
            >
              {c}
            </Pill>
          ))}
        </ChipRow>

        {!scopeReady || entriesQuery.isLoading || receiptsQuery.isLoading ? (
          <div className="space-y-2 mt-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-2xl" />
            ))}
          </div>
        ) : dayGroups.length === 0 ? (
          /* A category filter hiding everything is a different screen from a
             genuinely empty list (empty-states.md #7, #9). */
          allEntries.length > 0 ? (
            <EmptyState
              kind="filtered"
              title="Hidden by filters"
              hiddenCount={allEntries.length}
              action={
                <button
                  onClick={() => setFilter(null)}
                  className="rounded-full border border-border px-4 py-2 text-[13px] font-semibold text-txt-1 press"
                >
                  Reset filters
                </button>
              }
            />
          ) : (
            <EmptyState
              kind="first-run"
              title={showScope && viewMode === "statement" && activeStatement
                ? "0 — nothing recorded yet for this statement"
                : "No spending tracked yet"}
              desc={showScope && viewMode === "statement" && activeStatement
                ? `No receipts or entries are tagged to ${bankLabel(activeStatement.bank)} yet. Scan a receipt or add an entry — it’ll be linked to this statement.`
                : "Add an expense or scan a receipt — PesaLens will categorise it and watch for leaks."}
              action={
                <button
                  onClick={() => setShowForm(true)}
                  className="inline-flex items-center gap-2 bg-gradient-accent text-primary-foreground rounded-full px-4 py-2.5 text-[13px] font-semibold press"
                >
                  <Plus className="w-4 h-4" /> Add an expense
                </button>
              }
            />
          )
        ) : (
          <div className="card-soft !p-0 overflow-hidden mt-2">
            {dayGroups.map((grp) => (
              <div key={grp.key}>
                <div className="flex items-center justify-between px-4 py-2 bg-surface-2/80 border-b border-border/40">
                  <span className="text-[11px] font-semibold text-txt-2 uppercase tracking-wide">{grp.heading}</span>
                  <span className="text-[11px] font-mono-tab tabular text-txt-3">−{fmtTZS(grp.total)}</span>
                </div>
                {grp.items.map((e: any) => {
                  const isReceipt = e.source === "receipt";
                  const isInc = e.direction === "income";
                  const color = catColor[e.category] || "hsl(var(--txt-3))";
                  const Icon = isReceipt ? ReceiptIcon : (CATEGORY_ICON[e.category] || Wallet);
                  return (
                    <div key={e.id} className="flex items-center gap-3 px-4 py-3 border-b border-border/30 last:border-0">
                      <button type="button" onClick={() => setSelected(e)} className="flex items-center gap-3 flex-1 min-w-0 text-left active:opacity-70">
                        <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                          style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
                          <Icon className="w-4 h-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold truncate">{e.vendor || e.category}</div>
                          <div className="text-[11px] text-txt-3 truncate">
                            {e.category}{e.description ? ` · ${e.description}` : ""}
                          </div>
                        </div>
                      </button>
                      <div className={`text-[14px] font-bold font-mono-tab tabular shrink-0 ${isInc ? "text-inc" : "text-txt-1"}`}>
                        {isInc ? "+" : "−"}{fmtTZS(Number(e.amount) || 0)}
                      </div>
                      {!isReceipt && (
                        <button onClick={() => remove.mutate(e.id)} disabled={remove.isPending}
                          className="w-7 h-7 rounded-md bg-surface-3 flex items-center justify-center text-txt-3 disabled:opacity-50 shrink-0" aria-label="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </Section>

      <EntryDetailDrawer entry={selected} onClose={() => setSelected(null)} />

      {/* Receipt-scan overlay — HONEST feedback: blocks the surface so a second
          scan can't fire, shows indeterminate progress, then a decisive result
          or a classified failure with retry (design corpus §84–89). Only a
          failed state is dismissable; the 90s client timeout is the escape
          hatch while scanning, never a second upload. */}
      <AnimatePresence>
        {scanJob && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center px-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div
              className="absolute inset-0 bg-deep/85 backdrop-blur-2xl"
              onClick={() => { if (scanJob.phase === "failed") setScanJob(null); }}
            />
            <motion.div
              className="relative w-full max-w-[360px] rounded-3xl glass-pane p-6 grain-bg overflow-hidden"
              initial={{ scale: 0.92, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: "spring", stiffness: 280, damping: 26 }}
            >
              {scanJob.phase === "failed" ? (
                <ErrorState
                  title={scanJob.failure?.code === "not_receipt" ? "That’s not a receipt" : "Scan didn’t finish"}
                  cause={scanJob.failure?.message}
                  code={scanJob.failure?.code}
                  timestamp={scanJob.failure?.timestamp}
                  onRetry={retryScan}
                  retryLabel={scanJob.failure?.code === "not_receipt" ? "Choose another image" : "Try again"}
                />
              ) : scanJob.phase === "done" ? (
                <div className="flex flex-col items-center text-center py-2">
                  <div className="p-3 rounded-2xl bg-inc/15 mb-3">
                    <CheckCircle2 className="w-8 h-8 text-inc" />
                  </div>
                  <div className="text-[15px] font-semibold text-txt-1">Receipt captured</div>
                  <div className="text-[12px] text-txt-3 mt-1">
                    {scanJob.vendor || "Saved"}{scanJob.total ? ` · ${fmtTZSFull(scanJob.total)}` : ""}
                  </div>
                </div>
              ) : (
                <>
                  <div className="relative mx-auto mb-5 h-32 w-24 rounded-xl border border-accent/30 bg-surface-2/60 overflow-hidden">
                    <div className="absolute inset-0 flex items-center justify-center text-accent/70">
                      <ReceiptIcon className="w-10 h-10" strokeWidth={1.5} />
                    </div>
                    {!reduce && <div className="scan-line" />}
                    <div className="absolute inset-x-2 top-2 flex flex-col gap-1.5 opacity-60">
                      <div className="h-1 rounded-full bg-accent/30" />
                      <div className="h-1 rounded-full bg-accent/20 w-3/4" />
                      <div className="h-1 rounded-full bg-accent/20 w-1/2" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 justify-center mb-3">
                    <ScanLine className="w-3.5 h-3.5 text-accent animate-pulse-dot" />
                    <span className="text-[10px] uppercase tracking-ticker font-mono-tab text-txt-3">
                      Pesalens · Vision AI
                    </span>
                  </div>
                  <ProgressBar
                    indeterminate
                    tone="accent"
                    label="Reading your receipt"
                    sublabel="This can take a moment — free-tier models are sometimes busy. Hang tight."
                  />
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default PersonalSpending;
