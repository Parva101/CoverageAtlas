# CoverageAtlas Free-Stack Deployment

This guide deploys CoverageAtlas using:

- Frontend: Vercel Hobby
- Backend API: Render Free Web Service
- PostgreSQL: Neon Free
- Redis: Upstash Free
- Vector DB: Qdrant Cloud Free Tier

## 1. Create Cloud Services

### Neon (PostgreSQL)
1. Create a Neon project and database.
2. Copy connection string and ensure it includes `sslmode=require`.
3. Initialize schema:

```powershell
psql "postgresql://<user>:<password>@<host>/<db>?sslmode=require" -f schema.sql
```

4. Optional: import your full data dump:

```powershell
psql "postgresql://<user>:<password>@<host>/<db>?sslmode=require" -f coverageatlas_full_YYYYMMDD_HHMMSS.sql
```

### Qdrant Cloud
1. Create a free cluster.
2. Copy HTTPS endpoint and API key.
3. Create collection and payload indexes:

```powershell
$env:QDRANT_URL="https://<cluster-id>.<region>.aws.cloud.qdrant.io"
$env:QDRANT_API_KEY="<qdrant-api-key>"
$env:QDRANT_COLLECTION="policy_chunks"
python qdrant_setup.py --init
```

### Upstash Redis
1. Create a free Redis database.
2. Copy TLS URL (`rediss://...`).

## 2. Deploy Backend on Render

This repo now includes `render.yaml`.

1. In Render, create service from GitHub repo.
2. Use Blueprint deploy (it will read `render.yaml`).
3. Set real values for all `sync: false` vars:
   - `GEMINI_API_KEY`
   - `DATABASE_URL` (Neon URL with `sslmode=require`)
   - `QDRANT_URL`
   - `QDRANT_API_KEY`
   - `REDIS_URL` (Upstash `rediss://...`)
   - `AUTH0_DOMAIN`
   - `AUTH0_AUDIENCE`
   - `AUTH0_CLIENT_ID`
4. Deploy and note backend URL:
   - `https://<your-render-service>.onrender.com`

5. Verify health endpoint:
   - `https://<your-render-service>.onrender.com/api/v1/health`

## 3. Deploy Frontend on Vercel

This repo now includes `frontend/vercel.json` for SPA routing.

1. Import repo in Vercel.
2. Set **Root Directory** to `frontend`.
3. Build settings:
   - Build command: `npm run build`
   - Output directory: `dist`
4. Set Vercel environment variables:
   - `VITE_API_BASE=https://<your-render-service>.onrender.com/api/v1`
   - `VITE_AUTH0_ENABLED=true`
   - `VITE_AUTH0_DOMAIN=<your-auth0-domain>`
   - `VITE_AUTH0_CLIENT_ID=<your-auth0-client-id>`
   - `VITE_AUTH0_AUDIENCE=<your-auth0-audience>`
   - `VITE_AUTH0_SCOPE=openid profile email`
   - `VITE_AUTH0_REDIRECT_URI=https://<your-vercel-domain>`
   - `VITE_AUTH0_CACHE_LOCATION=localstorage`
   - `VITE_AUTH0_USE_REFRESH_TOKENS=true`
5. Deploy and note frontend URL:
   - `https://<your-vercel-domain>`

## 4. Update Auth0 Application URLs

In Auth0 application settings, add your Vercel domain:

- Allowed Callback URLs:
  - `https://<your-vercel-domain>`
- Allowed Logout URLs:
  - `https://<your-vercel-domain>`
- Allowed Web Origins:
  - `https://<your-vercel-domain>`

If you still use local dev, keep localhost values as additional entries.

## 5. Smoke Test

1. Open frontend URL and sign up/log in.
2. Call profile route in UI (`/profile`) and verify name/email autofill.
3. Compare plans (`/compare`) for a known drug.
4. Policy timeline (`/changes`) should load without route 404s.

## 6. Notes

- Render free services sleep after inactivity (cold start on first request).
- Backend Docker now runs without `--reload` for production deployment.
- `.env.example` includes cloud URL examples for Neon and Upstash.
