import React, { useEffect, useRef, useState } from 'react';
import { Link, useRouter } from './Router';
import { Icon } from './Icon';
import { Mark, ThemeToggle, LanguageToggle } from './common';
import { useUserType } from '../data/userStore';
import { useAuth } from '../data/authStore';
import { fetchMe, signOut } from '../data/api';
import { useT } from '../data/i18n';

const COMMON_NAV_KEYS = [
  { key: '/dashboard', icon: 'dashboard', t: 'nav.dashboard' },
  { key: '/analysis',  icon: 'chart',     t: 'nav.analysis' },
  { key: '/assistant', icon: 'bot',       t: 'nav.assistant' },
];

const BUSINESS_NAV_KEYS = [
  ...COMMON_NAV_KEYS,
  { key: '/markets',        icon: 'trending', t: 'nav.markets' },
  { key: '/bookkeeping',    icon: 'book',     t: 'nav.bookkeeping' },
  { key: '/reconciliation', icon: 'shield',   t: 'nav.reconcile' },
];

const INDIVIDUAL_NAV_KEYS = [
  ...COMMON_NAV_KEYS,
  { key: '/markets',           icon: 'trending', t: 'nav.markets' },
  { key: '/personal-spending', icon: 'wallet',   t: 'nav.personal' },
  { key: '/reconciliation',    icon: 'shield',   t: 'nav.reconcile' },
];

export const getNavItems = (userType) => (userType === 'business' ? BUSINESS_NAV_KEYS : INDIVIDUAL_NAV_KEYS);

const initialsFor = (user) => {
  if (!user) return '–';
  const source = (user.full_name || user.email || '').trim();
  if (!source) return '–';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
};

const displayNameFor = (user) => {
  if (!user) return 'Guest';
  if (user.full_name) return user.full_name.split(' ')[0];
  if (user.email) return user.email.split('@')[0];
  return 'Account';
};

/* ---------- Public top nav ---------- */
export const PublicNav = () => {
  const [scrolled, setScrolled] = useState(false);
  const [mobOpen, setMobOpen] = useState(false);
  const { t } = useT();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const links = [
    { to: '/',         label: t('nav.product') },
    { to: '/signup',   label: t('nav.startTrial') },
  ];

  return (
    <nav
      className={`fixed top-0 w-full z-50 transition-all duration-300 ${
        scrolled ? 'glass border-b border-bdr/80' : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
        <Link to="/"><Mark size={32} /></Link>
        <div className="hidden md:flex items-center gap-1">
          {links.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="px-3 py-2 text-sm text-txt-2 hover:text-txt-1 transition rounded-lg hover:bg-surface-3/60"
            >
              {item.label}
            </Link>
          ))}
          <a
            href="#features"
            className="px-3 py-2 text-sm text-txt-2 hover:text-txt-1 transition rounded-lg hover:bg-surface-3/60"
          >
            {t('nav.features')}
          </a>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="hidden md:flex items-center">
            <LanguageToggle />
            <ThemeToggle />
          </div>
          <div className="hidden md:flex items-center gap-2 ml-1">
            <Link
              to="/signin"
              className="text-sm text-txt-2 hover:text-txt-1 transition px-3 py-2"
            >
              {t('nav.signin')}
            </Link>
            <Link
              to="/signup"
              className="btn-primary text-sm font-medium px-4 py-2 rounded-lg inline-flex items-center gap-2"
            >
              {t('nav.openAccount')}
              <Icon name="arrowRight" size={14} />
            </Link>
          </div>
          <button
            className="md:hidden p-2 rounded-lg hover:bg-surface-3"
            onClick={() => setMobOpen(!mobOpen)}
            aria-label="Toggle menu"
          >
            <Icon name={mobOpen ? 'x' : 'menu'} size={22} className="text-txt-1" />
          </button>
        </div>
      </div>
      {mobOpen && (
        <div className="md:hidden glass border-t border-bdr px-4 py-4 space-y-2">
          {links.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="block py-2 text-sm text-txt-2 hover:text-txt-1"
              onClick={() => setMobOpen(false)}
            >
              {item.label}
            </Link>
          ))}
          <Link to="/signin" className="block py-2 text-sm text-txt-2" onClick={() => setMobOpen(false)}>
            {t('nav.signin')}
          </Link>
          <Link
            to="/signup"
            className="block btn-primary text-sm font-medium px-5 py-2.5 rounded-lg text-center"
            onClick={() => setMobOpen(false)}
          >
            {t('nav.openAccount')}
          </Link>
          <div className="flex items-center justify-center gap-2 pt-2 border-t border-bdr/60 mt-2">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
      )}
    </nav>
  );
};

/* ---------- App sidebar ---------- */
const AppSidebar = ({ collapsed, setCollapsed }) => {
  const { path, navigate } = useRouter();
  const [userType] = useUserType();
  const { t } = useT();
  const items = getNavItems(userType);

  return (
    <aside
      className={`hidden lg:flex flex-col border-r border-bdr bg-surface-1 transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
        collapsed ? 'w-[72px]' : 'w-[244px]'
      }`}
    >
      <div className="flex items-center gap-2.5 px-4 h-16 border-b border-bdr flex-shrink-0">
        <Mark size={32} withWord={!collapsed} />
      </div>
      <nav className="flex-1 py-4 px-2 space-y-0.5">
        {!collapsed && (
          <div className="px-3 pt-1 pb-2 font-mono text-[10px] uppercase tracking-ticker text-txt-3">
            {t('nav.workspace')}
          </div>
        )}
        {items.map((item) => {
          const active = path === item.key;
          const label = t(item.t);
          return (
            <button
              key={item.key}
              onClick={() => navigate(item.key)}
              className={`group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                active
                  ? 'bg-accent/8 text-accent'
                  : 'text-txt-2 hover:bg-surface-3 hover:text-txt-1'
              }`}
              title={collapsed ? label : undefined}
            >
              {active && <span className="nav-rail" />}
              <Icon name={item.icon} size={18} className={active ? 'text-accent' : ''} />
              {!collapsed && <span>{label}</span>}
            </button>
          );
        })}
      </nav>
      <div className="p-2 border-t border-bdr space-y-1">
        <UpgradeRail collapsed={collapsed} />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-txt-3 hover:bg-surface-3 hover:text-txt-2 transition"
        >
          <Icon name={collapsed ? 'chevRight' : 'chevDown'} size={14} />
          {!collapsed && <span className="font-mono tracking-ticker uppercase">{t('nav.collapse')}</span>}
        </button>
      </div>
    </aside>
  );
};

/* ---------- Upgrade rail (desktop sidebar footer) ---------- */
const UpgradeRail = ({ collapsed }) => {
  const { user } = useAuth();
  const { navigate, path } = useRouter();
  const { t } = useT();
  const sub = user?.subscription;
  const active = path === '/upgrade';

  if (!sub) return null;

  // Pro users get a quiet status pill, not a CTA.
  if (sub.is_pro) {
    if (collapsed) {
      return (
        <button
          onClick={() => navigate('/upgrade')}
          title={t('nav.proActive')}
          className={`w-full flex items-center justify-center px-3 py-2 rounded-lg text-inc hover:bg-surface-3 transition ${active ? 'bg-inc/10' : ''}`}
        >
          <Icon name="check" size={14} />
        </button>
      );
    }
    return (
      <button
        onClick={() => navigate('/upgrade')}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-inc hover:bg-surface-3 transition border border-inc/20 ${active ? 'bg-inc/10' : 'bg-inc/5'}`}
      >
        <Icon name="check" size={14} />
        <span className="font-medium">{t('nav.proActive')}</span>
      </button>
    );
  }

  const expired = sub.status === 'trial_expired' || sub.status === 'pro_expired';
  const tone = expired ? 'dng' : (sub.trial_days_left <= 3 ? 'exp' : 'accent');
  const toneClass = tone === 'dng' ? 'text-dng border-dng/30 bg-dng/5'
                  : tone === 'exp' ? 'text-exp border-exp/30 bg-exp/5'
                  :                   'text-accent border-accent/30 bg-accent/5';
  const label = expired
    ? t('nav.trialEnded')
    : t('nav.trialDays').replace('{n}', String(sub.trial_days_left));

  if (collapsed) {
    return (
      <button
        onClick={() => navigate('/upgrade')}
        title={label}
        className={`w-full flex items-center justify-center p-2 rounded-lg border ${toneClass} hover:opacity-90 transition`}
      >
        <Icon name="zap" size={14} />
      </button>
    );
  }

  return (
    <button
      onClick={() => navigate('/upgrade')}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs border ${toneClass} hover:opacity-90 transition`}
    >
      <Icon name="zap" size={14} />
      <span className="font-medium truncate">{label}</span>
      <Icon name="arrowRight" size={11} className="ml-auto flex-shrink-0" />
    </button>
  );
};

export const AppSidebarComponent = AppSidebar;

/* ---------- App top bar ---------- */
const AppTopBar = ({ onMenuToggle }) => {
  const { navigate, path } = useRouter();
  const { t } = useT();
  const { user } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);

  useEffect(() => {
    const close = (e) => {
      if (profileOpen && profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [profileOpen]);

  const crumbKeyMap = {
    '/dashboard':         'nav.dashboard',
    '/analysis':          'nav.analysis',
    '/assistant':         'nav.assistant',
    '/markets':           'nav.markets',
    '/bookkeeping':       'nav.bookkeeping',
    '/personal-spending': 'nav.personal',
  };
  const crumb = crumbKeyMap[path] ? t(crumbKeyMap[path]) : t('nav.dashboard');

  const handleSignOut = async () => {
    setProfileOpen(false);
    await signOut();
    navigate('/signin');
  };

  return (
    <header className="h-16 border-b border-bdr bg-surface-1/85 backdrop-blur-md flex items-center justify-between px-3 sm:px-4 lg:px-6 flex-shrink-0 gap-2">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <button className="lg:hidden p-2 rounded-lg hover:bg-surface-3" onClick={onMenuToggle}>
          <Icon name="menu" size={20} className="text-txt-2" />
        </button>
        <div className="hidden lg:flex items-center gap-2 text-xs text-txt-3 font-mono uppercase tracking-ticker">
          <span>{t('nav.workspace')}</span>
          <span className="text-txt-4">/</span>
          <span className="text-txt-2">{crumb}</span>
        </div>
      </div>
      <div className="flex items-center gap-0.5 sm:gap-1">
        <LanguageToggle />
        <ThemeToggle />
        <div className="relative ml-1" ref={profileRef}>
          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="flex items-center gap-2.5 p-1 sm:pr-2.5 rounded-lg hover:bg-surface-3 transition"
            aria-haspopup="menu"
            aria-expanded={profileOpen}
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent/30 to-net/20 flex items-center justify-center text-accent text-xs font-bold border border-accent/25">
              {initialsFor(user)}
            </div>
            <span className="hidden sm:block text-sm font-medium text-txt-1">{displayNameFor(user)}</span>
            <Icon name="chevDown" size={12} className="hidden sm:block text-txt-3" />
          </button>
          {profileOpen && (
            <div
              className="absolute right-0 top-full mt-2 w-64 bg-surface-2 border border-bdr rounded-xl shadow-2xl py-1.5 z-50"
              style={{ animation: 'fadeUp 0.18s ease both' }}
              role="menu"
            >
              <div className="px-3 pt-2 pb-3 border-b border-bdr/60">
                <div className="text-sm font-semibold text-txt-1 truncate">
                  {user?.full_name || displayNameFor(user)}
                </div>
                <div className="text-xs text-txt-3 truncate">
                  {user?.email || 'Not signed in'}
                </div>
                {user?.subscription && (
                  <div className="mt-1.5 text-[11px] text-txt-3 font-mono uppercase tracking-ticker truncate">
                    {user.subscription.is_pro
                      ? t('nav.proActive')
                      : user.subscription.status === 'trial'
                        ? t('nav.trialDays').replace('{n}', String(user.subscription.trial_days_left))
                        : t('nav.trialEnded')}
                  </div>
                )}
              </div>
              <button
                onClick={() => { setProfileOpen(false); navigate('/upgrade'); }}
                className="w-full text-left px-3 py-2 text-sm text-txt-1 hover:bg-surface-4 flex items-center gap-2.5"
                role="menuitem"
              >
                <Icon name="zap" size={14} className="text-accent" />{t('nav.upgrade')}
              </button>
              <button
                onClick={() => { setProfileOpen(false); navigate('/settings'); }}
                className="w-full text-left px-3 py-2 text-sm text-txt-1 hover:bg-surface-4 flex items-center gap-2.5"
                role="menuitem"
              >
                <Icon name="shield" size={14} className="text-txt-2" />Settings
              </button>
              <button
                onClick={handleSignOut}
                className="w-full text-left px-3 py-2 text-sm text-dng hover:bg-dng/8 flex items-center gap-2.5"
                role="menuitem"
              >
                <Icon name="logout" size={14} />{t('nav.signout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export { AppTopBar };

/* ---------- Trial / Pro banner ---------- */
const TrialBanner = () => {
  const { user } = useAuth();
  const { navigate, path } = useRouter();
  const sub = user?.subscription;

  // Don't show on the upgrade page itself; users are already there.
  if (!sub || path === '/upgrade') return null;
  if (sub.is_pro) return null;

  if (sub.status === 'trial' && sub.trial_days_left > 0) {
    const urgent = sub.trial_days_left <= 3;
    return (
      <div
        className={`flex items-center justify-between gap-3 px-3 sm:px-4 lg:px-6 py-2 border-b text-[11px] sm:text-xs ${
          urgent
            ? 'border-exp/30 bg-exp/8 text-exp'
            : 'border-accent/20 bg-accent/5 text-accent'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon name={urgent ? 'alert' : 'sparkles'} size={13} className="flex-shrink-0" />
          <span className="truncate font-medium">
            {sub.trial_days_left} {sub.trial_days_left === 1 ? 'day' : 'days'} left in your free trial
          </span>
        </div>
        <button
          onClick={() => navigate('/upgrade')}
          className={`flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
            urgent
              ? 'bg-exp text-white hover:bg-exp/90'
              : 'bg-accent text-white hover:bg-accent/90'
          }`}
        >
          Upgrade
          <Icon name="arrowRight" size={11} />
        </button>
      </div>
    );
  }

  if (sub.status === 'trial_expired' || sub.status === 'pro_expired') {
    return (
      <div className="flex items-center justify-between gap-3 px-3 sm:px-4 lg:px-6 py-2 border-b border-dng/30 bg-dng/8 text-dng text-[11px] sm:text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <Icon name="alert" size={13} className="flex-shrink-0" />
          <span className="truncate font-medium">
            {sub.status === 'pro_expired' ? 'Your Pro subscription has expired' : 'Your free trial has ended'}
            {' — upgrade to restore access'}
          </span>
        </div>
        <button
          onClick={() => navigate('/upgrade')}
          className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-dng text-white hover:bg-dng/90 transition"
        >
          Upgrade
          <Icon name="arrowRight" size={11} />
        </button>
      </div>
    );
  }

  return null;
};

/* ---------- App shell ---------- */
export const AppShell = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobMenu, setMobMenu] = useState(false);
  const { path, navigate } = useRouter();
  const [userType] = useUserType();
  const { t } = useT();
  const navItems = getNavItems(userType);

  // Refresh /me on shell mount so the trial countdown is always current
  // (the banner reads `user.subscription` from the cached session). Failing
  // silently is fine — banner just won't render until next refresh.
  useEffect(() => {
    fetchMe().catch(() => { /* ignore */ });
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar collapsed={collapsed} setCollapsed={setCollapsed} />
      {mobMenu && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => setMobMenu(false)} />
          <div
            className="absolute left-0 top-0 h-full w-72 bg-surface-1 border-r border-bdr p-4"
            style={{ animation: 'slideRight 0.28s cubic-bezier(0.4,0,0.2,1) both' }}
          >
            <div className="mb-6"><Mark /></div>
            <nav className="space-y-1">
              {navItems.map((item) => {
                const active = path === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => { navigate(item.key); setMobMenu(false); }}
                    className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                      active ? 'bg-accent/8 text-accent' : 'text-txt-2 hover:bg-surface-3'
                    }`}
                  >
                    {active && <span className="nav-rail" />}
                    <Icon name={item.icon} size={18} />
                    <span>{t(item.t)}</span>
                  </button>
                );
              })}
              <button
                onClick={() => { navigate('/upgrade'); setMobMenu(false); }}
                className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium mt-1 ${
                  path === '/upgrade'
                    ? 'bg-accent/8 text-accent'
                    : 'text-txt-2 hover:bg-surface-3'
                }`}
              >
                <Icon name="zap" size={18} />
                <span>{t('nav.upgrade')}</span>
              </button>
            </nav>
          </div>
        </div>
      )}
      <div className="flex-1 flex flex-col overflow-hidden">
        <AppTopBar onMenuToggle={() => setMobMenu(!mobMenu)} />
        <TrialBanner />
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-surface-1 p-3 sm:p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
};
