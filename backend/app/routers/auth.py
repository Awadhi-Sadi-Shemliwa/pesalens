"""Authentication: signup, signin, token refresh, current user.

Hardened with: account lockout, refresh-token rotation + reuse detection,
JWT revocation (logout), email verification, password reset, account
export + deletion (PDPA / GDPR-style), audit logging.
"""

import hashlib
import re
import secrets
from datetime import timedelta
from typing import Literal, Optional
from urllib.parse import quote

import jwt
from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.config import settings
from app.db import AuditLog, ErrorLog, User, get_db
from app.deps import get_current_user
from app.rate_limit import limiter
from app.schemas.response import APIResponse
from app.utils.time import utcfromtimestamp, utcnow
from app.security import (
    PASSWORD_MAX_BYTES,
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_initial_password,
    hash_password,
    verify_password,
)
from app.services.auth_security import (
    audit,
    consume_code,
    is_locked,
    is_revoked,
    issue_code,
    record_login_failure,
    record_login_success,
    revoke_jti,
    send_email,
)
from app.services.subscription import summarize as summarize_subscription
from app.utils.logger import get_logger

log = get_logger(__name__)
router = APIRouter(tags=["auth"], prefix="/auth")


_ACCOUNT_TYPES = {"individual", "business"}
_PASSWORD_RE = re.compile(r"[A-Za-z]")
_DIGIT_RE = re.compile(r"\d")


class SignUpRequest(BaseModel):
    """Signup is passwordless from the client's perspective. The backend
    generates a strong random password, emails it to the user, and that
    password is what unlocks the account on first sign-in. Users can
    rotate the password later via /auth/change-password."""

    email: EmailStr
    full_name: Optional[str] = Field(default=None, max_length=120)
    account_type: Literal["individual", "business"] = "individual"


class SignInRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    # Optional — web clients leave it empty and rely on the httpOnly
    # cookie. Mobile clients still send it in the body.
    refresh_token: Optional[str] = None


class VerifyEmailRequest(BaseModel):
    code: str = Field(min_length=4, max_length=12)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=12)
    new_password: str = Field(min_length=8, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


def _validate_password(password: str) -> None:
    if len(password.encode("utf-8")) > PASSWORD_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Password is too long")
    if not _PASSWORD_RE.search(password) or not _DIGIT_RE.search(password):
        raise HTTPException(
            status_code=400,
            detail="Password must contain at least one letter and one number",
        )


def _client_meta(request: Request) -> tuple[str, str]:
    ip = request.client.host if request.client else ""
    ua = request.headers.get("user-agent", "")[:255]
    return ip, ua


REFRESH_COOKIE = "pesalens_refresh"


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    """Set the refresh token as a session-scoped httpOnly + SameSite=Strict cookie.

    JS can't read it (mitigates XSS exfil) and the browser only sends it
    on same-site requests (mitigates CSRF). The browser still attaches
    it to fetch() calls from our SPA so /auth/refresh can rotate.

    No `max_age` / `expires` — the cookie is a session cookie, dropped by
    the browser when the user closes the tab/window. This pairs with the
    `pagehide` beacon in src/data/authStore.js::subscribeUnload so closing
    the tab tears the session down even if the beacon is dropped by the OS.
    The JWT itself still carries `jwt_refresh_ttl_days` as a hard ceiling
    so a stolen cookie can't be replayed past its embedded `exp`.
    """
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=refresh_token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/api/auth",
        domain=settings.cookie_domain or None,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=REFRESH_COOKIE,
        path="/api/auth",
        domain=settings.cookie_domain or None,
    )


def _issue_tokens(user: User, response: Optional[Response] = None) -> dict:
    access, _, _ = create_access_token(user.id, user.email)
    refresh, _, _ = create_refresh_token(user.id)
    if response is not None:
        _set_refresh_cookie(response, refresh)
    return {
        "access_token": access,
        # Mobile clients (Capacitor) cannot rely on cookies — they keep
        # using this body field. Web clients ignore it and rely on the
        # httpOnly cookie set above.
        "refresh_token": refresh,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "account_type": user.account_type,
            "email_verified": bool(user.email_verified_at),
            "subscription": summarize_subscription(user),
            # Mirrors /auth/me — lets the client know immediately at signin
            # whether the owner console applies, instead of waiting for the
            # first /me fetch to merge the flag in.
            "is_admin": bool(user.email and user.email.lower() in settings.admin_console_emails),
        },
    }


# ----------------------------- signup -----------------------------

@router.post("/signup", response_model=APIResponse)
@limiter.limit(settings.rate_limit_auth)
def signup(payload: SignUpRequest, request: Request, db: Session = Depends(get_db)):
    """Create the account and email a one-time temporary password.

    The user is NOT signed in by this endpoint. They must wait for the
    email, then call /auth/signin with that password. First successful
    sign-in marks the email as verified. They can rotate the password
    afterwards via /auth/change-password.
    """
    email_norm = payload.email.lower().strip()
    ip, ua = _client_meta(request)

    existing = db.query(User).filter(User.email == email_norm).first()
    if existing:
        # Generic message — never reveal account existence.
        return APIResponse(
            success=True,
            message=(
                "If this email is new, a temporary password has been sent. "
                "Check your inbox (and spam folder)."
            ),
        )

    initial_password = generate_initial_password()
    user = User(
        email=email_norm,
        password_hash=hash_password(initial_password),
        full_name=(payload.full_name or "").strip() or None,
        account_type=payload.account_type,
        plan="trial",
        trial_started_at=utcnow(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    delivered = send_email(
        user.email,
        "Welcome to PesaLens — your sign-in password",
        (
            f"Hi{(' ' + user.full_name) if user.full_name else ''},\n\n"
            "Your PesaLens account is ready. Use this temporary password "
            "to sign in for the first time:\n\n"
            f"    {initial_password}\n\n"
            "After signing in you can change it from Settings.\n\n"
            "If you didn't create this account, ignore this email and the "
            "account will sit unused — no further action needed.\n\n"
            "— PesaLens"
        ),
    )

    audit(db, "signup", user_id=user.id, ip=ip, user_agent=ua,
          details={"email_delivered": delivered})
    log.info("New signup id=%s ip=%s email_delivered=%s", user.id, ip or "-", delivered)

    return APIResponse(
        success=True,
        message=(
            "Account created. We've emailed a temporary password — sign in "
            "with it to verify your account."
        ),
    )


# ----------------------------- signin -----------------------------

@router.post("/signin", response_model=APIResponse)
@limiter.limit(settings.rate_limit_auth)
def signin(payload: SignInRequest, request: Request, response: Response,
           db: Session = Depends(get_db)):
    email_norm = payload.email.lower().strip()
    ip, ua = _client_meta(request)

    locked_until = is_locked(db, email_norm)
    if locked_until:
        # Same shape as a normal failed login — don't tell the attacker
        # which emails are locked vs unknown.
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user = db.query(User).filter(User.email == email_norm).first()
    # Always run verify_password to keep timing similar even when the
    # user does not exist.
    valid = bool(user) and verify_password(payload.password, user.password_hash)
    if not user or not valid:
        record_login_failure(db, email_norm)
        audit(db, "signin_failure", user_id=user.id if user else None, ip=ip, user_agent=ua)
        log.info("Failed signin attempt for %s", email_norm[:3] + "***")
        raise HTTPException(status_code=401, detail="Invalid email or password")

    record_login_success(db, email_norm)

    # First successful sign-in implicitly verifies the email: only the
    # owner of that inbox could have received the temp password.
    first_signin = not user.email_verified_at
    if first_signin:
        user.email_verified_at = utcnow()
        db.commit()
        audit(db, "email_verified_via_signin", user_id=user.id, ip=ip, user_agent=ua)

    audit(db, "signin_success", user_id=user.id, ip=ip, user_agent=ua)
    return APIResponse(success=True, message="Signed in",
                       data=_issue_tokens(user, response))


# ----------------------------- refresh -----------------------------

@router.post("/refresh", response_model=APIResponse)
@limiter.limit(settings.rate_limit_auth)
def refresh(request: Request, response: Response,
            payload: Optional[RefreshRequest] = Body(default=None),
            db: Session = Depends(get_db)):
    # Prefer body refresh_token (mobile flow); fall back to httpOnly cookie (web).
    token_str = (payload.refresh_token if payload else None) or request.cookies.get(REFRESH_COOKIE)
    if not token_str:
        raise HTTPException(status_code=401, detail="Missing refresh token")
    try:
        decoded = decode_token(token_str, expected_type="refresh")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh token expired")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    jti = decoded.get("jti", "")
    # Reuse detection: if this jti is already revoked, treat the whole
    # session as compromised and force re-login by invalidating every
    # outstanding token issued before now.
    if is_revoked(db, jti):
        try:
            user_id = int(decoded["sub"])
            user = db.query(User).filter(User.id == user_id).first()
            if user:
                user.sessions_invalid_before = utcnow()
                db.commit()
                audit(db, "refresh_reuse_detected", user_id=user.id,
                      ip=request.client.host if request.client else "")
        except Exception:
            db.rollback()
        raise HTTPException(status_code=401, detail="Refresh token reused")

    try:
        user_id = int(decoded["sub"])
    except (KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User no longer exists")

    # Rotate: revoke the presented refresh jti, issue a fresh pair.
    exp_dt = utcfromtimestamp(int(decoded["exp"]))
    revoke_jti(db, jti, user.id, exp_dt, token_type="refresh")
    return APIResponse(success=True, message="Token refreshed",
                       data=_issue_tokens(user, response))


# ----------------------------- me -----------------------------

@router.get("/me", response_model=APIResponse)
def me(user: User = Depends(get_current_user)):
    return APIResponse(
        success=True,
        message="ok",
        data={
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "account_type": user.account_type,
            "email_verified": bool(user.email_verified_at),
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "subscription": summarize_subscription(user),
            # Owner-console visibility. Lets the client show/hide the Admin nav
            # without probing an admin endpoint and treating any 404 (wrong API
            # base, proxy change) as "not an admin".
            "is_admin": bool(user.email and user.email.lower() in settings.admin_console_emails),
        },
    )


# ----------------------------- logout -----------------------------

@router.post("/logout", response_model=APIResponse)
def logout(
    response: Response,
    payload: Optional[RefreshRequest] = Body(default=None),
    request: Request = None,  # type: ignore
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Revoke the access token currently in use and (if supplied) the
    paired refresh token. Without a refresh token the session merely
    bleeds out at access-token expiry — pass it for a clean logout."""
    auth_header = request.headers.get("authorization", "") if request else ""
    if auth_header.lower().startswith("bearer "):
        try:
            token = auth_header.split(" ", 1)[1].strip()
            payload_access = decode_token(token, expected_type="access")
            revoke_jti(
                db,
                payload_access.get("jti", ""),
                user.id,
                utcfromtimestamp(int(payload_access.get("exp", 0))),
                token_type="access",
            )
        except Exception:
            pass

    # Refresh-token revocation: try body first (mobile), then cookie (web).
    refresh_str = (payload.refresh_token if payload else None) or (
        request.cookies.get(REFRESH_COOKIE) if request else None
    )
    if refresh_str:
        try:
            decoded = decode_token(refresh_str, expected_type="refresh")
            if int(decoded.get("sub", -1)) == user.id:
                revoke_jti(
                    db,
                    decoded.get("jti", ""),
                    user.id,
                    utcfromtimestamp(int(decoded.get("exp", 0))),
                    token_type="refresh",
                )
        except Exception:
            pass

    _clear_refresh_cookie(response)
    audit(db, "logout", user_id=user.id,
          ip=request.client.host if (request and request.client) else "")
    return APIResponse(success=True, message="Signed out")


# --------------------------- email verify ---------------------------

@router.post("/verify-email/send", response_model=APIResponse)
@limiter.limit("5/hour")
def verify_email_send(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.email_verified_at:
        return APIResponse(success=True, message="Already verified")
    code = issue_code(db, user.id, "verify_email", settings.email_verify_ttl_min)
    send_email(
        user.email,
        "Verify your PesaLens account",
        f"Your verification code is {code}. It expires in "
        f"{settings.email_verify_ttl_min} minutes.",
    )
    return APIResponse(success=True, message="Verification email sent")


@router.post("/verify-email/confirm", response_model=APIResponse)
@limiter.limit("10/hour")
def verify_email_confirm(
    payload: VerifyEmailRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.email_verified_at:
        return APIResponse(success=True, message="Already verified")
    if not consume_code(db, user.id, "verify_email", payload.code.strip()):
        raise HTTPException(status_code=400, detail="Invalid or expired code")
    user.email_verified_at = utcnow()
    db.commit()
    audit(db, "email_verified", user_id=user.id)
    return APIResponse(success=True, message="Email verified")


# --------------------------- password reset ---------------------------

@router.post("/forgot-password", response_model=APIResponse)
@limiter.limit("5/hour")
def forgot_password(payload: ForgotPasswordRequest, request: Request, db: Session = Depends(get_db)):
    """Always returns success — never reveal whether an email exists."""
    email_norm = payload.email.lower().strip()
    user = db.query(User).filter(User.email == email_norm).first()
    if user:
        code = issue_code(db, user.id, "password_reset", settings.password_reset_ttl_min)
        send_email(
            user.email,
            "Reset your PesaLens password",
            f"Your password reset code is {code}. It expires in "
            f"{settings.password_reset_ttl_min} minutes. If you did not "
            "request this, ignore this email.",
        )
        audit(db, "password_reset_requested", user_id=user.id,
              ip=request.client.host if request.client else "")
    return APIResponse(success=True, message="If the email exists, a reset code has been sent.")


@router.post("/reset-password", response_model=APIResponse)
@limiter.limit("10/hour")
def reset_password(payload: ResetPasswordRequest, request: Request, db: Session = Depends(get_db)):
    _validate_password(payload.new_password)
    email_norm = payload.email.lower().strip()
    user = db.query(User).filter(User.email == email_norm).first()
    if not user or not consume_code(db, user.id, "password_reset", payload.code.strip()):
        # Generic message — don't reveal whether the email exists.
        raise HTTPException(status_code=400, detail="Invalid or expired code")

    user.password_hash = hash_password(payload.new_password)
    user.sessions_invalid_before = utcnow()  # nuke all live sessions
    db.commit()
    audit(db, "password_reset", user_id=user.id,
          ip=request.client.host if request.client else "")
    return APIResponse(success=True, message="Password updated. Please sign in again.")


def _hash_revoke_token(raw: str) -> str:
    """sha-256 hex of the raw token. We never store the raw value so the
    DB can't issue revocations on its own — the user has to present the
    raw token from the email link."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _revoke_link(request: Request, raw_token: str) -> str:
    """Build the revoke link from the request that triggered the change.

    Whatever host the phone reached `/auth/change-password` on is the same
    host the user can reach from their phone — so the email link works
    on a LAN dev backend without needing a hard-coded PUBLIC_API_URL.
    Honours common reverse-proxy headers so the public hostname surfaces
    correctly when behind nginx / a load balancer in production.
    """
    fwd_proto = request.headers.get("x-forwarded-proto")
    fwd_host = request.headers.get("x-forwarded-host")
    scheme = (fwd_proto or request.url.scheme or "http").split(",")[0].strip()
    host = (fwd_host or request.headers.get("host") or request.url.netloc).split(",")[0].strip()
    base = f"{scheme}://{host}".rstrip("/")
    # `request.url.path` is /api/auth/change-password — strip the trailing
    # segment so we land on /api/auth and rebuild from there. This keeps
    # the API prefix correct whether main.py mounts at /api or "".
    path = request.url.path.rsplit("/", 1)[0]  # /api/auth
    return f"{base}{path}/revoke-password-change?token={quote(raw_token)}"


@router.post("/change-password", response_model=APIResponse)
@limiter.limit("10/hour")
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    _validate_password(payload.new_password)

    # Stash the previous hash so the user can revert via "It's not me".
    previous_hash = user.password_hash
    raw_token = secrets.token_urlsafe(32)
    revoke_until = utcnow() + timedelta(minutes=settings.password_change_revoke_ttl_min)

    user.password_hash = hash_password(payload.new_password)
    user.sessions_invalid_before = utcnow()
    user.pwd_change_prev_hash = previous_hash
    user.pwd_change_revoke_token = _hash_revoke_token(raw_token)
    user.pwd_change_revoke_until = revoke_until
    user.pwd_change_at = utcnow()
    db.commit()

    ip = request.client.host if request.client else ""
    ua = request.headers.get("user-agent", "")[:255]
    audit(db, "password_changed", user_id=user.id, ip=ip)

    # Email the user a one-shot revocation link. Stub provider in dev
    # logs the body — the link is still functional in both modes.
    link = _revoke_link(request, raw_token)
    hours = max(1, settings.password_change_revoke_ttl_min // 60)
    body = (
        f"Hi{(' ' + user.full_name) if user.full_name else ''},\n\n"
        f"Your PesaLens password was just changed.\n\n"
        f"Device IP: {ip or 'unknown'}\n"
        f"Browser:   {ua or 'unknown'}\n\n"
        f"If this was you, no action is needed.\n\n"
        f"If this was NOT you, tap the link below within {hours} hour(s) to revoke "
        f"the new password and restore your previous one. We will also nuke any "
        f"active sessions on the new password.\n\n"
        f"  {link}\n\n"
        f"After {hours} hour(s) this link expires for safety and the change becomes permanent.\n\n"
        f"— PesaLens Security"
    )
    send_email(user.email, "Your PesaLens password was changed", body)

    return APIResponse(success=True, message="Password changed. Please sign in again.")


@router.get("/revoke-password-change", response_class=HTMLResponse)
@limiter.limit("20/hour")
def revoke_password_change(token: str, request: Request, db: Session = Depends(get_db)):
    """Public endpoint hit from the change-confirmation email.

    Looks up the user by the hashed token, restores the previous password
    hash, kills active sessions, clears the revocation slot, and returns
    a small HTML page confirming the revert. We never reveal whether the
    token matched a real account — invalid/expired tokens get the same
    "this link is invalid or expired" page so attackers can't probe.
    """
    page_ok = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<title>Password change revoked</title>"
        "<style>body{background:#0c0d12;color:#eee;font-family:-apple-system,Inter,sans-serif;"
        "display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}"
        ".card{max-width:420px;padding:32px;border:1px solid #252636;border-radius:16px;"
        "background:#13161d}h1{margin:0 0 8px;font-size:20px}p{color:#9496a8;line-height:1.55;"
        "font-size:14px}.ok{color:#10b981}</style></head><body>"
        "<div class='card'><h1 class='ok'>It's reverted ✓</h1>"
        "<p>The password change has been revoked. Your previous password is active again "
        "and every session opened with the new one has been signed out.</p>"
        "<p style='margin-top:18px;font-size:12px;color:#5e6078'>You can close this window.</p>"
        "</div></body></html>"
    )
    page_bad = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<title>Link expired</title>"
        "<style>body{background:#0c0d12;color:#eee;font-family:-apple-system,Inter,sans-serif;"
        "display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}"
        ".card{max-width:420px;padding:32px;border:1px solid #252636;border-radius:16px;"
        "background:#13161d}h1{margin:0 0 8px;font-size:20px}p{color:#9496a8;line-height:1.55;"
        "font-size:14px}.warn{color:#f59e0b}</style></head><body>"
        "<div class='card'><h1 class='warn'>Link is invalid or expired</h1>"
        "<p>This revocation link can't be used. Either it's already been redeemed, the "
        "24-hour window has passed, or the token doesn't match an account.</p>"
        "<p>If you still suspect unauthorised access, request a password reset from the "
        "sign-in screen and contact support.</p></div></body></html>"
    )

    raw = (token or "").strip()
    if not raw:
        return HTMLResponse(page_bad, status_code=400)

    digest = _hash_revoke_token(raw)
    user = db.query(User).filter(User.pwd_change_revoke_token == digest).first()
    if not user or not user.pwd_change_revoke_until or not user.pwd_change_prev_hash:
        return HTMLResponse(page_bad, status_code=400)
    if user.pwd_change_revoke_until < utcnow():
        # Window passed — purge the slot so it can never be reused.
        user.pwd_change_prev_hash = None
        user.pwd_change_revoke_token = None
        user.pwd_change_revoke_until = None
        db.commit()
        return HTMLResponse(page_bad, status_code=400)

    # Restore the previous hash, nuke live sessions on the new password,
    # and clear the slot so the link can't be reused.
    user.password_hash = user.pwd_change_prev_hash
    user.sessions_invalid_before = utcnow()
    user.pwd_change_prev_hash = None
    user.pwd_change_revoke_token = None
    user.pwd_change_revoke_until = None
    db.commit()

    ip = request.client.host if request.client else ""
    audit(db, "password_change_revoked", user_id=user.id, ip=ip)
    send_email(
        user.email,
        "PesaLens password change reverted",
        "Heads up — the recent password change on your account was reverted via the "
        "'It's not me' link. Your previous password is now active. We recommend you "
        "sign in, change the password yourself to a new strong value, and review "
        "Settings → Profile for anything else suspicious.",
    )
    return HTMLResponse(page_ok)


# --------------------------- account export / delete ---------------------------

@router.get("/me/export", response_model=APIResponse)
def export_my_data(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """PDPA-style data portability: return everything we hold for this user."""
    audit(db, "data_export", user_id=user.id)
    return APIResponse(
        success=True,
        message="ok",
        data={
            "user": {
                "id": user.id,
                "email": user.email,
                "full_name": user.full_name,
                "account_type": user.account_type,
                "created_at": user.created_at.isoformat() if user.created_at else None,
                "email_verified_at": user.email_verified_at.isoformat() if user.email_verified_at else None,
                "plan": user.plan,
                "pro_until": user.pro_until.isoformat() if user.pro_until else None,
            },
            "uploads": [{
                "job_id": u.job_id, "filename": u.filename, "bank": u.bank,
                "total_transactions": u.total_transactions,
                "created_at": u.created_at.isoformat() if u.created_at else None,
            } for u in user.uploads],
            "personal_entries": [{
                "id": e.id, "date": e.entry_date, "vendor": e.vendor,
                "category": e.category, "description": e.description,
                "amount": e.amount, "direction": e.direction,
            } for e in user.entries],
            "business_entries": [{
                "id": e.id, "date": e.entry_date, "vendor": e.vendor,
                "category": e.category, "description": e.description,
                "amount": e.amount, "account_class": e.account_class,
            } for e in user.business_entries],
            "payments": [{
                "id": p.id, "provider": p.provider, "provider_ref": p.provider_ref,
                "amount": p.amount, "currency": p.currency, "plan": p.plan,
                "status": p.status,
                "period_start": p.period_start.isoformat() if p.period_start else None,
                "period_end": p.period_end.isoformat() if p.period_end else None,
            } for p in user.payments],
        },
    )


# Human-readable titles for the activity feed (product voice, not event codes).
_ACTIVITY_TITLES = {
    "signup": "Account created",
    "signin_success": "Signed in",
    "email_verified_via_signin": "Email verified",
    "email_verified": "Email verified",
    "logout": "Signed out",
    "password_changed": "Password changed",
    "password_change_revoked": "Password change reverted",
    "password_reset": "Password reset",
    "password_reset_requested": "Password reset requested",
    "data_export": "Data exported",
    "upload_succeeded": "Statement extracted",
    "upload_failed": "Statement extraction failed",
    "manual_payment_confirm_requested": "Payment confirmation requested",
    "manual_payment_confirmed": "Subscription activated",
    # Destructive acts. These are the ones a user most needs to be able to
    # look up later — "where did that receipt go" has an answer now, and it
    # carries the vendor and amount in `details` so the answer is specific.
    "receipt_deleted": "Receipt deleted",
    "personal_entry_deleted": "Spending entry deleted",
    "business_entry_deleted": "Ledger entry deleted",
    "statement_delete": "Statement deleted",
    "data_start_over": "All statement data cleared",
    "account_deleted": "Account deleted",
    # Things that went wrong. Shown to the user deliberately: a scan that
    # failed silently is the single most confusing thing this product does.
    "receipt_scanned": "Receipt scanned",
    "receipt_scan_failed": "Receipt scan failed",
    "client_error": "App reported a problem",
    "feedback_submitted": "Feedback sent",
}

# Events whose row should read as a FAILURE in the user's own feed, so the
# timeline distinguishes "this happened" from "this went wrong" without the
# client having to keep its own copy of the list.
_ACTIVITY_FAILURES = {
    "upload_failed", "receipt_scan_failed", "signin_failure",
    "client_error", "refresh_reuse_detected",
}

# User-facing titles for error codes. Deliberately plain: the operator's
# console gets the technical message (model ids, quota codes, exception
# types), the user gets what happened in their own terms. An unmapped code
# falls back to "Something went wrong" rather than leaking the raw code.
_ERROR_TITLES = {
    "server_error": "The app hit an unexpected error",
    "receipt_scan_failed": "A receipt could not be read",
    "receipt_delete_failed": "A receipt could not be fully deleted",
    "receipt_file_orphaned": "A deleted receipt left a file behind",
    "extraction_empty": "No transactions could be read from a statement",
    "pdf_unlock_failed": "A locked PDF could not be opened",
    "pdf_unlock_unsupported": "That PDF's protection is not supported",
    "client_error": "The app reported a problem",
}


@router.get("/me/activity", response_model=APIResponse)
def my_activity(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Per-user timeline — what this account did, AND what went wrong for it.

    One merged, newest-first list over two append-only tables: AuditLog (what
    the account did — sign-ins, uploads, deletions) and this user's own
    ErrorLog rows (what failed for them — a scan the vision models could not
    read, an extraction that died at 60%).

    Merging them is the point. Kept apart, a user sees "receipt scan" in their
    history with no hint that it failed, and the failure lives only in a
    console they cannot open. Together the timeline answers the question people
    actually ask support: *what happened to my thing, and when*. Every error
    row carries a `ref` the operator can search for in the owner console, so a
    user quoting it lands on the exact row.
    """
    audit_rows = (
        db.query(AuditLog)
        .filter(AuditLog.user_id == user.id)
        .order_by(AuditLog.created_at.desc())
        .limit(100)
        .all()
    )
    error_rows = (
        db.query(ErrorLog)
        .filter(ErrorLog.user_id == user.id)
        .order_by(ErrorLog.created_at.desc())
        .limit(50)
        .all()
    )

    items = []
    for r in audit_rows:
        details = None
        if r.details:
            try:
                import json as _json
                details = _json.loads(r.details)
            except Exception:  # noqa: BLE001
                details = None
        items.append({
            "id": f"a{r.id}",
            "kind": "activity",
            "event": r.event,
            "title": _ACTIVITY_TITLES.get(r.event, r.event.replace("_", " ").capitalize()),
            "failed": r.event in _ACTIVITY_FAILURES,
            "details": details,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    for e in error_rows:
        items.append({
            "id": f"e{e.id}",
            "kind": "issue",
            "event": e.error_code,
            "title": _ERROR_TITLES.get(e.error_code, "Something went wrong"),
            "failed": True,
            # The operator-facing message can name models, quotas and stack
            # types. Users get the stage they can act on plus a reference —
            # enough to be told the truth, not enough to leak our internals.
            "stage": e.stage,
            "progress": e.progress,
            "ref": f"ERR-{e.id}",
            "created_at": e.created_at.isoformat() if e.created_at else None,
        })
    # One ordering over both sources. Sorted on the ISO strings, which are
    # fixed-width UTC and therefore sort identically to the timestamps.
    items.sort(key=lambda i: i.get("created_at") or "", reverse=True)
    return APIResponse(success=True, message="ok", data={"activity": items[:120]})


@router.delete("/me", response_model=APIResponse)
def delete_my_account(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Right-to-erasure. Cascades remove uploads/entries/payments via
    SQLAlchemy `cascade='all, delete-orphan'`. Stored files on disk are
    removed best-effort."""
    from pathlib import Path
    import shutil

    user_id = user.id
    audit(db, "account_deleted", user_id=user_id,
          ip=request.client.host if request.client else "")

    # Best-effort scrub of on-disk artifacts.
    for root in (settings.uploads_path, settings.results_path,
                 settings.debug_path, settings.storage_path / "receipts"):
        try:
            target = Path(root) / str(user_id)
            if target.exists():
                shutil.rmtree(target, ignore_errors=True)
        except Exception:
            pass

    db.delete(user)
    db.commit()
    return APIResponse(success=True, message="Account deleted")
