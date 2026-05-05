"""Password hashing + JWT issuance / verification.

Uses bcrypt directly (skipping passlib because passlib's backend probe is
incompatible with bcrypt >= 4.x on Python 3.13). bcrypt enforces a 72-byte
input cap; we reject anything longer at the API layer rather than silently
truncate.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt

from app.config import settings

PASSWORD_MAX_BYTES = 72


def hash_password(plain: str) -> str:
    pw = plain.encode("utf-8")
    if len(pw) > PASSWORD_MAX_BYTES:
        raise ValueError("password too long")
    return bcrypt.hashpw(pw, bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        pw = plain.encode("utf-8")
        if len(pw) > PASSWORD_MAX_BYTES:
            return False
        return bcrypt.checkpw(pw, hashed.encode("utf-8"))
    except Exception:
        return False


def hash_secret(value: str) -> str:
    """Bcrypt-hash a short secret (e.g. an email verification code)."""
    return bcrypt.hashpw(value.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")


def verify_secret(value: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(value.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def _new_jti() -> str:
    return secrets.token_urlsafe(18)


# Visually unambiguous alphabet — drops 0/O, 1/I/l, B/8 etc. so a user
# typing the password from an email doesn't fight homoglyphs.
_INITIAL_PW_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ" "abcdefghijkmnpqrstuvwxyz" "23456789"


def generate_initial_password(length: int = 12) -> str:
    """Cryptographically random temp password emailed at signup.

    Always contains at least one letter and at least one digit so it
    passes `_validate_password` if the user later reuses it elsewhere.
    """
    if length < 8:
        length = 8
    while True:
        pw = "".join(secrets.choice(_INITIAL_PW_ALPHABET) for _ in range(length))
        has_letter = any(c.isalpha() for c in pw)
        has_digit = any(c.isdigit() for c in pw)
        if has_letter and has_digit:
            return pw


def _encode(payload: dict, ttl: timedelta, token_type: str, jti: Optional[str] = None) -> tuple[str, str, datetime]:
    now = datetime.now(timezone.utc)
    exp = now + ttl
    body = {
        **payload,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "type": token_type,
        "jti": jti or _new_jti(),
    }
    token = jwt.encode(body, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, body["jti"], exp


def create_access_token(user_id: int, email: str) -> tuple[str, str, datetime]:
    """Returns (token, jti, expires_at_utc)."""
    return _encode(
        {"sub": str(user_id), "email": email},
        timedelta(minutes=settings.jwt_access_ttl_minutes),
        "access",
    )


def create_refresh_token(user_id: int) -> tuple[str, str, datetime]:
    """Returns (token, jti, expires_at_utc)."""
    return _encode(
        {"sub": str(user_id)},
        timedelta(days=settings.jwt_refresh_ttl_days),
        "refresh",
    )


def decode_token(token: str, expected_type: str) -> dict:
    payload = jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[settings.jwt_algorithm],
    )
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError("wrong token type")
    if not payload.get("jti"):
        raise jwt.InvalidTokenError("missing jti")
    return payload
