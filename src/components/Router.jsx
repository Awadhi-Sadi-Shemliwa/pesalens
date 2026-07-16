import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { isAuthenticated, isBootComplete, useAuth } from '../data/authStore';

const RouterCtx = createContext(null);

// Routing is PATH-based (History API): /, /dashboard, /settings … — clean URLs
// with no leading `#/`.
//
// The single exception is the owner console, which is deliberately kept on the
// URL fragment (`/#/admin`) so it isn't discoverable by browsing the path space
// or guessable from the nav. NOTE: this is obscurity only — the real gate is the
// backend's `require_system_admin` allowlist; the hash just keeps it out of
// sight.
const ADMIN_PATH = '/admin';
const ADMIN_HASH = '#/admin';

// Current route: the admin fragment wins when present, else the pathname.
// `#admin` (no slash) is accepted as a hand-typed alias of the canonical
// `#/admin` — urlFor() below still always emits the canonical form.
const readPath = () => {
  if (window.location.hash === ADMIN_HASH || window.location.hash === '#admin') return ADMIN_PATH;
  return window.location.pathname || '/';
};

// The real URL for a route — admin lives on the fragment, everything else on
// the path. pushState('/#/admin') yields pathname `/` + hash `#/admin`.
const urlFor = (p) => (p === ADMIN_PATH ? '/#/admin' : p);

// Module-scoped imperative navigator. Set by <Router> on mount so callers
// outside the component tree (e.g. the signOut flow) can change routes without
// threading useRouter() through everything. The default (pre-mount / post-
// unmount) pushes state and synthesizes a popstate so any mounted Router syncs.
const _defaultNavigate = (path) => {
  window.history.pushState({}, '', urlFor(path));
  window.dispatchEvent(new PopStateEvent('popstate'));
};
let _imperativeNavigate = _defaultNavigate;

export const navigate = (path, options) => _imperativeNavigate(path, options);

// --- Sign-out confirm hook for /dashboard back-press ------------------------
// DashboardPage registers a callback via setSignOutConfirmer(cb) on mount
// and clears it on unmount. The popstate handler in <Router> calls cb()
// when the user presses Back from /dashboard; cb() opens a modal and
// returns true (to swallow the navigation). If no confirmer is mounted
// the back press behaves normally.
let _signOutConfirmer = null;
export const setSignOutConfirmer = (cb) => { _signOutConfirmer = cb; };

// --- One-shot navigation intent --------------------------------------------
// Lets a page hand the NEXT page a small instruction that survives the hash
// navigation (e.g. reconciliation's "Scan a receipt" telling PersonalSpending
// to pop open the gallery/camera picker on arrival). Module-scoped because the
// SPA never full-reloads on an in-app navigate, so the value is still here when
// the target page mounts. consumeNavIntent() clears it so a later manual visit
// to the same page doesn't re-fire the picker.
let _navIntent = null;
export const setNavIntent = (intent) => { _navIntent = intent; };
export const consumeNavIntent = () => {
  const i = _navIntent;
  _navIntent = null;
  return i;
};

const Router = ({ children }) => {
  const [path, setPath] = useState(readPath);

  // `replace` rewrites the current history entry instead of pushing a new one —
  // used after sign-in/sign-up so the auth pages disappear from history and Back
  // can't return the user to them with a stale form state.
  const navigate = useCallback((p, { replace = false } = {}) => {
    if (readPath() === p) return;
    const url = urlFor(p);
    if (replace) window.history.replaceState({}, '', url);
    else window.history.pushState({}, '', url);
    // History mutations don't fire popstate — push the new path into React
    // ourselves so Route components react.
    setPath(p);
  }, []);

  // Expose for the module-scoped `navigate()` so callers outside hooks can use
  // the same primitive. Effect re-binds on every Router mount.
  useEffect(() => {
    _imperativeNavigate = navigate;
    return () => { _imperativeNavigate = _defaultNavigate; };
  }, [navigate]);

  // Keep React in sync with browser Back/Forward (popstate) and admin-fragment
  // changes (hashchange). The /dashboard back-press sign-out trap is bound to
  // popstate ONLY — a browser Back is a deliberate navigation, whereas a
  // hashchange (e.g. toggling the #/admin fragment or a future in-page anchor)
  // must never pop the sign-out modal. The page registers a confirmer via
  // setSignOutConfirmer; the trap fires only when one is set AND the user is
  // signed in.
  useEffect(() => {
    const onPopState = () => {
      const current = readPath();
      if (current === '/dashboard' && isAuthenticated() && _signOutConfirmer) {
        // Re-push /dashboard so the user stays on the page while the modal is
        // open. If they confirm, the modal navigates to / itself.
        window.history.pushState({}, '', '/dashboard');
        _signOutConfirmer();
        return;
      }
      setPath(current);
    };
    const onHashChange = () => setPath(readPath());
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  return <RouterCtx.Provider value={{ path, navigate }}>{children}</RouterCtx.Provider>;
};

const useRouter = () => useContext(RouterCtx);

const Route = ({ path, component: Component, protected: isProtected = false }) => {
  const { path: currentPath, navigate } = useRouter();

  useEffect(() => {
    if (isProtected && currentPath === path && !isAuthenticated()) {
      navigate('/signin', { replace: true });
    }
  }, [isProtected, currentPath, path, navigate]);

  if (currentPath !== path) return null;
  if (isProtected && !isAuthenticated()) return null;
  return <Component />;
};

// Public-only routes (landing, signin, signup). When the silent-refresh
// boot has completed AND the user is signed in, replace to /dashboard so
// the auth pages can never be reached after authentication.
const PublicOnlyRoute = ({ path, component: Component }) => {
  const { path: currentPath, navigate } = useRouter();
  const { token, booted } = useAuth();

  useEffect(() => {
    if (currentPath !== path) return;
    if (!booted) return;
    if (token) navigate('/dashboard', { replace: true });
  }, [currentPath, path, token, booted, navigate]);

  if (currentPath !== path) return null;
  if (booted && token) return null;
  return <Component />;
};

const Link = ({ to, children, className = '', onClick, replace = false, ...props }) => {
  const { navigate } = useRouter();
  return (
    <a
      href={urlFor(to)}
      onClick={(event) => {
        event.preventDefault();
        navigate(to, { replace });
        if (onClick) onClick(event);
      }}
      className={className}
      {...props}
    >
      {children}
    </a>
  );
};

export { Router, useRouter, Route, PublicOnlyRoute, Link };
