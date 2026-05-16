import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CardSoft, Eyebrow } from "@/components/pl/primitives";
import { FileText, KeyRound, ScanLine, Upload as UploadIcon } from "lucide-react";
// @ts-ignore — JS modules
import { uploadStatement } from "@/data/api";

const SCAN_PHASES = [
  { label: "Reading PDF" },
  { label: "Unlocking if protected" },
  { label: "Extracting transactions" },
  { label: "Categorising" },
  { label: "Reconciling balance" },
];

const SUPPORTED = ["CRDB", "NMB", "NBC", "KCB", "Absa", "Amana", "M-Pesa", "Airtel Money", "Tigo Pesa", "HaloPesa", "Selcom", "Yas / Mixx"];
const MAX_BYTES = 50 * 1024 * 1024;

const Upload = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reduce = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(0);
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
    setPhase(0);
    setError(null);
    // The phase ticker is purely cosmetic. Locked PDFs add ~5–30s to
    // the upload while the backend brute-forces the password, which
    // the existing scan overlay already covers visually.
    const phaseTimer = window.setInterval(() => {
      setPhase((p) => (p + 1) % SCAN_PHASES.length);
    }, 1100);
    try {
      const res = await uploadStatement(picked);
      const jobId = (res as any)?.job_id;
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
      if (err?.code === "pdf_unlock_failed") {
        setError(
          "We couldn't auto-unlock this PDF. Most bank statements use a 6-digit numeric password — " +
            "if yours uses something else, please open it on your phone first and re-upload the unlocked copy.",
        );
        return;
      }
      if (err?.code === "pdf_unlock_unsupported") {
        setError(
          "This PDF uses an encryption format we don't yet support. " +
            "Open it on your phone with the password and re-upload the unlocked copy.",
        );
        return;
      }
      setError(err?.message || "Upload failed.");
    } finally {
      window.clearInterval(phaseTimer);
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

      <CardSoft className="!p-3.5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-accent/15 text-accent flex items-center justify-center shrink-0">
            <KeyRound className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold">Locked PDF? We'll handle it.</div>
            <p className="text-[11.5px] text-txt-3 leading-relaxed mt-0.5">
              Many bank statements (CRDB, NMB, Absa) need the last 6 digits of your account number
              to open. Upload it as-is — we unlock it automatically in the background, no password
              entry needed. May add a few extra seconds to the scan.
            </p>
          </div>
        </div>
      </CardSoft>

      <p className="text-[11px] text-txt-4 font-mono-tab tracking-wider text-center pt-2">
        PDFs are deleted server-side after extraction.
      </p>

      {/* Scanning overlay — premium OCR-feel transitional state */}
      <AnimatePresence>
        {busy && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center px-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="absolute inset-0 bg-deep/85 backdrop-blur-2xl" />
            <motion.div
              className="relative w-full max-w-[360px] rounded-3xl glass-pane p-6 grain-bg overflow-hidden"
              initial={{ scale: 0.92, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: "spring", stiffness: 280, damping: 26 }}
            >
              {/* Scanning frame — animated bar sweeps over the document icon */}
              <div className="relative mx-auto mb-5 h-32 w-24 rounded-xl border border-accent/30 bg-surface-2/60 overflow-hidden">
                <div className="absolute inset-0 flex items-center justify-center text-accent/70">
                  <FileText className="w-10 h-10" strokeWidth={1.5} />
                </div>
                {!reduce && <div className="scan-line" />}
                <div className="absolute inset-x-2 top-2 flex flex-col gap-1.5 opacity-60">
                  <div className="h-1 rounded-full bg-accent/30" />
                  <div className="h-1 rounded-full bg-accent/20 w-3/4" />
                  <div className="h-1 rounded-full bg-accent/20 w-1/2" />
                </div>
              </div>

              <div className="flex items-center gap-2 justify-center mb-2">
                <ScanLine className="w-3.5 h-3.5 text-accent animate-pulse-dot" />
                <span className="text-[10px] uppercase tracking-ticker font-mono-tab text-txt-3">
                  Pesalens · OCR
                </span>
              </div>

              {/* Animated phase label */}
              <div className="text-center min-h-[28px]">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={phase}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25 }}
                    className="text-[15px] font-semibold text-txt-1"
                  >
                    {SCAN_PHASES[phase].label}…
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Phase dots */}
              <div className="mt-4 flex items-center justify-center gap-1.5">
                {SCAN_PHASES.map((_, i) => (
                  <motion.span
                    key={i}
                    className={`h-1 rounded-full ${i === phase ? "bg-accent" : "bg-surface-4"}`}
                    animate={{ width: i === phase ? 22 : 6 }}
                    transition={{ type: "spring", stiffness: 300, damping: 26 }}
                  />
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Upload;
