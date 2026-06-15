# Contabo deployment — PesaLens

This folder + `docker-compose.yml` at the repo root deploys PesaLens on
a fresh Contabo VPS (or any Debian/Ubuntu host). A single domain serves
**both** halves of the app:

- the built Vite SPA (`dist/`) as static files, and
- the FastAPI backend, reverse-proxied under `/api` and `/health`.

NGINX runs on the **host** (not in a container) as the reverse proxy +
TLS terminator. Postgres and the backend run in Docker; the backend is
published only on the host loopback (`127.0.0.1:8000`) so NGINX can
reach it while it stays unreachable from the public internet.

The mobile APK is built by CI and distributed through Play Store /
direct download.

## Stack

```
┌──────────────────────────────────────────────────────────┐
│  Contabo VPS                                              │
│                                                          │
│   ┌─────────────────┐                                    │
│   │  nginx (host)   │  :80/:443  Let's Encrypt TLS       │
│   │                 │                                    │
│   │  / ────────────►│  /var/www/pesalens  (built SPA)    │
│   │  /api ─┐        │                                    │
│   │  /health┐       │                                    │
│   └─────────┼───────┘                                    │
│             │ 127.0.0.1:8000                             │
│             ▼                                            │
│      ┌─────────────┐        ┌──────┐                     │
│      │   backend   │  ────► │  pg  │                     │
│      │  gunicorn   │        │ :5432│                     │
│      │   :8000     │        └──────┘                     │
│      └─────────────┘     pgdata vol                      │
│             │                                            │
│      /opt/pesalens/storage (bind)                        │
└──────────────┼───────────────────────────────────────────┘
               │
   pesalens.com / www.pesalens.com (DNS A → VPS IP)
```

> **TLS note:** unlike the old Caddy setup, NGINX does not fetch
> certificates automatically. `certbot --nginx` provisions a free
> Let's Encrypt cert and edits the server block in place to add the
> `:443` listener + an HTTP→HTTPS redirect. Renewal is automatic via
> the `certbot.timer` systemd unit (certs last 90 days).

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
git clone https://github.com/Awadhi-Sadi-Shemliwa/pesalens.git .
# Backend container runs as uid:gid 10001 — match it on the host bind.
mkdir -p /opt/pesalens/storage
sudo chown -R 10001:10001 /opt/pesalens/storage

# 5. Web root for the built SPA (owned by your user so deploys can
#    rsync/scp into it without sudo).
sudo mkdir -p /var/www/pesalens
sudo chown -R $USER:$USER /var/www/pesalens
```

## DNS

On your registrar (e.g. Namecheap → Advanced DNS), point the domain at
the VPS:

| Type  | Host  | Value                |
| ----- | ----- | -------------------- |
| A     | `@`   | `<VPS IPv4>`         |
| CNAME | `www` | `pesalens.com`       |

- Use a plain **A Record** (not "A + Dynamic DNS" — the VPS IP is static).
- A records hold **IPv4** only; the apex `@` resolves `pesalens.com`.
- Delete any default parking A records / URL-redirect entries first.

Verify before requesting a cert:

```bash
dig +short pesalens.com        # → VPS IPv4
dig +short www.pesalens.com    # → resolves to the same IP
```

(On Windows, use `nslookup pesalens.com` instead of `dig`.)

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
- `PUBLIC_APP_URL` — the public site URL, e.g. `https://pesalens.com`.
- `ALLOWED_ORIGINS` — exact production frontend origins, comma-separated
  (e.g. `https://pesalens.com,https://www.pesalens.com`). Because the
  SPA is served same-origin, CORS isn't strictly exercised, but the
  boot-time config check still requires this to be set.
- `EMAIL_REPLY_TO` — a real support address, NOT a personal Gmail.
- `BILLING_ADMINS` — comma-separated emails of admins who can confirm
  manual payments.

The backend's `_verify_production_config()` (in `app/main.py`) refuses
to boot if `ENVIRONMENT=production` and any of `JWT_SECRET`,
`COOKIE_SECURE`, `ALLOWED_ORIGINS`, or `DATABASE_URL` are at dev
defaults — so a misconfigured `.env` fails loud at startup, not silent
in production.

## Build + upload the frontend

The SPA is built on your workstation (single-origin, so leave
`VITE_API_URL` unset — it defaults to same-origin `/api`):

```bash
npm run build                  # produces dist/
# Upload the build contents into the web root on the VPS:
scp -r dist/* <user>@<VPS-IP>:/var/www/pesalens/
```

NGINX serves static files directly — no reload is needed after a
frontend-only re-upload.

## First deploy

```bash
cd /opt/pesalens
docker compose --env-file .env up -d --build
docker compose logs -f backend
# Expected: "PesaLens backend started (env=production ...)" and the
# backend reports (healthy) in `docker ps`.
curl -fsS http://127.0.0.1:8000/health    # {"status":"ok",...}
```

## NGINX + TLS

```bash
# 1. Install NGINX.
sudo apt update && sudo apt install -y nginx

# 2. Install + enable the PesaLens server block.
sudo cp /opt/pesalens/deploy/nginx/pesalens.conf /etc/nginx/sites-available/pesalens.conf
sudo ln -s /etc/nginx/sites-available/pesalens.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default      # drop the welcome page
sudo nginx -t && sudo systemctl reload nginx

# 3. (Test over HTTP first.)
curl -I http://pesalens.com                       # 200, serves index.html
curl -fsS http://pesalens.com/health              # backend JSON

# 4. Provision TLS (rewrites the server block to add :443 + redirect).
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d pesalens.com -d www.pesalens.com
sudo systemctl reload nginx
```

> If you serve from a different domain, change `server_name` in
> `deploy/nginx/pesalens.conf` and the `-d` flags above to match.

## Verifying the deploy

```bash
# From your laptop, NOT the VPS:
curl -I  http://pesalens.com           # 301 → https (certbot redirect)
curl -fsS https://pesalens.com/health        # {"status":"ok",...}
curl -fsS https://pesalens.com/health/ready  # {"status":"ready"}
curl -fsS https://pesalens.com/api/markets/ticker   # live backend JSON

# Renewal is automatic; confirm the timer + dry-run a renewal:
sudo systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

Then open https://pesalens.com in a browser and confirm the SPA loads
with a valid padlock and its `/api/...` calls return 200.

## Updating

The GitHub Actions `deploy` workflow handles backend updates on tag
pushes — see `.github/workflows/deploy.yml`. Manual updates:

```bash
# Backend (and any compose/nginx config that came via git):
cd /opt/pesalens
git pull
docker compose --env-file .env up -d --build
docker image prune -f
# If deploy/nginx/pesalens.conf changed, re-copy + reload:
#   sudo cp deploy/nginx/pesalens.conf /etc/nginx/sites-available/pesalens.conf
#   sudo nginx -t && sudo systemctl reload nginx

# Frontend only:
npm run build                                  # on your workstation
scp -r dist/* <user>@<VPS-IP>:/var/www/pesalens/
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
| Test NGINX config             | `sudo nginx -t`                                          |
| Reload NGINX                  | `sudo systemctl reload nginx`                            |
| Tail NGINX access/error logs  | `sudo tail -f /var/log/nginx/{access,error}.log`         |
| Renew TLS now (dry-run)       | `sudo certbot renew --dry-run`                           |
| Stop everything (containers)  | `docker compose down`                                    |
| Stop + WIPE DB                | `docker compose down -v` (irreversible!)                 |

## Things to wire up after first deploy

- Uptime monitoring on `/health/ready` (UptimeRobot, BetterStack, or
  Cloudflare Health Checks — free tiers fine for MVP).
- Log shipping (Loki + Grafana, or just `docker compose logs` cron
  to S3 if you don't need realtime).
- Cloudflare in front of `pesalens.com` for DDoS protection +
  per-IP rate-limit at the edge.
