import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Zap, Upload as UploadIcon, AlertTriangle, ShieldAlert } from "lucide-react";
import { Eyebrow, Bento, Badge, EmptyState, Skeleton, ErrorState, Segmented } from "@/components/pl/primitives";
// @ts-ignore — JS modules
import { fetchAdminStats, fetchAdminUsers, fetchAdminErrors, fetchAdminActivity } from "@/data/api";
// @ts-ignore — JS modules
import { useAuth } from "@/data/authStore";

type Tab = "users" | "errors" | "activity";

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

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

  const load = async () => {
    setLoading(true);
    setErr(null);
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

  const tiles = [
    { label: "Users", value: stats?.total_users ?? 0, Icon: Users, tone: "text-accent" },
    { label: "Active Pro", value: stats?.active_pro ?? 0, Icon: Zap, tone: "text-inc" },
    { label: "Uploads", value: stats?.total_uploads ?? 0, Icon: UploadIcon, tone: "text-net" },
    { label: "Failed", value: stats?.failed_uploads ?? 0, Icon: AlertTriangle, tone: "text-exp" },
    { label: "Errors", value: stats?.total_errors ?? 0, Icon: ShieldAlert, tone: "text-dng" },
  ];

  return (
    <div className="px-4 py-4 space-y-4">
      <Eyebrow>Owner console</Eyebrow>
      <h1 className="text-[22px] font-bold tracking-tight">System dashboard</h1>

      {loading ? (
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
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
                  <div className="text-[10px] uppercase tracking-wider text-txt-3 font-mono-tab">{t.label}</div>
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
            ]}
          />

          {tab === "users" && (
            <div className="space-y-2">
              {users.map((u) => (
                <Bento key={u.id} className="!p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold truncate">{u.full_name || u.email}</div>
                    <div className="text-[11px] text-txt-3 truncate">{u.email}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge tone={u.pro_active ? "inc" : "muted"}>{u.pro_active ? "Pro" : u.plan || "trial"}</Badge>
                    <span className="text-[12px] font-mono-tab text-txt-2">{u.uploads}</span>
                  </div>
                </Bento>
              ))}
              {users.length === 0 && (
                <EmptyState kind="first-run" title="No users yet" desc="Accounts appear here as soon as someone signs up." />
              )}
            </div>
          )}

          {tab === "errors" && (
            <div className="space-y-2">
              {errors.map((e) => (
                <Bento key={e.id} className="!p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono-tab text-[11px] font-bold text-dng">{e.error_code}</span>
                    {e.stage && <span className="text-[11px] text-txt-3">· {e.stage}{e.progress != null ? ` (${e.progress}%)` : ""}</span>}
                  </div>
                  {e.message && <p className="text-[12px] text-txt-2 mt-1 break-words">{e.message}</p>}
                  <p className="font-mono-tab text-[10px] text-txt-3 mt-1">{fmt(e.created_at)}{e.user_id ? ` · user #${e.user_id}` : ""}</p>
                </Bento>
              ))}
              {errors.length === 0 && (
                <EmptyState kind="first-run" title="No errors logged" desc="Nothing has failed yet. Failed uploads and server errors land here with a timestamp." />
              )}
            </div>
          )}

          {tab === "activity" && (
            <div className="space-y-1.5">
              {activity.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 px-1 py-2 border-b border-border/40">
                  <span className="text-[13px] capitalize truncate">{a.event.replace(/_/g, " ")}{a.user_id ? ` · #${a.user_id}` : ""}</span>
                  <span className="font-mono-tab text-[10px] text-txt-3 whitespace-nowrap">{fmt(a.created_at)}</span>
                </div>
              ))}
              {activity.length === 0 && (
                <EmptyState kind="first-run" title="No activity yet" desc="Sign-ins, uploads and payments appear here as they happen." />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Admin;
