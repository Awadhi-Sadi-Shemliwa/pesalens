import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Eyebrow, OtpInput, PasswordField, useCooldown } from "@/components/pl/primitives";
import { CheckCircle2 } from "lucide-react";
import { passwordRulesMet } from "@/data/password";
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
  const [codeError, setCodeError] = useState(false);
  const [resendLeft, startResendCooldown] = useCooldown(30);

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
      startResendCooldown(); // throttle resend from the moment the code is sent (#7)
    } catch (err: any) {
      setError(err?.message || "Could not send reset code.");
    } finally {
      setBusy(false);
    }
  };

  const resendCode = async () => {
    if (resendLeft > 0 || busy) return;
    setError("");
    try {
      await forgotPassword(email.trim());
      startResendCooldown();
    } catch (err: any) {
      setError(err?.message || "Could not resend the code.");
    }
  };

  // Same predicate the PasswordField checklist renders, so the button and the
  // checklist can never disagree (password-field.md #4).
  const resetMatch = reset.confirm.length > 0 && reset.next === reset.confirm;
  const resetAllOk = passwordRulesMet(reset.next) && resetMatch && reset.code.trim().length > 0;

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCodeError(false);
    if (!reset.code) return setError("Enter the 6-digit code from your email.");
    if (!passwordRulesMet(reset.next))
      return setError("New password must be 8+ characters and contain a letter and a number.");
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
      const msg = err?.message || "Could not reset password.";
      setError(msg);
      // A rejected code shakes, clears and refocuses box one (otp-input.md #8).
      if (/code|otp|invalid|expired/i.test(msg)) { setCodeError(true); window.setTimeout(() => setCodeError(false), 500); }
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
          <div className="w-9 h-9 rounded-lg bg-gradient-accent flex items-center justify-center font-mono-tab text-[15px] font-bold text-primary-foreground">
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
                  className="w-full bg-surface-3 border border-border rounded-xl px-4 py-3 text-[14px] text-txt-1 placeholder:text-txt-4 focus-ring"
                />
              </div>
              {/* An existing password gets the reveal toggle but no meter or checklist —
                  scoring a secret the user already owns would only nag (#8). */}
              <PasswordField
                label="Password"
                labelAction={
                  <button
                    type="button"
                    onClick={() => { setError(""); setMode("forgot-email"); }}
                    className="text-[11px] text-accent font-semibold"
                  >
                    Forgot password?
                  </button>
                }
                autoComplete="current-password"
                value={pass}
                onChange={setPass}
                placeholder="••••••••"
                disabled={busy}
              />
              {error && (
                <div role="alert" className="text-[12px] text-dng bg-dng/10 border border-dng/30 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
              <Button type="submit" block size="lg" disabled={!email.trim() || !pass} loading={busy} loadingLabel="Signing in…">
                Sign in
              </Button>
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
              <Button type="submit" block size="lg" loading={busy} loadingLabel="Sending…">
                Send reset code
              </Button>
              <Button variant="ghost" block onClick={() => { setError(""); setMode("signin"); }}>
                Back to sign in
              </Button>
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
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[12px] font-medium text-txt-2">6-digit code</label>
                  <button
                    type="button"
                    onClick={resendCode}
                    disabled={resendLeft > 0 || busy}
                    className="focus-ring rounded text-[12px] font-semibold text-accent disabled:text-txt-3"
                  >
                    {resendLeft > 0 ? `Resend in ${resendLeft}s` : "Resend code"}
                  </button>
                </div>
                <OtpInput
                  value={reset.code}
                  onChange={(v) => setReset((p) => ({ ...p, code: v }))}
                  error={codeError}
                  disabled={busy}
                  autoFocus
                />
              </div>
              <PasswordField
                label="New password"
                value={reset.next}
                onChange={(v) => setReset((p) => ({ ...p, next: v }))}
                helper="Length beats symbols — a few unrelated words is stronger than one decorated one."
                showStrength
                showRules
                disabled={busy}
              />
              <PasswordField
                label="Confirm new password"
                value={reset.confirm}
                onChange={(v) => setReset((p) => ({ ...p, confirm: v }))}
                success={resetMatch}
                successMessage="Passwords match."
                error={reset.confirm.length > 0 && !resetMatch ? "Passwords don't match yet." : null}
                disabled={busy}
              />
              {error && <div role="alert" className="text-[12px] text-dng bg-dng/10 border border-dng/30 rounded-lg px-3 py-2">{error}</div>}
              {/* Submit stays inert until every rule has flipped (password-field.md #4). */}
              <Button type="submit" block size="lg" disabled={!resetAllOk} loading={busy} loadingLabel="Resetting…">
                Reset password
              </Button>
              <Button variant="ghost" block onClick={() => { setError(""); setMode("forgot-email"); }}>
                Use a different email
              </Button>
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
            <Button block size="lg" onClick={() => { setMode("signin"); setPass(""); setError(""); }}>
              Continue to sign in
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SignIn;
