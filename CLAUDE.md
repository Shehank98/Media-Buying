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
- **Export:** ExcelJS (Excel server-side), XLSX/SheetJS (Excel client-side), jsPDF + jspdf-autotable + html2canvas (PDF client-side), PDFKit (PDF server-side), PptxGenJS (client-side PowerPoint, e.g. the Executive Dashboard "Export to PPT")
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

`nixpacks.toml` installs **`postgresql-client-18`** from the official PostgreSQL APT (PGDG) repo (a custom `pgclient` build phase) so `pg_dump` matches the Railway **PostgreSQL 18** server — Ubuntu's default `postgresql-client` is v16, and pg_dump refuses to dump a newer server ("server version mismatch"). If Railway's Postgres major changes, bump the version in `nixpacks.toml` (and optionally set `PGDUMP_PATH`).

## Database Backup (Google Drive)

A daily automated backup of the whole database to Google Drive, plus an on-demand trigger. `api/src/services/backup.service.js` runs `pg_dump --format=plain | gzip` into a temp file, then multipart-uploads it to a Drive folder using a **service account** (`google-auth-library` JWT → Drive REST via `fetch`, no heavy `googleapis` dep). Backups are organized into **`<backup folder>/<YYYY-MM-DD>/`** date subfolders (`ensureFolder`; top = `GDRIVE_BACKUP_FOLDER_ID`, else app-owned "Orbit Backups"). `node-cron` schedules it (default `0 2 * * *`, `Asia/Colombo`); after each run it prunes to the newest `BACKUP_RETENTION` (default 30) files, matched by the `orbit-backup-` **name prefix** (so pruning/listing still work across date subfolders). `startBackupScheduler()` is called from `index.js` after `listen` and is a **no-op with a log line unless configured** — the app never fails to boot for lack of backup env.

- **Two Drive auth modes (`backup.service.js` `getDriveAccessToken` prefers OAuth):** (1) **OAuth user creds** — `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` — uploads to the signed-in user's **own** Google Drive (works with a free @gmail.com 15 GB, which a service account cannot); folder id is **optional** (defaults to My Drive root). Get the refresh token with `node api/scripts/get-drive-refresh-token.mjs <clientId> <clientSecret>` (one-time loopback flow, scope `drive.file`; publish the OAuth consent screen so the token doesn't expire after 7 days). (2) **Service account** — `GOOGLE_SERVICE_ACCOUNT_JSON` (raw JSON or base64) + `GDRIVE_BACKUP_FOLDER_ID` (a **Shared Drive** folder shared with the SA `client_email` as Editor, since a service account has no storage quota), optional `GOOGLE_IMPERSONATE_SUBJECT` for My-Drive via domain-wide delegation. Backup stays DISABLED until one mode is configured. Optional: `BACKUP_CRON`, `BACKUP_RETENTION`, `PGDUMP_PATH`, `BACKUP_TZ`. **Rate cards** (`ratecard.service.js`) reuse the same auth; folder = `GDRIVE_RATECARD_FOLDER_ID` (falls back to the backup folder, optional under OAuth).
- **API (SUPER_ADMIN only):** `GET /api/admin/backup/status` (config + last run + recent files in the folder), `POST /api/admin/backup/run` (immediate backup). Last-run status is in-memory (resets on deploy); history is read live from Drive.
- **UI:** Admin (`/admin`) → **Backup** tab — status badge (Enabled/Not configured), schedule/retention/last-run cards, a **Back up now** button, the recent-backups table, and setup instructions when unconfigured.

### Daily per-tab Excel export (Google Drive)

Separate from the SQL dump above, `api/src/services/dataExport.service.js` auto-exports each **revenue / master-data / targets** tab as its **own `.xlsx` file** into a **date-wise Drive tree**: **`<backup top>/Data Exports/<YYYY>/<MM>/<YYYY-MM-DD>/<Tab>.xlsx`** (all of a day's backup Excels in one date folder), reusing the backup service's Drive auth + `ensureFolder` (no extra config). 13 datasets (registry `DATASETS`): Revenue (By Billing, By Schedule Value, AVR, Group Revenue), Master (Agencies, Clients, Channels, Media Groups), Targets (Annual, Agency, Client), Forecasts (Monthly), Commitments (Channel). Each build queries Prisma directly; **Revenue By Schedule Value** reuses `profit.service.js` `atomProfit` on `ScheduleLog` atoms (client×month schedule value + agency commission). Re-running the same day replaces that day's files (`deleteExistingByName` before upload). Runs daily (`node-cron`, default `0 2 * * *` `Asia/Colombo`, env `EXPORT_CRON`/`EXPORT_TZ`); after uploading it prunes to the newest `EXPORT_RETENTION` (default 10) **date folders** (days) via `pruneDateFolders`, which walks only the Data Exports year→month→date tree so it never touches the DB-backup date folders. Best-effort per dataset (one failure doesn't abort the rest). `startDataExportScheduler()` runs from `index.js` after `listen` (no-op unless the Drive backup is configured). **API (SUPER_ADMIN):** `GET/POST /api/admin/backup/data-export/{status,run}`. **UI:** a card in the Admin → Backup tab with an **Export now** button + last-run summary.

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
| Client | Brand clients under agencies. `aliases String[]` holds alternate names learned during bulk-import reconciliation, so a raw name that was once mapped to this client auto-resolves on future imports (mirrors `ChannelMaster.aliases`) |
| UserAgencyAccess | M:N user-agency assignments |
| UserClientAccess | M:N user-client assignments |
| Team | Team groupings within agencies. `headUserId` (nullable) names the team's head — a GROUP_HEAD user. Admin (Admin → Teams) enforces a 1-team-per-client invariant: assigning a client to a team detaches it from any other team, so every client has exactly one team and therefore one team head. Besides the per-team Add/Edit modal's client-chips picker, the Teams tab also has a standalone **"Assign Accounts to Heads"** card (above the teams table) — one row per team showing its head's name + clients as instant-toggle chips (scoped to that team's agency), backed by the same `POST /admin/teams/:id/clients` (`assignTeamClients`/`setTeamClients`) endpoint, for quick client-reassignment without opening the modal |
| TeamMember | Users assigned to teams (with role) |
| TeamClient | Teams assigned to clients (kept 1:1 per client by the invariant above, even though the table itself is M:N) |

### Channel & Property Models

| Model | Purpose |
|---|---|
| MediaGroup | Grouping of channels (e.g., "Maharaja Group") |
| ChannelMaster | Master registry of all TV/Radio/Print channels with aliases. `isDirectPlacement` marks a DIGITAL channel as part of the **Direct Placements** bucket (see that section) — the only thing the flag changes is how the Spend by Channel charts group it. Channels with **no usage at all** (zero `ScheduleLog` rows AND no client channels / upload rows / `MonthlyForecast` / deals) are **DELETED** by `seed.js`'s startup reconcile (runs every deploy). This runs *after* the seed re-upserts the master list, so merged and never-used channels are removed and **can never reappear** in the Admin Channels list — even though the seed recreates them, the reconcile deletes them again the same run. **Guarded:** the delete only runs when the DB already has schedule data (an established system); a fresh/staging DB with zero logs skips it entirely and keeps all seeded channels. A merged channel's name lives on as an alias on its target, so future imports by that name still resolve. A channel that ever held real spend keeps its (possibly soft-deleted) `ScheduleLog` rows, so it is preserved. Bulk import resolves channels by name regardless of `isActive`, and `import-all` creates a missing channel by name, so a removed channel comes back automatically the moment real spend is logged against its name. The four forecasting "category total" bucket channels (`Print`/`Cinema`/`OOH`/`Digital`, see `TOTAL_BUCKETS` in `seed.js`) are exempted from this reconcile by name, since they're only ever referenced via `MonthlyForecast`, never `ScheduleLog` — without the exemption they'd get deactivated and `listForecastChannels` would silently fall back to an unrelated active channel in that medium, mis-attributing the category-total forecast (this happened in practice: a "Digital Total" entry got saved against an unrelated real digital channel). `seed.js` also runs a one-time-per-occurrence backfill that repoints any already-mis-tagged `MonthlyForecast` rows onto the correct bucket channel (merging amounts if a correct row already exists for that client/month) |
| Channel | Client-specific channel records. Optional **channel rep contact** (`contactName`/`contactEmail`/`contactMobile`) — the sales/booking person AT the channel, captured in the client's **Add channel** form (`createChannel`/`updateChannel` in `client.controller.js`) and shown on the channel card. Per-client so each client can keep its own contact for the same channel |
| Property | Negotiated deals on channels (cost, bonus%, sponsorship details, startDate, endDate — endDate null means still ongoing). **`benefits`** (`Json?`) is what the deal actually delivers, as structured rows `[{item, qty}]` (e.g. `[{item:'Trailers',qty:50},{item:'Mid intro',qty:20}]`) — entered as repeatable item+quantity rows under "What this deal delivers" in the Add/Edit property form, shown as chips on the property card, and read by the Media Buying Negotiation Planner (see "What this budget can get"). Deliberately structured rather than folded into the free-text `sponsorshipDetails` so a budget can be matched against it. `api/src/utils/benefits.js` holds `sanitizeBenefits` (drops blank items, coerces qty to a non-negative int, caps rows), `readBenefits` (defensive read of the Json column) and `benefitsSummary` ("50 Trailers · 20 Mid intro", used for exports and the `PropertyHistory` diff — benefits are diffed on that readable summary, not raw JSON). Optional **evaluation document** (PDF/Excel) stored on Google Drive — only the Drive file id + metadata live on the row (`evaluationDriveId`/`evaluationFileName`/`evaluationMimeType`/`evaluationSize`/`evaluationUploadedAt`), uploaded via the Add/Edit property form and downloadable from the property card. `api/src/services/evaluation.service.js` (reuses the backup service's Drive auth) puts files under **`Property Evaluations/<Client>/<Channel>/`**; endpoints `POST/GET/DELETE /api/properties/:id/evaluation` (upload/replace is PLANNER/GROUP_HEAD/SUPER_ADMIN + client-access-checked, raw body + `x-file-name` header, PDF/Excel only). Optional — a property saves without one. Config: `GDRIVE_EVALUATION_FOLDER_ID` (falls back to the backup folder / OAuth My Drive) |
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
| PendingImportRow | A bulk-import row held pending approval of a new client/channel it references. `rowData` (Json) is the parsed row (client/agency/channel names + RO/month/value/brand); `clientReqId`/`channelReqId` (nullable) link to the `ClientRequest`/`ChannelRequest` it waits on. On approval `releaseHeldImportRows` clears the matching dep; a row with both deps null is inserted as a `ScheduleLog` and deleted. See "Bulk-import name reconciliation" |
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
| `MANAGER` | Read-only across assigned agencies (via UserAgencyAccess); can view reports, analytics. **Lands on the Deep Dashboard** (Executive Dashboard is now SUPER_ADMIN-only). |
| `GROUP_HEAD` | Manages team; access to clients assigned to their team (via TeamMember + TeamClient) |
| `PLANNER` | Add/edit properties and schedule logs on directly assigned clients (via UserClientAccess) |

**UI role labels are display-only renames — the DB `Role` enum values are unchanged** (do NOT introduce new role values, it breaks the enum). Single source of truth is `ROLE_STYLES`/`roleLabel()` in `Icon.jsx` (also `ROLE_LABELS` in `ProfilePage.jsx`). Current mapping: `SUPER_ADMIN`→**Control Room**, `MANAGER`→**Boardroom**, `GROUP_HEAD`→**Hub**, `PLANNER`→**Desk**. Everywhere the docs/UI say "Hub" it means `GROUP_HEAD`; "Boardroom" = `MANAGER`; "Control Room" = `SUPER_ADMIN`; "Desk" = `PLANNER`.

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
POST   /api/database/import-reconcile     (AUTH + SUPER_ADMIN|GROUP_HEAD|PLANNER)   fuzzy name-match check: distinct client/channel names -> matched/ambiguous/unmatched + channel variant clusters
POST   /api/database/import-apply         (AUTH + SUPER_ADMIN|GROUP_HEAD|PLANNER)   apply reconciliation: learn aliases, file client/channel requests, HOLD dependent rows (PendingImportRow) until approved
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
GET    /api/reports/media-group          (AUTH + SUPER_ADMIN|MANAGER)   mediaGroupReport
       ?mediaGroup &channelMasterId &agencyId &clientId &monthFrom &monthTo &format=json|excel|pdf
       Full spend breakdown for ONE media group (or ALL when mediaGroup omitted), from ScheduleLog
       (isDeleted:false), year taken from scheduleMonth. Filters: channelMasterId + clientId are
       comma-separated multi-select, applied in JS after a media-group-scoped fetch so the pickers stay
       stable. Returns/exports: year-wise totals, per-AGENCY, per-CHANNEL, per-CLIENT (all year-wise),
       and the Agency x Channel matrix. JSON also carries availableMediaGroups + availableChannels +
       availableClients (scoped, biggest-first, for the pickers) and summary.clientCount. Excel sheet
       order = Summary (year-wise) -> By Agency -> By Channel -> By Client -> Agency x Channel ->
       By Media Group (only when unfiltered); dynamic year columns. PDF = branded, one titled section
       per breakdown in the SAME order (Spend by Year -> by Agency -> by Channel -> by Client ->
       Agency x Channel [-> by Media Group when unfiltered]) with a grand total. MANAGER agency-scoped.
       Surfaced as the "Media Groups" source on ReportsPage with Media Group / Channel / Agency /
       Client (default all) / month-range filters + preview.

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
GET    /api/analytics/channel/:channelMasterId/summary           (AUTH + SUPER_ADMIN|MANAGER|GROUP_HEAD)   ?clientId scopes every number to one client (+ returns scopedClient, rateCard)
GET    /api/analytics/channel/:channelMasterId/rate-card                                                    proxies the channel's rate-card PDF from Drive (inline; ?download=1 = attachment)
GET    /api/analytics/channel/:channelMasterId/monthly-spend      ?clientId
GET    /api/analytics/channel/:channelMasterId/clients            ?clientId  (each row carries ME contact: meName/meEmail/meMobile)
GET    /api/analytics/channel/:channelMasterId/property-history   ?clientId
# All channel endpoints accept ?clientId to scope to a single client (client-context click-through);
# a scoped user only gets it for a client they can access. SUPER_ADMIN toggles back to overall in the UI.

GET    /api/analytics/dashboard/summary          (AUTH + SUPER_ADMIN|MANAGER)   ?agencyId &year
GET    /api/analytics/dashboard/agency-comparison                                ?year
GET    /api/analytics/dashboard/top-clients                                      ?year   (returns 6-mo spark series)
GET    /api/analytics/dashboard/top-channels                                     ?year
GET    /api/analytics/dashboard/medium-split      (?agencyId &year)
GET    /api/analytics/dashboard/monthly-trend                                    ?year
GET    /api/analytics/dashboard/revenue-achievement (AUTH + SUPER_ADMIN|MANAGER) ?year   admin-billing YTD vs prorated annual target
GET    /api/analytics/dashboard/channel-commitments (AUTH + SUPER_ADMIN|MANAGER) ?year   per-channel committed-to-date vs achieved
GET    /api/analytics/agency-achievement          (AUTH + SUPER_ADMIN|MANAGER|GROUP_HEAD) ?agencyId &year   per-agency Annual Achievement + this-year monthly bars (Spend Analytics)
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

### Revenue — Profit + Billing (SUPER_ADMIN only)
```
# Revenue by schedule value (the original Profit tab — commission on ScheduleLog):
GET /api/profit/summary     ?year&agencyId&clientId   totals + YoY for the cards
GET /api/profit/monthly     ?...                       profit/revenue per schedule-month
GET /api/profit/by-agency   ?...
GET /api/profit/by-client   ?...
GET /api/profit/by-commission-type ?...
GET /api/profit/client-breakdown   ?...
GET /api/profit/details     ?...&page&pageSize&sortBy&sortDir       paginated ground-truth rows

# Revenue by billing (billing.controller.js — admin-entered ClientRevenue.amount):
GET /api/profit/billing/summary          ?year&agencyId&clientId
GET /api/profit/billing/monthly          ?...
GET /api/profit/billing/by-agency        ?...
GET /api/profit/billing/by-client        ?...
GET /api/profit/billing/client-breakdown ?...
```
Every route is `requireRole('SUPER_ADMIN')` (403 otherwise, enforced server-side — not just UI hiding). The page/nav is labelled **Revenue** (route stays `/profit`); `ProfitPage.jsx` has two tabs — **Revenue by schedule value** (the profit view, unchanged) and **Revenue by billing** (`BillingRevenueTab.jsx`, revenue-only mirror: Total Billing card + YoY, Monthly Billing bars, Cumulative Billing area, Billing by Agency bars, Billing by Client ranked table, expandable client→month detail, Excel export). Billing buckets by `ClientRevenue.month` within a year, attributes to the client's CURRENT agency, and sums amounts NET (negatives/credits included) — no commission/profit/margin.

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
GET/POST /api/admin/channel-commitments        yearly commitment per channel (?year; POST upserts {channelMasterId,year,yearlyAmount}, blank/0 deletes)
GET/POST /api/admin/monthly-billing            company-wide actual billing per month (?year; POST upserts {year,month,amount}, blank/0 deletes)
GET/POST /api/admin/agency-targets             per-agency annual target (?year; POST upserts {agencyId,year,totalTargetMillions}, blank/0 deletes) → Spend Analytics agency achievement
POST     /api/admin/channel-masters/:id/rate-card   upload a PDF rate card (JSON {fileName, dataBase64}) → Google Drive
DELETE   /api/admin/channel-masters/:id/rate-card   remove the rate card (Drive file + DB fields)
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
GET    /api/masterdata/direct-placements    every digital channel + selectedIds (the current bucket)
POST   /api/masterdata/direct-placements    set-based {channelMasterIds:[]} — omitted ids leave the bucket
```

### Notifications & Upload Tracker
```
GET    /api/notifications                        (AUTH)
PATCH  /api/notifications/:id/read               (AUTH)
PATCH  /api/notifications/read-all               (AUTH)
GET    /api/notifications/upload-tracker          (AUTH + SUPER_ADMIN)
POST   /api/notifications/send-reminder          (AUTH + SUPER_ADMIN)
POST   /api/notifications/broadcast              (AUTH + SUPER_ADMIN)   send an announcement to roles and/or specific users
GET    /api/notifications/master-sheet           (AUTH + SUPER_ADMIN|MANAGER)
```

**Notification delivery/UX:** the topbar bell dropdown (`Layout.jsx`) renders above page content (`.topbar` carries `position:relative; z-index:30` because its `backdrop-filter` makes it a stacking context that the sibling `.content` would otherwise paint over) and closes on outside-click via a full-viewport backdrop. New notifications are also surfaced as **browser desktop notifications**: `Layout` requests `Notification` permission (on load + on bell click as a gesture fallback), tracks already-seen ids in a ref, seeds silently on first load, and fires `new Notification(...)` (capped at 3 per poll) for genuinely new unread items; clicking one focuses the window and navigates via `notifLink`. Each desktop notification is **branded "Ogilvy Trading"** (the header/title), with the event title + message in the body and the orbit mark as `icon`/`badge` (`web/public/notification-icon.png`, also copied to `dist`). Note the OS shows the site's origin domain beneath — that line is browser-controlled and cannot be renamed. **Admin → Notify tab** (`AdminPage.jsx`, SUPER_ADMIN) composes an announcement (title, message, optional in-app link) and targets any mix of **roles** (toggle chips) and/or **specific users** (searchable checklist), posting to `broadcastNotification` (`uploadtracker.controller.js`) which creates one `type:'ANNOUNCEMENT'` `Notification` per resolved recipient (deduped via a single `OR` user query).

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
| ProfitPage | `/profit` (nav label **Revenue**) | SUPER_ADMIN | Two tabs: **Revenue by schedule value** (agency profit/commission on confirmed ScheduleLog spend — cards, Monthly/Cumulative Profit, Commission Mix, by Agency/Client, detail) and **Revenue by billing** (`BillingRevenueTab`, revenue-only from admin-entered `ClientRevenue.amount`). Commission snapshotted at entry |
| MediaBuyingPage | `/media-buying` | SUPER_ADMIN | Channel negotiation intelligence — agency/client discount & bonus deal history, year-over-year trend arrows, Negotiation Planner, Excel export |
| AdminPage | `/admin` | SUPER_ADMIN | User, team, agency, client management (tabbed). Master Data holds Channels / Media Groups / Property Categories / **Direct Placements** (the digital roll-up bucket). Channels tab has a per-row "Merge" action (calls `POST /masterdata/channel-masters/merge`) to consolidate duplicate channel masters — moves schedule logs/upload rows + aliases onto the picked target and deactivates the source. Header has an **"Export all"** button (`exportAll`, client-side SheetJS) that dumps every already-loaded admin dataset into one `.xlsx`, a sheet per entity: **Users, Agencies, Clients, Channels** (channel + medium + media group + active + aliases + schedule-log count), **Media Groups, Teams** — no new endpoint, it reuses the page's existing state. Clients tab also has a per-row **"Merge"** action (`POST /admin/clients/merge`, `mergeClients` in `admin.controller.js`) to consolidate duplicate same-name clients — in one transaction it re-points schedule logs (realigning `agencyId` to the target), moves client channels + their properties, brands + campaigns, forecasts, deals, and user/team assignments onto the target, resolving every unique-constraint clash (same-name channel/brand/campaign folded, forecast amounts summed, deal/user/team dupes deduped), then deletes the now-empty source. Clients tab also has a per-row **"Move to another agency"** action (`POST /admin/clients/:id/move-agency`, `moveClientAgency`) for clients that change agencies over time: given a target agency + an optional **effective schedule month**, it sets the client's home agency and **re-stamps `ScheduleLog`/`MonthlyForecast`/`MonthlyBudget.agencyId` for months ≥ the effective month** to the new agency, leaving earlier months under the old one (blank month = move all history). Point-in-time and repeatable — each move only re-stamps from its own month forward, so a client can switch agencies multiple times and each period stays attributed correctly. Spend/dashboards already attribute by the per-row `ScheduleLog.agencyId` snapshot, and Profit was changed to do the same, so Revenue, Schedule Value and Profit all split at the cut-off |
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
- **Revenue Achievement** + **Channel Commitments** (both lead `AchievementSection`, so both export as PPT slides, and both react to the page year selector):
  - **Revenue Achievement** — a two-bar chart (yellow **Target** vs green **Achievement**) titled `${pct}% Revenue Achievement · ${year} ${month} YTD`, matching the client's reference slide. `GET /dashboard/revenue-achievement` (`getRevenueAchievement`): the green bar = admin-entered **actual billing** (`MonthlyBilling`, full LKR) summed Jan→latest entered month; the yellow bar = the **`AnnualTarget` prorated** (`totalTargetMillions ÷ 12 × positionMonth`, the same "upto-month target" `getAchievement` uses); `positionMonth` = the latest month with a billing entry. Company-wide (billing has no agency dimension). Empty-states point to Admin → Annual Targets (no target) or Admin → Group Revenue (no billing). **Admin entry:** a single company-wide **Actual billing** input per month sits at the top of the Admin → **Group Revenue** tab (`GET/POST /api/admin/monthly-billing`, `listMonthlyBilling`/`setMonthlyBilling`; upsert by `year,month`, blank/0 deletes). `MonthlyBilling` is `@@unique([year, month])`.
  - **Channel Commitments** — a per-channel table (channel · committed-to-date · achieved · progress bar · %, color-coded green ≥100 / amber ≥80 / red below, + a Total row). `GET /dashboard/channel-commitments` (`getChannelCommitments`): per channel with a commitment, **committed-to-date = `yearlyAmount ÷ 12 × monthsElapsed`** (monthsElapsed = latest month with schedule data, capped at the current calendar month for an in-progress year) vs **achieved = cumulative `ScheduleLog.scheduleValue` on that channel Jan→monthsElapsed** (agency-scoped for MANAGER via `agencyIdsForUser`, unrestricted for SUPER_ADMIN). Only channels with a commitment appear. **Admin entry:** a new **Channel Commitments** tab in the Admin page (`/admin`, SUPER_ADMIN) — year picker + searchable channel list, one **yearly commitment** (full LKR) input per active channel, auto-saved on blur, with a computed Monthly (÷12) column; backed by `GET/POST /api/admin/channel-commitments` (`listChannelCommitments`/`setChannelCommitment`; upsert by `channelMasterId,year`, blank/0 deletes). `ChannelCommitment` is `@@unique([channelMasterId, year])`.
- KPI cards; **Monthly Billing Trend** (Combined = one bar per year on a fixed Jan-Dec axis / By-Agency multi-Line toggle); **Top 10 Clients / Channels** ranked bars (YTD + this-month + MoM/YoY); **Agency Comparison** grouped bars + cards; **Medium Split** two donuts (this-month + YTD with per-medium YoY). (The old **Activity Log** and **Recent Uploads** sections were removed.) Two exports: **"Export summary"** → branded jsPDF + autoTable (tables), and **"Export to PPT"** (`exportChartSlides`, `canExport`-gated) → a PptxGenJS `.pptx` with a **"Media Buying Dashboard"** cover slide, **one slide per chart** (each `.dash-section .chart-card` containing an svg/canvas, captured via html2canvas, titled from its `.chart-card-title`), and a closing **"Thank you"** slide. Loading uses skeletons.
- Inside the Annual Achievement section, under **Monthly Spend**, three Group Contribution chart-cards in `AchievementSection` (`ExecutiveDashboardPage.jsx`), all team-grouped: each team is one `Team` (clients grouped via `TeamClient`, label includes the `headUserId` head name); clients not yet assigned to a team roll into "Unassigned". All three are read-only and unaffected by the page's year selector — each picks its own time window server-side.
  - **Group Contribution** (donuts) — `GET /dashboard/group-contribution` (`getGroupContribution`). **Two donuts by group head: Budget (left) vs Revenue (right).** Let L = the latest month with schedule data. **Budget Contribution** = schedule-log spend share for month **L-1** (data till June → Budget = May); heads are resolved via `accountManagerByClient` (team head, else GROUP_HEAD member, else direct `UserClientAccess`), and clients with no head roll into an **"Unassigned"** slice. **Revenue Contribution** = **admin-entered** figures (`GroupRevenue` model, full LKR) for month **L** (the month after budget), **named heads only** (no Unassigned). Response: `{ budget: { month, label, year, groups: [{key, headName, value}] }, revenue: { month, label, year, groups } }`, all `value`s in LKR millions. The frontend (`AchievementSection`) renders two `PieChart` donuts; slice % is computed client-side; **Unassigned is always blue (`#1F5BB5`)** and every other head gets a stable colour (`GC_HEAD_COLORS`, blue reserved) shared across both donuts. If no revenue is entered for month L the right donut shows an empty-state pointing to Admin → Group Revenue. **Admin entry:** a new **Group Revenue** tab in the Admin page (`/admin`, SUPER_ADMIN) — pick a month/year (defaults to L, the dashboard's revenue month, via `currentRevenueMonth` in the API response) and type one full-LKR figure per `GROUP_HEAD` user; backed by `GET/POST /api/admin/group-revenue` (`listGroupRevenue`/`setGroupRevenue` in `admin.controller.js`; POST upserts, a blank/0 deletes the row). `GroupRevenue` is `@@unique([year, month, headUserId])`.
  - **Group Contribution vs Forecast** (chart title `Group Contribution vs Forecast`) — a grouped bar chart in `AchievementSection`, rendered **immediately after Monthly Avg**, backed by `GET /dashboard/group-contribution-variance` (`getGroupContributionVariance`). One category per **group head** (`headName`), two bars each: blue `avgActual` (labelled `${actualMonthsLabel} Avg`) vs orange `forecast` (labelled `${forecastMonthLabel} Est`), with `diffPct` shown above the shorter bar (green if ≥0, red if a drop). **Groups with no named head (`headName` null, i.e. the "Unassigned" bucket) are filtered out client-side** so only real group heads appear. Fetched once with no params (scoped server-side to the user's agencies via `agencyIdsForUser`, like the Group Contribution donut), so it does not react to the page's agency dropdown. Coexists with the Group Contribution donut pair (both are kept). `getGroupContributionVariance` finds the single latest month with `ScheduleLog` data, derives its calendar year, and averages **every actual month so far this year (Jan through that latest month, inclusive)** per team — this is the "actual" bar. The other bar is that team's submitted **`MonthlyForecast`** for the very next month (the month the Forecasting tab is currently collecting submissions for), summed per team and used as-is (already in millions, no `/1e6`). Example: with actuals through March, bars are "Jan-Mar Avg" vs "Apr Forecast"; once April actuals land, it becomes "Jan-Apr Avg" vs "May Forecast" — fully dynamic, nothing hardcoded. Rolls over the year boundary (Dec actual → next Jan forecast). Returns `{ actualMonths, actualMonthsLabel, forecastMonth, forecastMonthLabel, groups: [{key, teamId, name, headName, agencyName, avgActual, forecast, diffPct}] }`. `diffPct` = `(forecast - avgActual) / avgActual * 100`, rounded to a whole number (100 if `avgActual` is 0 and `forecast` > 0, else 0 if both are 0). If a team hasn't submitted a forecast yet for the next month, `forecast` is simply 0 for that team (the bar still renders, at zero). Bars: `avgActual` (blue) vs `forecast` (orange); `diffPct` is rendered once per team as a colored (green/red) custom SVG `<text>` label positioned **above whichever of the two bars is shorter** (`diffLabel(barKey)` in `AchievementSection` compares the row's `avgActual`/`forecast` and only the bar matching the lower value draws the label) — plain CSS `style.fill` can't vary per-row, hence the custom `content` renderer on `<LabelList>` rather than a `formatter`.
  - **Monthly Avg** (single bar chart) — `GET /dashboard/monthly-avg-by-year` (`getMonthlyAvgByYear`). Company-wide (not per-team/agency): for every calendar year with any schedule data, `avgMillions` = that year's total spend ÷ `monthsWithData` (the count of distinct months with data that year — NOT 12), so a partial year (e.g. only January logged) still shows a meaningful average instead of being diluted. Returns `{ years: [{year, avgMillions, monthsWithData}] }`, one bar per year, colored via `TEAM_COLORS`.
  - All three respect the MANAGER agency-scoping convention (`agencyIdsForUser`) like every other `/dashboard/*` endpoint, and are `SUPER_ADMIN`/`MANAGER`-gated.

### Deep Dashboard (`/deep-dashboard`)
- One call `/analytics/deep-dashboard` (agency/client/channel filters). KPIs; **Multi-Year Monthly Spend Trend** (one Line per year + Brush); **Client Investment Contribution** bars; **All Clients** / **All Channels** ranked full-list cards (every client/channel with spend under the active filters, sorted desc, click-through to `/clients/:id/dashboard` (Client Dashboard — the client analytics/intelligence view) and `/channel-masters/:id` (Channel Intelligence) respectively — replaced the old "Channel Performance Insights"/"Client Investment History" metric tiles); **Property Performance** sortable table incl. a computed **Bonus Yield %** (bonus ÷ value) column, Excel + PDF export. `clientDistribution`/`channelDistribution` in the API response carry `clientId`/`channelMasterId` alongside name + value for the ranked-list links.

### Group Dashboard (`/client-groups/:groupId/dashboard`, GroupDashboardPage.jsx)
- Parent-company view: the group's member companies aggregated, with a year filter and a "Filter by company" dropdown. One call, `GET /api/analytics/client-group/:groupId/overview` (`clientgroup.controller.js` `getClientGroupOverview`), access-scoped so a MANAGER only sees their agency's clients.
- Stat cards (Spend · Group Target · Avg/Month · YoY), **Monthly Spend Trend** (one line per year), **Spend by Channel** (top 20 bars + medium tabs, with the Direct Placements roll-up above), a **Company Split** donut and — stacked directly under it — the **Medium Split** donut. Company Split is the same donut by member company, from the `byClient` breakdown the overview now returns. The two cards are ordered with flex `order` (Company `1`, Medium `2`) rather than by JSX position, so their blocks stay where they are in the file. Clicking a legend row filters the whole dashboard to that company; with a single-company filter already active the card shows a "show the whole group" prompt instead of a pointless 100% slice. Below: expandable Brand Performance, All Channels / Brands tables and the Channel Directory. Every chart has a JPG export and the header's "Charts (JPG)" button downloads them all.

### Spend Analytics (`/spend-analytics`)
- **Agency-wise Annual Achievement + monthly spend** (top of the results, SUPER_ADMIN|MANAGER|GROUP_HEAD only — planners don't see it): per agency the user can access, an Annual Achievement horizontal bar (Budget / upto-month target / actual+forecast-fill — the **same method as the Executive Dashboard's Annual Achievement**, but keyed on the agency's own `AgencyAnnualTarget` and its `ScheduleLog`/`MonthlyForecast`) plus a this-year Jan–Dec **monthly spend** bar chart. Backed by `GET /api/analytics/agency-achievement` (`getAgencyAchievement`), which respects the page's **Agency filter** (`?agencyId`) and scopes agencies by role (`accessibleAgencyIds`: SUPER_ADMIN all, MANAGER their `UserAgencyAccess`, GROUP_HEAD the agencies of their accessible clients). With "All agencies" selected it renders one block per accessible agency; an agency with no target shows the monthly chart + a hint to set one. **Admin entry:** an **Agency Targets** section on Admin → **Annual Targets** tab (year picker + one target input per agency, auto-saved on blur), backed by `GET/POST /api/admin/agency-targets`. New model `AgencyAnnualTarget` (`@@unique([agencyId, year])`), separate from the company-wide `AnnualTarget`.
- **Access is now SUPER_ADMIN, MANAGER, GROUP_HEAD, PLANNER** (was admin/manager only). `getAnalytics` (`database.controller.js`) scopes the `ScheduleLog` `where` by role: MANAGER → their agencies (`UserAgencyAccess`), GROUP_HEAD/PLANNER → `getAccessibleClientIds(user.id, role)` (`where.clientId in [...]`, a passed `clientId` is access-checked), SUPER_ADMIN → unrestricted. So a group head/planner sees only their own accounts across every chart. Same roles added to the `/spend-analytics` route (`App.jsx`), the sidebar nav (`Layout.jsx`), and — for the click-through targets — the Channel Intelligence route/endpoints and the `/analytics/client/:id/overview` endpoint (PLANNER added). Channel Intelligence stays cross-client (channel-level market intel), so a group head/planner opening it sees every client on that channel, not just their own.
- One call `/database/analytics` (filters: agency, client, monthFrom/To). Returns `totalValue`, `totalWithVat`, and arrays `byMonth`, `byMedium`, `byMediaGroup`, `byChannel` (now carries `channelMasterId`), `byClient` (now carries `clientId`), `byBrand`, `byAgency`, plus derived `byMonthMedium`, `brandTrend`+`brandTrendKeys`, `clientTenure`, `clientFlighting`+`flightingMonths`.
- **Spend by Channel / Spend by Client** are two ranked **clickable** lists (replaced the old Top-15 bar chart): a channel row → **Channel Intelligence** (`/channel-masters/:channelMasterId`, disabled when the channel has no master id), a client row → **Client Dashboard** (`/clients/:clientId/dashboard`). Each row shows a value + %-of-max mini bar; the channel list still honours the Medium donut cross-filter.
- **Deals & Properties** table (below the ranked lists) lists the scoped clients' `Property` rows via `GET /database/properties` (`getScopedProperties`, same role-scoping as `getAnalytics`): Client · Channel · Medium · Property · Type · Cost (`0` = "Added value") · Bonus (% or value) · Period (start–end, "ongoing" when no end). Each row → that client's channel page (`/channels/:channelId`).
- Charts: 5 summary tiles; **Monthly Spend Trend** (one Line **per year** plotted against a fixed Jan–Dec X axis, pivoted client-side from `byMonth` via `monthlyByYear`); **Cumulative Spend** Line; **Spend by Agency** bars; **Medium Mix Shift** (100% stacked area, TV/Radio/Print); **Brand Spend Trend** (multi-line, top 6); **Client Tenure & Value** bubble (Scatter, size = avg/month); **Agency Efficiency** bars (spend per entry); **Flighting Calendar** (client×month active grid); Medium/Media-Group **donuts**; **Spend by Channel** bars; **Top Clients** bars; grouped breakdown table (with %-of-total bars, collapsed to media-group rows by default — click a row's expand arrow to reveal its channel rows); client/brand tables.
- **Cross-filter:** click a slice in the Medium donut → filters the Channel chart + breakdown table.
- **Comparison mode:** "Compare" toggle reveals Period B date range → side-by-side totals, delta %, by-medium grouped bars.
- Excel (SheetJS, sheet per group) + PDF (jsPDF, charts via html2canvas) export.

### Direct Placements (digital roll-up)

Some digital inventory is bought as **direct placements** (Sirasa Digital, Swarnawahini Digital, …) and the client wants those reported as one line rather than channel by channel. `ChannelMaster.isDirectPlacement` is a single fixed bucket — there is deliberately no "groups" model, no name field and no per-medium variant.

- **Admin entry:** Admin → **Master Data → Direct Placements** (`AdminPage.jsx`, SUPER_ADMIN) — a searchable list of every DIGITAL channel master (deactivated ones included, since a paused channel keeps historical spend that still has to roll up) with a tick per channel, a dirty-tracked **Save changes** button, and a Clear all. Backed by `GET/POST /api/masterdata/direct-placements` (`listDirectPlacements`/`setDirectPlacements`). The POST is **set-based** — the posted ids become the bucket exactly, so leaving an id out removes it — and rejects non-DIGITAL channels (the roll-up only renders in the Digital tab, so a TV channel in the bucket would silently never appear).
- **Where it renders (binding scope):** the **three Spend by Channel charts only** — Spend Analytics (`/spend-analytics` ranked list), Group Dashboard (`/client-groups/:id/dashboard`) and Client Dashboard (`/clients/:id/dashboard`). Flagged channels are **replaced** by one combined `Direct Placements` row/bar, so the Digital column still totals correctly (no double counting). Everywhere else — the Spend Breakdown table, All Channels tables, Excel/PDF exports, reports, Channel Intelligence, the Pareto chart — keeps reading the raw per-channel data, so no per-channel detail is lost.
- **How:** every `byChannel` row now carries `isDirectPlacement` (added to `getAnalytics` in `database.controller.js`, `getClientOverview` in `analytics.controller.js`, `getClientGroupOverview` in `clientgroup.controller.js`). `web/src/components/DirectPlacements.jsx` holds all the shared logic: `rollUpDirectPlacements(rows)` collapses the flagged rows into one synthetic row (`isDirectGroup`, `members` sorted biggest-first, null ids so click-through is disabled) and **returns the input untouched when nothing is flagged**, so the charts behave exactly as before until an admin fills the bucket. The combined bar is coloured per member channel from `DP_COLORS`, with the contribution breakdown on hover — `ChannelRankBar` (segmented HTML bar for the ranked list) and, for Recharts, `toStackedChannelData` (one `dpN` series per member sharing a `stackId`, normal rows holding 0) + the `ChannelBarTooltip` custom tooltip. `DirectPlacementLegend` renders the static colour key under each chart.

### Channel Intelligence (`/channel-masters/:id`)
- Endpoints keyed by channel master id: `/summary` (incl. a per-year `byYear[]` breakdown → one spend card per year), `/rate-card`, `/monthly-spend`, `/month-detail`, `/clients`, `/agency-monthly`, `/property-history`.
- **Client-scoped view** — every channel endpoint accepts `?clientId=`, which narrows all its numbers to that one client (a scoped user only gets it for a client they can access; `singleClientFilter` in `analytics.controller.js`). Clicking a channel from a **client context** — the Spend Analytics "Spend by Channel" list while a client filter is active, or the **Client Dashboard**'s channels table — links to `/channel-masters/:id?clientId=<id>`, so you see that client's spend on the channel, not the whole channel's. The page (`ChannelIntelligencePage.jsx`, reads `?clientId` via `useSearchParams`) shows a "Showing <Client> only" banner + a **SUPER_ADMIN-only toggle** to flip to overall (all-clients) numbers; `getChannelSummary` returns `scopedClient` when scoped. No param = the original cross-client market-intel view.
- **ME / Contact column** on the **Clients on this Channel** table — each client's rep contact (the "ME" entered on that client's Add-Channel form: `Channel.contactName/contactEmail/contactMobile`), joined per client on this channel master (`getChannelClients` returns `meName/meEmail/meMobile`).
- **Rate card** — a versioned PDF per channel, stored in Google Drive under **`<rate-card folder>/<medium>/<channel>/`** (`ratecard.service.js`, `ensureFolder` find-or-creates the tree; top = `GDRIVE_RATECARD_FOLDER_ID`, else an app-owned "Orbit Rate Cards"). **Every upload is a NEW version** (the old Drive file is NOT deleted): `ChannelMaster.rateCardVersions` (`Json`, `[{version,driveId,fileName,size,uploadedAt}]`, newest last) is the history, and `rateCard{DriveId,FileName,Size,UploadedAt}` point at the **latest** (what the app shows by default). **Admin → Channels** "Rate Card" column: upload (base64 JSON `POST /admin/channel-masters/:id/rate-card`, PDF-sniffed + ≤25 MB) shows a `vN` badge; the ↑ action adds a new version (keeps old); trash removes all versions. **Channel Intelligence** header shows the latest **Rate card (vN) / Download** + a "**N versions**" toggle listing every version with per-version view/download; the download route (`GET /analytics/channel/:id/rate-card`, roles SUPER_ADMIN|MANAGER|GROUP_HEAD) proxies the PDF and accepts **`?driveId=`** to fetch a specific version (validated against the channel's history). Drive auth is shared with backups (OAuth user creds or service account); uploads 503 with a clear message when unconfigured.
- Stat cards (compact, page-scoped sizing — NOT the global 33px `.stat-val`); **Monthly Spend Trend** — one Line per year plotted against a fixed Jan-Dec X axis (`/monthly-spend` pivots `scheduleMonth` into `{ years: [...], data: [{ monthNum, label, [year]: value, ... }] }`); clicking a year's dot opens a drill-down modal (`getChannelMonthDetail` / `/month-detail?year=&month=`) listing every `ScheduleLog` behind that point, grouped by client (expand a client row for its individual RO/brand/value rows) so a spend spike can be traced back to exactly which client and schedule made it up; **Spend by Agency Over Time** multi-line (`/agency-monthly`); **Client Spend Concentration** Pareto (ComposedChart: per-client spend bars + cumulative-% line + 80% reference line, built client-side from `/clients`); **Clients on this Channel** table; **Property History Timeline** (vertical timeline of deal terms + the real `PropertyHistory` audit-trail diffs). `getChannelPropertyHistory` also matches free-text client channels by name/alias when `channelMasterId` is null.

### Database (`/database`)
- When a client is selected, an overview strip + monthly mini bar chart from `/database/analytics?agencyId&clientId`. Plus the spreadsheet editor and bulk import (below).

## Data Ingestion / Bulk Import

- **Per-client paste/upload** (DatabasePage): SheetJS parse, column auto-map, preview into the grid, save via `POST /api/database/bulk` (pre-resolved client/channel IDs). Like `import-all`, the **file-upload** path now captures **every non-core column** (CAG, AOR, invoice numbers, dates, Payment Received, etc.) verbatim into the row's `_extra` (keyed by original header, skipping `CORE_IMPORT_HEADERS`); `saveNewRows` forwards it as `extra` and `bulkCreateScheduleLogs` persists it to `ScheduleLog.importExtra`, so those columns survive to the schedule-logs export. (Paste is positional/header-less, so it carries no extra.) The file-upload preview also runs **channel reconciliation** (below): an "Auto-match channels" action on unmatched channel names, with the same map/request-new UI (client is fixed to the selected client, so only channels are reconciled); requested-new channels hold their rows the same way as the bulk import (their held rowData also carries `extra`). `matchChannelByName` (grid + paste) also matches learned **aliases**, not just the exact name.
- **Bulk-import name reconciliation** (both flows): between "file parsed" and "committed", uploaded client/channel names that don't exactly match the DB are surfaced for review. `POST /api/database/import-reconcile` takes `{clientNames:[{raw,count}], channelNames:[{raw,count}]}` and returns `{clients, matchedChannels, channelClusters, hasIssues}` — clients are `matched`/`ambiguous` (same name under >1 agency)/`unmatched` (with a fuzzy `suggestion` + ranked `options`); unmatched channels are **fuzzy-clustered** (likely variants like "Sirasa TV"/"SirasaTV"/"Sirasa-TV" grouped) each with a "Did you mean X?" suggestion. Fuzzy matching is dependency-free (`api/src/utils/fuzzy.js`: normalized Levenshtein on space-squashed strings ∪ token Dice; `clusterNames` greedy at 0.8). `POST /api/database/import-apply` takes the user's choices `{fileName, clientMappings:[{raw,clientId}], channelMappings:[{raw,channelId}], newClients:[{raw,name,agencyId,notes}], newChannels:[{raw,name,medium,notes}], rows}` and (1) **learns each raw→system mapping as an alias** (`Client.aliases` / `ChannelMaster.aliases`) so it auto-resolves next time, (2) files a `ClientRequest`/`ChannelRequest` per "request new" (notifying SUPER_ADMINs, `type:'IMPORT_REQUEST'`), and (3) **holds** the rows that depend on a pending request as `PendingImportRow` (linked to the request). When an admin **approves** that request (`reviewClientRequest`/`reviewChannelRequest` in `admin.controller.js`), `releaseHeldImportRows` clears the dependency and, once a held row has no pending deps left, inserts it as a `ScheduleLog` (via `insertResolvedRows`, resolving client/agency/channel by name+alias) and removes it from the queue — so held rows import automatically on approval, no re-upload. Both endpoints `SUPER_ADMIN, GROUP_HEAD, PLANNER`. Confirm is gated until every flagged name is resolved.
- **Bulk import — all clients** (SUPER_ADMIN): one file for every client via `POST /api/database/import-all`. Columns (matched by name, order-independent): **Year, RO, Sch: Month, Client, Brand, Medium, Media Group, Channel, Schedule Value** (no Agency column needed). Resolves client by name across agencies; resolves channel by name/alias; combines the separate **Year** column with a month *name* ("Jan") into `YYYY-MM`; derives medium/mediaGroup from the channel master; computes VAT (18%); optionally creates missing clients; inserts in chunks of 1000 (≤60k rows). Express JSON body limit raised to 50mb. Per-row errors are reported, not fatal. The whole import is one `UploadBatch` (deletable in one go). **Every OTHER column in the sheet** (Invoice Value, Invoice Value with VAT, CAG Agency/%/Amount, AOR %/Revenue, station & agency invoice numbers, the various dates, Payment Received, Group, etc.) is captured verbatim by the DatabasePage parser into a per-row `extra` object (keyed by original header, skipping the core/derived columns in `CORE_IMPORT_HEADERS`) and stored on `ScheduleLog.importExtra` (`Json?`). These are **retained for the record only** — no aggregation uses them — and are appended as extra columns on the **schedule-logs Excel export** (`report.controller.js`, colliding headers suffixed " (import)"). They are NOT shown in the Database grid.

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
- **Tests:** `cd api && npm test` (`node --test`, no framework). Covers the pure/DB-free logic only — profit reconciliation + commission snapshotting (`tests/profit.*.test.js`) and re-upload matched-row correction (`tests/import-match.test.js`). `profit.snapshot.test.js` imports `auth.service.js`, so the run needs `JWT_SECRET` + `JWT_REFRESH_SECRET` set (any value) or it fails on import. No CI runs it — run it yourself before pushing
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

## Buying Requisition (MBR)

`/buying-requisition` (`BuyingRequisitionPage.jsx` → `RequisitionsPanel.jsx`) — a Desk/Hub request to the buying unit for a media plan, stored as `MediaBuyingRequisition`. PLANNER/GROUP_HEAD/MANAGER/SUPER_ADMIN can raise one; SUPER_ADMIN sees every MBR, everyone else only their own (`listRequisitions` filters on `requestedById`, not client). Submitting emails the buying unit (fixed TO/CC, plus the managing Hub) and notifies admins + that Hub. Endpoints `GET/POST /api/requisitions`, `GET /api/requisitions/clients`, `GET/DELETE /api/requisitions/:id`.

**New clients:** the Client field is a two-way toggle — **Existing client** (the access-scoped dropdown) or **New client** (a free-text name), so an MBR can be raised for a client that isn't in Orbit yet (which the `new-client` deadline type always implied but the dropdown made impossible). `MediaBuyingRequisition.clientId` is nullable and `newClientName` holds the typed name; **exactly one of the two is ever set** (`createRequisition` nulls the other). This deliberately does **NOT** create a `Client` record — the name travels with that one requisition until an admin adds the client properly. Consequences, all intentional: the access check is skipped for a new client (there are no assignments to check yet), and `deliver()` sends with **no Hub CC or Hub notification** since no Hub manages it. Everything downstream reads `shape()`'s `clientName`, which falls back to `newClientName`, so the list, email and PDF all work unchanged; `shape()` also returns `isNewClient`, which drives a "New client" badge in the list and a "(new client)" marker on the PDF/email Client line.

## Media Buying (channel negotiation intelligence, SUPER_ADMIN only)

`/media-buying` lets a SUPER_ADMIN track negotiated **discount %** (off rate card) and **bonus %** (free added-value airtime/space) per channel, both at the **agency level** and **per client**, year over year — distinct from `Property.bonusPct` (which is a deal-instance field on a specific client's channel, not a tracked negotiation term).

- **Schema:** `ChannelAgencyDeal` (`channelMasterId, year` unique) and `ChannelClientDeal` (`channelMasterId, clientId, year` unique). Saving the same year **updates** that row (typo-fix); saving a **new** year always inserts a new row — history is preserved structurally via the unique constraint + upsert-by-year, with no separate audit table (a v1 simplification; `PropertyHistory`-style change tracking could be added later if needed).
- **No page-level year filter** — the whole view is all-time. Channel selection uses a custom searchable combobox (type-ahead, grouped by medium) instead of a native `<select>` — fed by `GET /masterdata/channel-masters` (already active-only by default server-side) and additionally filtered client-side (`c.isActive !== false`) as a defensive guard against ever surfacing a deactivated/merged-away channel.
- **Channel Intelligence view** (`getChannelIntelligence`): pick a channel → **Agency-Level Deal Block** (full year history, color-coded trend arrow ▲/▼/→ comparing combined discount+bonus vs the prior year) + an all-time **Client Breakdown Table** (lifetime `totalSpend` per client from `ScheduleLog`, plus that client's most-recently-recorded `ChannelClientDeal` — `discountPct`/`bonusPct`/`dealYear` — which may be from an earlier year than their last actual purchase). Expanding a client row lazy-fetches `getClientChannelYearly`, which shows **spend + Avg Monthly Spend (spend ÷ 12) + discount % + bonus % per year** (one row per year that has either spend or a recorded deal).
- **"What this budget can get"** (in the Negotiation Planner panel): the buying unit types a monthly budget and sees **every `Property` already recorded on that channel costing no more than the typed figure**, richest first (`affordableProperties`, capped at 25, `cost > 0` so added-value properties don't fill the list), each with its client, category/type, cost, bonus % and — the point of it — **what the deal delivered**, from `Property.benefits` (chips like `50 × Trailers`, `20 × Mid intro`). Answers "for LKR 800K on Sirasa FM, what sponsorship and what benefits?" from real recorded deals. **Matched against the MONTHLY budget as typed, NOT `projectedYearlySpend`** — a property's `cost` is the price of that package, which is what the buyer is weighing up. A deal with no `benefits` recorded falls back to its `sponsorshipDetails` text. Included in the planner's Excel export as a "What This Budget Can Get" block. The data comes from the **Add property** form on a client's channel page (`ChannelDetailPage`), so the planner is only as good as what's entered there.
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

- **PWA (installable app)**: `web/public/manifest.webmanifest` (`name`/`short_name` **"Ogilvy Trading"**, `display: standalone`, navy theme, `icon-192/512` + a maskable icon — all generated brand marks in `web/public`) is linked from `index.html` along with `theme-color` and `apple-touch-icon` meta. Installing (Chrome "Install app" / iOS "Add to Home Screen") gives a standalone window whose OS chrome shows "Ogilvy Trading" instead of the URL. **No offline service worker** (deliberate — avoids stale-cache lock-in): the installed app loads from the server like a tab, so deploys are picked up on next open/refresh. To cover long-lived tabs/windows, `UpdateBanner.jsx` (rendered once in `App.jsx`) captures the running hashed entry bundle at load, re-fetches `index.html` on an interval + on tab focus, and shows a bottom "A new version is available · Refresh" prompt when the entry hash changes (no-ops in dev, where the entry isn't a hashed `/assets/index-*.js`).
- **Login** (`LoginPage.jsx`): deep-cosmic "mission control" — fixed full-screen navy starfield (drifting/twinkling stars, shooting stars), coral-lit planet, mouse parallax, orbit "O" brand mark, glass sign-in card. Scroll-safe with hidden scrollbar.
- **App shell** (`.app` in index.css): locked to `height:100vh; overflow:hidden` so only the content area scrolls (no window scrollbar). Sidebar uses the animated orbit logo mark.
- **Mobile / responsive** (media queries at the end of `index.css`): below **860px** the fixed sidebar becomes an off-canvas **drawer** — `Layout.jsx` holds a `navOpen` state, a `.menu-btn` hamburger in the topbar opens it, a `.sidebar-scrim` overlay closes it, and `go()` closes it on navigation; the topbar search is hidden and `.app` switches to `100dvh`. Below **560px** the breadcrumb and the topbar username block (`.topbar-user-meta`) are hidden and the stat grid drops to 2-up. Charts reflow automatically because every Recharts chart is wrapped in `ResponsiveContainer` inside grids that use `repeat(auto-fit, minmax(...))`; wide tables scroll horizontally (`.tbl-wrap{overflow-x:auto}`, and the Forecasting Insights `Card` wraps its body in an `overflow-x:auto` div since those tables aren't in `.tbl-wrap`).
- **Dashboard / content pages:** light, card-based design system (white cards `#fff`/`#E5E8ED`/14px radius, navy+coral, Spline Sans Mono figures, uppercase table heads, trend chips). Dashboard wires real analytics; pages restyled to match.
- **Apps Script emails** (`appscript/Code.gs`): branded with the Ogilvy Orbit lockup via shared header/footer/CTA/callout helpers. **Editing `Code.gs` in the repo does not update the live service** — it must be redeployed in the Google Apps Script project.

## Recent Feature Updates (current iteration)

> A full audit of these (with severity-ranked findings and health snapshot) lives in `docs/SYSTEM_AUDIT.md`.

- **Role labels renamed (display-only):** Control Room / Boardroom / Hub / Desk for `SUPER_ADMIN`/`MANAGER`/`GROUP_HEAD`/`PLANNER` (enum unchanged). See the Roles table above.
- **Dashboards by role:** Executive Dashboard is **SUPER_ADMIN-only**; MANAGER lands on and navigates the **Deep Dashboard** (`HomeRedirect` in `App.jsx`, nav in `Layout.jsx`).
- **`MoneyInput` component** (`web/src/components/MoneyInput.jsx`): a text input that shows LKR amounts with **thousands separators while typing** and emits the raw numeric string. Now used for every LKR-entry field (Admin group revenue / client targets / agency & annual targets / commission / channel commitments, channel property cost, package rate, schedule value cells, planner budget). Forecasting entry + Overall Budget already had their own comma formatting.
- **Group Revenue = ANNUAL target ÷ 12:** the admin enters a single **annual** revenue target (`YearRevenueTarget.monthlyAmount` now holds the annual amount); the Revenue Achievement bar = annual ÷ 12 × months elapsed. **By-client revenue entry:** new `ClientRevenue` model (`@@unique([year,month,clientId])`) + a "By client" mode in the Group Revenue tab; a Hub head's donut total = the sum of their clients' `ClientRevenue.amount` when any exist, else their direct `GroupRevenue` figure (`getGroupContribution`; finance-only rows with `amount` null are skipped in the roll-up). Roster = Hub-assigned clients only (`GROUP_HEAD_CLIENT_OR`).
- **Rev. from finance + verification:** `ClientRevenue` also carries `revenueFromFinance` (a second full-LKR figure the admin enters per client alongside "Revenue (LKR)" in the same by-client grid — `amount` is now nullable so a row can hold either/both; both blank clears the row) and a group-head **verification** of that finance figure: `verifyStatus` (`RevenueVerifyStatus` PENDING/VERIFIED/DISPUTED), `verifiedAmount`, `verifyReason`, `verifiedById`/`verifiedAt`. The admin by-client grid (`AdminPage`) shows both amount columns + a verification badge and has an **Export** button (client-side SheetJS). `setGroupRevenue` accepts `clientFinanceAmounts` alongside `clientAmounts` and only overrides a field that was actually sent; changing `revenueFromFinance` resets that client's verification to PENDING. Group heads verify from the **Rev Verification** button in the Spend Analytics hero (`RevVerificationModal`, GROUP_HEAD + SUPER_ADMIN): they see only their own clients (via `getAccessibleClientIds`; admin sees all), pick any past month with a finance figure (`availableMonths`), and **Confirm** (→ VERIFIED, `verifiedAmount` = finance) or **Dispute** with a corrected amount + required reason (→ DISPUTED). Backed by `GET/POST /api/revenue/verification` (`revenueVerification.controller.js`, `revenue.routes.js`). Only rows with a non-null `revenueFromFinance` surface for verification. **Negatives:** every Revenue-by-Hub money field (per-hub, per-agency, per-client Revenue, Rev. from finance) accepts **negative and 0** values as real stored figures — only a BLANK field clears the row/entry (`keepNum` in `setGroupRevenue`; the old `<= 0` → delete clamp is gone). `MoneyInput` also reads accounting parentheses (`(1200)` → -1200). Totals sum NET. **By-Hub auto-fill:** as the admin fills the By-client Revenue grid, each Hub head's figure auto-fills with the live sum of that head's clients' Revenue (`AdminPage` effect on `grClientAmounts`), but stays editable — a manual override sticks until a client amount changes again. **Admin grid lists EVERY client** (not just the active Hub roster): `listGroupRevenue`'s by-client query has no `isActive`/`GROUP_HEAD_CLIENT_OR` filter, so the admin can always enter revenue for an **inactive** client (e.g. a paused account like Mobitel, badged **Inactive**) or one with **no Hub head** (grouped under **Unassigned** with a red **"No Hub head"** flag, sorted last). Each client row carries `isActive` + `hasHead`. This is admin-only — **Forecasting and Rev Verification stay active+assigned** (a Hub head does NOT see their inactive clients there; the admin manages those clients' revenue while paused). The by-client Excel export gains a Status (Active/Inactive) column. **Auto-save:** editing a client's Revenue/Rev.-from-finance auto-saves that client (debounced ~700ms + flush on blur, `autoSaveClient`/`scheduleClientSave`) with a per-row saving-spinner/green-check mark — no Save-button click needed. **Excel import:** an **Import** button on the by-client section parses a workbook with **Client / Revenue / Rev. from finance** columns (`onImportFile`, SheetJS), auto-matches each name to the Hub roster (Dice-bigram fuzzy `suggestClients`), and opens a review modal — unmatched/low-confidence rows show a **"did you mean?"** client picker (or Skip) the admin resolves before importing; parenthesised amounts like `(1,000)` import as **−1000** (`parseAccountingAmount`). Confirm posts matched rows via `clientAmounts`/`clientFinanceAmounts` and re-fetches.
- **Channel commitment deal groups:** new `ChannelCommitmentGroup` model (name, type, period, one monthly/total target, `channelMasterIds Int[]`). One target across several channels (e.g. a media-group buy); achievement = the COMBINED `ScheduleLog` spend of every member channel. Admin CRUD at `/admin/commitment-groups`; the Executive Dashboard Channel Commitments tracker renders each group as one combined row (`getChannelCommitments` emits group rows with `rowKey`/`isGroup`/`memberNames`; a channel can carry both its own commitment and a group).
- **Agency target proration over active months:** the Agency Comparison cards (Executive Dashboard) and the Spend Analytics agency **Annual Achievement** prorate an agency's annual target over its OPERATING months, not from January — a mid-year starter (e.g. RedWorks from May) uses target ÷ (active months) × (active months elapsed), detected per agency from its first month with `ScheduleLog` data. Agency Comparison cards also: count Active Clients with ≥1 log **this year**, show a target progress bar, and are centered.
- **Medium Split compares vs the year's prior-months average:** the Executive Dashboard "This month" donut compares the latest month against the **average of Jan→prev month this year** (`getMediumSplit` returns `priorMonthsAvg`/`priorAvgLabel`), not the immediately preceding month.
- **Full DB download + restore:** `GET /api/admin/backup/download` streams a fresh gzipped dump; `POST /api/admin/backup/restore` (raw `.sql`/`.sql.gz` body) and `POST /api/admin/backup/restore-drive` restore the whole DB via **`psql`** (drops+recreates `public` then replays — DESTRUCTIVE full replace, `PSQL_PATH` overrides). UI in Admin → Backup. All SUPER_ADMIN.
- **Media packages:** line items are now **Sponsorship + Package rate** (the `label`/`rate` columns, relabelled). **Send to ANY account grouped by role** (picker groups Control Room / Boardroom / Hub / Desk, per-role "Select all"); the `/packages/inbox` + respond routes are open to any authenticated account and scope the interested-clients picker by the recipient's own role. **Proposal deadline removed** from the form + email (the nullable `deadline` column + dormant `deactivateExpiredPackages` remain; see audit L2). Emails use "Sponsorship / Package Rate" (needs an Apps Script redeploy).
- **Admin Channels usage export:** each channel row has a **download** action exporting that channel's schedule-log rows to Excel (reuses `GET /reports/schedule-logs?channelMasterId=&groupBy=all&format=excel`). The **Usage** count is a filtered relation count (`scheduleLogs: { where: { isDeleted:false } }`) so it matches the export.
- **Admin → Database tab** (SUPER_ADMIN): groups **Client Records** + **Errors** (the Errors view moved under it from its own top-level tab). **Client Records** picks a client (optionally narrowed by agency), shows what is stored for it (live row count, total schedule value, month range + per-month table, upload-batch and brand counts) and can **wipe every record for that client** so it can be re-uploaded from scratch after a brand rename/restructure — `GET /api/admin/client-records?clientId=` (`getClientRecordSummary`) + `POST /api/admin/client-records/purge` (`purgeClientRecords`, body `{clientId, confirmName}`; the typed name must match the client name exactly). The purge is the same **soft delete** batch-delete/replace-on-import use (`isDeleted`/`deletedById`/`deletedAt`), so rows stop counting everywhere and stop blocking re-upload as duplicates (`splitDuplicates` only matches `isDeleted:false`) while staying recoverable in the DB.
- **Error capture + visibility:** the axios interceptor (`web/src/lib/api.js`) now also reports **4xx responses** — the server's `error`/`message` is the exact text the UI shows the user — as `${shown} — ${METHOD} ${url} (HTTP ${status})`, skipping 401 (token churn) and 5xx (already logged server-side by the backend). In the Errors table **every** row is expandable (it used to require a stack), and the expanded panel leads with the **full message shown to the user**, then when/user/where/browser context, then the stack.
- **Sidebar brand logo:** dropping `web/public/brand-logo.png` (preferred — transparent, sits better on the navy sidebar) or `brand-logo.jpg` replaces the animated orbit lockup in `Layout.jsx`. Candidates are tried in order (`BRAND_LOGOS`) and each `onError` advances to the next; when none loads, the orbit mark + "Ogilvy ORBIT" wordmark render exactly as before. Styling is `.brand-logo` in `index.css` (max-height 44px, `object-fit: contain`).
- **Report export scoping:** `/api/reports/*` enforce agency + client access via `accessibleClientScope` (SUPER_ADMIN unrestricted, else the caller's accessible client ids).
- **Spend Analytics:** a MANAGER with a single accessible agency gets it auto-selected; the Client Targets section is filtered by the agency/client filters; the "Top Clients by Spend" bar chart was removed.

## Known Gaps / Suggested Features

> Candidate work, not yet implemented:

- **Global topbar search is non-functional** — the search input in `Layout.jsx` is decorative (no handler/results). Either wire it to a search endpoint or remove it.
- **Two schedule-log surfaces:** `/api/database/*` (used by DatabasePage spreadsheet) and `/api/schedule-logs/*` (client-scoped CRUD). Overlapping; consider consolidating.
- **Campaign model** has controller/routes (`brand.controller.js`) but little/no UI surface.
- **No CI** — nothing runs `api`'s `node --test` suite automatically (Railway deploys straight from a push), and coverage is limited to pure/DB-free logic (profit, import matching). No frontend or endpoint tests.
- **Decision Center was removed** (nav, route, page, and `/api/decisions` backend) — do not re-add references.
- **Annotation layer & empty-state ghost charts** were proposed but not built.

### Recently implemented (do NOT re-report as gaps)

- **Team heads:** `Team.headUserId` (nullable, → a GROUP_HEAD user). Admin → Teams modal has a "Team Head" picker; assigning a client to a team via the existing client-chips picker moves it off any other team (`setTeamClients` in `admin.controller.js`), enforcing one team (and therefore one head) per client. Executive Dashboard's **Group Contribution** donuts (under Monthly Spend) show, by group head, **Budget** (schedule-log spend for the month before the latest data month, incl. an Unassigned slice) vs **Revenue** (admin-entered per head for the latest month, named heads only) (`/api/analytics/dashboard/group-contribution`) — alongside it, **Group Contribution vs Forecast** (`/api/analytics/dashboard/group-contribution-variance`) and the company-wide **Monthly Avg** by year (`/api/analytics/dashboard/monthly-avg-by-year`); see "Executive Dashboard" above for full computation semantics.
- **Forecasting & targets:** `AnnualTarget` (year, target millions, remoteMonth) + `MonthlyForecast` (year/month/client/channel/amountMillions) models; `Client.isActive`, `ChannelMaster.sortOrder`, `Notification.link` added. Executive Dashboard leads with an **Annual Achievement** horizontal bar (budget vs upto-month target vs actual+remote-month forecast, % badge) and a **Monthly Spend** line (remote month = forecast, orange dot) via `/api/analytics/dashboard/achievement` + `/forecast-monthly` (actuals ÷1e6 → millions). **Forecasting tab** (`/forecasting`, SUPER_ADMIN/GROUP_HEAD only — MANAGER has no access, since their only role here was the read-only history/variance views, now restricted to SUPER_ADMIN): group heads enter the upcoming month's per-channel allocations per accessible+active client (`/api/forecasting/*`); admins get full read/override access. The Clients view has an **"Export"** control (**SUPER_ADMIN only**: its own month dropdown — the upcoming month or any of the prior 12 — plus a button) that downloads the entered forecasts client-wise to Excel: a **By Client** summary sheet + a **Detail** sheet (client × channel × amount in full LKR + notes), via `GET /forecasting/export-entries?year=&month=` (`exportForecastEntries`, `SUPER_ADMIN` only, scoped by `accessibleClientIds` = all, any month allowed since it's read-only). Independent of the entry-month lock so any past month can be exported. **The forecast client roster (`listForecastClients`) and the Overall Budget roster (`listBudget`) only list clients assigned to a group head *for non-admins*; `SUPER_ADMIN` sees EVERY active client so an admin can enter a forecast/budget for any client** (the `OR: GROUP_HEAD_CLIENT_OR` filter is only applied when `req.user.role !== 'SUPER_ADMIN'`; `submitForecast`/`getForecastEntry` already allow SUPER_ADMIN any active client since `accessibleClientIds` returns null for them). The Insights "Client-wise Forecast" roster (`getInsightsSummary`) still uses `GROUP_HEAD_CLIENT_OR`. The roster is defined by the exported `GROUP_HEAD_CLIENT_OR` array in `forecasting.controller.js`, spread into the Client `where` as an `OR` so a client shows if it's linked to a group head through **any admin assignment path**: (1) on a `Team` with `headUserId` set, (2) on a `Team` with a `GROUP_HEAD` member, or (3) directly assigned to a `GROUP_HEAD` user via `UserClientAccess` (the Users-tab client chips). Branches 1–2 cover the Teams tab / "Assign Accounts to Heads" card; branch 2 also guarantees a GROUP_HEAD always sees their own team's clients even if `headUserId` was never explicitly picked; branch 3 covers admins who assign clients straight to a group-head user. Clients linked to no group head are treated as old/inactive and hidden from forecasting (the data-driven variance/accuracy/trend views are unaffected — they still surface whatever forecast/actual rows exist). including the Forecast vs Actual variance report (`/forecasting/variance`, `/forecasting/history`, both SUPER_ADMIN-only). The "upcoming month" (`nextMonth()` in `forecasting.controller.js`) rolls on the **15th of each month**: the 1st–14th shows the current calendar month for entry (e.g. through May 14th, "upcoming" = May); from the 15th onward it shows next month (May 15th onward → "upcoming" = June) — this is what non-admin roles always see, with no manual control. **SUPER_ADMIN can additionally target any month, not just the upcoming one** — a "Forecast month" dropdown (13 months: the upcoming month back through the prior 12) lets an admin backfill an already-passed month (e.g. enter June's actuals-as-forecast while July is the system's "upcoming" month) so it's available to **"Copy last month"** when later entering the next month. Backed by `resolveTargetMonth(req)` in `forecasting.controller.js`, which lets `?year=&month=` override `nextMonth()` for `listForecastClients`/`getForecastEntry`/`getPreviousForecast` **only when `req.user.role === 'SUPER_ADMIN'`** (group heads stay locked to the upcoming month everywhere); `submitForecast` already allowed SUPER_ADMIN to save any month server-side, this just exposes that in the UI for entry/prefill/copy too. Admin tabs: **Annual Targets**, client **active/hide** toggle, **Client/Channel Requests** (group heads request via `/api/forecasting/request-*`, admin approves under `/api/admin/*-requests`, notifications deep-link via `Notification.link`). Channels reuse `ChannelMaster` (seeded `sortOrder` for the fixed TV/Radio forecasting order); "group" scope reuses `getAccessibleClientIds`. **Entry-form channel grain** (`listForecastChannels` in `forecasting.controller.js`): TV, Radio, Cinema, OOH and Digital list every active `ChannelMaster` of that medium individually **plus an "Unspecified" catch-all row** (the medium's total bucket, returned as `cat.totalChannel`); Print stays a single "Print total" row (`TOTAL_ONLY_MEDIA`). A head fills the channels they can and drops the amount they can't split yet into **Unspecified** — the two are **additive**, so the medium's forecast = its channels + its Unspecified amount (no toggle, no mutual exclusivity). The seeded per-medium `TOTAL_BUCKETS` — `TV Total`, `Radio Total`, `Cinema`, `OOH`, `Digital`, `Print` — back the Unspecified/total rows and stay reconcile-exempt so every medium always has at least one entry row. The entry form shows a reminder to finalise the per-channel breakdown **before the 15th** (when the upcoming-month lock rolls over). `submitForecast` sends every row including the bucket (cleared ones as 0), and Insights/variance sum by medium so the bucket rolls into its medium correctly.
  - **Annual Achievement forecast-fill:** the `Actual upto [Month]` bar (`getAchievement` in `analytics.controller.js`) is a **stacked bar** of two segments rather than a single actual-only value — real actuals (green, up through the last month with `ScheduleLog` data) plus a **forecast-fill** segment (amber, `#F2A93B`) covering the gap month(s) between the last actual month and the pacing month, sourced from Group Head–submitted `MonthlyForecast` entries (the same source the Monthly Spend line already used for its remote-month dot). For an in-progress year the auto pacing month is capped at the current calendar month, so a forecast already submitted for a *future* month (the Forecasting tab collects the upcoming month, which rolls to next month on the 15th) never extends the bar past "this month". On the 1st of a new month this is a hard cutover with no code needed: once real `ScheduleLog` rows land for a month, `monthValue()` prefers them over the forecast automatically, so the forecast-fill segment for that month simply disappears next render — no gradual blending. New `getAchievement` response fields: `actualOnlyMillions`/`forecastFillMillions` (the two stacked segments — `actualMillions` still returns their sum, unchanged, so `achievementPct` continues to include the forecast-fill in its numerator), `forecastFillMonths`/`forecastFillLabel`/`actualRangeLabel` (for the tooltip breakdown), and a completeness check — `forecastFillSubmittedClients` = the distinct clients whose forecasts actually make up the forecast-fill total (every forecast in scope for the gap month(s), so the count can never contradict the money shown), and `forecastFillExpectedClients` = that submitter set UNIONed with the tracked roster (active clients assigned to a group head, via `GROUP_HEAD_CLIENT_OR`) so roster clients that haven't forecasted yet still surface. Clients who haven't submitted are excluded from the total (not zero-filled), and `forecastFillComplete: false` (submitted < expected) drives a ⚠ warning chip under the chart. Scoped only to this bar — the Monthly Spend line, YTD stat cards, and every other chart remain actual-only/unchanged.
  - **Forecasting Insights** (SUPER_ADMIN-only analytics suite, lives *inside* the `/forecasting` page — the admin view toggle is now **Clients | Insights**, no new nav item/route). Backed by `forecastInsights.controller.js` + `forecastInsights.routes.js` (mounted at the same `/api/forecasting` base path as `forecasting.routes.js`, every route `requireRole('SUPER_ADMIN')` — stricter than the entry endpoints' `SUPER_ADMIN, GROUP_HEAD`). A shared `resolveInsightFilters(req)` parses `?year&month&agencyId&clientId&medium&channelMasterId&headUserId` into Prisma where-fragments (forecast from `MonthlyForecast`, actual from `ScheduleLog` scoped `isDeleted: false` — "aired/completed" needs no separate status field, that's the existing convention). Four endpoints feed a cross-cutting filter bar (Year/Month/Agency/Client/Medium/Channel/Account Manager — the **Account Manager dropdown lists `GROUP_HEAD` users** from `/admin/users`, filter param `headUserId`; `resolveInsightFilters`'s `clientsForHead(headUserId)` resolves that group head's managed clients via `getAccessibleClientIds(id, 'GROUP_HEAD')` — team membership + direct `UserClientAccess` — plus any team they head via `Team.headUserId`) + four sub-tabs: **`GET /insights/summary`** (`getInsightsSummary`, §1) — per-client total forecast + Submitted/Pending status, and a medium-level breakdown (TV/Radio/Print/Digital/Cinema/OOH totals + % of total) for the resolved month. **Both the client table and the medium breakdown are scoped to the same group-head roster** (active clients matching `GROUP_HEAD_CLIENT_OR`): the medium breakdown restricts its `MonthlyForecast` group-by to those clients' ids so its total always matches the client-wise total, instead of being inflated by forecasts from off-roster / old / inactive clients (the variance/accuracy/trend endpoints stay unrestricted by design — they surface whatever forecast/actual rows exist); **`GET /insights/variance?groupBy=client|channel`** (`getInsightsVariance`, §2+§3) — forecast-vs-actual at client grain or individual-`ChannelMaster` grain (TV/Radio/Cinema/OOH/Digital per-channel, Print as its single bucket row), `variance = actual − forecast`, `variancePct = variance/forecast*100` (null/"—" when forecast 0), flagged positive/negative/zero; **`GET /insights/accuracy`** (`getInsightsAccuracy`, §4) — totals + `forecastAccuracyPct = (1 − |variance|/forecast)*100` clamped 0–100, plus Best/Least-accurate forecasting client (by per-client accuracy, forecast > 0) and Highest-spending client; **`GET /insights/trend?months=12`** (`getInsightsTrend`, §5+§6) — month-by-month forecast/actual/variance/`growthPct` (actual vs prior month) walking back from the resolved month, plus top-10 channels & top-10 clients by actual spend over that range. Frontend (`ForecastingPage.jsx`, self-contained `InsightsTab` sub-component) renders sortable/searchable tables, accuracy stat cards, and Recharts (ComposedChart forecast-bars+actual-line, variance line, medium-split pie reusing `summary.channelBreakdown`, top-channels/clients bars), each sub-tab with **Excel/CSV/PDF export** (SheetJS multi-sheet workbooks; CSV via `XLSX.write(wb,{bookType:'csv'})` → Blob stacking all sheets; PDF via `jsPDF`+`autoTable(pdf,{...})` + `html2canvas` for the Trends charts) carrying the applied filters + totals. **Two clarified semantics (binding):** the **"Account Manager" filter = a `GROUP_HEAD` user** (the dropdown lists group heads; selecting one scopes to every client that group head manages — team membership, headed teams, or direct `UserClientAccess` — NOT `MonthlyForecast.submittedById`). The per-row **`accountManager` column** shows the managing group head's name, resolved by `accountManagerByClient` through the same paths as `GROUP_HEAD_CLIENT_OR` (team head `Team.headUserId`, else a `GROUP_HEAD` team member, else a directly-assigned `GROUP_HEAD` via `UserClientAccess`; "Unassigned" only when truly none) — so a client never shows "Unassigned" while a group head actually manages it; and "Highest Spending Client" / "Highest Revenue Client" collapse into **one** card (highest actual spend in the filtered period) since the app tracks no separate revenue/margin concept. The old single-month `getVariance`/`/variance` endpoint is left intact (no longer called by the UI) rather than deleted.
  - **Overall Budget tab** (`/forecasting`, a third top-level view toggle: **Clients | Overall Budget | Insights** — Overall Budget is visible to **GROUP_HEAD + SUPER_ADMIN**, unlike Insights which is admin-only). A per-client worksheet for the resolved month (same 15th-rollover `nextMonth()`/`resolveTargetMonth` rules as forecast entry — group heads locked to the upcoming month, SUPER_ADMIN can target any month) matching the client's reference sheet: **Client · Actual · Best · Commission · Billing (Last Month schedules)**. **Actual** is NOT stored — it's derived live from that client's `MonthlyForecast` total for the month (×1e6 → full LKR). **Best** and **Billing (last month)** are group-head-entered (inline number inputs, auto-saved on blur), stored full-LKR in the new `MonthlyBudget` model (`@@unique([year, month, clientId])`, `bestAmount`/`billingLastMonth` nullable Decimals; clearing both deletes the row). **Commission** is per-client agency remuneration from Admin → Clients: new `Client.commissionType` (`CommissionType` enum `COMMISSION`|`AOR`) + `Client.commissionValue` (Decimal) — COMMISSION renders as "4%", AOR as "LKR 50,000.00"; the Admin client Add/Edit modal has a type dropdown + value input (`PUT /admin/clients/:id/commission` → `setClientCommission`; empty type clears both; commission % capped at 100). Backed by `GET/POST /api/forecasting/budget` (`listBudget`/`submitBudget` in `forecasting.controller.js`, reusing the same `GROUP_HEAD_CLIENT_OR` roster + `accessibleClientIds` scoping as the entry grid, so a group head sees only their clients). The table has a live totals row (Actual/Best/Billing) and an Excel **Export** (SheetJS, mirrors the on-screen worksheet). `listAdminClients` + `listAgencies` now also select `commissionType`/`commissionValue` so the Admin Clients tab can show/seed them. **Insights counterpart:** the Forecasting **Insights** tab has a fifth **Overall Budget** sub-tab (SUPER_ADMIN-only, alongside Summary/Forecast-vs-Actual/Accuracy/Trends) backed by `GET /api/forecasting/insights/budget` (`getInsightsBudget` in `forecastInsights.controller.js`, driven by the Insights Year/Month + agency/client/account-manager filters, roster-scoped like the Summary so it refreshes live as group heads update forecasts/budgets). It renders two read-only tables in full LKR: **(1) by Account Manager** — one row per group head with Actual (their roster clients' total forecast = `MonthlyForecast` millions ×1e6), Best, and Billing-last-month (summed from `MonthlyBudget`), + totals; and **(2) Forecast by Channel** — total forecast per `ChannelMaster` (medium/channel filters apply here only, since Best/Billing aren't channel-scoped), + total. No commission column (per spec). Excel/CSV/PDF export via the shared `budgetSheets()`.

- **Profit tab** (`/profit`, **SUPER_ADMIN only**, finance screen): agency profit on **confirmed actual spend only** (`ScheduleLog` — forecasts live in the separate `MonthlyForecast` table and never enter profit). Commission is **snapshotted at entry** on each `ScheduleLog`: new columns `commissionTypeAtEntry` (`COMMISSION`|`AOR`|null), `commissionRateAtEntry` (Decimal — the % for COMMISSION, the fixed LKR fee for AOR), `commissionBackfilled` (bool). The snapshot is written at every insert path (`createScheduleLog` single, `bulkCreateScheduleLogs`, `importAllScheduleLogs`, `schedulelog.controller.js` create) via `commissionSnapshot(client)` (`utils/commission.js`) and is **immutable** — no update path writes these fields. `seed.js` runs an idempotent **backfill** on every deploy: fills the snapshot on historical rows from the client's *current* commission (only for clients that have one) and flags them `commissionBackfilled = true`; a genuine at-entry snapshot (`commissionBackfilled = false`, type non-null) is never re-touched. **Setting/updating a client's commission in Admin (`setClientCommission`) applies it to existing `ScheduleLog` rows per a `scope` param** so the Profit tab reflects it without waiting for a deploy: when the admin changes an existing client's commission, the client Add/Edit save flow (`AdminPage.jsx`) pops a **"Apply commission to records?"** choice — **`all`** rewrites every row for the client (snapshotted ones too — for correcting a mistyped rate) or **`forward`** touches nothing (only rows uploaded from now on snapshot the new rate). Absent a scope (new client / cleared / unchanged) the default fills only un-snapshotted or previously-backfilled rows, leaving genuine at-entry snapshots frozen. **Calculation (binding):** Revenue = `scheduleValue` (ex-VAT); buckets/filter are by **schedule (flight) month** (`scheduleMonth`) within a selected **year** (Jan–Dec) — a month with no uploaded rows shows 0, never fabricated. **Agency attribution is by the per-row `ScheduleLog.agency_id` SNAPSHOT (point-in-time), NOT the client's current `clients.agency_id`** — so a client that moved agencies (see Admin → "Move to another agency") keeps its historical revenue/profit under the agency it belonged to at the time. (Do not revert the profit SQL to `c.agency_id`.) The aggregation atom is `(client, schedule-month, type, snapshotted rate/fee)` — COMMISSION profit = `ROUND(SUM(scheduleValue) × rate/100, 2)`; **AOR profit = the fixed fee counted once per client-month** (per client's choice); no-commission spend still counts as Revenue with **0 profit** (so Total Revenue = all client-side spend). `getProfitSummary` also returns `availableYears` (distinct years with schedule data + current year) for the year picker. Every aggregate SUMs these atoms, so parts reconcile to the whole exactly at client/agency/month/total (unit-tested). All aggregation is SQL (`profit.controller.js` via `prisma.$queryRaw`, `Prisma.sql` fragments); the pure JS mirror + reconciliation/immutability/role tests live in `services/profit.service.js` + `tests/` (`npm test` → `node --test`; the reconciliation test runs without a DB). Endpoints: `GET /api/profit/{summary,monthly,by-agency,by-client,by-commission-type,client-breakdown,details}` (all `SUPER_ADMIN`). `getProfitSummary` also returns **period-aligned YoY**: `prevRevenue`/`prevProfit`/`revenueYoYPct`/`profitYoYPct` compare the current selection's **Jan→latest-data-month** against the prior year's **same** month window (via `MAX(ym)` on the current-year atoms + a `monthStart`/`monthEnd` override on `whereFragment`), plus `clientCount`, `avgProfitPerClient`, and `comparisonThroughMonth` (so a mid-year 2026 shows "2026 Jan-Jun vs 2025 Jan-Jun", never partial-vs-full). `getProfitByCommissionType` returns revenue/profit/client counts split across the three buckets (`COMMISSION`/`AOR`/`NONE`) for the commission-mix donut. Frontend `ProfitPage.jsx` (route + `NAV_ADMIN` both `SUPER_ADMIN`-only): year + agency + multi-client filters and an **Excel export** (client-side SheetJS: Summary / Monthly / By Agency / By Client sheets, **full LKR values**). **2 KPI cards** — Total Revenue and Total Profit shown **in millions** ("LKR 774.77M") with the full LKR figure on the line below and a period-aligned **YoY chip** — then charts: **Monthly Profit** (profit-only bars per schedule month, value labelled on each bar), **Cumulative Profit** (running-total area, stops after the last active month), **Commission Mix** (profit-share donut + legend with client counts/revenue), **Profit by Agency** (labeled bars, with the `Jan–<latest> <year>` period noted), **Profit by Client** (a ranked table of **every** client — rank · client + agency · revenue · profit), and a **Detailed Breakdown** — **one expandable row per client** (Client · Agency · Revenue · Commission · **Margin %** · Profit; commission cell shows the snapshot rate, "Mixed", or "Not set") — expanding a client reveals its **month-by-month** revenue/profit/margin. Backed by `GET /api/profit/client-breakdown` (`getProfitClientBreakdown`: per-(client,month) SUM of atoms grouped client-side into nested months, sorted client-side). LKR 2-dp tabular figures. (The older paginated per-atom `/api/profit/details` endpoint is retained but no longer used by the UI.)
- **Property dates:** `startDate`/`endDate` (null end = ongoing) on `Property`, editable in the Add/Edit form, shown on the channel table, Deep Dashboard, and property-report exports.
- **Property bonus:** `bonusValue`, `bonusCount`, plus `bonusPct`/`sponsorshipDetails` exist on the model; Deep Dashboard shows a computed **Bonus Yield %**; Channel Intelligence surfaces the `PropertyHistory` audit trail.
- **Dashboard year filter** (replaces the old decorative 30D/QTD/YTD toggle) + **all-time "All"** + latest-month anchoring (`refPeriod`).
- **Bulk multi-client import** (`/api/database/import-all`), **channel/client seed modules**, **OrbitLoader everywhere**, and the **new analytics charts** (medium mix shift, brand trend, tenure bubble, agency efficiency, flighting calendar, velocity gauge, sparklines, cross-filter, comparison mode).
- **Agencies list** returns `totalSpend` + `channelCount` per agency.
- **Auth hardening:** per-IP rate limiting on auth routes (`express-rate-limit`), per-account lockout (`User.failedLogins`/`lockedUntil`, 5 fails → 15 min), and revocable tokens via `User.tokenVersion` (bumped on logout / password change / reset; embedded as `tv` in JWTs and checked in `middleware/auth.js` + refresh). `changePassword` re-issues fresh tokens so the current device stays signed in.
- **Bulk-import dedupe:** `/api/database/bulk` and `/import-all` skip rows already present (key: client+channel+scheduleMonth+value, matched ONLY against existing non-deleted DB rows — brand/RO excluded, within-file repeats kept) and report a `duplicates` count + `duplicateRows` (1-based row numbers); the Database import UI shows "duplicates skipped" and lets the user download the failed/duplicate rows. `/import-all` also supports `dryRun:true` (returns new/duplicate/failed counts without writing — used to pre-check) and `allowDuplicates:true` (insert every row anyway). The bulk-import modal first dry-runs; if duplicates exist it asks the user to **Upload N new only** or **Re-upload everything**.
- **Correcting a label on already-imported rows — `updateMatched` (re-upload to fix Brand/RO):** the third re-upload mode, and the ONLY one that is safe for a partial file. Because the dedupe key excludes brand/RO, a row whose only change is a corrected brand still matches its original — so instead of skipping it (default) or soft-deleting the whole client-month around it (`replaceExisting`, destructive when the file is a subset), `updateMatched:true` **overwrites just that label on the matched row in place**, then inserts only the genuinely new rows. `scheduleValue` is *part of the match key*, so every touched row keeps the exact amount it already had, and `UPDATABLE_FIELDS` (`api/src/utils/importMatch.js`) hard-limits writes to `brandName`/`roNumber` — **no total in any aggregation can move** (unit-tested). Each change writes a `ScheduleLogEdit` audit row (`editNote: "Corrected via re-upload: <file>"`), same as a grid edit. Semantics: a **blank cell or an absent column means "no instruction", never "erase"** (otherwise re-uploading a sheet that omits the Brand column would wipe brands everywhere) — clearing a label stays a deliberate grid edit; when the file gives **two different values for otherwise-identical rows** the key is reported `ambiguous` and left untouched rather than guessed; comparison is whitespace-trimmed so no-op re-uploads generate no audit churn. The matching logic is a pure function (`planMatchedUpdates`, DB-free, `api/tests/import-match.test.js`) and owns `matchKey`, which `dedupeKey` now aliases so the duplicate check and the correction matcher can never drift apart. `updateMatched` is rejected (400) alongside `allowDuplicates`/`replaceExisting`. **Roles:** `import-all` stays SUPER_ADMIN; on `/database/bulk` the flag is **SUPER_ADMIN + GROUP_HEAD only** (403 for PLANNER, who can still fix their own cells in the grid). **UI:** the import dry-run reports `matchedRows`/`matchedUpdates`/`matchedUnchanged`/`matchedAmbiguous` + an `updateSample` (per-row *from → to* with the unchanged value shown), and the modal offers a green **"Fix N matched rows (+ add N new)"** as the primary action whenever corrections are detected — demoting "Upload only new" to ghost and warning against "Re-upload everything". The per-client upload/grid path has a **"Fix brand/RO on rows already uploaded"** checkbox (admin/group-head only) next to Save.
