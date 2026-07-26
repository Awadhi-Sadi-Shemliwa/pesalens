import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users, Zap, Upload as UploadIcon, AlertTriangle, ShieldAlert,
  Trash2, MessageSquare, Star, RefreshCw,
} from "lucide-react";
import { Eyebrow, Bento, Badge, EmptyState, Skeleton, ErrorState, Segmented, Sheet } from "@/components/pl/primitives";
// @ts-ignore — JS modules
import {
  fetchAdminStats, fetchAdminUsers, fetchAdminErrors, fetchAdminActivity,
  fetchAdminFeedback, fetchAdminUserTimeline,
} from "@/data/api";
// @ts-ignore — JS modules
import { useAuth } from "@/data/authStore";

/* Owner console, phone-sized.

   Same job as the web console — what is failing, who deleted what, what
   testers said — but the filters have to earn their space on a small screen,
   so only the two that answer real questions survive: a recency window
   ("is it broken right now") and a group ("deletions" / "problems"). Tapping
   any row opens that user's whole story, which is the one view that explains
   HOW something failed rather than just that it did. */

type Tab = "users" | "errors" | "activity" | "feedback";

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

const SOURCE_TONE: Record<string, "accent" | "inc" | "exp" | "dng" | "net" | "muted"> = {
  server: "dng", pipeline: "exp", handled: "net", web: "accent", mobile: "accent",
};

/* One line of "what was this about", read off the audit row's details snapshot.
   "Receipt deleted" is useless on its own; "Receipt deleted · Shell Masaki ·
   TZS 45,000" answers the support ticket. */
const detailLine = (d: any): string | null => {
  if (!d) return null;
  const bits: string[] = [];
  if (d.vendor) bits.push(d.vendor);
  if (typeof d.amount === "number") bits.push(`TZS ${d.amount.toLocaleString()}`);
  else if (typeof d.total === "number") bits.push(`${d.currency || "TZS"} ${Number(d.total).toLocaleString()}`);
  if (d.entry_date || d.date) bits.push(d.entry_date || d.date);
  if (d.filename) bits.push(d.filename);
  if (typeof d.receipts === "number" || typeof d.personal_entries === "number") {
    bits.push(`${d.receipts || 0} receipts + ${d.personal_entries || 0} entries removed`);
  }
  if (d.code) bits.push(d.code);
  if (typeof d.rating === "number") bits.push(`rated ${d.rating}/5`);
  if (Array.isArray(d.providers) && d.providers.length) bits.push(d.providers.join(", "));
  return bits.join(" · ") || null;
};

const WINDOWS = [
  { key: "", label: "All" },
  { key: "24", label: "24h" },
  { key: "168", label: "7d" },
];

const Chip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: any }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`px-2.5 py-1 rounded-full text-[12px] font-medium border press whitespace-nowrap transition ${
      active
        ? "bg-accent/15 text-accent border-accent/30"
        : "bg-surface-3 text-txt-2 border-border"
    }`}
  >
    {children}
  </button>
);

/* ---------------- per-user drill-down ---------------- */

const UserTimeline = ({ userId, onClose }: { userId: number | null; onClose: () => void }) => {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<any>(null);
  /* Retain the last payload so the sheet still has content while it animates
     out — clearing it on close would blank the panel mid-exit. */
  const [last, setLast] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    if (userId == null) return undefined;
    setData(null);
    setErr(null);
    fetchAdminUserTimeline(userId)
      .then((d: any) => { if (!cancelled) { setData(d); setLast(d); } })
      .catch((e: any) => { if (!cancelled) setErr(e); });
    return () => { cancelled = true; };
  }, [userId]);

  const shown = data || last;
  const u = shown?.user;

  return (
    <Sheet open={userId != null} onClose={onClose} eyebrow="User" title={u?.email || "Loading…"}>
      {err ? (
        <ErrorState title="Couldn’t load this user" cause={err?.message} timestamp={Date.now()} />
      ) : !shown ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={u.pro_active ? "inc" : "muted"}>{u.pro_active ? "Pro" : u.plan || "trial"}</Badge>
            <Badge tone="muted">{u.account_type || "personal"}</Badge>
            <Badge tone={u.email_verified ? "inc" : "exp"}>{u.email_verified ? "Verified" : "Unverified"}</Badge>
            <span className="text-[11px] text-txt-3">Joined {fmt(u.created_at)}</span>
          </div>

          {shown.uploads?.length > 0 && (
            <div>
              <Eyebrow>Statements</Eyebrow>
              <div className="mt-2 space-y-1.5">
                {shown.uploads.map((up: any) => (
                  <div key={up.job_id} className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="truncate text-txt-2 min-w-0">{up.filename || up.job_id}</span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {up.status === "failed" && up.stage && (
                        <span className="text-[10px] text-exp">
                          {up.stage}{up.progress != null ? ` ${up.progress}%` : ""}
                        </span>
                      )}
                      <Badge tone={up.status === "failed" ? "dng" : up.status === "done" ? "inc" : "muted"}>
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
            {shown.timeline?.length === 0 ? (
              <p className="text-[13px] text-txt-3 mt-2">Nothing recorded for this account yet.</p>
            ) : (
              <div className="mt-2 divide-y divide-border/40">
                {shown.timeline.map((i: any) => (
                  <div key={i.id} className="py-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-mono-tab text-[11px] font-bold ${
                        i.kind === "error" || i.failure ? "text-exp" : i.destructive ? "text-dng" : "text-txt-1"
                      }`}>
                        {i.event}
                      </span>
                      {i.ref && <span className="font-mono-tab text-[10px] text-txt-3">{i.ref}</span>}
                      {i.source && <Badge tone={SOURCE_TONE[i.source] || "muted"}>{i.source}</Badge>}
                    </div>
                    {i.message && <p className="text-[12px] text-txt-2 mt-1 break-words">{i.message}</p>}
                    {detailLine(i.details) && (
                      <p className="text-[11px] text-txt-3 mt-0.5 break-words">{detailLine(i.details)}</p>
                    )}
                    {(i.stage || i.progress != null) && (
                      <p className="text-[10px] text-txt-3 mt-0.5">
                        {i.stage}{i.progress != null ? ` · ${i.progress}%` : ""}
                      </p>
                    )}
                    <p className="font-mono-tab text-[10px] text-txt-3 mt-0.5">{fmt(i.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
};

/* ---------------- page ---------------- */

const Admin = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("users");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [errors, setErrors] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [feedback, setFeedback] = useState<any[]>([]);

  const [errHours, setErrHours] = useState("");
  const [errSource, setErrSource] = useState("");
  const [actGroup, setActGroup] = useState("");
  const [openUser, setOpenUser] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [s, u, e, a, f] = await Promise.all([
        fetchAdminStats(),
        fetchAdminUsers(),
        fetchAdminErrors({ hours: errHours, source: errSource }),
        fetchAdminActivity({ group: actGroup }),
        fetchAdminFeedback(),
      ]);
      setStats(s);
      setUsers(u?.users || []);
      setErrors(e?.errors || []);
      setActivity(a?.activity || []);
      setFeedback(f?.feedback || []);
    } catch (e: any) {
      // Only bounce when the server has confirmed this account is not an admin
      // (is_admin === false). A 404 while the user IS flagged admin means a
      // misconfig (wrong API base / proxy path) — surface it instead of
      // silently redirecting a genuine admin away.
      if (e?.status === 404 && user?.is_admin === false) { navigate("/"); return; }
      setErr(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && user.is_admin === false) { navigate("/"); return; }
    load(); /* eslint-disable-next-line */
  }, [user?.is_admin]);

  // Re-query on the server when a filter changes. Filtering the already-capped
  // page on the client would only search the newest 100 rows and quietly miss
  // everything older — which is exactly the data a recency filter is for.
  useEffect(() => {
    if (loading) return undefined;
    let cancelled = false;
    fetchAdminErrors({ hours: errHours, source: errSource })
      .then((e: any) => { if (!cancelled) setErrors(e?.errors || []); })
      .catch(() => {});
    return () => { cancelled = true; };
    /* eslint-disable-next-line */
  }, [errHours, errSource]);

  useEffect(() => {
    if (loading) return undefined;
    let cancelled = false;
    fetchAdminActivity({ group: actGroup })
      .then((a: any) => { if (!cancelled) setActivity(a?.activity || []); })
      .catch(() => {});
    return () => { cancelled = true; };
    /* eslint-disable-next-line */
  }, [actGroup]);

  // Recency first: an all-time error count only ever goes up and never answers
  // the question you opened this page with, which is "is it broken now".
  const tiles = [
    { label: "Errors 24h", value: stats?.errors_24h ?? 0, Icon: ShieldAlert, tone: "text-dng" },
    { label: "Active 24h", value: stats?.active_24h ?? 0, Icon: Users, tone: "text-inc" },
    { label: "Deletes 7d", value: stats?.deletions_7d ?? 0, Icon: Trash2, tone: "text-exp" },
    { label: "Failed jobs", value: stats?.failed_uploads ?? 0, Icon: AlertTriangle, tone: "text-exp" },
    { label: "Users", value: stats?.total_users ?? 0, Icon: Users, tone: "text-accent" },
    { label: "Active Pro", value: stats?.active_pro ?? 0, Icon: Zap, tone: "text-inc" },
    { label: "Uploads", value: stats?.total_uploads ?? 0, Icon: UploadIcon, tone: "text-net" },
    {
      label: "Rating",
      value: stats?.avg_rating != null ? `${stats.avg_rating}/5` : "—",
      Icon: Star,
      tone: "text-accent",
    },
  ];

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Eyebrow>Owner console</Eyebrow>
          <h1 className="text-[22px] font-bold tracking-tight">System dashboard</h1>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          aria-label="Refresh"
          className="p-2.5 rounded-full bg-surface-3 border border-border press disabled:opacity-50"
        >
          <RefreshCw className="w-4 h-4 text-txt-2" />
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : err ? (
        <ErrorState title="Couldn’t load the dashboard" cause={err?.message} timestamp={Date.now()} onRetry={load} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {tiles.map((t) => (
              <Bento key={t.label} className="!p-3 flex items-center gap-2.5">
                <t.Icon className={`w-4.5 h-4.5 ${t.tone}`} />
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-txt-3 font-mono-tab truncate">{t.label}</div>
                  <div className="text-[17px] font-bold font-mono-tab">{t.value}</div>
                </div>
              </Bento>
            ))}
          </div>

          <Segmented<Tab>
            label="Admin views"
            value={tab}
            onChange={setTab}
            options={[
              { key: "users", label: "Users" },
              { key: "errors", label: "Errors" },
              { key: "activity", label: "Activity" },
              { key: "feedback", label: "Feedback" },
            ]}
          />

          {tab === "users" && (
            <div className="space-y-2">
              {users.map((u) => (
                <Bento
                  key={u.id}
                  onClick={() => setOpenUser(u.id)}
                  className="!p-3 flex items-center justify-between gap-3 active:bg-surface-3"
                >
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold truncate">{u.full_name || u.email}</div>
                    <div className="text-[11px] text-txt-3 truncate">{u.email}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {u.errors > 0 && <Badge tone="exp">{u.errors} issues</Badge>}
                    <Badge tone={u.pro_active ? "inc" : "muted"}>{u.pro_active ? "Pro" : u.plan || "trial"}</Badge>
                    <span className="text-[12px] font-mono-tab text-txt-2">{u.uploads}</span>
                  </div>
                </Bento>
              ))}
              {users.length === 0 && (
                <EmptyState kind="first-run" title="No users yet" desc="Accounts appear here as soon as someone signs up." />
              )}
              {users.length > 0 && (
                <p className="text-[11px] text-txt-3 px-1">Tap a user to see everything that happened to them, in order.</p>
              )}
            </div>
          )}

          {tab === "errors" && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                {WINDOWS.map((w) => (
                  <Chip key={w.key} active={errHours === w.key} onClick={() => setErrHours(w.key)}>{w.label}</Chip>
                ))}
                <span className="w-px h-4 bg-border mx-0.5" />
                <Chip active={errSource === ""} onClick={() => setErrSource("")}>Any</Chip>
                {["server", "pipeline", "handled", "web", "mobile"].map((s) => (
                  <Chip key={s} active={errSource === s} onClick={() => setErrSource(s)}>{s}</Chip>
                ))}
              </div>
              {errors.map((e) => (
                <Bento key={e.id} className="!p-3" onClick={() => e.user_id && setOpenUser(e.user_id)}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono-tab text-[11px] font-bold text-dng">{e.error_code}</span>
                    <Badge tone={SOURCE_TONE[e.source] || "muted"}>{e.source}</Badge>
                    <span className="font-mono-tab text-[10px] text-txt-3">{e.ref}</span>
                    {e.stage && <span className="text-[11px] text-txt-3">· {e.stage}{e.progress != null ? ` (${e.progress}%)` : ""}</span>}
                  </div>
                  {e.message && <p className="text-[12px] text-txt-2 mt-1 break-words">{e.message}</p>}
                  <p className="font-mono-tab text-[10px] text-txt-3 mt-1">
                    {fmt(e.created_at)}{e.user_email ? ` · ${e.user_email}` : e.user_id ? ` · user #${e.user_id}` : ""}
                  </p>
                </Bento>
              ))}
              {errors.length === 0 && (
                <EmptyState kind="first-run" title="No errors in this view" desc="Crashes, failed extractions, unreadable receipts and app-side problems land here with a timestamp." />
              )}
            </div>
          )}

          {tab === "activity" && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Chip active={actGroup === ""} onClick={() => setActGroup("")}>Everything</Chip>
                <Chip active={actGroup === "destructive"} onClick={() => setActGroup("destructive")}>Deletions</Chip>
                <Chip active={actGroup === "failure"} onClick={() => setActGroup("failure")}>Problems</Chip>
              </div>
              <div className="space-y-1.5">
                {activity.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => a.user_id && setOpenUser(a.user_id)}
                    className="w-full text-left flex items-start justify-between gap-3 px-1 py-2 border-b border-border/40 active:bg-surface-3"
                  >
                    <div className="min-w-0">
                      <span className={`text-[13px] capitalize ${
                        a.destructive ? "text-dng" : a.failure ? "text-exp" : "text-txt-1"
                      }`}>
                        {a.event.replace(/_/g, " ")}
                      </span>
                      <div className="text-[11px] text-txt-3 truncate">
                        {a.user_email || (a.user_id ? `user #${a.user_id}` : "")}
                      </div>
                      {detailLine(a.details) && (
                        <div className="text-[11px] text-txt-3 break-words">{detailLine(a.details)}</div>
                      )}
                    </div>
                    <span className="font-mono-tab text-[10px] text-txt-3 whitespace-nowrap shrink-0">{fmt(a.created_at)}</span>
                  </button>
                ))}
              </div>
              {activity.length === 0 && (
                <EmptyState kind="first-run" title="Nothing in this view" desc="Sign-ins, uploads, deletions and account events appear here as they happen." />
              )}
            </div>
          )}

          {tab === "feedback" && (
            <div className="space-y-2">
              {feedback.map((f) => (
                <Bento key={f.id} className="!p-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {f.rating != null && (
                      <Badge tone={f.rating >= 4 ? "inc" : f.rating <= 2 ? "dng" : "muted"}>{f.rating}/5</Badge>
                    )}
                    {f.client && <Badge tone="muted">{f.client}</Badge>}
                    <span className="text-[11px] text-txt-3 truncate">{f.user_email || `user #${f.user_id}`}</span>
                    <span className="font-mono-tab text-[10px] text-txt-3 ml-auto">{fmt(f.created_at)}</span>
                  </div>
                  {[
                    ["How it has been", f.experience],
                    ["What to improve", f.improvements],
                    ["Problem it solves best", f.problem_solved],
                    ["Who it is for", f.audience],
                    ["Would recommend to", f.referrals],
                  ].filter(([, v]) => v).map(([label, value]) => (
                    <div key={label as string}>
                      <div className="text-[10px] uppercase tracking-wider text-txt-3 font-mono-tab">{label}</div>
                      <p className="text-[13px] text-txt-1 mt-0.5 break-words whitespace-pre-wrap">{value}</p>
                    </div>
                  ))}
                </Bento>
              ))}
              {feedback.length === 0 && (
                <EmptyState
                  kind="first-run"
                  title="No feedback yet"
                  desc="Testers are asked once, when they first sign out. Their answers appear here."
                />
              )}
              {/* Response RATE, not a raw count — the count only ever goes up
                  and says nothing about whether the prompt is earning its
                  interruption. */}
              {stats?.feedback_rate != null && (
                <p className="text-[11px] text-txt-3 px-1 flex items-center gap-1.5">
                  <MessageSquare className="w-3 h-3" />
                  {stats.feedback_rate}% answered · {stats.feedback_responders} of{" "}
                  {(stats.feedback_responders || 0) + (stats.feedback_declined || 0)} asked
                </p>
              )}
            </div>
          )}
        </>
      )}

      <UserTimeline userId={openUser} onClose={() => setOpenUser(null)} />
    </div>
  );
};

export default Admin;
