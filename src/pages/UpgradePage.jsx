import React, { useEffect, useState } from 'react';
import { AppShell } from '../components/navigation';
import { Icon } from '../components/Icon';
import { Badge, Button, Eyebrow, Skeleton, toast } from '../components/common';
import { TiltCard } from '../components/motion';
import {
  cancelSubscription,
  fetchBillingStatus,
  fetchMe,
  requestPaymentConfirmation,
  startCheckout,
} from '../data/api';
import { useAuth } from '../data/authStore';

/* ----------------------------------------------------------------
   /upgrade — paywall + checkout flow.

   - Shows the user's current trial / Pro state with a clear CTA.
   - Lists the monthly + yearly plans pulled from /billing/status so
     pricing changes don't need a frontend deploy.
   - Routes to Stripe Checkout when the backend is in Stripe mode and
     to a manual-payout instructions card when it's in `manual` mode.
   - After ?status=success (Stripe redirect) we silently re-fetch /me
     so the trial banner disappears immediately.
   ---------------------------------------------------------------- */

const fmtMoney = (amount, currency = 'TZS') => {
  if (amount == null) return '—';
  const n = Number(amount);
  if (currency === 'TZS') return `TZS ${n.toLocaleString('en-US')}`;
  return `${currency} ${n.toLocaleString('en-US')}`;
};

const formatDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const FEATURES = [
  { icon: 'upload',     title: 'Unlimited statement uploads',         desc: 'CRDB, NMB, NBC, Stanbic, M-Pesa, Airtel — no monthly cap.' },
  { icon: 'bot',        title: 'AI Financial Advisor',                desc: 'Ask questions in English or Swahili about your money, the markets, where to start saving.' },
  { icon: 'trending',   title: 'Live Markets feed',                   desc: 'DSE stocks, Bank of Tanzania FX, EWURA fuel prices, crypto, S&P 500 and Polymarket.' },
  { icon: 'receipt',    title: 'Receipt + voice scanning',            desc: 'Snap a receipt or paste a copy; we add it to your spending automatically.' },
  { icon: 'shield',     title: 'Encrypted in transit, never resold',  desc: 'Your statements stay inside your account. Delete everything any time.' },
  { icon: 'sparkles',   title: 'Priority support',                    desc: 'Email response within one business day. New banks added on request.' },
];

const StatusCard = ({ subscription }) => {
  if (!subscription) return null;
  const { status, trial_days_left, trial_ends_at, pro_until, is_pro } = subscription;

  if (is_pro) {
    return (
      <div className="card-soft p-3 sm:p-5 lg:p-6 border border-inc/20 bg-inc/5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-inc/15 text-inc flex-shrink-0">
            <Icon name="check" size={16} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-txt-1">PesaLens Pro is active</h3>
            <p className="text-xs sm:text-sm text-txt-2 mt-1 leading-relaxed break-words">
              Renews on <span className="font-medium text-txt-1">{formatDate(pro_until) || '—'}</span>.
              You have full access to every feature.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'trial') {
    const tone = trial_days_left <= 3 ? 'expense' : 'accent';
    return (
      <div className={`card-soft p-3 sm:p-5 lg:p-6 border ${tone === 'expense' ? 'border-exp/30 bg-exp/5' : 'border-accent/20 bg-accent/5'}`}>
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg flex-shrink-0 ${tone === 'expense' ? 'bg-exp/15 text-exp' : 'bg-accent/15 text-accent'}`}>
            <Icon name={tone === 'expense' ? 'alert' : 'sparkles'} size={16} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-txt-1">
              {trial_days_left} {trial_days_left === 1 ? 'day' : 'days'} left in your free trial
            </h3>
            <p className="text-xs sm:text-sm text-txt-2 mt-1 leading-relaxed break-words">
              Trial ends on <span className="font-medium text-txt-1">{formatDate(trial_ends_at) || '—'}</span>.
              Upgrade to Pro to keep extracting statements, asking the AI advisor, and seeing live market data without interruption.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Expired (trial_expired or pro_expired)
  return (
    <div className="card-soft p-3 sm:p-5 lg:p-6 border border-dng/30 bg-dng/5">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-dng/15 text-dng flex-shrink-0">
          <Icon name="alert" size={16} />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-txt-1">
            {status === 'pro_expired' ? 'Your Pro subscription has expired' : 'Your 14-day trial has ended'}
          </h3>
          <p className="text-xs sm:text-sm text-txt-2 mt-1 leading-relaxed break-words">
            Pick a plan below to restore access. Your uploaded statements and personal entries are preserved while you're on pause.
          </p>
        </div>
      </div>
    </div>
  );
};

const PlanCard = ({ plan, busy, onChoose, recommended }) => {
  return (
    <TiltCard
      max={5}
      glare={recommended}
      className={`relative ${recommended ? 'glass-pane' : 'bento'} rounded-[22px] p-4 sm:p-6 overflow-hidden`}
      style={recommended ? { borderColor: 'rgb(var(--c-accent) / 0.55)', boxShadow: '0 24px 70px -34px rgb(var(--c-accent) / 0.55)' } : undefined}
    >
      {recommended && (
        <>
          <span aria-hidden className="absolute -right-14 -top-14 w-48 h-48 rounded-full blur-3xl bg-accent/15 pointer-events-none" />
          <Badge color="accent" dot className="absolute top-4 right-4 z-10">Best value</Badge>
        </>
      )}
      <Eyebrow>{plan.interval === 'year' ? 'Annual' : 'Monthly'}</Eyebrow>
      <h3 className="mt-2 text-base sm:text-lg font-semibold tracking-tight">{plan.name}</h3>
      <div className="mt-4 flex items-baseline gap-2 flex-wrap">
        <span className="text-3xl sm:text-4xl font-bold tabular tracking-tight text-txt-1">
          {fmtMoney(plan.price, plan.currency)}
        </span>
        <span className="text-sm text-txt-3">/ {plan.interval}</span>
      </div>
      {plan.savings_pct > 0 && (
        <p className="mt-1 text-xs text-inc font-medium">
          Save {plan.savings_pct}% vs paying monthly
        </p>
      )}
      <p className="mt-4 text-xs sm:text-sm text-txt-2 leading-relaxed">
        {plan.interval === 'year'
          ? 'One payment for a year of full access — best for active users and small businesses.'
          : 'Cancel any time. Access stays active until the end of the billing period.'}
      </p>
      <Button
        block
        className="mt-5"
        variant={recommended ? 'primary' : 'secondary'}
        loading={busy}
        loadingLabel="Starting…"
        onClick={() => onChoose(plan)}
      >
        {`Choose ${plan.interval === 'year' ? 'Annual' : 'Monthly'}`}
      </Button>
    </TiltCard>
  );
};

const ManualPayCard = ({ details, onClose }) => {
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmError, setConfirmError] = useState('');

  const onConfirm = async () => {
    setConfirming(true);
    setConfirmError('');
    try {
      await requestPaymentConfirmation(details.payment_id);
      setConfirmed(true);
      toast.success("We'll verify your payment and activate Pro shortly.", { title: 'Confirmation requested' });
    } catch (err) {
      setConfirmError(err.message || "Couldn't request confirmation — please try again.");
      toast.error(err.message || 'Please try again.', { title: "Couldn't request confirmation" });
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="card-soft p-4 sm:p-6 border border-accent/30 bg-accent/5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <Eyebrow>Pending payment · #{details.payment_id}</Eyebrow>
          <h3 className="mt-2 text-base font-semibold tracking-tight break-words">
            {fmtMoney(details.amount, details.currency)} · {details.plan === 'pro_yearly' ? 'Annual' : 'Monthly'}
          </h3>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-4 text-txt-2 flex-shrink-0">
          <Icon name="x" size={16} />
        </button>
      </div>
      <p className="text-xs sm:text-sm text-txt-2 leading-relaxed break-words">{details.instructions}</p>
      <div className="mt-4">
        <button
          onClick={onConfirm}
          disabled={confirming || confirmed}
          className="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent/90 transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {confirmed
            ? 'Confirmation requested — check your email'
            : confirming
              ? 'Requesting confirmation…'
              : 'I have paid'}
        </button>
        {confirmed && (
          <p className="mt-2 text-xs text-txt-2 leading-relaxed">
            Thanks — we'll email you the moment your payment is verified. You can close this page; the upgrade screen will clear automatically once Pro is active.
          </p>
        )}
        {confirmError && (
          <p className="mt-2 text-xs text-dng leading-relaxed">{confirmError}</p>
        )}
      </div>
    </div>
  );
};

const UpgradePage = () => {
  const { user } = useAuth();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyPlan, setBusyPlan] = useState(null);
  const [pending, setPending] = useState(null);

  const load = async () => {
    try {
      setError('');
      const data = await fetchBillingStatus();
      setStatus(data);
      // Refresh /me so the cached subscription matches what /billing/status saw.
      try { await fetchMe(); } catch { /* ignore */ }
    } catch (err) {
      setError(err.message || 'Could not load subscription details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Handle Stripe success redirect (?status=success). Read the real query
  // string (path routing); fall back to a legacy hash query for old links.
  useEffect(() => {
    const search = window.location.search.slice(1) || window.location.hash.split('?')[1] || '';
    if (search.includes('status=success')) {
      // Clear the query so a refresh doesn't re-trigger, keeping the clean path.
      window.history.replaceState(null, '', window.location.pathname);
      load();
    }
  }, []);

  const choose = async (plan) => {
    setBusyPlan(plan.id);
    setError('');
    try {
      const data = await startCheckout(plan.id);
      if (data?.provider === 'stripe' && data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }
      // Manual mode — show the payout instructions inline.
      setPending(data);
    } catch (err) {
      setError(err.message || 'Could not start checkout.');
      toast.error(err.message || 'Could not start checkout.', { title: 'Checkout failed' });
    } finally {
      setBusyPlan(null);
    }
  };

  const cancel = async () => {
    if (!window.confirm('Cancel Pro? You will lose access at the end of your current period — actually, immediately on this build.')) return;
    try {
      await cancelSubscription();
      await load();
      /* Cancelling a subscription is a billing change; it must never complete
         without telling the user it did (§65). */
      toast.success('Your Pro subscription has been cancelled.', { title: 'Subscription cancelled' });
    } catch (err) {
      setError(err.message || 'Could not cancel subscription.');
      toast.error(err.message || 'Could not cancel subscription.', { title: 'Cancellation failed' });
    }
  };

  const subscription = status?.subscription || user?.subscription;
  const plans = status?.plans || [];

  return (
    <AppShell>
      <div className="space-y-5 sm:space-y-7 max-w-4xl mx-auto">
        <div>
          <Eyebrow num="00">Plans</Eyebrow>
          <h1 className="mt-2 text-xl sm:text-2xl lg:text-3xl font-semibold tracking-tight">Upgrade to PesaLens Pro</h1>
          <p className="text-xs sm:text-sm text-txt-2 mt-1.5 leading-relaxed max-w-2xl break-words">
            Your free trial covers the full product. After 14 days, Pro keeps the AI advisor, statement extraction,
            receipts and live markets running. Cancel any time — your data stays.
          </p>
        </div>

        {error && (
          <div className="card-soft p-3 sm:p-4 border border-dng/30 bg-dng/5 text-xs sm:text-sm text-dng break-words">
            {error}
          </div>
        )}

        {/* Skeleton matches StatusCard's shape rather than announcing the wait in
            words (§81–83). Prices must never render a placeholder value. */}
        {loading ? (
          <div className="bento p-5 sm:p-6 space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-full max-w-sm" />
          </div>
        ) : (
          <StatusCard subscription={subscription} />
        )}

        {pending && pending.provider === 'manual' && (
          <ManualPayCard details={pending} onClose={() => setPending(null)} />
        )}

        <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              busy={busyPlan === plan.id}
              recommended={plan.id === 'pro_yearly'}
              onChoose={choose}
            />
          ))}
        </div>

        <div className="bento p-3 sm:p-5 lg:p-6">
          <Eyebrow>What's included</Eyebrow>
          <h3 className="mt-2 mb-4 text-sm sm:text-base font-semibold tracking-tight">Every Pro feature, in every plan</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex gap-3 items-start bg-surface-4/40 border border-bdr/40 rounded-xl p-3 sm:p-4">
                <div className="p-2 rounded-lg bg-accent/10 text-accent flex-shrink-0">
                  <Icon name={f.icon} size={14} />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-txt-1 break-words">{f.title}</h4>
                  <p className="text-xs text-txt-2 mt-1 leading-relaxed break-words">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {subscription?.is_pro && (
          <div className="card-soft p-3 sm:p-5 lg:p-6 border border-bdr/60">
            <h3 className="text-sm font-semibold text-txt-1">Cancel Pro</h3>
            <p className="text-xs sm:text-sm text-txt-2 mt-1 leading-relaxed">
              Cancelling will end your access immediately and stop future renewals. You can resubscribe at any time.
            </p>
            <button
              onClick={cancel}
              className="mt-3 px-4 py-2 rounded-lg border border-dng/40 text-dng text-sm font-medium hover:bg-dng/10 transition"
            >
              Cancel Pro
            </button>
          </div>
        )}

        <p className="text-[11px] text-txt-3 text-center">
          Pricing in {status?.plans?.[0]?.currency || 'TZS'}. VAT not included where applicable.
          Need a custom plan for your business? Email <span className="text-accent">sales@pesalens.com</span>.
        </p>
      </div>
    </AppShell>
  );
};

export default UpgradePage;
