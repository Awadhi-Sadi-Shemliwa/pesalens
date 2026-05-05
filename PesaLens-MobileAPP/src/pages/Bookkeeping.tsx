import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, BookOpen, Camera, Receipt as ReceiptIcon, RefreshCw } from "lucide-react";
import { CardSoft, Eyebrow, Section } from "@/components/pl/primitives";
// @ts-ignore — JS modules
import { fetchReceiptPatterns, fetchReceipts, scanReceipt, fmtTZSFull } from "@/data/api";

const Bookkeeping = () => {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<any>(null);

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
          className="card-soft !p-4 flex flex-col items-center gap-2 active:bg-surface-3 disabled:opacity-60"
        >
          <Camera className="w-6 h-6 text-accent" />
          <span className="text-[13px] font-semibold">{scanning ? "Scanning…" : "Scan receipt"}</span>
          <span className="text-[10px] text-txt-3 font-mono-tab">JPEG / PNG · ≤ 8 MB</span>
        </button>
        <CardSoft className="text-center">
          <Eyebrow>RECEIPTS</Eyebrow>
          <div className="font-mono-tab text-[26px] font-bold tabular mt-1">{patterns.receipt_count || 0}</div>
          <div className="text-[10px] text-txt-3 mt-1">Captured to date</div>
        </CardSoft>
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
              <CardSoft key={r.id} className="!p-3 flex items-center gap-3">
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
              </CardSoft>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
};

export default Bookkeeping;
