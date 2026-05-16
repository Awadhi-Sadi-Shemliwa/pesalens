"""SQLite database (SQLAlchemy ORM) — users, uploads, personal entries.

Designed to fail-soft: if SQLAlchemy is unavailable the auth + persistence
layer cannot start, but the import itself does not crash the whole app.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    event,
    inspect,
    text,
)
from sqlalchemy.orm import Session, declarative_base, relationship, sessionmaker

from app.config import settings
from app.utils.time import utcnow

Base = declarative_base()


# SQLite needs check_same_thread=False to allow the FastAPI threadpool
# to share connections; future_=True selects the 2.x engine semantics.
_engine_kwargs: dict = {"future": True}
if settings.database_dsn.startswith("sqlite"):
    # `timeout=30` lets the second writer wait up to 30s for the lock
    # instead of failing immediately when two requests touch the DB.
    _engine_kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}

engine = create_engine(settings.database_dsn, **_engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


@event.listens_for(engine, "connect")
def _enable_sqlite_pragmas(dbapi_connection, _connection_record):
    """Foreign keys are off by default in SQLite — turn them on."""
    if not settings.database_dsn.startswith("sqlite"):
        return
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()


# ----------------------------- models -----------------------------

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(254), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(120), nullable=True)
    account_type = Column(String(20), nullable=False, default="individual")
    created_at = Column(DateTime, default=utcnow, nullable=False)

    # Email verification (financial app — required by PDPA + payment partners).
    email_verified_at = Column(DateTime, nullable=True)

    # Subscription / trial. plan ∈ {trial, pro, expired}.
    # `trial_started_at` is set on signup; trial lasts settings.trial_days.
    # `pro_until` is set on successful upgrade and refreshed on renewal.
    plan = Column(String(20), nullable=False, default="trial")
    trial_started_at = Column(DateTime, default=utcnow, nullable=False)
    pro_until = Column(DateTime, nullable=True)
    last_payment_id = Column(String(120), nullable=True)
    last_payment_at = Column(DateTime, nullable=True)

    # Sessions invalidated before this timestamp (set on password change /
    # full-logout). Cheap global revocation without scanning every jti.
    sessions_invalid_before = Column(DateTime, nullable=True)

    # Password-change "It's not me" revocation slot. Populated by
    # /auth/change-password and consumed by /auth/revoke-password-change.
    # Storing the SHA-256 of the raw token (never the token itself) so a
    # leaked DB dump can't be used to revoke real changes. The previous
    # password hash is stashed for the duration of the revocation window
    # (default 24h, see settings.password_change_revoke_ttl_min) and
    # purged when the window expires or the link is consumed.
    pwd_change_prev_hash = Column(String(255), nullable=True)
    pwd_change_revoke_token = Column(String(64), nullable=True, index=True)
    pwd_change_revoke_until = Column(DateTime, nullable=True)
    pwd_change_at = Column(DateTime, nullable=True)

    uploads = relationship("Upload", back_populates="user", cascade="all, delete-orphan")
    entries = relationship("PersonalEntry", back_populates="user", cascade="all, delete-orphan")
    business_entries = relationship("BusinessEntry", back_populates="user", cascade="all, delete-orphan")
    payments = relationship("Payment", back_populates="user", cascade="all, delete-orphan")


class Payment(Base):
    """A successful (or pending) upgrade/renewal payment record.

    Kept lean on purpose — we store the provider, the provider's reference
    id, the amount + currency, and the period the payment unlocked.
    Anything richer (invoice PDFs, refunds) belongs in the provider
    dashboard, not in our app DB.
    """
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(String(40), nullable=False, default="manual")  # stripe|mpesa|manual
    provider_ref = Column(String(120), nullable=True, index=True)
    amount = Column(Float, nullable=False, default=0.0)
    currency = Column(String(8), nullable=False, default="TZS")
    plan = Column(String(40), nullable=False, default="pro_monthly")  # pro_monthly|pro_yearly
    status = Column(String(20), nullable=False, default="paid")        # pending|paid|failed
    period_start = Column(DateTime, nullable=True)
    period_end = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    # Manual-confirmation magic-link slot. Populated when the user clicks
    # "I have paid" on /upgrade — the SHA-256 of the token is sent to the
    # admin's inbox, and the admin's tap on that link activates Pro.
    # Cleared (set back to NULL) the moment the link is consumed so it
    # can't be reused. Unused for stripe/IAP payments.
    confirm_token_hash = Column(String(64), nullable=True, index=True)
    confirm_token_expires_at = Column(DateTime, nullable=True)
    confirm_requested_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="payments")


class Upload(Base):
    __tablename__ = "uploads"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    job_id = Column(String(40), unique=True, nullable=False, index=True)
    filename = Column(String(255), nullable=False)
    bank = Column(String(80), nullable=True)
    total_transactions = Column(Integer, default=0)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    user = relationship("User", back_populates="uploads")


class PersonalEntry(Base):
    __tablename__ = "personal_entries"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    entry_date = Column(String(10), nullable=False)  # YYYY-MM-DD
    vendor = Column(String(120), nullable=True)
    category = Column(String(80), nullable=False)
    description = Column(Text, nullable=True)
    amount = Column(Float, nullable=False)
    direction = Column(String(10), nullable=False, default="expense")  # income|expense
    created_at = Column(DateTime, default=utcnow, nullable=False)

    user = relationship("User", back_populates="entries")


class RevokedToken(Base):
    """Per-jti revocation list (logout, refresh-rotation, password-change).

    Rows expire naturally — we filter on `expires_at > now`, and a tiny
    cleanup pass on startup drops anything past expiry. Avoids needing
    Redis for the MVP while still giving real revocation.
    """
    __tablename__ = "revoked_tokens"

    id = Column(Integer, primary_key=True)
    jti = Column(String(64), unique=True, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    token_type = Column(String(16), nullable=False, default="access")  # access|refresh
    expires_at = Column(DateTime, nullable=False, index=True)
    revoked_at = Column(DateTime, default=utcnow, nullable=False)


class FailedLogin(Base):
    """Per-email lockout counter. Email key (lowercased) lets us protect
    accounts even when the attacker rotates source IPs (slowapi catches
    per-IP, this catches per-account)."""
    __tablename__ = "failed_logins"

    id = Column(Integer, primary_key=True)
    email = Column(String(254), unique=True, nullable=False, index=True)
    fail_count = Column(Integer, nullable=False, default=0)
    last_fail_at = Column(DateTime, nullable=True)
    locked_until = Column(DateTime, nullable=True)


class EmailCode(Base):
    """Single table for email-verification + password-reset codes.

    Codes are stored as bcrypt hashes (so a DB read doesn't grant code
    knowledge), single-use, and short-TTL. `purpose` distinguishes flows.
    """
    __tablename__ = "email_codes"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    purpose = Column(String(20), nullable=False)   # verify_email | password_reset
    code_hash = Column(String(255), nullable=False)
    attempts = Column(Integer, nullable=False, default=0)
    expires_at = Column(DateTime, nullable=False)
    consumed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)


class AuditLog(Base):
    """Append-only audit trail for security-sensitive actions.

    Records: signin failure spikes, password change, admin grants, data
    export / account deletion. Detect-only — never used for application
    logic, so it's safe to keep loose.
    """
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    event = Column(String(60), nullable=False, index=True)
    ip = Column(String(64), nullable=True)
    user_agent = Column(String(255), nullable=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)


class BusinessEntry(Base):
    """Manual ledger entry for business accounts.

    Designed to feed both the monthly Income Statement (P&L) and the
    Balance Sheet, so it carries an `account_class` ∈ {revenue, expense,
    asset, liability, equity}. Receipts captured via OCR are merged in
    as additional `expense` lines at report time.
    """
    __tablename__ = "business_entries"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    entry_date = Column(String(10), nullable=False)  # YYYY-MM-DD
    vendor = Column(String(120), nullable=True)
    category = Column(String(80), nullable=False)
    description = Column(Text, nullable=True)
    amount = Column(Float, nullable=False)
    account_class = Column(String(16), nullable=False, default="expense")
    created_at = Column(DateTime, default=utcnow, nullable=False)

    user = relationship("User", back_populates="business_entries")


# ----------------------------- helpers -----------------------------

def init_db() -> None:
    """Create tables and apply lightweight column migrations.

    On Postgres (production), `Base.metadata.create_all` is sufficient — a
    fresh deploy gets every column from the SQLAlchemy models, and schema
    changes after launch go through Alembic. The in-boot ALTER block below
    is SQLite-only because Postgres + multiple workers race on concurrent
    DDL, and a Render redeploy spins several workers simultaneously.
    """
    Base.metadata.create_all(bind=engine)

    if not engine.url.drivername.startswith("sqlite"):
        # Non-SQLite path: rely on create_all for the initial schema and
        # Alembic for any future column additions. Skip the legacy backfill.
        return

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        if "users" in tables:
            existing_users = {col["name"] for col in inspector.get_columns("users")}
            # name -> SQL definition (kept minimal, SQLite-friendly).
            user_cols: dict[str, str] = {
                "plan":                     "VARCHAR(20) NOT NULL DEFAULT 'trial'",
                "trial_started_at":         "DATETIME",
                "pro_until":                "DATETIME",
                "last_payment_id":          "VARCHAR(120)",
                "last_payment_at":          "DATETIME",
                "email_verified_at":        "DATETIME",
                "sessions_invalid_before":  "DATETIME",
                # Password-change revocation slot — populated when the user
                # changes their password, drained when the "It's not me"
                # link is hit OR when settings.password_change_revoke_ttl_min
                # expires.
                "pwd_change_prev_hash":     "VARCHAR(255)",
                "pwd_change_revoke_token":  "VARCHAR(64)",
                "pwd_change_revoke_until":  "DATETIME",
                "pwd_change_at":            "DATETIME",
            }
            for name, ddl in user_cols.items():
                if name in existing_users:
                    continue
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {name} {ddl}"))
            # Backfill trial_started_at for any pre-existing users so they
            # get a real 14-day grace period from "now" (not the epoch).
            conn.execute(text(
                "UPDATE users SET trial_started_at = COALESCE(trial_started_at, created_at, CURRENT_TIMESTAMP)"
            ))
            # Drop expired revocation rows so the table doesn't grow forever.
            conn.execute(text(
                "DELETE FROM revoked_tokens WHERE expires_at < CURRENT_TIMESTAMP"
            ))

        if "payments" in tables:
            existing_payments = {col["name"] for col in inspector.get_columns("payments")}
            payment_cols: dict[str, str] = {
                "confirm_token_hash":       "VARCHAR(64)",
                "confirm_token_expires_at": "DATETIME",
                "confirm_requested_at":     "DATETIME",
            }
            for name, ddl in payment_cols.items():
                if name in existing_payments:
                    continue
                conn.execute(text(f"ALTER TABLE payments ADD COLUMN {name} {ddl}"))


def get_db() -> Iterator[Session]:
    """FastAPI dependency that yields a request-scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    """Plain context manager for non-request code paths."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
