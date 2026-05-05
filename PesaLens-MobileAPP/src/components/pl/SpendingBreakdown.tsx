// @ts-ignore — JS module
import { fmtTZS } from "@/data/api";
import { Eyebrow } from "./primitives";

export type CategoryRow = {
  name: string;
  value: number;
  pct?: number;
};

const PALETTE = [
  "hsl(var(--exp))",
  "hsl(var(--accent))",
  "hsl(var(--net))",
  "hsl(var(--inc))",
  "hsl(var(--dng))",
  "hsl(var(--txt-4))",
];

export const SpendingBreakdown = ({
  data,
  title = "Top categories",
}: {
  data: CategoryRow[];
  title?: string;
}) => {
  if (!data || data.length === 0) {
    return (
      <div className="ios-group">
        <div className="px-5 py-4">
          <div className="text-[13px] font-semibold text-txt-3 uppercase tracking-wide mb-2">Spending Breakdown</div>
          <p className="text-[13px] text-txt-3">No expense breakdown yet — upload a statement to populate this.</p>
        </div>
      </div>
    );
  }
  const total = data.reduce((s, r) => s + Number(r.value || 0), 0) || 1;
  const rows = data.slice(0, 6).map((r, i) => ({
    name: r.name,
    value: Number(r.value || 0),
    pct: r.pct != null ? r.pct : Math.round((r.value / total) * 100),
    color: PALETTE[i % PALETTE.length],
  }));

  return (
    <div className="ios-group">
      <div className="px-5 py-4">
        <div className="text-[13px] font-semibold text-txt-3 uppercase tracking-wide mb-3">Spending Breakdown</div>
        <div className="text-[17px] font-semibold mb-4">{title}</div>
        <div className="flex h-3 rounded-full overflow-hidden mb-5">
          {rows.map((b, i) => (
            <div key={`${b.name}-${i}`} style={{ width: `${b.pct}%`, background: b.color }} />
          ))}
        </div>
        <div className="space-y-3.5">
          {rows.map((b) => (
            <div key={b.name} className="flex items-center gap-3.5">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: b.color }} />
              <span className="flex-1 text-[14px] text-txt-2 truncate">{b.name}</span>
              <span className="font-mono-tab text-[12px] text-txt-3 tabular w-10 text-right">{b.pct}%</span>
              <span className="font-mono-tab text-[14px] font-semibold tabular w-24 text-right">
                {fmtTZS(b.value).replace("TZS ", "")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
