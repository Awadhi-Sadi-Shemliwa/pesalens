# Contabo deployment — PesaLens backend

This folder + `docker-compose.yml` at the repo root deploys the backend
on a fresh Contabo VPS (or any Debian/Ubuntu host). The frontend (web
+ mobile) ships separately — the SPA is built by CI and uploaded to
Cloudflare Pages / S3 / wherever, the mobile APK is built by CI and
distributed through Play Store / direct download.

## Stack

```
┌─────────────────────────────────────────────────┐
│  Contabo VPS                                    │
│                                                 │
│   ┌──────────┐    ┌─────────────┐    ┌──────┐  │
│   │  caddy   │ →  │   backend   │ →  │  pg  │  │
│   │  :80/443 │    │  gunicorn   │    │ :5432│  │
│   └──────────┘    │   :8000     │    └──────┘  │
│        ↑          └─────────────┘       ↑      │
│        │                                │      │
│        │ /opt/pesalens/storage (bind)   │      │
│        │                          pgdata vol   │
└────────┼────────────────────────────────────────┘
         │
   api.pesalens.com (DNS A record → VPS IP)
```

## One-time VPS bootstrap

Assumes Ubuntu 22.04 / 24.04 on the Contabo box. Run as a sudo user
(NOT root).

```bash
# 1. System packages + Docker (official convenience installer).
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl ufw fail2ban git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # log out + back in after this
sudo systemctl enable --now docker

# 2. Firewall — only SSH + HTTP/S exposed publicly.
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# 3. fail2ban for SSH brute-force (default jail is enough).
sudo systemctl enable --now fail2ban

# 4. App directory + storage volume.
sudo mkdir -p /opt/pesalens
sudo chown -R $USER:$USER /opt/pesalens
cd /opt/pesalens
git clone https://github.com/Awadhi-Sadi-Shemliwa/DATASCIENCE.git .
# Backend container runs as uid:gid 10001 — match it on the host bind.
mkdir -p /opt/pesalens/storage
sudo chown -R 10001:10001 /opt/pesalens/storage
```

## DNS

Point an `A` record for `api.pesalens.com` (or whatever you set as
`API_DOMAIN`) at the VPS public IP. Caddy will fetch a Let's Encrypt
certificate on first start — give DNS 5 minutes to propagate before
running `docker compose up`.

## Configure secrets

```bash
cd /opt/pesalens
cp .env.production.example .env
nano .env   # fill EVERY required value
```

Required at minimum:

- `POSTGRES_PASSWORD` — long random string.
- `JWT_SECRET` — `python -c "import secrets;print(secrets.token_urlsafe(64))"`.
- `RESEND_API_KEY` — from https://resend.com/api-keys (after verifying
  the `contact.pesalens.com` sending domain).
- `OPENROUTER_API_KEY` and/or `GEMINI_API_KEY` — at least one.
- `ALLOWED_ORIGINS` — exact production frontend URLs, comma-separated.
- `EMAIL_REPLY_TO` — a real support address, NOT a personal Gmail.
- `BILLING_ADMINS` — comma-separated emails of admins who can confirm
  manual payments.

The backend's `_verify_production_config()` (in `app/main.py`) refuses
to boot if `ENVIRONMENT=production` and any of `JWT_SECRET`,
`COOKIE_SECURE`, `ALLOWED_ORIGINS`, or `DATABASE_URL` are at dev
defaults — so a misconfigured `.env` fails loud at startup, not silent
in production.

## First deploy

```bash
cd /opt/pesalens
docker compose --env-file .env up -d --build
docker compose logs -f backend
```

Expected: backend logs `PesaLens backend started (env=production ...)`
and `/health/ready` returns `{"status":"ready"}` once Postgres is
reachable. Caddy logs show ACME certificate acquisition for the
configured `API_DOMAIN`.

## Verifying the deploy

```bash
# From your laptop, NOT the VPS:
curl -fsS https://api.pesalens.com/health
# {"status":"ok","service":"pesalens-backend"}

curl -fsS https://api.pesalens.com/health/ready
# {"status":"ready"}
```

## Updating

The GitHub Actions `deploy` workflow handles this on tag pushes — see
`.github/workflows/deploy.yml`. Manual update:

```bash
cd /opt/pesalens
git pull
docker compose --env-file .env up -d --build
docker image prune -f
```

## Backups

Postgres data lives in the `pgdata` named volume. Daily backup via
cron:

```bash
# /etc/cron.daily/pesalens-pgbackup (chmod +x)
#!/bin/sh
set -e
DEST=/var/backups/pesalens
mkdir -p "$DEST"
docker compose -f /opt/pesalens/docker-compose.yml exec -T postgres \
    pg_dump -U pesalens pesalens \
    | gzip > "$DEST/pg-$(date +%Y%m%d).sql.gz"
# Keep 14 days.
find "$DEST" -name 'pg-*.sql.gz' -mtime +14 -delete
```

The receipt-image storage volume (`/opt/pesalens/storage`) should also
be backed up — restic or rclone to B2 / S3 works well.

## Common operations

| Need to                       | Command                                                  |
| ----------------------------- | -------------------------------------------------------- |
| Tail backend logs             | `docker compose logs -f backend`                         |
| Restart backend only          | `docker compose restart backend`                         |
| Shell into the backend        | `docker compose exec backend sh`                         |
| psql into Postgres            | `docker compose exec postgres psql -U pesalens pesalens` |
| Rotate `JWT_SECRET`           | edit `.env`, `docker compose up -d backend`              |
| Stop everything               | `docker compose down`                                    |
| Stop + WIPE DB                | `docker compose down -v` (irreversible!)                 |

## Things to wire up after first deploy

- Uptime monitoring on `/health/ready` (UptimeRobot, BetterStack, or
  Cloudflare Health Checks — free tiers fine for MVP).
- Log shipping (Loki + Grafana, or just `docker compose logs` cron
  to S3 if you don't need realtime).
- Cloudflare in front of `api.pesalens.com` for DDoS protection +
  per-IP rate-limit at the edge.
