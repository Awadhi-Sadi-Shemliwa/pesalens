import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Plus, Trash2, X } from "lucide-react";
import { Badge, CardSoft, Eyebrow, Pill } from "@/components/pl/primitives";
// @ts-ignore — JS modules
import {
  createPersonalEntry,
  deletePersonalEntry,
  fetchPersonalEntries,
  fetchReceipts,
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

const PersonalSpending = () => {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<string | null>(null);
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
  const total = filtered.reduce(
    (s: number, e: any) => s + (e.direction === "expense" ? -Number(e.amount) : Number(e.amount)),
    0
  );

  return (
    <div className="px-4 py-4 space-y-5">
      <div>
        <Eyebrow>Personal spending</Eyebrow>
        <h1 className="text-[22px] font-bold tracking-tight mt-1">Daily ledger</h1>
        <p className="text-[13px] text-txt-3 mt-1">Track cash, daladala, tips, street vendors — anything not on a bank statement.</p>
      </div>

      <CardSoft className="!p-3 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-mono-tab text-txt-3 tracking-wider uppercase">Net flow</div>
          <div className={`font-mono-tab text-[20px] font-bold tabular ${total >= 0 ? "text-inc" : "text-dng"}`}>
            {total >= 0 ? "+" : ""}
            {fmtTZSFull(Math.abs(total))}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={scanning}
            className="w-10 h-10 rounded-full bg-surface-3 flex items-center justify-center disabled:opacity-60"
            aria-label="Scan receipt"
          >
            <Camera className="w-4 h-4 text-txt-2" />
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="w-10 h-10 rounded-full bg-gradient-accent flex items-center justify-center text-white"
            aria-label="Add entry"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </CardSoft>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleScan(e.target.files?.[0] || null)}
      />

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

      <div className="flex gap-2 overflow-x-auto scroll-hide -mx-1 px-1">
        <Pill active={filter === null} onClick={() => setFilter(null)}>
          All
        </Pill>
        {CATEGORIES.map((c) => (
          <Pill key={c} active={filter === c} onClick={() => setFilter(c)}>
            {c}
          </Pill>
        ))}
      </div>

      {entriesQuery.isLoading || receiptsQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card-soft h-14 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <CardSoft className="text-center !py-6">
          <p className="text-[12px] text-txt-3">No entries yet. Tap + to add one.</p>
        </CardSoft>
      ) : (
        <div className="space-y-2">
          {filtered.map((e: any) => {
            const isReceipt = e.source === "receipt";
            return (
              <div key={e.id} className="card-soft !p-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSelected(e)}
                  className="flex-1 min-w-0 text-left active:opacity-70 ios-press"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold truncate">{e.vendor || e.category}</span>
                    <Badge tone={e.direction === "income" ? "inc" : "exp"}>{e.direction}</Badge>
                    {isReceipt && <Badge tone="accent">Receipt</Badge>}
                  </div>
                  <div className="text-[11px] text-txt-3 font-mono-tab truncate">
                    {e.entry_date} · {e.category}
                    {e.description ? ` · ${e.description}` : ""}
                  </div>
                </button>
                <div className="text-right shrink-0">
                  <div className={`font-mono-tab text-[14px] font-bold tabular ${e.direction === "income" ? "text-inc" : "text-txt-1"}`}>
                    {e.direction === "income" ? "+" : "−"}
                    {fmtTZSFull(Number(e.amount) || 0)}
                  </div>
                </div>
                {!isReceipt && (
                  <button
                    onClick={() => remove.mutate(e.id)}
                    disabled={remove.isPending}
                    className="w-8 h-8 rounded-md bg-surface-3 flex items-center justify-center text-txt-3 disabled:opacity-50"
                    aria-label="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <EntryDetailDrawer entry={selected} onClose={() => setSelected(null)} />
    </div>
  );
};

export default PersonalSpending;
