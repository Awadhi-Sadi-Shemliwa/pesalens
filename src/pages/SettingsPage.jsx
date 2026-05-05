import React, { useEffect, useState } from 'react';
import { useRouter } from '../components/Router';
import { AppShell } from '../components/navigation';
import { Icon } from '../components/Icon';
import { useAuth } from '../data/authStore';
import {
  changePassword,
  confirmVerifyEmail,
  deleteMyAccount,
  exportMyData,
  fetchMe,
  sendVerifyEmail,
  signOut,
} from '../data/api';
import { useT } from '../data/i18n';

const SectionHeader = ({ eyebrow, title, sub }) => (
  <div className="mb-3">
    <div className="font-mono text-[10px] uppercase tracking-ticker text-txt-3">{eyebrow}</div>
    <h3 className="text-base sm:text-lg font-semibold tracking-tight mt-0.5">{title}</h3>
    {sub ? <p className="text-xs text-txt-3 mt-0.5">{sub}</p> : null}
  </div>
);

const Card = ({ children, className = '' }) => (
  <div className={`bg-surface-2 border border-bdr rounded-2xl p-4 sm:p-5 ${className}`}>
    {children}
  </div>
);

const Field = ({ label, children, hint }) => (
  <div className="space-y-1.5">
    <label className="block text-xs font-medium text-txt-2">{label}</label>
    {children}
    {hint ? <p className="text-[11px] text-txt-3">{hint}</p> : null}
  </div>
);

const Banner = ({ tone = 'inc', children }) => {
  const tones = {
    inc: 'border-inc/30 bg-inc/8 text-inc',
    dng: 'border-dng/30 bg-dng/10 text-dng',
    exp: 'border-exp/30 bg-exp/10 text-exp',
  };
  return (
    <div role="status" className={`text-xs border rounded-lg px-3 py-2 ${tones[tone]}`}>
      {children}
    </div>
  );
};

const SettingsPage = () => {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const { t } = useT();

  // Refresh /me so email_verified stays accurate after a verify flow.
  useEffect(() => {
    fetchMe().catch(() => { /* ignore */ });
  }, []);

  // ---------- Change password ----------
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState({ tone: '', text: '' });

  const submitPassword = async (event) => {
    event.preventDefault();
    setPwMsg({ tone: '', text: '' });
    if (pw.next.length < 8) return setPwMsg({ tone: 'dng', text: 'New password must be at least 8 characters.' });
    if (!/[A-Za-z]/.test(pw.next) || !/\d/.test(pw.next))
      return setPwMsg({ tone: 'dng', text: 'New password must contain a letter and a number.' });
    if (pw.next !== pw.confirm) return setPwMsg({ tone: 'dng', text: 'New passwords do not match.' });
    setPwBusy(true);
    try {
      await changePassword({ currentPassword: pw.current, newPassword: pw.next });
      setPwMsg({
        tone: 'inc',
        text: 'Password changed. You will be signed out — please sign in with the new password.',
      });
      setPw({ current: '', next: '', confirm: '' });
      setTimeout(() => signOut().finally(() => navigate('/signin')), 1500);
    } catch (err) {
      setPwMsg({ tone: 'dng', text: err?.message || 'Could not change password.' });
    } finally {
      setPwBusy(false);
    }
  };

  // ---------- Verify email ----------
  const [verifyState, setVerifyState] = useState({ phase: 'idle', code: '', msg: '' });
  const startVerify = async () => {
    setVerifyState({ phase: 'sending', code: '', msg: '' });
    try {
      await sendVerifyEmail();
      setVerifyState({ phase: 'awaiting', code: '', msg: 'Code sent — check your email.' });
    } catch (err) {
      setVerifyState({ phase: 'idle', code: '', msg: err?.message || 'Could not send code.' });
    }
  };
  const submitVerify = async (event) => {
    event.preventDefault();
    setVerifyState((s) => ({ ...s, phase: 'submitting' }));
    try {
      await confirmVerifyEmail(verifyState.code.trim());
      setVerifyState({ phase: 'done', code: '', msg: 'Email verified.' });
      fetchMe().catch(() => {});
    } catch (err) {
      setVerifyState((s) => ({ ...s, phase: 'awaiting', msg: err?.message || 'Invalid or expired code.' }));
    }
  };

  // ---------- Export data ----------
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const downloadExport = async () => {
    setExportBusy(true);
    setExportMsg('');
    try {
      const data = await exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pesalens-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportMsg('Download started.');
    } catch (err) {
      setExportMsg(err?.message || 'Could not export data.');
    } finally {
      setExportBusy(false);
    }
  };

  // ---------- Delete account ----------
  const [delConfirm, setDelConfirm] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState('');
  const deleteAccount = async () => {
    setDelErr('');
    if (delConfirm !== 'DELETE') {
      setDelErr('Type DELETE in capital letters to confirm.');
      return;
    }
    setDelBusy(true);
    try {
      await deleteMyAccount();
      navigate('/signin');
    } catch (err) {
      setDelErr(err?.message || 'Could not delete account.');
    } finally {
      setDelBusy(false);
    }
  };

  // ---------- Sign out ----------
  const handleSignOut = async () => {
    await signOut();
    navigate('/signin');
  };

  const initials = (user?.full_name || user?.email || '?')
    .trim().split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase();

  return (
    <AppShell>
    <div className="max-w-3xl mx-auto px-1 sm:px-2 py-4 sm:py-6 space-y-6">
      <header>
        <div className="font-mono text-[10px] uppercase tracking-ticker text-txt-3">{t('nav.workspace')}</div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mt-1">Settings</h1>
        <p className="text-sm text-txt-3 mt-1">Manage your account, security, and data.</p>
      </header>

      <Card>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent/30 to-net/20 border border-accent/25 flex items-center justify-center text-accent font-bold">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold truncate">{user?.full_name || 'Account'}</div>
            <div className="text-xs text-txt-3 truncate">{user?.email}</div>
          </div>
          {user?.email_verified ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-ticker text-inc bg-inc/10 border border-inc/30 rounded-md px-2 py-1">
              <Icon name="check" size={11} /> Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-ticker text-exp bg-exp/10 border border-exp/30 rounded-md px-2 py-1">
              <Icon name="alert" size={11} /> Unverified
            </span>
          )}
        </div>
      </Card>

      {!user?.email_verified ? (
        <Card>
          <SectionHeader
            eyebrow="01"
            title="Verify your email"
            sub="Required for password-reset emails and to satisfy our payment partners."
          />
          {verifyState.phase === 'idle' ? (
            <button
              onClick={startVerify}
              className="btn-primary text-sm font-semibold px-4 py-2 rounded-lg"
            >
              Send verification code
            </button>
          ) : verifyState.phase === 'sending' ? (
            <p className="text-xs text-txt-3">Sending…</p>
          ) : verifyState.phase === 'done' ? (
            <Banner tone="inc">{verifyState.msg}</Banner>
          ) : (
            <form onSubmit={submitVerify} className="space-y-3">
              <Field label="6-digit code from your email">
                <input
                  inputMode="numeric"
                  maxLength={8}
                  value={verifyState.code}
                  onChange={(e) => setVerifyState((s) => ({ ...s, code: e.target.value }))}
                  placeholder="123456"
                  className="w-full bg-surface-3 border border-bdr rounded-xl px-4 py-3 text-sm text-txt-1 font-mono tracking-widest"
                />
              </Field>
              {verifyState.msg ? <Banner tone="dng">{verifyState.msg}</Banner> : null}
              <div className="flex gap-2">
                <button type="submit" disabled={verifyState.phase === 'submitting'}
                        className="btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
                  {verifyState.phase === 'submitting' ? 'Verifying…' : 'Verify'}
                </button>
                <button type="button" onClick={startVerify}
                        className="text-sm text-txt-2 hover:text-txt-1 px-4 py-2 rounded-lg hover:bg-surface-3">
                  Resend
                </button>
              </div>
            </form>
          )}
        </Card>
      ) : null}

      <Card>
        <SectionHeader
          eyebrow="02"
          title="Change password"
          sub="You'll be signed out and asked to sign in again on this and every other device."
        />
        <form onSubmit={submitPassword} className="space-y-3 max-w-md">
          <Field label="Current password">
            <input type="password" autoComplete="current-password" required
                   value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))}
                   className="w-full bg-surface-3 border border-bdr rounded-xl px-4 py-3 text-sm" />
          </Field>
          <Field label="New password" hint="At least 8 characters · one letter and one number.">
            <input type="password" autoComplete="new-password" required minLength={8}
                   value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))}
                   className="w-full bg-surface-3 border border-bdr rounded-xl px-4 py-3 text-sm" />
          </Field>
          <Field label="Confirm new password">
            <input type="password" autoComplete="new-password" required minLength={8}
                   value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
                   className="w-full bg-surface-3 border border-bdr rounded-xl px-4 py-3 text-sm" />
          </Field>
          {pwMsg.text ? <Banner tone={pwMsg.tone}>{pwMsg.text}</Banner> : null}
          <button type="submit" disabled={pwBusy}
                  className="btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
            {pwBusy ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </Card>

      <Card>
        <SectionHeader
          eyebrow="03"
          title="Export your data"
          sub="A JSON copy of your profile, uploads, ledger entries, and payment history. Yours to keep."
        />
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={downloadExport} disabled={exportBusy}
                  className="btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
            {exportBusy ? 'Preparing…' : 'Download JSON'}
          </button>
          {exportMsg ? <span className="text-xs text-txt-3">{exportMsg}</span> : null}
        </div>
      </Card>

      <Card className="border-dng/30">
        <SectionHeader
          eyebrow="04"
          title={<span className="text-dng">Delete account</span>}
          sub="Removes your account, every uploaded statement, every receipt, and your payment history. Permanent."
        />
        <Field label='Type "DELETE" in capital letters to confirm'>
          <input value={delConfirm} onChange={(e) => setDelConfirm(e.target.value)} placeholder="DELETE"
                 className="w-full bg-surface-3 border border-dng/30 rounded-xl px-4 py-3 text-sm font-mono tracking-widest" />
        </Field>
        {delErr ? <div className="mt-3"><Banner tone="dng">{delErr}</Banner></div> : null}
        <button onClick={deleteAccount} disabled={delBusy || delConfirm !== 'DELETE'}
                className="mt-3 bg-dng text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed hover:bg-dng/90 transition">
          {delBusy ? 'Deleting…' : 'Delete account permanently'}
        </button>
      </Card>

      <button onClick={handleSignOut}
              className="w-full bg-surface-2 border border-bdr text-dng text-sm font-semibold px-4 py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-dng/5 transition">
        <Icon name="logout" size={14} /> Sign out
      </button>
    </div>
    </AppShell>
  );
};

export default SettingsPage;
