# Ship Dock

Self-hosted deployment platform (like Vercel, but self-managed).

## Project Structure

- `frontend/` — Next.js 16 (App Router, React 19, Tailwind CSS 4, shadcn/base-ui)
- `backend/` — NestJS 11 (PostgreSQL/Prisma, Redis/BullMQ, MinIO)
- `scripts/` — Deployment scripts

## Deployment

### Frontend
Push to `main` branch → Vercel auto-deploys. No manual steps needed.

### Backend
Push to `main`, then SSH into the production server and run:
```bash
ssh root@178.104.154.165 'ship-dock upgrade --edge --force'
```
(SSH key is already in the local agent — no `-i` needed.)

This pulls latest `main`, installs deps, runs Prisma migrations, builds, and reloads PM2. Includes automatic backup and rollback on failure.

**Default server.** When the user says "升级服务器" / "upgrade the server" / "deploy to the server" without specifying, this is the server. (Note: `scripts/deploy.config.sh` references an older IP `54.174.82.13` and `ubuntu` user — those are stale, ignore them.)

### Deploying both
Push to `main` (triggers Vercel for frontend), then run `ssh root@178.104.154.165 'ship-dock upgrade --edge --force'` for backend.

## Development

```bash
# Backend
cd backend && npm run start:dev

# Frontend
cd frontend && npm run dev
```

## Analytics Integration Setup

### Google Analytics (GA4)

1. Go to [Google Cloud Console - Credentials](https://console.cloud.google.com/apis/credentials)
2. Create an **OAuth 2.0 Client ID** (type: Web application)
3. Add authorized redirect URI: `https://<your-api-domain>/api/analytics/callback/google`
4. Enable these APIs in [API Library](https://console.cloud.google.com/apis/library):
   - Google Analytics Admin API
   - Google Analytics Data API
5. Go to [Google Auth Platform - Audience](https://console.cloud.google.com/auth/audience) and either:
   - Add test users (for testing), or
   - Publish the app (for production, requires Google review)
6. Add to `deploy.config.sh`:
   ```
   GOOGLE_CLIENT_ID="<your-client-id>"
   GOOGLE_CLIENT_SECRET="<your-client-secret>"
   GOOGLE_REDIRECT_URI="https://<your-api-domain>/api/analytics/callback/google"
   ```

### Microsoft Clarity

1. Go to [Azure Portal - App Registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click **New registration**
3. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**
4. Redirect URI (Web): `https://<your-api-domain>/api/analytics/callback/microsoft`
5. After registration, go to **Certificates & secrets** → **New client secret**, copy the value
6. Go to **Manifest**, ensure:
   - `"signInAudience": "AzureADandPersonalMicrosoftAccount"`
   - `"accessTokenAcceptedVersion": 2`
7. Add to `deploy.config.sh`:
   ```
   MICROSOFT_CLIENT_ID="<appId from manifest>"
   MICROSOFT_CLIENT_SECRET="<client secret value>"
   MICROSOFT_REDIRECT_URI="https://<your-api-domain>/api/analytics/callback/microsoft"
   ```

**Note:** The `MICROSOFT_CLIENT_ID` is the `appId` from the manifest, not the secret's keyId.

## Project Tasks

Each project has a list of named one-off commands ("tasks") for operational
actions like seeding or cache clearing. Tasks live separately from the deploy
pipeline — they do not run on `git push`. Trigger them from the project's
**Tasks** sidebar entry (`/projects/<id>/tasks`) or via
`POST /api/projects/<id>/tasks/<taskId>/run`. Tasks and deploys share a
per-project Redis mutex (`project-lock:<projectId>`), so they never run
concurrently against the same project.

## Key conventions

- UI style: Vercel-inspired — minimal, black/white, theme-aware (light/dark via next-themes)
- Components: shadcn pattern with base-ui primitives, CVA variants, `data-slot` attributes
- API client: `frontend/src/lib/api.ts` — JWT auto-refresh, `api()` for JSON, `apiRaw()` for raw responses
- Port range: 3001–3999 for deployed projects
