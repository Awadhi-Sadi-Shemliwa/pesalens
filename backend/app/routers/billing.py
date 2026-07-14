"""Billing — trial state, upgrade checkout, payment confirmation.

Two providers are supported behind a single set of endpoints:

  • `manual`  — user clicks "I have paid" on /upgrade, backend emails
                the admin a one-click magic link plus the user a "we're
                waiting" notice. Admin's tap activates Pro and emails
                the user the upgrade confirmation. Also reachable via
                /billing/admin/grant for an authenticated admin flow.
  • `stripe`  — /billing/checkout returns a Stripe Checkout URL and
                /billing/webhook confirms the payment server-side.

The frontend never branches on the provider. It calls the same routes;
the response shape is identical.
"""

import hashlib
import json
import secrets
from datetime import timedelta
from typing import Literal, Optional
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import settings
from app.db import Payment, User, get_db
from app.deps import get_current_user, require_admin
from app.rate_limit import limiter
from app.schemas.response import APIResponse
from app.services.auth_security import audit, send_email
from app.services.subscription import reconcile, summarize as summarize_subscription
from app.utils.logger import get_logger
from app.utils.time import utcnow

log = get_logger(__name__)
router = APIRouter(tags=["billing"], prefix="/billing")


def _hash_confirm_token(raw: str) -> str:
    """SHA-256 hex of the raw magic-link token. Same pattern as the
    password-change revoke flow in routers/auth.py."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _confirm_link(request: Request, raw_token: str) -> str:
    """Build the admin's one-click confirmation URL from the inbound
    request, honouring reverse-proxy headers so the public hostname is
    used when behind nginx / Render's edge."""
    fwd_proto = request.headers.get("x-forwarded-proto")
    fwd_host = request.headers.get("x-forwarded-host")
    scheme = (fwd_proto or request.url.scheme or "http").split(",")[0].strip()
    host = (fwd_host or request.headers.get("host") or request.url.netloc).split(",")[0].strip()
    base = f"{scheme}://{host}".rstrip("/")
    # request.url.path is /api/billing/manual/request-confirmation;
    # rebuild against /api/billing so the click lands on /confirm.
    path = request.url.path.rsplit("/", 1)[0]  # /api/billing/manual
    return f"{base}{path}/confirm?token={quote(raw_token)}"


PLAN_PRICES = {
    "pro_monthly": ("monthly", 30),
    "pro_yearly":  ("yearly",  365),
}


def _price_for(plan: str) -> int:
    if plan == "pro_yearly":
        return settings.pro_yearly_price
    return settings.pro_monthly_price


def _stripe_price_id(plan: str) -> str:
    return settings.stripe_price_yearly if plan == "pro_yearly" else settings.stripe_price_monthly


def _activate_pro(user: User, db: Session, *, plan: str, days: int,
                  provider: str, provider_ref: Optional[str], amount: int) -> Payment:
    """Extend pro_until and write a Payment row. Idempotent on provider_ref."""
    if provider_ref:
        existing = (
            db.query(Payment)
            .filter(Payment.provider == provider, Payment.provider_ref == provider_ref)
            .first()
        )
        if existing:
            return existing

    now = utcnow()
    # If the user is still inside an active Pro period, stack the new
    # period on top of the current end-date. Otherwise start fresh.
    base = user.pro_until if (user.pro_until and user.pro_until > now) else now
    period_end = base + timedelta(days=days)

    payment = Payment(
        user_id=user.id,
        provider=provider,
        provider_ref=provider_ref,
        amount=float(amount),
        currency=settings.pro_currency,
        plan=plan,
        status="paid",
        period_start=now,
        period_end=period_end,
    )
    db.add(payment)

    user.pro_until = period_end
    user.last_payment_id = provider_ref
    user.last_payment_at = now
    reconcile(user)
    db.commit()
    db.refresh(user)
    return payment


# ---------------------------------------------------------------------------
# Read endpoints — anyone signed-in can hit these.
# ---------------------------------------------------------------------------


@router.get("/status", response_model=APIResponse)
def billing_status(user: User = Depends(get_current_user)):
    """Subscription state + the public price catalogue for the upgrade page."""
    return APIResponse(
        success=True, message="ok",
        data={
            "subscription": summarize_subscription(user),
            "plans": [
                {
                    "id": "pro_monthly",
                    "name": "Pro · monthly",
                    "price": settings.pro_monthly_price,
                    "currency": settings.pro_currency,
                    "interval": "month",
                    "days": 30,
                },
                {
                    "id": "pro_yearly",
                    "name": "Pro · yearly",
                    "price": settings.pro_yearly_price,
                    "currency": settings.pro_currency,
                    "interval": "year",
                    "days": 365,
                    "savings_pct": (
                        max(0, round(
                            (1 - settings.pro_yearly_price / max(1, settings.pro_monthly_price * 12)) * 100
                        ))
                    ),
                },
            ],
            "provider": settings.billing_provider,
        },
    )


# ---------------------------------------------------------------------------
# Checkout — start a payment.
# ---------------------------------------------------------------------------


class CheckoutRequest(BaseModel):
    plan: Literal["pro_monthly", "pro_yearly"] = "pro_monthly"


@router.post("/checkout", response_model=APIResponse)
def start_checkout(
    payload: CheckoutRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Begin an upgrade. Returns either a Stripe Checkout URL (Stripe
    mode) or a pending Payment record + manual-pay instructions
    (manual mode)."""
    plan = payload.plan
    amount = _price_for(plan)

    if settings.billing_provider == "stripe":
        if not settings.stripe_secret_key or not _stripe_price_id(plan):
            raise HTTPException(status_code=503, detail="Stripe is not configured")
        try:
            resp = httpx.post(
                "https://api.stripe.com/v1/checkout/sessions",
                auth=(settings.stripe_secret_key, ""),
                data={
                    "mode": "subscription",
                    "line_items[0][price]": _stripe_price_id(plan),
                    "line_items[0][quantity]": "1",
                    "client_reference_id": str(user.id),
                    "customer_email": user.email,
                    "success_url": f"{settings.public_app_url}/upgrade?status=success&session={{CHECKOUT_SESSION_ID}}",
                    "cancel_url": f"{settings.public_app_url}/upgrade?status=cancelled",
                    "metadata[user_id]": str(user.id),
                    "metadata[plan]": plan,
                },
                timeout=15.0,
            )
            resp.raise_for_status()
            session = resp.json()
        except Exception as exc:  # noqa: BLE001
            log.warning("Stripe checkout failed: %s", exc)
            raise HTTPException(status_code=502, detail="Could not reach the payment provider")

        return APIResponse(
            success=True, message="ok",
            data={
                "provider": "stripe",
                "checkout_url": session.get("url"),
                "session_id": session.get("id"),
                "amount": amount,
                "currency": settings.pro_currency,
                "plan": plan,
            },
        )

    # Manual mode — only proceed when real payout details are configured.
    # Otherwise we'd be telling users to wire money to placeholder accounts.
    if not _manual_payout_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "Online upgrades are not available yet — please contact "
                f"{settings.manual_support_contact or 'PesaLens support'} "
                "to arrange Pro access."
            ),
        )

    pending = Payment(
        user_id=user.id,
        provider="manual",
        provider_ref=None,
        amount=float(amount),
        currency=settings.pro_currency,
        plan=plan,
        status="pending",
    )
    db.add(pending)
    db.commit()
    db.refresh(pending)

    return APIResponse(
        success=True, message="ok",
        data={
            "provider": "manual",
            "payment_id": pending.id,
            "amount": amount,
            "currency": settings.pro_currency,
            "plan": plan,
            "instructions": _manual_instructions(user.email),
        },
    )


def _manual_payout_configured() -> bool:
    """True iff at least one real payout channel (M-Pesa or bank) is set."""
    return bool(settings.manual_lipa_namba or
                (settings.manual_bank_name and settings.manual_bank_account))


def _manual_instructions(user_email: str) -> str:
    """Build payout text from configured details — never invent account numbers."""
    lines: list[str] = []
    if settings.manual_lipa_namba:
        # The value already carries its own provider label
        # (e.g. "Selcom 5525105427604" or "M-Pesa Lipa Namba 12345-6").
        lines.append(f"Mobile money: {settings.manual_lipa_namba}")
    if settings.manual_bank_name and settings.manual_bank_account:
        holder = settings.manual_bank_holder or "PesaLens"
        lines.append(
            f"Bank transfer: {holder}, "
            f"{settings.manual_bank_name} {settings.manual_bank_account}"
        )
    body = " or ".join(lines) if lines else "Contact support for payment options."
    contact = (
        f" Confirmations: {settings.manual_support_contact}."
        if settings.manual_support_contact else ""
    )
    return (
        f"{body} Use your account email ({user_email}) as the reference. "
        f"Access unlocks once the payment is confirmed by our team — "
        f"usually within an hour during business hours.{contact}"
    )


# ---------------------------------------------------------------------------
# Confirmation — Stripe webhook OR admin grant.
# ---------------------------------------------------------------------------


@router.post("/webhook/stripe", response_model=APIResponse)
async def stripe_webhook(
    request: Request,
    stripe_signature: Optional[str] = Header(default=None, alias="Stripe-Signature"),
    db: Session = Depends(get_db),
):
    """Stripe Checkout success → activate Pro for the user.

    We avoid pulling in the Stripe SDK to keep deps minimal. If a webhook
    secret is configured we verify the HMAC ourselves.
    """
    if settings.billing_provider != "stripe":
        raise HTTPException(status_code=404, detail="Not found")

    raw = await request.body()
    if settings.stripe_webhook_secret:
        if not _verify_stripe_signature(raw, stripe_signature, settings.stripe_webhook_secret):
            raise HTTPException(status_code=400, detail="Invalid signature")

    try:
        event = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    if event.get("type") != "checkout.session.completed":
        return APIResponse(success=True, message="ignored")

    session = (event.get("data") or {}).get("object") or {}
    user_id = (session.get("metadata") or {}).get("user_id") or session.get("client_reference_id")
    plan = (session.get("metadata") or {}).get("plan") or "pro_monthly"
    if not user_id:
        return APIResponse(success=True, message="ignored")

    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user:
        return APIResponse(success=True, message="ignored")

    days = PLAN_PRICES.get(plan, ("monthly", 30))[1]
    _activate_pro(
        user, db,
        plan=plan, days=days,
        provider="stripe",
        provider_ref=session.get("id"),
        amount=int((session.get("amount_total") or _price_for(plan)) // 100)
        if session.get("currency", "").lower() in {"usd", "eur"}
        else _price_for(plan),
    )
    log.info("Pro activated for user %s via Stripe (%s)", user_id, plan)
    return APIResponse(success=True, message="ok")


def _verify_stripe_signature(payload: bytes, header: Optional[str], secret: str) -> bool:
    """Implements Stripe's t=...,v1=... signature scheme (no SDK)."""
    import hashlib
    import hmac
    if not header:
        return False
    parts = {kv.split("=", 1)[0]: kv.split("=", 1)[1] for kv in header.split(",") if "=" in kv}
    timestamp = parts.get("t")
    sig = parts.get("v1")
    if not timestamp or not sig:
        return False
    signed = f"{timestamp}.{payload.decode('utf-8', errors='replace')}".encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)


class GrantRequest(BaseModel):
    user_id: int
    plan: Literal["pro_monthly", "pro_yearly"] = "pro_monthly"
    provider_ref: Optional[str] = Field(default=None, max_length=120)
    amount: Optional[int] = None


@router.post("/admin/grant", response_model=APIResponse)
def admin_grant(
    payload: GrantRequest,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Manual upgrade after an off-platform payment (mobile money / bank).

    Restricted to addresses in BILLING_ADMINS. Idempotent on
    `provider_ref` so re-running a confirmation is safe.
    """
    target = db.query(User).filter(User.id == payload.user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    days = PLAN_PRICES.get(payload.plan, ("monthly", 30))[1]
    payment = _activate_pro(
        target, db,
        plan=payload.plan,
        days=days,
        provider="manual",
        provider_ref=payload.provider_ref,
        amount=int(payload.amount or _price_for(payload.plan)),
    )
    log.info("Pro granted to user %s by admin (%s, ref=%s)",
             target.id, payload.plan, payload.provider_ref or "—")
    return APIResponse(
        success=True, message="ok",
        data={
            "user_id": target.id,
            "subscription": summarize_subscription(target),
            "payment": {
                "id": payment.id,
                "plan": payment.plan,
                "period_end": payment.period_end.isoformat() + "Z" if payment.period_end else None,
            },
        },
    )


# ---------------------------------------------------------------------------
# Manual confirmation — user-triggered "I have paid" + admin magic link.
# ---------------------------------------------------------------------------


class RequestConfirmationBody(BaseModel):
    payment_id: int = Field(..., gt=0)


@router.post("/manual/request-confirmation", response_model=APIResponse)
@limiter.limit("10/hour")
def request_payment_confirmation(
    payload: RequestConfirmationBody,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """User clicks 'I have paid'. We email the admin a one-click magic
    link and email the user a 'waiting for confirmation' notice.

    Ownership-checked: a user can only request confirmation on their own
    Payment row. The token is single-use, hashed before storage, expires
    after 7 days. Re-requesting within 5 minutes is rate-limited at the
    record level (anti-spam on top of the slowapi limit)."""
    payment: Optional[Payment] = (
        db.query(Payment).filter(Payment.id == payload.payment_id).first()
    )
    if not payment or payment.user_id != user.id:
        raise HTTPException(status_code=404, detail="Payment not found")
    if payment.provider != "manual":
        raise HTTPException(status_code=400, detail="Not a manual payment")
    if payment.status != "pending":
        raise HTTPException(status_code=409, detail="Payment is no longer pending")

    now = utcnow()
    if payment.confirm_requested_at and (now - payment.confirm_requested_at) < timedelta(minutes=5):
        raise HTTPException(status_code=429, detail="Confirmation already requested — please wait a few minutes")

    raw_token = secrets.token_urlsafe(32)
    payment.confirm_token_hash = _hash_confirm_token(raw_token)
    payment.confirm_token_expires_at = now + timedelta(days=7)
    payment.confirm_requested_at = now
    db.commit()

    admins = settings.billing_admin_emails
    if not admins:
        log.warning("Manual payment %s requested but BILLING_ADMINS is empty", payment.id)
    link = _confirm_link(request, raw_token)
    amount_text = f"{settings.pro_currency} {int(payment.amount):,}"
    plan_text = "annual" if payment.plan == "pro_yearly" else "monthly"
    user_label = user.full_name or user.email

    admin_subject = f"PesaLens — confirm {plan_text} payment from {user_label}"
    admin_body = (
        f"{user_label} ({user.email}) reports paying {amount_text} for a PesaLens Pro "
        f"{plan_text} subscription.\n\n"
        f"Payment reference: #{payment.id}\n"
        f"Plan:              {payment.plan}\n"
        f"Amount:            {amount_text}\n"
        f"Channel:           {settings.manual_lipa_namba or 'Manual'}\n\n"
        f"Check your SelcomPesa inbox for the receipt, then tap the link below to "
        f"activate the subscription. The link works once and expires in 7 days.\n\n"
        f"  {link}\n\n"
        f"If you have questions for the user, reply directly to this email — the "
        f"Reply-To header is set to their address.\n\n"
        f"— PesaLens"
    )
    for admin_email in admins:
        # Reply-To = user.email so the admin can reply directly with questions
        # before tapping the magic link.
        send_email(admin_email, admin_subject, admin_body, reply_to=user.email)

    user_body = (
        f"Hi{(' ' + user.full_name) if user.full_name else ''},\n\n"
        f"Thanks for your payment of {amount_text} for PesaLens Pro ({plan_text}).\n\n"
        f"We're waiting for confirmation of received funds — usually within an hour "
        f"during business hours. You'll get a follow-up email the moment your Pro "
        f"access is unlocked, after which the upgrade page in the app will "
        f"automatically clear.\n\n"
        f"Payment reference: #{payment.id}\n\n"
        f"If you don't hear back within a few hours, reply to this email and we'll "
        f"investigate.\n\n"
        f"— PesaLens"
    )
    send_email(user.email, "PesaLens — waiting for confirmation of received funds", user_body)

    audit(db, "manual_payment_confirm_requested", user_id=user.id,
          ip=request.client.host if request.client else None,
          details={"payment_id": payment.id, "plan": payment.plan})

    return APIResponse(success=True, message="ok",
                       data={"payment_id": payment.id, "status": "awaiting_admin"})


_CONFIRM_OK_PAGE = (
    "<!doctype html><html><head><meta charset='utf-8'>"
    "<title>Payment confirmed</title>"
    "<style>body{{background:#0c0d12;color:#eee;font-family:-apple-system,Inter,sans-serif;"
    "display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}}"
    ".card{{max-width:440px;padding:32px;border:1px solid #252636;border-radius:16px;"
    "background:#13161d}}h1{{margin:0 0 8px;font-size:20px}}p{{color:#9496a8;line-height:1.55;"
    "font-size:14px}}.ok{{color:#10b981}}.muted{{margin-top:18px;font-size:12px;color:#5e6078}}"
    "</style></head><body>"
    "<div class='card'><h1 class='ok'>Confirmed ✓</h1>"
    "<p>{user_label} is on PesaLens Pro until <strong>{until}</strong>.</p>"
    "<p>An upgrade-confirmation email has just been sent to {user_email}.</p>"
    "<p class='muted'>You can close this window.</p></div></body></html>"
)

_CONFIRM_BAD_PAGE = (
    "<!doctype html><html><head><meta charset='utf-8'>"
    "<title>Link expired</title>"
    "<style>body{background:#0c0d12;color:#eee;font-family:-apple-system,Inter,sans-serif;"
    "display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}"
    ".card{max-width:420px;padding:32px;border:1px solid #252636;border-radius:16px;"
    "background:#13161d}h1{margin:0 0 8px;font-size:20px}p{color:#9496a8;line-height:1.55;"
    "font-size:14px}.warn{color:#f59e0b}</style></head><body>"
    "<div class='card'><h1 class='warn'>Link is invalid or expired</h1>"
    "<p>This confirmation link can't be used. Either it has already been redeemed, "
    "the 7-day window has passed, or the token doesn't match a pending payment.</p>"
    "<p>If the payment is genuine and still unprocessed, open the PesaLens app and "
    "tap <em>I have paid</em> again to get a fresh link.</p></div></body></html>"
)


@router.get("/manual/confirm", response_class=HTMLResponse)
@limiter.limit("60/hour")
def confirm_payment(token: str, request: Request, db: Session = Depends(get_db)):
    """Admin clicks the magic link from their inbox. Public — no auth.

    Same "never reveal token validity" stance as the password-revoke
    endpoint: invalid / expired / already-used tokens all return the
    same generic page."""
    raw = (token or "").strip()
    if not raw:
        return HTMLResponse(_CONFIRM_BAD_PAGE, status_code=400)

    digest = _hash_confirm_token(raw)
    payment: Optional[Payment] = (
        db.query(Payment).filter(Payment.confirm_token_hash == digest).first()
    )
    if not payment:
        return HTMLResponse(_CONFIRM_BAD_PAGE, status_code=400)

    if (not payment.confirm_token_expires_at) or payment.confirm_token_expires_at < utcnow():
        # Expired — clear the slot so the link can never be re-redeemed
        # even if the cert rotates and a collision becomes possible.
        payment.confirm_token_hash = None
        payment.confirm_token_expires_at = None
        db.commit()
        return HTMLResponse(_CONFIRM_BAD_PAGE, status_code=400)

    if payment.status != "pending":
        # Idempotent path — admin tapped twice. Return the success page
        # without re-activating (would extend pro_until again).
        payment.confirm_token_hash = None
        db.commit()
        user = db.query(User).filter(User.id == payment.user_id).first()
        return HTMLResponse(_CONFIRM_OK_PAGE.format(
            user_label=(user.full_name or user.email) if user else "the user",
            until=(payment.period_end or utcnow()).strftime("%d %b %Y"),
            user_email=user.email if user else "—",
        ))

    user = db.query(User).filter(User.id == payment.user_id).first()
    if not user:
        return HTMLResponse(_CONFIRM_BAD_PAGE, status_code=400)

    days = PLAN_PRICES.get(payment.plan, ("monthly", 30))[1]
    # _activate_pro is idempotent on provider_ref — use the Payment id
    # so re-confirmations are no-ops.
    activated = _activate_pro(
        user, db,
        plan=payment.plan, days=days,
        provider="manual",
        provider_ref=f"manual:{payment.id}",
        amount=int(payment.amount),
    )

    # Mark the original pending row as paid + drop the token slot.
    payment.status = "paid"
    payment.period_start = activated.period_start
    payment.period_end = activated.period_end
    payment.confirm_token_hash = None
    payment.confirm_token_expires_at = None
    db.commit()

    until_display = (activated.period_end or utcnow()).strftime("%d %b %Y")
    user_body = (
        f"Hi{(' ' + user.full_name) if user.full_name else ''},\n\n"
        f"Welcome to PesaLens Pro. Your payment has been confirmed and your account "
        f"is now Pro until {until_display}.\n\n"
        f"You can use every feature immediately:\n"
        f"  • Unlimited bank-statement uploads\n"
        f"  • Receipt + voice scanning\n"
        f"  • The AI financial advisor\n"
        f"  • Reconciliation and the business ledger\n"
        f"  • Live markets feed\n\n"
        f"Open the app and start using it — the upgrade page will clear on its own.\n\n"
        f"Thanks for backing PesaLens.\n\n"
        f"— PesaLens"
    )
    send_email(user.email, "Welcome to PesaLens Pro", user_body)

    audit(db, "manual_payment_confirmed", user_id=user.id,
          ip=request.client.host if request.client else None,
          details={"payment_id": payment.id, "until": until_display})
    log.info("Manual payment %s confirmed -> user %s Pro until %s",
             payment.id, user.id, until_display)

    return HTMLResponse(_CONFIRM_OK_PAGE.format(
        user_label=user.full_name or user.email,
        until=until_display,
        user_email=user.email,
    ))


# ---------------------------------------------------------------------------
# Cancel — sets pro_until to now so the user goes back to trial_expired
# ---------------------------------------------------------------------------


@router.post("/cancel", response_model=APIResponse)
def cancel_subscription(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user.pro_until = None
    reconcile(user)
    db.commit()
    db.refresh(user)
    return APIResponse(
        success=True, message="ok",
        data={"subscription": summarize_subscription(user)},
    )
