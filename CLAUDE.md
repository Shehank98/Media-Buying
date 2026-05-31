# Media Buying Records System

## Architecture

Single Railway service: Express API + React SPA served from the same port.

```
/api      → Express backend (Node.js + Prisma + PostgreSQL)
/web      → React frontend (Vite + Tailwind CSS)
```

The API serves all routes under `/api/*`. The React build (`web/dist`) is served as static files for everything else, with SPA fallback via `/{*splat}`.

## Tech Stack

- **Backend:** Node.js, Express v5, Prisma ORM v5, PostgreSQL
- **Frontend:** React 19, Vite 8, Tailwind CSS v4, custom CSS design system
- **Auth:** JWT access tokens (15min) + refresh tokens (7 days), bcrypt passwords
- **Export:** ExcelJS (Excel), PDFKit (PDF)
- **Deploy:** Railway (single service), PostgreSQL plugin

## Running Locally

```bash
# 1. Install dependencies
cd api && npm install
cd ../web && npm install

# 2. Create api/.env
DATABASE_URL=postgresql://user:pw@localhost:5432/media_buying
JWT_SECRET=your-secret-here
JWT_REFRESH_SECRET=your-refresh-secret-here
PORT=3001

# 3. Run database migrations
cd api && npx prisma db push

# 4. Start API (terminal 1)
cd api && npm run dev

# 5. Start frontend (terminal 2)
cd web && npm run dev
# Opens at http://localhost:5173, proxies /api → localhost:3001
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (auto-set by Railway plugin) |
| `JWT_SECRET` | Yes | Access token signing secret |
| `JWT_REFRESH_SECRET` | Yes | Refresh token signing secret |
| `PORT` | No | Server port (Railway sets automatically) |
| `GOOGLE_SCRIPT_URL` | No | Google Apps Script webhook for password reset emails |
| `FRONTEND_URL` | No | CORS origin whitelist (comma-separated) |

## Railway Deployment

1. Create a new Railway project
2. Connect this GitHub repo
3. Add a **PostgreSQL** database plugin
4. Set environment variables: `JWT_SECRET`, `JWT_REFRESH_SECRET`
5. Deploy — Railway runs `npm run build` (builds both web + api) then `npm run start`

Railway auto-injects `DATABASE_URL` from the PostgreSQL plugin.

## Database Setup (Manual)

If `prisma db push` doesn't run automatically, run the SQL in `api/prisma/setup.sql` directly in the Railway PostgreSQL query editor.

Default admin account after setup:
- Email: `shehan.kavishka@ogilvy.com`
- Password: `Shehan@98`

## API Routes

```
POST   /api/auth/login
POST   /api/auth/refresh
POST   /api/auth/logout
POST   /api/auth/forgot-password
POST   /api/auth/reset-password
POST   /api/auth/change-password
GET    /api/auth/profile

GET    /api/agencies
GET    /api/agencies/:agencyId
GET    /api/agencies/:agencyId/clients
POST   /api/agencies/:agencyId/clients    (SUPER_ADMIN, GROUP_HEAD)

GET    /api/clients/:clientId
GET    /api/clients/:clientId/channels
POST   /api/clients/:clientId/channels
PUT    /api/clients/channels/:id
DELETE /api/clients/channels/:id

GET    /api/channels/:channelId
GET    /api/channels/:channelId/properties
POST   /api/channels/:channelId/properties

GET    /api/properties/:id/history
PUT    /api/properties/:id
DELETE /api/properties/:id

GET    /api/reports/agency/:agencyId      ?format=excel|pdf
GET    /api/reports/client/:clientId      ?format=excel|pdf
GET    /api/reports/channel/:channelId    ?format=excel|pdf

GET    /api/admin/agencies
POST   /api/admin/agencies
PUT    /api/admin/agencies/:id
DELETE /api/admin/agencies/:id

GET    /api/admin/users
POST   /api/admin/users
PUT    /api/admin/users/:id
DELETE /api/admin/users/:id
POST   /api/admin/users/:id/agencies
POST   /api/admin/users/:id/clients

GET    /api/admin/teams
POST   /api/admin/teams
PUT    /api/admin/teams/:id
DELETE /api/admin/teams/:id
POST   /api/admin/teams/:id/members
POST   /api/admin/teams/:id/clients
```

## Roles

| Role | Access |
|---|---|
| `SUPER_ADMIN` | Full access — manage agencies, users, teams, all data |
| `MANAGER` | Read-only across assigned agencies; can export reports |
| `GROUP_HEAD` | Manages team; all clients their team handles |
| `PLANNER` | Add/edit properties on assigned clients only |

## Design System

Custom CSS variables in `web/src/index.css`:
- Navy palette: `--navy-900` (#0A1729) through `--navy-100`
- Coral accent: `--coral-600` (#E85D24) through `--coral-50`
- Typography: Hanken Grotesk (UI), Spline Sans Mono (numbers)

Key components:
- `web/src/components/Icon.jsx` — SVG icons, Avatar, TypeBadge, RoleBadge, fmtLKR
- `web/src/components/Layout.jsx` — Sidebar + topbar shell
- `web/src/contexts/AuthContext.jsx` — JWT auth state + refresh logic

## Property Types

- `BOUGHT_AIRTIME` — paid airtime slot
- `SPONSORSHIP` — channel sponsorship
- `BONUS_COMMERCIAL` — bonus/added-value airtime
- `OTHER` — miscellaneous

Cost of `0` displays as "Added value" in the UI.
