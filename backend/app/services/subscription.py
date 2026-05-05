"""Subscription / trial state helpers.

Single source of truth for "is this user allowed to use Pro features
right now?". The HTTP layer (deps.py, routers/billing.py) and the
frontend `/auth/me` payload both read from `summarize(user)` so the
status string the UI shows is the same one used for enforcement.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from app.config import settings
from app.db import User
from app.utils.time import utcnow

PlanStatus = Literal["trial", "trial_expired", "pro", "pro_expired"]


@dataclass
class SubscriptionState:
    """Resolved view of a user's plan at a given moment in time.

    `is_active` is the only thing routes need to enforce access. The
    other fields exist so the frontend can render a banner ("3 days
    left in trial", "Pro · renews 12 Jun") without re-deriving anything.
    """
    plan: str                       # raw column value
    status: PlanStatus              # canonicalised state (see above)
    is_active: bool
    is_pro: bool
    is_trial: bool
    trial_ends_at: datetime | None
    trial_days_left: int
    pro_until: datetime | None


def _trial_window_end(user: User) -> datetime:
    started = user.trial_started_at or user.created_at or utcnow()
    return started + timedelta(days=settings.trial_days)


def resolve(user: User, *, now: datetime | None = None) -> SubscriptionState:
    """Compute the user's plan state. Pure — does not write to the DB."""
    now = now or utcnow()
    pro_until = user.pro_until
    trial_ends = _trial_window_end(user)
    trial_left = max(0, (trial_ends - now).days + (1 if trial_ends > now else 0))

    if pro_until and pro_until > now:
        return SubscriptionState(
            plan=user.plan or "pro",
            status="pro",
            is_active=True,
            is_pro=True,
            is_trial=False,
            trial_ends_at=trial_ends,
            trial_days_left=trial_left,
            pro_until=pro_until,
        )

    if pro_until and pro_until <= now:
        return SubscriptionState(
            plan="expired",
            status="pro_expired",
            is_active=False,
            is_pro=False,
            is_trial=False,
            trial_ends_at=trial_ends,
            trial_days_left=0,
            pro_until=pro_until,
        )

    # No active Pro subscription → fall back to trial window.
    if now < trial_ends:
        return SubscriptionState(
            plan="trial",
            status="trial",
            is_active=True,
            is_pro=False,
            is_trial=True,
            trial_ends_at=trial_ends,
            trial_days_left=trial_left,
            pro_until=None,
        )

    return SubscriptionState(
        plan="expired",
        status="trial_expired",
        is_active=False,
        is_pro=False,
        is_trial=False,
        trial_ends_at=trial_ends,
        trial_days_left=0,
        pro_until=None,
    )


def summarize(user: User) -> dict:
    """JSON-serialisable subscription dict for the API."""
    state = resolve(user)
    return {
        "plan": state.plan,
        "status": state.status,
        "is_active": state.is_active,
        "is_pro": state.is_pro,
        "is_trial": state.is_trial,
        "trial_days_left": state.trial_days_left,
        "trial_ends_at": state.trial_ends_at.isoformat() + "Z" if state.trial_ends_at else None,
        "pro_until": state.pro_until.isoformat() + "Z" if state.pro_until else None,
        "trial_days_total": settings.trial_days,
    }


def reconcile(user: User) -> bool:
    """Persist the canonical `plan` column based on resolve().

    Returns True if the column changed. Call this on writes (signup,
    payment confirmed) so the column matches reality without us having
    to recompute on every request.
    """
    state = resolve(user)
    target = "pro" if state.is_pro else ("trial" if state.is_trial else "expired")
    if user.plan == target:
        return False
    user.plan = target
    return True
