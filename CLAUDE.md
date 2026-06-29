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
| Team | Team groupings within agencies. `headUserId` (nullable) names the team's head — a GROUP_HEAD user. Admin (Admin → Teams) enforces a 1-team-per-client invariant: assigning a client to a team detaches it from any other team, so every client has exactly one team and therefore one team head |
| TeamMember | Users assigned to teams (with role) |
| TeamClient | Teams assigned to clients (kept 1:1 per client by the invariant above, even though the table itself is M:N) |

### Channel & Property Models

| Model | Purpose |
|---|---|
| MediaGroup | Grouping of channels (e.g., "Maharaja Group") |
| ChannelMaster | Master registry of all TV/Radio/Print channels with aliases |
| Channel | Client-specific channel records |
| Property | Negotiated deals on channels (cost, bonus%, sponsorship details, startDate, endDate — endDate null means still ongoing) |
| PropertyHistory | Audit trail for property changes (previousValues, newValues JSON) |
| ChannelAgencyDeal | Year-keyed overall agency discount %/bonus % per channel (Media Buying tab) |
| ChannelClientDeal | Year-keyed per-client discount %/bonus % per channel (Media Buying tab) |

### Schedule & Upload Models

| Model | Purpose |
|---|---|
| ScheduleLog | Monthly execution records with scheduleValue, scheduleValueWithVat. `medium`/`mediaGroup` are denormalized strings snapshotted from the channel master at insert time (for fast Spend Analytics aggregation) — `updateChannelMaster` and `mergeChannelMasters` both refresh these on every affected row when a channel's medium/media group changes or two channels are merged, so the Spend Breakdown's Media Group & Channel views stay correct for historical spend too |
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
| MediaPackage | A channel package (name, category, emailIntro, isActive) created by an admin |
| PackageLineItem | A line item within a package (label + rate) |
| PackageRecipient | Per-team-head send record + in-app response (interest, budgetNote, clientName, notes, followUp). `tokenHash`/`expiresAt` are legacy/optional — the flow is now in-app, not token links |

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
DELETE /api/packages/:id                          (AUTH + SUPER_ADMIN)
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
| ChannelDetailPage | `/channels/:channelId` | Channel properties with history timeline |
| ProfilePage | `/profile` | User profile, change password |

### Role-Restricted Pages
| Page | Route | Roles | Purpose |
|---|---|---|---|
| SpendAnalyticsPage | `/spend-analytics` | SUPER_ADMIN, MANAGER | Charts + grouped Media Group/Channel breakdown + Excel/PDF export |
| ExecutiveDashboardPage | `/executive-dashboard` | SUPER_ADMIN, MANAGER | Multi-chart executive overview |
| ChannelIntelligencePage | `/channel-masters/:id` | SUPER_ADMIN, MANAGER, GROUP_HEAD | Per-channel analytics |
| ReportsPage | `/reports` | SUPER_ADMIN, MANAGER | Report generation by channel/client/agency |
| UploadTrackerPage | `/upload-tracker` | SUPER_ADMIN | Monthly upload status tracking, send reminders |
| MediaBuyingPage | `/media-buying` | SUPER_ADMIN | Channel negotiation intelligence — agency/client discount & bonus deal history, year-over-year trend arrows, Negotiation Planner, Excel export |
| AdminPage | `/admin` | SUPER_ADMIN | User, team, agency, client management (tabbed). Channels tab has a per-row "Merge" action (calls `POST /masterdata/channel-masters/merge`) to consolidate duplicate channel masters — moves schedule logs/upload rows + aliases onto the picked target and deactivates the source |
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
- Inside the Annual Achievement section, under **Monthly Spend**: **Group Contribution** — horizontal grouped bars comparing each team's client portfolio spend across the latest two months with any schedule data (`/dashboard/group-contribution`). Each bar group is one `Team` (clients grouped via `TeamClient`, label includes the team's `headUserId` head name); clients not yet assigned to a team roll into "Unassigned". Read-only, no year filter (always the latest two data months).

### Deep Dashboard (`/deep-dashboard`)
- One call `/analytics/deep-dashboard` (agency/client/channel filters). KPIs; **Multi-Year Monthly Spend Trend** (one Line per year + Brush); **Client Investment Contribution** bars; **All Clients** / **All Channels** ranked full-list cards (every client/channel with spend under the active filters, sorted desc, click-through to `/clients/:id` (Client Detail) and `/channel-masters/:id` (Channel Intelligence) respectively — replaced the old "Channel Performance Insights"/"Client Investment History" metric tiles); **Property Performance** sortable table incl. a computed **Bonus Yield %** (bonus ÷ value) column, Excel + PDF export. `clientDistribution`/`channelDistribution` in the API response carry `clientId`/`channelMasterId` alongside name + value for the ranked-list links.

### Spend Analytics (`/spend-analytics`)
- One call `/database/analytics` (filters: agency, client, monthFrom/To). Returns `totalValue`, `totalWithVat`, and arrays `byMonth`, `byMedium`, `byMediaGroup`, `byChannel`, `byClient`, `byBrand`, `byAgency`, plus derived `byMonthMedium`, `brandTrend`+`brandTrendKeys`, `clientTenure`, `clientFlighting`+`flightingMonths`.
- Charts: 5 summary tiles; **Monthly Trend** (Composed bars + VAT area + Brush); **Cumulative Spend** Line; **Spend by Agency** bars; **Medium Mix Shift** (100% stacked area, TV/Radio/Print); **Brand Spend Trend** (multi-line, top 6); **Client Tenure & Value** bubble (Scatter, size = avg/month); **Agency Efficiency** bars (spend per entry); **Flighting Calendar** (client×month active grid); Medium/Media-Group **donuts**; **Spend by Channel** bars; **Top Clients** bars; grouped breakdown table (with %-of-total bars); client/brand tables.
- **Cross-filter:** click a slice in the Medium donut → filters the Channel chart + breakdown table.
- **Comparison mode:** "Compare" toggle reveals Period B date range → side-by-side totals, delta %, by-medium grouped bars.
- Excel (SheetJS, sheet per group) + PDF (jsPDF, charts via html2canvas) export.

### Channel Intelligence (`/channel-masters/:id`)
- Five endpoints keyed by channel master id: `/summary` (incl. a per-year `byYear[]` breakdown → one spend card per year), `/monthly-spend`, `/clients`, `/agency-monthly`, `/property-history`.
- Stat cards (compact, page-scoped sizing — NOT the global 33px `.stat-val`); **Monthly Spend Trend** Line (schedule value vs with-VAT); **Spend by Agency Over Time** multi-line (`/agency-monthly`); **Client Spend Concentration** Pareto (ComposedChart: per-client spend bars + cumulative-% line + 80% reference line, built client-side from `/clients`); **Clients on this Channel** table; **Property History Timeline** (vertical timeline of deal terms + the real `PropertyHistory` audit-trail diffs). `getChannelPropertyHistory` also matches free-text client channels by name/alias when `channelMasterId` is null.

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

A SUPER_ADMIN builds a package (name, category, line items with rates) and **sends** it to GROUP_HEADs. Sending does **not** create a public token link — instead each recipient gets:
- an **email** (Apps Script) linking to `/my-packages` (login required), and
- an **in-app notification**.

GROUP_HEADs open `/my-packages`, review the package, and reply **Interested / Open to negotiate / Not interested** with optional client, budget note, and notes. The admin sees every reply (and follow-up status) on the Packages → Responses view, and gets a notification per response. `PackageRecipient.tokenHash`/`expiresAt` are nullable legacy columns from the old token flow.

## Media Buying (channel negotiation intelligence, SUPER_ADMIN only)

`/media-buying` lets a SUPER_ADMIN track negotiated **discount %** (off rate card) and **bonus %** (free added-value airtime/space) per channel, both at the **agency level** and **per client**, year over year — distinct from `Property.bonusPct` (which is a deal-instance field on a specific client's channel, not a tracked negotiation term).

- **Schema:** `ChannelAgencyDeal` (`channelMasterId, year` unique) and `ChannelClientDeal` (`channelMasterId, clientId, year` unique). Saving the same year **updates** that row (typo-fix); saving a **new** year always inserts a new row — history is preserved structurally via the unique constraint + upsert-by-year, with no separate audit table (a v1 simplification; `PropertyHistory`-style change tracking could be added later if needed).
- **No page-level year filter** — the whole view is all-time. Channel selection uses a custom searchable combobox (type-ahead, grouped by medium) instead of a native `<select>`.
- **Channel Intelligence view** (`getChannelIntelligence`): pick a channel → **Agency-Level Deal Block** (full year history, color-coded trend arrow ▲/▼/→ comparing combined discount+bonus vs the prior year) + an all-time **Client Breakdown Table** (lifetime `totalSpend` per client from `ScheduleLog`, plus that client's most-recently-recorded `ChannelClientDeal` — `discountPct`/`bonusPct`/`dealYear` — which may be from an earlier year than their last actual purchase). Expanding a client row lazy-fetches `getClientChannelYearly`, which shows **spend + discount % + bonus % per year** (one row per year that has either spend or a recorded deal).
- **Negotiation Planner** (`getNegotiationPlanner`, slide-in panel via "Plan New Client", no Deal Year input): given a proposed monthly budget, computes `projectedYearlySpend` and buckets it into a **Low/Mid/High spend tier** via live terciles (33rd/66th percentile) of each existing client's `avgYearlySpend` — the average of that client's `ScheduleLog` spend across **every year** they have data on this channel (not a single selected year). For each client, `avgDiscountPct`/`avgBonusPct` are also averaged across those same years, treating any year with no recorded `ChannelClientDeal` as **0%** (a deliberate choice — undercuts rather than ignores years where no deal was struck). Returns `suggestedDiscountRange`/`suggestedBonusRange` (min/max of `avgDiscountPct`/`avgBonusPct` among same-tier clients), the list of comparable clients with their averages and `yearsOfData`, and the agency deal reference (simply the most recent year with any agency deal recorded).
- **Entry points:** "Add/Edit Deal" on the agency block, an "Edit" button per client row, and a standalone "+ Add Deal" button near the channel selector with **both** Channel and Client as dropdowns (covers ad-hoc/bulk entry without navigating into a specific channel's view — kept inside this page rather than scattered into Admin/Database, a deliberate v1 simplification).
- **Export:** SheetJS workbook with an "Agency Deal History" sheet + a "Client Breakdown" sheet — the latter has **one row per client per year** (fetched via `getClientChannelYearly` for every client), not a single summary row, so the full multi-year spend/discount/bonus history exports in one place.
- Nav entry only renders for `SUPER_ADMIN` (`Layout.jsx` `NAV_ADMIN`); route guarded by `requiredRoles={['SUPER_ADMIN']}`; all `/api/media-buying/*` endpoints require `SUPER_ADMIN`.

## Property & Rate-History Export

Properties carry negotiated deal terms whose **cost changes over time** are tracked in `PropertyHistory`. `GET /api/reports/properties` builds a chronological **rate timeline** per property (original rate at creation + every cost change with date, delta, note, who) and exports:
- **Excel:** per-group sheets (current deals) + a dedicated **Rate History** sheet logging the rate at every point in time.
- **PDF:** branded (`generatePropertyHistoryPdf` in export.service.js), grouped, each property showing current deal + a rate-history timeline.
Group/filter by canonical **channel master** (spans agencies), agency, client, or all.

## UI Redesign (Ogilvy Orbit)

- **Login** (`LoginPage.jsx`): deep-cosmic "mission control" — fixed full-screen navy starfield (drifting/twinkling stars, shooting stars), coral-lit planet, mouse parallax, orbit "O" brand mark, glass sign-in card. Scroll-safe with hidden scrollbar.
- **App shell** (`.app` in index.css): locked to `height:100vh; overflow:hidden` so only the content area scrolls (no window scrollbar). Sidebar uses the animated orbit logo mark.
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

- **Team heads:** `Team.headUserId` (nullable, → a GROUP_HEAD user). Admin → Teams modal has a "Team Head" picker; assigning a client to a team via the existing client-chips picker moves it off any other team (`setTeamClients` in `admin.controller.js`), enforcing one team (and therefore one head) per client. Executive Dashboard's **Group Contribution** chart (under Monthly Spend) compares each team's client-portfolio spend across the latest two data months, labeled with the team head's name (`/api/analytics/dashboard/group-contribution`).
- **Forecasting & targets:** `AnnualTarget` (year, target millions, remoteMonth) + `MonthlyForecast` (year/month/client/channel/amountMillions) models; `Client.isActive`, `ChannelMaster.sortOrder`, `Notification.link` added. Executive Dashboard leads with an **Annual Achievement** horizontal bar (budget vs upto-month target vs actual+remote-month forecast, % badge) and a **Monthly Spend** line (remote month = forecast, orange dot) via `/api/analytics/dashboard/achievement` + `/forecast-monthly` (actuals ÷1e6 → millions). **Forecasting tab** (`/forecasting`, SUPER_ADMIN/MANAGER/GROUP_HEAD): group heads enter the upcoming month's per-channel allocations per accessible+active client (`/api/forecasting/*`); managers/admins get read-only history. Admin tabs: **Annual Targets**, client **active/hide** toggle, **Client/Channel Requests** (group heads request via `/api/forecasting/request-*`, admin approves under `/api/admin/*-requests`, notifications deep-link via `Notification.link`). Channels reuse `ChannelMaster` (seeded `sortOrder` for the fixed TV/Radio forecasting order); "group" scope reuses `getAccessibleClientIds`.

- **Property dates:** `startDate`/`endDate` (null end = ongoing) on `Property`, editable in the Add/Edit form, shown on the channel table, Deep Dashboard, and property-report exports.
- **Property bonus:** `bonusValue`, `bonusCount`, plus `bonusPct`/`sponsorshipDetails` exist on the model; Deep Dashboard shows a computed **Bonus Yield %**; Channel Intelligence surfaces the `PropertyHistory` audit trail.
- **Dashboard year filter** (replaces the old decorative 30D/QTD/YTD toggle) + **all-time "All"** + latest-month anchoring (`refPeriod`).
- **Bulk multi-client import** (`/api/database/import-all`), **channel/client seed modules**, **OrbitLoader everywhere**, and the **new analytics charts** (medium mix shift, brand trend, tenure bubble, agency efficiency, flighting calendar, velocity gauge, sparklines, cross-filter, comparison mode).
- **Agencies list** returns `totalSpend` + `channelCount` per agency.
- **Auth hardening:** per-IP rate limiting on auth routes (`express-rate-limit`), per-account lockout (`User.failedLogins`/`lockedUntil`, 5 fails → 15 min), and revocable tokens via `User.tokenVersion` (bumped on logout / password change / reset; embedded as `tv` in JWTs and checked in `middleware/auth.js` + refresh). `changePassword` re-issues fresh tokens so the current device stays signed in.
- **Bulk-import dedupe:** `/api/database/bulk` and `/import-all` skip rows already present (key: client+channel+scheduleMonth+value, matched ONLY against existing non-deleted DB rows — brand/RO excluded, within-file repeats kept) and report a `duplicates` count + `duplicateRows` (1-based row numbers); the Database import UI shows "duplicates skipped" and lets the user download the failed/duplicate rows. `/import-all` also supports `dryRun:true` (returns new/duplicate/failed counts without writing — used to pre-check) and `allowDuplicates:true` (insert every row anyway). The bulk-import modal first dry-runs; if duplicates exist it asks the user to **Upload N new only** or **Re-upload everything**.
