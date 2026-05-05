import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eyebrow } from "@/components/pl/primitives";
import { Send, Sparkles, FileText } from "lucide-react";
// @ts-ignore — JS modules
import { fetchDashboardSummary, sendAssistantMessage } from "@/data/api";
// @ts-ignore — JS modules
import { useT } from "@/data/i18n";

type Msg = { role: "user" | "ai"; text: string };

const renderText = (text: string) => {
  // Light markdown — bold + line breaks.
  const lines = text.split(/\n/);
  return lines.map((line, li) => (
    <span key={li}>
      {line.split("**").map((p, j) =>
        j % 2 === 1 ? <strong key={j} className="font-mono-tab">{p}</strong> : <span key={j}>{p}</span>
      )}
      {li < lines.length - 1 && <br />}
    </span>
  ));
};

const Assistant = () => {
  const { t } = useT();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const SUGGESTED = [
    t("ai.q.transport"),
    t("ai.q.biggest"),
    t("ai.q.fees"),
    t("ai.q.jump"),
  ];

  const { data: summary } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: fetchDashboardSummary,
  });

  const upload = (summary as any)?.latest_upload;

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const next: Msg = { role: "user", text };
    setMsgs((m) => [...m, next]);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const history = msgs.map((m) => ({ role: m.role === "user" ? "user" : "ai", text: m.text }));
      const reply = await sendAssistantMessage(text, history);
      setMsgs((m) => [...m, { role: "ai", text: reply || "I couldn't produce a reply for that." }]);
    } catch (err: any) {
      setError(err?.message || "Assistant failed.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  return (
    <div className="flex flex-col h-full">
      {/* Source strip */}
      <div className="px-4 pt-4 pb-3">
        <div className="card-soft !p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-accent/15 text-accent flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-semibold truncate">
              {upload ? `${t("ai.groundedOn")} ${upload.filename}` : t("ai.noStatement")}
            </div>
            <div className="text-[10px] text-txt-3 font-mono-tab tracking-wider uppercase">
              {upload?.bank ? String(upload.bank).toUpperCase() : t("ai.uploadToGround")}
              {upload?.period_end ? ` · ${upload.period_end}` : ""}
            </div>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 space-y-3 pb-2">
        {msgs.length === 0 && (
          <div className="text-center py-6">
            <div className="w-14 h-14 rounded-2xl bg-gradient-accent mx-auto flex items-center justify-center mb-3 shadow-lift">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <Eyebrow>{t("ai.askAnything")}</Eyebrow>
            <h2 className="text-[20px] font-bold mt-1">{t("ai.heroTitle")}</h2>
            <p className="text-[13px] text-txt-3 mt-2 max-w-xs mx-auto">
              {t("ai.heroLede")}
            </p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-snug ${
                m.role === "user"
                  ? "bg-gradient-accent text-white rounded-br-md"
                  : "bg-surface-3 text-txt-1 rounded-bl-md border border-border"
              }`}
            >
              {renderText(m.text)}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="bg-surface-3 border border-border rounded-2xl rounded-bl-md px-4 py-3 flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-txt-3 animate-pulse-dot" />
              <span className="w-1.5 h-1.5 rounded-full bg-txt-3 animate-pulse-dot" style={{ animationDelay: "0.2s" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-txt-3 animate-pulse-dot" style={{ animationDelay: "0.4s" }} />
            </div>
          </div>
        )}
        {error && (
          <div className="text-[12px] text-dng bg-dng/10 border border-dng/30 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {msgs.length === 0 && (
        <div className="px-4 pb-2 space-y-2">
          {SUGGESTED.map((p) => (
            <button
              key={p}
              onClick={() => send(p)}
              className="w-full text-left card-soft !p-3 text-[13px] hover:border-accent/50 transition-colors flex items-center justify-between gap-2 group"
            >
              <span className="text-txt-2">{p}</span>
              <span className="text-accent opacity-0 group-hover:opacity-100 transition-opacity">→</span>
            </button>
          ))}
        </div>
      )}

      <div className="px-4 pb-4 pt-2">
        <div className="card-soft !p-1.5 flex items-center gap-1.5">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(input)}
            placeholder={t("ai.placeholder")}
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-txt-4 px-2"
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || busy}
            className="w-9 h-9 rounded-full bg-gradient-accent text-white flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform"
            aria-label="Send"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Assistant;
