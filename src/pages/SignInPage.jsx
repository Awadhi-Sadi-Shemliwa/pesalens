import React, { useState } from 'react';
import { Link, useRouter } from '../components/Router';
import { Icon } from '../components/Icon';
import { Mark, Eyebrow, PasswordField, Button, OtpInput, useCooldown } from '../components/common';
import { setUserType } from '../data/userStore';
import { setSession } from '../data/authStore';
import { signIn, forgotPassword, resetPassword } from '../data/api';
import { passwordRulesMet } from '../data/password';
import { useT } from '../data/i18n';

const SignInPage = () => {
  const { navigate } = useRouter();
  const { t } = useT();
  const [mode, setMode] = useState('signin'); // signin | forgot-email | forgot-reset | forgot-done
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resetForm, setResetForm] = useState({ code: '', next: '', confirm: '' });
  const [codeError, setCodeError] = useState(false);
  const [resendLeft, startResendCooldown] = useCooldown(30);

  const handleSignIn = async (event) => {
    event.preventDefault();
    setError('');
    if (!email || !pass) {
      setError('Email and password are required.');
      return;
    }
    setBusy(true);
    try {
      const data = await signIn({ email: email.trim(), password: pass });
      setSession(data);
      if (data?.user?.account_type) setUserType(data.user.account_type);
      // Replace history so Back from /dashboard never lands the user
      // on a stale /signin form with their email already filled in.
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err?.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleForgotSend = async (event) => {
    event.preventDefault();
    setError('');
    if (!email) {
      setError('Enter your email first.');
      return;
    }
    setBusy(true);
    try {
      await forgotPassword(email.trim());
      setMode('forgot-reset');
      startResendCooldown(); // throttle the resend from the moment the code is sent (#7)
    } catch (err) {
      setError(err?.message || 'Could not send reset code.');
    } finally {
      setBusy(false);
    }
  };

  // Same predicate the PasswordField checklist renders, so the button and the
  // checklist can never disagree (password-field.md #4).
  const resetMatch = resetForm.confirm.length > 0 && resetForm.next === resetForm.confirm;
  const resetAllOk = passwordRulesMet(resetForm.next) && resetMatch && resetForm.code.trim().length > 0;

  const handleReset = async (event) => {
    event.preventDefault();
    setError('');
    setCodeError(false);
    if (!resetForm.code) return setError('Enter the 6-digit code from your email.');
    if (!passwordRulesMet(resetForm.next))
      return setError('New password must be 8+ characters and contain a letter and a number.');
    if (resetForm.next !== resetForm.confirm) return setError('Passwords do not match.');
    setBusy(true);
    try {
      await resetPassword({
        email: email.trim(),
        code: resetForm.code.trim(),
        newPassword: resetForm.next,
      });
      setMode('forgot-done');
    } catch (err) {
      const msg = err?.message || 'Could not reset password.';
      setError(msg);
      // A rejected code shakes, clears and refocuses box one (otp-input.md #8).
      if (/code|otp|invalid|expired/i.test(msg)) { setCodeError(true); setTimeout(() => setCodeError(false), 500); }
    } finally {
      setBusy(false);
    }
  };

  const resendCode = async () => {
    if (resendLeft > 0 || busy) return;
    setError('');
    try {
      await forgotPassword(email.trim());
      startResendCooldown();
    } catch (err) {
      setError(err?.message || 'Could not resend the code.');
    }
  };

  return (
    <div className="min-h-screen bg-deep flex">
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden flex-col justify-between p-12 surface-hero">
        <div className="absolute inset-0 grid-faint opacity-50 pointer-events-none" />
        <div className="hero-glow bg-accent" style={{ top: '15%', left: '20%' }} />
        <div className="hero-glow bg-net" style={{ top: '60%', left: '50%', opacity: 0.10 }} />
        <div className="relative z-10">
          <Link to="/"><Mark size={36} /></Link>
          <div className="mt-20">
            <Eyebrow num="01">{t('auth.signin.eyebrow')}</Eyebrow>
            <h1 className="mt-5 text-4xl xl:text-5xl font-semibold tracking-tightest leading-[1.05]">
              {t('auth.signin.title.l1')}<br />
              <span className="font-serif-i text-txt-2">{t('auth.signin.title.l2')}</span> {t('auth.signin.title.l3')}
            </h1>
            <p className="mt-5 text-txt-2 max-w-md leading-relaxed">
              {t('auth.signin.lede')}
            </p>
          </div>
        </div>
        <div className="relative z-10 flex items-center gap-3 text-xs text-txt-3">
          <Icon name="shield" size={14} className="text-inc" />
          <span>Encrypted in transit when served over HTTPS · Statements never resold</span>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        {mode === 'signin' ? (
          <form onSubmit={handleSignIn} className="w-full max-w-md">
            <div className="lg:hidden mb-10"><Mark size={32} /></div>
            <Eyebrow>{t('nav.signin')}</Eyebrow>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight mb-1">{t('auth.signin.heading')}</h2>
            <p className="text-txt-2 mb-8">{t('auth.signin.sub')}</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-txt-2 mb-1.5">{t('auth.email')}</label>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-surface-3 border border-bdr rounded-xl px-4 py-3 text-sm text-txt-1 placeholder-txt-3 focus:border-accent/50"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-txt-2">{t('auth.password')}</label>
                  <button
                    type="button"
                    onClick={() => { setError(''); setMode('forgot-email'); }}
                    className="text-xs text-accent hover:text-accent-hover font-medium"
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
                  onChange={(event) => setPass(event.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-surface-3 border border-bdr rounded-xl px-4 py-3 text-sm text-txt-1 placeholder-txt-3 focus:border-accent/50"
                />
              </div>
              {error ? (
                <div role="alert" className="text-sm text-dng bg-dng/10 border border-dng/30 rounded-lg px-3 py-2">
                  {error}
                </div>
              ) : null}
              <Button type="submit" block size="lg" loading={busy} loadingLabel="Signing in…">
                {t('auth.signinBtn')}
              </Button>
            </div>
            <p className="text-center text-sm text-txt-2 mt-6">
              {t('auth.noAccount')}{' '}
              <Link to="/signup" className="text-accent hover:text-accent-hover font-medium transition">
                {t('auth.signup')}
              </Link>
            </p>
          </form>
        ) : mode === 'forgot-email' ? (
          <form onSubmit={handleForgotSend} className="w-full max-w-md">
            <div className="lg:hidden mb-10"><Mark size={32} /></div>
            <Eyebrow>Reset password</Eyebrow>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight mb-1">Forgot your password?</h2>
            <p className="text-txt-2 mb-8">
              Enter your email and we'll send a 6-digit code to reset it.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-txt-2 mb-1.5">{t('auth.email')}</label>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-surface-3 border border-bdr rounded-xl px-4 py-3 text-sm"
                />
              </div>
              {error ? <div role="alert" className="text-sm text-dng bg-dng/10 border border-dng/30 rounded-lg px-3 py-2">{error}</div> : null}
              <Button type="submit" block size="lg" loading={busy} loadingLabel="Sending…">
                Send reset code
              </Button>
              <Button variant="ghost" block onClick={() => { setError(''); setMode('signin'); }}>
                Back to sign in
              </Button>
            </div>
          </form>
        ) : mode === 'forgot-reset' ? (
          <form onSubmit={handleReset} className="w-full max-w-md">
            <div className="lg:hidden mb-10"><Mark size={32} /></div>
            <Eyebrow>Reset password</Eyebrow>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight mb-1">Enter the code we sent</h2>
            <p className="text-txt-2 mb-8">
              We've emailed a 6-digit code to <span className="text-txt-1 font-medium">{email}</span>.
              It expires in 15 minutes.
            </p>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-txt-2">6-digit code</label>
                  <button
                    type="button"
                    onClick={resendCode}
                    disabled={resendLeft > 0 || busy}
                    className="focus-ring rounded text-[12px] font-semibold text-accent hover:text-accent-hover disabled:text-txt-3 disabled:cursor-not-allowed"
                  >
                    {resendLeft > 0 ? `Resend in ${resendLeft}s` : 'Resend code'}
                  </button>
                </div>
                <OtpInput
                  value={resetForm.code}
                  onChange={(v) => setResetForm((p) => ({ ...p, code: v }))}
                  error={codeError}
                  disabled={busy}
                  autoFocus
                />
              </div>
              <PasswordField
                label="New password"
                value={resetForm.next}
                onChange={(v) => setResetForm((p) => ({ ...p, next: v }))}
                helper="Length beats symbols — a few unrelated words is stronger than one decorated one."
                showStrength
                showRules
                disabled={busy}
              />
              <PasswordField
                label="Confirm new password"
                value={resetForm.confirm}
                onChange={(v) => setResetForm((p) => ({ ...p, confirm: v }))}
                success={resetMatch}
                successMessage="Passwords match."
                error={resetForm.confirm.length > 0 && !resetMatch ? "Passwords don't match yet." : null}
                disabled={busy}
              />
              {error ? <div role="alert" className="text-sm text-dng bg-dng/10 border border-dng/30 rounded-lg px-3 py-2">{error}</div> : null}
              {/* Submit stays inert until every rule has flipped (password-field.md #4). */}
              <Button type="submit" block size="lg" disabled={!resetAllOk} loading={busy} loadingLabel="Resetting…">
                Reset password
              </Button>
              <Button variant="ghost" block onClick={() => { setError(''); setMode('forgot-email'); }}>
                Use a different email
              </Button>
            </div>
          </form>
        ) : (
          <div className="w-full max-w-md">
            <div className="lg:hidden mb-10"><Mark size={32} /></div>
            <div className="w-12 h-12 rounded-2xl bg-inc/15 border border-inc/30 flex items-center justify-center mb-5">
              <Icon name="check" size={20} className="text-inc" />
            </div>
            <h2 className="text-3xl font-semibold tracking-tight mb-2">Password reset</h2>
            <p className="text-txt-2 leading-relaxed">
              Your password has been updated. Sign in with the new one.
            </p>
            <Button block size="lg" className="mt-7" onClick={() => { setMode('signin'); setPass(''); setError(''); }}>
              Continue to sign in
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SignInPage;
