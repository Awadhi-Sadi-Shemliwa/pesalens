"""Activity capture, the owner console's read surface, and the feedback gate.

    backend/venv/Scripts/python.exe backend/tests/test_transparency.py

SAFETY — same rules as test_statement_linking.py. Every case runs against
DEDICATED throwaway users created in setup and removed in a `finally`, never a
real account, and nothing here reads or writes storage for user 1.

What is covered:

1. **Deletions leave a trace.** Deleting a spending or ledger entry writes an
   audit row carrying WHAT was deleted (vendor, amount, date), not merely that
   a delete happened. This is the whole point of the feature: "my data
   vanished" must have a specific answer.
2. **Handled failures are recorded.** A failure that returns a friendly HTTP
   200 message instead of raising is invisible to the exception handler, so
   `record_error` has to put it in the ledger itself — and must never raise
   into the caller while doing so.
3. **The feedback prompt fires exactly once.** Submitting closes it; SKIPPING
   also closes it (that is the design — the skip is stored precisely so the
   prompt cannot come back). A skip must never overwrite a real submission.
4. **The console can answer its two questions.** `group=destructive` isolates
   who deleted something and `group=failure` who hit a problem; the per-user
   timeline interleaves both tables into one ordering.
5. **A user sees their own failures.** /auth/me/activity merges the user's own
   error rows into their timeline with a quotable reference.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.config import settings  # noqa: E402
from app.db import (  # noqa: E402
    AuditLog,
    BusinessEntry,
    ErrorLog,
    Feedback,
    PersonalEntry,
    SessionLocal,
    Upload,
    User,
    init_db,
)
from app.deps import get_current_user, require_system_admin  # noqa: E402
from app.main import app  # noqa: E402

_failures: list[str] = []
_TEST_EMAIL = "pytest-transparency@pesalens.invalid"
_ADMIN_EMAIL = "pytest-transparency-admin@pesalens.invalid"
# State-changing requests are origin-checked, so every client here carries one
# by default rather than each call site remembering to.
_ORIGIN = {"Origin": "http://localhost:5173"}
# Stamped on the error rows this suite writes WITHOUT a user, so teardown can
# find them. Purging by user id alone would leave them behind for good.
_ORPHAN_MARKER = "pytest://transparency-orphan"


def check(label: str, got, want) -> None:
    if got != want:
        _failures.append(f"{label}: got {got!r}, want {want!r}")
        print(f"  FAIL {label}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {label}")


def check_true(label: str, got) -> None:
    check(label, bool(got), True)


def _purge_user(db, user: User) -> None:
    uid = user.id
    db.query(PersonalEntry).filter(PersonalEntry.user_id == uid).delete()
    db.query(BusinessEntry).filter(BusinessEntry.user_id == uid).delete()
    db.query(Upload).filter(Upload.user_id == uid).delete()
    db.query(AuditLog).filter(AuditLog.user_id == uid).delete()
    db.query(ErrorLog).filter(ErrorLog.user_id == uid).delete()
    db.query(Feedback).filter(Feedback.user_id == uid).delete()
    db.query(User).filter(User.id == uid).delete()
    db.commit()
    shutil.rmtree(settings.storage_path / "receipts" / str(uid), ignore_errors=True)


def _make_user(db, email: str, name: str) -> User:
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        _purge_user(db, existing)
    user = User(email=email, password_hash="x", full_name=name)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _events(db, user_id: int) -> list[str]:
    return [
        e for (e,) in db.query(AuditLog.event)
        .filter(AuditLog.user_id == user_id)
        .order_by(AuditLog.created_at.desc()).all()
    ]


def _audit_details(db, user_id: int, event: str) -> dict | None:
    import json
    row = (
        db.query(AuditLog)
        .filter(AuditLog.user_id == user_id, AuditLog.event == event)
        .order_by(AuditLog.created_at.desc()).first()
    )
    if row is None or not row.details:
        return None
    return json.loads(row.details)


# ---------------------------------------------------------------- the tests

def test_deletions_are_recorded_with_what_was_lost(db, user, client) -> None:
    """An audit line that says only "an entry was deleted" cannot answer the
    question anyone actually asks, which is WHICH money disappeared."""
    print("deletions carry a snapshot")

    created = client.post("/api/personal/entries", json={
        "entry_date": "2026-07-01", "vendor": "Shoppers Plaza",
        "category": "Groceries", "amount": 42500, "direction": "expense",
    })
    check("entry created", created.status_code, 200)
    entry_id = created.json()["data"]["id"]

    resp = client.delete(f"/api/personal/entries/{entry_id}")
    check("delete ok", resp.status_code, 200)
    check_true("personal delete audited",
               "personal_entry_deleted" in _events(db, user.id))
    details = _audit_details(db, user.id, "personal_entry_deleted")
    check("snapshot vendor", (details or {}).get("vendor"), "Shoppers Plaza")
    check("snapshot amount", (details or {}).get("amount"), 42500)
    check("snapshot date", (details or {}).get("entry_date"), "2026-07-01")

    # The ledger side takes the same path through a different router.
    b = client.post("/api/business/entries", json={
        "entry_date": "2026-07-02", "vendor": "Azam Printers",
        "category": "Office", "amount": 90000, "account_class": "expense",
    })
    check("ledger entry created", b.status_code, 200)
    bid = b.json()["data"]["id"]
    client.delete(f"/api/business/entries/{bid}")
    check_true("business delete audited",
               "business_entry_deleted" in _events(db, user.id))
    check("ledger snapshot vendor",
          (_audit_details(db, user.id, "business_entry_deleted") or {}).get("vendor"),
          "Azam Printers")

    # A delete that finds nothing must not fabricate an audit row — the trail
    # has to mean "this actually happened".
    before = len(_events(db, user.id))
    missing = client.delete("/api/personal/entries/99999999")
    check("missing entry 404s", missing.status_code, 404)
    check("no audit row for a no-op delete", len(_events(db, user.id)), before)


def test_handled_failures_reach_the_ledger(db, user, client) -> None:
    """The failures that return HTTP 200 with a friendly message are exactly
    the ones the exception handler never sees."""
    print("handled failures are recorded")
    from app.services.activity import record_error

    record_error("receipt_scan_failed", "gemini: quota_exhausted; openrouter: 429",
                 user_id=user.id, path="/receipts/scan", method="POST",
                 stage="vision", source="handled")
    row = (
        db.query(ErrorLog)
        .filter(ErrorLog.user_id == user.id,
                ErrorLog.error_code == "receipt_scan_failed")
        .first()
    )
    check_true("error row written", row is not None)
    check("source tagged", row.source, "handled")
    check("stage kept", row.stage, "vision")
    check_true("operator diagnostic kept", "quota_exhausted" in (row.message or ""))

    # It must never raise into the caller — it is called from `except` blocks,
    # where a second exception would mask the first. These two rows carry no
    # user (that is part of what is being exercised), so they are stamped with
    # _ORPHAN_MARKER: teardown purges by user id, and without a marker these
    # would accumulate in the real error log on every run — this suite polluting
    # the very ledger it exists to protect.
    try:
        record_error("x" * 200, "y" * 5000, user_id=None, source="handled",
                     path=_ORPHAN_MARKER)
        record_error(None, None, path=_ORPHAN_MARKER)  # type: ignore[arg-type]
        raised = False
    except Exception:  # noqa: BLE001
        raised = True
    check("never raises into the caller", raised, False)
    # Oversized input is truncated to the column width rather than blowing up
    # the insert — a reporter that dies on a long stack trace reports nothing.
    long_row = (
        db.query(ErrorLog)
        .filter(ErrorLog.path == _ORPHAN_MARKER, ErrorLog.error_code.like("x%"))
        .first()
    )
    check("over-long code truncated to the column width", len(long_row.error_code), 40)
    check("over-long message truncated too", len(long_row.message), 2000)


def test_feedback_is_asked_once(db, user, client) -> None:
    """Submitting closes the prompt; skipping closes it too, and a later skip
    must not overwrite a real submission."""
    print("feedback gate")

    check("prompted on a fresh account",
          client.get("/api/feedback/pending").json()["data"]["should_prompt"], True)

    posted = client.post("/api/feedback", json={
        "rating": 4,
        "experience": "Read my NMB statement correctly first try.",
        "improvements": "Swahili categories",
        "problem_solved": "Knowing where money goes without a bookkeeper",
        "audience": "Small shops and SACCOs",
        "referrals": "My cousin's hardware store",
        "client": "web",
    })
    check("submit ok", posted.status_code, 200)
    check("prompt closes after submitting",
          client.get("/api/feedback/pending").json()["data"]["should_prompt"], False)
    check_true("submission audited", "feedback_submitted" in _events(db, user.id))

    saved = db.query(Feedback).filter(Feedback.user_id == user.id).first()
    check("rating stored", saved.rating, 4)
    check("audience stored", saved.audience, "Small shops and SACCOs")
    check("client tagged", saved.client, "web")
    check("not marked skipped", saved.skipped, 0)

    # A skip arriving afterwards (second device) must leave the answer alone.
    client.post("/api/feedback/skip")
    rows = db.query(Feedback).filter(Feedback.user_id == user.id).all()
    check("skip did not add a row", len(rows), 1)
    check("skip did not clobber the submission", rows[0].rating, 4)


def test_skipping_does_not_pollute_the_responses(db, user2, client2) -> None:
    """A decline is prompt STATE, not a response.

    The full snooze/cap/re-ask rules live in test_feedback_prompting.py. What
    matters here is the boundary that keeps the console readable: a skip must
    leave no row in the response table, or the operator's Feedback tab fills
    with blank entries from people who said nothing.
    """
    print("a skip is state, not a response")
    check("prompted first",
          client2.get("/api/feedback/pending").json()["data"]["should_prompt"], True)
    check("skip ok", client2.post("/api/feedback/skip").status_code, 200)
    check("not asked again right away",
          client2.get("/api/feedback/pending").json()["data"]["should_prompt"], False)
    check("no empty row in the response log",
          db.query(Feedback).filter(Feedback.user_id == user2.id).count(), 0)
    db.refresh(user2)
    check("recorded against the account instead", user2.feedback_declines, 1)


def test_client_errors_land_in_the_same_ledger(db, user, client) -> None:
    """A browser crash never reaches the server's exception handler."""
    print("client crash reporting")
    resp = client.post("/api/telemetry/client-error", json={
        "error_code": "render_crash",
        "message": "TypeError: cannot read properties of undefined (reading 'map')",
        "path": "/dashboard",
        "client": "web",
    })
    check("accepted", resp.status_code, 200)
    row = (
        db.query(ErrorLog)
        .filter(ErrorLog.user_id == user.id, ErrorLog.error_code == "render_crash")
        .first()
    )
    check_true("stored", row is not None)
    check("tagged as the client that reported it", row.source, "web")
    check("method marks its origin", row.method, "CLIENT")


def test_admin_console_answers_its_two_questions(db, user, admin_client) -> None:
    """'Who deleted something' and 'who hit a problem', each one filter away."""
    print("owner console filters")

    destructive = admin_client.get("/api/admin/activity?group=destructive").json()["data"]
    events = {a["event"] for a in destructive["activity"]}
    check_true("deletes are isolated",
               {"personal_entry_deleted", "business_entry_deleted"} <= events)
    check_true("every row in the group is flagged destructive",
               all(a["destructive"] for a in destructive["activity"]))
    check_true("details survive to the console",
               any((a.get("details") or {}).get("vendor") == "Shoppers Plaza"
                   for a in destructive["activity"]))
    check_true("rows carry the account's email, not just an id",
               all(a.get("user_email") for a in destructive["activity"]
                   if a.get("user_id")))

    failures = admin_client.get("/api/admin/activity?group=failure").json()["data"]
    check_true("failures are isolated",
               all(a["failure"] for a in failures["activity"]))

    # Errors: filterable by source, and 'server' must still find the legacy
    # rows written before the column existed (NULL).
    handled = admin_client.get("/api/admin/errors?source=handled").json()["data"]
    check_true("source filter works",
               all(e["source"] == "handled" for e in handled["errors"]))
    check_true("codes are discovered from the data, not hardcoded",
               "receipt_scan_failed" in handled["codes"])
    check_true("errors carry a quotable ref",
               all(e["ref"].startswith("ERR-") for e in handled["errors"]))

    scoped = admin_client.get(f"/api/admin/errors?user_id={user.id}").json()["data"]
    check_true("per-user error filter",
               all(e["user_id"] == user.id for e in scoped["errors"]))

    stats = admin_client.get("/api/admin/stats").json()["data"]
    check_true("deletions counted", stats["deletions_7d"] >= 2)
    check_true("recent errors counted separately from all-time",
               stats["errors_24h"] >= 1 and stats["total_errors"] >= stats["errors_24h"])
    check_true("feedback counted", stats["feedback_count"] >= 1)
    check("average rating computed", stats["avg_rating"], 4.0)
    # The funnel, not just the tally: a raw count only ever goes up and cannot
    # say whether the prompt is earning its interruption.
    check_true("responders counted as people", stats["feedback_responders"] >= 1)
    check_true("response rate computed",
               isinstance(stats["feedback_rate"], int) and 0 <= stats["feedback_rate"] <= 100)

    fb = admin_client.get("/api/admin/feedback").json()["data"]
    check_true("responses readable", any(
        f["audience"] == "Small shops and SACCOs" for f in fb["feedback"]))
    # Declines are prompt state now, so the response log holds only real
    # answers — the operator's tab can never fill with blank skip rows.
    check_true("no blank skip rows in the log",
               all(not f["skipped"] for f in fb["feedback"]))
    check_true("histogram present", fb["histogram"].get("4", 0) >= 1)


def test_user_timeline_interleaves_both_tables(db, user, admin_client) -> None:
    """Seeing the failure next to the action that caused it is the point."""
    print("per-user timeline")
    data = admin_client.get(f"/api/admin/users/{user.id}/timeline").json()["data"]
    check("names the user", data["user"]["email"], _TEST_EMAIL)
    kinds = {i["kind"] for i in data["timeline"]}
    check_true("both sources present", {"activity", "error"} <= kinds)

    stamps = [i["created_at"] for i in data["timeline"] if i["created_at"]]
    check("one ordering across both", stamps, sorted(stamps, reverse=True))

    missing = admin_client.get("/api/admin/users/99999999/timeline")
    check("unknown user 404s", missing.status_code, 404)


def test_user_sees_their_own_failures(db, user, client) -> None:
    """Transparency runs both ways — the user's own feed shows what broke."""
    print("user-facing timeline")
    items = client.get("/api/auth/me/activity").json()["data"]["activity"]
    kinds = {i["kind"] for i in items}
    check_true("issues merged into the user's feed", "issue" in kinds)

    issue = next(i for i in items if i["kind"] == "issue")
    check_true("quotable reference", issue["ref"].startswith("ERR-"))
    check_true("plain-language title", issue["title"] and "_" not in issue["title"])
    # The operator's diagnostic names models and quota codes. It must not be
    # handed to the user along with it.
    check_true("no operator diagnostic leaked to the user",
               all("quota_exhausted" not in str(i) for i in items))

    deleted = next((i for i in items if i["event"] == "personal_entry_deleted"), None)
    check_true("their own deletion is in their history", deleted is not None)
    check("titled in product voice", deleted["title"], "Spending entry deleted")

    stamps = [i["created_at"] for i in items if i["created_at"]]
    check("newest first", stamps, sorted(stamps, reverse=True))


def main() -> int:
    init_db()
    db = SessionLocal()
    user = user2 = admin = None
    try:
        user = _make_user(db, _TEST_EMAIL, "Transparency Test")
        user2 = _make_user(db, _ADMIN_EMAIL, "Transparency Admin")
        assert user.id != 1 and user2.id != 1, "refusing to run against user 1"

        app.dependency_overrides[get_current_user] = lambda: user
        app.dependency_overrides[require_system_admin] = lambda: user2
        client = TestClient(app, headers=_ORIGIN)
        admin_client = client  # same app, admin gate overridden above

        test_deletions_are_recorded_with_what_was_lost(db, user, client)
        test_handled_failures_reach_the_ledger(db, user, client)
        test_feedback_is_asked_once(db, user, client)
        test_client_errors_land_in_the_same_ledger(db, user, client)

        # The skip path needs an account that has NOT already answered, so it
        # borrows user2 with the identity override swapped over. It runs BEFORE
        # the console tests on purpose: those assert that a skipped row is
        # hidden by default and visible on request, which needs one to exist.
        app.dependency_overrides[get_current_user] = lambda: user2
        test_skipping_does_not_pollute_the_responses(db, user2, TestClient(app, headers=_ORIGIN))
        app.dependency_overrides[get_current_user] = lambda: user

        test_admin_console_answers_its_two_questions(db, user, admin_client)
        test_user_timeline_interleaves_both_tables(db, user, admin_client)
        test_user_sees_their_own_failures(db, user, client)
    finally:
        # Runs even when an assertion or the server raises — the failure mode
        # that lost real data was a cleanup step that only ran on success.
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(require_system_admin, None)
        for u in (user, user2, admin):
            if u is not None:
                _purge_user(db, u)
        # The user-less error rows this suite writes on purpose. _purge_user
        # matches on user_id, so these need their own sweep or they survive
        # every run and slowly fill the operator's console with test noise.
        db.query(ErrorLog).filter(ErrorLog.path == _ORPHAN_MARKER).delete()
        db.commit()
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
