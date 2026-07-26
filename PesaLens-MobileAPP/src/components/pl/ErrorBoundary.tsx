import { Component, type ReactNode } from "react";
import { AlertOctagon, Home, RefreshCw } from "lucide-react";
// @ts-ignore — JS module
import { reportClientError } from "@/data/api";

/* Mobile ErrorBoundary — parity with src/components/ErrorBoundary.jsx
   on the web. Catches any uncaught render error in the WebView and
   shows a recoverable screen instead of letting the user stare at a
   white WebView. The "Reload" button calls window.location.reload(),
   which works inside Capacitor and reloads the SPA bundle without
   tearing down the native shell. */
type State = { hasError: boolean; message: string };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: (error as Error)?.message || "Unknown error",
    };
  }

  componentDidCatch(error: unknown, info: unknown) {
    if (typeof console !== "undefined") {
      console.error("UI crashed:", error, info);
    }
    // Report it to the server so the owner console sees it. A render crash
    // never reaches the backend's exception handler, and on a phone we cannot
    // ask the user to open a console — so without this a bug that whites out
    // the whole app is invisible to us however often it fires. The component
    // stack names which component threw; trimmed, because the error ledger
    // stores a message rather than a full trace.
    const err = error as Error | undefined;
    const stack = String((info as any)?.componentStack || "").trim().split("\n").slice(0, 6).join(" ");
    reportClientError(
      `${err?.name || "Error"}: ${err?.message || "unknown"}${stack ? ` | ${stack}` : ""}`,
      { code: "render_crash" },
    );
  }

  handleReload = () => {
    this.setState({ hasError: false, message: "" });
    if (typeof window !== "undefined") window.location.reload();
  };

  handleHome = () => {
    this.setState({ hasError: false, message: "" });
    if (typeof window !== "undefined") {
      window.location.assign("/");
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen bg-deep flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-surface-2 border border-border rounded-2xl p-6 text-center shadow-lift">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-dng/15 border border-dng/30 text-dng flex items-center justify-center mb-4">
            <AlertOctagon className="w-6 h-6" />
          </div>
          <h1 className="text-[18px] font-bold text-txt-1 mb-2">Something went wrong</h1>
          <p className="text-[13px] text-txt-3 leading-relaxed mb-5">
            We hit an unexpected error rendering this screen. Your data is safe on the server — try reloading the app.
          </p>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={this.handleHome}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] rounded-xl bg-surface-3 hover:bg-surface-4 text-txt-1 border border-border"
            >
              <Home className="w-3.5 h-3.5" /> Home
            </button>
            <button
              onClick={this.handleReload}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] rounded-xl bg-gradient-accent text-primary-foreground"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
