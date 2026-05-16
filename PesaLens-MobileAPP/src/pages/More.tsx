import { useNavigate } from "react-router-dom";
import { Section, Eyebrow, Divider } from "@/components/pl/primitives";
import {
  Receipt,
  Wallet,
  Target,
  Crown,
  User,
  Globe,
  Moon,
  Sun,
  LogOut,
  ChevronRight,
  Upload as UploadIcon,
  Server,
  BookOpen,
  Scale,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
// @ts-ignore — JS modules
import { useAuth, clearSession } from "@/data/authStore";
// @ts-ignore — JS modules
import { useUserType } from "@/data/userStore";
// @ts-ignore — JS modules
import { useTheme } from "@/data/theme";
// @ts-ignore — JS modules
import { useT, setLang as setI18nLang } from "@/data/i18n";

const More = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [accountType] = useUserType();
  const [theme, toggleTheme] = useTheme();
  const { t, lang } = useT();

  const isBusiness = (user?.account_type || accountType) === "business";

  const workspaceItems = [
    {
      icon: UploadIcon,
      title: "Upload statement",
      sub: "Add a bank or mobile-money PDF",
      onClick: () => navigate("/upload"),
    },
    {
      icon: Scale,
      title: "Reconcile money",
      sub: "Match withdrawals to receipts & entries",
      tone: "accent" as const,
      onClick: () => navigate("/reconciliation"),
    },
    isBusiness
      ? {
          icon: Receipt,
          title: "Bookkeeping",
          sub: "Receipts, patterns & insights",
          badge: "Business",
          onClick: () => navigate("/bookkeeping"),
        }
      : {
          icon: Wallet,
          title: "Personal Spending",
          sub: "Manual entries & receipts",
          onClick: () => navigate("/personal-spending"),
        },
    ...(isBusiness
      ? [
          {
            icon: BookOpen,
            title: "Business Ledger",
            sub: "Manual entries · monthly P&L & Balance Sheet PDF",
            badge: "Business",
            onClick: () => navigate("/business-ledger"),
          },
        ]
      : []),
    {
      icon: Target,
      title: "Action Plan",
      sub: "Top mistakes, opportunities, 30-day plan",
      tone: "accent" as const,
      onClick: () => navigate("/action-plan"),
    },
    {
      icon: Crown,
      title: user?.plan === "pro" ? "Manage Pro" : "Upgrade to Pro",
      sub: user?.plan === "pro" ? "Renews automatically" : "Unlimited uploads · trial active",
      tone: "exp" as const,
      onClick: () => navigate("/upgrade"),
    },
  ];

  const accountItems = [
    {
      icon: User,
      title: "Profile",
      sub: `${user?.full_name || user?.email || "—"} · ${user?.account_type || accountType}`,
      onClick: () => navigate("/profile"),
    },
    {
      icon: Globe,
      title: t("nav.language"),
      sub: lang === "sw" ? "Kiswahili · English" : "English · Kiswahili",
      onClick: () => {
        // Route through the i18n module so every t() consumer re-renders
        // and the storage key matches what i18n reads on boot.
        setI18nLang(lang === "en" ? "sw" : "en");
      },
    },
    {
      icon: theme === "light" ? Sun : Moon,
      title: "Theme",
      sub: theme === "light" ? "Light" : "Dark",
      onClick: () => toggleTheme(),
    },
    // Backend override is always available so a stuck APK can be
    // re-pointed at a working server without rebuilding. The route is
    // also registered in every build (see App.tsx) — previously this
    // menu entry was gated on VITE_PESALENS_BUILD which kept hiding the
    // page on production rebuilds.
    {
      icon: Server,
      title: "Backend",
      sub: "Point this APK at a PesaLens server",
      onClick: () => navigate("/backend"),
    },
    {
      icon: LogOut,
      title: "Sign out",
      sub: "End this session",
      tone: "dng" as const,
      onClick: () => {
        clearSession();
        navigate("/signin", { replace: true });
      },
    },
  ];

  const legalItems = [
    {
      icon: ScrollText,
      title: "Terms of Service",
      sub: "Rules, plan terms, liability — read before relying on figures",
      onClick: () => navigate("/terms"),
    },
    {
      icon: ShieldCheck,
      title: "Privacy Policy",
      sub: "What we collect, how it's used, your rights & data export",
      onClick: () => navigate("/privacy"),
    },
  ];

  const groups = [
    { label: "Workspace", items: workspaceItems },
    { label: "Account", items: accountItems },
    { label: "Legal", items: legalItems },
  ];

  return (
    <div className="px-4 py-4 space-y-5">
      {groups.map((g) => (
        <Section key={g.label} eyebrow={g.label} title={g.label}>
          <div className="card-soft !p-0 overflow-hidden">
            {g.items.map((it: any, i: number) => {
              const Icon = it.icon;
              const tone = it.tone as string | undefined;
              return (
                <div key={it.title}>
                  <button
                    onClick={it.onClick}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-surface-3 transition-colors"
                  >
                    <div
                      className={`w-10 h-10 rounded-md flex items-center justify-center shrink-0 ${
                        tone === "accent" ? "bg-accent/15 text-accent"
                        : tone === "exp" ? "bg-exp/15 text-exp"
                        : tone === "dng" ? "bg-dng/15 text-dng"
                        : "bg-surface-3 text-txt-2"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-semibold">{it.title}</span>
                        {it.badge && (
                          <span className="text-[9px] font-mono-tab font-bold tracking-wider uppercase bg-surface-4 text-txt-3 px-1.5 py-0.5 rounded">
                            {it.badge}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-txt-3 mt-0.5 truncate">{it.sub}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-txt-4 shrink-0" />
                  </button>
                  {i < g.items.length - 1 && <Divider />}
                </div>
              );
            })}
          </div>
        </Section>
      ))}

      <div className="text-center pt-4">
        <Eyebrow>PESALENS · v1.0.0</Eyebrow>
        <p className="text-[10px] text-txt-4 mt-1 font-mono-tab">Built in Tanzania</p>
      </div>
    </div>
  );
};

export default More;
