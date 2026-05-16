import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eyebrow } from "@/components/pl/primitives";
import { ArrowLeft, Wallet, Briefcase, MailCheck } from "lucide-react";
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

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.email) return setError("Email is required.");
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
            <img src="/logo.svg" alt="PesaLens" width={36} height={36} className="w-full h-full object-contain p-[2px]" />
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
            <button
              onClick={() => navigate("/signin", { replace: true })}
              className="w-full bg-gradient-accent text-white py-3 rounded-xl font-semibold text-[14px]"
            >
              Continue to sign in
            </button>
            <button
              onClick={() => { setSentTo(""); setForm((p) => ({ ...p, email: "" })); }}
              className="w-full text-[13px] text-txt-3 py-2"
            >
              Wrong email? Start over
            </button>
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
                  className="w-full bg-surface-3 border border-border rounded-xl px-4 py-3 text-[14px] text-txt-1 placeholder:text-txt-4 outline-none"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-txt-2 mb-1.5">Email</label>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-surface-3 border border-border rounded-xl px-4 py-3 text-[14px] text-txt-1 placeholder:text-txt-4 outline-none"
                />
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

              <button
                type="submit"
                disabled={busy}
                className="w-full bg-gradient-accent text-white py-3 rounded-xl font-semibold text-[14px] disabled:opacity-60"
              >
                {busy ? "Sending email…" : "Email me a sign-in password"}
              </button>
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
