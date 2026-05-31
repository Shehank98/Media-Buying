# Media Buying Records System

A full-stack application for managing media buying records across agencies, clients, and channels (TV, Radio, Print).

## Tech Stack

- **Backend:** Node.js + Express, PostgreSQL, Prisma ORM
- **Frontend:** React + Vite, Tailwind CSS
- **Auth:** JWT (access + refresh tokens), bcrypt for passwords
- **Export:** Excel (exceljs) and PDF (pdfkit) report generation
- **Deploy:** Railway (separate services for API, frontend, PostgreSQL)

## Project Structure

```
/api        — Express backend
  /prisma   — schema.prisma + seed.js
  /src      — routes, controllers, middleware, services
/web        — React frontend (Vite + Tailwind)
railway.json
```

## Setup

### Prerequisites

- Node.js 18+
- PostgreSQL 14+

### Environment Variables

Create `/api/.env` from `/api/.env.example`:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing access tokens |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens |
| `GOOGLE_SCRIPT_URL` | Google Apps Script webhook URL for password reset emails |
| `FRONTEND_URL` | Frontend URL for CORS (e.g., `http://localhost:5173`) |
| `PORT` | API server port (default: 3001) |

### Backend Setup

```bash
cd api
npm install
cp .env.example .env
# Edit .env with your database credentials

# Generate Prisma client and run migrations
npx prisma generate
npx prisma db push

# Seed the database
npm run seed
```

### Frontend Setup

```bash
cd web
npm install
npm run dev
```

### Running in Development

```bash
# Terminal 1 — API
cd api && npm run dev

# Terminal 2 — Frontend
cd web && npm run dev
```

The frontend dev server proxies `/api` requests to the backend at `http://localhost:3001`.

## Default Credentials

After seeding, log in with:

- **Email:** shehan.kavishka@ogilvy.com
- **Password:** Shehan@98

## User Roles

| Role | Permissions |
|------|-------------|
| `SUPER_ADMIN` | Full access across all agencies, manages users/teams/assignments |
| `MANAGER` | Read access to assigned agencies, export reports |
| `GROUP_HEAD` | Manage team, view team's clients |
| `PLANNER` | Add/edit channels and properties on assigned clients |

## API Routes

### Auth
- `POST /auth/login` — Login with email/password
- `POST /auth/refresh` — Refresh access token
- `POST /auth/logout` — Clear refresh token
- `POST /auth/forgot-password` — Request password reset email
- `POST /auth/reset-password` — Reset password with token
- `POST /auth/change-password` — Change own password

### Admin (SUPER_ADMIN only)
- `CRUD /admin/agencies` — Manage agencies
- `CRUD /admin/users` — Manage users
- `POST /admin/users/:id/agencies` — Assign agencies to user
- `POST /admin/users/:id/clients` — Assign clients to user
- `CRUD /admin/teams` — Manage teams
- `POST /admin/teams/:id/members` — Assign team members
- `POST /admin/teams/:id/clients` — Assign team clients

### Data
- `GET /agencies` — List accessible agencies
- `GET /agencies/:id/clients` — List clients in agency
- `CRUD /clients/:id/channels` — Manage channels
- `CRUD /channels/:channelId/properties` — Manage properties
- `GET /properties/:id/history` — Property audit trail

### Reports (SUPER_ADMIN, MANAGER)
- `GET /reports/channel/:channelId` — Channel report
- `GET /reports/client/:clientId` — Client report
- `GET /reports/agency/:agencyId` — Agency report
- All support `?format=excel` or `?format=pdf` query param

## Railway Deployment

1. Create a new Railway project
2. Add a PostgreSQL plugin
3. Create two services: `api` and `web`
4. Set root directory to `/api` and `/web` respectively
5. Configure environment variables on the `api` service
6. Set `FRONTEND_URL` to the `web` service URL
7. Deploy

## Password Reset Flow

1. User requests password reset via `/auth/forgot-password`
2. Backend generates a token and POSTs to the configured `GOOGLE_SCRIPT_URL`
3. Google Apps Script sends the email with the reset link
4. User clicks link, enters new password via `/auth/reset-password`
