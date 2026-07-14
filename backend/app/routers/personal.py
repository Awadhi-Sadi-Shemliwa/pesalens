"""Personal Spending entries CRUD — replaces in-memory React state."""

import re
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db import PersonalEntry, User, get_db
from app.deps import get_current_user
from app.schemas.response import APIResponse
from app.services.analytics import newest_job_id

router = APIRouter(tags=["personal"], prefix="/personal")


_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class EntryIn(BaseModel):
    entry_date: str = Field(min_length=10, max_length=10)
    vendor: Optional[str] = Field(default=None, max_length=120)
    category: str = Field(min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=400)
    amount: float = Field(gt=0)
    direction: Literal["income", "expense"] = "expense"
    # Statement this entry is recorded against (Epic-2 per-statement scoping).
    # Optional — omitted entries resolve to the newest statement at read time.
    statement_job_id: Optional[str] = Field(default=None, max_length=40)


def _validate_date(date_str: str) -> None:
    if not _DATE_RE.match(date_str):
        raise HTTPException(status_code=400, detail="entry_date must be YYYY-MM-DD")
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="entry_date is not a valid date")


def _serialize(entry: PersonalEntry) -> dict:
    return {
        "id": entry.id,
        "entry_date": entry.entry_date,
        "vendor": entry.vendor,
        "category": entry.category,
        "description": entry.description,
        "amount": entry.amount,
        "direction": entry.direction,
        "statement_job_id": entry.statement_job_id,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
    }


@router.get("/entries", response_model=APIResponse)
def list_entries(
    scope: Optional[Literal["statement", "general"]] = Query(default=None),
    job_id: Optional[str] = Query(default=None),
    day: Optional[str] = Query(default=None),
    start: Optional[str] = Query(default=None),
    end: Optional[str] = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List this user's manual entries, optionally scoped.

    No scope params → the full list (unchanged default behaviour).
    `scope=statement&job_id=X` → only entries belonging to statement X, where a
    NULL association resolves to the user's newest statement.
    `scope=general` with `day` or `start`/`end` → entries whose date is in that
    window.
    """
    q = db.query(PersonalEntry).filter(PersonalEntry.user_id == user.id)

    if scope == "statement" and job_id:
        newest = newest_job_id(user.id, db=db)
        conds = [PersonalEntry.statement_job_id == job_id]
        # A NULL association means "belongs to the newest statement".
        if newest is not None and job_id == newest:
            conds.append(PersonalEntry.statement_job_id.is_(None))
        q = q.filter(or_(*conds))
    elif scope == "general":
        if day:
            _validate_date(day)
            q = q.filter(PersonalEntry.entry_date == day)
        else:
            if start:
                _validate_date(start)
                q = q.filter(PersonalEntry.entry_date >= start)
            if end:
                _validate_date(end)
                q = q.filter(PersonalEntry.entry_date <= end)

    rows = q.order_by(PersonalEntry.entry_date.desc(), PersonalEntry.id.desc()).all()
    return APIResponse(
        success=True, message="ok",
        data={"entries": [_serialize(r) for r in rows]},
    )


@router.post("/entries", response_model=APIResponse)
def create_entry(
    payload: EntryIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _validate_date(payload.entry_date)
    entry = PersonalEntry(
        user_id=user.id,
        entry_date=payload.entry_date,
        vendor=(payload.vendor or "").strip()[:120] or None,
        category=payload.category.strip(),
        description=(payload.description or "").strip() or None,
        amount=float(payload.amount),
        direction=payload.direction,
        statement_job_id=(payload.statement_job_id or "").strip()[:40] or None,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return APIResponse(success=True, message="Entry saved", data=_serialize(entry))


@router.delete("/entries/{entry_id}", response_model=APIResponse)
def delete_entry(
    entry_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entry = (
        db.query(PersonalEntry)
        .filter(PersonalEntry.id == entry_id, PersonalEntry.user_id == user.id)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    db.delete(entry)
    db.commit()
    return APIResponse(success=True, message="Entry deleted", data={"id": entry_id})
