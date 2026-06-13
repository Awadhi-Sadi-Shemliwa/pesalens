# Backend container for PesaLens FastAPI app.
# Multi-stage so the runtime image stays small (no compilers, no pip cache).

# -------- builder --------
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Build deps for psycopg, pillow, opencv, onnxruntime.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY requirements.txt ./
RUN pip install --prefix=/install -r requirements.txt \
    && pip install --prefix=/install "gunicorn>=22.0"

# -------- runtime --------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PORT=8000

# Runtime deps:
#   libpq5            -> psycopg
#   libgl1, libglib2  -> opencv-python-headless
#   libgomp1          -> onnxruntime (rapidocr)
#   curl              -> HEALTHCHECK
#   tini              -> proper PID 1, forwards signals to gunicorn
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        curl \
        tini \
    && rm -rf /var/lib/apt/lists/*

# Non-root runtime user — uid 10001 stays out of host UID ranges so a
# bind-mounted storage dir can be chown'd predictably.
RUN groupadd --system --gid 10001 pesalens \
    && useradd  --system --uid 10001 --gid pesalens --home /app --shell /usr/sbin/nologin pesalens

WORKDIR /app

COPY --from=builder /install /usr/local
COPY app ./app

# Storage dir is mounted from the host in production. Pre-create it so
# the volume mount inherits the right ownership.
RUN mkdir -p /app/storage && chown -R pesalens:pesalens /app

USER pesalens

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:8000/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]

# Gunicorn with uvicorn workers. 2 workers keeps RAM low on a small VPS;
# bump WEB_CONCURRENCY env on the host to scale.
CMD ["sh", "-c", "gunicorn app.main:app \
        --workers ${WEB_CONCURRENCY:-2} \
        --worker-class uvicorn.workers.UvicornWorker \
        --bind 0.0.0.0:${PORT:-8000} \
        --access-logfile - \
        --error-logfile - \
        --timeout 120 \
        --graceful-timeout 30"]
