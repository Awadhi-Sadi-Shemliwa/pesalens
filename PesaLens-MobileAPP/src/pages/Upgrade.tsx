import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Crown, Sparkles, Upload as UploadIcon, ShieldCheck, Bot, TrendingUp, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Badge, CardSoft, Eyebrow, Section, Skeleton } from "@/components/pl/primitives";
// @ts-ignore — JS modules
import { cancelSubscription, fetchBillingStatus, fetchMe, requestPaymentConfirmation, startCheckout } from "@/data/api";

type ManualPending = {
  payment_id: number;
  amount: number;
  currency: string;
  plan: string;
  instructions: string;
};

type Plan = "monthly" | "yearly";

const FEATURES = [
  { icon: UploadIcon, title: "Unlimited uploads", desc: "CRDB, NMB, M-Pesa, Airtel — no monthly cap." },
  { icon: Bot, title: "AI Financial Advisor", desc: "Ask in English or Swahili about your money." },
  { icon: TrendingUp, title: "Live Markets feed", desc: "DSE, BoT FX, EWURA fuel, crypto, indices." },
  { icon: Receipt, title: "Receipt + voice scanning", desc: "Snap a receipt; we add it to spending." },
  { icon: ShieldCheck, title: "Encrypted in transit", desc: "Statements stay inside your account." },
  { icon: Sparkles, title: "Priority support", desc: "Email response within one business day." },
];

const fmtMoney = (amount?: number, currency: string = "TZS") => {
  if (amount == null) return "—";
  return `${currency} ${Number(amount).toLocaleString("en-US")}`;
};

const formatDate = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

const Upgrade = () => {
  const [plan, setPlan] = useState<Plan>("yearly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualPending, setManualPending] = useState<ManualPending | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const statusQuery = useQuery({ queryKey: ["billing-status"], queryFn: fetchBillingStatus });
  const subscription = statusQuery.data as any;

  // After Stripe redirect-back the URL gets ?status=success — refresh /me.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("status") === "success") {
      fetchMe().catch(() => undefined);
      statusQuery.refetch();
    }
  }, []);

  const handleCheckout = async () => {
    // Map the picker's "monthly" / "yearly" onto the backend plan ids.
    const planId = plan === "yearly" ? "pro_yearly" : "pro_monthly";
    setBusy(true);
    setError(null);
    setManualPending(null);
    setConfirmed(false);
    try {
      const data = await startCheckout(planId);
      if ((data as any)?.checkout_url) {
        window.location.assign((data as any).checkout_url);
        return;
      }
      if ((data as any)?.provider === "manual" && (data as any)?.payment_id) {
        setManualPending(data as ManualPending);
      }
      statusQuery.refetch();
    } catch (err: any) {
      setError(err?.message || "Checkout failed.");
      toast.error("Checkout failed", { description: err?.message });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmPaid = async () => {
    if (!manualPending) return;
    setConfirming(true);
    setError(null);
    try {
      await requestPaymentConfirmation(manualPending.payment_id);
      setConfirmed(true);
      toast.success("Confirmation requested", { description: "We'll verify your payment and activate Pro shortly." });
    } catch (err: any) {
      setError(err?.message || "Couldn't request confirmation — please try again.");
      toast.error("Couldn't request confirmation", { description: err?.message });
    } finally {
      setConfirming(false);
    }
  };

  const handleCancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await cancelSubscription();
      statusQuery.refetch();
      fetchMe().catch(() => undefined);
      /* Cancelling used to succeed silently — the user had no confirmation that
         a billing change had actually taken effect (§65). */
      toast.success("Subscription cancelled", { description: "Pro stays active until the end of your billing period." });
    } catch (err: any) {
      setError(err?.message || "Cancellation failed.");
      toast.error("Cancellation failed", { description: err?.message });
    } finally {
      setBusy(false);
    }
  };

  const plans = (subscription as any)?.plans || {
    monthly: { price: 14900, currency: "TZS" },
    yearly: { price: 149000, currency: "TZS" },
  };

  /* Skeleton mirrors the hero + two plan cards + manual-pay card below (§81–83).
     Prices are the one thing a user must not see a placeholder value for. */
  if (statusQuery.isLoading) {
    return (
      <div className="px-4 py-4 space-y-5">
        <Skeleton className="h-40 rounded-2xl" />
        <div className="space-y-3">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-36 rounded-2xl" />
        </div>
        <Skeleton className="h-28 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="px-4 py-4 space-y-5">
      {/* Premium gradient hero */}
      <div className="rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/20 via-net/10 to-transparent p-5 relative overflow-hidden">
        <span aria-hidden className="absolute -right-8 -top-8 w-28 h-28 rounded-full bg-accent/15 blur-2xl pointer-events-none" />
        <div className="relative flex items-center gap-3">
          <span className="w-12 h-12 rounded-2xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
            <Crown className="w-6 h-6" />
          </span>
          <div>
            <Eyebrow>Upgrade</Eyebrow>
            <h1 className="text-[22px] font-bold tracking-tight leading-tight">PesaLens Pro</h1>
          </div>
        </div>
        <p className="relative text-[13px] text-txt-2 mt-3 leading-snug">Unlimited uploads, the full markets simulator, and the AI advisor — in English or Swahili.</p>
      </div>

      {/* Status card */}
      {subscription?.is_pro ? (
        <CardSoft className="border-inc/20 bg-inc/5 !p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-md bg-inc/15 text-inc flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <div className="text-[14px] font-semibold">PesaLens Pro is active</div>
              <p className="text-[12px] text-txt-2 mt-1">
                Renews on {formatDate(subscription.pro_until) || "—"}.
              </p>
              <button
                onClick={handleCancel}
                disabled={busy}
                className="mt-3 text-[12px] underline text-txt-2 disabled:opacity-50"
              >
                Cancel subscription
              </button>
            </div>
          </div>
        </CardSoft>
      ) : subscription?.status === "trial" ? (
        <CardSoft className="border-accent/20 bg-accent/5 !p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-accent/15 text-accent flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <div className="text-[14px] font-semibold">
                {Number(subscription.trial_days_left ?? 0)} day(s) left in trial
              </div>
              <p className="text-[12px] text-txt-2 mt-0.5">
                Trial ends {formatDate(subscription.trial_ends_at) || "soon"}.
              </p>
            </div>
          </div>
        </CardSoft>
      ) : null}

      {/* Plan picker */}
      {!subscription?.is_pro && (
        <Section eyebrow="Pick a plan" title="Choose how you'd like to pay">
          <div className="grid grid-cols-2 gap-3">
            {(["monthly", "yearly"] as Plan[]).map((id) => {
              const active = plan === id;
              const meta = plans[id] || {};
              return (
                <button
                  key={id}
                  onClick={() => setPlan(id)}
                  className={`card-soft !p-4 text-left ${active ? "border-accent/50 bg-accent/5" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <Crown className={`w-4 h-4 ${active ? "text-accent" : "text-txt-3"}`} />
                    <span className="text-[14px] font-semibold capitalize">{id}</span>
                    {id === "yearly" && <Badge tone="inc">Save ~17%</Badge>}
                  </div>
                  <div className="font-mono-tab text-[20px] font-bold tabular mt-2">
                    {fmtMoney(meta.price, meta.currency || "TZS")}
                  </div>
                  <div className="text-[10px] text-txt-3 mt-1 font-mono-tab tracking-wider">
                    {id === "monthly" ? "Per month · cancel anytime" : "Per year · best value"}
                  </div>
                </button>
              );
            })}
          </div>

          <button
            onClick={handleCheckout}
            disabled={busy}
            className="w-full bg-gradient-accent text-primary-foreground py-3 rounded-xl font-semibold text-[14px] disabled:opacity-60"
          >
            {busy ? "Starting checkout…" : "Continue to checkout"}
          </button>

          {manualPending && (
            <CardSoft className="!p-3 mt-2 border-accent/30 bg-accent/5">
              <Eyebrow>PENDING PAYMENT · #{manualPending.payment_id}</Eyebrow>
              <p className="text-[14px] font-semibold mt-1">
                {fmtMoney(manualPending.amount, manualPending.currency)} · {manualPending.plan === "pro_yearly" ? "Annual" : "Monthly"}
              </p>
              <p className="text-[11px] text-txt-3 mt-1 leading-relaxed">
                {manualPending.instructions}
              </p>
              <button
                onClick={handleConfirmPaid}
                disabled={confirming || confirmed}
                className="mt-3 w-full bg-accent text-white py-2.5 rounded-lg text-[13px] font-semibold disabled:opacity-60"
              >
                {confirmed
                  ? "Confirmation requested — check your email"
                  : confirming
                    ? "Requesting confirmation…"
                    : "I have paid"}
              </button>
              {confirmed && (
                <p className="text-[11px] text-txt-2 mt-2 leading-relaxed">
                  Thanks — we'll email you the moment your payment is verified. The upgrade screen clears automatically once Pro is active.
                </p>
              )}
            </CardSoft>
          )}

          {error && (
            <div className="text-[12px] text-dng bg-dng/10 border border-dng/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </Section>
      )}

      <Section eyebrow="What's included" title="Pro unlocks">
        <div className="space-y-2">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <CardSoft key={f.title} className="!p-3 flex items-start gap-3">
                <div className="w-9 h-9 rounded-md bg-accent/15 text-accent flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold">{f.title}</div>
                  <p className="text-[11px] text-txt-3 mt-0.5">{f.desc}</p>
                </div>
              </CardSoft>
            );
          })}
        </div>
      </Section>

      <p className="text-[10px] text-txt-4 text-center font-mono-tab pt-2">
        On iOS / Android, subscriptions are billed via Apple / Google IAP.
      </p>
    </div>
  );
};

export default Upgrade;
