import React, { useEffect, useState } from 'react';
import { Router, Route } from './components/Router';
import ErrorBoundary from './components/ErrorBoundary';
import LandingPage from './pages/LandingPage';
import SignInPage from './pages/SignInPage';
import SignUpPage from './pages/SignUpPage';
import DashboardPage from './pages/DashboardPage';
import AnalysisPage from './pages/AnalysisPage';
import AssistantPage from './pages/AssistantPage';
import MarketsPage from './pages/MarketsPage';
import BookkeepingPage from './pages/BookkeepingPage';
import PersonalSpendingPage from './pages/PersonalSpendingPage';
import UpgradePage from './pages/UpgradePage';
import SettingsPage from './pages/SettingsPage';
import NotFoundPage from './pages/NotFoundPage';
import { bootAuth } from './data/api';

const App = () => {
  // Block protected-route rendering until the silent-refresh handshake
  // resolves. Otherwise the Router would bounce a logged-in user to
  // /signin on every page reload.
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    if (!window.location.hash) window.location.hash = '/';
    bootAuth().finally(() => setBooted(true));
  }, []);

  if (!booted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <Router>
        <Route path="/" component={LandingPage} />
        <Route path="/signin" component={SignInPage} />
        <Route path="/signup" component={SignUpPage} />
        <Route path="/upgrade" component={UpgradePage} protected />
        <Route path="/dashboard" component={DashboardPage} protected />
        <Route path="/analysis" component={AnalysisPage} protected />
        <Route path="/assistant" component={AssistantPage} protected />
        <Route path="/markets" component={MarketsPage} protected />
        <Route path="/bookkeeping" component={BookkeepingPage} protected />
        <Route path="/personal-spending" component={PersonalSpendingPage} protected />
        <Route path="/settings" component={SettingsPage} protected />
        <Route path="*" component={NotFoundPage} />
      </Router>
    </ErrorBoundary>
  );
};

export default App;
