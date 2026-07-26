import { useEffect, useState } from "react";
import FeedbackSheet, { type FeedbackMode } from "./FeedbackSheet";
// @ts-ignore — JS module
import { fetchFeedbackPending, signOut } from "@/data/api";

/* ------------------------------------------------------------------
   Every route to the feedback form, in one place. Mirror of
   src/components/FeedbackGate.jsx on web.

   Mounted ONCE at the app root rather than per-page, for a reason mobile makes
   unavoidable: the post-extraction trigger fires on Upload, which navigates to
   Analysis 700ms later. A sheet owned by Upload would be unmounted by that
   navigation mid-animation. Living above the router, it survives.

   Reach is what this design is fighting for. The sign-out prompt alone misses
   the majority of phone users — the app revokes the session after 30 seconds in
   the background (hooks/use-background-signout.ts) with no UI at all, so anyone
   who simply swipes away is never asked. Hence the extraction-success trigger,
   the Upgrade card, and the permanent Profile button.

   Deliberately NOT used by the account-deletion flow: someone who just erased
   their account is not a person to ask for product feedback.
   ------------------------------------------------------------------ */

type Opener = (resolve: () => void, mode: FeedbackMode) => void;

// Set by the mounted gate. Null before mount (and after unmount), in which case
// signOutWithFeedback degrades to a plain sign-out rather than hanging.
let _openGate: Opener | null = null;

export const registerFeedbackGate = (fn: Opener | null) => { _openGate = fn; };

/**
 * Sign out, pausing first for the feedback form when this account may be asked.
 *
 * Every failure mode ends in a sign-out. Someone who tapped "Sign out" has made
 * their intent unambiguous, and a survey — or a survey's network call — that can
 * trap them in a session they asked to leave is a bug, not a retention feature.
 */
export const signOutWithFeedback = async () => {
  try {
    if (_openGate) {
      const res = await fetchFeedbackPending();
      // Checked BEFORE opening anything, so a returning user never sees the
      // sheet flash on screen on its way to being dismissed.
      if (res?.should_prompt) {
        await new Promise<void>((resolve) => _openGate!(resolve, "signout"));
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
 * `force` separates the two kinds of voluntary caller. The Profile button and
 * the Upgrade card pass it, because someone who deliberately tapped "Send us
 * feedback" must get the form whatever their prompt state says — that button is
 * the promise that nobody is ever locked out, and silently doing nothing would
 * break it. Automatic triggers leave it false and defer to the snooze/decline
 * rules like any other prompt.
 *
 * Never blocks and never throws: these callers are mid-flow doing something else.
 */
export const openFeedback = async ({ force = false }: { force?: boolean } = {}) => {
  if (!_openGate) return;
  try {
    if (!force) {
      const res = await fetchFeedbackPending();
      if (!res?.should_prompt) return;
    }
    await new Promise<void>((resolve) => _openGate!(resolve, "voluntary"));
  } catch {
    /* Nothing to continue — unlike sign-out, there is no next step to unblock. */
  }
};

const FeedbackGate = () => {
  // Holds the resolver of the promise the opener is waiting on, plus which copy
  // to show. Non-null === the sheet is open, so one piece of state drives
  // visibility and mode together and they cannot disagree.
  const [pending, setPending] = useState<{ resolve: () => void; mode: FeedbackMode } | null>(null);

  useEffect(() => {
    // The extra arrow matters: setState treats a bare function argument as an
    // updater, so storing one needs `() => value`.
    registerFeedbackGate((resolve, mode) => setPending(() => ({ resolve, mode })));
    return () => registerFeedbackGate(null);
  }, []);

  const done = () => {
    const resolve = pending?.resolve;
    setPending(null);
    resolve?.();
  };

  return <FeedbackSheet open={!!pending} onDone={done} mode={pending?.mode || "signout"} />;
};

export default FeedbackGate;
