# Media Buying Records System

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
- **Charts:** Recharts (Bar, Pie, Line, Area, Composed)
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
│   │   ├── seed.js           # Seeds admin user, agencies, media groups, channels
│   │   └── phase1-migration.sql
│   └── src/
│       ├── index.js          # Express app entry point
│       ├── controllers/      # 13 controller files
│       ├── routes/           # 13 route files
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
- **ChannelType:** TV, RADIO, PRINT
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
| Team | Team groupings within agencies |
| TeamMember | Users assigned to teams (with role) |
| TeamClient | Teams assigned to clients |

### Channel & Property Models

| Model | Purpose |
|---|---|
| MediaGroup | Grouping of channels (e.g., "Maharaja Group") |
| ChannelMaster | Master registry of all TV/Radio/Print channels with aliases |
| Channel | Client-specific channel records |
| Property | Negotiated deals on channels (cost, bonus%, sponsorship details) |
| PropertyHistory | Audit trail for property changes (previousValues, newValues JSON) |

### Schedule & Upload Models

| Model | Purpose |
|---|---|
| ScheduleLog | Monthly execution records with scheduleValue, scheduleValueWithVat |
| UploadBatch | Batch upload file records with status tracking |
| UploadBatchRow | Individual rows in upload batches (raw + resolved data) |
| ScheduleLogEdit | Audit trail for schedule log edits |
| Brand | Brand names under clients |
| Campaign | Campaigns under brands |
| Notification | User notifications (type, title, message, isRead) |
| PasswordResetToken | Password reset tokens with SHA256 hash + expiry |

### Default Seed Data

- **Admin:** `shehan.kavishka@ogilvy.com` / `Shehan@98`
- **Agencies (3):** RedWorks Media, Ogilvy Media, Geometry Media
- **Media Groups (6):** Maharaja Group, Capital Maharaja Group, Hiru Group, Rupavahini Group, Independent, Other
- **Channel Masters:** 30+ predefined TV/Radio/Print channels with aliases

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
POST   /api/database/bulk                (AUTH + SUPER_ADMIN|GROUP_HEAD|PLANNER)
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
GET    /api/reports/schedule-logs        (AUTH + SUPER_ADMIN|MANAGER)
```

### Analytics
```
GET    /api/analytics/channel/:channelMasterId/summary           (AUTH + SUPER_ADMIN|MANAGER|GROUP_HEAD)
GET    /api/analytics/channel/:channelMasterId/monthly-spend
GET    /api/analytics/channel/:channelMasterId/clients
GET    /api/analytics/channel/:channelMasterId/property-history

GET    /api/analytics/dashboard/summary          (AUTH + SUPER_ADMIN|MANAGER)
GET    /api/analytics/dashboard/agency-comparison
GET    /api/analytics/dashboard/top-clients
GET    /api/analytics/dashboard/top-channels
GET    /api/analytics/dashboard/medium-split
GET    /api/analytics/dashboard/monthly-trend
GET    /api/analytics/dashboard/activity-log     (AUTH + SUPER_ADMIN)
GET    /api/analytics/dashboard/recent-uploads
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
| AdminPage | `/admin` | SUPER_ADMIN | User, team, agency, client management (tabbed) |

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
