import React, { useCallback, useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Modal, toast } from './common';
import { navigate, setSignOutConfirmer } from './Router';
import { signOut } from '../data/api';

/* Modal that asks "Sign out of PesaLens?" when the user presses browser
   Back from /dashboard. Mounted by DashboardPage; the Router's popstate
   trap calls open() (registered via setSignOutConfirmer) which flips
   the visibility flag and pushes a fresh /dashboard history entry so the
   user stays put while they decide.

   Built on the shared `Modal`, so it inherits the spring entrance, staggered
   content, symmetric exit, focus trap, Escape-to-close and scroll lock. */
const SignOutConfirm = () => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    setSignOutConfirmer(() => setOpen(true));
    return () => setSignOutConfirmer(null);
  }, []);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await signOut();
      toast.success('Signed out');
    } finally {
      setBusy(false);
      setOpen(false);
      // Replace history so Back from /landing exits the tab instead of
      // bouncing back into a now-deauthenticated /dashboard render.
      navigate('/', { replace: true });
    }
  };

  return (
    <Modal open={open} onClose={close} title="Sign out of PesaLens?">
      <div className="flex items-start gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-dng/10 border border-dng/30 flex items-center justify-center flex-shrink-0">
          <Icon name="logout" size={18} className="text-dng" />
        </div>
        <p className="text-sm text-txt-2 leading-relaxed">
          Pressing Back from the Dashboard will sign you out. Your session ends and you'll need to sign in again.
        </p>
      </div>
      <div className="flex items-center gap-2 justify-end">
        <button
          onClick={close}
          disabled={busy}
          className="px-4 py-2 text-sm rounded-lg bg-surface-3 hover:bg-surface-4 text-txt-1 border border-bdr transition active:scale-95 disabled:opacity-60 focus-ring"
        >
          Stay
        </button>
        <button
          onClick={handleConfirm}
          disabled={busy}
          className="px-4 py-2 text-sm rounded-lg bg-dng text-white hover:bg-dng/90 transition active:scale-95 disabled:opacity-60 focus-ring"
        >
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </Modal>
  );
};

export default SignOutConfirm;
