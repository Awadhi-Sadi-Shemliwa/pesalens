import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eyebrow } from "@/components/pl/primitives";
import { CheckCircle2 } from "lucide-react";
// @ts-ignore — JS modules
import { signIn, forgotPassword, resetPassword } from "@/data/api";
// @ts-ignore — JS modules
import { setSession } from "@/data/authStore";
// @ts-ignore — JS modules
import { setUserType } from "@/data/userStore";

type Mode = "signin" | "forgot-email" | "forgot-reset" | "forgot-done";

const SignIn = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reset, setReset] = useState({ code: "", next: "", confirm: "" });

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email || !pass) return setError("Email and password are required.");
    setBusy(true);
    try {
      const data = await signIn({ email: email.trim(), password: pass });
      setSession(data);
      if (data?.user?.account_type) setUserType(data.user.account_type);
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err?.message || "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleForgotSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email) return setError("Enter your email first.");
    setBusy(true);
    try {
      await forgotPassword(email.trim());
      setMode("forgot-reset");
    } catch (err: any) {
      setError(err?.message || "Could not send reset code.");
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!reset.code) return setError("Enter the 6-digit code from your email.");
    if (reset.next.length < 8) return setError("New password must be at least 8 characters.");
    if (!/[A-Za-z]/.test(reset.next) || !/\d/.test(reset.next))
      return setError("New password must contain a letter and a number.");
    if (reset.next !== reset.confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      await resetPassword({
        email: email.trim(),
        code: reset.code.trim(),
        newPassword: reset.next,
      });
      setMode("forgot-done");
    } catch (err: any) {
      setError(err?.message || "Could not reset password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-deep flex justify-center">
      <div
        className="w-full max-w-[440px] min-h-screen px-5 flex flex-col"
        style={{
          paddingTop: "max(2.5rem, var(--safe-top))",
          paddingBottom: "max(2.5rem, var(--safe-bottom))",
        }}
      >
        <div className="flex items-center gap-2.5 mb-12">
          <div className="w-9 h-9 rounded-lg bg-gradient-accent flex items-center justify-center font-mono-tab text-[15px] font-bold text-white">
            P
          </div>
          <div>
            <div className="text-[16px] font-bold leading-tight">PesaLens</div>
            <div className="text-[10px] font-mono-tab text-txt-3 tracking-ticker uppercase">Tanzania · TZS</div>
          </div>
        </div>

        {mode === "signin" && (
          <>
            <Eyebrow>Welcome back</Eyebrow>
            <h1 className="text-[28px] font-bold tracking-tight mt-2 mb-1">Sign in to PesaLens</h1>
            <p className="text-[13px] text-txt-3 mb-8">Pick up where you left off — your statements, KPIs, and AI assistant are waiting.</p>

            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-txt-2 mb-1.5">Email</label>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-surface-3 border border-border rounded-xl px-4 py-3 text-[14px] text-txt-1 placeholder:text-txt-4 focus:border-accent/50 outline-none"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[12px] font-medium text-txt-2">Password</label>
                  <button
                    type="button"
                    onClick={() => { setError(""); setMode("forgot-email"); }}
                    className="text-[11px] text-accent font-semibold"
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  minLength={8}
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-surface-3 border border-border rounded-xl px-4 py-3 text-[14px] text-txt-1 placeholder:text-txt-4 focus:border-accent/50 outline-none"
                />
              </div>
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
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>

            <p className="text-center text-[13px] text-txt-2 mt-6">
              New to PesaLens?{" "}
              <Link to="/signup" className="text-accent font-semibold">
                Create an account
              </Link>
            </p>
            <p className="text-center text-[11px] text-txt-3 mt-3 font-mono-tab">
              Backend unreachable?{" "}
              <Link to="/backend" className="text-accent">
                Configure server
              </Link>
            </p>
          </>
        )}

        {mode === "forgot-email" && (
          <>
            <Eyebrow>Reset password</Eyebrow>
            <h1 className="text-[26px] font-bold tracking-tight mt-2 mb-1">Forgot your password?</h1>
            <p className="text-[13px] text-txt-3 mb-6">
              Enter your email and we'll send a 6-digit code to reset it.
            </p>
            <form onSubmit={handleForgotSend} className="space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-txt-2 mb-1.5">Email</label>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-surface-3 border border-border rounded-xl px-4 py-3 text-[14px]"
                />
              </div>
              {error && <div role="alert" className="text-[12px] text-dng bg-dng/10 border border-dng/30 rounded-lg px-3 py-2">{error}</div>}
              <button type="submit" disabled={busy}
                      className="w-full bg-gradient-accent text-white py-3 rounded-xl font-semibold text-[14px] disabled:opacity-60">
                {busy ? "Sending…" : "Send reset code"}
              </button>
              <button type="button" onClick={() => { setError(""); setMode("signin"); }}
                      className="w-full text-[13px] text-txt-3 py-2">
                Back to sign in
              </button>
            </form>
          </>
        )}

        {mode === "forgot-reset" && (
          <>
            <Eyebrow>Reset password</Eyebrow>
            <h1 className="text-[26px] font-bold tracking-tight mt-2 mb-1">Enter the code</h1>
            <p className="text-[13px] text-txt-3 mb-6">
              We've emailed a 6-digit code to <span className="text-txt-1 font-semibold">{email}</span>. It expires in 15 minutes.
            </p>
            <form onSubmit={handleReset} className="space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-txt-2 mb-1.5">6-digit code</label>
                <input
                  inputMode="numeric"
                  maxLength={8}
                  value={reset.code}
                  onChange={(e) => setReset((p) => ({ ...p, code: e.target.value }))}
                  placeholder="123456"
                  className="w-full bg-surface-3 border border-border rounded-xl px-4 py-3 text-[14px] font-mono-tab tracking-widest"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-txt-2 mb-1.5">New password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  required minLength={8}
                  value={reset.next}
                  onChange={(e) => setReset((p) => ({ ...p, next: e.target.value }))}
                  className="w-full bg-surface-3 border border-border rounded-xl px-4 py-3 text-[14px]"
                />
                <p className="text-[10px] text-txt-3 mt-1">8+ chars · letter + number.</p>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-txt-2 mb-1.5">Confirm new password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  required minLength={8}
                  value={reset.confirm}
                  onChange={(e) => setReset((p) => ({ ...p, confirm: e.target.value }))}
                  className="w-full bg-surface-3 border border-border rounded-xl px-4 py-3 text-[14px]"
                />
              </div>
              {error && <div role="alert" className="text-[12px] text-dng bg-dng/10 border border-dng/30 rounded-lg px-3 py-2">{error}</div>}
              <button type="submit" disabled={busy}
                      className="w-full bg-gradient-accent text-white py-3 rounded-xl font-semibold text-[14px] disabled:opacity-60">
                {busy ? "Resetting…" : "Reset password"}
              </button>
              <button type="button" onClick={() => { setError(""); setMode("forgot-email"); }}
                      className="w-full text-[13px] text-txt-3 py-2">
                Use a different email
              </button>
            </form>
          </>
        )}

        {mode === "forgot-done" && (
          <div className="space-y-5">
            <div className="w-12 h-12 rounded-2xl bg-inc/15 border border-inc/30 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-inc" />
            </div>
            <h1 className="text-[26px] font-bold tracking-tight">Password reset</h1>
            <p className="text-[13px] text-txt-2 leading-relaxed">
              Your password has been updated. Sign in with the new one.
            </p>
            <button onClick={() => { setMode("signin"); setPass(""); setError(""); }}
                    className="w-full bg-gradient-accent text-white py-3 rounded-xl font-semibold text-[14px]">
              Continue to sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SignIn;
