import React, { useEffect, useState } from 'react';
import { AppShell } from '../components/navigation';
import { useRouter } from '../components/Router';
import { Icon } from '../components/Icon';
import { useAuth } from '../data/authStore';
import { Eyebrow, Tabs, TabPanel, Pager, Skeleton, EmptyState, Badge, ErrorState } from '../components/common';
import {
  fetchAdminStats,
  fetchAdminUsers,
  fetchAdminErrors,
  fetchAdminActivity,
} from '../data/api';

/* ------------------------------------------------------------------
   Owner dashboard — system-wide transparency for allowlisted operators.
   Server-enforced by require_system_admin (ADMIN_EMAILS). Admin-ness is read
   from the server-provided `is_admin` flag on /auth/me, so a genuine admin who
   hits a 404 from a misconfig (wrong API base, proxy path) sees an error
   instead of being silently bounced as "not an admin".
   ------------------------------------------------------------------ */

/* Static class strings — Tailwind JIT can't see runtime-built `bg-${x}`. */
const TONE_BOX = {
  accent: 'bg-accent/10 border-accent/20 text-accent',
  inc: 'bg-inc/10 border-inc/20 text-inc',
  net: 'bg-net/10 border-net/20 text-net',
  exp: 'bg-exp/10 border-exp/20 text-exp',
  dng: 'bg-dng/10 border-dng/20 text-dng',
};

const StatTile = ({ label, value, tone = 'accent', icon }) => (
  <div className="bento p-4 flex items-center gap-3">
    <div className={`p-2.5 rounded-xl border flex-shrink-0 ${TONE_BOX[tone] || TONE_BOX.accent}`}>
      <Icon name={icon} size={18} />
    </div>
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-ticker text-txt-3">{label}</div>
      <div className="text-xl font-semibold tabular text-txt-1">{value}</div>
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
};

const ADMIN_PAGE_SIZE = 25;

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
  const [activity, setActivity] = useState([]);

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
      const [s, u, e, a] = await Promise.all([
        fetchAdminStats(),
        fetchAdminUsers(),
        fetchAdminErrors(),
        fetchAdminActivity(),
      ]);
      setStats(s);
      setUsers(u?.users || []);
      setErrors(e?.errors || []);
      setActivity(a?.activity || []);
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

  // Non-admins never need to load the panels — bounce as soon as /auth/me says so.
  useEffect(() => {
    if (knownNonAdmin) { navigate('/dashboard'); return; }
    load(); /* eslint-disable-next-line */
  }, [user?.is_admin]);

  const tabs = [
    { key: 'users', label: 'Users', badge: users.length || null },
    { key: 'errors', label: 'Errors', badge: errors.length || null },
    { key: 'activity', label: 'Activity' },
  ];

  // Page the currently-visible list. Server already caps the row count, but a
  // capped 200-row wall is still a wall — show one screenful at a time.
  const activeList = tab === 'users' ? users : tab === 'errors' ? errors : activity;
  const listTotalPages = Math.max(1, Math.ceil(activeList.length / ADMIN_PAGE_SIZE));
  const listCur = Math.min(listPage, listTotalPages);
  const pageSlice = (rows) => rows.slice((listCur - 1) * ADMIN_PAGE_SIZE, listCur * ADMIN_PAGE_SIZE);

  return (
    <AppShell>
      <div className="space-y-5 max-w-6xl mx-auto">
        <div>
          <Eyebrow>Owner console</Eyebrow>
          <h1 className="mt-1.5 text-xl sm:text-2xl font-semibold tracking-tight">System dashboard</h1>
          <p className="text-sm text-txt-2 mt-1">Users, errors, and account activity across PesaLens.</p>
        </div>

        {/* KPI row */}
        {/* Skeleton covers the whole gated region — KPI row, tab bar and table —
            so the page doesn't pop in two stages (§81–83). */}
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
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
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <StatTile label="Users" value={stats?.total_users ?? 0} tone="accent" icon="user" />
              <StatTile label="Active Pro" value={stats?.active_pro ?? 0} tone="inc" icon="zap" />
              <StatTile label="Uploads" value={stats?.total_uploads ?? 0} tone="net" icon="upload" />
              <StatTile label="Failed uploads" value={stats?.failed_uploads ?? 0} tone="exp" icon="alert" />
              <StatTile label="Errors logged" value={stats?.total_errors ?? 0} tone="dng" icon="shield" />
            </div>

            <Tabs tabs={tabs} active={tab} onChange={(k) => { setTab(k); setListPage(1); }} label="Admin sections" />

            <TabPanel tabKey={tab} className="space-y-6">
            {/* ------- USERS ------- */}
            {tab === 'users' && (
              users.length === 0 ? (
                <EmptyState icon="user" title="No users yet" desc="New sign-ups will appear here." />
              ) : (
                <div className="bento p-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-ticker text-txt-3 border-b border-bdr">
                        <th className="px-4 py-3 font-medium">User</th>
                        <th className="px-4 py-3 font-medium">Plan</th>
                        <th className="px-4 py-3 font-medium text-right">Uploads</th>
                        <th className="px-4 py-3 font-medium">Joined</th>
                        <th className="px-4 py-3 font-medium">Last activity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageSlice(users).map((u) => (
                        <tr key={u.id} className="border-b border-bdr/50 last:border-0">
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
                          <td className="px-4 py-3 text-txt-2 whitespace-nowrap">{fmtTime(u.created_at)}</td>
                          <td className="px-4 py-3 text-txt-2 whitespace-nowrap">{fmtTime(u.last_activity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {/* ------- ERRORS ------- */}
            {tab === 'errors' && (
              errors.length === 0 ? (
                <EmptyState icon="check" title="No errors logged" desc="Crashes and failed extractions will show here, with the stage and percentage they stopped at." />
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
                          {e.stage && <span className="text-xs text-txt-3">· {e.stage}{e.progress != null ? ` (${e.progress}%)` : ''}</span>}
                          {e.method && e.path && <span className="text-xs text-txt-3">· {e.method} {e.path}</span>}
                        </div>
                        {e.message && <p className="text-sm text-txt-2 mt-1 break-words">{e.message}</p>}
                        <p className="font-mono text-[11px] text-txt-3 mt-1">
                          {fmtTime(e.created_at)}{e.user_id ? ` · user #${e.user_id}` : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {/* ------- ACTIVITY ------- */}
            {tab === 'activity' && (
              activity.length === 0 ? (
                <EmptyState icon="bell" title="No activity yet" desc="Sign-ins, uploads and account events across all users appear here." />
              ) : (
                <div className="bento p-0 divide-y divide-bdr/50">
                  {pageSlice(activity).map((a) => (
                    <div key={a.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-sm text-txt-1">{a.event.replace(/_/g, ' ')}</span>
                        {a.user_id && <span className="text-xs text-txt-3 ml-2">user #{a.user_id}</span>}
                      </div>
                      <span className="font-mono text-[11px] text-txt-3 whitespace-nowrap">{fmtTime(a.created_at)}</span>
                    </div>
                  ))}
                </div>
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
    </AppShell>
  );
};

export default AdminDashboardPage;
