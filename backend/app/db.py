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

    # Statement period, persisted at extraction time (YYYY-MM-DD). Lets the
    # statement selector / null-association resolver run as one indexed DB query
    # instead of re-parsing every result JSON on the disk per request. Nullable:
    # legacy rows are lazily backfilled from their result JSON on first read.
    period_start = Column(String(10), nullable=True)
    period_end = Column(String(10), nullable=True, index=True)

    # --- Extraction job state (honest progress + failure transparency) ---
    # The row is now created the moment an upload is received (status=queued)
    # and updated as the background pipeline advances, so the client can poll
    # GET /upload/status/{job_id} for a REAL stage + percentage rather than a
    # blank spinner. On failure we keep the row (never delete) with the stage
    # and percentage where it stopped + a human reason + timestamp.
    status = Column(String(16), nullable=False, default="queued")  # queued|processing|done|failed
    stage = Column(String(40), nullable=True)          # human stage label, e.g. "Extracting text"
    progress = Column(Integer, nullable=False, default=0)  # 0..100, monotonic, real
    error_code = Column(String(40), nullable=True)     # classified: pdf_unlock_failed|extraction_empty|...
    error_message = Column(Text, nullable=True)        # human "what happened"
    failed_stage = Column(String(40), nullable=True)   # stage label at the moment of failure
    failed_progress = Column(Integer, nullable=True)   # percentage reached before failure
    started_at = Column(DateTime, nullable=True)       # pipeline start
    finished_at = Column(DateTime, nullable=True)      # success OR failure timestamp
    # Liveness beacon — the worker bumps this on every progress ping. Startup
    # orphan-recovery only fails rows whose heartbeat is STALE, so it can never
    # clobber a job still being processed by a sibling gunicorn worker.
    heartbeat_at = Column(DateTime, nullable=True)

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

    # Statement this entry belongs to (Epic-2 per-statement scoping). Nullable:
    # legacy rows + entries added outside a statement context resolve to the
    # user's newest statement at query time — no data migration required.
    statement_job_id = Column(String(40), nullable=True, index=True)

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


class ErrorLog(Base):
    """System-wide error ledger — the single source of truth for the owner
    dashboard's "what crashed, where, why, and when" view.

    Written from two places: the extraction pipeline's failure path (carries
    the stage + percentage where it died) and the global unhandled-exception
    handler in main.py (carries the request method + path). Every row is
    timestamped. This is deliberately append-only and never used for
    application logic, so it is safe to write from a best-effort try/except.
    """
    __tablename__ = "error_log"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    path = Column(String(255), nullable=True)          # request path or job context
    method = Column(String(10), nullable=True)         # HTTP method, when applicable
    error_code = Column(String(40), nullable=False, index=True)  # classified code
    message = Column(Text, nullable=True)              # human message
    stage = Column(String(40), nullable=True)          # pipeline stage, when applicable
    progress = Column(Integer, nullable=True)          # percentage reached, when applicable
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

def _add_missing_columns(conn, inspector, table: str, cols: dict[str, str], is_postgres: bool) -> None:
    """Idempotently `ALTER TABLE … ADD COLUMN` every column not yet present.

    Postgres: `ADD COLUMN IF NOT EXISTS` (race-proof even beyond the advisory
    lock in init_db) with `DATETIME` mapped to `TIMESTAMP` — Postgres has no
    DATETIME type. SQLite: plain `ADD COLUMN` guarded by the inspector check,
    since SQLite lacks IF NOT EXISTS on ADD COLUMN.
    """
    existing = {col["name"] for col in inspector.get_columns(table)}
    for name, ddl in cols.items():
        if name in existing:
            continue
        if is_postgres:
            pg_ddl = ddl.replace("DATETIME", "TIMESTAMP")
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {name} {pg_ddl}"))
        else:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


def init_db() -> None:
    """Create tables and apply lightweight column migrations.

    `Base.metadata.create_all` handles brand-new tables but never adds
    columns to tables that already exist — so every column added to a model
    after launch is ALSO listed in the ALTER dictionaries below and healed
    here at boot. There is no Alembic in this repo; this boot-time backfill
    IS the migration story, and it runs on both SQLite (dev) and Postgres
    (production). Multi-worker deploys can't race the DDL: on Postgres the
    whole block is serialized with a transaction-scoped advisory lock and
    each ADD COLUMN uses IF NOT EXISTS.
    """
    Base.metadata.create_all(bind=engine)

    is_postgres = engine.url.drivername.startswith("postgres")
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        if is_postgres:
            # Fixed arbitrary key (0x50534C31, "PSL1"). All workers contend
            # on it; the first runs the DDL, the rest find every column
            # already present. Auto-released at COMMIT/ROLLBACK.
            conn.execute(text("SELECT pg_advisory_xact_lock(1347571761)"))

        if "users" in tables:
            # name -> SQL definition (kept minimal, portable across
            # SQLite/Postgres — see _add_missing_columns for dialect quirks).
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
            _add_missing_columns(conn, inspector, "users", user_cols, is_postgres)
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
            payment_cols: dict[str, str] = {
                "confirm_token_hash":       "VARCHAR(64)",
                "confirm_token_expires_at": "DATETIME",
                "confirm_requested_at":     "DATETIME",
            }
            _add_missing_columns(conn, inspector, "payments", payment_cols, is_postgres)

        if "uploads" in tables:
            upload_cols: dict[str, str] = {
                # Extraction job state — see Upload model. Older rows get a
                # sensible default: they already succeeded, so status=done.
                "status":          "VARCHAR(16) NOT NULL DEFAULT 'done'",
                "stage":           "VARCHAR(40)",
                "progress":        "INTEGER NOT NULL DEFAULT 100",
                "error_code":      "VARCHAR(40)",
                "error_message":   "TEXT",
                "failed_stage":    "VARCHAR(40)",
                "failed_progress": "INTEGER",
                "started_at":      "DATETIME",
                "finished_at":     "DATETIME",
                "heartbeat_at":    "DATETIME",
                # Statement period — see Upload model. Legacy rows stay NULL and
                # are lazily backfilled from their result JSON on first read.
                "period_start":    "VARCHAR(10)",
                "period_end":      "VARCHAR(10)",
            }
            _add_missing_columns(conn, inspector, "uploads", upload_cols, is_postgres)

        if "personal_entries" in tables:
            entry_cols: dict[str, str] = {
                # Epic-2 per-statement scoping — see PersonalEntry model. Older
                # rows stay NULL and resolve to the newest statement at read time.
                "statement_job_id": "VARCHAR(40)",
            }
            _add_missing_columns(conn, inspector, "personal_entries", entry_cols, is_postgres)


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
