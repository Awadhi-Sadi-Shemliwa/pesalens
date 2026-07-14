import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Globe, LogOut, Mail, Moon, Sun, ShieldCheck, ShieldAlert,
  Lock, Download, Trash2, User as UserIcon, KeyRound,
} from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, CardSoft, Eyebrow, PasswordField, Section } from "@/components/pl/primitives";
import { passwordRulesMet } from "@/data/password";
// @ts-ignore — JS modules
import { useAuth } from "@/data/authStore";
// @ts-ignore — JS modules
import {
  signOut, sendVerifyEmail, confirmVerifyEmail,
  changePassword, exportMyData, deleteMyAccount, fetchMe,
} from "@/data/api";
// @ts-ignore — JS modules
import { useUserType } from "@/data/userStore";
// @ts-ignore — JS modules
import { useTheme } from "@/data/theme";
// @ts-ignore — JS modules
import { useT, setLang as setI18nLang } from "@/data/i18n";

const Profile = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [accountType, setAccountType] = useUserType();
  const [theme, toggleTheme] = useTheme();
  const { t, lang } = useT();

  useEffect(() => { fetchMe().catch(() => { /* ignore */ }); }, []);

  const setLanguage = (next: string) => setI18nLang(next);

  const handleSignOut = async () => {
    await signOut();
    toast.success("Signed out");
    navigate("/signin", { replace: true });
  };

  const planLabel =
    user?.plan === "pro"
      ? t("nav.proActive").split(" ")[0]
      : user?.plan === "expired"
      ? t("nav.trialEnded")
      : "Trial";

  // ---- verify email ----
  const [verify, setVerify] = useState({ phase: "idle", code: "", msg: "" });
  const startVerify = async () => {
    setVerify({ phase: "sending", code: "", msg: "" });
    try {
      await sendVerifyEmail();
      setVerify({ phase: "awaiting", code: "", msg: "Code sent — check your email." });
    } catch (err: any) {
      setVerify({ phase: "idle", code: "", msg: err?.message || "Could not send code." });
    }
  };
  const submitVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerify((s) => ({ ...s, phase: "submitting" }));
    try {
      await confirmVerifyEmail(verify.code.trim());
      setVerify({ phase: "done", code: "", msg: "Email verified." });
      fetchMe().catch(() => {});
    } catch (err: any) {
      setVerify((s) => ({ ...s, phase: "awaiting", msg: err?.message || "Invalid or expired code." }));
    }
  };

  // ---- change password ----
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState({ tone: "", text: "" });

  // Same predicate the PasswordField checklist renders, so the button and the
  // checklist can never disagree (password-field.md #4).
  const pwMatch = pw.confirm.length > 0 && pw.next === pw.confirm;
  const pwAllOk = passwordRulesMet(pw.next) && pwMatch && pw.current.length > 0;

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg({ tone: "", text: "" });
    if (!passwordRulesMet(pw.next))
      return setPwMsg({ tone: "dng", text: "New password must be 8+ characters and contain a letter and a number." });
    if (pw.next !== pw.confirm) return setPwMsg({ tone: "dng", text: "New passwords do not match." });
    setPwBusy(true);
    try {
      await changePassword({ currentPassword: pw.current, newPassword: pw.next });
      setPwMsg({ tone: "inc", text: "Password changed. Signing you out…" });
      setPw({ current: "", next: "", confirm: "" });
      setTimeout(() => signOut().finally(() => navigate("/signin", { replace: true })), 1200);
    } catch (err: any) {
      setPwMsg({ tone: "dng", text: err?.message || "Could not change password." });
    } finally {
      setPwBusy(false);
    }
  };

  // ---- export ----
  const [exportBusy, setExportBusy] = useState(false);
  const downloadExport = async () => {
    setExportBusy(true);
    try {
      const data = await exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pesalens-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      /* The download lands outside the control the user pressed, so the
         confirmation belongs in a toast rather than in the field (§65). */
      toast.success("Data exported", { description: "Your JSON download has started." });
    } catch (err: any) {
      toast.error("Export failed", { description: err?.message || "We couldn't build your data export." });
    } finally {
      setExportBusy(false);
    }
  };

  // ---- delete ----
  const [delConfirm, setDelConfirm] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState("");
  const [delOpen, setDelOpen] = useState(false);
  const deleteAccount = async () => {
    setDelErr("");
    if (delConfirm !== "DELETE") return setDelErr("Type DELETE in capital letters to confirm.");
    setDelBusy(true);
    try {
      await deleteMyAccount();
      toast.success("Account deleted");
      navigate("/signin", { replace: true });
    } catch (err: any) {
      setDelErr(err?.message || "Could not delete account.");
      toast.error("Could not delete account", { description: err?.message });
    } finally {
      setDelBusy(false);
    }
  };

  return (
    <div className="px-4 py-4 space-y-5">
      {/* Premium gradient profile hero */}
      <div className="rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/20 via-net/10 to-transparent p-5 relative overflow-hidden">
        <span aria-hidden className="absolute -right-8 -top-8 w-28 h-28 rounded-full bg-accent/15 blur-2xl pointer-events-none" />
        <div className="relative flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-accent to-net text-white flex items-center justify-center font-bold shadow-sm shrink-0">
            <UserIcon className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-bold truncate">{user?.full_name || "—"}</div>
            <div className="text-[12px] text-txt-2 truncate flex items-center gap-1">
              <Mail className="w-3.5 h-3.5" /> {user?.email || "—"}
            </div>
          </div>
          <Badge tone={user?.plan === "pro" ? "inc" : user?.plan === "expired" ? "dng" : "exp"}>
            {planLabel}
          </Badge>
        </div>
        <div className="relative mt-3 flex items-center gap-2 text-[11px]">
          {user?.email_verified ? (
            <span className="inline-flex items-center gap-1 text-inc bg-inc/10 border border-inc/30 rounded-md px-2 py-1 font-mono-tab uppercase tracking-ticker">
              <ShieldCheck className="w-3 h-3" /> Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-exp bg-exp/10 border border-exp/30 rounded-md px-2 py-1 font-mono-tab uppercase tracking-ticker">
              <ShieldAlert className="w-3 h-3" /> Unverified
            </span>
          )}
        </div>
      </div>

      {!user?.email_verified && (
        <Section eyebrow="Security" title="Verify your email">
          <CardSoft>
            {verify.phase === "idle" ? (
              <>
                <p className="text-[12px] text-txt-3 mb-3">
                  Required for password-reset emails and to enable payments.
                </p>
                <Button block onClick={startVerify}>Send verification code</Button>
                {verify.msg && <p className="text-[11px] text-dng mt-2">{verify.msg}</p>}
              </>
            ) : verify.phase === "sending" ? (
              <p className="text-[12px] text-txt-3">Sending…</p>
            ) : verify.phase === "done" ? (
              <p className="text-[12px] text-inc">{verify.msg}</p>
            ) : (
              <form onSubmit={submitVerify} className="space-y-2.5">
                <input
                  inputMode="numeric"
                  maxLength={8}
                  value={verify.code}
                  onChange={(e) => setVerify((s) => ({ ...s, code: e.target.value }))}
                  placeholder="123456"
                  className="w-full bg-surface-3 border border-border rounded-lg px-3 py-2.5 text-[14px] font-mono-tab tracking-widest"
                />
                {verify.msg && (
                  <p className={`text-[11px] ${verify.phase === "awaiting" && verify.msg.toLowerCase().includes("invalid") ? "text-dng" : "text-txt-3"}`}>
                    {verify.msg}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button type="submit" className="flex-1" loading={verify.phase === "submitting"} loadingLabel="Verifying…">
                    Verify
                  </Button>
                  <Button type="button" variant="secondary" className="flex-1" onClick={startVerify}>
                    Resend
                  </Button>
                </div>
              </form>
            )}
          </CardSoft>
        </Section>
      )}

      <Section eyebrow="Account type" title="How you use PesaLens">
        <div className="grid grid-cols-2 gap-2">
          {(["individual", "business"] as const).map((opt) => {
            const active = accountType === opt;
            return (
              <button
                key={opt}
                onClick={() => setAccountType(opt)}
                className={`card-soft !p-3 text-left ${active ? "border-accent/50 bg-accent/5" : ""}`}
              >
                <div className="text-[13px] font-semibold capitalize">{opt === "individual" ? "Personal" : "Business"}</div>
                <div className="text-[11px] text-txt-3 mt-0.5">
                  {opt === "individual" ? "Statements + receipts" : "Books + receipts"}
                </div>
              </button>
            );
          })}
        </div>
      </Section>

      <Section eyebrow={t("nav.language")} title={t("nav.language")}>
        <CardSoft className="!p-2 flex">
          {[
            { id: "en", label: "English" },
            { id: "sw", label: "Kiswahili" },
          ].map((l) => {
            const active = lang === l.id;
            return (
              <button
                key={l.id}
                onClick={() => setLanguage(l.id)}
                className={`flex-1 px-3 py-2 rounded-lg text-[13px] font-semibold flex items-center justify-center gap-2 ${
                  active ? "bg-accent text-white" : "text-txt-2"
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                {l.label}
              </button>
            );
          })}
        </CardSoft>
      </Section>

      <Section eyebrow="Theme" title="Appearance">
        <CardSoft className="!p-2 flex">
          {[
            { id: "dark", label: "Dark", Icon: Moon },
            { id: "light", label: "Light", Icon: Sun },
          ].map((opt) => {
            const active = theme === opt.id;
            const Icon = opt.Icon;
            return (
              <button
                key={opt.id}
                onClick={() => { if (theme !== opt.id) toggleTheme(); }}
                className={`flex-1 px-3 py-2 rounded-lg text-[13px] font-semibold flex items-center justify-center gap-2 ${
                  active ? "bg-accent text-white" : "text-txt-2"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {opt.label}
              </button>
            );
          })}
        </CardSoft>
      </Section>

      <Section eyebrow="Security" title="Change password">
        <CardSoft>
          {!pwOpen ? (
            <button
              onClick={() => setPwOpen(true)}
              className="w-full flex items-center gap-2 text-[13px] text-txt-1"
            >
              <KeyRound className="w-4 h-4 text-txt-2" /> Update sign-in password
            </button>
          ) : (
            <form onSubmit={submitPassword} className="space-y-3">
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
              {pwMsg.text && (
                <p className={`text-[11px] ${pwMsg.tone === "dng" ? "text-dng" : "text-inc"}`}>{pwMsg.text}</p>
              )}
              <div className="flex gap-2">
                {/* Submit stays inert until every rule has flipped (password-field.md #4). */}
                <Button type="submit" className="flex-1" disabled={!pwAllOk} loading={pwBusy} loadingLabel="Updating…">
                  Update password
                </Button>
                <Button type="button" variant="secondary" className="flex-1" onClick={() => { setPwOpen(false); setPwMsg({ tone: "", text: "" }); }}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </CardSoft>
      </Section>

      <Section eyebrow="Privacy" title="Your data">
        <CardSoft>
          <button
            onClick={downloadExport}
            disabled={exportBusy}
            className="w-full flex items-center gap-2 text-[13px] text-txt-1 disabled:opacity-60"
          >
            <Download className="w-4 h-4 text-txt-2" />
            {exportBusy ? "Preparing JSON…" : "Export my data (JSON)"}
          </button>
        </CardSoft>
      </Section>

      <Section eyebrow="Danger zone" title="Delete account">
        <CardSoft className="border border-dng/30">
          {!delOpen ? (
            <button
              onClick={() => setDelOpen(true)}
              className="w-full flex items-center gap-2 text-[13px] text-dng"
            >
              <Trash2 className="w-4 h-4" /> Delete account permanently
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-[12px] text-txt-3">
                This removes your account, every uploaded statement, every receipt, and your payment history. This cannot be undone.
              </p>
              <input
                value={delConfirm}
                onChange={(e) => setDelConfirm(e.target.value)}
                placeholder='Type "DELETE" to confirm'
                className="w-full bg-surface-3 border border-dng/30 rounded-lg px-3 py-2.5 text-[14px] font-mono-tab tracking-widest"
              />
              {delErr && <p className="text-[11px] text-dng">{delErr}</p>}
              <div className="flex gap-2">
                <button onClick={deleteAccount} disabled={delBusy || delConfirm !== "DELETE"}
                        className="flex-1 bg-dng text-white py-2.5 rounded-lg text-[13px] font-semibold disabled:opacity-50">
                  {delBusy ? "Deleting…" : "Delete forever"}
                </button>
                <button onClick={() => { setDelOpen(false); setDelConfirm(""); setDelErr(""); }}
                        className="flex-1 bg-surface-3 border border-border text-txt-2 py-2.5 rounded-lg text-[13px]">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </CardSoft>
      </Section>

      <button
        onClick={handleSignOut}
        className="w-full card-soft !p-3 flex items-center justify-center gap-2 text-dng text-[13px] font-semibold border border-dng/30"
      >
        <LogOut className="w-4 h-4" /> {t("nav.signout")}
      </button>

      <p className="text-[10px] text-txt-4 text-center font-mono-tab pt-2">
        PesaLens · v1.0.0 · {user?.id ? `User #${user.id}` : ""}
      </p>
    </div>
  );
};

export default Profile;
