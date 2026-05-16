import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Icon } from './Icon';

/* --------------------------------------------------------------------------
   PWAInstallPrompt — branded "Install PesaLens" banner.

   Chrome / Edge / Samsung Internet fire `beforeinstallprompt` once the
   PWA install criteria are met (manifest + service worker + https). We
   intercept it, suppress the default mini-info-bar, and surface our own
   bottom banner that matches the Dark Editorial aesthetic.

   iOS Safari does not fire that event — we sniff for iOS standalone-eligible
   browsers and show a "tap Share → Add to Home Screen" hint instead.

   The banner is dismissible; the choice is remembered for 14 days so we
   don't pester returning users.
   -------------------------------------------------------------------------- */

const STORAGE_KEY = 'pesalens.pwa.dismissed';
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const isIosSafari = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  // Safari on iOS reports "Safari" but Chrome iOS reports "CriOS" etc. —
  // Add to Home Screen only works in Safari proper.
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return isIos && isSafari;
};

const isStandalone = () => {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  if (window.navigator.standalone) return true; // iOS
  return false;
};

const wasDismissedRecently = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < DISMISS_TTL_MS;
  } catch {
    return false;
  }
};

const remember = () => {
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    /* quota exceeded — not worth surfacing */
  }
};

const PWAInstallPrompt = () => {
  const reduce = useReducedMotion();
  const [deferred, setDeferred] = useState(null);
  const [iosHint, setIosHint] = useState(false);
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (isStandalone() || wasDismissedRecently()) return;

    // Chromium path — capture the event and show our own UI.
    const onBefore = (e) => {
      e.preventDefault();
      setDeferred(e);
      setOpen(true);
    };
    // After Chrome installs, drop the banner.
    const onInstalled = () => {
      setOpen(false);
      setDeferred(null);
      remember();
    };

    window.addEventListener('beforeinstallprompt', onBefore);
    window.addEventListener('appinstalled', onInstalled);

    // iOS path — there's no event, so sniff and surface the hint after
    // a beat so it doesn't compete with the hero animation.
    if (isIosSafari()) {
      const t = setTimeout(() => {
        setIosHint(true);
        setOpen(true);
      }, 2400);
      return () => {
        clearTimeout(t);
        window.removeEventListener('beforeinstallprompt', onBefore);
        window.removeEventListener('appinstalled', onInstalled);
      };
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBefore);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferred) return;
    setInstalling(true);
    try {
      await deferred.prompt();
      await deferred.userChoice; // {outcome: 'accepted' | 'dismissed'}
    } catch {
      /* user cancelled — fine */
    } finally {
      setDeferred(null);
      setInstalling(false);
      setOpen(false);
      remember();
    }
  };

  const dismiss = () => {
    setOpen(false);
    remember();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-x-3 bottom-3 z-[60] sm:left-auto sm:right-4 sm:bottom-4 sm:max-w-sm"
          initial={reduce ? false : { opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? undefined : { opacity: 0, y: 16, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 280, damping: 28 }}
          role="dialog"
          aria-label="Install PesaLens"
        >
          <div className="glass-pane rounded-2xl p-3.5 sm:p-4 flex items-start gap-3 shadow-float">
            <div className="relative w-12 h-12 rounded-xl overflow-hidden flex-shrink-0">
              <img
                src="/icon-192.png"
                alt=""
                width={48}
                height={48}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-mono uppercase tracking-ticker text-accent">
                PesaLens
              </div>
              <h4 className="text-sm font-semibold tracking-tight text-txt-1 mt-0.5">
                Install the app
              </h4>
              {iosHint ? (
                <p className="mt-1 text-xs text-txt-2 leading-relaxed">
                  Tap{' '}
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-3 border border-bdr/60 text-txt-1">
                    <Icon name="upload" size={11} />
                    Share
                  </span>
                  {' '}then{' '}
                  <span className="text-txt-1 font-medium">Add to Home Screen</span>.
                </p>
              ) : (
                <p className="mt-1 text-xs text-txt-2 leading-relaxed">
                  Get one-tap launch, full-screen mode, and offline shell — installs in seconds.
                </p>
              )}
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {!iosHint && (
                  <button
                    type="button"
                    onClick={install}
                    disabled={installing}
                    className="btn-primary text-xs font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-60"
                  >
                    {installing ? 'Installing…' : (
                      <>Install <Icon name="arrowRight" size={12} /></>
                    )}
                  </button>
                )}
                <a
                  href="/downloads/pesalens.apk"
                  download="pesalens.apk"
                  onClick={() => remember()}
                  className="text-xs font-semibold text-accent hover:text-accent-hover inline-flex items-center gap-1 px-2 py-1.5"
                >
                  <Icon name="arrowDownRight" size={12} />
                  APK
                </a>
                <button
                  type="button"
                  onClick={dismiss}
                  className="text-xs font-medium text-txt-3 hover:text-txt-1 px-2 py-1.5 ml-auto"
                >
                  Not now
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss install prompt"
              className="text-txt-3 hover:text-txt-1 p-1 -m-1"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default PWAInstallPrompt;
