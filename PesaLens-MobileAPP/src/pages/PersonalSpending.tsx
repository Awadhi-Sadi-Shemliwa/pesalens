import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Plus, Trash2 } from "lucide-react";
import { Badge, CardSoft, Eyebrow, Pill, Section } from "@/components/pl/primitives";
// @ts-ignore — JS modules
import {
  createPersonalEntry,
  deletePersonalEntry,
  fetchPersonalEntries,
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

type Direction = "income" | "expense";

const PersonalSpending = () => {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
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
      await createPersonalEntry({
        entry_date: data.date || new Date().toISOString().slice(0, 10),
        vendor: data.vendor || null,
        category: data.category || "Other",
        description: data.items?.length ? data.items.map((it: any) => it.name || "").filter(Boolean).join(", ") : null,
        amount,
        direction: "expense",
      });
      queryClient.invalidateQueries({ queryKey: ["personal-entries"] });
      const vendorLabel = data.vendor ? ` from ${data.vendor}` : "";
      setNotice(
        amount > 0
          ? `Saved ${fmtTZSFull(amount)}${vendorLabel}.`
          : `Saved receipt${vendorLabel} (no total detected — edit the entry to set it).`
      );
    } catch (err: any) {
      setError(err?.message || "Receipt scan failed.");
    } finally {
      setScanning(false);
    }
  };

  const filtered = filter ? entries.filter((e) => e.category === filter) : entries;
  const total = filtered.reduce((s, e) => s + (e.direction === "expense" ? -Number(e.amount) : Number(e.amount)), 0);

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

      {entriesQuery.isLoading ? (
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
          {filtered.map((e: any) => (
            <CardSoft key={e.id} className="!p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold truncate">{e.vendor || e.category}</span>
                  <Badge tone={e.direction === "income" ? "inc" : "exp"}>{e.direction}</Badge>
                </div>
                <div className="text-[11px] text-txt-3 font-mono-tab truncate">
                  {e.entry_date} · {e.category}
                  {e.description ? ` · ${e.description}` : ""}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className={`font-mono-tab text-[14px] font-bold tabular ${e.direction === "income" ? "text-inc" : "text-txt-1"}`}>
                  {e.direction === "income" ? "+" : "−"}
                  {fmtTZSFull(Number(e.amount) || 0)}
                </div>
              </div>
              <button
                onClick={() => remove.mutate(e.id)}
                disabled={remove.isPending}
                className="w-8 h-8 rounded-md bg-surface-3 flex items-center justify-center text-txt-3 disabled:opacity-50"
                aria-label="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </CardSoft>
          ))}
        </div>
      )}
    </div>
  );
};

export default PersonalSpending;
