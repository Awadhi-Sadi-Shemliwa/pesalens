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
import NotFoundPage from './pages/NotFoundPage';
import PWAInstallPrompt from './components/PWAInstallPrompt';
import { bootAuth, API_URL } from './data/api';
import { subscribeUnload } from './data/authStore';

const App = () => {
  // Block protected-route rendering until the silent-refresh handshake
  // resolves. Otherwise the Router would bounce a logged-in user to
  // /signin on every page reload.
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    // Initialise the hash WITHOUT pushing a history entry — otherwise
    // the user's first browser-back press just toggles the hash off and
    // they're stuck on the page. `replaceState` rewrites the current
    // entry in place so back / forward behave intuitively from there on.
    if (!window.location.hash) {
      const next = window.location.href.replace(/#?$/, '#/');
      window.history.replaceState({}, '', next);
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
        <Route path="*" component={NotFoundPage} />
      </Router>
      {/* Auto-rendered "Install PesaLens" banner. Self-gates on
          beforeinstallprompt + non-standalone WebView, hides itself for
          14 days on dismiss. Lives outside <Router> so it persists across
          page changes. */}
      <PWAInstallPrompt />
    </ErrorBoundary>
  );
};

export default App;
