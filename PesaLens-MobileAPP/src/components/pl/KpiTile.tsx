import { Eyebrow } from "./primitives";
// @ts-ignore — JS module
import { fmtTZS } from "@/data/api";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiTileProps {
  index?: string;
  label: string;
  value: number;
  delta?: number;
  tone?: "inc" | "exp" | "dng" | "net" | "accent";
  spark?: number[];
  hint?: string;
}

export const KpiTile = ({ label, value, delta, tone = "net", spark, hint }: KpiTileProps) => {
  const toneCls = {
    inc: "text-inc",
    exp: "text-exp",
    dng: "text-dng",
    net: "text-net",
    accent: "text-accent",
  }[tone];

  const sparkColor = `hsl(var(--${tone}))`;

  return (
    <div className="card-soft p-4 flex flex-col gap-2.5 min-h-[130px]">
      <div className="flex items-start justify-between">
        <div className="text-[12px] font-semibold text-txt-3 uppercase tracking-wide">{label}</div>
        {delta !== undefined && (
          <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-mono-tab font-bold px-2 py-0.5 rounded-full", delta >= 0 ? "bg-inc/15 text-inc" : "bg-dng/15 text-dng")}>
            {delta >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      <div className={cn("font-mono-tab text-[26px] font-bold leading-none tabular tracking-tight", toneCls)}>
        {hint ? hint : fmtTZS(value)}
      </div>
      {spark && spark.length > 1 && <Sparkline data={spark} color={sparkColor} />}
    </div>
  );
};

export const Sparkline = ({ data, color }: { data: number[]; color: string }) => {
  const w = 100;
  const h = 28;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = w / Math.max(1, data.length - 1);
  const path = data.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / range) * h;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const area = `${path} L${w},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-7 mt-auto" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`gradient-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.2} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#gradient-${color.replace('#', '')})`} />
      <path d={path} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};
