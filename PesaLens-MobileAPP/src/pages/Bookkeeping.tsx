import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, BookOpen, Camera, Receipt as ReceiptIcon, RefreshCw, X } from "lucide-react";
import { Badge, CardSoft, Eyebrow, Section } from "@/components/pl/primitives";
// @ts-ignore — JS modules
import { fetchReceiptPatterns, fetchReceipts, scanReceipt, fmtTZSFull } from "@/data/api";

const formatReceiptDate = (raw: any) => {
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

// Bottom-sheet detail drawer for a scanned receipt. Mirrors the
// TxnDetailDrawer pattern in Analysis.tsx (kept inline rather than shared
// — only one other instance lives in PersonalSpending, abstraction is
// premature at two).
const ReceiptDetailDrawer = ({
  receipt,
  onClose,
}: {
  receipt: any | null;
  onClose: () => void;
}) => {
  if (!receipt) return null;
  const items: any[] = Array.isArray(receipt.items) ? receipt.items : [];
  const total = Number(receipt.total) || Number(receipt.amount) || 0;
  const subtotal = Number(receipt.subtotal) || 0;
  const tax = Number(receipt.tax) || 0;
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
          <div className="text-[13px] font-semibold text-txt-3 uppercase tracking-wide">Receipt Detail</div>
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
              {formatReceiptDate(receipt.date || receipt.scanned_at)}
            </div>
            <div className="text-[18px] font-semibold mt-1.5 break-words leading-snug">
              {receipt.vendor || "Receipt"}
            </div>
            <div className="mt-3 flex items-center gap-2.5 flex-wrap">
              <Badge tone="exp">Expense</Badge>
              {receipt.category && <Badge tone="muted">{receipt.category}</Badge>}
              {receipt.efd_compliant === true && <Badge tone="inc">EFD ok</Badge>}
              {receipt.efd_compliant === false && <Badge tone="dng">EFD missing</Badge>}
            </div>
          </div>

          <div className="ios-group">
            <div className="px-5 py-3 ios-group-item">
              <div className="flex items-center justify-between">
                <span className="text-[14px] text-txt-3">Total</span>
                <span className="font-mono-tab font-bold tabular text-[16px] text-exp">
                  − {fmtTZSFull(total)}
                </span>
              </div>
            </div>
            {subtotal > 0 && (
              <div className="px-5 py-3 ios-group-item">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] text-txt-3">Subtotal</span>
                  <span className="font-mono-tab tabular text-[14px]">{fmtTZSFull(subtotal)}</span>
                </div>
              </div>
            )}
            {tax > 0 && (
              <div className="px-5 py-3 ios-group-item">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] text-txt-3">Tax</span>
                  <span className="font-mono-tab tabular text-[14px]">{fmtTZSFull(tax)}</span>
                </div>
              </div>
            )}
            {receipt.currency && (
              <div className="px-5 py-3 ios-group-item">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] text-txt-3">Currency</span>
                  <span className="text-[14px]">{receipt.currency}</span>
                </div>
              </div>
            )}
            {receipt.tax_code && (
              <div className="px-5 py-3 ios-group-item">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] text-txt-3">Tax code</span>
                  <span className="font-mono-tab text-[13px] text-right">{receipt.tax_code}</span>
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="text-[11px] font-mono-tab text-txt-3 uppercase tracking-wider mb-2">Items</div>
            {items.length === 0 ? (
              <div className="text-[12px] text-txt-3 italic px-1">No line items captured.</div>
            ) : (
              <div className="ios-group">
                {items.map((it: any, i: number) => {
                  const qty = Number(it.quantity) || 1;
                  const unit = (it.unit || "").trim();
                  const name = it.name || "Item";
                  // The OCR model returns either `line_total` (preferred) or a
                  // single `price` field per item. Both already cover the row;
                  // don't multiply by qty again or we double-count.
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
        </div>
      </div>
    </div>
  );
};

const Bookkeeping = () => {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<any>(null);
  const [selected, setSelected] = useState<any | null>(null);

  const patternsQuery = useQuery({ queryKey: ["receipt-patterns"], queryFn: fetchReceiptPatterns });
  const receiptsQuery = useQuery({ queryKey: ["receipts"], queryFn: fetchReceipts });

  const handleScan = async (file: File | null) => {
    if (!file) return;
    setScanning(true);
    setError(null);
    try {
      const data = await scanReceipt(file);
      if (data?.is_receipt === false) {
        setError(data.message || "That image is not a receipt.");
        return;
      }
      setLatest(data);
      queryClient.invalidateQueries({ queryKey: ["receipt-patterns"] });
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
    } catch (err: any) {
      setError(err?.message || "Receipt scan failed.");
    } finally {
      setScanning(false);
    }
  };

  const patterns = (patternsQuery.data as any) || { insights: [], by_category: {}, receipt_count: 0 };
  const byCat: [string, number][] = Object.entries(patterns.by_category || {}).map(
    ([k, v]) => [k, Number(v)]
  );
  byCat.sort((a, b) => b[1] - a[1]);
  const total = byCat.reduce((s, [, v]) => s + v, 0) || 1;

  const receipts = (receiptsQuery.data as any[]) || [];

  return (
    <div className="px-4 py-4 space-y-5">
      <div>
        <Eyebrow>Bookkeeping</Eyebrow>
        <h1 className="text-[22px] font-bold tracking-tight mt-1">Receipts &amp; insights</h1>
        <p className="text-[13px] text-txt-3 mt-1">Snap a receipt to extract vendor, category, and amount automatically.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={scanning}
          className="rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/20 via-accent/10 to-transparent p-4 flex flex-col items-center justify-center gap-2 active:opacity-90 disabled:opacity-60"
        >
          <span className="w-11 h-11 rounded-2xl bg-accent/15 text-accent flex items-center justify-center">
            <Camera className="w-5 h-5" />
          </span>
          <span className="text-[13px] font-semibold">{scanning ? "Scanning…" : "Scan receipt"}</span>
          <span className="text-[10px] text-txt-3 font-mono-tab">JPEG / PNG · ≤ 8 MB</span>
        </button>
        <div className="rounded-2xl border border-net/25 bg-gradient-to-br from-net/20 via-net/10 to-transparent p-4 text-center flex flex-col justify-center">
          <Eyebrow>Receipts</Eyebrow>
          <div className="font-mono-tab text-[28px] font-bold tabular mt-1 text-net">{patterns.receipt_count || 0}</div>
          <div className="text-[10px] text-txt-3 mt-1">Captured to date</div>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleScan(e.target.files?.[0] || null)}
      />

      <Link to="/business-ledger" className="block">
        <CardSoft className="!p-3 flex items-center gap-3 active:bg-surface-3">
          <div className="w-10 h-10 rounded-xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
            <BookOpen className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-semibold">Business Ledger</div>
            <div className="text-[11px] text-txt-3 truncate">
              Add revenue, assets, liabilities &middot; download monthly P&amp;L + Balance Sheet PDF
            </div>
          </div>
          <ArrowUpRight className="w-4 h-4 text-txt-3 shrink-0" />
        </CardSoft>
      </Link>

      {error && (
        <div className="text-[12px] text-dng bg-dng/10 border border-dng/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {latest && (
        <CardSoft>
          <Eyebrow>LATEST CAPTURE</Eyebrow>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
            <div className="text-txt-3">Vendor</div>
            <div className="font-medium text-right truncate">{latest.vendor || "—"}</div>
            <div className="text-txt-3">Category</div>
            <div className="font-medium text-right truncate">{latest.category || "—"}</div>
            <div className="text-txt-3">Amount</div>
            <div className="font-mono-tab font-bold text-right">{fmtTZSFull(Number(latest.total) || 0)}</div>
            <div className="text-txt-3">Date</div>
            <div className="font-medium text-right">{latest.date || "—"}</div>
          </div>
        </CardSoft>
      )}

      {patterns.insights?.length > 0 && (
        <Section eyebrow="Insights" title="What your receipts say">
          <div className="space-y-2">
            {patterns.insights.map((line: string, i: number) => (
              <CardSoft key={i} className="!p-3">
                <p className="text-[12px] text-txt-2">{line}</p>
              </CardSoft>
            ))}
          </div>
        </Section>
      )}

      {byCat.length > 0 && (
        <Section eyebrow="By category" title="Spend mix">
          <CardSoft>
            <div className="space-y-2.5">
              {byCat.slice(0, 8).map(([name, value]) => {
                const pct = Math.round((value / total) * 100);
                return (
                  <div key={name} className="flex items-center gap-3">
                    <span className="flex-1 text-[13px] text-txt-2 truncate">{name}</span>
                    <span className="font-mono-tab text-[12px] text-txt-3 tabular w-10 text-right">{pct}%</span>
                    <span className="font-mono-tab text-[13px] font-semibold tabular w-24 text-right">{fmtTZSFull(value)}</span>
                  </div>
                );
              })}
            </div>
          </CardSoft>
        </Section>
      )}

      <ReceiptDetailDrawer receipt={selected} onClose={() => setSelected(null)} />

      {receipts.length > 0 && (
        <Section
          eyebrow="Gallery"
          title="Recent captures"
          action={
            <button onClick={() => receiptsQuery.refetch()} className="text-[11px] text-accent flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          }
        >
          <div className="space-y-2">
            {receipts.slice(0, 12).map((r: any) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected(r)}
                className="card-soft !p-3 flex items-center gap-3 w-full text-left active:bg-surface-3 ios-press"
              >
                <div className="w-10 h-10 rounded-md bg-surface-3 flex items-center justify-center text-txt-3 shrink-0">
                  <ReceiptIcon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold truncate">{r.vendor || "Receipt"}</div>
                  <div className="text-[11px] text-txt-3 font-mono-tab truncate">
                    {r.category || "—"} · {r.date || ""}
                  </div>
                </div>
                <div className="font-mono-tab text-[14px] font-bold tabular shrink-0">
                  {fmtTZSFull(Number(r.amount) || 0)}
                </div>
              </button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
};

export default Bookkeeping;
