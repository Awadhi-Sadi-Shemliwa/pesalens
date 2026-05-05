"""Auth hardening: token revocation, account lockout, email codes, audit.

Kept dependency-light on purpose — everything goes through the existing
SQLAlchemy session so we don't bring Redis into the MVP. When traffic
warrants it, swap `is_revoked` and `record_revocation` for a Redis SET.
"""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.db import AuditLog, EmailCode, FailedLogin, RevokedToken, User
from app.security import hash_secret, verify_secret
from app.utils.logger import get_logger
from app.utils.time import utcfromtimestamp, utcnow

log = get_logger(__name__)


# --------------------------- token revocation ---------------------------

def is_revoked(db: Session, jti: str) -> bool:
    if not jti:
        return True
    row = db.query(RevokedToken).filter(RevokedToken.jti == jti).first()
    return bool(row)


def revoke_jti(
    db: Session,
    jti: str,
    user_id: Optional[int],
    expires_at: datetime,
    token_type: str = "access",
) -> None:
    if not jti:
        return
    if db.query(RevokedToken).filter(RevokedToken.jti == jti).first():
        return
    db.add(RevokedToken(
        jti=jti,
        user_id=user_id,
        token_type=token_type,
        expires_at=expires_at,
    ))
    db.commit()


def session_invalid(user: User, issued_at_unix: int) -> bool:
    """True if the user's `sessions_invalid_before` is later than the
    token's iat — used to nuke every outstanding token on password
    change / global logout without enumerating jtis."""
    if not user.sessions_invalid_before:
        return False
    return utcfromtimestamp(issued_at_unix) < user.sessions_invalid_before


# --------------------------- account lockout ---------------------------

def _lockout_record(db: Session, email: str) -> FailedLogin:
    row = db.query(FailedLogin).filter(FailedLogin.email == email).first()
    if not row:
        row = FailedLogin(email=email, fail_count=0)
        db.add(row)
        db.flush()
    return row


def is_locked(db: Session, email: str) -> Optional[datetime]:
    row = db.query(FailedLogin).filter(FailedLogin.email == email).first()
    if row and row.locked_until and row.locked_until > utcnow():
        return row.locked_until
    return None


def record_login_failure(db: Session, email: str) -> None:
    row = _lockout_record(db, email)
    now = utcnow()
    window = timedelta(minutes=settings.lockout_window_min)
    if row.last_fail_at and (now - row.last_fail_at) > window:
        row.fail_count = 1
    else:
        row.fail_count = (row.fail_count or 0) + 1
    row.last_fail_at = now
    if row.fail_count >= settings.lockout_max_fails:
        row.locked_until = now + timedelta(minutes=settings.lockout_duration_min)
        log.warning("Account locked: %s until %s", email[:3] + "***", row.locked_until)
    db.commit()


def record_login_success(db: Session, email: str) -> None:
    row = db.query(FailedLogin).filter(FailedLogin.email == email).first()
    if row:
        row.fail_count = 0
        row.locked_until = None
        db.commit()


# --------------------------- email codes ---------------------------

def _generate_code() -> str:
    """6-digit numeric code (cryptographically random)."""
    return f"{secrets.randbelow(1_000_000):06d}"


def issue_code(db: Session, user_id: int, purpose: str, ttl_minutes: int) -> str:
    """Mint a fresh code, invalidate any older ones for the same purpose,
    return the plaintext code (only the hash is stored)."""
    db.query(EmailCode).filter(
        EmailCode.user_id == user_id,
        EmailCode.purpose == purpose,
        EmailCode.consumed_at.is_(None),
    ).update({"consumed_at": utcnow()})
    code = _generate_code()
    db.add(EmailCode(
        user_id=user_id,
        purpose=purpose,
        code_hash=hash_secret(code),
        expires_at=utcnow() + timedelta(minutes=ttl_minutes),
    ))
    db.commit()
    return code


def consume_code(db: Session, user_id: int, purpose: str, code: str) -> bool:
    """Verify and burn a one-time code. Returns True on success."""
    row = (
        db.query(EmailCode)
        .filter(
            EmailCode.user_id == user_id,
            EmailCode.purpose == purpose,
            EmailCode.consumed_at.is_(None),
        )
        .order_by(EmailCode.created_at.desc())
        .first()
    )
    if not row:
        return False
    row.attempts = (row.attempts or 0) + 1
    if row.expires_at < utcnow() or row.attempts > 5:
        row.consumed_at = utcnow()
        db.commit()
        return False
    if not verify_secret(code, row.code_hash):
        db.commit()
        return False
    row.consumed_at = utcnow()
    db.commit()
    return True


# --------------------------- mailer ---------------------------

def send_email(to: str, subject: str, body: str) -> bool:
    """Send transactional email. Falls back to logging when no provider
    is configured — keeps dev usable without forcing Resend setup."""
    if not settings.resend_api_key:
        log.info("[email:dev-stub] to=%s subject=%s body=%s", to, subject, body)
        return True
    payload = {
        "from": settings.email_from,
        "to": [to],
        "subject": subject,
        "text": body,
    }
    if settings.email_reply_to:
        payload["reply_to"] = settings.email_reply_to
    try:
        resp = httpx.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {settings.resend_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=15.0,
        )
        if resp.status_code >= 400:
            log.warning("Resend send failed %s: %s", resp.status_code, resp.text[:200])
            return False
        return True
    except Exception as exc:  # noqa: BLE001
        log.warning("Resend transport error: %s", exc)
        return False


# --------------------------- audit ---------------------------

def audit(
    db: Session,
    event: str,
    user_id: Optional[int] = None,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    details: Optional[dict] = None,
) -> None:
    try:
        db.add(AuditLog(
            user_id=user_id,
            event=event[:60],
            ip=(ip or "")[:64] or None,
            user_agent=(user_agent or "")[:255] or None,
            details=json.dumps(details, default=str) if details else None,
        ))
        db.commit()
    except Exception:
        db.rollback()
