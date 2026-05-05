import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
// @ts-ignore — JS module
import { fmtTZS } from "@/data/api";

export type MonthRow = {
  month?: string;
  m?: string;
  income?: number;
  inc?: number;
  expense?: number;
  exp?: number;
};

const monthLabel = (raw: string | undefined) => {
  if (!raw) return "";
  if (/^\d{4}-\d{2}/.test(raw)) {
    const [, m] = raw.split("-");
    const idx = Number(m) - 1;
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return names[idx] || raw;
  }
  return raw.slice(0, 3);
};

const normalize = (rows: MonthRow[]) =>
  rows.map((r) => {
    const inc = Number(r.income ?? r.inc ?? 0);
    const exp = Number(r.expense ?? r.exp ?? 0);
    return {
      label: monthLabel(r.month || r.m),
      inc,
      exp,
      net: inc - exp,
    };
  });

// Compact axis label so 1.2M / 850K fits on a 360px-wide phone.
const compactTzs = (n: number) => {
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(Math.round(n));
};

const tooltipFormatter = (value: any, name: string) => [fmtTZS(Number(value) || 0), name];

const PesaTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 shadow-lift text-[11px]">
      <div className="font-mono-tab tracking-wider uppercase text-txt-3 text-[10px] mb-1">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 tabular font-mono-tab">
          <span className="w-2 h-2 rounded-sm" style={{ background: p.color }} />
          <span className="text-txt-2">{p.name}</span>
          <span className="ml-auto text-txt-1 font-bold">{fmtTZS(Number(p.value) || 0)}</span>
        </div>
      ))}
    </div>
  );
};

export const IncomeExpenseChart = ({ data }: { data: MonthRow[] }) => {
  const rows = normalize(data || []);
  if (rows.length === 0) {
    return (
      <div className="ios-group">
        <div className="px-5 py-4">
          <div className="text-[13px] font-semibold text-txt-3 uppercase tracking-wide mb-2">Income vs Expenses</div>
          <p className="text-[13px] text-txt-3">Upload a statement to see the monthly trend.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ios-group">
      <div className="px-5 py-4">
        <div className="flex items-end justify-between mb-3 gap-3">
          <div>
            <div className="text-[13px] font-semibold text-txt-3 uppercase tracking-wide">Income vs Expenses</div>
            <div className="text-[17px] font-semibold mt-1">
              Last {rows.length} {rows.length === 1 ? "month" : "months"}
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] font-mono-tab text-txt-2 flex-wrap justify-end">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-inc" /> In</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-exp" /> Out</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-accent" /> Net</span>
          </div>
        </div>

        <div className="h-48 -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="hsl(var(--txt-3))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="hsl(var(--txt-3))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={compactTzs}
                width={42}
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--surface-3))", opacity: 0.5 }}
                content={<PesaTooltip />}
                formatter={tooltipFormatter}
              />
              <Bar dataKey="inc" name="Income" fill="hsl(var(--inc))" radius={[6, 6, 0, 0]} maxBarSize={32} />
              <Bar dataKey="exp" name="Expense" fill="hsl(var(--exp))" radius={[6, 6, 0, 0]} maxBarSize={32} />
              <Line
                type="monotone"
                dataKey="net"
                name="Net"
                stroke="hsl(var(--accent))"
                strokeWidth={2.5}
                dot={{ r: 3, fill: "hsl(var(--accent))", strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
