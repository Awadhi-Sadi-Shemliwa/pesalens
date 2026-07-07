import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Camera, Plus, Trash2, X, Wallet, Receipt as ReceiptIcon, ArrowDownRight,
  ShoppingCart, Car, UtensilsCrossed, Zap, HeartPulse, Home, Clapperboard, ChevronRight,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Bento, CardSoft, Eyebrow, Pill, Section, Tilt } from "@/components/pl/primitives";
// @ts-ignore — JS modules
import {
  createPersonalEntry,
  deletePersonalEntry,
  fetchPersonalEntries,
  fetchReceipts,
  fmtTZS,
  fmtTZSFull,
  scanReceipt,
} from "@/data/api";

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
  if (!entry) return null;
  const isInc = entry.direction === "income";
  const isReceipt = entry.source === "receipt";
  const items: any[] = isReceipt && Array.isArray(entry.receipt?.items) ? entry.receipt.items : [];
  const amount = Number(entry.amount) || 0;
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
          <div className="text-[13px] font-semibold text-txt-3 uppercase tracking-wide">
            {isReceipt ? "Receipt Detail" : "Entry Detail"}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-full bg-surface-3 flex items-center justify-center text-txt-2 active:bg-surface-4 ios-press"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          <div className="bg-surface-3/50 rounded-2xl p-4">
            <div className="text-[12px] font-mono-tab text-txt-3 tabular tracking-wider mb-2">
              {formatEntryDate(entry.entry_date)}
            </div>
            <div className="text-[18px] font-semibold mt-1.5 break-words leading-snug">
              {entry.vendor || entry.category || "—"}
            </div>
            {entry.description && !isReceipt && (
              <div className="text-[13px] text-txt-2 mt-1.5 break-words leading-snug">
                {entry.description}
              </div>
            )}
            <div className="mt-3 flex items-center gap-2.5 flex-wrap">
              <Badge tone={isInc ? "inc" : "exp"}>{isInc ? "Income" : "Expense"}</Badge>
              {entry.category && <Badge tone="muted">{entry.category}</Badge>}
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
      </div>
    </div>
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
  <div className="h-40 -mx-1">
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
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [form, setForm] = useState({
    entry_date: new Date().toISOString().slice(0, 10),
    vendor: "",
    category: "Groceries",
    description: "",
    amount: "",
    direction: "expense" as Direction,
  });

  const entriesQuery = useQuery({ queryKey: ["personal-entries"], queryFn: fetchPersonalEntries });
  const entries: any[] = (entriesQuery.data as any[]) || [];
  const receiptsQuery = useQuery({ queryKey: ["receipts"], queryFn: fetchReceipts });
  const receipts: any[] = (receiptsQuery.data as any[]) || [];

  const create = useMutation({
    mutationFn: (entry: any) => createPersonalEntry(entry),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["personal-entries"] });
      setShowForm(false);
      setForm({ ...form, vendor: "", description: "", amount: "" });
    },
    onError: (err: any) => setError(err?.message || "Could not save entry."),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deletePersonalEntry(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["personal-entries"] }),
  });

  const handleScan = async (file: File | null) => {
    if (!file) return;
    setScanning(true);
    setError(null);
    setNotice(null);
    try {
      const data = await scanReceipt(file);
      if (data?.is_receipt === false) {
        setError(data.message || "That image is not a receipt.");
        return;
      }
      const amount = Number(data.total) || 0;
      // /receipts/scan already persists the receipt server-side. We used to
      // also create a shadow personal entry here, but since the per-category
      // view now merges receipts in directly that would render the scan
      // twice. Just refresh the receipts query and let it flow through.
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      queryClient.invalidateQueries({ queryKey: ["receipt-patterns"] });
      const vendorLabel = data.vendor ? ` from ${data.vendor}` : "";
      setNotice(
        amount > 0
          ? `Saved ${fmtTZSFull(amount)}${vendorLabel}.`
          : `Saved receipt${vendorLabel} (no total detected).`
      );
    } catch (err: any) {
      setError(err?.message || "Receipt scan failed.");
    } finally {
      setScanning(false);
    }
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

      {scanning && (
        <div className="text-[12px] text-txt-2 bg-surface-3 border border-border rounded-lg px-3 py-2">
          Scanning receipt…
        </div>
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
            <button
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
                });
              }}
              disabled={create.isPending}
              className="w-full bg-gradient-accent text-white py-2.5 rounded-lg text-[13px] font-semibold disabled:opacity-60"
            >
              {create.isPending ? "Saving…" : "Save entry"}
            </button>
          </div>
        </CardSoft>
      )}

      {/* Transactions */}
      <Section eyebrow="Transactions" title={`${allEntries.length} recorded`}>
        <div className="flex gap-2 overflow-x-auto scroll-hide -mx-1 px-1 pb-1">
          <Pill active={filter === null} onClick={() => setFilter(null)}>All</Pill>
          {CATEGORIES.map((c) => (
            <Pill key={c} active={filter === c} onClick={() => setFilter(c)}>{c}</Pill>
          ))}
        </div>

        {entriesQuery.isLoading || receiptsQuery.isLoading ? (
          <div className="space-y-2 mt-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card-soft h-14 animate-pulse" />
            ))}
          </div>
        ) : dayGroups.length === 0 ? (
          <CardSoft className="text-center !py-6 mt-2">
            <p className="text-[12px] text-txt-3">No entries yet. Tap + to add one.</p>
          </CardSoft>
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
    </div>
  );
};

export default PersonalSpending;
