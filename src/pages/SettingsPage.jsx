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
  fetchActivity,
  fetchMe,
  fetchStartOverEligibility,
  sendVerifyEmail,
  signOut,
  startOver,
} from '../data/api';
import { Button, EmptyState, PasswordField, Skeleton, toast } from '../components/common';
import { signOutWithFeedback, openFeedback } from '../components/FeedbackGate';
import { passwordRulesMet } from '../data/password';
import { useT } from '../data/i18n';

/* Human labels for the activity feed (mirrors the backend map). */
const ACTIVITY_ICON = {
  signin_success: 'user', logout: 'logout', signup: 'user',
  password_changed: 'shield', password_change_revoked: 'alert', password_reset: 'shield',
  email_verified: 'check', email_verified_via_signin: 'check', data_export: 'download',
  upload_succeeded: 'upload', upload_failed: 'alert',
  manual_payment_confirmed: 'zap', manual_payment_confirm_requested: 'wallet',
  receipt_scanned: 'camera', receipt_scan_failed: 'alert',
  receipt_deleted: 'trash', personal_entry_deleted: 'trash',
  business_entry_deleted: 'trash', statement_delete: 'trash',
  data_start_over: 'alert', account_deleted: 'alert',
  feedback_submitted: 'check', client_error: 'alert',
};

/* A one-line "what was this about" for a timeline row.
   Reads the `details` snapshot the backend records alongside each event, so a
   deletion says WHICH entry went and a failed extraction says how far it got.
   Returns null when there is nothing worth adding — an empty sub-line is worse
   than none, because it implies information is missing rather than absent. */
const activityContext = (a) => {
  if (a.kind === 'issue') {
    const bits = [];
    if (a.stage) bits.push(`Stopped at: ${a.stage}`);
    if (a.progress != null) bits.push(`${a.progress}% complete`);
    return bits.join(' · ') || null;
  }
  const d = a.details;
  if (!d) return null;
  const bits = [];
  if (d.vendor) bits.push(d.vendor);
  if (typeof d.amount === 'number') bits.push(`TZS ${d.amount.toLocaleString()}`);
  else if (typeof d.total === 'number') bits.push(`${d.currency || 'TZS'} ${d.total.toLocaleString()}`);
  if (d.entry_date || d.date) bits.push(d.entry_date || d.date);
  if (d.filename) bits.push(d.filename);
  if (typeof d.receipts === 'number' || typeof d.personal_entries === 'number') {
    bits.push(`${d.receipts || 0} receipts, ${d.personal_entries || 0} entries removed`);
  }
  return bits.join(' · ') || null;
};

const SectionHeader = ({ eyebrow, title, sub }) => (
  <div className="mb-3">
    <div className="font-mono text-[10px] uppercase tracking-ticker text-txt-3">{eyebrow}</div>
    <h3 className="text-base sm:text-lg font-semibold tracking-tight mt-0.5">{title}</h3>
    {sub ? <p className="text-xs text-txt-3 mt-0.5">{sub}</p> : null}
  </div>
);

const Card = ({ children, className = '' }) => (
  <div className={`bento p-4 sm:p-5 ${className}`}>
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

  // ---------- Start over (bulk clear of unlinked receipts + entries) ----------
  const [startOverState, setStartOverState] = useState(null);
  const [soConfirm, setSoConfirm] = useState('');
  const [soBusy, setSoBusy] = useState(false);
  const [soErr, setSoErr] = useState('');

  const loadStartOver = () =>
    fetchStartOverEligibility()
      .then(setStartOverState)
      // Non-critical: if this fails the card simply doesn't render.
      .catch(() => setStartOverState(null));

  useEffect(() => { loadStartOver(); }, []);

  const runStartOver = async () => {
    setSoBusy(true);
    setSoErr('');
    try {
      const res = await startOver();
      toast.success(
        `Cleared ${res.receipts} receipt(s) and ${res.personal_entries} entry(ies).`,
        { title: 'Start over complete' },
      );
      setSoConfirm('');
      await loadStartOver();   // reflects the new 30-day cooldown
    } catch (err) {
      // 409/429 carry the server's explanation — show it verbatim rather than
      // a generic failure, since the reason is the useful part.
      setSoErr(err?.message || 'Could not clear your data.');
    } finally {
      setSoBusy(false);
    }
  };

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

  // Submit stays inert until every rule has flipped (§75, password-field.md #4).
  // Uses the same predicate PasswordField's checklist renders, so the button and
  // the checklist can never disagree.
  const pwMatch = pw.confirm.length > 0 && pw.next === pw.confirm;
  const pwAllOk = passwordRulesMet(pw.next) && pwMatch && pw.current.length > 0;

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
      /* The download lands in the browser's download tray, away from the button —
         so this one gets a toast, unlike the in-field password confirmation below
         (form-fields.md #5). */
      toast.success('Your JSON download has started.', { title: 'Data exported' });
    } catch (err) {
      setExportMsg(err?.message || 'Could not export data.');
      toast.error(err?.message || "We couldn't build your data export.", { title: 'Export failed' });
    } finally {
      setExportBusy(false);
    }
  };

  // ---------- Activity history + owner-console capability check ----------
  const [activity, setActivity] = useState(null); // null = loading
  // "Show me only what went wrong" — the reason most people open this panel.
  const [issuesOnly, setIssuesOnly] = useState(false);
  const issueCount = (activity || []).filter((a) => a.failed).length;
  const visibleActivity = issuesOnly
    ? (activity || []).filter((a) => a.failed)
    : (activity || []);
  // Owner-console visibility comes from the server-provided is_admin flag on
  // /auth/me (fetched on mount above) — no probe. Probing an admin endpoint hid
  // the console on any transient failure and ran COUNT queries just to decide
  // nav visibility.
  const isAdmin = Boolean(user?.is_admin);
  useEffect(() => {
    fetchActivity()
      .then((d) => setActivity(d?.activity || []))
      .catch(() => setActivity([]));
  }, []);

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
      toast.success('Your account and data have been removed.', { title: 'Account deleted' });
      navigate('/signin');
    } catch (err) {
      setDelErr(err?.message || 'Could not delete account.');
      toast.error(err?.message || 'Could not delete account.', { title: 'Deletion failed' });
    } finally {
      setDelBusy(false);
    }
  };

  // ---------- Sign out ----------
  const handleSignOut = async () => {
    // Shared with the header menu and the Back-from-Dashboard confirmation, so
    // the one-time feedback prompt cannot depend on which button was pressed.
    await signOutWithFeedback();
    toast.success('Signed out');
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
            <Button size="sm" onClick={startVerify}>Send verification code</Button>
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
                <Button type="submit" size="sm" loading={verifyState.phase === 'submitting'} loadingLabel="Verifying…">
                  Verify
                </Button>
                <Button variant="ghost" size="sm" onClick={startVerify}>Resend</Button>
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
          <PasswordField
            label="Current password"
            autoComplete="current-password"
            value={pw.current}
            onChange={(v) => setPw((p) => ({ ...p, current: v }))}
            disabled={pwBusy}
          />
          <PasswordField
            label="New password"
            value={pw.next}
            onChange={(v) => setPw((p) => ({ ...p, next: v }))}
            helper="Length beats symbols — a few unrelated words is stronger than one decorated one."
            showStrength
            showRules
            disabled={pwBusy}
          />
          <PasswordField
            label="Confirm new password"
            value={pw.confirm}
            onChange={(v) => setPw((p) => ({ ...p, confirm: v }))}
            success={pwMatch}
            successMessage="Passwords match."
            error={pw.confirm.length > 0 && !pwMatch ? "Passwords don't match yet." : null}
            disabled={pwBusy}
          />
          {pwMsg.text ? <Banner tone={pwMsg.tone}>{pwMsg.text}</Banner> : null}
          <Button type="submit" size="sm" className="self-start" disabled={!pwAllOk} loading={pwBusy} loadingLabel="Updating…">
            Update password
          </Button>
        </form>
      </Card>

      <Card>
        <SectionHeader
          eyebrow="03"
          title="Activity and issues"
          sub="Everything your account did, and everything that went wrong for it — sign-ins, uploads, deletions and failures, each with a timestamp."
        />
        {/* Failures are shown to you on purpose. A receipt scan that quietly
            did nothing is the most confusing thing this app can do, so it gets
            a line here saying so, with a reference you can quote to us. */}
        {activity === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : activity.length === 0 ? (
          <EmptyState
            kind="first-run"
            title="Nothing to show yet"
            desc="Sign-ins, uploads, deletions and any problems will be listed here with a timestamp."
          />
        ) : (
          <>
            {issueCount > 0 && (
              <div className="mb-3 flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setIssuesOnly((v) => !v)}
                  aria-pressed={issuesOnly}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition active:scale-95 focus-ring ${
                    issuesOnly
                      ? 'bg-exp/15 text-exp border-exp/30'
                      : 'bg-surface-3 text-txt-2 border-bdr hover:bg-surface-4'
                  }`}
                >
                  <Icon name="alert" size={12} />
                  {issuesOnly ? 'Showing problems only' : `${issueCount} problem${issueCount === 1 ? '' : 's'}`}
                </button>
                {issuesOnly && (
                  <span className="text-xs text-txt-3">Tap again to see everything</span>
                )}
              </div>
            )}
            <div className="divide-y divide-bdr/50 -my-1">
              {visibleActivity.slice(0, 20).map((a) => (
                <div key={a.id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Icon
                      name={a.failed ? 'alert' : (ACTIVITY_ICON[a.event] || 'bell')}
                      size={14}
                      className={`flex-shrink-0 mt-0.5 ${a.failed ? 'text-exp' : 'text-txt-3'}`}
                    />
                    <div className="min-w-0">
                      <span className={`text-sm truncate ${a.failed ? 'text-exp' : 'text-txt-1'}`}>
                        {a.title}
                      </span>
                      {/* What it was about — the vendor and amount of a deleted
                          entry, the stage an extraction stopped at. Without
                          this, "Receipt deleted" cannot answer "which one?". */}
                      {activityContext(a) && (
                        <p className="text-xs text-txt-3 mt-0.5 break-words">{activityContext(a)}</p>
                      )}
                      {a.ref && (
                        <p className="font-mono text-[10px] text-txt-3 mt-0.5">
                          Reference {a.ref} — quote this if you contact us
                        </p>
                      )}
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-txt-3 whitespace-nowrap flex-shrink-0">
                    {a.created_at ? new Date(a.created_at).toLocaleString() : ''}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
        {isAdmin && (
          <button
            onClick={() => navigate('/admin')}
            className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-accent hover:text-accent/80 focus-visible:ring-2 focus-visible:ring-accent rounded"
          >
            <Icon name="shield" size={14} /> Open owner console
          </button>
        )}
      </Card>

      {/* The permanent door to the feedback form.
          Whatever the prompt state says — snoozed, three times declined,
          already answered — this button always opens it. That is the promise
          that makes declining safe: the auto-prompt can stop asking precisely
          because saying no never takes the option away. `force` is what
          guarantees it (see components/FeedbackGate.jsx). */}
      <Card>
        <SectionHeader
          eyebrow="04"
          title="Send us feedback"
          sub="Tell us how PesaLens is working, what to improve, and who else could use it. Open any time, as often as you like."
        />
        <Button size="sm" icon="send" onClick={() => openFeedback({ force: true })}>
          Open the feedback form
        </Button>
      </Card>

      <Card>
        <SectionHeader
          eyebrow="05"
          title="Export your data"
          sub="A JSON copy of your profile, uploads, ledger entries, and payment history. Yours to keep."
        />
        <div className="flex items-center gap-3 flex-wrap">
          <Button size="sm" icon="download" loading={exportBusy} loadingLabel="Preparing…" onClick={downloadExport}>
            Download JSON
          </Button>
          {exportMsg ? <span className="text-xs text-txt-3">{exportMsg}</span> : null}
        </div>
      </Card>

      {/* Start over — the escape hatch for data captured before statements
          could be linked to it. Those receipts/entries are excluded from the
          statement delete cascade (it must never take hand-typed entries), so
          without this they can only be removed one at a time. Shown always,
          with the reason it's unavailable, so it never looks broken. */}
      {startOverState && (
        <Card className="border-exp/30">
          <SectionHeader
            eyebrow="06"
            title="Start over"
            sub="Clears every receipt and manual entry when none of them belong to a statement. Your statements and business ledger are kept. Available once every 30 days."
          />
          <div className="text-sm text-txt-2 mb-3">
            {startOverState.eligible ? (
              <>
                This will remove{' '}
                <span className="text-txt-1 font-medium">
                  {startOverState.receipts} receipt{startOverState.receipts === 1 ? '' : 's'}
                </span>{' '}and{' '}
                <span className="text-txt-1 font-medium">
                  {startOverState.personal_entries} manual{' '}
                  {startOverState.personal_entries === 1 ? 'entry' : 'entries'}
                </span>. This cannot be undone.
              </>
            ) : startOverState.reason === 'attached' ? (
              <>Some of your receipts or entries belong to a statement. Delete that
              statement instead — it takes its own data with it.</>
            ) : startOverState.reason === 'cooldown' ? (
              <>Already used. Available again after{' '}
              <span className="text-txt-1 font-medium">
                {String(startOverState.next_available_at || '').slice(0, 10)}
              </span>.</>
            ) : (
              <>There is nothing to clear.</>
            )}
          </div>
          {startOverState.eligible && (
            <>
              <Field label='Type "DELETE" in capital letters to confirm'>
                <input
                  value={soConfirm} onChange={(e) => setSoConfirm(e.target.value)}
                  placeholder="DELETE" autoComplete="off" spellCheck={false}
                  className="w-full bg-surface-3 border border-exp/30 rounded-xl px-4 py-3 text-sm font-mono tracking-widest"
                />
              </Field>
              {soErr ? <div className="mt-3"><Banner tone="dng">{soErr}</Banner></div> : null}
              <button
                onClick={runStartOver} disabled={soBusy || soConfirm !== 'DELETE'}
                className="mt-3 bg-exp text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed hover:bg-exp/90 transition"
              >
                {soBusy ? 'Clearing…' : 'Clear receipts and entries'}
              </button>
            </>
          )}
        </Card>
      )}

      <Card className="border-dng/30">
        <SectionHeader
          eyebrow="07"
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
