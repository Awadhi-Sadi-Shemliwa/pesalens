import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, BookOpen, Camera, Receipt as ReceiptIcon, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge, CardSoft, EmptyState, Eyebrow, Section, Sheet, Skeleton } from "@/components/pl/primitives";
// @ts-ignore — JS modules
import { fetchReceiptPatterns, fetchReceipts, scanReceipt, fetchReceiptByScan, deleteReceipt, fmtTZSFull, fmtAmount, fmtInCurrency } from "@/data/api";
// @ts-ignore — JS module
import { getActiveStatement } from "@/data/activeStatementStore";

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
  onDelete,
}: {
  receipt: any | null;
  onClose: () => void;
  onDelete: (receiptId: string) => Promise<void>;
}) => {
  const [deleting, setDeleting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  /* Disarm the two-step delete whenever the sheet changes subject. The lastRef
     retain below means this component NEVER unmounts once it has shown a
     receipt, so useState is never reinitialised: without this, arming "Delete
     forever" on receipt A and then opening receipt B renders B's sheet already
     armed — one tap from destroying the wrong record. Keyed off the `receipt`
     PROP, not lastRef.current, so it also fires on close. */
  useEffect(() => { setConfirmDel(false); }, [receipt?.id]);
  /* Retain the last receipt so the sheet still has content to render while it
     animates out — clearing it on close would make the panel blank mid-exit. */
  const lastRef = useRef<any>(receipt);
  if (receipt) lastRef.current = receipt;
  const r = lastRef.current;

  const items: any[] = Array.isArray(r?.items) ? r.items : [];
  const subtotal = Number(r?.subtotal) || 0;
  const tax = Number(r?.tax) || 0;

  if (!r) return null;
  return (
    <Sheet open={!!receipt} onClose={onClose} eyebrow="Receipt detail" title={r.vendor || "Receipt"}>
        <div className="space-y-5">
          <div className="bg-surface-3/50 rounded-2xl p-4">
            <div className="text-[12px] font-mono-tab text-txt-3 tabular tracking-wider mb-2">
              {formatReceiptDate(r.date || r.scanned_at)}
            </div>
            <div className="mt-3 flex items-center gap-2.5 flex-wrap">
              <Badge tone="exp">Expense</Badge>
              {r.category && <Badge tone="muted">{r.category}</Badge>}
              {r.efd_compliant === true && <Badge tone="inc">EFD ok</Badge>}
              {r.efd_compliant === false && <Badge tone="dng">EFD missing</Badge>}
            </div>
          </div>

          <div className="ios-group">
            <div className="px-5 py-3 ios-group-item">
              <div className="flex items-center justify-between">
                <span className="text-[14px] text-txt-3">Total</span>
                {/* fmtAmount, not fmtTZSFull: `total` is in the currency
                    PRINTED on the receipt, so a 140-USD fee would otherwise
                    render as "TZS 140". This shows both sides of the rate. */}
                <span className="font-mono-tab font-bold tabular text-[16px] text-exp">
                  − {fmtAmount(r, { full: true })}
                </span>
              </div>
            </div>
            {subtotal > 0 && (
              <div className="px-5 py-3 ios-group-item">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] text-txt-3">Subtotal</span>
                  {/* Sub-amounts stay in the printed currency — see fmtInCurrency. */}
                  <span className="font-mono-tab tabular text-[14px]">{fmtInCurrency(subtotal, r.currency)}</span>
                </div>
              </div>
            )}
            {tax > 0 && (
              <div className="px-5 py-3 ios-group-item">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] text-txt-3">Tax</span>
                  <span className="font-mono-tab tabular text-[14px]">{fmtInCurrency(tax, r.currency)}</span>
                </div>
              </div>
            )}
            {r.currency && (
              <div className="px-5 py-3 ios-group-item">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] text-txt-3">Currency</span>
                  <span className="text-[14px]">{r.currency}</span>
                </div>
              </div>
            )}
            {r.tax_code && (
              <div className="px-5 py-3 ios-group-item">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] text-txt-3">Tax code</span>
                  <span className="font-mono-tab text-[13px] text-right">{r.tax_code}</span>
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
                            {fmtInCurrency(price, r.currency)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Until now a receipt could be created but never removed, so a bad
              scan was permanent. Two-step (not type-to-confirm): one receipt
              is low-stakes and easy to re-scan. */}
          <div className="pt-1">
            {!confirmDel ? (
              <button
                type="button"
                onClick={() => setConfirmDel(true)}
                className="w-full ios-press flex items-center justify-center gap-2 text-[13px] text-dng border border-dng/30 rounded-xl py-2.5"
              >
                <Trash2 className="w-4 h-4" /> Delete this receipt
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button" disabled={deleting}
                  onClick={async () => {
                    setDeleting(true);
                    try { await onDelete(r.id); } finally { setDeleting(false); }
                  }}
                  className="flex-1 bg-dng text-white py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Delete forever"}
                </button>
                <button
                  type="button" disabled={deleting}
                  onClick={() => setConfirmDel(false)}
                  className="flex-1 bg-surface-3 border border-border text-txt-2 py-2.5 rounded-xl text-[13px]"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
    </Sheet>
  );
};

const Bookkeeping = () => {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  // 'idle' | 'scanning' | 'reconciling'. `reconciling` means the request died
  // but the server may still have saved — see handleScan.
  const [scanPhase, setScanPhase] = useState<"idle" | "scanning" | "reconciling">("idle");
  const scanning = scanPhase !== "idle";
  // The last attempt, so a retry reuses its scan_id and the backend returns
  // the already-saved receipt instead of scanning (and charging) twice.
  const lastScanRef = useRef<{ file: File; scanId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<any>(null);
  const [selected, setSelected] = useState<any | null>(null);

  const patternsQuery = useQuery({ queryKey: ["receipt-patterns"], queryFn: fetchReceiptPatterns });
  const receiptsQuery = useQuery({ queryKey: ["receipts"], queryFn: fetchReceipts });

  const finishScanSuccess = (data: any) => {
    setLatest(data);
    setError(null);
    lastScanRef.current = null;
    queryClient.invalidateQueries({ queryKey: ["receipt-patterns"] });
    queryClient.invalidateQueries({ queryKey: ["receipts"] });
    toast.success("Receipt captured", { description: data?.vendor || undefined });
  };

  // A timed-out/aborted request does NOT mean the scan failed: the server may
  // have saved the receipt after the app gave up. Declaring failure here is
  // what produced the old "failed… then the receipt appears anyway" whiplash —
  // and on a phone network it is the common case, not the edge case.
  const reconcileScan = async (scanId: string, originalErr: any) => {
    setScanPhase("reconciling");
    for (let attempt = 0; attempt < 7; attempt++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetchReceiptByScan(scanId);
        if (res?.found && res.receipt) {
          finishScanSuccess(res.receipt);
          return;
        }
      } catch {
        // The lookup itself failing (still offline) — keep trying until the
        // window closes rather than turning it into a scan failure.
      }
    }
    setError(originalErr?.message || "Receipt scan failed.");
    toast.error("Receipt scan failed", { description: originalErr?.message });
  };

  const handleScan = async (file: File | null, existingScanId: string | null = null) => {
    if (!file) return;
    // Idempotency key for this attempt; a retry reuses it.
    const scanId = existingScanId
      || (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID()
          : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`);
    lastScanRef.current = { file, scanId };
    setScanPhase("scanning");
    setError(null);
    try {
      // Scope the receipt to the statement the user is focused on. Without
      // this, every Bookkeeping scan was saved unattached — it still SHOWED
      // under the newest statement, but deleting that statement left it
      // behind. A null focus stays null: the backend does NOT substitute the
      // newest statement (see _resolve_statement_job), because that would make
      // a receipt scanned outside any statement a child of whatever was
      // uploaded last, and deleting that statement would take its image with
      // it. Unattached is the honest answer when the user has picked nothing.
      const data = await scanReceipt(file, { statementJobId: getActiveStatement(), scanId });
      if (data?.is_receipt === false) {
        const message = data.message || "That image is not a receipt.";
        setError(message);
        toast.warning("Not a receipt", { description: message });
        return;
      }
      finishScanSuccess(data);
    } catch (err: any) {
      // Timeout / network drop: the server may have finished after we gave up.
      // Clean HTTP error responses (4xx/5xx) are decisive and fail at once.
      if (err?.code === "scan_timeout" || err?.transient) {
        await reconcileScan(scanId, err);
        return;
      }
      setError(err?.message || "Receipt scan failed.");
      toast.error("Receipt scan failed", { description: err?.message });
    } finally {
      setScanPhase("idle");
    }
  };

  const retryScan = () => {
    const last = lastScanRef.current;
    if (last?.file) handleScan(last.file, last.scanId);
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
          <span className="text-[13px] font-semibold">
            {scanPhase === "reconciling" ? "Checking…" : scanPhase === "scanning" ? "Scanning…" : "Scan receipt"}
          </span>
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

      {/* The request died but the server may still be finishing — say that
          rather than "failed", which is what caused the old "failed… then the
          receipt appears" whiplash. */}
      {scanPhase === "reconciling" && (
        <div className="text-[12px] text-txt-2 bg-exp/10 border border-exp/30 rounded-lg px-3 py-2 flex items-start gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-exp animate-pulse-dot mt-1.5 shrink-0" />
          <span>
            <span className="font-semibold">Still processing.</span> The connection dropped
            before we got an answer — checking whether your receipt was saved anyway.
            Don’t re-scan yet.
          </span>
        </div>
      )}

      {error && !scanning && (
        <div className="text-[12px] text-dng bg-dng/10 border border-dng/30 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
          <span className="min-w-0">{error}</span>
          {lastScanRef.current?.file && (
            <button
              type="button"
              onClick={retryScan}
              className="shrink-0 ios-press rounded-lg bg-dng/15 border border-dng/30 px-3 py-1.5 text-[12px] font-semibold"
            >
              Try again
            </button>
          )}
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
            <div className="font-mono-tab font-bold text-right">{fmtAmount(latest, { full: true })}</div>
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

      <ReceiptDetailDrawer
        receipt={selected}
        onClose={() => setSelected(null)}
        onDelete={async (id: string) => {
          await deleteReceipt(id);
          toast.success("Receipt deleted");
          setSelected(null);
          if (latest?.id === id) setLatest(null);
          queryClient.invalidateQueries({ queryKey: ["receipts"] });
          queryClient.invalidateQueries({ queryKey: ["receipt-patterns"] });
        }}
      />

      {/* Always render the section. Hiding it when empty is the "void reads as
          breakage" failure (empty-states.md #1) — the user can't tell the feature
          exists, let alone that it's waiting on them. */}
      <Section
        eyebrow="Gallery"
        title="Recent captures"
        action={
          receipts.length > 0 ? (
            <button onClick={() => receiptsQuery.refetch()} className="text-[11px] text-accent flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          ) : undefined
        }
      >
        {receiptsQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-2xl" />
            ))}
          </div>
        ) : receipts.length === 0 ? (
          <EmptyState
            kind="first-run"
            title="No receipts captured yet"
            desc="Scan a receipt and PesaLens reads the vendor, amount and category straight off the photo."
            action={
              <button
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-2 bg-gradient-accent text-primary-foreground rounded-full px-4 py-2.5 text-[13px] font-semibold press"
              >
                <Camera className="w-4 h-4" /> Scan a receipt
              </button>
            }
          />
        ) : (
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
                  {fmtAmount(r, { full: true })}
                </div>
              </button>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
};

export default Bookkeeping;
