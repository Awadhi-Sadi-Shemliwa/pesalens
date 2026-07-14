import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import { CardSoft, Eyebrow, ProgressBar, ErrorState } from "@/components/pl/primitives";
import { FileText, KeyRound, ScanLine, Upload as UploadIcon, CheckCircle2 } from "lucide-react";
// @ts-ignore — JS modules
import { uploadStatement, fetchUploadStatus } from "@/data/api";

const SUPPORTED = ["CRDB", "NMB", "NBC", "KCB", "Absa", "Amana", "M-Pesa", "Airtel Money", "Tigo Pesa", "HaloPesa", "Selcom", "Yas / Mixx"];
const MAX_BYTES = 50 * 1024 * 1024;
// Cap on how long we poll a job before calling it a (retryable) timeout, so a
// stranded backend job can't spin the progress card forever.
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

type Phase = "idle" | "uploading" | "processing" | "done" | "failed";
type Failure = { message: string; code?: string; stage?: string | null; progress?: number | null; timestamp?: string | number | null };
type Job = { phase: Phase; pct: number; stage?: string; failure?: Failure } | null;

const Upload = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reduce = useReducedMotion();
  const [job, setJob] = useState<Job>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Poll lifecycle guard: bumping the generation cancels any in-flight poll —
  // on unmount, and whenever a new upload supersedes an older one.
  const pollRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; gen: number }>({ timer: null, gen: 0 });
  useEffect(() => () => {
    pollRef.current.gen += 1;
    if (pollRef.current.timer) clearTimeout(pollRef.current.timer);
  }, []);

  const busy = !!job && (job.phase === "uploading" || job.phase === "processing");

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

  const send = async (file: File | null = picked) => {
    if (!file) return;
    setError(null);
    setJob({ phase: "uploading", pct: 0 });

    const onProgress = (loaded: number, total: number) => {
      const pct = total ? Math.round((loaded / total) * 100) : 0;
      setJob((j) => (j && j.phase === "uploading" ? { ...j, pct } : j));
    };

    let jobId: string | undefined;
    try {
      const res = await uploadStatement(file, onProgress);
      jobId = (res as any)?.job_id;
    } catch (err: any) {
      if (err?.status === 402) { setJob(null); return; } // api routed to /upgrade
      // PDF unlock now runs in the background worker, so the POST no longer
      // returns unlock codes — those surface via the poll's error_message. Here
      // we only handle upload-time failures (network, auth, validation).
      const message = err?.message || "Upload failed.";
      setJob({ phase: "failed", pct: 0, failure: { message, code: err?.code, timestamp: Date.now() } });
      toast.error("Upload failed", { description: message });
      return;
    }

    if (!jobId) { setJob(null); navigate("/analysis"); return; }

    // Poll the extraction job. The generation token invalidates this loop if the
    // component unmounts or a newer upload starts; the deadline turns a job that
    // never resolves into an honest, retryable failure instead of an endless card.
    const gen = ++pollRef.current.gen;
    if (pollRef.current.timer) clearTimeout(pollRef.current.timer);
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    const schedule = (fn: () => void, ms: number) => { pollRef.current.timer = setTimeout(fn, ms); };
    const alive = () => pollRef.current.gen === gen;

    setJob({ phase: "processing", pct: 0, stage: "Queued" });
    const poll = async () => {
      if (!alive()) return; // superseded or unmounted
      let status: any;
      try {
        status = await fetchUploadStatus(jobId);
      } catch {
        if (alive()) schedule(poll, 1500); // transient — keep polling
        return;
      }
      if (!alive()) return;
      if (status?.status === "done") {
        setJob({ phase: "done", pct: 100 });
        queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
        queryClient.invalidateQueries({ queryKey: ["uploads"] });
        queryClient.invalidateQueries({ queryKey: ["analysis", jobId] });
        toast.success("Statement extracted");
        schedule(() => navigate(`/analysis?job_id=${encodeURIComponent(jobId!)}`), 700);
        return;
      }
      if (status?.status === "failed") {
        const failure: Failure = {
          message: status.error_message || "Extraction failed",
          code: status.error_code,
          stage: status.failed_stage,
          progress: status.failed_progress,
          timestamp: status.finished_at,
        };
        setJob({ phase: "failed", pct: status.failed_progress || 0, failure });
        toast.error("Extraction failed", { description: failure.message });
        return;
      }
      if (Date.now() > deadline) {
        const failure: Failure = {
          message: "This is taking longer than expected. The extraction may still be running — check back shortly, or try again.",
          code: "timeout",
          stage: status?.stage,
          progress: status?.progress,
          timestamp: Date.now(),
        };
        setJob({ phase: "failed", pct: status?.progress || 0, failure });
        toast.error("Extraction timed out", { description: failure.message });
        return;
      }
      setJob((j) => (j ? { ...j, phase: "processing", pct: status?.progress ?? j.pct, stage: status?.stage || j.stage } : j));
      schedule(poll, 1000);
    };
    poll();
  };

  const failed = job?.phase === "failed";
  const done = job?.phase === "done";

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
              onClick={() => send()}
              disabled={busy}
              className="bg-gradient-accent text-primary-foreground rounded-full px-3.5 py-2 text-[12px] font-semibold disabled:opacity-60"
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

      {/* Job overlay — HONEST progress driven by real byte upload + server stages */}
      <AnimatePresence>
        {job && job.phase !== "idle" && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center px-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="absolute inset-0 bg-deep/85 backdrop-blur-2xl" onClick={() => { if (failed) setJob(null); }} />
            <motion.div
              className="relative w-full max-w-[360px] rounded-3xl glass-pane p-6 grain-bg overflow-hidden"
              initial={{ scale: 0.92, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: "spring", stiffness: 280, damping: 26 }}
            >
              {failed ? (
                <ErrorState
                  title="Upload didn’t finish"
                  cause={job.failure?.message}
                  code={job.failure?.code}
                  stage={job.failure?.stage}
                  progress={job.failure?.progress}
                  timestamp={job.failure?.timestamp}
                  onRetry={picked ? () => send(picked) : undefined}
                  retryLabel="Try again"
                />
              ) : done ? (
                <div className="flex flex-col items-center text-center py-2">
                  <div className="p-3 rounded-2xl bg-inc/15 mb-3">
                    <CheckCircle2 className="w-8 h-8 text-inc" />
                  </div>
                  <div className="text-[15px] font-semibold text-txt-1">Statement extracted</div>
                  <div className="text-[12px] text-txt-3 mt-1">Opening your analysis…</div>
                </div>
              ) : (
                <>
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

                  <div className="flex items-center gap-2 justify-center mb-3">
                    <ScanLine className="w-3.5 h-3.5 text-accent animate-pulse-dot" />
                    <span className="text-[10px] uppercase tracking-ticker font-mono-tab text-txt-3">
                      {job.phase === "uploading" ? "Pesalens · Uploading" : "Pesalens · OCR"}
                    </span>
                  </div>

                  <ProgressBar
                    value={job.pct}
                    tone="accent"
                    label={job.phase === "uploading" ? "Uploading" : job.stage || "Processing"}
                    sublabel={
                      job.phase === "uploading"
                        ? "Sending your statement securely…"
                        : "This can take a moment — keep the app open."
                    }
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

export default Upload;
