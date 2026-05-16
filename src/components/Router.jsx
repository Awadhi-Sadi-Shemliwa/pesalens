import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { isAuthenticated, isBootComplete, useAuth } from '../data/authStore';

const RouterCtx = createContext(null);

const readPath = () => window.location.hash.slice(1) || '/';

// Module-scoped imperative navigator. Set by <Router> on mount so callers
// outside the component tree (e.g. the popstate trap below, signOut flows)
// can change routes without threading useRouter() through everything.
let _imperativeNavigate = (path) => {
  window.location.hash = path;
};

export const navigate = (path, options) => _imperativeNavigate(path, options);

// --- Sign-out confirm hook for /dashboard back-press ------------------------
// DashboardPage registers a callback via setSignOutConfirmer(cb) on mount
// and clears it on unmount. The popstate handler in <Router> calls cb()
// when the user presses Back from /dashboard; cb() opens a modal and
// returns true (to swallow the navigation). If no confirmer is mounted
// the back press behaves normally.
let _signOutConfirmer = null;
export const setSignOutConfirmer = (cb) => { _signOutConfirmer = cb; };

const Router = ({ children }) => {
  const [path, setPath] = useState(readPath);

  useEffect(() => {
    const handleHash = () => setPath(readPath());
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  // Hash mutation is the legacy primitive we keep on top of. `replace`
  // rewrites the current entry instead of pushing a new one — used after
  // sign-in/sign-up so the auth pages disappear from history and Back
  // can't return the user to them with a stale form state.
  const navigate = useCallback((p, { replace = false } = {}) => {
    if (window.location.hash === '#' + p) return;
    if (replace) {
      window.history.replaceState({}, '', '#' + p);
      // replaceState doesn't fire hashchange — push the state into React
      // ourselves so Route components react to the new path.
      setPath(p);
    } else {
      window.location.hash = p;
    }
  }, []);

  // Expose for the module-scoped `navigate()` so callers outside hooks
  // can use the same primitive. Effect re-binds on every Router mount.
  useEffect(() => {
    _imperativeNavigate = navigate;
    return () => {
      _imperativeNavigate = (p) => { window.location.hash = p; };
    };
  }, [navigate]);

  // Trap browser Back from /dashboard so the user is asked to confirm
  // sign-out instead of silently bouncing to /signin (the previous
  // behaviour, which the user reported as a security smell). The page
  // mounts a confirmer via setSignOutConfirmer; this effect only swallows
  // the popstate when a confirmer is registered AND the user is signed in.
  useEffect(() => {
    const onPop = () => {
      const current = readPath();
      if (current !== '/dashboard') return;
      if (!isAuthenticated()) return;
      if (!_signOutConfirmer) return;
      // Re-push /dashboard so the user stays on the page while the modal
      // is open. If they confirm, the modal navigates to /landing itself.
      window.history.pushState({}, '', '#/dashboard');
      _signOutConfirmer();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
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
      href={'#' + to}
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
