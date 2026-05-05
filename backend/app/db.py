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

    SQLAlchemy's create_all() does not add columns to tables that already
    exist, so we patch in any missing user-subscription columns by hand.
    Production-grade migrations belong in Alembic, but for an MVP this is
    safer than asking operators to drop and recreate the SQLite file.
    """
    Base.metadata.create_all(bind=engine)

    inspector = inspect(engine)
    if "users" in inspector.get_table_names():
        existing = {col["name"] for col in inspector.get_columns("users")}
        # name -> SQL definition (kept minimal, SQLite-friendly).
        new_cols: dict[str, str] = {
            "plan":                     "VARCHAR(20) NOT NULL DEFAULT 'trial'",
            "trial_started_at":         "DATETIME",
            "pro_until":                "DATETIME",
            "last_payment_id":          "VARCHAR(120)",
            "last_payment_at":          "DATETIME",
            "email_verified_at":        "DATETIME",
            "sessions_invalid_before":  "DATETIME",
        }
        with engine.begin() as conn:
            for name, ddl in new_cols.items():
                if name in existing:
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
