"""ASGI middleware: security headers, body-size cap, CSRF origin check.

Headers are conservative defaults that work for a JSON API + a separate
SPA. CSP intentionally allows inline styles for the React build but
forbids inline scripts; tighten further if you adopt a nonce strategy.
"""

from __future__ import annotations

from urllib.parse import urlparse

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp

from app.config import settings


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach security-relevant response headers on every request."""

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        h = response.headers
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        h.setdefault(
            "Permissions-Policy",
            "geolocation=(), microphone=(), camera=(self), payment=(self)",
        )
        h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        h.setdefault("Cross-Origin-Resource-Policy", "same-site")
        # CSP only on HTML — JSON responses don't render, but harmless to set.
        h.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data: blob:; "
            "style-src 'self' 'unsafe-inline'; script-src 'self'; "
            "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
        )
        if settings.is_production:
            h.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains; preload",
            )
        return response


class CSRFOriginMiddleware(BaseHTTPMiddleware):
    """Origin / Referer check for unsafe HTTP methods.

    CORS+credentials lets a malicious page issue cookie-bearing requests
    to our API; the browser still sends Origin / Referer, so we reject
    state-changing methods whose origin is not in `allowed_origins`.

    Skipped when the request is authenticated via a Bearer token —
    those calls are not driven by ambient cookies and so cannot be CSRFed.
    Webhook endpoints are also skipped (they're called by upstream
    providers and are signature-verified at the route layer).
    """

    SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
    EXEMPT_PATHS = (
        "/api/billing/webhook/",  # signed by provider (e.g. Stripe)
        "/health",
    )

    async def dispatch(self, request: Request, call_next):
        if request.method in self.SAFE_METHODS:
            return await call_next(request)

        path = request.url.path or ""
        if any(path.startswith(p) for p in self.EXEMPT_PATHS):
            return await call_next(request)

        # Token-authenticated calls cannot ride on ambient cookies — skip.
        auth_hdr = request.headers.get("authorization", "")
        if auth_hdr.lower().startswith("bearer "):
            return await call_next(request)

        origin = request.headers.get("origin") or ""
        referer = request.headers.get("referer") or ""
        source = origin or referer
        allowed = {o.rstrip("/") for o in settings.cors_origins}
        if not allowed:
            return await call_next(request)  # nothing to compare against

        try:
            parsed = urlparse(source)
            source_origin = f"{parsed.scheme}://{parsed.netloc}".rstrip("/") if parsed.netloc else ""
        except Exception:
            source_origin = ""

        if source_origin and source_origin in allowed:
            return await call_next(request)

        return JSONResponse(
            status_code=403,
            content={
                "success": False,
                "message": "Cross-site request blocked",
                "errors": ["csrf_origin"],
            },
        )


class BodySizeLimitMiddleware:
    """Reject requests whose Content-Length exceeds the configured cap.

    Belt-and-braces alongside per-route file checks: blocks a 4 GB POST
    before FastAPI buffers it. Stream-encoded bodies (no Content-Length)
    fall through and are caught by the route-level size check.
    """

    def __init__(self, app: ASGIApp, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    size = int(value)
                except ValueError:
                    size = 0
                if size > self.max_bytes:
                    response = JSONResponse(
                        status_code=413,
                        content={
                            "success": False,
                            "message": "Request entity too large",
                            "errors": ["payload_too_large"],
                        },
                    )
                    await response(scope, receive, send)
                    return
                break
        await self.app(scope, receive, send)
