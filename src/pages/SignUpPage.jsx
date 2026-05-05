import React, { useState } from 'react';
import { Link, useRouter } from '../components/Router';
import { Icon } from '../components/Icon';
import { Mark, Eyebrow } from '../components/common';
import { setUserType } from '../data/userStore';
import { signUp } from '../data/api';
import { useT } from '../data/i18n';

const SignUpPage = () => {
  const { navigate } = useRouter();
  const { t } = useT();
  const [form, setForm] = useState({ name: '', email: '', type: 'individual', terms: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');

  const setValue = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleCreate = async (event) => {
    event.preventDefault();
    setError('');

    if (!form.email) {
      setError('Email is required.');
      return;
    }
    if (!form.terms) {
      setError('Please accept the Terms of Service to continue.');
      return;
    }

    setBusy(true);
    try {
      await signUp({
        email: form.email.trim(),
        full_name: form.name.trim() || null,
        account_type: form.type,
      });
      // Remember the chosen account type locally so the next session
      // lands on the right home page after the user signs in.
      setUserType(form.type);
      setSentTo(form.email.trim());
    } catch (err) {
      setError(err?.message || 'Could not create account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-deep flex">
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden flex-col justify-between p-12 surface-hero">
        <div className="absolute inset-0 grid-faint opacity-50 pointer-events-none" />
        <div className="hero-glow bg-net" style={{ top: '20%', left: '10%' }} />
        <div className="hero-glow bg-accent" style={{ top: '55%', left: '55%', opacity: 0.10 }} />
        <div className="relative z-10">
          <Link to="/"><Mark size={36} /></Link>
          <div className="mt-20">
            <Eyebrow num="01">{t('auth.signup.eyebrow')}</Eyebrow>
            <h1 className="mt-5 text-4xl xl:text-5xl font-semibold tracking-tightest leading-[1.05]">
              {t('auth.signup.title.l1')}<br />
              <span className="font-serif-i text-txt-2">{t('auth.signup.title.l2')}</span> {t('auth.signup.title.l3')}
            </h1>
            <p className="mt-5 text-txt-2 max-w-md leading-relaxed">
              {t('auth.signup.lede')}
            </p>
          </div>
          <div className="mt-10 grid gap-3 max-w-sm">
            {[
              [t('an.title'),         t('land.step.2.desc')],
              [t('ai.title'),         t('land.step.3.desc')],
              [t('bk.receipts.title'),t('bk.tagline')],
            ].map(([h, d]) => (
              <div key={h} className="flex items-start gap-3">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                <div>
                  <div className="text-sm text-txt-1 font-medium">{h}</div>
                  <div className="text-xs text-txt-3 leading-relaxed">{d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative z-10 flex items-center gap-3 text-xs text-txt-3">
          <Icon name="shield" size={14} className="text-inc" />
          <span>You can delete your account and all data at any time.</span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        {sentTo ? (
          <div className="w-full max-w-md">
            <div className="lg:hidden mb-10"><Mark size={32} /></div>
            <div className="w-12 h-12 rounded-2xl bg-inc/15 border border-inc/30 flex items-center justify-center mb-5">
              <Icon name="mail" size={20} className="text-inc" />
            </div>
            <h2 className="text-3xl font-semibold tracking-tight mb-2">Check your email</h2>
            <p className="text-txt-2 leading-relaxed">
              We've sent a temporary password to{' '}
              <span className="text-txt-1 font-medium">{sentTo}</span>.
              Use it to sign in for the first time — that confirms your email
              is real and unlocks your account. You can change the password
              from Settings any time after.
            </p>
            <ul className="mt-5 space-y-2 text-xs text-txt-3 list-disc pl-4">
              <li>Email can take up to a minute. Check your Spam / Promotions folder if it's missing.</li>
              <li>Didn't receive it? You can request a new password from the sign-in screen.</li>
            </ul>
            <button
              onClick={() => navigate('/signin')}
              className="mt-7 w-full btn-primary py-3 rounded-xl font-semibold text-sm"
            >
              Continue to sign in
            </button>
            <p className="text-center text-sm text-txt-2 mt-6">
              Wrong email?{' '}
              <button
                onClick={() => { setSentTo(''); setForm((p) => ({ ...p, email: '' })); }}
                className="text-accent hover:text-accent-hover font-medium transition"
              >
                Start over
              </button>
            </p>
          </div>
        ) : (
          <form onSubmit={handleCreate} className="w-full max-w-md">
            <div className="lg:hidden mb-10"><Mark size={32} /></div>
            <Eyebrow>{t('land.cta.eyebrow')}</Eyebrow>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight mb-1">{t('auth.signup.heading')}</h2>
            <p className="text-txt-2 mb-8">
              We'll email you a one-time password to get in. No password to choose now —
              you can change it after signing in.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-txt-2 mb-1.5">{t('auth.fullName')}</label>
                <input
                  value={form.name}
                  onChange={(event) => setValue('name', event.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                  maxLength={120}
                  className="w-full bg-surface-3 border border-bdr rounded-xl px-4 py-3 text-sm text-txt-1 placeholder-txt-3"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-txt-2 mb-1.5">{t('auth.email')}</label>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={form.email}
                  onChange={(event) => setValue('email', event.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-surface-3 border border-bdr rounded-xl px-4 py-3 text-sm text-txt-1 placeholder-txt-3"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-txt-2 mb-2">{t('auth.accountType')}</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { k: 'individual', l: t('auth.accountType.personal'), sub: t('auth.accountType.personalSub'), icon: 'wallet' },
                    { k: 'business',   l: t('auth.accountType.vendor'),   sub: t('auth.accountType.vendorSub'),   icon: 'book' },
                  ].map((option) => (
                    <button
                      key={option.k}
                      type="button"
                      onClick={() => setValue('type', option.k)}
                      className={`p-3 rounded-xl text-left border transition ${
                        form.type === option.k ? 'bg-accent/10 border-accent/30 text-accent' : 'bg-surface-3 border-bdr text-txt-2 hover:bg-surface-4'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Icon name={option.icon} size={14} />
                        <span className="text-sm font-semibold">{option.l}</span>
                      </div>
                      <p className="text-xs text-txt-3 leading-snug">{option.sub}</p>
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-start gap-2 text-xs text-txt-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.terms}
                  onChange={(event) => setValue('terms', event.target.checked)}
                  className="rounded border-bdr bg-surface-3 text-accent mt-0.5"
                />
                <span>{t('auth.terms')}</span>
              </label>
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
                {busy ? 'Sending email…' : 'Email me a sign-in password'}
              </button>
            </div>
            <p className="text-center text-sm text-txt-2 mt-6">
              {t('auth.haveAccount')}{' '}
              <Link to="/signin" className="text-accent hover:text-accent-hover font-medium transition">
                {t('nav.signin')}
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
};

export default SignUpPage;
