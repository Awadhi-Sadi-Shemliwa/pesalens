import React, { useEffect, useState } from 'react';
import { AppShell } from '../components/navigation';
import { useRouter } from '../components/Router';
import { Icon } from '../components/Icon';
import { useAuth } from '../data/authStore';
import { Eyebrow, Tabs, TabPanel, Pager, Skeleton, EmptyState, Badge, ErrorState, Drawer } from '../components/common';
import {
  fetchMe,
  fetchAdminStats,
  fetchAdminUsers,
  fetchAdminErrors,
  fetchAdminActivity,
  fetchAdminFeedback,
  fetchAdminUserTimeline,
} from '../data/api';

/* ------------------------------------------------------------------
   Owner dashboard — system-wide transparency for allowlisted operators.
   Server-enforced by require_system_admin (ADMIN_EMAILS). Admin-ness is read
   from the server-provided `is_admin` flag on /auth/me, so a genuine admin who
   hits a 404 from a misconfig (wrong API base, proxy path) sees an error
   instead of being silently bounced as "not an admin".

   The console is built around the three questions an operator actually opens it
   to answer, which is why they are tabs and filters rather than things you scan
   a mixed feed for:

     · what is failing right now, and for whom      → Errors, filtered by recency
     · who deleted something, and what exactly      → Activity, group=destructive
     · what did this ONE user experience, in order  → the per-user timeline

   The timeline is the important one. An error row and the action that caused it
   live in two different tables, so until it existed there was no way to see
   "upload failed at 60%" next to "and then they deleted the statement and tried
   again twice" — which is the shape of every real support conversation.
   ------------------------------------------------------------------ */

/* Static class strings — Tailwind JIT can't see runtime-built `bg-${x}`. */
const TONE_BOX = {
  accent: 'bg-accent/10 border-accent/20 text-accent',
  inc: 'bg-inc/10 border-inc/20 text-inc',
  net: 'bg-net/10 border-net/20 text-net',
  exp: 'bg-exp/10 border-exp/20 text-exp',
  dng: 'bg-dng/10 border-dng/20 text-dng',
};

const StatTile = ({ label, value, tone = 'accent', icon, hint }) => (
  <div className="bento p-4 flex items-center gap-3">
    <div className={`p-2.5 rounded-xl border flex-shrink-0 ${TONE_BOX[tone] || TONE_BOX.accent}`}>
      <Icon name={icon} size={18} />
    </div>
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-ticker text-txt-3 truncate">{label}</div>
      <div className="text-xl font-semibold tabular text-txt-1">{value}</div>
      {hint ? <div className="text-[10px] text-txt-3 truncate">{hint}</div> : null}
    </div>
  </div>
);

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

/* Error-code → static icon-badge classes (JIT-safe). */
const ERROR_BADGE = {
  server_error: 'bg-dng/10 text-dng',
  pdf_unlock_failed: 'bg-exp/10 text-exp',
  pdf_unlock_unsupported: 'bg-exp/10 text-exp',
  extraction_empty: 'bg-exp/10 text-exp',
  receipt_scan_failed: 'bg-exp/10 text-exp',
  receipt_file_orphaned: 'bg-net/10 text-net',
  client_error: 'bg-net/10 text-net',
};

/* Where a failure came from. Colour-coded because "the browser crashed" and
   "the server crashed" need completely different responses, and reading that
   off a text label in a list of 200 rows does not happen. */
const SOURCE_BADGE = {
  server: 'danger',
  pipeline: 'expense',
  handled: 'net',
  web: 'accent',
  mobile: 'accent',
};

const ADMIN_PAGE_SIZE = 25;

/* Time windows for the recency filter. "Right now" is the operative question —
   an all-time error count only ever goes up and never tells you whether the
   thing is broken today. */
const WINDOWS = [
  { key: '', label: 'All time' },
  { key: '24', label: 'Last 24h' },
  { key: '168', label: 'Last 7 days' },
];

const Chip = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    aria-pressed={active}
    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition active:scale-95 focus-ring whitespace-nowrap ${
      active
        ? 'bg-accent/15 text-accent border-accent/30'
        : 'bg-surface-3 text-txt-2 border-bdr hover:bg-surface-4'
    }`}
  >
    {children}
  </button>
);

/* One line of "what was this about", read off the audit row's `details`
   snapshot. This is the difference between an audit trail and a list of verbs:
   "Receipt deleted" is useless, "Receipt deleted · Shell Masaki · TZS 45,000"
   answers the support ticket. */
const detailLine = (details) => {
  if (!details) return null;
  const bits = [];
  if (details.vendor) bits.push(details.vendor);
  if (typeof details.amount === 'number') bits.push(`TZS ${details.amount.toLocaleString()}`);
  else if (typeof details.total === 'number') bits.push(`${details.currency || 'TZS'} ${Number(details.total).toLocaleString()}`);
  if (details.entry_date || details.date) bits.push(details.entry_date || details.date);
  if (details.category) bits.push(details.category);
  if (details.filename) bits.push(details.filename);
  if (details.job_id) bits.push(`job ${details.job_id}`);
  if (typeof details.receipts === 'number' || typeof details.personal_entries === 'number') {
    bits.push(`${details.receipts || 0} receipts + ${details.personal_entries || 0} entries removed`);
  }
  if (details.code) bits.push(details.code);
  if (details.stage) bits.push(`stage ${details.stage}`);
  if (typeof details.rating === 'number') bits.push(`rated ${details.rating}/5`);
  if (Array.isArray(details.providers) && details.providers.length) {
    bits.push(details.providers.join(', '));
  }
  return bits.join(' · ') || null;
};

/* ---------------- per-user drill-down ---------------- */

const UserTimeline = ({ userId, onClose }) => {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setErr(null);
    if (userId == null) return undefined;
    fetchAdminUserTimeline(userId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setErr(e); });
    return () => { cancelled = true; };
  }, [userId]);

  const u = data?.user;
  return (
    <Drawer open={userId != null} onClose={onClose} eyebrow="User" title={u?.email || 'Loading…'}>
      {err ? (
        <ErrorState title="Couldn’t load this user" cause={err.message} timestamp={Date.now()} />
      ) : !data ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge color={u.pro_active ? 'income' : 'muted'}>{u.pro_active ? 'Pro' : (u.plan || 'trial')}</Badge>
            <Badge color="muted">{u.account_type || 'personal'}</Badge>
            <Badge color={u.email_verified ? 'income' : 'expense'}>
              {u.email_verified ? 'Verified' : 'Unverified'}
            </Badge>
            <span className="text-xs text-txt-3">Joined {fmtTime(u.created_at)}</span>
          </div>

          {data.uploads?.length > 0 && (
            <div>
              <Eyebrow>Statements</Eyebrow>
              <div className="mt-2 space-y-1.5">
                {data.uploads.map((up) => (
                  <div key={up.job_id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-txt-2 min-w-0">{up.filename || up.job_id}</span>
                    <span className="flex items-center gap-2 flex-shrink-0">
                      {up.status === 'failed' && up.stage && (
                        <span className="text-[11px] text-exp">
                          {up.stage}{up.progress != null ? ` ${up.progress}%` : ''}
                        </span>
                      )}
                      <Badge color={up.status === 'failed' ? 'danger' : up.status === 'done' ? 'income' : 'muted'}>
                        {up.status}
                      </Badge>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <Eyebrow>What happened, in order</Eyebrow>
            {data.timeline?.length === 0 ? (
              <p className="text-sm text-txt-3 mt-2">Nothing recorded for this account yet.</p>
            ) : (
              <div className="mt-2 divide-y divide-bdr/50">
                {data.timeline.map((i) => (
                  <div key={i.id} className="py-2.5 flex items-start gap-2.5">
                    <Icon
                      name={i.kind === 'error' ? 'alert' : i.destructive ? 'trash' : 'bell'}
                      size={14}
                      className={`mt-0.5 flex-shrink-0 ${
                        i.kind === 'error' || i.failure ? 'text-exp' : i.destructive ? 'text-dng' : 'text-txt-3'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-semibold text-txt-1">{i.event}</span>
                        {i.ref && <span className="font-mono text-[10px] text-txt-3">{i.ref}</span>}
                        {i.source && <Badge color={SOURCE_BADGE[i.source] || 'muted'}>{i.source}</Badge>}
                      </div>
                      {i.message && <p className="text-xs text-txt-2 mt-1 break-words">{i.message}</p>}
                      {detailLine(i.details) && (
                        <p className="text-xs text-txt-3 mt-0.5 break-words">{detailLine(i.details)}</p>
                      )}
                      {(i.stage || i.progress != null) && (
                        <p className="text-[11px] text-txt-3 mt-0.5">
                          {i.stage}{i.progress != null ? ` · ${i.progress}%` : ''}
                        </p>
                      )}
                      <p className="font-mono text-[10px] text-txt-3 mt-0.5">
                        {fmtTime(i.created_at)}{i.ip ? ` · ${i.ip}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
};

/* ---------------- page ---------------- */

const AdminDashboardPage = () => {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [tab, setTab] = useState('users');
  // One page cursor, reset whenever the tab changes so switching lists always
  // lands the reader at the top of the new one.
  const [listPage, setListPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [errors, setErrors] = useState([]);
  const [errorCodes, setErrorCodes] = useState([]);
  const [activity, setActivity] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [histogram, setHistogram] = useState({});

  // Filters. Held here rather than inside each tab so switching away and back
  // does not silently reset what the operator was looking at mid-investigation.
  const [errCode, setErrCode] = useState('');
  const [errSource, setErrSource] = useState('');
  const [errHours, setErrHours] = useState('');
  const [actGroup, setActGroup] = useState('');
  const [actHours, setActHours] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [openUser, setOpenUser] = useState(null);

  // "Known non-admin" = /auth/me has loaded AND the account is not flagged admin.
  // Truthiness (not `=== false`) so a response that simply OMITS is_admin for
  // non-admins still counts — otherwise a non-admin would never be bounced and
  // would sit on the error screen re-hitting a 404ing endpoint. `user` still
  // null (booting) is NOT treated as non-admin, so a genuine admin is never
  // bounced by a transient state.
  const knownNonAdmin = !!user && !user.is_admin;

  const load = async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const [s, u, e, a, f] = await Promise.all([
        fetchAdminStats(),
        fetchAdminUsers({ q: userQuery }),
        fetchAdminErrors(errCode, { source: errSource, hours: errHours }),
        fetchAdminActivity({ group: actGroup, hours: actHours }),
        fetchAdminFeedback(),
      ]);
      setStats(s);
      setUsers(u?.users || []);
      setErrors(e?.errors || []);
      setErrorCodes(e?.codes || []);
      setActivity(a?.activity || []);
      setFeedback(f?.feedback || []);
      setHistogram(f?.histogram || {});
    } catch (err) {
      // A 404 for a known non-admin means the gate did its job — bounce. A 404
      // while the user IS a flagged admin means a misconfig (wrong API base /
      // proxy path), which we surface as an error rather than silently
      // redirecting a genuine admin away.
      if (err?.status === 404 && knownNonAdmin) { navigate('/dashboard'); return; }
      setLoadErr(err);
    } finally {
      setLoading(false);
    }
  };

  // Non-admins never need to load the panels — but the locally cached user may
  // predate the `is_admin` flag (signin payloads from older deploys omit it),
  // so landing directly on #/admin used to bounce a genuine admin before the
  // first /auth/me could merge the flag in. Confirm with a fresh /auth/me
  // before bouncing: a confirmed admin flips user.is_admin via updateUser,
  // re-running this effect into load(); a confirmed non-admin is bounced.
  useEffect(() => {
    let cancelled = false;
    if (user?.is_admin) {
      load();
    } else {
      fetchMe()
        .then((me) => {
          if (cancelled) return;
          if (me && !me.is_admin) { navigate('/dashboard'); return; }
          // `me` empty/unreadable → fall through to the panel loads and let
          // their own error handling decide (it only bounces on a 404 for a
          // KNOWN non-admin), rather than silently bouncing a possible admin.
          if (!me) load();
        })
        .catch(() => { if (!cancelled) load(); });
    }
    return () => { cancelled = true; };
    /* eslint-disable-next-line */
  }, [user?.is_admin]);

  // Re-query when a filter changes. Server-side filtering (not client-side) is
  // what makes "last 24 hours" honest: the server caps each list, so filtering
  // a already-capped page would search only the newest 100 rows and quietly
  // miss everything older.
  useEffect(() => {
    if (loading) return undefined;
    let cancelled = false;
    setListPage(1);
    fetchAdminErrors(errCode, { source: errSource, hours: errHours })
      .then((e) => { if (!cancelled) { setErrors(e?.errors || []); setErrorCodes(e?.codes || []); } })
      .catch(() => {});
    return () => { cancelled = true; };
    /* eslint-disable-next-line */
  }, [errCode, errSource, errHours]);

  useEffect(() => {
    if (loading) return undefined;
    let cancelled = false;
    setListPage(1);
    fetchAdminActivity({ group: actGroup, hours: actHours })
      .then((a) => { if (!cancelled) setActivity(a?.activity || []); })
      .catch(() => {});
    return () => { cancelled = true; };
    /* eslint-disable-next-line */
  }, [actGroup, actHours]);

  // Debounced so typing a name is one request per pause, not one per keystroke.
  useEffect(() => {
    if (loading) return undefined;
    const timer = setTimeout(() => {
      fetchAdminUsers({ q: userQuery })
        .then((u) => { setUsers(u?.users || []); setListPage(1); })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
    /* eslint-disable-next-line */
  }, [userQuery]);

  const tabs = [
    { key: 'users', label: 'Users', badge: users.length || null },
    { key: 'errors', label: 'Errors', badge: errors.length || null },
    { key: 'activity', label: 'Activity', badge: activity.length || null },
    { key: 'feedback', label: 'Feedback', badge: feedback.length || null },
  ];

  // Page the currently-visible list. Server already caps the row count, but a
  // capped 200-row wall is still a wall — show one screenful at a time.
  const activeList = tab === 'users' ? users
    : tab === 'errors' ? errors
      : tab === 'activity' ? activity
        : feedback;
  const listTotalPages = Math.max(1, Math.ceil(activeList.length / ADMIN_PAGE_SIZE));
  const listCur = Math.min(listPage, listTotalPages);
  const pageSlice = (rows) => rows.slice((listCur - 1) * ADMIN_PAGE_SIZE, listCur * ADMIN_PAGE_SIZE);

  const ratedTotal = Object.values(histogram).reduce((s, n) => s + n, 0);

  return (
    <AppShell>
      <div className="space-y-5 max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <Eyebrow>Owner console</Eyebrow>
            <h1 className="mt-1.5 text-xl sm:text-2xl font-semibold tracking-tight">System dashboard</h1>
            <p className="text-sm text-txt-2 mt-1">
              Every user, every failure, every deletion, and what testers told us — across PesaLens.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-2 text-sm rounded-lg bg-surface-3 hover:bg-surface-4 text-txt-1 border border-bdr transition active:scale-95 disabled:opacity-60 focus-ring inline-flex items-center gap-2"
          >
            <Icon name="upload" size={14} /> Refresh
          </button>
        </div>

        {/* KPI row */}
        {/* Skeleton covers the whole gated region — KPI row, tab bar and table —
            so the page doesn't pop in two stages (§81–83). */}
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
            </div>
            <Skeleton className="h-10 w-72 rounded-xl" />
            <div className="bento p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-11 rounded-lg" />)}
            </div>
          </div>
        ) : loadErr ? (
          <ErrorState
            title="Couldn’t load the dashboard"
            cause={loadErr.message}
            timestamp={Date.now()}
            onRetry={load}
            retryLabel="Retry"
          />
        ) : (
          <>
            {/* Recency first: "is it broken right now" outranks "how many ever". */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatTile label="Errors (24h)" value={stats?.errors_24h ?? 0} tone="dng" icon="alert"
                        hint={`${stats?.total_errors ?? 0} all time`} />
              <StatTile label="Active (24h)" value={stats?.active_24h ?? 0} tone="inc" icon="user"
                        hint={`${stats?.total_users ?? 0} users total`} />
              <StatTile label="Deletions (7d)" value={stats?.deletions_7d ?? 0} tone="exp" icon="trash" />
              <StatTile label="Failed uploads" value={stats?.failed_uploads ?? 0} tone="exp" icon="upload"
                        hint={`${stats?.total_uploads ?? 0} total`} />
              <StatTile label="Users" value={stats?.total_users ?? 0} tone="accent" icon="user" />
              <StatTile label="Active Pro" value={stats?.active_pro ?? 0} tone="inc" icon="zap" />
              {/* Response RATE, not a raw count. The count only ever goes up
                  and says nothing about whether the prompt is earning its
                  interruption; the rate is the number that tells you whether
                  to change how you ask. */}
              <StatTile
                label="Feedback" value={stats?.feedback_count ?? 0} tone="net" icon="check"
                hint={
                  stats?.feedback_rate != null
                    ? `${stats.feedback_rate}% of ${(stats.feedback_responders ?? 0) + (stats.feedback_declined ?? 0)} asked`
                    : 'nobody asked yet'
                }
              />
              <StatTile
                label="Avg rating"
                value={stats?.avg_rating != null ? `${stats.avg_rating}/5` : '—'}
                tone="accent" icon="spark"
              />
            </div>

            <Tabs tabs={tabs} active={tab} onChange={(k) => { setTab(k); setListPage(1); }} label="Admin sections" />

            <TabPanel tabKey={tab} className="space-y-6">
            {/* ------- USERS ------- */}
            {tab === 'users' && (
              <>
                <input
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  placeholder="Search by name or email…"
                  aria-label="Search users"
                  className="w-full sm:max-w-sm rounded-xl bg-surface-3 border border-bdr px-3 py-2 text-sm text-txt-1 placeholder:text-txt-3 focus-ring"
                />
                {users.length === 0 ? (
                  <EmptyState icon="user" title="No users found"
                              desc={userQuery ? 'No account matches that search.' : 'New sign-ups will appear here.'} />
                ) : (
                  <div className="bento p-0 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-ticker text-txt-3 border-b border-bdr">
                          <th className="px-4 py-3 font-medium">User</th>
                          <th className="px-4 py-3 font-medium">Plan</th>
                          <th className="px-4 py-3 font-medium text-right">Uploads</th>
                          <th className="px-4 py-3 font-medium text-right">Issues</th>
                          <th className="px-4 py-3 font-medium">Joined</th>
                          <th className="px-4 py-3 font-medium">Last activity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageSlice(users).map((u) => (
                          <tr
                            key={u.id}
                            onClick={() => setOpenUser(u.id)}
                            className="border-b border-bdr/50 last:border-0 cursor-pointer hover:bg-surface-3/50 transition-colors"
                          >
                            <td className="px-4 py-3">
                              <div className="font-medium text-txt-1 truncate max-w-[220px]">{u.full_name || '—'}</div>
                              <div className="text-xs text-txt-3 truncate max-w-[220px]">{u.email}</div>
                            </td>
                            <td className="px-4 py-3">
                              <Badge color={u.pro_active ? 'income' : 'muted'}>
                                {u.pro_active ? 'Pro' : (u.plan || 'trial')}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-right tabular">{u.uploads}</td>
                            <td className="px-4 py-3 text-right tabular">
                              {u.errors > 0
                                ? <span className="text-exp font-semibold">{u.errors}</span>
                                : <span className="text-txt-3">0</span>}
                            </td>
                            <td className="px-4 py-3 text-txt-2 whitespace-nowrap">{fmtTime(u.created_at)}</td>
                            <td className="px-4 py-3 text-txt-2 whitespace-nowrap">{fmtTime(u.last_activity)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-xs text-txt-3">Select a row to see everything that happened to that account, in order.</p>
              </>
            )}

            {/* ------- ERRORS ------- */}
            {tab === 'errors' && (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  {WINDOWS.map((w) => (
                    <Chip key={w.key} active={errHours === w.key} onClick={() => setErrHours(w.key)}>{w.label}</Chip>
                  ))}
                  <span className="w-px h-5 bg-bdr mx-1" />
                  <Chip active={errSource === ''} onClick={() => setErrSource('')}>Any source</Chip>
                  {['server', 'pipeline', 'handled', 'web', 'mobile'].map((s) => (
                    <Chip key={s} active={errSource === s} onClick={() => setErrSource(s)}>{s}</Chip>
                  ))}
                </div>
                {errorCodes.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Chip active={errCode === ''} onClick={() => setErrCode('')}>All codes</Chip>
                    {errorCodes.map((c) => (
                      <Chip key={c} active={errCode === c} onClick={() => setErrCode(c)}>{c}</Chip>
                    ))}
                  </div>
                )}
                {errors.length === 0 ? (
                  <EmptyState icon="check" title="No errors in this view"
                              desc="Crashes, failed extractions, unreadable receipts and client-side problems appear here, with the stage and percentage they stopped at." />
                ) : (
                  <div className="space-y-2">
                    {pageSlice(errors).map((e) => (
                      <div key={e.id} className="bento p-4 flex items-start gap-3">
                        <div className={`p-2 rounded-lg flex-shrink-0 ${ERROR_BADGE[e.error_code] || 'bg-dng/10 text-dng'}`}>
                          <Icon name="alert" size={16} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-semibold text-txt-1">{e.error_code}</span>
                            <Badge color={SOURCE_BADGE[e.source] || 'muted'}>{e.source}</Badge>
                            <span className="font-mono text-[10px] text-txt-3">{e.ref}</span>
                            {e.stage && <span className="text-xs text-txt-3">· {e.stage}{e.progress != null ? ` (${e.progress}%)` : ''}</span>}
                            {e.method && e.path && <span className="text-xs text-txt-3">· {e.method} {e.path}</span>}
                          </div>
                          {e.message && <p className="text-sm text-txt-2 mt-1 break-words">{e.message}</p>}
                          <p className="font-mono text-[11px] text-txt-3 mt-1">
                            {fmtTime(e.created_at)}
                            {e.user_id ? (
                              <>
                                {' · '}
                                <button
                                  onClick={() => setOpenUser(e.user_id)}
                                  className="underline hover:text-accent focus-ring rounded"
                                >
                                  {e.user_email || `user #${e.user_id}`}
                                </button>
                              </>
                            ) : ''}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ------- ACTIVITY ------- */}
            {tab === 'activity' && (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <Chip active={actGroup === ''} onClick={() => setActGroup('')}>Everything</Chip>
                  <Chip active={actGroup === 'destructive'} onClick={() => setActGroup('destructive')}>
                    Deletions
                  </Chip>
                  <Chip active={actGroup === 'failure'} onClick={() => setActGroup('failure')}>
                    Problems
                  </Chip>
                  <span className="w-px h-5 bg-bdr mx-1" />
                  {WINDOWS.map((w) => (
                    <Chip key={w.key} active={actHours === w.key} onClick={() => setActHours(w.key)}>{w.label}</Chip>
                  ))}
                </div>
                {activity.length === 0 ? (
                  <EmptyState icon="bell" title="Nothing in this view"
                              desc="Sign-ins, uploads, deletions and account events across all users appear here." />
                ) : (
                  <div className="bento p-0 divide-y divide-bdr/50">
                    {pageSlice(activity).map((a) => (
                      <div key={a.id} className="px-4 py-3 flex items-start justify-between gap-3">
                        <div className="min-w-0 flex items-start gap-2.5">
                          <Icon
                            name={a.destructive ? 'trash' : a.failure ? 'alert' : 'bell'}
                            size={14}
                            className={`mt-0.5 flex-shrink-0 ${
                              a.destructive ? 'text-dng' : a.failure ? 'text-exp' : 'text-txt-3'
                            }`}
                          />
                          <div className="min-w-0">
                            <span className="text-sm text-txt-1">{a.event.replace(/_/g, ' ')}</span>
                            {a.user_id && (
                              <button
                                onClick={() => setOpenUser(a.user_id)}
                                className="text-xs text-txt-3 ml-2 underline hover:text-accent focus-ring rounded"
                              >
                                {a.user_email || `user #${a.user_id}`}
                              </button>
                            )}
                            {detailLine(a.details) && (
                              <p className="text-xs text-txt-3 mt-0.5 break-words">{detailLine(a.details)}</p>
                            )}
                          </div>
                        </div>
                        <span className="font-mono text-[11px] text-txt-3 whitespace-nowrap flex-shrink-0">
                          {fmtTime(a.created_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ------- FEEDBACK ------- */}
            {tab === 'feedback' && (
              feedback.length === 0 ? (
                <EmptyState icon="chart" title="No feedback yet"
                            desc="Testers are asked once, when they first sign out. Their answers appear here." />
              ) : (
                <>
                  {ratedTotal > 0 && (
                    <div className="bento p-4">
                      <Eyebrow>Ratings</Eyebrow>
                      <div className="mt-2.5 space-y-1.5">
                        {[5, 4, 3, 2, 1].map((score) => {
                          const n = histogram[String(score)] || 0;
                          const pct = ratedTotal ? Math.round((n / ratedTotal) * 100) : 0;
                          return (
                            <div key={score} className="flex items-center gap-2.5">
                              <span className="text-xs text-txt-3 w-3 tabular">{score}</span>
                              <div className="flex-1 h-2 rounded-full bg-surface-4 overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${score >= 4 ? 'bg-inc' : score === 3 ? 'bg-net' : 'bg-exp'}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-xs text-txt-3 w-10 text-right tabular">{n}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="space-y-3">
                    {pageSlice(feedback).map((f) => (
                      <div key={f.id} className="bento p-4 space-y-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          {f.rating != null && (
                            <Badge color={f.rating >= 4 ? 'income' : f.rating <= 2 ? 'danger' : 'muted'}>
                              {f.rating}/5
                            </Badge>
                          )}
                          {f.client && <Badge color="muted">{f.client}</Badge>}
                          <button
                            onClick={() => f.user_id && setOpenUser(f.user_id)}
                            className="text-xs text-txt-3 underline hover:text-accent focus-ring rounded"
                          >
                            {f.user_email || `user #${f.user_id}`}
                          </button>
                          <span className="font-mono text-[11px] text-txt-3 ml-auto">{fmtTime(f.created_at)}</span>
                        </div>
                        {[
                          ['How it has been', f.experience],
                          ['What to improve', f.improvements],
                          ['Problem it solves best', f.problem_solved],
                          ['Who it is for', f.audience],
                          ['Would recommend to', f.referrals],
                        ].filter(([, v]) => v).map(([label, value]) => (
                          <div key={label}>
                            <div className="text-[11px] uppercase tracking-ticker text-txt-3">{label}</div>
                            <p className="text-sm text-txt-1 mt-0.5 break-words whitespace-pre-wrap">{value}</p>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )
            )}

            {listTotalPages > 1 && (
              <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
                <span className="text-xs text-txt-3 tabular">
                  {(listCur - 1) * ADMIN_PAGE_SIZE + 1}–{Math.min(listCur * ADMIN_PAGE_SIZE, activeList.length)} of {activeList.length}
                </span>
                <Pager page={listCur} total={listTotalPages} onChange={setListPage} />
              </div>
            )}
            </TabPanel>
          </>
        )}
      </div>

      <UserTimeline userId={openUser} onClose={() => setOpenUser(null)} />
    </AppShell>
  );
};

export default AdminDashboardPage;
