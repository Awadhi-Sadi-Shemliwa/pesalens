import React, { useEffect, useState } from 'react';
import { Router, Route, PublicOnlyRoute } from './components/Router';
import ErrorBoundary from './components/ErrorBoundary';
import LandingPage from './pages/LandingPage';
import SignInPage from './pages/SignInPage';
import SignUpPage from './pages/SignUpPage';
import DashboardPage from './pages/DashboardPage';
import AnalysisPage from './pages/AnalysisPage';
import AssistantPage from './pages/AssistantPage';
import MarketsPage from './pages/MarketsPage';
import SimulatorPage from './pages/SimulatorPage';
import BookkeepingPage from './pages/BookkeepingPage';
import PersonalSpendingPage from './pages/PersonalSpendingPage';
import ReconciliationPage from './pages/ReconciliationPage';
import UpgradePage from './pages/UpgradePage';
import SettingsPage from './pages/SettingsPage';
import AdminDashboardPage from './pages/AdminDashboardPage';
import PrivacyPage from './pages/PrivacyPage';
import NotFoundPage from './pages/NotFoundPage';
import PWAInstallPrompt from './components/PWAInstallPrompt';
import { ToastProvider } from './components/common';
import { bootAuth, API_URL } from './data/api';
import { subscribeUnload } from './data/authStore';

const App = () => {
  // Block protected-route rendering until the silent-refresh handshake
  // resolves. Otherwise the Router would bounce a logged-in user to
  // /signin on every page reload.
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    // Migrate legacy hash-style URLs (#/dashboard, #/) to clean path URLs so old
    // bookmarks and shared links still land correctly after the switch to path
    // routing. The owner console is deliberately left on the fragment (#/admin),
    // so it is the one exception we DON'T rewrite. replaceState keeps it a single
    // history entry (no extra Back step).
    const h = window.location.hash;
    if (h && h.startsWith('#/') && h !== '#/admin') {
      window.history.replaceState({}, '', h.slice(1) || '/');
    }
    // Auto sign-out on tab close. See data/authStore.js::subscribeUnload
    // for the rationale (pagehide vs beforeunload, bfcache check).
    subscribeUnload(API_URL);
    bootAuth().finally(() => setBooted(true));
  }, []);

  if (!booted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-deep">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-bdr border-t-accent" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <Router>
        {/* Auth pages bounce signed-in users back to /dashboard so Back
            (or a stale URL) can never re-render them with the user's
            email pre-filled. PublicOnlyRoute waits for the silent-refresh
            boot to settle before deciding so a returning user doesn't
            see the landing page flash before being redirected. */}
        <PublicOnlyRoute path="/" component={LandingPage} />
        <PublicOnlyRoute path="/signin" component={SignInPage} />
        <PublicOnlyRoute path="/signup" component={SignUpPage} />
        {/* Legal pages — plain Route (no protected, no PublicOnly): readable
            whether signed in or out, and required by Google Ads policy. */}
        <Route path="/privacy" component={PrivacyPage} />
        <Route path="/upgrade" component={UpgradePage} protected />
        <Route path="/dashboard" component={DashboardPage} protected />
        <Route path="/analysis" component={AnalysisPage} protected />
        <Route path="/assistant" component={AssistantPage} protected />
        <Route path="/markets" component={MarketsPage} protected />
        <Route path="/simulator" component={SimulatorPage} protected />
        <Route path="/bookkeeping" component={BookkeepingPage} protected />
        <Route path="/personal-spending" component={PersonalSpendingPage} protected />
        <Route path="/reconciliation" component={ReconciliationPage} protected />
        <Route path="/settings" component={SettingsPage} protected />
        {/* Owner console — reachable by URL only; server-enforced by
            require_admin, client bounces non-admins to /dashboard. */}
        <Route path="/admin" component={AdminDashboardPage} protected />
        <Route path="*" component={NotFoundPage} />
      </Router>
      {/* Auto-rendered "Install PesaLens" banner. Self-gates on
          beforeinstallprompt + non-standalone WebView, hides itself for
          14 days on dismiss. Lives outside <Router> so it persists across
          page changes. */}
      <PWAInstallPrompt />
      {/* Global toast stack — severity-scaled, dismissible, capped at 3.
          Mounted once here so any page (or the api client) can fire toasts. */}
      <ToastProvider />
    </ErrorBoundary>
  );
};

export default App;
