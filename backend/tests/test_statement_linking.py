"""Statement↔data linking, per-receipt delete, and the "start over" reset.

    backend/venv/Scripts/python.exe backend/tests/test_statement_linking.py

SAFETY — read before editing. Every case here is destructive (it deletes
receipt files and DB rows), so it runs against a DEDICATED throwaway user
created in setup and removed in a `finally`. It must NEVER touch a real user's
data. An earlier ad-hoc version of this harness backed up a live user's
receipts, deleted them, crashed before its restore line, and lost them — hence
the rules baked in below:

  * the test user is created here and identified by _TEST_EMAIL;
  * all files live under storage/receipts/<test_user_id>/, never a real user's;
  * teardown is in `finally`, so a failed assertion still cleans up;
  * nothing reads or writes storage/receipts/1/.

What is covered:
 1. Statement scope is the caller's word: data saved without an explicit
    statement stays unscoped rather than being pinned to whichever statement is
    newest, and a statement delete therefore leaves hand-typed entries alone.
 2. `DELETE /api/receipts/{id}` removes JSON + image + scan marker, and rejects
    ids that could steer the filesystem.
 3. "Start over" refuses when anything IS attached (409) and inside the 30-day
    cooldown (429), and never touches statements or business entries.
"""

from __future__ import annotations

import json
import shutil
import sys
import uuid
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.config import settings  # noqa: E402
from app.db import (  # noqa: E402
    BusinessEntry,
    PersonalEntry,
    SessionLocal,
    Upload,
    User,
    init_db,
)
from app.deps import get_current_user  # noqa: E402
from app.main import app  # noqa: E402
from app.utils.time import utcnow  # noqa: E402

_failures: list[str] = []
_TEST_EMAIL = "pytest-linking@pesalens.invalid"
_ORIGIN = {"Origin": "http://localhost:5173"}


def check(label: str, got, want) -> None:
    if got != want:
        _failures.append(f"{label}: got {got!r}, want {want!r}")
        print(f"  FAIL {label}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {label}")


def _receipts_dir(user_id: int) -> Path:
    return settings.storage_path / "receipts" / str(user_id)


def _make_user(db) -> User:
    """A throwaway user. Reused (and re-cleaned) if a previous run died."""
    existing = db.query(User).filter(User.email == _TEST_EMAIL).first()
    if existing:
        _purge_user(db, existing)
    user = User(email=_TEST_EMAIL, password_hash="x", full_name="Linking Test")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _purge_user(db, user: User) -> None:
    uid = user.id
    db.query(PersonalEntry).filter(PersonalEntry.user_id == uid).delete()
    db.query(BusinessEntry).filter(BusinessEntry.user_id == uid).delete()
    db.query(Upload).filter(Upload.user_id == uid).delete()
    db.query(User).filter(User.id == uid).delete()
    db.commit()
    shutil.rmtree(_receipts_dir(uid), ignore_errors=True)
    shutil.rmtree(settings.results_path / str(uid), ignore_errors=True)


def _seed_receipt(user_id: int, **fields) -> str:
    """Write a receipt straight to disk (no LLM), returning its id."""
    rid = uuid.uuid4().hex[:12]
    target = _receipts_dir(user_id)
    target.mkdir(parents=True, exist_ok=True)
    body = {
        "id": rid, "vendor": "Test Vendor", "total": 1000, "currency": "TZS",
        "amount_tzs": 1000, "scanned_at": utcnow().isoformat() + "Z",
        "image_filename": f"{rid}.jpg", "items": [], **fields,
    }
    (target / f"{rid}.json").write_text(json.dumps(body), encoding="utf-8")
    (target / f"{rid}.jpg").write_bytes(b"fake-image")
    if body.get("client_scan_id"):
        (target / f".scan-{body['client_scan_id']}").write_text(rid, encoding="utf-8")
    return rid


def _seed_statement(db, user_id: int, job_id: str) -> None:
    db.add(Upload(
        user_id=user_id, job_id=job_id, filename=f"{job_id}.pdf", bank="nmb",
        total_transactions=10, status="done",
        period_start="2026-06-01", period_end="2026-06-30",
    ))
    db.commit()


# ---------------------------------------------------------------- the tests

def test_scope_is_the_callers_word(db, user, client) -> None:
    """Scope comes from the caller, never from "whatever was uploaded last".

    Resolving an absent scope to the newest statement looks like it makes the
    gallery and the delete cascade agree, but it resolves the disagreement in
    the destructive direction: data created OUTSIDE any statement becomes a
    child of an unrelated one, and deleting that statement takes it along.
    """
    print("statement scope resolution")
    from app.routers.receipts import _resolve_statement_job

    _seed_statement(db, user.id, "linkjob0001")

    # Absent scope stays absent even though a statement exists — this is the
    # whole guarantee. NULL means "general", not "newest".
    check("absent stays None", _resolve_statement_job(None), None)
    check("blank stays None", _resolve_statement_job("   "), None)

    # An explicit choice is honoured (and bounded).
    check("explicit wins", _resolve_statement_job("other999"), "other999")
    check("over-long id trimmed", len(_resolve_statement_job("x" * 80)), 40)

    _seed_statement(db, user.id, "linkjob0002")
    db.query(Upload).filter(Upload.job_id == "linkjob0002").update(
        {"period_end": "2026-07-31"}
    )
    db.commit()
    # A newer statement must NOT silently capture unscoped data.
    check("newest does not capture", _resolve_statement_job(None), None)


def test_general_entries_survive_statement_delete(db, user, client) -> None:
    """The data-loss case: deleting a statement must not touch general entries.

    A user with a statement types entries in the 'General' view. Those carry no
    statement_job_id. Deleting the statement removes what genuinely belongs to
    it and leaves the hand-typed rows alone.
    """
    print("general entries survive a statement delete")
    _seed_statement(db, user.id, "delcascade01")

    general = client.post("/api/personal/entries", headers=_ORIGIN, json={
        "entry_date": "2026-07-02", "vendor": "Corner Shop",
        "category": "Food", "amount": 4500, "direction": "expense",
    })
    check("general entry created", general.status_code, 200)
    scoped = client.post("/api/personal/entries", headers=_ORIGIN, json={
        "entry_date": "2026-07-03", "vendor": "Fuel Co", "category": "Transport",
        "amount": 30000, "direction": "expense",
        "statement_job_id": "delcascade01",
    })
    check("scoped entry created", scoped.status_code, 200)
    db.expire_all()

    # The unscoped entry must be stored as NULL, not stamped with the statement.
    stored = {
        e.vendor: e.statement_job_id
        for e in db.query(PersonalEntry).filter(
            PersonalEntry.user_id == user.id).all()
    }
    check("general entry unscoped", stored.get("Corner Shop"), None)
    check("scoped entry pinned", stored.get("Fuel Co"), "delcascade01")

    # The confirm dialog must promise only what it will actually remove.
    impact = client.get("/api/uploads/delcascade01/impact").json()["data"]
    check("impact counts scoped only", impact["personal_entries"], 1)

    res = client.delete("/api/uploads/delcascade01", headers=_ORIGIN)
    check("delete ok", res.status_code, 200)
    check("removed one entry", res.json()["data"]["personal_entries"], 1)
    db.expire_all()

    remaining = [
        e.vendor for e in db.query(PersonalEntry).filter(
            PersonalEntry.user_id == user.id).all()
    ]
    check("hand-typed entry survived", remaining, ["Corner Shop"])

    # Clean up so the later start-over cases see the account they expect.
    db.query(PersonalEntry).filter(PersonalEntry.user_id == user.id).delete()
    db.commit()


def test_receipt_delete(db, user, client) -> None:
    print("per-receipt delete")
    scan = uuid.uuid4().hex
    rid = _seed_receipt(user.id, client_scan_id=scan)
    d = _receipts_dir(user.id)

    # Ids that could escape the user's own directory must never reach the disk.
    check("non-hex id rejected",
          client.delete("/api/receipts/NOT-A-HEX-ID", headers=_ORIGIN).status_code, 404)
    check("unknown id 404",
          client.delete("/api/receipts/abcdef012345", headers=_ORIGIN).status_code, 404)
    check("victim survived probing", (d / f"{rid}.json").exists(), True)

    check("delete ok",
          client.delete(f"/api/receipts/{rid}", headers=_ORIGIN).status_code, 200)
    check("json gone", (d / f"{rid}.json").exists(), False)
    check("image gone", (d / f"{rid}.jpg").exists(), False)
    # A stale marker would make a later scan reusing that id resolve to a
    # receipt that no longer exists.
    check("scan marker gone", (d / f".scan-{scan}").exists(), False)


def test_start_over_guards(db, user, client) -> None:
    print("start over — guards")
    _seed_receipt(user.id)
    _seed_receipt(user.id, statement_job_id="linkjob0002")
    db.add(PersonalEntry(user_id=user.id, entry_date="2026-07-01",
                         category="Food", amount=500, direction="expense"))
    db.commit()

    # GUARD 1: something is attached, so the ordinary statement cascade is the
    # right tool — the bulk hammer must not be offered.
    state = client.get("/api/data/start-over/eligibility").json()["data"]
    check("ineligible while attached", state["eligible"], False)
    check("reason=attached", state["reason"], "attached")
    check("attached counted", state["attached_receipts"], 1)
    check("POST refused 409",
          client.post("/api/data/start-over", headers=_ORIGIN).status_code, 409)

    # Detach it — now everything is orphaned, which is the situation this
    # feature exists for.
    for path in _receipts_dir(user.id).glob("*.json"):
        body = json.loads(path.read_text(encoding="utf-8"))
        body.pop("statement_job_id", None)
        path.write_text(json.dumps(body), encoding="utf-8")
    state = client.get("/api/data/start-over/eligibility").json()["data"]
    check("eligible once detached", state["eligible"], True)

    # GUARD 2: cooldown.
    db.query(User).filter(User.id == user.id).update(
        {"last_orphan_reset_at": utcnow() - timedelta(days=3)}
    )
    db.commit()
    state = client.get("/api/data/start-over/eligibility").json()["data"]
    check("reason=cooldown", state["reason"], "cooldown")
    check("POST refused 429",
          client.post("/api/data/start-over", headers=_ORIGIN).status_code, 429)

    db.query(User).filter(User.id == user.id).update(
        {"last_orphan_reset_at": utcnow() - timedelta(days=31)}
    )
    db.commit()
    check("eligible after 30 days",
          client.get("/api/data/start-over/eligibility").json()["data"]["eligible"], True)


def test_start_over_run(db, user, client) -> None:
    print("start over — execution")
    db.add(BusinessEntry(user_id=user.id, entry_date="2026-07-01",
                         category="Sales", amount=999, account_class="revenue"))
    db.commit()
    uploads_before = db.query(Upload).filter(Upload.user_id == user.id).count()

    res = client.post("/api/data/start-over", headers=_ORIGIN)
    check("POST ok", res.status_code, 200)
    db.expire_all()

    check("receipts cleared",
          len(list(_receipts_dir(user.id).glob("*.json"))), 0)
    check("entries cleared",
          db.query(PersonalEntry).filter(PersonalEntry.user_id == user.id).count(), 0)
    # BusinessEntry has no statement_job_id at all, so it is permanently
    # "unattached" — clearing it here would destroy ledgers that were never
    # statement-derived.
    check("business entries KEPT",
          db.query(BusinessEntry).filter(BusinessEntry.user_id == user.id).count(), 1)
    check("statements KEPT",
          db.query(Upload).filter(Upload.user_id == user.id).count(), uploads_before)

    # Immediately after, the account is empty — so the honest refusal is
    # "nothing to clear" (409), not "wait 30 days". The cooldown is irrelevant
    # when the action would do nothing.
    check("second call refused",
          client.post("/api/data/start-over", headers=_ORIGIN).status_code, 409)
    check("reason=nothing_to_clear",
          client.get("/api/data/start-over/eligibility").json()["data"]["reason"],
          "nothing_to_clear")

    # But the allowance IS spent: give the account something to clear again and
    # the 30-day gate must bite.
    _seed_receipt(user.id)
    check("cooldown now applies",
          client.get("/api/data/start-over/eligibility").json()["data"]["reason"],
          "cooldown")
    check("refused 429 with data present",
          client.post("/api/data/start-over", headers=_ORIGIN).status_code, 429)


def main() -> int:
    init_db()  # heals users.last_orphan_reset_at on an older dev DB
    db = SessionLocal()
    user = None
    try:
        user = _make_user(db)
        assert user.id != 1, "refusing to run against user 1"
        app.dependency_overrides[get_current_user] = lambda: user
        client = TestClient(app)

        for fn in (test_scope_is_the_callers_word,
                   test_general_entries_survive_statement_delete,
                   test_receipt_delete,
                   test_start_over_guards, test_start_over_run):
            fn(db, user, client)
    finally:
        # Runs even when an assertion or the server raises — the failure mode
        # that lost real data was a cleanup step that only ran on success.
        app.dependency_overrides.pop(get_current_user, None)
        if user is not None:
            _purge_user(db, user)
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
