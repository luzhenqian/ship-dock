# Analytics Integration Design

Centralized analytics tracking management for Ship Dock. Users OAuth-connect their Google/Microsoft accounts once, then associate GA4 properties and Clarity projects with individual Ship Dock projects.

## Scope

- **GA4 deep integration**: OAuth, property/stream management, custom report builder
- **Clarity lightweight integration**: OAuth, project management, tracking code — data viewing via external link
- **Authorization model**: User-level OAuth connections, project-level property/project association
- **Existing resources**: Support both linking existing GA4 properties / Clarity projects and creating new ones

## Architecture

Backend proxy model — all Google/Microsoft API calls go through NestJS backend. Frontend only talks to Ship Dock API.

```
Frontend → Ship Dock API → Google/Microsoft API
```

Rationale: Token security (server-side storage), caching (Redis), unified error handling, automatic token refresh.

## Data Model

### New Enums

```prisma
enum AnalyticsProvider {
  GOOGLE_GA4
  MICROSOFT_CLARITY
}
```

### AnalyticsConnection (user-level OAuth)

```prisma
model AnalyticsConnection {
  id           String            @id @default(uuid())
  userId       String
  user         User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider     AnalyticsProvider
  accessToken  String            // AES-256-GCM encrypted
  refreshToken String            // AES-256-GCM encrypted
  tokenExpiry  DateTime
  accountEmail String            // Authorized Google/Microsoft email
  accountId    String?           // Google Account ID
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt

  integrations AnalyticsIntegration[]

  @@unique([userId, provider, accountEmail])
}
```

### AnalyticsIntegration (project-level association)

```prisma
model AnalyticsIntegration {
  id             String              @id @default(uuid())
  projectId      String
  project        Project             @relation(fields: [projectId], references: [id], onDelete: Cascade)
  connectionId   String
  connection     AnalyticsConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  provider       AnalyticsProvider

  // GA4 fields
  ga4PropertyId  String?             // e.g. "properties/123456"
  ga4StreamId    String?             // e.g. "dataStreams/789"
  measurementId  String?             // e.g. "G-XXXXXXX"

  // Clarity fields
  clarityProjectId    String?
  clarityTrackingCode String?

  enabled        Boolean             @default(true)
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt

  @@unique([projectId, provider])
  @@index([connectionId])
}
```

### Existing Model Changes

- `User`: add `analyticsConnections AnalyticsConnection[]`
- `Project`: add `analyticsIntegrations AnalyticsIntegration[]`

## Backend Module Structure

```
backend/src/analytics/
├── analytics.module.ts
├── analytics.controller.ts
├── analytics.service.ts
├── connections/
│   ├── connections.controller.ts
│   └── connections.service.ts
├── integrations/
│   ├── integrations.controller.ts
│   └── integrations.service.ts
├── providers/
│   ├── ga4/
│   │   ├── ga4-admin.service.ts
│   │   ├── ga4-data.service.ts
│   │   └── ga4-oauth.service.ts
│   └── clarity/
│       ├── clarity-admin.service.ts
│       └── clarity-oauth.service.ts
├── dto/
└── crypto.service.ts
```

## API Endpoints

### OAuth Connections

```
GET    /api/analytics/connect/:provider        → Redirect to OAuth provider
GET    /api/analytics/callback/:provider       → OAuth callback, store tokens
GET    /api/analytics/connections               → List current user's connections
DELETE /api/analytics/connections/:id           → Disconnect
```

### GA4 Management

```
GET  /api/analytics/ga4/accounts              → List GA4 accounts
GET  /api/analytics/ga4/properties?accountId= → List properties under account
POST /api/analytics/ga4/properties            → Create new property
GET  /api/analytics/ga4/streams?propertyId=   → List data streams
POST /api/analytics/ga4/streams               → Create new data stream
```

### GA4 Reports (scoped to a project integration)

```
POST /api/analytics/integrations/:projectId/reports     → Custom report query (uses project's linked GA4 property)
GET  /api/analytics/ga4/dimensions                      → Available dimensions list (static/cached)
GET  /api/analytics/ga4/metrics                         → Available metrics list (static/cached)
```

### Clarity Management

```
GET  /api/analytics/clarity/projects          → List Clarity projects
POST /api/analytics/clarity/projects          → Create Clarity project
```

### Project Integrations

```
GET    /api/analytics/integrations/:projectId       → View project integrations
POST   /api/analytics/integrations/:projectId       → Associate analytics to project
PUT    /api/analytics/integrations/:projectId/:id   → Update association
DELETE /api/analytics/integrations/:projectId/:id   → Remove association
```

## Frontend Pages

### Settings > Analytics (`/settings/analytics`)

User-level OAuth connection management. Card layout showing connected Google/Microsoft accounts with provider icon, authorized email, connection time, status (active/expired). Connect and disconnect buttons.

### Project > Analytics Overview (`/projects/[id]/analytics`)

Two-column layout: GA4 card + Clarity card. Unlinked state shows "Set up" CTA. Linked state shows:
- GA4: Measurement ID, property name, "View Reports" button
- Clarity: Project ID, tracking code, "Open Clarity Dashboard" external link

### Project > Analytics Setup (`/projects/[id]/analytics/setup`)

Step-by-step flow:
1. Select provider (GA4 / Clarity)
2. Select connected account (or redirect to Settings to connect)
3. Choose existing property/project or create new
4. Confirm association

### Project > GA4 Reports (`/projects/[id]/analytics/reports`)

Report builder with:
- **Date range picker**: Presets (7d / 30d / 90d) + custom range
- **Dimension selector**: Multi-select dropdown from `/ga4/dimensions`
- **Metric selector**: Multi-select dropdown from `/ga4/metrics`
- **Run query button** → calls `/ga4/reports`
- **Results**: Table by default; auto-renders charts for common combinations
- **Chart types**: Line (time series), bar (comparison), pie (proportion) — auto-recommended based on dimensions

UI style: Vercel-inspired minimal black/white, theme-aware (light/dark).

## Security

### Token Encryption

- AES-256-GCM encryption for access/refresh tokens in PostgreSQL
- Encryption key via `ANALYTICS_ENCRYPTION_KEY` environment variable
- `crypto.service.ts` handles all encrypt/decrypt — no other service touches plaintext tokens

### OAuth Security

- OAuth state parameter: random UUID stored in Redis (TTL 10 min), validated on callback to prevent CSRF
- Callback URL provider whitelist (only `GOOGLE_GA4` / `MICROSOFT_CLARITY`)
- Google OAuth uses `access_type=offline` for refresh token

### API Permissions

- All analytics endpoints require JWT authentication
- Connection management: user can only manage own connections
- Project integrations: reuse existing project role system (OWNER/ADMIN can manage, DEVELOPER/VIEWER read-only)
- GA4 reports: all project members can view

### Token Refresh

- Check `tokenExpiry` before each API call
- Auto-refresh 5 minutes before expiry using `refreshToken`
- On refresh failure: mark connection as invalid, return `ANALYTICS_REAUTH_REQUIRED` to frontend

### Report Caching (Redis)

- Cache key: `ga4:report:{propertyId}:{queryHash}`
- Realtime reports: 30s TTL
- Historical reports: 5min TTL
- Dimension/metric lists: 24h TTL

## Error Handling

| Scenario | Response |
|---|---|
| Token expired, refresh fails | 401 + `ANALYTICS_REAUTH_REQUIRED` error code |
| Google/Microsoft API rate limit | 429 + "Please try again later" |
| User revoked OAuth in Google/Microsoft | Detect on next call, mark connection invalid, notify frontend |
| Linked GA4 property deleted externally | 404 from Google API, prompt user to re-link |
| Encryption key rotation | One-time migration script to re-encrypt all tokens |

## External Configuration Required

### Google Cloud Platform
- Create OAuth 2.0 Client ID in GCP Console
- Enable Google Analytics Admin API v1
- Enable Google Analytics Data API v1
- Configure authorized redirect URI

### Microsoft Azure AD
- Register application in Azure AD
- Configure OAuth 2.0 redirect URI
- Request Clarity API permissions
