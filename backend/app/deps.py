"""Reusable FastAPI dependencies (auth + DB)."""

from typing import Optional

import jwt
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.db import User, get_db
from app.security import decode_token
from app.services.auth_security import is_revoked, session_invalid
from app.services.subscription import resolve as resolve_subscription


def _extract_bearer(authorization: Optional[str]) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Empty bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token


def get_current_user(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    token = _extract_bearer(authorization)
    try:
        payload = decode_token(token, expected_type="access")
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if is_revoked(db, payload.get("jti", "")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        user_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User no longer exists")

    if session_invalid(user, int(payload.get("iat", 0))):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session invalidated — please sign in again",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_active_plan(user: User = Depends(get_current_user)) -> User:
    """Gate Pro features. Returns the user when their trial is still
    running or their Pro subscription is active; otherwise 402 Payment
    Required so the frontend can route to /upgrade.
    """
    state = resolve_subscription(user)
    if state.is_active:
        return user
    raise HTTPException(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail={
            "code": "subscription_required",
            "status": state.status,
            "message": (
                "Your 14-day trial has ended."
                if state.status == "trial_expired"
                else "Your Pro subscription has expired."
            ),
            "upgrade_url": "/upgrade",
        },
    )


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Allow only emails listed in BILLING_ADMINS to call the manual
    payment-confirmation endpoint. Returning 404 (not 403) avoids leaking
    that the endpoint exists to non-admins.
    """
    if not user.email or user.email.lower() not in settings.billing_admin_emails:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return user


def require_system_admin(user: User = Depends(get_current_user)) -> User:
    """Allow only the dedicated owner-console allowlist (ADMIN_EMAILS, falling
    back to BILLING_ADMINS) to call /api/admin/*. Kept separate from
    `require_admin` so granting billing rights never silently widens into
    full-system read access. 404 (not 403) avoids leaking the endpoint.
    """
    if not user.email or user.email.lower() not in settings.admin_console_emails:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return user
