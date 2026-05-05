import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Plus, Trash2 } from "lucide-react";
import { Badge, CardSoft, Eyebrow, Pill, Section } from "@/components/pl/primitives";
// @ts-ignore — JS modules
import {
  createBusinessEntry,
  deleteBusinessEntry,
  downloadBusinessReport,
  fetchBusinessEntries,
  fetchBusinessSummary,
  fmtTZSFull,
} from "@/data/api";

const ACCOUNT_CLASSES = [
  { id: "revenue", label: "Revenue", tone: "inc" as const, hint: "Sales, services, fees received" },
  { id: "expense", label: "Expense", tone: "exp" as const, hint: "Stock, salaries, rent, utilities" },
  { id: "asset", label: "Asset", tone: "accent" as const, hint: "Cash on hand, equipment, inventory" },
  { id: "liability", label: "Liability", tone: "dng" as const, hint: "Loans, supplier credit, taxes owed" },
  { id: "equity", label: "Equity", tone: "net" as const, hint: "Owner contributions, retained capital" },
];

const REVENUE_CATS = ["Sales", "Services", "Commission", "Other"];
const EXPENSE_CATS = ["Stock / Inventory", "Salaries", "Rent", "Utilities", "Transport", "Marketing", "Tax", "Other"];
const ASSET_CATS = ["Cash", "Bank", "Inventory", "Equipment", "Receivables", "Other"];
const LIABILITY_CATS = ["Bank loan", "Supplier credit", "Tax owed", "Other"];
const EQUITY_CATS = ["Owner contribution", "Drawings", "Retained capital", "Other"];

const CATEGORY_MAP: Record<string, string[]> = {
  revenue: REVENUE_CATS,
  expense: EXPENSE_CATS,
  asset: ASSET_CATS,
  liability: LIABILITY_CATS,
  equity: EQUITY_CATS,
};

type AccountClass = "revenue" | "expense" | "asset" | "liability" | "equity";

const currentMonth = () => new Date().toISOString().slice(0, 7);

const BusinessLedger = () => {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<AccountClass | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [reportMonth, setReportMonth] = useState<string>(currentMonth());

  const initialClass: AccountClass = "expense";
  const [form, setForm] = useState({
    entry_date: new Date().toISOString().slice(0, 10),
    vendor: "",
    category: CATEGORY_MAP[initialClass][0],
    description: "",
    amount: "",
    account_class: initialClass as AccountClass,
  });

  const entriesQuery = useQuery({ queryKey: ["business-entries"], queryFn: fetchBusinessEntries });
  const entries: any[] = (entriesQuery.data as any[]) || [];

  const summaryQuery = useQuery({
    queryKey: ["business-summary", reportMonth],
    queryFn: () => fetchBusinessSummary(reportMonth),
  });
  const summary: any = summaryQuery.data || null;

  const create = useMutation({
    mutationFn: (entry: any) => createBusinessEntry(entry),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business-entries"] });
      queryClient.invalidateQueries({ queryKey: ["business-summary"] });
      setShowForm(false);
      setForm({
        ...form,
        vendor: "",
        description: "",
        amount: "",
      });
      setNotice("Entry saved.");
      setError(null);
    },
    onError: (err: any) => setError(err?.message || "Could not save entry."),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteBusinessEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business-entries"] });
      queryClient.invalidateQueries({ queryKey: ["business-summary"] });
    },
  });

  const filtered = filter ? entries.filter((e) => e.account_class === filter) : entries;

  const totals = useMemo(() => {
    const t = { revenue: 0, expense: 0, asset: 0, liability: 0, equity: 0 } as Record<string, number>;
    for (const e of entries) {
      const cls = e.account_class as string;
      if (cls in t) t[cls] += Number(e.amount) || 0;
    }
    return t;
  }, [entries]);

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    setNotice(null);
    try {
      await downloadBusinessReport(reportMonth);
      setNotice(`Report downloaded for ${reportMonth}.`);
    } catch (err: any) {
      setError(err?.message || "Could not download report.");
    } finally {
      setDownloading(false);
    }
  };

  const onClassChange = (cls: AccountClass) => {
    setForm({ ...form, account_class: cls, category: CATEGORY_MAP[cls][0] });
  };

  const monthlyNet = summary?.monthly?.net_income ?? totals.revenue - totals.expense;
  const balanceCheck = summary
    ? summary.balance_sheet.asset_total -
      (summary.balance_sheet.liability_total +
        summary.balance_sheet.equity_total +
        (summary.balance_sheet.retained_earnings || 0))
    : 0;

  return (
    <div className="px-4 py-4 space-y-5">
      <div>
        <Eyebrow>Business ledger</Eyebrow>
        <h1 className="text-[22px] font-bold tracking-tight mt-1">Books &amp; reports</h1>
        <p className="text-[13px] text-txt-3 mt-1">
          Manual entries for revenue, expenses, assets, liabilities, and equity. Combined with your scanned receipts, these power the monthly P&amp;L and Balance Sheet.
        </p>
      </div>

      <CardSoft className="!p-3 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-mono-tab text-txt-3 tracking-wider uppercase">Net income (month)</div>
          <div className={`font-mono-tab text-[20px] font-bold tabular ${monthlyNet >= 0 ? "text-inc" : "text-dng"}`}>
            {monthlyNet >= 0 ? "+" : "−"}
            {fmtTZSFull(Math.abs(monthlyNet))}
          </div>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="w-10 h-10 rounded-full bg-gradient-accent flex items-center justify-center text-white"
          aria-label="Add entry"
        >
          <Plus className="w-4 h-4" />
        </button>
      </CardSoft>

      {/* Monthly report */}
      <Section eyebrow="Monthly report" title="Profit & Loss · Balance Sheet">
        <CardSoft className="!p-3 space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={reportMonth}
              onChange={(e) => setReportMonth(e.target.value || currentMonth())}
              className="bg-surface-3 border border-border rounded-lg px-3 py-2 text-[13px] flex-1"
            />
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="bg-gradient-accent text-white py-2 px-3 rounded-lg text-[13px] font-semibold flex items-center gap-1.5 disabled:opacity-60"
            >
              {downloading ? (
                "Generating…"
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" /> PDF
                </>
              )}
            </button>
          </div>
          {summary && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-inc/10 rounded-lg p-2">
                <div className="text-[10px] text-txt-3 uppercase tracking-wide">Revenue</div>
                <div className="font-mono-tab text-[12px] font-bold text-inc tabular">
                  {fmtTZSFull(summary.monthly.revenue_total)}
                </div>
              </div>
              <div className="bg-exp/10 rounded-lg p-2">
                <div className="text-[10px] text-txt-3 uppercase tracking-wide">Expense</div>
                <div className="font-mono-tab text-[12px] font-bold text-exp tabular">
                  {fmtTZSFull(summary.monthly.expense_total)}
                </div>
              </div>
              <div className={`${monthlyNet >= 0 ? "bg-net/10" : "bg-dng/10"} rounded-lg p-2`}>
                <div className="text-[10px] text-txt-3 uppercase tracking-wide">Net</div>
                <div className={`font-mono-tab text-[12px] font-bold tabular ${monthlyNet >= 0 ? "text-net" : "text-dng"}`}>
                  {fmtTZSFull(Math.abs(monthlyNet))}
                </div>
              </div>
            </div>
          )}
          {summary && (
            <div className="text-[11px] text-txt-3 flex items-center gap-1.5">
              <FileText className="w-3 h-3" />
              Includes {summary.monthly.receipt_count || 0} receipt
              {summary.monthly.receipt_count === 1 ? "" : "s"} from this month.
              {Math.abs(balanceCheck) > 1 && (
                <span className="text-exp ml-1">Balance sheet off by {fmtTZSFull(Math.abs(balanceCheck))}.</span>
              )}
            </div>
          )}
        </CardSoft>
      </Section>

      {notice && (
        <div className="text-[12px] text-inc bg-inc/10 border border-inc/30 rounded-lg px-3 py-2">{notice}</div>
      )}
      {error && (
        <div className="text-[12px] text-dng bg-dng/10 border border-dng/30 rounded-lg px-3 py-2">{error}</div>
      )}

      {showForm && (
        <CardSoft>
          <Eyebrow>NEW ENTRY</Eyebrow>
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-5 gap-1.5">
              {ACCOUNT_CLASSES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onClassChange(c.id as AccountClass)}
                  className={`py-2 rounded-lg text-[10px] font-semibold uppercase tracking-wide border transition ${
                    form.account_class === c.id
                      ? `bg-${c.tone}/15 text-${c.tone} border-${c.tone}/40`
                      : "bg-surface-3 text-txt-2 border-border"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-txt-3 -mt-1">
              {ACCOUNT_CLASSES.find((c) => c.id === form.account_class)?.hint}
            </div>
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
                {CATEGORY_MAP[form.account_class].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={form.vendor}
              onChange={(e) => setForm({ ...form, vendor: e.target.value })}
              placeholder="Vendor / counterparty (optional)"
              className="w-full bg-surface-3 border border-border rounded-lg px-3 py-2 text-[13px]"
            />
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Note (optional)"
              className="w-full bg-surface-3 border border-border rounded-lg px-3 py-2 text-[13px]"
            />
            <input
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="Amount (TZS)"
              className="w-full bg-surface-3 border border-border rounded-lg px-3 py-2 text-[13px]"
            />
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
                  account_class: form.account_class,
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
        {ACCOUNT_CLASSES.map((c) => (
          <Pill key={c.id} active={filter === c.id} onClick={() => setFilter(c.id as AccountClass)}>
            {c.label}
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
          <p className="text-[12px] text-txt-3">No entries yet. Tap + to record one.</p>
        </CardSoft>
      ) : (
        <div className="space-y-2">
          {filtered.map((e: any) => {
            const cls = ACCOUNT_CLASSES.find((c) => c.id === e.account_class);
            const sign = e.account_class === "revenue" ? "+" : e.account_class === "expense" ? "−" : "";
            const amountTone =
              e.account_class === "revenue"
                ? "text-inc"
                : e.account_class === "expense"
                ? "text-exp"
                : "text-txt-1";
            return (
              <CardSoft key={e.id} className="!p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold truncate">{e.vendor || e.category}</span>
                    <Badge tone={(cls?.tone as any) || "muted"}>{cls?.label || e.account_class}</Badge>
                  </div>
                  <div className="text-[11px] text-txt-3 font-mono-tab truncate">
                    {e.entry_date} · {e.category}
                    {e.description ? ` · ${e.description}` : ""}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`font-mono-tab text-[14px] font-bold tabular ${amountTone}`}>
                    {sign}
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
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BusinessLedger;
