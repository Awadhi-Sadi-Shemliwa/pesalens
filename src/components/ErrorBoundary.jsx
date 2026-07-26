import React from 'react';
import { reportClientError } from '../data/api';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: (error && error.message) || 'Unknown error' };
  }

  componentDidCatch(error, info) {
    // Surface in dev console; production logging hooks (Sentry, etc.) plug in here.
    if (typeof console !== 'undefined') {
      console.error('UI crashed:', error, info);
    }
    // ...and tell the server. A render crash never reaches the backend's
    // exception handler, so before this the owner console showed nothing at
    // all for a bug that took the whole page down — however often it fired.
    // The component stack is the useful half (it names which component threw),
    // trimmed because the ledger stores a message, not a full trace.
    const stack = (info?.componentStack || '').trim().split('\n').slice(0, 6).join(' ');
    reportClientError(
      `${error?.name || 'Error'}: ${error?.message || 'unknown'}${stack ? ` | ${stack}` : ''}`,
      { code: 'render_crash' },
    );
  }

  handleReload = () => {
    this.setState({ hasError: false, message: '' });
    if (typeof window !== 'undefined') window.location.reload();
  };

  handleHome = () => {
    this.setState({ hasError: false, message: '' });
    if (typeof window !== 'undefined') {
      // Full navigation to home — after a render crash a clean reload is the
      // safest recovery.
      window.location.assign('/');
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen bg-deep flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-surface-2 border border-bdr rounded-2xl p-8 text-center">
          <div className="w-12 h-12 mx-auto rounded-xl bg-dng/15 text-dng flex items-center justify-center text-xl font-semibold mb-4">!</div>
          <h1 className="text-xl font-semibold text-txt-1 mb-2">Something went wrong</h1>
          <p className="text-sm text-txt-2 mb-6">
            We hit an unexpected error rendering this page. Try reloading — your data is safe on the server.
          </p>
          <div className="flex items-center justify-center gap-2">
            <button onClick={this.handleHome} className="px-4 py-2 text-sm rounded-lg bg-surface-3 hover:bg-surface-4 text-txt-1 border border-bdr">
              Go home
            </button>
            <button onClick={this.handleReload} className="px-4 py-2 text-sm rounded-lg press btn-primary">
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
