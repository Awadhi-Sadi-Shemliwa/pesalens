"""Billing — trial state, upgrade checkout, payment confirmation.

Two providers are supported behind a single set of endpoints:

  • `manual`  — operator marks a payment paid via /billing/admin/grant
                (good for the M-Pesa / Tigo Pesa launch where
                reconciliation is human-in-the-loop).
  • `stripe`  — /billing/checkout returns a Stripe Checkout URL and
                /billing/webhook confirms the payment server-side.

The frontend never branches on the provider. It calls the same routes;
the response shape is identical.
"""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Literal, Optional

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import settings
from app.db import Payment, User, get_db
from app.deps import get_current_user, require_admin
from app.schemas.response import APIResponse
from app.services.subscription import reconcile, summarize as summarize_subscription
from app.utils.logger import get_logger
from app.utils.time import utcnow

log = get_logger(__name__)
router = APIRouter(tags=["billing"], prefix="/billing")


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
                    "success_url": f"{settings.public_app_url}/#/upgrade?status=success&session={{CHECKOUT_SESSION_ID}}",
                    "cancel_url": f"{settings.public_app_url}/#/upgrade?status=cancelled",
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
