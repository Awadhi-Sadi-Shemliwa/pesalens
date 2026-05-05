import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CardSoft, Eyebrow } from "@/components/pl/primitives";
import { FileText, Upload as UploadIcon } from "lucide-react";
// @ts-ignore — JS modules
import { uploadStatement } from "@/data/api";

const SUPPORTED = ["CRDB", "NMB", "NBC", "KCB", "Absa", "Amana", "M-Pesa", "Airtel Money", "Tigo Pesa", "HaloPesa", "Selcom", "Yas / Mixx"];
const MAX_BYTES = 50 * 1024 * 1024;

const Upload = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onPick = (file: File | null) => {
    setError(null);
    if (!file) return;
    if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF statements are supported.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("File is over 50 MB. Re-export at lower quality.");
      return;
    }
    setPicked(file);
  };

  const send = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await uploadStatement(picked);
      const jobId = (res as any)?.job_id;
      // Bust the dashboard / uploads / analysis caches.
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
      queryClient.invalidateQueries({ queryKey: ["uploads"] });
      if (jobId) {
        queryClient.invalidateQueries({ queryKey: ["analysis", jobId] });
        navigate(`/analysis?job_id=${encodeURIComponent(jobId)}`);
      } else {
        navigate("/analysis");
      }
    } catch (err: any) {
      if (err?.status === 402) {
        // The api client already routed to /upgrade.
        return;
      }
      setError(err?.message || "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 py-4 space-y-4">
      <Eyebrow>Statement upload</Eyebrow>
      <h1 className="text-[22px] font-bold tracking-tight">Upload a PDF statement</h1>
      <p className="text-[13px] text-txt-3">
        Bank or mobile-money. We extract every transaction, normalize it, and refresh your dashboard.
      </p>

      <CardSoft>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="w-full flex flex-col items-center gap-2 py-6 border-2 border-dashed border-border rounded-xl active:bg-surface-3 disabled:opacity-60"
        >
          <UploadIcon className="w-7 h-7 text-accent" />
          <span className="text-[14px] font-semibold">Pick a PDF</span>
          <span className="text-[11px] text-txt-3 font-mono-tab tracking-wider">≤ 50 MB</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0] || null)}
        />
        {picked && (
          <div className="mt-3 card-soft !p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-accent/15 text-accent flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold truncate">{picked.name}</div>
              <div className="text-[11px] text-txt-3 font-mono-tab">{(picked.size / 1024).toFixed(1)} KB</div>
            </div>
            <button
              onClick={send}
              disabled={busy}
              className="bg-gradient-accent text-white rounded-full px-3.5 py-2 text-[12px] font-semibold disabled:opacity-60"
            >
              {busy ? "Uploading…" : "Send"}
            </button>
          </div>
        )}
      </CardSoft>

      {error && (
        <div className="text-[12px] text-dng bg-dng/10 border border-dng/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <CardSoft>
        <Eyebrow>Supported banks</Eyebrow>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {SUPPORTED.map((s) => (
            <span key={s} className="text-[11px] font-mono-tab bg-surface-3 text-txt-2 rounded-full px-2 py-0.5">
              {s}
            </span>
          ))}
        </div>
      </CardSoft>

      <p className="text-[11px] text-txt-4 font-mono-tab tracking-wider text-center pt-2">
        PDFs are deleted server-side after extraction.
      </p>
    </div>
  );
};

export default Upload;
