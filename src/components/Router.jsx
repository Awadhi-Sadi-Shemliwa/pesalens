import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { isAuthenticated } from '../data/authStore';

const RouterCtx = createContext(null);

const readPath = () => window.location.hash.slice(1) || '/';

const Router = ({ children }) => {
  const [path, setPath] = useState(readPath);

  useEffect(() => {
    const handleHash = () => setPath(readPath());
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const navigate = useCallback((p) => {
    if (window.location.hash === '#' + p) return;
    window.location.hash = p;
  }, []);

  return <RouterCtx.Provider value={{ path, navigate }}>{children}</RouterCtx.Provider>;
};

const useRouter = () => useContext(RouterCtx);

const Route = ({ path, component: Component, protected: isProtected = false }) => {
  const { path: currentPath, navigate } = useRouter();

  useEffect(() => {
    if (isProtected && currentPath === path && !isAuthenticated()) {
      navigate('/signin');
    }
  }, [isProtected, currentPath, path, navigate]);

  if (currentPath !== path) return null;
  if (isProtected && !isAuthenticated()) return null;
  return <Component />;
};

const Link = ({ to, children, className = '', onClick, ...props }) => {
  const { navigate } = useRouter();
  return (
    <a
      href={'#' + to}
      onClick={(event) => {
        event.preventDefault();
        navigate(to);
        if (onClick) onClick(event);
      }}
      className={className}
      {...props}
    >
      {children}
    </a>
  );
};

export { Router, useRouter, Route, Link };
