# PesaLens

Financial intelligence engine for Tanzanian bank statements. PesaLens ingests
PDF statements + receipts, extracts transactions via OCR + LLM repair, and
gives users a unified view of personal spending, business bookkeeping, and
market context — through a web app and a Capacitor-based Android app, backed
by a single FastAPI service.

```
backend/              FastAPI service (auth, OCR, AI, billing)
src/                  React + Vite web frontend
PesaLens-MobileAPP/   React + Vite + Capacitor Android app
scripts/              build helpers (APK staging, icon generation, dev tunnel)
```

## Quick start (local dev)

Prereqs: Python 3.12, Node 20, npm.

```bash
# 1. Backend
cd backend
python -m venv venv
. venv/Scripts/activate                  # or `source venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
cp .env.example .env                      # then fill in JWT_SECRET + provider keys
uvicorn app.main:app --reload --port 8000

# 2. Web frontend (new terminal at repo root)
npm install
npm run dev                               # https://localhost:5173

# 3. Mobile app (new terminal in PesaLens-MobileAPP)
cd PesaLens-MobileAPP
npm install
npm run dev                               # browser preview; use Capacitor for device
```

Default API base is `/api` (proxied to `http://localhost:8000` by Vite). Override
with `VITE_API_URL` if the backend lives elsewhere.

## Deploying to production

Read [`backend/SECURITY_CHECKLIST.md`](backend/SECURITY_CHECKLIST.md) before
shipping. The short version:

1. Rotate every secret in `backend/.env` — the file is gitignored but the
   keys are still real.
2. Provision Postgres + a Web Service on Render. Set every var listed in
   the security checklist's "Production env" section.
3. For Android release: set `PESALENS_BUILD=prod` and `VITE_API_URL`, run
   `npm run release` inside `PesaLens-MobileAPP` — the `release-guard` script
   will refuse to build if cert pins or env vars are still at dev defaults.
4. Replace the SHA-256 SPKI placeholders in
   `PesaLens-MobileAPP/android/app/src/main/res/xml/network_security_config.xml`
   with real pins for `api.pesalens.com` before assembling a signed APK.

## License

Private — all rights reserved.
