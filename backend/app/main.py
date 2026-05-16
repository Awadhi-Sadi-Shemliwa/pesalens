"""PesaLens Backend - Bank Statement OCR + LLM Engine."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db, init_db
from app.middleware import (
    BodySizeLimitMiddleware,
    CSRFOriginMiddleware,
    SecurityHeadersMiddleware,
)
from app.rate_limit import limiter
from app.routers import assistant, auth, billing, business, dashboard, markets, personal, receipts, reconcile, upload
from app.services.market_scheduler import shutdown_scheduler, start_scheduler
from app.utils.logger import get_logger
from app.utils.storage import ensure_dirs

log = get_logger(__name__)


def _verify_production_config() -> None:
    """Refuse to boot a misconfigured production deployment.

    `Settings.production_misconfig` returns the list of required envs that
    are still at dev defaults. In production we raise a `RuntimeError` with
    every problem listed, so the operator fixes them all in one pass rather
    than discovering them one at a time on hot deploys. In development the
    same problems are printed as warnings — local testing keeps working.
    """
    problems = settings.production_misconfig
    if not problems:
        return
    if settings.is_production:
        joined = "\n  - " + "\n  - ".join(problems)
        raise RuntimeError(
            "Refusing to boot — production config is incomplete:" + joined
        )
    for p in problems:
        log.warning("Dev-default in use (would block prod boot): %s", p)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _verify_production_config()
    ensure_dirs()
    init_db()
    try:
        start_scheduler()
    except Exception as exc:  # noqa: BLE001
        # Market scheduler is optional — backend still serves the rest of the API.
        log.warning("Market scheduler did not start: %s", exc)
    log.info(
        "PesaLens backend started (env=%s origins=%s)",
        settings.environment, settings.cors_origins,
    )
    try:
        yield
    finally:
        shutdown_scheduler()


app = FastAPI(
    title="PesaLens API",
    description="Financial intelligence engine for bank statement extraction",
    version="1.2.0",
    lifespan=lifespan,
    # Hide interactive docs in production — they don't add value once
    # you have a frontend, and they reduce the discoverable surface.
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

# Reject oversized bodies before any route runs.
app.add_middleware(
    BodySizeLimitMiddleware,
    max_bytes=settings.max_request_body_mb * 1024 * 1024,
)

# Rate limiting (per-user when authenticated, per-IP otherwise).
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(SecurityHeadersMiddleware)

# CSRF origin check — blocks cookie-driven cross-site state-changing
# requests. No-op for Bearer-token API consumers (mobile + current SPA).
app.add_middleware(CSRFOriginMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=600,
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Generic safety net: never leak stack traces to the client."""
    if isinstance(exc, HTTPException):
        # Let FastAPI handle its own HTTPExceptions normally.
        raise exc
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"success": False, "message": "Internal server error", "errors": ["server_error"]},
    )


app.include_router(auth.router, prefix="/api")
app.include_router(upload.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(assistant.router, prefix="/api")
app.include_router(receipts.router, prefix="/api")
app.include_router(personal.router, prefix="/api")
app.include_router(business.router, prefix="/api")
app.include_router(markets.router, prefix="/api")
app.include_router(billing.router, prefix="/api")
app.include_router(reconcile.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "pesalens-backend"}


@app.get("/health/ready")
def health_ready(db: Session = Depends(get_db)):
    """Readiness probe — confirms the DB is reachable.

    Used by Render's health check so a deploy doesn't get marked live
    until the Postgres connection actually works.
    """
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        log.exception("Readiness probe failed")
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "errors": ["db_unreachable"]},
        )
    return {"status": "ready"}
