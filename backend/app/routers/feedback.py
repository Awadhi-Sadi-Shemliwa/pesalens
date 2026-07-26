"""First-session feedback, and the client's own crash reports.

Two unrelated-looking things live together because they answer the same
question from opposite ends: *what is actually happening to real people using
this?* One is what they tell us, the other is what breaks without them saying
anything.

**Feedback.** Asked at moments when the person has just used the thing and has
something to say: after their first statement extracts, when they are looking at
the Upgrade page, and when they sign out. Always declinable, and reachable on
demand from Settings/Profile so nobody is ever locked out of telling us
something.

The prompt RULES live on the user row (`feedback_declines`,
`feedback_snooze_until`, `feedback_submitted_at`), not in this table. The first
version stored the state here — one row meant "already asked" — and that single
decision produced three bugs at once: a skip was permanent, an accidental
backdrop-click counted as a permanent skip, and a second submission was
impossible. The rule now is *snooze, don't slam the door*: a skip hides the
prompt for `SKIP_SNOOZE_DAYS` and spends one of `MAX_DECLINES` chances; an
incidental dismissal costs a day and nothing else; three real declines end the
auto-prompt while leaving the manual route open forever.

**Client errors.** A React error boundary or a failed fetch never reaches the
server's exception handler, so until now a bug that only manifested in the
browser was invisible to the operator no matter how often it fired. `/telemetry/
client-error` gives the clients somewhere to put it, tagged with `source` so the
console can tell a browser crash from a server one.
"""

from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.db import Feedback, User, get_db
from app.deps import get_current_user
from app.rate_limit import limiter
from app.schemas.response import APIResponse
from app.services.activity import record_activity, record_error
from app.utils.logger import get_logger
from app.utils.time import utcnow

log = get_logger(__name__)
router = APIRouter(tags=["feedback"])

# How many explicit "Skip" presses before we stop asking on our own. Three is a
# deliberate compromise: one dismissal is not an answer (people are busy, or
# mis-click), but a person who has actively declined three times has told us
# something clear and being asked a fourth time is harassment, not research.
MAX_DECLINES = 3
# A skip means "not now". Long enough that the next prompt lands in a genuinely
# different session, short enough to still catch them during a test period.
SKIP_SNOOZE_DAYS = 3
# An incidental close — backdrop, Escape, navigating away. Not an answer, so it
# costs a day and none of the three chances.
DISMISS_SNOOZE_HOURS = 24


class FeedbackIn(BaseModel):
    """Every field optional on purpose.

    A tester who rates the app and writes one sentence has given us something
    real; rejecting that because they skipped the other four questions would
    trade signal for a tidy schema. The lengths are generous — people who
    bother to answer at all sometimes have a lot to say, and truncating the
    most engaged responses is the worst possible place to save bytes.
    """
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    experience: Optional[str] = Field(default=None, max_length=4000)
    improvements: Optional[str] = Field(default=None, max_length=4000)
    problem_solved: Optional[str] = Field(default=None, max_length=4000)
    audience: Optional[str] = Field(default=None, max_length=4000)
    referrals: Optional[str] = Field(default=None, max_length=4000)
    client: Optional[str] = Field(default=None, max_length=16)


class ClientErrorIn(BaseModel):
    error_code: Optional[str] = Field(default=None, max_length=40)
    message: str = Field(max_length=2000)
    path: Optional[str] = Field(default=None, max_length=255)
    client: Optional[str] = Field(default=None, max_length=16)


def _clean(value: Optional[str]) -> Optional[str]:
    return (value or "").strip() or None


def _client_tag(raw: Optional[str]) -> Optional[str]:
    """Only the two values the console groups by. Anything else is dropped
    rather than stored, so the column stays a usable filter instead of
    accumulating whatever a caller felt like sending."""
    tag = (raw or "").strip().lower()
    return tag if tag in ("web", "mobile") else None


def _set_prompt_state(db: Session, user: User, values: dict) -> User:
    """Write prompt state by query and hand back the fresh row.

    By QUERY, not `user.field = ...`: the User instance may belong to a
    different session than `db` (it does under a dependency override), and
    mutating it there is silently discarded at commit — the same trap
    `start_over` documents in routers/upload.py. Re-reading afterwards means
    the response we build describes what was actually stored, not what we hoped.
    """
    db.query(User).filter(User.id == user.id).update(values, synchronize_session=False)
    db.commit()
    return db.query(User).filter(User.id == user.id).first() or user


def _should_prompt(user: User) -> bool:
    """The single definition of "may we ask this person right now".

    Every trigger — sign-out, post-extraction, the Upgrade page — routes through
    here, so the rule cannot drift between them and a user cannot be asked twice
    by two surfaces that disagree.
    """
    if user.feedback_submitted_at is not None:
        return False
    if (user.feedback_declines or 0) >= MAX_DECLINES:
        return False
    snooze = user.feedback_snooze_until
    return snooze is None or utcnow() >= snooze


@router.get("/feedback/pending", response_model=APIResponse)
def feedback_pending(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Should this account be asked for feedback yet?

    Called BEFORE a trigger opens anything, so a returning user never sees the
    form flash on screen on its way to being dismissed.

    Re-reads the row rather than trusting the injected `user`. Four triggers can
    fire on two devices, and the answer must reflect what is stored right now —
    a cached instance that predates a skip made in another tab would re-open a
    form the person already declined.
    """
    fresh = db.query(User).filter(User.id == user.id).first() or user
    return APIResponse(success=True, message="ok", data={
        "should_prompt": _should_prompt(fresh),
        "declines": fresh.feedback_declines or 0,
        "submitted": fresh.feedback_submitted_at is not None,
    })


@router.post("/feedback", response_model=APIResponse)
@limiter.limit(settings.rate_limit_default)
def submit_feedback(
    request: Request,
    payload: FeedbackIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Record a response.

    Every submission gets its own row — someone who answers the prompt and
    later volunteers more from Settings has told us two things, not overwritten
    the first. `feedback_submitted_at` only governs the AUTO-prompt, which stops
    for good the moment they answer once.
    """
    row = Feedback(
        user_id=user.id,
        user_email=user.email,
        skipped=0,
        rating=payload.rating,
        experience=_clean(payload.experience),
        improvements=_clean(payload.improvements),
        problem_solved=_clean(payload.problem_solved),
        audience=_clean(payload.audience),
        referrals=_clean(payload.referrals),
        client=_client_tag(payload.client),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    # Stamp the FIRST submission only, so the field keeps meaning "when did
    # this person first tell us something" rather than "when did they last".
    if user.feedback_submitted_at is None:
        _set_prompt_state(db, user, {
            "feedback_submitted_at": utcnow(),
            "feedback_snooze_until": None,
        })
    record_activity(db, "feedback_submitted", user_id=user.id, request=request,
                    details={"rating": payload.rating})
    log.info("Feedback #%s from user %s (rating=%s)", row.id, user.id, payload.rating)
    return APIResponse(success=True, message="Thank you — this genuinely helps.",
                       data={"id": row.id})


@router.post("/feedback/skip", response_model=APIResponse)
@limiter.limit(settings.rate_limit_default)
def skip_feedback(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Record an explicit decline: "not now", worth one of three chances.

    A skip SNOOZES rather than closing the door. The previous version made one
    dismissal permanent, which is how the first real tester ended up unable to
    give feedback at all — the single most self-defeating outcome available to
    a feedback feature.

    Someone who has already submitted is not moved backwards: their
    `feedback_submitted_at` still suppresses the prompt, so a stray skip from a
    second device cannot resurrect it or inflate the decline count.
    """
    if user.feedback_submitted_at is None:
        # Incremented in SQL, not in Python: `user` may be stale (it is the
        # same staleness `_set_prompt_state` re-reads to work around), and two
        # skips from two devices in the same window would both read the old
        # count and both write count+1 — losing one of the three chances, so
        # the prompt comes back a fourth time.
        user = _set_prompt_state(db, user, {
            "feedback_declines": func.coalesce(User.feedback_declines, 0) + 1,
            "feedback_snooze_until": utcnow() + timedelta(days=SKIP_SNOOZE_DAYS),
        })
    declines = user.feedback_declines or 0
    return APIResponse(success=True, message="ok", data={
        "declines": declines,
        "will_ask_again": declines < MAX_DECLINES and user.feedback_submitted_at is None,
    })


@router.post("/feedback/dismiss", response_model=APIResponse)
@limiter.limit(settings.rate_limit_default)
def dismiss_feedback(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Record an INCIDENTAL close — backdrop click, Escape, navigating away.

    Not an answer, so it must not spend one of the three declines. The old code
    wired the modal's `onClose` straight to the skip handler, which meant
    clicking a few pixels beside the dialog opted you out of the form for life.
    That is a defect, not a policy: the user never chose anything.

    It still snoozes for a day, because re-opening the same form on the very
    next action would be its own kind of rude.
    """
    if user.feedback_submitted_at is None:
        user = _set_prompt_state(db, user, {
            "feedback_snooze_until": utcnow() + timedelta(hours=DISMISS_SNOOZE_HOURS),
        })
    return APIResponse(success=True, message="ok",
                       data={"declines": user.feedback_declines or 0})


@router.post("/telemetry/client-error", response_model=APIResponse)
@limiter.limit(settings.rate_limit_default)
def report_client_error(
    request: Request,
    payload: ClientErrorIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Accept a crash the CLIENT saw, so it lands in the same ledger as ours.

    Authenticated on purpose: an open endpoint that writes rows is an invitation
    to fill the operator's console with noise, and an error nobody can attribute
    to an account is not much use anyway. Rate-limited for the same reason — a
    render loop that throws on every frame must not be able to write thousands
    of rows.
    """
    source = _client_tag(payload.client) or "web"
    record_error(
        (payload.error_code or "client_error"),
        payload.message,
        user_id=user.id,
        path=_clean(payload.path),
        method="CLIENT",
        source=source,
        db=db,
    )
    record_activity(db, "client_error", user_id=user.id, request=request,
                    details={"path": payload.path, "code": payload.error_code})
    return APIResponse(success=True, message="ok", data={"recorded": True})
