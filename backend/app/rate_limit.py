"""Rate limiter (slowapi) — per-IP fallback, per-user when authenticated.

Authenticated requests are keyed by user.id so a single attacker rotating
through proxies cannot bypass uploads/AI/OCR limits. Anonymous traffic
keys on remote IP as before.
"""

from __future__ import annotations

import jwt
from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from app.config import settings


def _user_or_ip(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth.split(" ", 1)[1].strip()
        try:
            payload = jwt.decode(
                token,
                settings.jwt_secret,
                algorithms=[settings.jwt_algorithm],
                options={"verify_exp": False},  # rate limit even if just expired
            )
            sub = payload.get("sub")
            if sub:
                return f"u:{sub}"
        except Exception:
            pass
    return f"ip:{get_remote_address(request)}"


limiter = Limiter(
    key_func=_user_or_ip,
    default_limits=[settings.rate_limit_default],
)
