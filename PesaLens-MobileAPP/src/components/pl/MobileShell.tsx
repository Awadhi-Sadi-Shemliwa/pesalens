import { useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  ListTree,
  Sparkles,
  LineChart,
  MoreHorizontal,
  Bell,
} from "lucide-react";
import { TickerStrip } from "./TickerStrip";
import { cn } from "@/lib/utils";
// @ts-ignore — JS module
import { useAuth } from "@/data/authStore";
// @ts-ignore — JS module
import { useTheme } from "@/data/theme";
// @ts-ignore — JS module
import { useT } from "@/data/i18n";

const initialsOf = (name?: string | null, email?: string | null) => {
  const source = (name || email || "").trim();
  if (!source) return "PL";
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
};

const trialBadge = (user: any, t: (k: string) => string) => {
  if (!user) return null;
  if (user.plan === "pro") return null;
  if (user.plan === "expired") return { label: t("nav.trialEnded"), tone: "dng" as const };
  if (user.trial_started_at) {
    const start = new Date(user.trial_started_at).getTime();
    const elapsed = Date.now() - start;
    const left = Math.max(0, 14 - Math.floor(elapsed / (1000 * 60 * 60 * 24)));
    return { label: t("nav.trialDays").replace("{n}", String(left)), tone: "exp" as const };
  }
  return { label: "TRIAL", tone: "exp" as const };
};

export const MobileShell = () => {
  const loc = useLocation();
  const { user } = useAuth();
  const [theme] = useTheme();
  const { t } = useT();

  // Tabs and page titles. Strings stay in English here — the
  // GlobalAutoTranslate provider in App.tsx swaps them to Swahili at
  // render time so we never have to hand-write Swahili in shell code.
  const tabs = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/analysis", label: "Analysis", icon: ListTree },
    { to: "/assistant", label: "Assistant", icon: Sparkles },
    { to: "/markets", label: "Markets", icon: LineChart },
    { to: "/more", label: "More", icon: MoreHorizontal },
  ];

  const titleMap: Record<string, string> = {
    "/": "Dashboard",
    "/analysis": "Analysis",
    "/assistant": "AI Assistant",
    "/markets": "Markets",
    "/upload": "Upload",
    "/bookkeeping": "Bookkeeping",
    "/business-ledger": "Business Ledger",
    "/personal-spending": "Spending",
    "/action-plan": "Action Plan",
    "/upgrade": "Upgrade",
    "/profile": "Profile",
    "/more": "More",
  };
  const title = titleMap[loc.pathname] ?? "PesaLens";

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  const initials = initialsOf(user?.full_name, user?.email);
  const badge = trialBadge(user, t);

  return (
    <div className="h-shell bg-deep flex justify-center overflow-hidden">
      <div className="w-full max-w-[440px] h-full bg-deep flex flex-col relative shadow-lift md:my-4 md:rounded-[32px] md:overflow-hidden md:border md:border-border">
        {/* Top safe area — keeps content below the OS status bar */}
        <div className="pt-safe bg-surface-1" />

        {/* iOS/Chase-style Header with blur */}
        <header className="ios-header px-5 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-accent flex items-center justify-center font-mono-tab text-[14px] font-bold text-white shadow-sm shrink-0">
              P
            </div>
            <div className="min-w-0">
              <h1 className="text-[20px] font-bold leading-tight truncate">{title}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            {badge && (
              <span
                className={cn(
                  "hidden xs:inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide",
                  badge.tone === "exp" && "bg-exp/15 text-exp",
                  badge.tone === "dng" && "bg-dng/15 text-dng"
                )}
              >
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full animate-pulse-dot",
                    badge.tone === "exp" ? "bg-exp" : "bg-dng"
                  )}
                />
                {badge.label}
              </span>
            )}
            <button
              className="w-10 h-10 rounded-full bg-surface-2/80 border border-border/50 flex items-center justify-center text-txt-2 hover:text-txt-1 transition-colors ios-press"
              aria-label="Notifications"
            >
              <Bell className="w-4.5 h-4.5" />
            </button>
            <NavLink
              to="/profile"
              className="w-10 h-10 rounded-full bg-gradient-to-br from-accent to-net text-white flex items-center justify-center text-[13px] font-bold shadow-sm ios-press"
              aria-label="Profile"
            >
              {initials}
            </NavLink>
          </div>
        </header>

        {/* Region/Locale indicator — iOS style subtle bar */}
        <div className="px-5 py-1.5 bg-surface-1/50 border-b border-border/30">
          <div className="text-[11px] font-medium text-txt-3 tracking-wide">
            Tanzania · TZS
          </div>
        </div>

        <TickerStrip />

        {/* Only this region scrolls — header and bottom nav stay pinned. */}
        <main className="flex-1 overflow-y-auto overscroll-contain scroll-hide">
          <Outlet />
        </main>

        {/* iOS/Chase-style Tab Bar with heavy blur */}
        <nav className="ios-tabbar px-1 pt-2 pb-1 flex items-stretch justify-around shrink-0">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  cn(
                    "flex flex-col items-center gap-1 flex-1 py-1.5 rounded-xl transition-all duration-200",
                    isActive
                      ? "text-accent"
                      : "text-txt-3 hover:text-txt-2"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <div className={cn(
                      "p-1 rounded-lg transition-all duration-200",
                      isActive && "bg-accent/10"
                    )}>
                      <Icon
                        className={cn("w-5 h-5 transition-transform duration-200", isActive && "scale-105")}
                        strokeWidth={isActive ? 2.2 : 1.8}
                      />
                    </div>
                    <span className={cn(
                      "text-[10px] font-semibold tracking-wide transition-all duration-200",
                      isActive ? "opacity-100" : "opacity-70"
                    )}>
                      {t.label}
                    </span>
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>
      </div>
    </div>
  );
};
