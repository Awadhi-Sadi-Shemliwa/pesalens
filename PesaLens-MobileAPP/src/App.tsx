import { useEffect } from "react";
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
import BackendSettings from "@/pages/BackendSettings";
import NotFound from "@/pages/NotFound";
// @ts-ignore — pure JS module shared with the web client
import { useAuth } from "@/data/authStore";
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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <GlobalAutoTranslate>
      <BrowserRouter>
        <SessionBootstrap />
        <Routes>
          {/* Public auth */}
          <Route path="/signin" element={<PublicOnlyRoute><SignIn /></PublicOnlyRoute>} />
          <Route path="/signup" element={<PublicOnlyRoute><SignUp /></PublicOnlyRoute>} />
          {/* Backend config — reachable without auth so a tester can
              point the APK at a dev server before signing in. */}
          <Route path="/backend" element={<BackendSettings />} />

          {/* Authenticated workspace */}
          <Route element={<ProtectedRoute><MobileShell /></ProtectedRoute>}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/analysis" element={<Analysis />} />
            <Route path="/assistant" element={<Assistant />} />
            <Route path="/markets" element={<Markets />} />
            <Route path="/upload" element={<Upload />} />
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
);

export default App;
