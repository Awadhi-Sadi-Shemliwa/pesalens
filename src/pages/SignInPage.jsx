import React, { useState } from 'react';
import { Link, useRouter } from '../components/Router';
import { Icon } from '../components/Icon';
import { Mark, Eyebrow } from '../components/common';
import { setUserType } from '../data/userStore';
import { setSession } from '../data/authStore';
import { signIn, forgotPassword, resetPassword } from '../data/api';
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
      navigate('/dashboard');
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
    } catch (err) {
      setError(err?.message || 'Could not send reset code.');
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (event) => {
    event.preventDefault();
    setError('');
    if (!resetForm.code) return setError('Enter the 6-digit code from your email.');
    if (resetForm.next.length < 8) return setError('New password must be at least 8 characters.');
    if (!/[A-Za-z]/.test(resetForm.next) || !/\d/.test(resetForm.next))
      return setError('New password must contain a letter and a number.');
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
      setError(err?.message || 'Could not reset password.');
    } finally {
      setBusy(false);
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
              <button
                type="submit"
                disabled={busy}
                className="w-full btn-primary py-3 rounded-xl font-semibold text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {busy ? 'Signing in…' : t('auth.signinBtn')}
              </button>
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
              <button type="submit" disabled={busy}
                      className="w-full btn-primary py-3 rounded-xl font-semibold text-sm disabled:opacity-60">
                {busy ? 'Sending…' : 'Send reset code'}
              </button>
              <button type="button" onClick={() => { setError(''); setMode('signin'); }}
                      className="w-full text-sm text-txt-2 hover:text-txt-1 py-2">
                Back to sign in
              </button>
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
                <label className="block text-sm font-medium text-txt-2 mb-1.5">6-digit code</label>
                <input
                  inputMode="numeric"
                  maxLength={8}
                  value={resetForm.code}
                  onChange={(e) => setResetForm((p) => ({ ...p, code: e.target.value }))}
                  placeholder="123456"
                  className="w-full bg-surface-3 border border-bdr rounded-xl px-4 py-3 text-sm font-mono tracking-widest"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-txt-2 mb-1.5">New password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  required minLength={8}
                  value={resetForm.next}
                  onChange={(e) => setResetForm((p) => ({ ...p, next: e.target.value }))}
                  className="w-full bg-surface-3 border border-bdr rounded-xl px-4 py-3 text-sm"
                />
                <p className="text-[11px] text-txt-3 mt-1">8+ chars · letter + number.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-txt-2 mb-1.5">Confirm new password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  required minLength={8}
                  value={resetForm.confirm}
                  onChange={(e) => setResetForm((p) => ({ ...p, confirm: e.target.value }))}
                  className="w-full bg-surface-3 border border-bdr rounded-xl px-4 py-3 text-sm"
                />
              </div>
              {error ? <div role="alert" className="text-sm text-dng bg-dng/10 border border-dng/30 rounded-lg px-3 py-2">{error}</div> : null}
              <button type="submit" disabled={busy}
                      className="w-full btn-primary py-3 rounded-xl font-semibold text-sm disabled:opacity-60">
                {busy ? 'Resetting…' : 'Reset password'}
              </button>
              <button type="button" onClick={() => { setError(''); setMode('forgot-email'); }}
                      className="w-full text-sm text-txt-2 hover:text-txt-1 py-2">
                Use a different email
              </button>
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
            <button onClick={() => { setMode('signin'); setPass(''); setError(''); }}
                    className="mt-7 w-full btn-primary py-3 rounded-xl font-semibold text-sm">
              Continue to sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SignInPage;
