"""Application settings loaded from .env file.

All sensitive or environment-specific values must come from environment
variables. Defaults are safe-but-restrictive: a fresh checkout boots in
local-dev mode without leaking anything if the .env file is missing.
"""

from __future__ import annotations

import secrets
from pathlib import Path

from pydantic_settings import BaseSettings


def _default_jwt_secret() -> str:
    """Generate a per-process JWT secret if none is configured.

    A fresh secret on every restart is intentional: it forces operators
    to set JWT_SECRET in production (otherwise tokens silently invalidate
    on each restart) without risking a hardcoded fallback in source.
    """
    return secrets.token_urlsafe(64)


class Settings(BaseSettings):
    # --- Auth / security ---
    jwt_secret: str = _default_jwt_secret()
    jwt_algorithm: str = "HS256"
    jwt_access_ttl_minutes: int = 15
    jwt_refresh_ttl_days: int = 7

    # Account lockout (brute-force defence layered on top of rate limits).
    lockout_max_fails: int = 10
    lockout_window_min: int = 15
    lockout_duration_min: int = 15

    # Cookie / environment.
    environment: str = "development"
    cookie_secure: bool = False
    cookie_domain: str = ""

    allowed_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "https://localhost:5173,https://127.0.0.1:5173"
    )

    # --- Database ---
    database_url: str = ""

    # --- Rate limits ---
    rate_limit_auth: str = "20/minute"
    rate_limit_upload: str = "10/hour"
    rate_limit_default: str = "120/minute"
    rate_limit_receipts: str = "30/hour"
    rate_limit_assistant: str = "60/hour"

    # --- LLM providers ---
    gemini_api_key: str = ""
    openrouter_api_key: str = ""
    openrouter_model: str = "minimax/minimax-m2.5:free"
    openrouter_vision_models: str = ""
    openrouter_text_model: str = ""

    # --- Storage / pipeline ---
    storage_dir: str = "storage"
    log_level: str = "INFO"
    max_file_size_mb: int = 50
    max_request_body_mb: int = 60
    enable_llm_repair: bool = False
    delete_pdf_after_extraction: bool = True

    # Maximum wall-clock seconds the PDF-unlock brute-forcer is allowed to
    # spin per request. The 6-digit numeric keyspace covers Tanzanian bank
    # statements at ~3 600 attempts/sec/core × 11 workers ≈ full sweep in
    # ~25s; 30s gives headroom without letting an attacker soak CPU.
    pdf_unlock_max_seconds: int = 30

    # Per-user receipt-image storage cap (MB) and image retention (days).
    # JSON metadata is kept indefinitely so analytics still works after
    # the original image is purged.
    receipt_quota_mb: int = 500
    receipt_image_retention_days: int = 90

    # --- Email (verification + password reset) ---
    resend_api_key: str = ""
    email_from: str = "PesaLens <noreply@contact.pesalens.com>"
    email_reply_to: str = ""
    email_verify_ttl_min: int = 15
    password_reset_ttl_min: int = 15
    # Window during which a "It's not me" link revokes a password change.
    # 24h gives the user a full day to spot the email and react before the
    # previous hash is purged.
    password_change_revoke_ttl_min: int = 24 * 60

    # --- Trial / billing ---
    trial_days: int = 14
    pro_monthly_price: int = 14900   # TZS — adjust per launch market
    pro_yearly_price: int = 149000   # TZS — ~17% discount vs monthly x 12
    pro_currency: str = "TZS"
    billing_provider: str = "manual"
    stripe_secret_key: str = ""
    stripe_price_monthly: str = ""
    stripe_price_yearly: str = ""
    stripe_webhook_secret: str = ""
    public_app_url: str = "http://localhost:5173"
    billing_admins: str = ""

    # Manual-payment payout details. Empty by default — checkout returns a
    # "contact us" message instead of fake account numbers when unset.
    manual_lipa_namba: str = ""
    manual_bank_name: str = ""          # e.g. "CRDB"
    manual_bank_account: str = ""       # e.g. "0150 1234 5678"
    manual_bank_holder: str = ""        # e.g. "PesaLens Tanzania Ltd"
    manual_support_contact: str = ""    # e.g. "support@pesalens.com / +255-..."

    @property
    def ai_available(self) -> bool:
        return bool(self.gemini_api_key or self.openrouter_api_key)

    @property
    def base_path(self) -> Path:
        return Path(__file__).resolve().parent.parent

    @property
    def storage_path(self) -> Path:
        return self.base_path / self.storage_dir

    @property
    def uploads_path(self) -> Path:
        return self.storage_path / "uploads"

    @property
    def results_path(self) -> Path:
        return self.storage_path / "results"

    @property
    def debug_path(self) -> Path:
        return self.storage_path / "debug"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def admin_emails(self) -> set[str]:
        return {e.strip().lower() for e in self.billing_admins.split(",") if e.strip()}

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @property
    def production_misconfig(self) -> list[str]:
        """List of production-required settings that are still at dev defaults.

        Used by the boot-time fail-fast in `app/main.py` so we never ship a
        prod deployment that silently falls back to the per-process JWT
        secret, the dev SQLite DB, or the localhost-only CORS allowlist.
        Returns an empty list when the environment is configured correctly.
        """
        import os
        problems: list[str] = []
        if not os.getenv("JWT_SECRET"):
            problems.append(
                "JWT_SECRET is not set (defaults to a per-process random — "
                "tokens invalidate on every restart)"
            )
        if not self.cookie_secure:
            problems.append(
                "COOKIE_SECURE is false (refresh cookie will travel over plaintext)"
            )
        if any(o.startswith(("http://localhost", "http://127.")) for o in self.cors_origins):
            problems.append(
                "ALLOWED_ORIGINS still contains localhost / 127.0.0.1 entries"
            )
        if not self.database_url:
            problems.append(
                "DATABASE_URL is empty (would fall back to local SQLite)"
            )
        return problems

    @property
    def database_dsn(self) -> str:
        if self.database_url:
            return self.database_url
        # Default to SQLite under the storage directory.
        self.storage_path.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{(self.storage_path / 'pesalens.db').as_posix()}"

    model_config = {
        "env_file": str(Path(__file__).resolve().parent.parent / ".env"),
        "extra": "ignore",
    }


settings = Settings()
