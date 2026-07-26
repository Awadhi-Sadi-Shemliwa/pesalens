import { useLayoutEffect, useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Sheet, Button } from "./primitives";
// @ts-ignore — JS module
import { submitFeedback, skipFeedback, dismissFeedback } from "@/data/api";

/* The feedback form, phone edition. One sheet, two situations.

   `mode="signout"` — they tapped Sign out and we are standing in the way.
   `mode="voluntary"` — they opened it themselves from Profile, or it appeared
   after their statement finished extracting. Nobody is being detained, so the
   copy drops the "before you go" framing and closing costs nothing.

   Three exits, and the difference between them is the whole point:

     · SUBMIT   — we stop asking, permanently.
     · SKIP     — an actual "no". Spends one of three chances, snoozes 3 days.
     · DISMISS  — backdrop tap, swipe, the X. NOT an answer. Snoozes a day and
                  spends nothing.

   That last one is what this got wrong the first time: `onClose` was wired
   straight to skip. On a phone, tapping outside a sheet is simply how people
   close things — so the most natural gesture available permanently opted them
   out of ever giving feedback. The first real tester did exactly that.

   Skipping stays a full-width, full-contrast button, not a greyed-out escape
   hatch. Trapping a tester who has nothing to say buys one junk response and
   costs the goodwill that would have got a real one later. */

const QUESTIONS: { key: string; label: string; hint: string; rows: number }[] = [
  { key: "experience", label: "How has PesaLens been so far?", hint: "Anything that surprised you — good or bad.", rows: 3 },
  { key: "improvements", label: "What would you like us to improve?", hint: "The one change that would matter most to you.", rows: 3 },
  { key: "problem_solved", label: "Which real problem does this solve best?", hint: "What it actually helps with, in your own words.", rows: 2 },
  { key: "audience", label: "Who would find this most useful?", hint: "The kind of person, business or organisation you have in mind.", rows: 2 },
  { key: "referrals", label: "Anyone you would recommend us to?", hint: "Optional — a name, a business, or just the type of place.", rows: 2 },
];

const RATINGS = [1, 2, 3, 4, 5];

export type FeedbackMode = "signout" | "voluntary";

const FeedbackSheet = ({
  open,
  onDone,
  mode = "signout",
}: {
  open: boolean;
  onDone: () => void;
  mode?: FeedbackMode;
}) => {
  const [rating, setRating] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const leaving = mode === "signout";

  const set = (key: string) => (e: React.ChangeEvent<HTMLTextAreaElement>) =>
    setAnswers((a) => ({ ...a, [key]: e.target.value }));

  // Start every opening blank. FeedbackGate keeps this mounted for the whole
  // session (only `open` flips), so without an explicit reset the sheet still
  // holds the last submission — and the backend stores one row per submit, so
  // reopening from Profile would show old answers and file a duplicate.
  //
  // Layout effect, not a plain one: the sheet renders as soon as `open` flips
  // and useEffect runs after paint, which is one visible frame of stale text.
  useLayoutEffect(() => {
    if (!open) return;
    setRating(null);
    setAnswers({});
    setBusy(false);
  }, [open]);

  // Every exit path ends in onDone(). Someone who tapped "sign out" has made
  // their intent unambiguous, and a survey — or a survey's network call — that
  // can trap them in a session they asked to leave is a bug, not retention.
  const onSubmit = async () => {
    setBusy(true);
    try {
      await submitFeedback({ rating, ...answers });
      toast.success("Thank you", { description: "This genuinely helps." });
    } catch {
      // Snooze, do NOT record a decline — they tried to answer, and their
      // effort must not be punished by our outage.
      try { await dismissFeedback(); } catch { /* leaving matters more */ }
      toast.error("We could not send that", {
        description: leaving ? "Signing you out anyway." : "Please try again shortly.",
      });
    } finally {
      setBusy(false);
      onDone();
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
      onDone();
    }
  };

  // Backdrop tap, swipe, the X. Not a decision — snooze only.
  const onDismiss = async () => {
    setBusy(true);
    try {
      await dismissFeedback();
    } catch {
      /* ignore — worst case we ask again sooner than intended */
    } finally {
      setBusy(false);
      onDone();
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onDismiss}
      eyebrow={leaving ? "Takes a minute" : "Feedback"}
      title={leaving ? "Before you go — how did we do?" : "Tell us what you think"}
    >
      <div className="space-y-5">
        <p className="text-[13px] text-txt-2 leading-relaxed">
          You are one of the first people using PesaLens on real statements. A minute of your
          thoughts shapes what we build next.
          {leaving && " Answer once and we will not ask again."}
        </p>

        <div>
          <div className="text-[13px] font-semibold mb-2">Overall, how is it working for you?</div>
          <div className="flex items-center gap-2" role="group" aria-label="Overall rating">
            {RATINGS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(rating === n ? null : n)}
                aria-pressed={rating === n}
                aria-label={`${n} out of 5`}
                className={`w-11 h-11 rounded-2xl border text-[15px] font-bold font-mono-tab press transition ${
                  rating === n
                    ? "bg-accent text-primary-foreground border-accent"
                    : "bg-surface-3 text-txt-2 border-border"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-txt-3 mt-1.5">
            {rating
              ? rating >= 4 ? "Glad to hear it" : rating <= 2 ? "Tell us what went wrong" : "Room to improve"
              : "1 = poor, 5 = excellent"}
          </p>
        </div>

        {QUESTIONS.map((q) => (
          <div key={q.key}>
            <label htmlFor={`fb-${q.key}`} className="block text-[13px] font-semibold mb-1">
              {q.label}
            </label>
            <p className="text-[11px] text-txt-3 mb-1.5">{q.hint}</p>
            <textarea
              id={`fb-${q.key}`}
              rows={q.rows}
              value={answers[q.key] || ""}
              onChange={set(q.key)}
              maxLength={4000}
              placeholder="Optional"
              className="w-full rounded-2xl bg-surface-3 border border-border px-3 py-2.5 text-[14px] text-txt-1 placeholder:text-txt-3 resize-y focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>
        ))}

        <div className="space-y-2 pt-1">
          <Button block onClick={onSubmit} disabled={busy} loading={busy} icon={Check}>
            Send feedback
          </Button>
          {/* Only the sign-out prompt's button is a real decline. In voluntary
              mode nobody is being interrupted, so "Close" must not quietly
              spend one of their three chances. */}
          <Button block variant="ghost" onClick={leaving ? onSkip : onDismiss} disabled={busy}>
            {leaving ? "Skip and sign out" : "Close"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
};

export default FeedbackSheet;
