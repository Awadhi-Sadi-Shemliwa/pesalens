"""Personal Spending entries CRUD — replaces in-memory React state."""

import re
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import PersonalEntry, User, get_db
from app.deps import get_current_user
from app.schemas.response import APIResponse

router = APIRouter(tags=["personal"], prefix="/personal")


_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class EntryIn(BaseModel):
    entry_date: str = Field(min_length=10, max_length=10)
    vendor: Optional[str] = Field(default=None, max_length=120)
    category: str = Field(min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=400)
    amount: float = Field(gt=0)
    direction: Literal["income", "expense"] = "expense"


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
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
    }


@router.get("/entries", response_model=APIResponse)
def list_entries(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(PersonalEntry)
        .filter(PersonalEntry.user_id == user.id)
        .order_by(PersonalEntry.entry_date.desc(), PersonalEntry.id.desc())
        .all()
    )
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
