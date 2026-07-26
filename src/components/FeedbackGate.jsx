import React, { useEffect, useState } from 'react';
import FeedbackModal from './FeedbackModal';
import { fetchFeedbackPending, signOut } from '../data/api';

/* ------------------------------------------------------------------
   Every route to the feedback form, in one place.

   Four things can open it — the three sign-out buttons (header menu, Settings,
   Back-from-Dashboard), a successful statement extraction, the Upgrade page —
   plus the always-available Settings button. They must behave identically. A
   prompt that appears from one path and not another is worse than no prompt,
   because whichever path the user happens to take is the one that decides
   whether they are ever asked.

   So the gate is mounted ONCE, near the root, and everything else calls into
   it. `signOutWithFeedback()` resolves only after the user has dealt with the
   form AND the session has ended, so sign-out call sites keep their existing
   `await signOut(); navigate(...)` shape. `openFeedback()` is the voluntary
   door — it opens the same form with non-interrupting copy and never blocks.

   Reach is the thing this design is fighting for. The sign-out prompt alone
   misses anyone who closes the tab (authStore's pagehide beacon ends the
   session with no UI) or backgrounds the mobile app (a 30s timer does the
   same). Those users are the majority, which is why the extraction-success and
   Upgrade triggers exist and why Settings keeps a permanent entry point.

   Deliberately NOT used by the account-deletion flow in Settings: someone who
   just erased their account is not a person to ask for product feedback.
   ------------------------------------------------------------------ */

// Set by the mounted gate. Null before mount (and after unmount), in which case
// signOutWithFeedback degrades to a plain sign-out rather than hanging.
let _openGate = null;

export const registerFeedbackGate = (fn) => { _openGate = fn; };

/**
 * Sign out, pausing first for the one-time feedback form when this account has
 * not been asked yet.
 *
 * Every failure mode ends in a sign-out. Someone pressing "sign out" has made
 * their intent unambiguous, and a survey — or a survey's network call — that
 * can trap them in a session they asked to leave is a bug, not a retention
 * feature.
 */
export const signOutWithFeedback = async () => {
  try {
    if (_openGate) {
      const res = await fetchFeedbackPending();
      // Checked BEFORE opening anything, so a returning user never sees the
      // form flash on screen on its way to being dismissed.
      if (res?.should_prompt) {
        await new Promise((resolve) => _openGate(resolve, 'signout'));
      }
    }
  } catch {
    /* Could not ask — not a reason to block the sign-out. */
  }
  await signOut();
};

/**
 * Open the form outside a sign-out.
 *
 * `force` is what separates the two kinds of voluntary caller. The Settings
 * button passes it, because someone who deliberately pressed "Send us
 * feedback" must get the form whatever their prompt state says — that button
 * is the promise that nobody is ever locked out, and silently doing nothing
 * would break it. The automatic triggers (extraction finished, Upgrade page)
 * leave it false and defer to the snooze/decline rules like any other prompt.
 *
 * Never blocks and never throws: these callers are in the middle of doing
 * something else.
 */
export const openFeedback = async ({ force = false } = {}) => {
  if (!_openGate) return;
  try {
    if (!force) {
      const res = await fetchFeedbackPending();
      if (!res?.should_prompt) return;
    }
    await new Promise((resolve) => _openGate(resolve, 'voluntary'));
  } catch {
    /* Nothing to continue — unlike sign-out, there is no next step to unblock. */
  }
};

const FeedbackGate = () => {
  // Holds the resolver of the promise the opener is waiting on, plus which
  // copy to show. Non-null === the modal is open, so one piece of state
  // drives visibility and mode together and they cannot disagree.
  const [pending, setPending] = useState(null);

  useEffect(() => {
    // The extra arrow matters: setState treats a bare function argument as an
    // updater, so storing a callback needs `() => value`.
    registerFeedbackGate((resolve, mode) => setPending(() => ({ resolve, mode })));
    return () => registerFeedbackGate(null);
  }, []);

  const done = () => {
    const resolve = pending?.resolve;
    setPending(null);
    resolve?.();
  };

  return <FeedbackModal open={!!pending} onDone={done} mode={pending?.mode || 'signout'} />;
};

export default FeedbackGate;
