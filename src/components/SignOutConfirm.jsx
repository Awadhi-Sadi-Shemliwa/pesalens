import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { navigate, setSignOutConfirmer } from './Router';
import { signOut } from '../data/api';

/* Modal that asks "Sign out of PesaLens?" when the user presses browser
   Back from /dashboard. Mounted by DashboardPage; the Router's popstate
   trap calls open() (registered via setSignOutConfirmer) which flips
   the visibility flag and pushes a fresh /dashboard history entry so the
   user stays put while they decide. */
const SignOutConfirm = () => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    setSignOutConfirmer(() => setOpen(true));
    return () => setSignOutConfirmer(null);
  }, []);

  // Esc / click-outside dismisses the modal without signing out.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    cancelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
      setOpen(false);
      // Replace history so Back from /landing exits the tab instead of
      // bouncing back into a now-deauthenticated /dashboard render.
      navigate('/', { replace: true });
    }
  };

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="signout-title">
      <button
        aria-label="Close"
        onClick={close}
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        style={{ animation: 'fadeUp 0.15s ease both' }}
      />
      <div
        className="relative bg-surface-2 border border-bdr rounded-2xl p-5 sm:p-6 w-full max-w-sm shadow-2xl"
        style={{ animation: 'fadeUp 0.18s ease both' }}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-dng/10 border border-dng/30 flex items-center justify-center flex-shrink-0">
            <Icon name="logout" size={18} className="text-dng" />
          </div>
          <div>
            <h3 id="signout-title" className="text-base font-semibold text-txt-1">Sign out of PesaLens?</h3>
            <p className="text-sm text-txt-2 mt-1 leading-relaxed">
              Pressing Back from the Dashboard will sign you out. Your session ends and you'll need to sign in again.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 justify-end">
          <button
            ref={cancelRef}
            onClick={close}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-lg bg-surface-3 hover:bg-surface-4 text-txt-1 border border-bdr disabled:opacity-60"
          >
            Stay
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-lg bg-dng text-white hover:bg-dng/90 disabled:opacity-60"
          >
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default SignOutConfirm;
