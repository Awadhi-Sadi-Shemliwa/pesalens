"""When may we ask for feedback, and what does a "no" actually mean.

    backend/venv/Scripts/python.exe backend/tests/test_feedback_prompting.py

SAFETY — same rules as test_transparency.py. Every case runs against DEDICATED
throwaway users created in setup and removed in a `finally`, never a real
account.

These rules exist because the first version got them wrong in a way that only
showed up with a real person in front of it: the very first tester opened the
form, wrote nothing, closed it — and was permanently locked out of ever giving
feedback, because the prompt state lived in the response table and one row of
any kind meant "already asked". A feedback feature that silences the people who
were about to give feedback is worse than none.

What is pinned here:

1. **A fresh account is asked.**
2. **An incidental close is not an answer.** Backdrop/Escape snoozes for a day
   and spends none of the three chances.
3. **A skip snoozes.** One explicit decline hides the prompt for three days,
   then it comes back.
4. **Three declines is a real no.** After that we stop asking on our own —
   forever, even once the snooze lapses.
5. **Submitting ends it.** One answer stops the auto-prompt for good, even with
   declines to spare.
6. **Volunteering again is allowed.** A second submission from Settings is a
   second row, not an overwrite.
7. **The legacy lockout heals itself.** An account carrying an old skipped row
   comes out of init_db promptable again, and the backfill is idempotent.
"""

from __future__ import annotations

import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.db import Feedback, SessionLocal, User, init_db  # noqa: E402
from app.deps import get_current_user  # noqa: E402
from app.main import app  # noqa: E402
from app.routers.feedback import (  # noqa: E402
    DISMISS_SNOOZE_HOURS,
    MAX_DECLINES,
    SKIP_SNOOZE_DAYS,
)
from app.utils.time import utcnow  # noqa: E402

_failures: list[str] = []
_EMAIL = "pytest-prompt@pesalens.invalid"
_LEGACY_EMAIL = "pytest-prompt-legacy@pesalens.invalid"
_RACE_EMAIL = "pytest-prompt-race@pesalens.invalid"
# State-changing requests are origin-checked.
_ORIGIN = {"Origin": "http://localhost:5173"}


def check(label: str, got, want) -> None:
    if got != want:
        _failures.append(f"{label}: got {got!r}, want {want!r}")
        print(f"  FAIL {label}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {label}")


def _purge(db, email: str) -> None:
    u = db.query(User).filter(User.email == email).first()
    if not u:
        return
    db.query(Feedback).filter(Feedback.user_id == u.id).delete()
    db.query(User).filter(User.id == u.id).delete()
    db.commit()


def _make_user(db, email: str) -> User:
    _purge(db, email)
    u = User(email=email, password_hash="x", full_name="Prompt Test")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _prompted(client) -> bool:
    return client.get("/api/feedback/pending").json()["data"]["should_prompt"]


def _rewind_snooze(db, user: User) -> None:
    """Move the snooze into the past — i.e. let time pass, without sleeping."""
    db.refresh(user)
    user.feedback_snooze_until = utcnow() - timedelta(minutes=1)
    db.commit()


# ---------------------------------------------------------------- the tests

def test_fresh_account_is_asked(db, user, client) -> None:
    print("a fresh account is asked")
    check("prompted", _prompted(client), True)
    check("no declines yet", user.feedback_declines, 0)


def test_dismiss_is_not_an_answer(db, user, client) -> None:
    """Clicking beside the dialog is not a decision. The old code wired the
    modal's onClose straight to skip, so a mis-click opted you out for life."""
    print("an incidental close costs a day, not a chance")

    check("dismiss ok", client.post("/api/feedback/dismiss").status_code, 200)
    db.refresh(user)
    check("no longer prompted right now", _prompted(client), False)
    check("spent NO decline", user.feedback_declines, 0)

    snoozed_for = user.feedback_snooze_until - utcnow()
    check("snoozed about a day",
          timedelta(hours=DISMISS_SNOOZE_HOURS - 1) < snoozed_for
          <= timedelta(hours=DISMISS_SNOOZE_HOURS), True)

    _rewind_snooze(db, user)
    check("asked again once the day passes", _prompted(client), True)


def test_skip_snoozes_then_returns(db, user, client) -> None:
    print("a skip snoozes")
    check("skip ok", client.post("/api/feedback/skip").status_code, 200)
    db.refresh(user)
    check("spent one chance", user.feedback_declines, 1)
    check("not asked now", _prompted(client), False)

    snoozed_for = user.feedback_snooze_until - utcnow()
    check("snoozed about three days",
          timedelta(days=SKIP_SNOOZE_DAYS - 1) < snoozed_for
          <= timedelta(days=SKIP_SNOOZE_DAYS), True)

    _rewind_snooze(db, user)
    check("asked again after the snooze", _prompted(client), True)


def test_three_declines_is_a_real_no(db, user, client) -> None:
    """One dismissal is not an answer; three active refusals are."""
    print("three declines ends the auto-prompt")
    for n in range(2, MAX_DECLINES + 1):
        _rewind_snooze(db, user)
        check(f"prompted before decline {n}", _prompted(client), True)
        client.post("/api/feedback/skip")
    db.refresh(user)
    check("declines at the cap", user.feedback_declines, MAX_DECLINES)

    # Even with time passed, we stop asking on our own. The manual entry point
    # in Settings still works — that is the part that is never taken away.
    _rewind_snooze(db, user)
    check("never auto-asked again", _prompted(client), False)


def test_submitting_ends_it(db, user2, client2) -> None:
    print("submitting stops the prompt for good")
    client2.post("/api/feedback/skip")          # one chance spent, two left
    _rewind_snooze(db, user2)
    check("still asked with chances left", _prompted(client2), True)

    res = client2.post("/api/feedback", json={
        "rating": 5,
        "experience": "Read my CRDB statement first try.",
        "audience": "Duka owners",
        "client": "web",
    })
    check("submit ok", res.status_code, 200)
    db.refresh(user2)
    check("stamped", user2.feedback_submitted_at is not None, True)
    check("snooze cleared", user2.feedback_snooze_until, None)
    check("not asked again", _prompted(client2), False)

    # A stray skip from another device must not resurrect the prompt or
    # inflate the decline count of someone who has already answered.
    before = user2.feedback_declines
    client2.post("/api/feedback/skip")
    db.refresh(user2)
    check("skip after submitting is inert", user2.feedback_declines, before)
    check("still not asked", _prompted(client2), False)


def test_volunteering_again_is_allowed(db, user2, client2) -> None:
    """A second submission from Settings is a second thing they told us."""
    print("repeat submissions are kept")
    first = db.query(Feedback).filter(Feedback.user_id == user2.id).count()
    stamped = user2.feedback_submitted_at

    res = client2.post("/api/feedback", json={
        "rating": 4, "improvements": "Swahili categories", "client": "web",
    })
    check("second submit ok", res.status_code, 200)
    check("kept as its own row",
          db.query(Feedback).filter(Feedback.user_id == user2.id).count(), first + 1)

    db.refresh(user2)
    check("first-submission stamp is not overwritten", user2.feedback_submitted_at, stamped)


def test_legacy_lockout_heals(db, legacy) -> None:
    """The exact bug that prompted this change, reproduced and fixed.

    An account whose only trace is an old `skipped=1` row — the shape the first
    tester was left in — must come out of init_db able to be asked again.
    """
    print("the legacy lockout heals itself")
    db.add(Feedback(user_id=legacy.id, user_email=legacy.email, skipped=1))
    legacy.feedback_declines = 0
    legacy.feedback_snooze_until = None
    legacy.feedback_submitted_at = None
    db.commit()

    init_db()
    db.refresh(legacy)
    check("old skip carried across as one decline", legacy.feedback_declines, 1)
    check("not snoozed, so the next trigger asks", legacy.feedback_snooze_until, None)

    app.dependency_overrides[get_current_user] = lambda: legacy
    check("promptable again", _prompted(TestClient(app, headers=_ORIGIN)), True)

    # Re-running the migration must not keep incrementing, or every boot would
    # walk a returning user towards the cap without them doing anything.
    init_db()
    init_db()
    db.refresh(legacy)
    check("backfill is idempotent", legacy.feedback_declines, 1)

    # ...and it must not walk BACKWARDS over someone's newer state either.
    legacy.feedback_declines = 2
    db.commit()
    init_db()
    db.refresh(legacy)
    check("does not clobber a later decline count", legacy.feedback_declines, 2)


def test_declines_are_not_lost_to_a_stale_read(db, race, client) -> None:
    """Two devices skipping in the same window must spend two chances, not one.

    The handler is given a `User` instance that may already be behind the
    committed row — the same staleness `_set_prompt_state` re-reads to work
    around. Computing `declines + 1` in Python from that instance means a
    phone and a browser that both read 0 both write 1, one refusal is lost, and
    the person gets asked a fourth time after telling us no three times.

    Simulated the way it actually happens: the row moves on underneath a
    request whose `user` object still remembers the old count.
    """
    print("a stale read cannot lose a decline")
    check("skip ok", client.post("/api/feedback/skip").status_code, 200)

    # Deliberately NOT refreshed: the injected instance still remembers 0 while
    # the row says 1 — which is exactly the state a second, concurrent request
    # holds. Computing the new count from this object writes 1 a second time.
    check("the injected instance is stale", race.feedback_declines, 0)
    body = client.post("/api/feedback/skip").json()["data"]
    db.refresh(race)
    check("both declines counted", race.feedback_declines, 2)
    check("the response agrees", body["declines"], 2)


def main() -> int:
    init_db()
    db = SessionLocal()
    user = user2 = legacy = race = None
    try:
        user = _make_user(db, _EMAIL)
        user2 = _make_user(db, _LEGACY_EMAIL + ".two")
        legacy = _make_user(db, _LEGACY_EMAIL)
        race = _make_user(db, _RACE_EMAIL)
        assert 1 not in (user.id, user2.id, legacy.id, race.id), "refusing to run against user 1"

        app.dependency_overrides[get_current_user] = lambda: user
        client = TestClient(app, headers=_ORIGIN)

        test_fresh_account_is_asked(db, user, client)
        test_dismiss_is_not_an_answer(db, user, client)
        test_skip_snoozes_then_returns(db, user, client)
        test_three_declines_is_a_real_no(db, user, client)

        app.dependency_overrides[get_current_user] = lambda: user2
        client2 = TestClient(app, headers=_ORIGIN)
        test_submitting_ends_it(db, user2, client2)
        test_volunteering_again_is_allowed(db, user2, client2)

        app.dependency_overrides[get_current_user] = lambda: race
        test_declines_are_not_lost_to_a_stale_read(
            db, race, TestClient(app, headers=_ORIGIN))

        test_legacy_lockout_heals(db, legacy)
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        for email in (_EMAIL, _LEGACY_EMAIL + ".two", _LEGACY_EMAIL, _RACE_EMAIL):
            _purge(db, email)
        db.close()

    print()
    if _failures:
        print(f"{len(_failures)} FAILURE(S):")
        for f in _failures:
            print("  -", f)
        return 1
    print("all tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
