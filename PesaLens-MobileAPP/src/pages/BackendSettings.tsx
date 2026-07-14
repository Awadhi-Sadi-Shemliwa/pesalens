import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { CardSoft, Eyebrow, Section } from "@/components/pl/primitives";
// @ts-ignore — JS module
import { getApiUrl, setApiUrl } from "@/data/api";

// Backend connection screen. Reachable from the SignIn page's
// "Backend unreachable? Configure server" link and from More → Backend
// so a self-hosted APK can be re-pointed at a working server without
// rebuilding. Previously this component also gated itself on
// VITE_ENABLE_BACKEND_SETTINGS / MODE === "development" and silently
// navigated to "/" in release builds; that redundant gate was the
// cause of the "configure server link returns me to landing" bug.

type Probe = { state: "idle" | "checking" | "ok" | "fail"; detail?: string };

const SUGGESTIONS = [
  // Android emulator → host PC. Real phones use the LAN IP instead.
  { label: "Android emulator", url: "http://10.0.2.2:8000/api" },
  { label: "Local browser dev", url: "http://localhost:8000/api" },
];

const BackendSettings = () => {
  const navigate = useNavigate();
  const [value, setValue] = useState<string>("");
  const [probe, setProbe] = useState<Probe>({ state: "idle" });

  useEffect(() => {
    setValue(getApiUrl() || "");
  }, []);

  const test = async (url: string) => {
    const trimmed = url.trim().replace(/\/+$/, "");
    if (!trimmed) {
      setProbe({ state: "fail", detail: "URL is empty." });
      return;
    }
    setProbe({ state: "checking" });
    try {
      const res = await fetch(`${trimmed}/markets/ticker`, { method: "GET" });
      if (!res.ok) {
        setProbe({ state: "fail", detail: `HTTP ${res.status}` });
        return;
      }
      const body = await res.json();
      const items = body?.data?.items;
      if (!Array.isArray(items)) {
        setProbe({ state: "fail", detail: "Unexpected response shape." });
        return;
      }
      setProbe({ state: "ok", detail: `Reachable · ${items.length} ticker items` });
    } catch (e: any) {
      setProbe({ state: "fail", detail: e?.message || "Network error" });
    }
  };

  const save = () => {
    setApiUrl(value);
    setProbe({ state: "idle" });
  };

  const clearOverride = () => {
    setApiUrl("");
    setValue("");
    setProbe({ state: "idle" });
  };

  return (
    <div className="px-4 py-4 space-y-5">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-[12px] text-txt-3 active:text-txt-1"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div>
        <Eyebrow>Backend</Eyebrow>
        <h1 className="text-[22px] font-bold tracking-tight mt-1">Backend connection</h1>
        <p className="text-[13px] text-txt-3 mt-1">
          Point this APK at a running PesaLens backend. The API runs on your PC; your phone needs to
          reach it on your home Wi-Fi.
        </p>
      </div>

      <CardSoft>
        <Eyebrow>API URL</Eyebrow>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="http://192.168.1.50:8000/api"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="mt-2 w-full bg-surface-3 border border-border rounded-md px-3 py-2 font-mono-tab text-[13px] focus-ring"
        />

        <div className="grid grid-cols-2 gap-2 mt-3">
          <button
            onClick={() => test(value)}
            disabled={probe.state === "checking"}
            className="card-inset !py-2 text-[12px] font-semibold active:bg-surface-4 disabled:opacity-60"
          >
            {probe.state === "checking" ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Testing
              </span>
            ) : (
              "Test"
            )}
          </button>
          <button
            onClick={save}
            className="bg-accent text-accent-foreground rounded-md py-2 text-[12px] font-semibold active:opacity-80"
          >
            Save
          </button>
        </div>

        {probe.state !== "idle" && probe.state !== "checking" && (
          <div
            className={`mt-3 flex items-start gap-2 text-[12px] rounded-md px-3 py-2 ${
              probe.state === "ok"
                ? "bg-inc/10 text-inc border border-inc/30"
                : "bg-dng/10 text-dng border border-dng/30"
            }`}
          >
            {probe.state === "ok" ? (
              <CheckCircle2 className="w-4 h-4 mt-[1px] shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 mt-[1px] shrink-0" />
            )}
            <span>{probe.detail}</span>
          </div>
        )}

        <button
          onClick={clearOverride}
          className="mt-3 text-[11px] text-txt-3 underline active:text-txt-1"
        >
          Clear override (use build-time default)
        </button>
      </CardSoft>

      <Section eyebrow="Quick picks" title="Common URLs">
        <div className="space-y-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.url}
              onClick={() => setValue(s.url)}
              className="w-full text-left card-soft !p-3 active:bg-surface-3"
            >
              <div className="text-[13px] font-semibold">{s.label}</div>
              <div className="text-[11px] text-txt-3 font-mono-tab">{s.url}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section eyebrow="Help" title="Connecting to your PC">
        <CardSoft>
          <ol className="list-decimal pl-5 text-[12px] text-txt-2 space-y-1.5">
            <li>Phone and PC must be on the same Wi-Fi network.</li>
            <li>
              On your PC, start the backend bound to all interfaces:
              <div className="mt-1 font-mono-tab text-[11px] bg-surface-3 rounded px-2 py-1.5">
                uvicorn app.main:app --host 0.0.0.0 --port 8000
              </div>
            </li>
            <li>
              Find your PC's LAN IP (Windows: <span className="font-mono-tab">ipconfig</span> →
              IPv4 address, e.g. <span className="font-mono-tab">192.168.1.50</span>).
            </li>
            <li>
              Set the URL above to{" "}
              <span className="font-mono-tab">http://&lt;PC-IP&gt;:8000/api</span> and tap Test.
            </li>
            <li>
              If Test fails, allow Python through Windows Firewall (Private network) and try again.
            </li>
          </ol>
        </CardSoft>
      </Section>
    </div>
  );
};

export default BackendSettings;
