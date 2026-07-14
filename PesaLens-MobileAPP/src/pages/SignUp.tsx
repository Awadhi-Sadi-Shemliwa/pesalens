import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Eyebrow } from "@/components/pl/primitives";
import { ArrowLeft, Wallet, Briefcase, MailCheck, AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
// @ts-ignore — JS modules
import { signUp } from "@/data/api";
// @ts-ignore — JS modules
import { setUserType } from "@/data/userStore";

type Type = "individual" | "business";

const SignUp = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    email: "",
    type: "individual" as Type,
    terms: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");

  const set = (k: keyof typeof form, v: any) => setForm((p) => ({ ...p, [k]: v }));

  /* Validate on BLUR, not per keystroke (§71): the error only appears once the
     user has finished the field and got it wrong (§74). Submit is gated so they
     reach an all-clear state before they ever commit (password-field.md #4). */
  const [emailTouched, setEmailTouched] = useState(false);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const showEmailError = emailTouched && form.email.trim().length > 0 && !emailValid;
  const canSubmit = emailValid && form.terms && !busy;

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!emailValid) return setError("Enter a valid email address.");
    if (!form.terms) return setError("Please accept the Terms to continue.");

    setBusy(true);
    try {
      await signUp({
        email: form.email.trim(),
        full_name: form.name.trim() || null,
        account_type: form.type,
      });
      setUserType(form.type);
      setSentTo(form.email.trim());
    } catch (err: any) {
      setError(err?.message || "Could not create account.");
    } finally {
      setBusy(false);
    }
  };

  const types: { id: Type; label: string; sub: string; icon: any }[] = [
    { id: "individual", label: "Personal", sub: "Statements + receipts for me", icon: Wallet },
    { id: "business", label: "Business", sub: "Books, P&L, vendor receipts", icon: Briefcase },
  ];

  return (
    <div className="min-h-screen bg-deep flex justify-center">
      <div
        className="w-full max-w-[440px] min-h-screen px-5 flex flex-col"
        style={{
          paddingTop: "max(2.5rem, var(--safe-top))",
          paddingBottom: "max(2.5rem, var(--safe-bottom))",
        }}
      >
        <Link
          to="/"
          aria-label="Back to home"
          className="self-start -ml-1 mb-4 inline-flex items-center gap-1 text-[12px] font-medium text-txt-3 hover:text-txt-1 px-2 py-1.5 rounded-md ios-press"
        >
          <ArrowLeft className="w-4 h-4" />
          Home
        </Link>

        <div className="flex items-center gap-2.5 mb-10">
          <div className="w-9 h-9 rounded-lg overflow-hidden bg-surface-2 border border-border/60 flex items-center justify-center">
            <img src="/logo.png" alt="PesaLens" width={36} height={36} className="w-full h-full object-cover" />
          </div>
          <div>
            <div className="text-[16px] font-bold leading-tight" data-no-translate>PesaLens</div>
            <div className="text-[10px] font-mono-tab text-txt-3 tracking-ticker uppercase">Tanzania · TZS</div>
          </div>
        </div>

        {sentTo ? (
          <div className="space-y-5">
            <div className="w-12 h-12 rounded-2xl bg-inc/15 border border-inc/30 flex items-center justify-center">
              <MailCheck className="w-5 h-5 text-inc" />
            </div>
            <h1 className="text-[26px] font-bold tracking-tight">Check your email</h1>
            <p className="text-[13px] text-txt-2 leading-relaxed">
              We've sent a temporary password to{" "}
              <span className="text-txt-1 font-semibold">{sentTo}</span>.
              Sign in with it to verify your email and unlock your account. You can change
              the password from Profile any time after.
            </p>
            <ul className="text-[12px] text-txt-3 space-y-1.5 list-disc pl-4">
              <li>Email can take up to a minute. Check Spam / Promotions if it's missing.</li>
              <li>Lost the email? Use "Forgot password" on the sign-in screen.</li>
            </ul>
            <Button block size="lg" onClick={() => navigate("/signin", { replace: true })}>
              Continue to sign in
            </Button>
            <Button variant="ghost" block onClick={() => { setSentTo(""); setForm((p) => ({ ...p, email: "" })); }}>
              Wrong email? Start over
            </Button>
          </div>
        ) : (
          <>
            <Eyebrow>Create account</Eyebrow>
            <h1 className="text-[26px] font-bold tracking-tight mt-2 mb-1">Start your 14-day Pro trial</h1>
            <p className="text-[13px] text-txt-3 mb-6">
              No password to choose now — we'll email you a one-time password to sign in with.
              You can change it from Profile after your first sign-in.
            </p>

            <form onSubmit={handle} className="space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-txt-2 mb-1.5">Full name</label>
                <input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  autoComplete="name"
                  maxLength={120}
                  placeholder="Your name"
                  className="w-full bg-surface-3 border border-border rounded-xl px-4 py-3 text-[14px] text-txt-1 placeholder:text-txt-4 focus-ring"
                />
              </div>
              <div>
                <label htmlFor="signup-email" className="block text-[12px] font-medium text-txt-2 mb-1.5">Email</label>
                <div className="relative">
                  <input
                    id="signup-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    onBlur={() => setEmailTouched(true)}
                    aria-invalid={showEmailError}
                    placeholder="you@example.com"
                    className={cn(
                      "w-full bg-surface-3 border rounded-xl px-4 py-3 pr-10 text-[14px] text-txt-1 placeholder:text-txt-4 focus-ring transition-colors",
                      showEmailError ? "border-dng/60" : emailValid && form.email ? "border-inc/50" : "border-border"
                    )}
                  />
                  {/* Colour alone is invisible to ~12% of users — pair it with an icon
                      and a message (form-fields.md #4–5). */}
                  <span className="absolute inset-y-0 right-3 flex items-center">
                    {showEmailError && <AlertTriangle className="w-4 h-4 text-dng" />}
                    {!showEmailError && emailValid && form.email && <Check className="w-4 h-4 text-inc" />}
                  </span>
                </div>
                {showEmailError && (
                  <p className="mt-1.5 text-[11px] text-dng">Enter a valid email address (name@example.com).</p>
                )}
              </div>

              <div>
                <label className="block text-[12px] font-medium text-txt-2 mb-2">Account type</label>
                <div className="grid grid-cols-2 gap-3">
                  {types.map((t) => {
                    const Icon = t.icon;
                    const active = form.type === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => set("type", t.id)}
                        className={`p-3 rounded-xl text-left border transition ${
                          active ? "bg-accent/10 border-accent/40 text-accent" : "bg-surface-3 border-border text-txt-2"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className="w-4 h-4" />
                          <span className="text-[13px] font-semibold">{t.label}</span>
                        </div>
                        <p className="text-[11px] text-txt-3 leading-snug">{t.sub}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="flex items-start gap-2 text-[12px] text-txt-3">
                <input
                  type="checkbox"
                  checked={form.terms}
                  onChange={(e) => set("terms", e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I have read and agree to the{" "}
                  <Link to="/terms" className="text-accent font-semibold underline-offset-2 hover:underline">
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link to="/privacy" className="text-accent font-semibold underline-offset-2 hover:underline">
                    Privacy Policy
                  </Link>
                  , and acknowledge that PesaLens is informational only and not financial,
                  investment, tax, or legal advice.
                </span>
              </label>

              {error && (
                <div role="alert" className="text-[12px] text-dng bg-dng/10 border border-dng/30 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <Button type="submit" block size="lg" disabled={!canSubmit} loading={busy} loadingLabel="Sending email…">
                Email me a sign-in password
              </Button>
            </form>

            <p className="text-center text-[13px] text-txt-2 mt-6">
              Already have an account?{" "}
              <Link to="/signin" className="text-accent font-semibold">
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default SignUp;
