import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MobileShell } from "@/components/pl/MobileShell";
import { GlobalAutoTranslate } from "@/components/pl/GlobalAutoTranslate";
import Dashboard from "@/pages/Dashboard";
import Analysis from "@/pages/Analysis";
import Assistant from "@/pages/Assistant";
import Markets from "@/pages/Markets";
import More from "@/pages/More";
import SignIn from "@/pages/SignIn";
import SignUp from "@/pages/SignUp";
import Bookkeeping from "@/pages/Bookkeeping";
import BusinessLedger from "@/pages/BusinessLedger";
import PersonalSpending from "@/pages/PersonalSpending";
import Upgrade from "@/pages/Upgrade";
import ActionPlan from "@/pages/ActionPlan";
import Profile from "@/pages/Profile";
import Upload from "@/pages/Upload";
import Reconciliation from "@/pages/Reconciliation";
import BackendSettings from "@/pages/BackendSettings";
import Landing from "@/pages/Landing";
import Terms from "@/pages/Terms";
import Privacy from "@/pages/Privacy";
import NotFound from "@/pages/NotFound";
import { useBackButton } from "@/hooks/use-back-button";
import { useBackgroundSignout } from "@/hooks/use-background-signout";
import { ErrorBoundary } from "@/components/pl/ErrorBoundary";
// @ts-ignore — pure JS module shared with the web client
import { useAuth, bootSession } from "@/data/authStore";
// @ts-ignore — pure JS module shared with the web client
import { fetchMe } from "@/data/api";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    },
  },
});

const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const { token } = useAuth();
  const location = useLocation();
  if (!token) {
    return <Navigate to="/signin" replace state={{ from: location }} />;
  }
  return children;
};

const PublicOnlyRoute = ({ children }: { children: JSX.Element }) => {
  const { token } = useAuth();
  if (token) return <Navigate to="/" replace />;
  return children;
};

/* Root route picks the right surface based on auth: signed-in users see
   the Dashboard inside the MobileShell, everyone else gets the marketing
   landing page (mirrors the PWA at pesalens.com so first-run feels the
   same whether the user installed the APK or added the PWA from Chrome). */
const RootRoute = () => {
  const { token } = useAuth();
  if (token) return <MobileShell />;
  return <Landing />;
};

const SessionBootstrap = () => {
  const { token } = useAuth();
  useEffect(() => {
    if (token) {
      fetchMe().catch(() => {
        /* /auth/me will route on 401 */
      });
    }
  }, [token]);
  return null;
};

/* Mounts Capacitor's hardware back-button handler. Lives inside the
   Router so it can call navigate(-1) — pressing back inside the app
   now steps through the SPA history instead of closing the WebView. */
const BackButtonBridge = () => {
  useBackButton();
  return null;
};

/* Mounts the 30-second background-then-sign-out timer. Fires only when a
   session exists, so guest screens are unaffected. See
   hooks/use-background-signout.ts for the rationale (matches the user's
   spec: "the system in the background should hold the session for about
   30 seconds before signing out automatically"). */
const BackgroundSignoutBridge = () => {
  useBackgroundSignout();
  return null;
};

// Cold-launch boot — runs the silent /auth/refresh against the
// Capacitor-Preferences-stored refresh token before first paint, so a
// returning user's <ProtectedRoute> doesn't flash the sign-in page.
// Migration of legacy localStorage tokens lives inside bootSession too.
const App = () => {
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    bootSession().finally(() => setBooted(true));
  }, []);
  if (!booted) {
    return (
      <div className="min-h-screen bg-deep flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
      </div>
    );
  }
  return (
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <GlobalAutoTranslate>
      <BrowserRouter>
        <SessionBootstrap />
        <BackButtonBridge />
        <BackgroundSignoutBridge />
        <Routes>
          {/* Public auth */}
          <Route path="/signin" element={<PublicOnlyRoute><SignIn /></PublicOnlyRoute>} />
          <Route path="/signup" element={<PublicOnlyRoute><SignUp /></PublicOnlyRoute>} />
          {/* Backend config — always registered. The SignIn page links
              here for "Backend unreachable?" recovery, and the More menu
              links here from the Account group, so the route must exist
              in every build (debug AND release). Previously this was
              gated on VITE_PESALENS_BUILD !== "prod"; that gate kept
              flipping back on whenever .env.production was reloaded and
              left the SignIn link pointing at a dead route. */}
          <Route path="/backend" element={<BackendSettings />} />
          {/* Legal pages — public so users can read them before signing
              up, and any time after from More → Legal. */}
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />

          {/* Root "/" — Landing (marketing) for guests, Dashboard inside
              MobileShell for users. RootRoute swaps the surface; the
              nested index route is what MobileShell's <Outlet /> renders. */}
          <Route path="/" element={<RootRoute />}>
            <Route index element={<Dashboard />} />
          </Route>

          {/* All other in-app routes are auth-only and render inside
              the MobileShell chrome. Guests hitting these URLs get
              bounced to /signin via ProtectedRoute. */}
          <Route element={<ProtectedRoute><MobileShell /></ProtectedRoute>}>
            <Route path="/analysis" element={<Analysis />} />
            <Route path="/assistant" element={<Assistant />} />
            <Route path="/markets" element={<Markets />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/reconciliation" element={<Reconciliation />} />
            <Route path="/bookkeeping" element={<Bookkeeping />} />
            <Route path="/business-ledger" element={<BusinessLedger />} />
            <Route path="/personal-spending" element={<PersonalSpending />} />
            <Route path="/action-plan" element={<ActionPlan />} />
            <Route path="/upgrade" element={<Upgrade />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/more" element={<More />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
      </GlobalAutoTranslate>
    </TooltipProvider>
  </QueryClientProvider>
  </ErrorBoundary>
  );
};

export default App;
