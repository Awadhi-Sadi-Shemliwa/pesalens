import React, { useLayoutEffect, useState } from 'react';
import { Icon } from './Icon';
import { Modal, toast } from './common';
import { submitFeedback, skipFeedback, dismissFeedback } from '../data/api';

/* ------------------------------------------------------------------
   The feedback form. One component, two situations.

   `mode="signout"` — they pressed Sign out and we are standing in the way.
   `mode="voluntary"` — they opened it themselves (Settings), or it appeared
   after their statement finished extracting. Nobody is being detained, so the
   copy drops the "before you go" framing and closing costs nothing.

   Three exits, and the difference between them is the whole point:

     · SUBMIT   — we stop asking, permanently.
     · SKIP     — an actual "no". Spends one of three chances, snoozes 3 days.
     · DISMISS  — backdrop, Escape, the X. NOT an answer. Snoozes a day and
                  spends nothing.

   That last distinction is what this component got wrong the first time:
   `onClose` was wired straight to skip, so clicking a few pixels beside the
   dialog opted you out of the form for life. The first real tester did exactly
   that and could never be asked again.

   Skipping stays a first-class action — full contrast, one click. A form that
   traps someone who genuinely has nothing to say buys one junk response and
   costs the goodwill that would have got a real one later.
   ------------------------------------------------------------------ */

const QUESTIONS = [
  {
    key: 'experience',
    label: 'How has PesaLens been so far?',
    hint: 'Anything that surprised you — good or bad.',
    rows: 3,
  },
  {
    key: 'improvements',
    label: 'What would you like us to improve?',
    hint: 'The one change that would matter most to you.',
    rows: 3,
  },
  {
    key: 'problem_solved',
    label: 'Which real problem do you think this solves best?',
    hint: 'What it actually helps with, in your own words.',
    rows: 2,
  },
  {
    key: 'audience',
    label: 'Who would find this most useful?',
    hint: 'The kind of person, business or organisation you have in mind.',
    rows: 2,
  },
  {
    key: 'referrals',
    label: 'Anyone you would recommend us to?',
    hint: 'Optional — a name, a business, or just the type of place.',
    rows: 2,
  },
];

const RATINGS = [1, 2, 3, 4, 5];

const FeedbackModal = ({ open, onDone, mode = 'signout' }) => {
  const [rating, setRating] = useState(null);
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const leaving = mode === 'signout';

  const set = (key) => (e) => setAnswers((a) => ({ ...a, [key]: e.target.value }));

  // Start every opening blank. FeedbackGate renders this permanently mounted
  // (only `open` flips), so without an explicit reset the form still holds the
  // last submission — and since the backend stores one row per submit, someone
  // reopening it from Settings would be looking at their old answers and one
  // tap away from filing them again as a duplicate.
  //
  // Layout effect, not a plain one: Modal mounts its panel the moment `open`
  // flips, and useEffect runs after paint — which is one visible frame of the
  // previous answers before they clear.
  useLayoutEffect(() => {
    if (!open) return;
    setRating(null);
    setAnswers({});
    setBusy(false);
  }, [open]);

  // `onDone` continues whatever we interrupted — the sign-out, or nothing at
  // all in voluntary mode. It runs on EVERY exit path, including a failed
  // submit: a network problem while sending feedback must not trap someone who
  // is trying to leave.
  const onSubmit = async () => {
    setBusy(true);
    try {
      await submitFeedback({ rating, ...answers });
      toast.success('Thank you — this genuinely helps.');
    } catch {
      // Do NOT record a skip here — they tried to answer. Snooze instead, so
      // the prompt returns and their effort is not punished by our outage.
      try { await dismissFeedback(); } catch { /* leaving matters more */ }
      toast.error(
        leaving
          ? 'We could not send that — sorry. Signing you out anyway.'
          : 'We could not send that — sorry. Please try again shortly.',
      );
    } finally {
      setBusy(false);
      onDone?.();
    }
  };

  // The explicit button: a real "no". Spends one of three chances.
  const onSkip = async () => {
    setBusy(true);
    try {
      await skipFeedback();
    } catch {
      /* The prompt reappearing once is a smaller harm than a blocked sign-out. */
    } finally {
      setBusy(false);
      onDone?.();
    }
  };

  // Backdrop, Escape, the X. Not a decision — snooze only.
  const onDismiss = async () => {
    setBusy(true);
    try {
      await dismissFeedback();
    } catch {
      /* ignore — worst case we ask again sooner than intended */
    } finally {
      setBusy(false);
      onDone?.();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onDismiss}
      title={leaving ? 'Before you go — how did we do?' : 'Tell us what you think'}
      eyebrow={leaving ? 'Takes a minute' : 'Feedback'}
    >
      <div className="space-y-5">
        <p className="text-sm text-txt-2 leading-relaxed">
          You are one of the first people to use PesaLens on real statements. A minute of
          your thoughts shapes what we build next.
          {leaving && ' Answer once and we will not ask again.'}
        </p>

        {/* Rating */}
        <div>
          <div className="text-[13px] font-medium text-txt-1 mb-2">
            Overall, how is it working for you?
          </div>
          <div className="flex items-center gap-2" role="group" aria-label="Overall rating">
            {RATINGS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(rating === n ? null : n)}
                aria-pressed={rating === n}
                aria-label={`${n} out of 5`}
                className={`w-10 h-10 rounded-xl border text-sm font-semibold tabular transition active:scale-95 focus-ring ${
                  rating === n
                    ? 'bg-accent text-white border-accent'
                    : 'bg-surface-3 text-txt-2 border-bdr hover:bg-surface-4'
                }`}
              >
                {n}
              </button>
            ))}
            <span className="text-xs text-txt-3 ml-1">
              {rating ? (rating >= 4 ? 'Glad to hear it' : rating <= 2 ? 'Tell us what went wrong' : 'Room to improve') : '1 = poor, 5 = excellent'}
            </span>
          </div>
        </div>

        {QUESTIONS.map((q) => (
          <div key={q.key}>
            <label htmlFor={`fb-${q.key}`} className="block text-[13px] font-medium text-txt-1 mb-1">
              {q.label}
            </label>
            <p className="text-xs text-txt-3 mb-1.5">{q.hint}</p>
            <textarea
              id={`fb-${q.key}`}
              rows={q.rows}
              value={answers[q.key] || ''}
              onChange={set(q.key)}
              maxLength={4000}
              className="w-full rounded-xl bg-surface-3 border border-bdr px-3 py-2 text-sm text-txt-1 placeholder:text-txt-3 focus-ring resize-y"
              placeholder="Optional"
            />
          </div>
        ))}

        <div className="flex items-center justify-between gap-3 pt-1 flex-wrap">
          <button
            onClick={leaving ? onSkip : onDismiss}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-lg bg-surface-3 hover:bg-surface-4 text-txt-1 border border-bdr transition active:scale-95 disabled:opacity-60 focus-ring"
          >
            {/* Only the sign-out prompt's button is a real decline. In
                voluntary mode nobody is being interrupted, so "Close" must not
                quietly spend one of their three chances. */}
            {leaving ? 'Skip and sign out' : 'Close'}
          </button>
          <button
            onClick={onSubmit}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 transition active:scale-95 disabled:opacity-60 focus-ring inline-flex items-center gap-2"
          >
            <Icon name="check" size={15} />
            {busy ? 'Sending…' : 'Send feedback'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default FeedbackModal;
