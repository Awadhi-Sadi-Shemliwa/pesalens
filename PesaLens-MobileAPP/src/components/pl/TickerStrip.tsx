import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
// @ts-ignore — JS module
import { fetchPublicTicker } from "@/data/api";

// Shape returned by GET /api/markets/ticker — matches the webapp
// landing-page marquee. Mobile mirrors that field set so the strip
// renders identical data.
type Item = {
  sym: string;
  val: string | number;
  pct?: number | null;
  kind?: string;
};

// Fallback shown only on the very first paint or if the backend is
// unreachable. Replaced as soon as /markets/ticker responds.
const TICKER_FALLBACK: Item[] = [
  { sym: "CRDB",    val: "TZS 2,700",  pct: 3.45,  kind: "stock" },
  { sym: "NMB",     val: "TZS 4,600",  pct: -0.6,  kind: "stock" },
  { sym: "TBL",     val: "TZS 11,200", pct: 1.10,  kind: "stock" },
  { sym: "USD/TZS", val: "2,512",      pct: null,  kind: "fx"    },
  { sym: "EUR/TZS", val: "2,720",      pct: null,  kind: "fx"    },
  { sym: "BTC",     val: "$67,420",    pct: 1.85,  kind: "crypto"},
  { sym: "ETH",     val: "$3,250",     pct: -0.42, kind: "crypto"},
];

const formatPct = (p: number | null | undefined) => {
  if (p == null || !Number.isFinite(p)) return "";
  const sign = p > 0 ? "+" : p < 0 ? "−" : "";
  return `${sign}${Math.abs(p).toFixed(2)}%`;
};

export const TickerStrip = () => {
  const { data } = useQuery<Item[]>({
    queryKey: ["public-ticker"],
    queryFn: fetchPublicTicker,
    refetchInterval: 60_000,
  });

  const items: Item[] = data && data.length > 0 ? data : TICKER_FALLBACK;
  const doubled = [...items, ...items];

  return (
    <div className="overflow-hidden bg-surface-1/80 backdrop-blur-sm py-2.5 border-b border-border/50">
      <div
        className="flex gap-8 animate-ticker whitespace-nowrap"
        style={{ width: "max-content" }}
      >
        {doubled.map((it, i) => {
          const pctText = formatPct(it.pct);
          const up = (it.pct ?? 0) >= 0;
          return (
            <div
              key={`${it.sym}-${i}`}
              className="flex items-center gap-2.5 font-mono-tab text-[12px]"
            >
              <span className="text-txt-2 font-bold tracking-wider">{it.sym}</span>
              <span className="text-txt-1 tabular font-medium">{it.val}</span>
              {pctText && (
                <span className={`flex items-center gap-0.5 font-semibold ${up ? "text-inc" : "text-dng"}`}>
                  {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {pctText}
                </span>
              )}
              <span className="text-txt-4/50">·</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
