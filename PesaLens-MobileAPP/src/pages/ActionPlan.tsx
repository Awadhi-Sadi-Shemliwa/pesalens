import { useQuery } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { Badge, CardSoft, Eyebrow, Section } from "@/components/pl/primitives";
// @ts-ignore — JS modules
import { fetchDashboardSummary, fmtTZS } from "@/data/api";
// @ts-ignore — JS modules
import { buildActionPlan } from "@/data/decisions";

const sevTone = (s: string) => {
  if (s === "critical") return "dng" as const;
  if (s === "warning") return "exp" as const;
  return "net" as const;
};

const ActionPlan = () => {
  const { data: summary, isLoading } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: fetchDashboardSummary,
  });

  if (isLoading) {
    return (
      <div className="px-4 py-6 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card-soft h-20 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="px-4 py-6">
        <CardSoft className="text-center !py-8">
          <Eyebrow>Action plan</Eyebrow>
          <h2 className="text-[18px] font-bold mt-1">Upload a statement first</h2>
          <p className="text-[12px] text-txt-3 mt-2">
            The Action Plan is built from your latest cash-flow data.
          </p>
        </CardSoft>
      </div>
    );
  }

  const action = buildActionPlan(summary);

  return (
    <div className="px-4 py-4 space-y-5">
      <div>
        <Eyebrow>00 · ACTION PLAN</Eyebrow>
        <h1 className="text-[22px] font-bold tracking-tight mt-1">3 mistakes · 3 wins · a 30-day plan</h1>
        <p className="text-[13px] text-txt-3 mt-1">Built from your latest statement, not generic advice.</p>
      </div>

      {action.mistakes?.length > 0 && (
        <Section eyebrow="Mistakes" title="What's leaking money">
          <div className="space-y-2">
            {action.mistakes.map((m: any, i: number) => {
              const tone = sevTone(m.severity);
              const Icon = tone === "dng" ? AlertTriangle : AlertCircle;
              return (
                <CardSoft key={i} className="!p-3 flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-md bg-${tone}/15 text-${tone} flex items-center justify-center shrink-0`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold">{m.title}</span>
                      <Badge tone={tone}>{m.severity}</Badge>
                    </div>
                    <p className="text-[12px] text-txt-3 mt-1 leading-snug">{m.body}</p>
                    <div className="mt-2 flex items-start gap-2 text-[12px] text-txt-2 bg-surface-3 rounded-lg p-2">
                      <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-accent shrink-0" />
                      <span>{m.fix}</span>
                    </div>
                  </div>
                </CardSoft>
              );
            })}
          </div>
        </Section>
      )}

      {action.opportunities?.length > 0 && (
        <Section eyebrow="Opportunities" title="Wins on the table">
          <div className="space-y-2">
            {action.opportunities.map((o: any, i: number) => (
              <CardSoft key={i} className="!p-3 flex items-start gap-3">
                <div className="w-9 h-9 rounded-md bg-inc/15 text-inc flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold">{o.title}</div>
                  <p className="text-[12px] text-txt-3 mt-1 leading-snug">{o.body}</p>
                  <div className="mt-2 flex items-start gap-2 text-[12px] text-txt-2 bg-surface-3 rounded-lg p-2">
                    <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-accent shrink-0" />
                    <span>{o.action}</span>
                  </div>
                  {Number(o.impact) > 0 && (
                    <div className="text-[11px] font-mono-tab text-inc mt-2">
                      ≈ {fmtTZS(Number(o.impact))} potential impact
                    </div>
                  )}
                </div>
              </CardSoft>
            ))}
          </div>
        </Section>
      )}

      {action.plan?.length > 0 && (
        <Section eyebrow="30-day plan" title="Your next four weeks">
          <div className="space-y-2">
            {action.plan.map((p: any, i: number) => (
              <CardSoft key={i} className="!p-3 flex items-start gap-3">
                <div className="w-9 h-9 rounded-md bg-accent/15 text-accent flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-mono-tab text-txt-3 tracking-wider uppercase">{p.when}</div>
                  <div className="text-[13px] font-semibold mt-0.5">{p.title}</div>
                  <p className="text-[12px] text-txt-3 mt-1 leading-snug">{p.detail}</p>
                </div>
              </CardSoft>
            ))}
          </div>
        </Section>
      )}

      <p className="text-[10px] text-txt-4 text-center font-mono-tab pt-2">
        Educational guidance · not financial advice.
      </p>
    </div>
  );
};

export default ActionPlan;
