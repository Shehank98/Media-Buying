# Ogilvy Orbit (Media Buying Records System)

## Architecture

Single Railway service: Express API + React SPA served from the same port.

```
/api      -> Express backend (Node.js + Prisma + PostgreSQL)
/web      -> React frontend (Vite + Tailwind CSS)
```

The API serves all routes under `/api/*`. The React build (`web/dist`) is served as static files for everything else, with SPA fallback via `/{*splat}`.

## Tech Stack

- **Backend:** Node.js 20+, Express v5, Prisma ORM v5, PostgreSQL
- **Frontend:** React 19, Vite 8, Tailwind CSS v4, custom CSS design system
- **Auth:** JWT access tokens (15min) + refresh tokens (7 days), bcrypt passwords (12 salt rounds)
- **Charts:** Recharts (Bar, Pie/Donut, Line, Area, Composed, Scatter/Bubble, RadialBar/Gauge, stacked-area). Loading states use the branded `OrbitLoader` component everywhere (not plain text).
- **Export:** ExcelJS (Excel server-side), XLSX/SheetJS (Excel client-side), jsPDF + jspdf-autotable + html2canvas (PDF client-side), PDFKit (PDF server-side)
- **Deploy:** Railway (single service via railway.toml), PostgreSQL plugin
- **HTTP Client:** Axios with token refresh interceptor

## Directory Structure

```
Media-Buying/
├── CLAUDE.md
├── README.md
├── package.json              # Root: build & start scripts for Railway
├── railway.toml              # Railway deployment config
├── api/
│   ├── package.json
│   ├── .env.example
│   ├── prisma/
│   │   ├── schema.prisma     # Full database schema (20+ models)
│   │   ├── seed.js           # Seeds admin, agencies, media groups, channels, clients, categories
│   │   ├── channel-seed-data.js  # MEDIA_GROUPS (60) + CHANNEL_MASTERS (154) from client sheet
│   │   ├── client-seed-data.js   # CLIENTS (75) from client sheet
│   │   └── phase1-migration.sql
│   └── src/
│       ├── index.js          # Express app entry point
│       ├── controllers/      # 14 controller files
│       ├── routes/           # 14 route files
│       ├── middleware/
│       │   ├── auth.js       # authenticate, requireRole, checkPasswordChange
│       │   └── access.js     # checkClientAccess, checkAgencyAccess, checkChannelAccess, getAccessibleClientIds
│       ├── services/
│       │   ├── auth.service.js    # JWT token generation/verification, bcrypt
│       │   ├── email.service.js   # Google Apps Script webhook for emails
│       │   └── export.service.js  # Server-side Excel/PDF generation
│       └── utils/
│           └── prisma.js     # Prisma singleton
└── web/
    ├── package.json
    ├── vite.config.js        # React plugin + Tailwind + proxy /api -> localhost:3001
    ├── index.html
    └── src/
        ├── main.jsx          # React entry point
        ├── App.jsx           # Router with all routes
        ├── index.css         # Design system (CSS variables, component styles)
        ├── lib/
        │   └── api.js        # Axios instance with Bearer token + 401 refresh interceptor
        ├── contexts/
        │   └── AuthContext.jsx  # Auth state, login, logout, refreshToken, changePassword
        ├── components/
        │   ├── Icon.jsx         # 43+ SVG icons, Avatar, TypeBadge, RoleBadge, fmtLKR
        │   ├── Layout.jsx       # Sidebar + topbar + breadcrumbs + notifications
        │   ├── OrbitLoader.jsx  # Branded animated loading spinner (used everywhere)
        │   ├── RecentUploads.jsx # Recent upload batches list
        │   └── ProtectedRoute.jsx  # Auth guard + role enforcement
        └── pages/            # 18 page components
```

## Running Locally

```bash
# 1. Install dependencies
cd api && npm install
cd ../web && npm install

# 2. Create api/.env (copy from api/.env.example)
DATABASE_URL=postgresql://user:pw@localhost:5432/media_buying
JWT_SECRET=your-secret-here
JWT_REFRESH_SECRET=your-refresh-secret-here
PORT=3001

# 3. Generate Prisma client + push schema
cd api && npx prisma generate && npx prisma db push

# 4. Seed database
cd api && npm run seed

# 5. Start API (terminal 1)
cd api && npm run dev    # runs with --watch

# 6. Start frontend (terminal 2)
cd web && npm run dev    # http://localhost:5173, proxies /api -> localhost:3001
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (auto-set by Railway plugin) |
| `JWT_SECRET` | Yes | Access token signing secret |
| `JWT_REFRESH_SECRET` | Yes | Refresh token signing secret |
| `PORT` | No | Server port (Railway sets automatically, default 3001) |
| `GOOGLE_SCRIPT_URL` | No | Google Apps Script webhook for password reset emails |
| `FRONTEND_URL` | No | CORS origin whitelist (comma-separated) |

## Railway Deployment

1. Create a new Railway project
2. Connect this GitHub repo
3. Add a **PostgreSQL** database plugin
4. Set environment variables: `JWT_SECRET`, `JWT_REFRESH_SECRET`
5. Deploy -- Railway runs `npm run build` (builds both web + api) then `npm run start`

Railway auto-injects `DATABASE_URL` from the PostgreSQL plugin. The `railway.toml` configures nixpacks builder with restart-on-failure (max 10 retries).

Build pipeline: `cd web && npm install && npm run build && cd ../api && npm install && npm run build`
Start pipeline: `cd api && npx prisma db push && node prisma/seed.js && node src/index.js`

## Database Schema

### Enums

- **Role:** SUPER_ADMIN, MANAGER, GROUP_HEAD, PLANNER
- **ChannelType:** TV, RADIO, PRINT, DIGITAL, CINEMA, OOH
- **PropertyType:** BOUGHT_AIRTIME, SPONSORSHIP, BONUS_COMMERCIAL, OTHER
- **UploadStatus:** PENDING, PROCESSING, REVIEW, COMPLETE, FAILED
- **RowStatus:** OK, NEEDS_REVIEW, FAILED

### Core Models

| Model | Purpose |
|---|---|
| User | System users with role, email, passwordHash, mustChangePassword |
| Agency | Media agencies (e.g., RedWorks, Ogilvy, Geometry) |
| Client | Brand clients under agencies |
| UserAgencyAccess | M:N user-agency assignments |
| UserClientAccess | M:N user-client assignments |
| Team | Team groupings within agencies. `headUserId` (nullable) names the team's head — a GROUP_HEAD user. Admin (Admin → Teams) enforces a 1-team-per-client invariant: assigning a client to a team detaches it from any other team, so every client has exactly one team and therefore one team head. Besides the per-team Add/Edit modal's client-chips picker, the Teams tab also has a standalone **"Assign Accounts to Heads"** card (above the teams table) — one row per team showing its head's name + clients as instant-toggle chips (scoped to that team's agency), backed by the same `POST /admin/teams/:id/clients` (`assignTeamClients`/`setTeamClients`) endpoint, for quick client-reassignment without opening the modal |
| TeamMember | Users assigned to teams (with role) |
| TeamClient | Teams assigned to clients (kept 1:1 per client by the invariant above, even though the table itself is M:N) |

### Channel & Property Models

| Model | Purpose |
|---|---|
| MediaGroup | Grouping of channels (e.g., "Maharaja Group") |
| ChannelMaster | Master registry of all TV/Radio/Print channels with aliases. `isActive` channels with **zero `ScheduleLog` rows** are automatically deactivated by `seed.js`'s startup reconcile (idempotent, runs every deploy) — hides never-used channels from active-only pickers (Media Buying combobox, Add Channel forms) without deleting them; Admin's Channels tab still lists them (Inactive badge) and a manual toggle reactivates. Bulk import resolves channels by name regardless of `isActive`, so logging spend against a deactivated channel later is unaffected. The four forecasting "category total" bucket channels (`Print`/`Cinema`/`OOH`/`Digital`, see `TOTAL_BUCKETS` in `seed.js`) are exempted from this reconcile by name, since they're only ever referenced via `MonthlyForecast`, never `ScheduleLog` — without the exemption they'd get deactivated and `listForecastChannels` would silently fall back to an unrelated active channel in that medium, mis-attributing the category-total forecast (this happened in practice: a "Digital Total" entry got saved against an unrelated real digital channel). `seed.js` also runs a one-time-per-occurrence backfill that repoints any already-mis-tagged `MonthlyForecast` rows onto the correct bucket channel (merging amounts if a correct row already exists for that client/month) |
| Channel | Client-specific channel records |
| Property | Negotiated deals on channels (cost, bonus%, sponsorship details, startDate, endDate — endDate null means still ongoing) |
| PropertyHistory | Audit trail for property changes (previousValues, newValues JSON) |
| ChannelAgencyDeal | Year-keyed overall agency discount %/bonus % per channel (Media Buying tab) |
| ChannelClientDeal | Year-keyed per-client discount %/bonus % per channel (Media Buying tab) |

### Schedule & Upload Models

| Model | Purpose |
|---|---|
| ScheduleLog | Monthly execution records with scheduleValue, scheduleValueWithVat. `medium`/`mediaGroup` are denormalized strings snapshotted from the channel master at insert time (for fast Spend Analytics aggregation) — `updateChannelMaster` and `mergeChannelMasters` both refresh these on every affected row when a channel's medium/media group changes or two channels are merged, so the Spend Breakdown's Media Group & Channel views stay correct for historical spend too. Edits/merges made *before* that fix shipped left some rows drifted — `seed.js`'s startup reconcile step (idempotent, runs every deploy) realigns any `medium`/`media_group` that no longer matches the row's current channel master, fixing that historical drift automatically |
| UploadBatch | Batch upload file records with status tracking |
| UploadBatchRow | Individual rows in upload batches (raw + resolved data) |
| ScheduleLogEdit | Audit trail for schedule log edits |
| Brand | Brand names under clients |
| Campaign | Campaigns under brands |
| Notification | User notifications (type, title, message, isRead) |
| PasswordResetToken | Password reset tokens with SHA256 hash + expiry |

### Media Package Models

| Model | Purpose |
|---|---|
| MediaPackage | A channel package (name, emailIntro, isActive, optional `deadline`, legacy-optional `category`) created by an admin. Past its `deadline` it auto-deactivates (lazy, on every list/inbox fetch via `deactivateExpiredPackages`) |
| PackageLineItem | A line item within a package: `label` holds the **channel name** + `rate` (the UI calls it "Channel", one row per channel) |
| PackageRecipient | Per-team-head send record + in-app response (interest, budgetNote, `interestedClientIds` Int[] — the team head's own clients they mark interested, legacy `clientName`, notes, followUp). `tokenHash`/`expiresAt` are legacy/optional — the flow is now in-app, not token links |

### Default Seed Data

- **Admin:** `shehan.kavishka@ogilvy.com` / `Shehan@98`
- **Agencies (3):** RedWorks Media, Ogilvy Media, Geometry Media
- **Media Groups (60):** client-provided list (Power House Limited, MTV Channel (Pvt) LTD, Wijeya Newspapers, …) — from `api/prisma/channel-seed-data.js`
- **Channel Masters (154):** client-provided TV/Radio/Print channels — from `api/prisma/channel-seed-data.js` (deduped by unique name)
- **Clients (75):** client-provided list under Ogilvy Media (68) + Geometry Media (7) — from `api/prisma/client-seed-data.js`
- **Property categories (6):** Frequency/Drama/News/Reality/Event Sponsorship, Others

**Seed data modules** (generated from client spreadsheets, imported by `seed.js`):
- `api/prisma/channel-seed-data.js` → `MEDIA_GROUPS`, `CHANNEL_MASTERS`
- `api/prisma/client-seed-data.js` → `CLIENTS`

**One-time replace:** `seed.js` upserts the provided media groups/channels/clients, and on first run (detected by the presence of the *old* default groups like "Maharaja Group") it removes the legacy default channel masters/media groups. Records still referenced by schedule logs are deactivated instead of deleted so startup never fails. This wipe runs once, then never again (so admin-added channels survive future restarts).

**Client seeding respects moves:** a seed client is only created if its name doesn't already exist under *any* agency (so a client moved to a different agency is never recreated under its original one). On each run the seed also removes **duplicate empty client shells** — same name under multiple agencies where the duplicate has no channels/logs — keeping the record that holds the data. (This self-heals the old bug where moving a client duplicated it under its seed agency, causing bulk-import "exists under multiple agencies" errors.)

## Roles & Access Control

| Role | Access |
|---|---|
| `SUPER_ADMIN` | Full access -- manage agencies, users, teams, all data, master data, upload tracker |
| `MANAGER` | Read-only across assigned agencies (via UserAgencyAccess); can view reports, analytics, executive dashboard |
| `GROUP_HEAD` | Manages team; access to clients assigned to their team (via TeamMember + TeamClient) |
| `PLANNER` | Add/edit properties and schedule logs on directly assigned clients (via UserClientAccess) |

### Access Control Middleware (api/src/middleware/access.js)

- `checkClientAccess`: Verifies user can access client based on role hierarchy
  - SUPER_ADMIN: always allowed
  - MANAGER: checks UserAgencyAccess -> Agency -> Client
  - GROUP_HEAD: checks TeamMember -> TeamClient
  - PLANNER: checks UserClientAccess
- `checkAgencyAccess`: Verifies user can access agency
- `checkChannelAccess`: Resolves channel -> client, then applies client access check
- `getAccessibleClientIds(userId, role)`: Returns array of client IDs user can access

## API Routes

### Authentication
```
POST   /api/auth/login
POST   /api/auth/refresh
POST   /api/auth/logout
POST   /api/auth/forgot-password
POST   /api/auth/reset-password
POST   /api/auth/change-password        (AUTH)
GET    /api/auth/profile                 (AUTH)
```

### Agencies & Clients
```
GET    /api/agencies                     (AUTH, role-filtered)
GET    /api/agencies/:agencyId           (AUTH + checkAgencyAccess)
GET    /api/agencies/:agencyId/clients   (AUTH + checkAgencyAccess)
POST   /api/agencies/:agencyId/clients   (AUTH + SUPER_ADMIN|GROUP_HEAD + checkAgencyAccess)

GET    /api/clients/:clientId            (AUTH + checkClientAccess)
PUT    /api/clients/:clientId            (AUTH + SUPER_ADMIN|GROUP_HEAD + checkClientAccess)
DELETE /api/clients/:clientId            (AUTH + SUPER_ADMIN + checkClientAccess)
GET    /api/clients/:clientId/channels   (AUTH + checkClientAccess)
POST   /api/clients/:clientId/channels   (AUTH + SUPER_ADMIN|GROUP_HEAD|PLANNER + checkClientAccess)
PUT    /api/clients/channels/:id         (AUTH + SUPER_ADMIN|GROUP_HEAD)
DELETE /api/clients/channels/:id         (AUTH + SUPER_ADMIN)
```

### Channels & Properties
```
GET    /api/channels/:channelId              (AUTH + checkChannelAccess)
GET    /api/channels/:channelId/properties   (AUTH + checkChannelAccess)
POST   /api/channels/:channelId/properties   (AUTH + PLANNER|GROUP_HEAD|SUPER_ADMIN + checkChannelAccess)

GET    /api/channels/:channelId/deals        (AUTH + checkChannelAccess)                          ChannelClientDeal for this client+channel
POST   /api/channels/:channelId/deals        (AUTH + PLANNER|GROUP_HEAD|SUPER_ADMIN + checkChannelAccess)  upsert by year
PUT    /api/channels/deals/:id               (AUTH + PLANNER|GROUP_HEAD|SUPER_ADMIN + checkChannelClientDealAccess)
DELETE /api/channels/deals/:id               (AUTH + SUPER_ADMIN|GROUP_HEAD + checkChannelClientDealAccess)

GET    /api/properties/channel/:channelId    (AUTH + checkChannelAccess)
POST   /api/properties/channel/:channelId    (AUTH + PLANNER|GROUP_HEAD|SUPER_ADMIN + checkChannelAccess)
PUT    /api/properties/:id                   (AUTH + PLANNER|GROUP_HEAD|SUPER_ADMIN)
DELETE /api/properties/:id                   (AUTH + SUPER_ADMIN|GROUP_HEAD)
GET    /api/properties/:id/history           (AUTH)
```

### Database (Schedule Logs)
```
GET    /api/database                     (AUTH, filtered/paginated)
GET    /api/database/metadata            (AUTH)
GET    /api/database/analytics           (AUTH + SUPER_ADMIN|MANAGER)
GET    /api/database/batches             (AUTH)
POST   /api/database                     (AUTH + SUPER_ADMIN|GROUP_HEAD|PLANNER)
POST   /api/database/bulk                (AUTH + SUPER_ADMIN|GROUP_HEAD|PLANNER)   client-scoped, pre-resolved IDs
POST   /api/database/import-all          (AUTH + SUPER_ADMIN)   multi-client import, resolves agency/client/channel BY NAME, combines Year+month-name, optional create-missing-clients, chunked insert (≤60k rows)
PUT    /api/database/:id                 (AUTH + SUPER_ADMIN|GROUP_HEAD|PLANNER)
DELETE /api/database/:id                 (AUTH + SUPER_ADMIN|GROUP_HEAD|PLANNER)
DELETE /api/database/batches/:batchId    (AUTH + SUPER_ADMIN|GROUP_HEAD|PLANNER)
GET    /api/database/:id/edits           (AUTH)
```

### Reports
```
GET    /api/reports/agency/:agencyId     ?format=excel|pdf  (AUTH + SUPER_ADMIN|MANAGER)
GET    /api/reports/client/:clientId     ?format=excel|pdf  (AUTH + SUPER_ADMIN|MANAGER)
GET    /api/reports/channel/:channelId   ?format=excel|pdf  (AUTH + SUPER_ADMIN|MANAGER)
GET    /api/reports/properties           (AUTH + SUPER_ADMIN|MANAGER)
       ?groupBy=all|agency|client|channel   (channel = canonical channel master, spans agencies)
       &agencyId &clientId &channelName &channelType &propertyType
       &includeHistory=true|false &format=json|excel|pdf
       Excel: per-group sheets + "Rate History" sheet. PDF: branded, per-property rate timeline.
GET    /api/reports/schedule-logs        (AUTH + SUPER_ADMIN|MANAGER)
       ?groupBy &agencyId &clientId &channelMasterId &medium &monthFrom &monthTo &format=json|excel|pdf

### Media Packages
```
GET    /api/packages                              (AUTH + SUPER_ADMIN)   list + value + response counts
POST   /api/packages                              (AUTH + SUPER_ADMIN)
GET    /api/packages/:id                          (AUTH + SUPER_ADMIN)
PUT    /api/packages/:id                          (AUTH + SUPER_ADMIN)
PATCH  /api/packages/:id/toggle                   (AUTH + SUPER_ADMIN)
DELETE /api/packages/:id          ?force=true      (AUTH + SUPER_ADMIN)   sent packages 409 unless force=true (then cascades recipients+line items)
POST   /api/packages/:id/send                     (AUTH + SUPER_ADMIN)   creates recipients, emails + notifies
GET    /api/packages/:id/responses                (AUTH + SUPER_ADMIN)
PATCH  /api/packages/recipients/:id/follow-up     (AUTH + SUPER_ADMIN)
GET    /api/packages/recipients/group-heads       (AUTH + SUPER_ADMIN)
GET    /api/packages/inbox                         (AUTH + GROUP_HEAD)    packages shared with me
POST   /api/packages/inbox/:recipientId/respond    (AUTH + GROUP_HEAD)    Interested/Negotiate/Not interested + notes
```

### Analytics
```
GET    /api/analytics/channel/:channelMasterId/summary           (AUTH + SUPER_ADMIN|MANAGER|GROUP_HEAD)
GET    /api/analytics/channel/:channelMasterId/monthly-spend
GET    /api/analytics/channel/:channelMasterId/clients
GET    /api/analytics/channel/:channelMasterId/property-history

GET    /api/analytics/dashboard/summary          (AUTH + SUPER_ADMIN|MANAGER)   ?agencyId &year
GET    /api/analytics/dashboard/agency-comparison                                ?year
GET    /api/analytics/dashboard/top-clients                                      ?year   (returns 6-mo spark series)
GET    /api/analytics/dashboard/top-channels                                     ?year
GET    /api/analytics/dashboard/medium-split      (?agencyId &year)
GET    /api/analytics/dashboard/monthly-trend                                    ?year
GET    /api/analytics/dashboard/activity-log     (AUTH + SUPER_ADMIN)
GET    /api/analytics/dashboard/recent-uploads
GET    /api/analytics/deep-dashboard             (AUTH + SUPER_ADMIN|MANAGER)   ?agencyId &clientId &channelMasterId

# Year / period anchoring (analytics.controller.js → refPeriod(where, year)):
#  - ?year=YYYY  -> locked to that calendar year (Jan–Dec).
#  - no year ("All") -> ALL-TIME combined (ys reaches earliest data); "this month" metrics
#    anchor to the latest month that has data. YoY chips always compare the current/selected
#    full year vs the previous full year. `availableYears` is derived live from the data, so
#    uploading new years (2025/2026) auto-surfaces year buttons and rolls into "All" everywhere.
```

### Media Buying (SUPER_ADMIN only)
```
GET    /api/media-buying/channels/:channelMasterId                           getChannelIntelligence  (all-time, no year param)
GET    /api/media-buying/channels/:channelMasterId/clients/:clientId/yearly  getClientChannelYearly  (all-time, no year param)
GET    /api/media-buying/channels/:channelMasterId/planner                   getNegotiationPlanner   ?monthlyBudget=
POST   /api/media-buying/agency-deals                                        upsertAgencyDeal  (upsert by channelMasterId+year)
DELETE /api/media-buying/agency-deals/:id                                    deleteAgencyDeal
POST   /api/media-buying/client-deals                                        upsertClientDeal  (upsert by channelMasterId+clientId+year)
DELETE /api/media-buying/client-deals/:id                                    deleteClientDeal
```

### Profit (SUPER_ADMIN only)
```
GET /api/profit/summary     ?startDate&endDate&agencyId&clientId   totals for the 3 cards
GET /api/profit/monthly     ?...                                    profit/revenue per entry-month
GET /api/profit/by-agency   ?...
GET /api/profit/by-client   ?...
GET /api/profit/details     ?...&page&pageSize&sortBy&sortDir       paginated ground-truth rows
```
Every route is `requireRole('SUPER_ADMIN')` (403 otherwise, enforced server-side — not just UI hiding).

### Admin (SUPER_ADMIN only)
```
CRUD   /api/admin/agencies
CRUD   /api/admin/users
POST   /api/admin/users/:id/agencies
POST   /api/admin/users/:id/clients
CRUD   /api/admin/teams
POST   /api/admin/teams/:id/members
POST   /api/admin/teams/:id/clients
CRUD   /api/admin/channel-masters
```

### Master Data (SUPER_ADMIN only)
```
CRUD   /api/masterdata/media-groups
PATCH  /api/masterdata/media-groups/:id/toggle
CRUD   /api/masterdata/channel-masters
PATCH  /api/masterdata/channel-masters/:id/toggle
POST   /api/masterdata/channel-masters/merge
CRUD   /api/masterdata/brands
PATCH  /api/masterdata/brands/:id/toggle
CRUD   /api/masterdata/campaigns
PATCH  /api/masterdata/campaigns/:id/toggle
```

### Notifications & Upload Tracker
```
GET    /api/notifications                        (AUTH)
PATCH  /api/notifications/:id/read               (AUTH)
PATCH  /api/notifications/read-all               (AUTH)
GET    /api/notifications/upload-tracker          (AUTH + SUPER_ADMIN)
POST   /api/notifications/send-reminder          (AUTH + SUPER_ADMIN)
GET    /api/notifications/master-sheet           (AUTH + SUPER_ADMIN|MANAGER)
```

## Frontend Pages

### Public Pages
| Page | Route | Purpose |
|---|---|---|
| LoginPage | `/login` | Email/password auth |
| ForgotPasswordPage | `/forgot-password` | Password reset request |
| ResetPasswordPage | `/reset-password?token=` | Set new password |
| ChangePasswordPage | `/change-password` | Forced password change on first login |

### Authenticated Pages (All Roles)
| Page | Route | Purpose |
|---|---|---|
| DashboardPage | `/` | Home dashboard with agency stats |
| DatabasePage | `/database` | Excel-like spreadsheet for schedule logs, bulk upload, batch delete |
| AgenciesPage | `/agencies` | Agency list with CRUD |
| AgencyDetailPage | `/agencies/:agencyId` | Agency detail with client list |
| ClientsPage | `/clients` | Client list across agencies |
| ClientDetailPage | `/clients/:clientId` | Client detail with channels by medium |
| ChannelDetailPage | `/channels/:channelId` | Channel properties with history timeline. Also has an "Add deal" button (next to "Add property") + a Deal terms table for recording/editing/deleting that client's `ChannelClientDeal` (discount %/bonus % per year) on this channel — role-gated the same as properties (PLANNER/GROUP_HEAD/SUPER_ADMIN add/edit, SUPER_ADMIN/GROUP_HEAD delete), unlike the SUPER_ADMIN-only `/media-buying` admin view |
| ProfilePage | `/profile` | User profile, change password |

### Role-Restricted Pages
| Page | Route | Roles | Purpose |
|---|---|---|---|
| SpendAnalyticsPage | `/spend-analytics` | SUPER_ADMIN, MANAGER, GROUP_HEAD, PLANNER | Charts + grouped Media Group/Channel breakdown + Excel/PDF export. GROUP_HEAD/PLANNER see only their assigned clients (scoped); MANAGER agency-scoped; admin full |
| ExecutiveDashboardPage | `/executive-dashboard` | SUPER_ADMIN, MANAGER | Multi-chart executive overview |
| ChannelIntelligencePage | `/channel-masters/:id` | SUPER_ADMIN, MANAGER, GROUP_HEAD | Per-channel analytics |
| ReportsPage | `/reports` | SUPER_ADMIN, MANAGER | Report generation by channel/client/agency |
| UploadTrackerPage | `/upload-tracker` | SUPER_ADMIN | Monthly upload status tracking, send reminders. **Removed from the sidebar nav + router** (page component retained but no longer reachable in-app; `/api/notifications/upload-tracker` endpoint still exists) |
| ProfitPage | `/profit` | SUPER_ADMIN | Agency profit on confirmed actual spend only (finance screen). 3 cards (Revenue, Profit, Blended %), Monthly Profit Trend, Profit by Agency, Profit by Client, paginated detail table. Commission snapshotted at entry |
| MediaBuyingPage | `/media-buying` | SUPER_ADMIN | Channel negotiation intelligence — agency/client discount & bonus deal history, year-over-year trend arrows, Negotiation Planner, Excel export |
| AdminPage | `/admin` | SUPER_ADMIN | User, team, agency, client management (tabbed). Channels tab has a per-row "Merge" action (calls `POST /masterdata/channel-masters/merge`) to consolidate duplicate channel masters — moves schedule logs/upload rows + aliases onto the picked target and deactivates the source. Header has an **"Export all"** button (`exportAll`, client-side SheetJS) that dumps every already-loaded admin dataset into one `.xlsx`, a sheet per entity: **Users, Agencies, Clients, Channels** (channel + medium + media group + active + aliases + schedule-log count), **Media Groups, Teams** — no new endpoint, it reuses the page's existing state. Clients tab also has a per-row **"Merge"** action (`POST /admin/clients/merge`, `mergeClients` in `admin.controller.js`) to consolidate duplicate same-name clients — in one transaction it re-points schedule logs (realigning `agencyId` to the target), moves client channels + their properties, brands + campaigns, forecasts, deals, and user/team assignments onto the target, resolving every unique-constraint clash (same-name channel/brand/campaign folded, forecast amounts summed, deal/user/team dupes deduped), then deletes the now-empty source |
| PackagesPage | `/packages` | SUPER_ADMIN | Build packages (card grid), send to team heads, track responses |
| MyPackagesPage | `/my-packages` | GROUP_HEAD | Inbox of shared packages; reply Interested/Negotiate/Not interested |

## Analytics, Dashboards & Charts

How charts work: page calls an `/analytics/*` or `/database/analytics` endpoint → saves the
array to state → passes it into a Recharts component as `data`. Spend data comes from
`ScheduleLog` rows. Every chart's `dataKey` matches a field the endpoint returns (audited).
A standalone reference also lives in `docs/DASHBOARDS_AND_CHARTS.md`.

### Home Dashboard (`/`, DashboardPage.jsx) — exec view, year-filtered
- **Year buttons** (All + each year from `summary.availableYears`) → re-fetch all widgets with `?year`.
- **Stat cards** (`/dashboard/summary`): Total Media Spend (`billingsYTD` = all-time when "All"), Active Clients, Channels Tracked, Schedule Logs.
- **Monthly Spend Trend** — AreaChart (`/dashboard/monthly-trend` `combined[].scheduleValue`) + a **3-month rolling-average** Line overlay.
- **Medium Split** — donut (`/dashboard/medium-split` `ytd[]`); center shows total spend.
- **Spend Velocity** — RadialBar gauge (`summary.velocityPct` = this month vs same month last year).
- **Top Clients by Spend** — table with **6-month inline sparklines** (`/dashboard/top-clients` `spark[]`).
- **Recent Activity** (`/dashboard/recent-uploads`), **Spend by Agency** bars (`/dashboard/agency-comparison` `ytdBillings`), **Top Channels** ranked bars (`/dashboard/top-channels` `ytdSpend`, colored by medium).
- Non-exec roles get a compact quick-links view (no charts).

### Executive Dashboard (`/executive-dashboard`)
- KPI cards; **Monthly Billing Trend** (Combined Area / By-Agency multi-Line toggle); **Top 10 Clients / Channels** ranked bars (YTD + this-month + MoM/YoY); **Agency Comparison** grouped bars + cards; **Medium Split** two donuts (this-month + YTD with per-medium YoY); **Activity Log** table; **Recent Uploads**. "Export summary" → branded jsPDF + autoTable. Loading uses skeletons.
- Inside the Annual Achievement section, under **Monthly Spend**, three Group Contribution chart-cards in `AchievementSection` (`ExecutiveDashboardPage.jsx`), all team-grouped: each team is one `Team` (clients grouped via `TeamClient`, label includes the `headUserId` head name); clients not yet assigned to a team roll into "Unassigned". All three are read-only and unaffected by the page's year selector — each picks its own time window server-side.
  - **Group Contribution** (donuts) — `GET /dashboard/group-contribution` (`getGroupContribution`). Returns `{ months: [{month, label}], groups: [{key, teamId, name, headName, agencyName, m1, m2}] }` for the **latest two months with any schedule data** (`m1`=older, `m2`=newer, both LKR millions). The frontend renders **two side-by-side `PieChart` donuts** (one per month), each slice = one team's % share of that month's total team spend (computed client-side in `donutFor(key)`, NOT returned by the API — the API only returns raw `m1`/`m2` values). Colors come from the shared `TEAM_COLORS` palette (cycles if more teams than colors). To change which months are compared, edit `getGroupContribution`'s month-selection query, not the frontend.
  - **Group Contribution — Actual Avg vs Forecast** (vertical grouped bars, one pair per team along the X axis, matching the reference slide layout) — `GET /dashboard/group-contribution-variance` (`getGroupContributionVariance`). Finds the single latest month with `ScheduleLog` data, derives its calendar year, and averages **every actual month so far this year (Jan through that latest month, inclusive)** per team — this is the "actual" bar. The other bar is that team's submitted **`MonthlyForecast`** for the very next month (the month the Forecasting tab is currently collecting submissions for), summed per team and used as-is (already in millions, no `/1e6`). Example: with actuals through March, bars are "Jan-Mar Avg" vs "Apr Forecast"; once April actuals land, it becomes "Jan-Apr Avg" vs "May Forecast" — fully dynamic, nothing hardcoded. Rolls over the year boundary (Dec actual → next Jan forecast). Returns `{ actualMonths, actualMonthsLabel, forecastMonth, forecastMonthLabel, groups: [{key, teamId, name, headName, agencyName, avgActual, forecast, diffPct}] }`. `diffPct` = `(forecast - avgActual) / avgActual * 100`, rounded to a whole number (100 if `avgActual` is 0 and `forecast` > 0, else 0 if both are 0). If a team hasn't submitted a forecast yet for the next month, `forecast` is simply 0 for that team (the bar still renders, at zero). Bars: `avgActual` (blue) vs `forecast` (orange); `diffPct` is rendered once per team as a colored (green/red) custom SVG `<text>` label positioned **above whichever of the two bars is shorter** (`diffLabelFor(barKey)` in `AchievementSection` compares `payload.avgActual`/`payload.forecast` and only the bar matching the lower value draws the label) — plain CSS `style.fill` can't vary per-row, hence the custom `content` renderer on `<LabelList>` rather than a `formatter`.
  - **Monthly Avg** (single bar chart) — `GET /dashboard/monthly-avg-by-year` (`getMonthlyAvgByYear`). Company-wide (not per-team/agency): for every calendar year with any schedule data, `avgMillions` = that year's total spend ÷ `monthsWithData` (the count of distinct months with data that year — NOT 12), so a partial year (e.g. only January logged) still shows a meaningful average instead of being diluted. Returns `{ years: [{year, avgMillions, monthsWithData}] }`, one bar per year, colored via `TEAM_COLORS`.
  - All three respect the MANAGER agency-scoping convention (`agencyIdsForUser`) like every other `/dashboard/*` endpoint, and are `SUPER_ADMIN`/`MANAGER`-gated.

### Deep Dashboard (`/deep-dashboard`)
- One call `/analytics/deep-dashboard` (agency/client/channel filters). KPIs; **Multi-Year Monthly Spend Trend** (one Line per year + Brush); **Client Investment Contribution** bars; **All Clients** / **All Channels** ranked full-list cards (every client/channel with spend under the active filters, sorted desc, click-through to `/clients/:id/dashboard` (Client Dashboard — the client analytics/intelligence view) and `/channel-masters/:id` (Channel Intelligence) respectively — replaced the old "Channel Performance Insights"/"Client Investment History" metric tiles); **Property Performance** sortable table incl. a computed **Bonus Yield %** (bonus ÷ value) column, Excel + PDF export. `clientDistribution`/`channelDistribution` in the API response carry `clientId`/`channelMasterId` alongside name + value for the ranked-list links.

### Spend Analytics (`/spend-analytics`)
- **Access is now SUPER_ADMIN, MANAGER, GROUP_HEAD, PLANNER** (was admin/manager only). `getAnalytics` (`database.controller.js`) scopes the `ScheduleLog` `where` by role: MANAGER → their agencies (`UserAgencyAccess`), GROUP_HEAD/PLANNER → `getAccessibleClientIds(user.id, role)` (`where.clientId in [...]`, a passed `clientId` is access-checked), SUPER_ADMIN → unrestricted. So a group head/planner sees only their own accounts across every chart. Same roles added to the `/spend-analytics` route (`App.jsx`), the sidebar nav (`Layout.jsx`), and — for the click-through targets — the Channel Intelligence route/endpoints and the `/analytics/client/:id/overview` endpoint (PLANNER added). Channel Intelligence stays cross-client (channel-level market intel), so a group head/planner opening it sees every client on that channel, not just their own.
- One call `/database/analytics` (filters: agency, client, monthFrom/To). Returns `totalValue`, `totalWithVat`, and arrays `byMonth`, `byMedium`, `byMediaGroup`, `byChannel` (now carries `channelMasterId`), `byClient` (now carries `clientId`), `byBrand`, `byAgency`, plus derived `byMonthMedium`, `brandTrend`+`brandTrendKeys`, `clientTenure`, `clientFlighting`+`flightingMonths`.
- **Spend by Channel / Spend by Client** are two ranked **clickable** lists (replaced the old Top-15 bar chart): a channel row → **Channel Intelligence** (`/channel-masters/:channelMasterId`, disabled when the channel has no master id), a client row → **Client Dashboard** (`/clients/:clientId/dashboard`). Each row shows a value + %-of-max mini bar; the channel list still honours the Medium donut cross-filter.
- **Deals & Properties** table (below the ranked lists) lists the scoped clients' `Property` rows via `GET /database/properties` (`getScopedProperties`, same role-scoping as `getAnalytics`): Client · Channel · Medium · Property · Type · Cost (`0` = "Added value") · Bonus (% or value) · Period (start–end, "ongoing" when no end). Each row → that client's channel page (`/channels/:channelId`).
- Charts: 5 summary tiles; **Monthly Trend** (Composed bars + VAT area + Brush); **Cumulative Spend** Line; **Spend by Agency** bars; **Medium Mix Shift** (100% stacked area, TV/Radio/Print); **Brand Spend Trend** (multi-line, top 6); **Client Tenure & Value** bubble (Scatter, size = avg/month); **Agency Efficiency** bars (spend per entry); **Flighting Calendar** (client×month active grid); Medium/Media-Group **donuts**; **Spend by Channel** bars; **Top Clients** bars; grouped breakdown table (with %-of-total bars, collapsed to media-group rows by default — click a row's expand arrow to reveal its channel rows); client/brand tables.
- **Cross-filter:** click a slice in the Medium donut → filters the Channel chart + breakdown table.
- **Comparison mode:** "Compare" toggle reveals Period B date range → side-by-side totals, delta %, by-medium grouped bars.
- Excel (SheetJS, sheet per group) + PDF (jsPDF, charts via html2canvas) export.

### Channel Intelligence (`/channel-masters/:id`)
- Six endpoints keyed by channel master id: `/summary` (incl. a per-year `byYear[]` breakdown → one spend card per year), `/monthly-spend`, `/month-detail`, `/clients`, `/agency-monthly`, `/property-history`.
- Stat cards (compact, page-scoped sizing — NOT the global 33px `.stat-val`); **Monthly Spend Trend** — one Line per year plotted against a fixed Jan-Dec X axis (`/monthly-spend` pivots `scheduleMonth` into `{ years: [...], data: [{ monthNum, label, [year]: value, ... }] }`); clicking a year's dot opens a drill-down modal (`getChannelMonthDetail` / `/month-detail?year=&month=`) listing every `ScheduleLog` behind that point, grouped by client (expand a client row for its individual RO/brand/value rows) so a spend spike can be traced back to exactly which client and schedule made it up; **Spend by Agency Over Time** multi-line (`/agency-monthly`); **Client Spend Concentration** Pareto (ComposedChart: per-client spend bars + cumulative-% line + 80% reference line, built client-side from `/clients`); **Clients on this Channel** table; **Property History Timeline** (vertical timeline of deal terms + the real `PropertyHistory` audit-trail diffs). `getChannelPropertyHistory` also matches free-text client channels by name/alias when `channelMasterId` is null.

### Database (`/database`)
- When a client is selected, an overview strip + monthly mini bar chart from `/database/analytics?agencyId&clientId`. Plus the spreadsheet editor and bulk import (below).

## Data Ingestion / Bulk Import

- **Per-client paste/upload** (DatabasePage): SheetJS parse, column auto-map, preview into the grid, save via `POST /api/database/bulk` (pre-resolved client/channel IDs).
- **Bulk import — all clients** (SUPER_ADMIN): one file for every client via `POST /api/database/import-all`. Columns (matched by name, order-independent): **Year, RO, Sch: Month, Client, Brand, Medium, Media Group, Channel, Schedule Value** (no Agency column needed). Resolves client by name across agencies; resolves channel by name/alias; combines the separate **Year** column with a month *name* ("Jan") into `YYYY-MM`; derives medium/mediaGroup from the channel master; computes VAT (18%); optionally creates missing clients; inserts in chunks of 1000 (≤60k rows). Express JSON body limit raised to 50mb. Per-row errors are reported, not fatal. The whole import is one `UploadBatch` (deletable in one go).

## Design System

Custom CSS variables in `web/src/index.css`:

### Colors
- **Navy palette:** `--navy-950` (#0A1729) through `--navy-100` (primary backgrounds, sidebar)
- **Coral accent:** `--coral-700` (#C44A18) through `--coral-50` (buttons, active states)
- **Neutrals:** `--bg` (#F5F6F8), `--card` (#FFFFFF), `--border` (#E5E8ED)
- **Text:** `--ink` (#16243C), `--ink-soft` (#3B4A63), `--muted` (#6B7790)
- **Status:** green (success), amber (warning), blue (info), purple (admin), red (error)

### Typography
- **UI font:** Hanken Grotesk (sans-serif)
- **Mono font:** Spline Sans Mono (numbers, currency values)

### Layout
- Sidebar width: 244px
- Topbar height: 64px
- Border radius: 6px (sm), 9px (md), 14px (lg), 20px (xl)

### Key CSS Classes
- `.btn-primary` (coral), `.btn-ghost` (white border), `.btn-navy`, `.btn-subtle`, `.btn-sm`, `.btn-lg`
- `.card`, `.stat`, `.summary-grid` (3-column stats)
- `.tbl`, `.tbl-wrap` (tables with sticky headers)
- `.badge`, `.medium-tag` (TV/Radio/Print), `.role-badge`
- `.modal-scrim`, `.modal`, `.panel` (slide-in right panel)
- `.field`, `.input`, `.select`, `.chips` (form controls)
- `.timeline`, `.tl-item` (property history)
- `.feed`, `.feed-item` (activity feed)

## Key Components

| Component | File | Purpose |
|---|---|---|
| Icon | `web/src/components/Icon.jsx` | 43+ SVG icons via PATHS object. Also exports Avatar, TypeBadge, RoleBadge, fmtLKR |
| Layout | `web/src/components/Layout.jsx` | App shell: sidebar nav, topbar with breadcrumbs/search/notifications/user info |
| ProtectedRoute | `web/src/components/ProtectedRoute.jsx` | Auth guard + role check, redirects to /login or / |
| AuthContext | `web/src/contexts/AuthContext.jsx` | Provides user, token, login(), logout(), refreshToken(), changePassword() |
| api | `web/src/lib/api.js` | Axios instance: base `/api`, Bearer token interceptor, 401 auto-refresh |
| OrbitLoader | `web/src/components/OrbitLoader.jsx` | Branded animated loader (coral planet orbiting a navy core). Used for EVERY loading state app-wide incl. `ProtectedRoute` init. Props: `size`, `label`, `fullHeight` |
| RecentUploads | `web/src/components/RecentUploads.jsx` | Recent upload batches list (used on Database empty state) |

## Property Types

- `BOUGHT_AIRTIME` -- paid airtime slot
- `SPONSORSHIP` -- channel sponsorship
- `BONUS_COMMERCIAL` -- bonus/added-value airtime
- `OTHER` -- miscellaneous

Cost of `0` displays as "Added value" in the UI.

## Formatting Conventions

- **Currency:** `fmtLKR(value)` -> "LKR 1,234,567" (rounded, no decimals)
- **Short currency:** `fmtShort(value)` -> "1.2M" or "567K"
- **Schedule values in Database:** 2 decimal places with comma separators (e.g., "674,253.66")
- **Month display:** `fmtMonth("2025-03")` -> "Mar 2025"
- **Percentages:** 1 decimal place (e.g., "45.3%")

## PDF Export Notes

- Uses `jspdf` + `jspdf-autotable` (function-call style: `autoTable(pdf, {...})`, NOT `pdf.autoTable()`)
- Charts rendered via `html2canvas` then placed as images with aspect ratio preserved
- Pie charts capped at 65% page width to prevent stretching
- `addChart` helper calculates ratio from canvas dimensions, scales proportionally, centers on page
- Grouped Media Group -> Channel tables use `didParseCell` hook for bold group row styling

## Upload System

- Excel uploads parsed with SheetJS (xlsx) on the client
- Column auto-mapping by header keywords (RO number excludes "group"/"media" to avoid matching "media group")
- Values formatted with 2 decimal places
- Each upload creates an UploadBatch record with fileName, totalRows, status
- Individual ScheduleLog rows linked via uploadBatchId
- Users can delete entire batches (soft-delete: sets isDeleted on all linked logs)

## Audit Trail

- **PropertyHistory:** Tracks all property changes with previousValues/newValues JSON
- **ScheduleLogEdit:** Tracks schedule log changes with edit notes
- **Delete tracking:** Soft deletes with deletedById and deletedAt timestamps
- **UploadBatch:** Tracks who uploaded, when, file name, success/fail counts

## Important Patterns

- **Prisma singleton:** `api/src/utils/prisma.js` -- import and use throughout controllers
- **No test suite:** `npm test` is a placeholder, no tests configured
- **No CI/CD pipelines:** Deployment is Railway auto-deploy on git push
- **Seed on every start:** `npm run start` runs `prisma db push` + `seed.js` before starting server
- **Frontend proxy:** Vite dev server proxies `/api` to `localhost:3001`; in production, Express serves both API and static frontend
- **Token storage:** accessToken, refreshToken, and user JSON stored in localStorage
- **Notification polling:** Layout component fetches notifications every 60 seconds

## Media Packages (in-app flow)

A SUPER_ADMIN builds a package (name, **per-channel line items** = channel name + rate, optional **proposal deadline**, optional email intro) and **sends** it to GROUP_HEADs. Sending does **not** create a public token link — instead each recipient gets:
- an **email** (Apps Script) linking to `/my-packages` (login required), and
- an **in-app notification**.

**Recent changes:** the package form dropped the Category field and renamed line items to **Channels** (channel name + rate, "Add channel"); a **proposal deadline** was added — past it the package auto-deactivates and stops accepting responses (lazy `deactivateExpiredPackages`, no cron), and expired packages stay listed with an **Expired** badge. The admin PackagesPage list has a **search box + status filter** (All/Active/Expired/Inactive) to stay manageable with many proposals. Team heads respond by **multi-selecting their own clients** (`interestedClientIds`, validated against `getAccessibleClientIds`) instead of a free-text client — `listMyPackages` returns `myClients` for the picker and the admin Responses view shows the resolved names. **Emails now send with sender name "Shehan Kavishka"** (`FROM_NAME` in `appscript/Code.gs`) and the redundant "copy this link" fallback under CTA buttons was removed (package + reset templates) — *`Code.gs` changes require a manual redeploy in the Apps Script project to take effect*.

GROUP_HEADs open `/my-packages`, review the package, and reply **Interested / Open to negotiate / Not interested** with optional client, budget note, and notes. The admin sees every reply (and follow-up status) on the Packages → Responses view, and gets a notification per response. `PackageRecipient.tokenHash`/`expiresAt` are nullable legacy columns from the old token flow.

## Media Buying (channel negotiation intelligence, SUPER_ADMIN only)

`/media-buying` lets a SUPER_ADMIN track negotiated **discount %** (off rate card) and **bonus %** (free added-value airtime/space) per channel, both at the **agency level** and **per client**, year over year — distinct from `Property.bonusPct` (which is a deal-instance field on a specific client's channel, not a tracked negotiation term).

- **Schema:** `ChannelAgencyDeal` (`channelMasterId, year` unique) and `ChannelClientDeal` (`channelMasterId, clientId, year` unique). Saving the same year **updates** that row (typo-fix); saving a **new** year always inserts a new row — history is preserved structurally via the unique constraint + upsert-by-year, with no separate audit table (a v1 simplification; `PropertyHistory`-style change tracking could be added later if needed).
- **No page-level year filter** — the whole view is all-time. Channel selection uses a custom searchable combobox (type-ahead, grouped by medium) instead of a native `<select>` — fed by `GET /masterdata/channel-masters` (already active-only by default server-side) and additionally filtered client-side (`c.isActive !== false`) as a defensive guard against ever surfacing a deactivated/merged-away channel.
- **Channel Intelligence view** (`getChannelIntelligence`): pick a channel → **Agency-Level Deal Block** (full year history, color-coded trend arrow ▲/▼/→ comparing combined discount+bonus vs the prior year) + an all-time **Client Breakdown Table** (lifetime `totalSpend` per client from `ScheduleLog`, plus that client's most-recently-recorded `ChannelClientDeal` — `discountPct`/`bonusPct`/`dealYear` — which may be from an earlier year than their last actual purchase). Expanding a client row lazy-fetches `getClientChannelYearly`, which shows **spend + Avg Monthly Spend (spend ÷ 12) + discount % + bonus % per year** (one row per year that has either spend or a recorded deal).
- **Negotiation Planner** (`getNegotiationPlanner`, slide-in `.panel-wide` panel via "Plan New Client", no Deal Year input): given a proposed monthly budget, computes `projectedYearlySpend` and buckets it into a **Low/Mid/High spend tier** via live terciles (33rd/66th percentile) of each existing client's `avgYearlySpend` — the average of that client's `ScheduleLog` spend across **every year** they have data on this channel (not a single selected year). For each client, `avgDiscountPct`/`avgBonusPct` are also averaged across those same years, treating any year with no recorded `ChannelClientDeal` as **0%** (a deliberate choice — undercuts rather than ignores years where no deal was struck). Returns `suggestedDiscountRange`/`suggestedBonusRange` (min/max of `avgDiscountPct`/`avgBonusPct` among same-tier clients), the list of comparable clients with their averages and `yearsOfData`, and the agency deal reference (simply the most recent year with any agency deal recorded). Also returns broader decision-support context used by the panel's "Channel Context" card and export: `totalClientsOnChannel`, `tierCounts` (Low/Mid/High client counts), `overallAvgDiscountPct`/`overallAvgBonusPct` (averaged across **all** clients on the channel, not just the same tier), `highestYearlySpend` (largest existing client's avg yearly spend, a ceiling reference), and `budgetPercentileRank` (% of existing clients the proposed yearly spend exceeds). The panel also shows an estimated effective monthly cost / bonus value computed client-side from the midpoint of the suggested discount/bonus range.
- **Entry points:** "Add/Edit Deal" on the agency block, an "Edit" button per client row, and a standalone "+ Add Deal" button near the channel selector with **both** Channel and Client as dropdowns (covers ad-hoc/bulk entry without navigating into a specific channel's view — kept inside this page rather than scattered into Admin/Database, a deliberate v1 simplification). **All three of those routes are SUPER_ADMIN-only** (`/api/media-buying/*`, see `mediabuying.routes.js`).
- **A fourth, non-admin entry point** lives on `ChannelDetailPage.jsx` (`/channels/:channelId` — the client-specific channel view reached via Client → channel card, the same place "Add property" already lives): an "Add deal" button + a **Deal terms** table list the `ChannelClientDeal` rows for that specific client+channel, with Edit/Delete actions. This is **not** SUPER_ADMIN-gated — it follows the exact same role/access rules as Property (`PLANNER`/`GROUP_HEAD`/`SUPER_ADMIN` can add/edit, `SUPER_ADMIN`/`GROUP_HEAD` can delete, enforced by `checkChannelAccess`/`checkChannelClientDealAccess` — same client-access middleware Property uses), so a PLANNER can record their own client's negotiated terms without needing SUPER_ADMIN. Backed by `channel.controller.js`'s `listChannelDeals`/`upsertChannelDeal`/`updateChannelDeal`/`deleteChannelDeal`, mounted on `channel.routes.js` (`GET/POST /api/channels/:channelId/deals`, `PUT/DELETE /api/channels/deals/:id`) — deliberately separate from `mediabuying.routes.js` rather than reusing its SUPER_ADMIN-only `upsertClientDeal`/`deleteClientDeal`. `checkChannelClientDealAccess` (`middleware/access.js`) resolves the deal's `clientId` first (the id-only route has no clientId in the URL) then delegates to `checkClientAccess`. If `Channel.channelMasterId` is null (a client channel never linked to a canonical `ChannelMaster`), the "Add deal" button is disabled with an explanatory tooltip, since `ChannelClientDeal` requires a `channelMasterId`.
- **Export:** SheetJS workbooks use a lakh-grouped currency string formatter (`fmtLKRFull`, e.g. `"LKR 5,00,000.00"` — groups of 2 digits after the leading 3, the Indian/Sri Lankan convention) for every LKR cell, distinct from the abbreviated on-screen `fmtLKR()` ("5.26M"). The channel export workbook has a **Summary** sheet (channel/medium, client count, total lifetime spend, latest agency deal, export timestamp), an **Agency Deal History** sheet, and a **Client Breakdown** sheet with **one row per client per year** (fetched via `getClientChannelYearly` for every client, including an Avg Monthly Spend column) — not a single summary row, so the full multi-year spend/discount/bonus history exports in one place. The Negotiation Planner's own export ("Negotiation Plan" workbook) mirrors everything shown in the panel: budget/tier/percentile, channel context (tier counts, overall averages, largest client), suggested ranges plus the midpoint-estimated effective cost/bonus value, the agency deal reference, and the full comparable-clients table.
- Nav entry only renders for `SUPER_ADMIN` (`Layout.jsx` `NAV_ADMIN`); route guarded by `requiredRoles={['SUPER_ADMIN']}`; all `/api/media-buying/*` endpoints require `SUPER_ADMIN`.

## Property & Rate-History Export

Properties carry negotiated deal terms whose **cost changes over time** are tracked in `PropertyHistory`. `GET /api/reports/properties` builds a chronological **rate timeline** per property (original rate at creation + every cost change with date, delta, note, who) and exports:
- **Excel:** per-group sheets (current deals) + a dedicated **Rate History** sheet logging the rate at every point in time.
- **PDF:** branded (`generatePropertyHistoryPdf` in export.service.js), grouped, each property showing current deal + a rate-history timeline.
Group/filter by canonical **channel master** (spans agencies), agency, client, or all.

## UI Redesign (Ogilvy Orbit)

- **Login** (`LoginPage.jsx`): deep-cosmic "mission control" — fixed full-screen navy starfield (drifting/twinkling stars, shooting stars), coral-lit planet, mouse parallax, orbit "O" brand mark, glass sign-in card. Scroll-safe with hidden scrollbar.
- **App shell** (`.app` in index.css): locked to `height:100vh; overflow:hidden` so only the content area scrolls (no window scrollbar). Sidebar uses the animated orbit logo mark.
- **Mobile / responsive** (media queries at the end of `index.css`): below **860px** the fixed sidebar becomes an off-canvas **drawer** — `Layout.jsx` holds a `navOpen` state, a `.menu-btn` hamburger in the topbar opens it, a `.sidebar-scrim` overlay closes it, and `go()` closes it on navigation; the topbar search is hidden and `.app` switches to `100dvh`. Below **560px** the breadcrumb and the topbar username block (`.topbar-user-meta`) are hidden and the stat grid drops to 2-up. Charts reflow automatically because every Recharts chart is wrapped in `ResponsiveContainer` inside grids that use `repeat(auto-fit, minmax(...))`; wide tables scroll horizontally (`.tbl-wrap{overflow-x:auto}`, and the Forecasting Insights `Card` wraps its body in an `overflow-x:auto` div since those tables aren't in `.tbl-wrap`).
- **Dashboard / content pages:** light, card-based design system (white cards `#fff`/`#E5E8ED`/14px radius, navy+coral, Spline Sans Mono figures, uppercase table heads, trend chips). Dashboard wires real analytics; pages restyled to match.
- **Apps Script emails** (`appscript/Code.gs`): branded with the Ogilvy Orbit lockup via shared header/footer/CTA/callout helpers. **Editing `Code.gs` in the repo does not update the live service** — it must be redeployed in the Google Apps Script project.

## Known Gaps / Suggested Features

> Candidate work, not yet implemented:

- **Global topbar search is non-functional** — the search input in `Layout.jsx` is decorative (no handler/results). Either wire it to a search endpoint or remove it.
- **Two schedule-log surfaces:** `/api/database/*` (used by DatabasePage spreadsheet) and `/api/schedule-logs/*` (client-scoped CRUD). Overlapping; consider consolidating.
- **Campaign model** has controller/routes (`brand.controller.js`) but little/no UI surface.
- **No automated tests or CI** (`npm test` is a placeholder).
- **Decision Center was removed** (nav, route, page, and `/api/decisions` backend) — do not re-add references.
- **Annotation layer & empty-state ghost charts** were proposed but not built.

### Recently implemented (do NOT re-report as gaps)

- **Team heads:** `Team.headUserId` (nullable, → a GROUP_HEAD user). Admin → Teams modal has a "Team Head" picker; assigning a client to a team via the existing client-chips picker moves it off any other team (`setTeamClients` in `admin.controller.js`), enforcing one team (and therefore one head) per client. Executive Dashboard's **Group Contribution** donuts (under Monthly Spend) show each team's client-portfolio spend share for the latest two data months, labeled with the team head's name (`/api/analytics/dashboard/group-contribution`) — alongside it, **Group Contribution — Average vs Latest Month** (`/api/analytics/dashboard/group-contribution-variance`) and the company-wide **Monthly Avg** by year (`/api/analytics/dashboard/monthly-avg-by-year`); see "Executive Dashboard" above for full computation semantics.
- **Forecasting & targets:** `AnnualTarget` (year, target millions, remoteMonth) + `MonthlyForecast` (year/month/client/channel/amountMillions) models; `Client.isActive`, `ChannelMaster.sortOrder`, `Notification.link` added. Executive Dashboard leads with an **Annual Achievement** horizontal bar (budget vs upto-month target vs actual+remote-month forecast, % badge) and a **Monthly Spend** line (remote month = forecast, orange dot) via `/api/analytics/dashboard/achievement` + `/forecast-monthly` (actuals ÷1e6 → millions). **Forecasting tab** (`/forecasting`, SUPER_ADMIN/GROUP_HEAD only — MANAGER has no access, since their only role here was the read-only history/variance views, now restricted to SUPER_ADMIN): group heads enter the upcoming month's per-channel allocations per accessible+active client (`/api/forecasting/*`); admins get full read/override access. The Clients view has an **"Export"** control (**SUPER_ADMIN only**: its own month dropdown — the upcoming month or any of the prior 12 — plus a button) that downloads the entered forecasts client-wise to Excel: a **By Client** summary sheet + a **Detail** sheet (client × channel × amount in full LKR + notes), via `GET /forecasting/export-entries?year=&month=` (`exportForecastEntries`, `SUPER_ADMIN` only, scoped by `accessibleClientIds` = all, any month allowed since it's read-only). Independent of the entry-month lock so any past month can be exported. **The forecast client roster (`listForecastClients`) and the Insights "Client-wise Forecast" roster (`getInsightsSummary`) only list clients assigned to a group head** — defined by the exported `GROUP_HEAD_CLIENT_OR` array in `forecasting.controller.js`, spread into the Client `where` as an `OR` so a client shows if it's linked to a group head through **any admin assignment path**: (1) on a `Team` with `headUserId` set, (2) on a `Team` with a `GROUP_HEAD` member, or (3) directly assigned to a `GROUP_HEAD` user via `UserClientAccess` (the Users-tab client chips). Branches 1–2 cover the Teams tab / "Assign Accounts to Heads" card; branch 2 also guarantees a GROUP_HEAD always sees their own team's clients even if `headUserId` was never explicitly picked; branch 3 covers admins who assign clients straight to a group-head user. Clients linked to no group head are treated as old/inactive and hidden from forecasting (the data-driven variance/accuracy/trend views are unaffected — they still surface whatever forecast/actual rows exist). including the Forecast vs Actual variance report (`/forecasting/variance`, `/forecasting/history`, both SUPER_ADMIN-only). The "upcoming month" (`nextMonth()` in `forecasting.controller.js`) rolls on the **15th of each month**: the 1st–14th shows the current calendar month for entry (e.g. through May 14th, "upcoming" = May); from the 15th onward it shows next month (May 15th onward → "upcoming" = June) — this is what non-admin roles always see, with no manual control. **SUPER_ADMIN can additionally target any month, not just the upcoming one** — a "Forecast month" dropdown (13 months: the upcoming month back through the prior 12) lets an admin backfill an already-passed month (e.g. enter June's actuals-as-forecast while July is the system's "upcoming" month) so it's available to **"Copy last month"** when later entering the next month. Backed by `resolveTargetMonth(req)` in `forecasting.controller.js`, which lets `?year=&month=` override `nextMonth()` for `listForecastClients`/`getForecastEntry`/`getPreviousForecast` **only when `req.user.role === 'SUPER_ADMIN'`** (group heads stay locked to the upcoming month everywhere); `submitForecast` already allowed SUPER_ADMIN to save any month server-side, this just exposes that in the UI for entry/prefill/copy too. Admin tabs: **Annual Targets**, client **active/hide** toggle, **Client/Channel Requests** (group heads request via `/api/forecasting/request-*`, admin approves under `/api/admin/*-requests`, notifications deep-link via `Notification.link`). Channels reuse `ChannelMaster` (seeded `sortOrder` for the fixed TV/Radio forecasting order); "group" scope reuses `getAccessibleClientIds`. **Entry-form channel grain** (`FULL_LIST_MEDIA` in `forecasting.controller.js`'s `listForecastChannels`): **TV, Radio, Cinema, OOH and Digital list every active `ChannelMaster` of that medium individually** so heads enter a per-channel amount, while **only Print collapses to a single "Print total" bucket row** (`TOTAL_LABEL`). Cinema/OOH/Digital were moved into the full list (from bucket-only) so any individual channel an admin adds in those media is enterable; the seeded `Cinema`/`OOH`/`Print`/`Digital` `TOTAL_BUCKETS` rows stay (and stay reconcile-exempt) so each category always has at least one entry row even before real channels are added.
  - **Annual Achievement forecast-fill:** the `Actual upto [Month]` bar (`getAchievement` in `analytics.controller.js`) is a **stacked bar** of two segments rather than a single actual-only value — real actuals (green, up through the last month with `ScheduleLog` data) plus a **forecast-fill** segment (amber, `#F2A93B`) covering the gap month(s) between the last actual month and the pacing month, sourced from Group Head–submitted `MonthlyForecast` entries (the same source the Monthly Spend line already used for its remote-month dot). For an in-progress year the auto pacing month is capped at the current calendar month, so a forecast already submitted for a *future* month (the Forecasting tab collects the upcoming month, which rolls to next month on the 15th) never extends the bar past "this month". On the 1st of a new month this is a hard cutover with no code needed: once real `ScheduleLog` rows land for a month, `monthValue()` prefers them over the forecast automatically, so the forecast-fill segment for that month simply disappears next render — no gradual blending. New `getAchievement` response fields: `actualOnlyMillions`/`forecastFillMillions` (the two stacked segments — `actualMillions` still returns their sum, unchanged, so `achievementPct` continues to include the forecast-fill in its numerator), `forecastFillMonths`/`forecastFillLabel`/`actualRangeLabel` (for the tooltip breakdown), and a completeness check — `forecastFillSubmittedClients` = the distinct clients whose forecasts actually make up the forecast-fill total (every forecast in scope for the gap month(s), so the count can never contradict the money shown), and `forecastFillExpectedClients` = that submitter set UNIONed with the tracked roster (active clients assigned to a group head, via `GROUP_HEAD_CLIENT_OR`) so roster clients that haven't forecasted yet still surface. Clients who haven't submitted are excluded from the total (not zero-filled), and `forecastFillComplete: false` (submitted < expected) drives a ⚠ warning chip under the chart. Scoped only to this bar — the Monthly Spend line, YTD stat cards, and every other chart remain actual-only/unchanged.
  - **Forecasting Insights** (SUPER_ADMIN-only analytics suite, lives *inside* the `/forecasting` page — the admin view toggle is now **Clients | Insights**, no new nav item/route). Backed by `forecastInsights.controller.js` + `forecastInsights.routes.js` (mounted at the same `/api/forecasting` base path as `forecasting.routes.js`, every route `requireRole('SUPER_ADMIN')` — stricter than the entry endpoints' `SUPER_ADMIN, GROUP_HEAD`). A shared `resolveInsightFilters(req)` parses `?year&month&agencyId&clientId&medium&channelMasterId&headUserId` into Prisma where-fragments (forecast from `MonthlyForecast`, actual from `ScheduleLog` scoped `isDeleted: false` — "aired/completed" needs no separate status field, that's the existing convention). Four endpoints feed a cross-cutting filter bar (Year/Month/Agency/Client/Medium/Channel/Account Manager — the **Account Manager dropdown lists `GROUP_HEAD` users** from `/admin/users`, filter param `headUserId`; `resolveInsightFilters`'s `clientsForHead(headUserId)` resolves that group head's managed clients via `getAccessibleClientIds(id, 'GROUP_HEAD')` — team membership + direct `UserClientAccess` — plus any team they head via `Team.headUserId`) + four sub-tabs: **`GET /insights/summary`** (`getInsightsSummary`, §1) — per-client total forecast + Submitted/Pending status, and a medium-level breakdown (TV/Radio/Print/Digital/Cinema/OOH totals + % of total) for the resolved month. **Both the client table and the medium breakdown are scoped to the same group-head roster** (active clients matching `GROUP_HEAD_CLIENT_OR`): the medium breakdown restricts its `MonthlyForecast` group-by to those clients' ids so its total always matches the client-wise total, instead of being inflated by forecasts from off-roster / old / inactive clients (the variance/accuracy/trend endpoints stay unrestricted by design — they surface whatever forecast/actual rows exist); **`GET /insights/variance?groupBy=client|channel`** (`getInsightsVariance`, §2+§3) — forecast-vs-actual at client grain or individual-`ChannelMaster` grain (TV/Radio/Cinema/OOH/Digital per-channel, Print as its single bucket row), `variance = actual − forecast`, `variancePct = variance/forecast*100` (null/"—" when forecast 0), flagged positive/negative/zero; **`GET /insights/accuracy`** (`getInsightsAccuracy`, §4) — totals + `forecastAccuracyPct = (1 − |variance|/forecast)*100` clamped 0–100, plus Best/Least-accurate forecasting client (by per-client accuracy, forecast > 0) and Highest-spending client; **`GET /insights/trend?months=12`** (`getInsightsTrend`, §5+§6) — month-by-month forecast/actual/variance/`growthPct` (actual vs prior month) walking back from the resolved month, plus top-10 channels & top-10 clients by actual spend over that range. Frontend (`ForecastingPage.jsx`, self-contained `InsightsTab` sub-component) renders sortable/searchable tables, accuracy stat cards, and Recharts (ComposedChart forecast-bars+actual-line, variance line, medium-split pie reusing `summary.channelBreakdown`, top-channels/clients bars), each sub-tab with **Excel/CSV/PDF export** (SheetJS multi-sheet workbooks; CSV via `XLSX.write(wb,{bookType:'csv'})` → Blob stacking all sheets; PDF via `jsPDF`+`autoTable(pdf,{...})` + `html2canvas` for the Trends charts) carrying the applied filters + totals. **Two clarified semantics (binding):** the **"Account Manager" filter = a `GROUP_HEAD` user** (the dropdown lists group heads; selecting one scopes to every client that group head manages — team membership, headed teams, or direct `UserClientAccess` — NOT `MonthlyForecast.submittedById`). The per-row **`accountManager` column** shows the managing group head's name, resolved by `accountManagerByClient` through the same paths as `GROUP_HEAD_CLIENT_OR` (team head `Team.headUserId`, else a `GROUP_HEAD` team member, else a directly-assigned `GROUP_HEAD` via `UserClientAccess`; "Unassigned" only when truly none) — so a client never shows "Unassigned" while a group head actually manages it; and "Highest Spending Client" / "Highest Revenue Client" collapse into **one** card (highest actual spend in the filtered period) since the app tracks no separate revenue/margin concept. The old single-month `getVariance`/`/variance` endpoint is left intact (no longer called by the UI) rather than deleted.
  - **Overall Budget tab** (`/forecasting`, a third top-level view toggle: **Clients | Overall Budget | Insights** — Overall Budget is visible to **GROUP_HEAD + SUPER_ADMIN**, unlike Insights which is admin-only). A per-client worksheet for the resolved month (same 15th-rollover `nextMonth()`/`resolveTargetMonth` rules as forecast entry — group heads locked to the upcoming month, SUPER_ADMIN can target any month) matching the client's reference sheet: **Client · Actual · Best · Commission · Billing (Last Month schedules)**. **Actual** is NOT stored — it's derived live from that client's `MonthlyForecast` total for the month (×1e6 → full LKR). **Best** and **Billing (last month)** are group-head-entered (inline number inputs, auto-saved on blur), stored full-LKR in the new `MonthlyBudget` model (`@@unique([year, month, clientId])`, `bestAmount`/`billingLastMonth` nullable Decimals; clearing both deletes the row). **Commission** is per-client agency remuneration from Admin → Clients: new `Client.commissionType` (`CommissionType` enum `COMMISSION`|`AOR`) + `Client.commissionValue` (Decimal) — COMMISSION renders as "4%", AOR as "LKR 50,000.00"; the Admin client Add/Edit modal has a type dropdown + value input (`PUT /admin/clients/:id/commission` → `setClientCommission`; empty type clears both; commission % capped at 100). Backed by `GET/POST /api/forecasting/budget` (`listBudget`/`submitBudget` in `forecasting.controller.js`, reusing the same `GROUP_HEAD_CLIENT_OR` roster + `accessibleClientIds` scoping as the entry grid, so a group head sees only their clients). The table has a live totals row (Actual/Best/Billing) and an Excel **Export** (SheetJS, mirrors the on-screen worksheet). `listAdminClients` + `listAgencies` now also select `commissionType`/`commissionValue` so the Admin Clients tab can show/seed them. **Insights counterpart:** the Forecasting **Insights** tab has a fifth **Overall Budget** sub-tab (SUPER_ADMIN-only, alongside Summary/Forecast-vs-Actual/Accuracy/Trends) backed by `GET /api/forecasting/insights/budget` (`getInsightsBudget` in `forecastInsights.controller.js`, driven by the Insights Year/Month + agency/client/account-manager filters, roster-scoped like the Summary so it refreshes live as group heads update forecasts/budgets). It renders two read-only tables in full LKR: **(1) by Account Manager** — one row per group head with Actual (their roster clients' total forecast = `MonthlyForecast` millions ×1e6), Best, and Billing-last-month (summed from `MonthlyBudget`), + totals; and **(2) Forecast by Channel** — total forecast per `ChannelMaster` (medium/channel filters apply here only, since Best/Billing aren't channel-scoped), + total. No commission column (per spec). Excel/CSV/PDF export via the shared `budgetSheets()`.

- **Profit tab** (`/profit`, **SUPER_ADMIN only**, finance screen): agency profit on **confirmed actual spend only** (`ScheduleLog` — forecasts live in the separate `MonthlyForecast` table and never enter profit). Commission is **snapshotted at entry** on each `ScheduleLog`: new columns `commissionTypeAtEntry` (`COMMISSION`|`AOR`|null), `commissionRateAtEntry` (Decimal — the % for COMMISSION, the fixed LKR fee for AOR), `commissionBackfilled` (bool). The snapshot is written at every insert path (`createScheduleLog` single, `bulkCreateScheduleLogs`, `importAllScheduleLogs`, `schedulelog.controller.js` create) via `commissionSnapshot(client)` (`utils/commission.js`) and is **immutable** — no update path writes these fields. `seed.js` runs an idempotent **backfill** on every deploy: fills the snapshot on historical rows from the client's *current* commission (only for clients that have one) and flags them `commissionBackfilled = true`; a genuine at-entry snapshot (`commissionBackfilled = false`, type non-null) is never re-touched. **Setting/updating a client's commission in Admin (`setClientCommission`) applies it to existing `ScheduleLog` rows per a `scope` param** so the Profit tab reflects it without waiting for a deploy: when the admin changes an existing client's commission, the client Add/Edit save flow (`AdminPage.jsx`) pops a **"Apply commission to records?"** choice — **`all`** rewrites every row for the client (snapshotted ones too — for correcting a mistyped rate) or **`forward`** touches nothing (only rows uploaded from now on snapshot the new rate). Absent a scope (new client / cleared / unchanged) the default fills only un-snapshotted or previously-backfilled rows, leaving genuine at-entry snapshots frozen. **Calculation (binding):** Revenue = `scheduleValue` (ex-VAT); buckets/filter are by **schedule (flight) month** (`scheduleMonth`) within a selected **year** (Jan–Dec) — a month with no uploaded rows shows 0, never fabricated. The aggregation atom is `(client, schedule-month, type, snapshotted rate/fee)` — COMMISSION profit = `ROUND(SUM(scheduleValue) × rate/100, 2)`; **AOR profit = the fixed fee counted once per client-month** (per client's choice); no-commission spend still counts as Revenue with **0 profit** (so Total Revenue = all client-side spend). `getProfitSummary` also returns `availableYears` (distinct years with schedule data + current year) for the year picker. Every aggregate SUMs these atoms, so parts reconcile to the whole exactly at client/agency/month/total (unit-tested). All aggregation is SQL (`profit.controller.js` via `prisma.$queryRaw`, `Prisma.sql` fragments); the pure JS mirror + reconciliation/immutability/role tests live in `services/profit.service.js` + `tests/` (`npm test` → `node --test`; the reconciliation test runs without a DB). Endpoints: `GET /api/profit/{summary,monthly,by-agency,by-client,details}` (all `SUPER_ADMIN`). Frontend `ProfitPage.jsx` (route + `NAV_ADMIN` both `SUPER_ADMIN`-only): date-range + agency + multi-client filters, 3 cards, Monthly Profit Trend bar, Profit by Agency bar, Profit by Client ranked table, sortable/paginated detail table (Client · Agency · Revenue · Commission at entry · Profit · Month), LKR 2-dp tabular figures.
- **Property dates:** `startDate`/`endDate` (null end = ongoing) on `Property`, editable in the Add/Edit form, shown on the channel table, Deep Dashboard, and property-report exports.
- **Property bonus:** `bonusValue`, `bonusCount`, plus `bonusPct`/`sponsorshipDetails` exist on the model; Deep Dashboard shows a computed **Bonus Yield %**; Channel Intelligence surfaces the `PropertyHistory` audit trail.
- **Dashboard year filter** (replaces the old decorative 30D/QTD/YTD toggle) + **all-time "All"** + latest-month anchoring (`refPeriod`).
- **Bulk multi-client import** (`/api/database/import-all`), **channel/client seed modules**, **OrbitLoader everywhere**, and the **new analytics charts** (medium mix shift, brand trend, tenure bubble, agency efficiency, flighting calendar, velocity gauge, sparklines, cross-filter, comparison mode).
- **Agencies list** returns `totalSpend` + `channelCount` per agency.
- **Auth hardening:** per-IP rate limiting on auth routes (`express-rate-limit`), per-account lockout (`User.failedLogins`/`lockedUntil`, 5 fails → 15 min), and revocable tokens via `User.tokenVersion` (bumped on logout / password change / reset; embedded as `tv` in JWTs and checked in `middleware/auth.js` + refresh). `changePassword` re-issues fresh tokens so the current device stays signed in.
- **Bulk-import dedupe:** `/api/database/bulk` and `/import-all` skip rows already present (key: client+channel+scheduleMonth+value, matched ONLY against existing non-deleted DB rows — brand/RO excluded, within-file repeats kept) and report a `duplicates` count + `duplicateRows` (1-based row numbers); the Database import UI shows "duplicates skipped" and lets the user download the failed/duplicate rows. `/import-all` also supports `dryRun:true` (returns new/duplicate/failed counts without writing — used to pre-check) and `allowDuplicates:true` (insert every row anyway). The bulk-import modal first dry-runs; if duplicates exist it asks the user to **Upload N new only** or **Re-upload everything**.
