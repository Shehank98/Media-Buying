# System Audit — Ogilvy Orbit (Media Buying)

_Audit run against branch `claude/system-presentation-ppt-2s324q` (head `94a71d5`)._

## Health snapshot

- **Build:** `web` builds clean; all backend controllers `node --check` clean.
- **Tests:** `api/tests` = **7/7 pass** when `JWT_SECRET`/`JWT_REFRESH_SECRET` are set. Bare `npm test` shows 6/7 because `profit.snapshot.test.js` imports code that requires those env vars at load (see F4).
- **Analytics soft-delete hygiene:** every `ScheduleLog` aggregate/groupBy/count in `analytics.controller.js` spreads a base/scope object that includes `isDeleted: false` (35 occurrences) — no spend-inflation from deleted rows.

## Findings

Severity: **L** = low / cleanup, **C** = consistency / by-design (document, not a defect), **I** = info / known gap.

### L1 — Dead code: `parseDeadline()` unused
`api/src/controllers/package.controller.js` still defines `parseDeadline()` but has no callers after the proposal-deadline entry was removed. Safe to delete.

### L2 — Leftover deadline UI (dormant)
Deadlines can no longer be set, yet:
- `PackagesPage.jsx` still renders an **"Expired"** status-filter chip and expired styling.
- `MyPackagesPage.jsx` still renders **"Closed"** / past-deadline blocking states.
- `package.controller.js` still runs `deactivateExpiredPackages()` and computes `expired`.

All are **dormant for new packages** (no deadline is ever stored) and only affect legacy packages that already carried a deadline. Consider removing the Expired filter for a cleaner UI.

### L3 — `MediaPackage.category` legacy field
The `category` column plus its accept/return in create/update/get remains, though the package form dropped the field. Harmless legacy.

### L4 — `npm test` needs JWT env
`profit.snapshot.test.js` transitively imports `auth.service.js`, which throws at module load without `JWT_SECRET`/`JWT_REFRESH_SECRET`. Set dummy values in the `test` script (e.g. `JWT_SECRET=test JWT_REFRESH_SECRET=test node --test`) so a bare `npm test` is green. The DB-free reconciliation test already passes.

### C1 — Two "0 logs" definitions for channels
Admin → Channels **Usage** now counts only non-deleted logs (fixed this iteration). But `seed.js`'s zero-usage reconcile still uses `scheduleLogs: { none: {} }`, which counts **all** rows including soft-deleted. So a channel whose logs were all soft-deleted shows **"0 logs"** in Usage yet stays **Active** (the reconcile won't auto-deactivate it). Align the reconcile to `isDeleted:false` if you want the two to agree.

### C2 — Backup restore is a destructive full replace, needs `psql`
`POST /api/admin/backup/restore[-drive]` drops & recreates the `public` schema then replays the dump via **`psql`**. `nixpacks.toml` installs `postgresql-client` so `psql` exists at runtime (`PSQL_PATH` overrides). It replaces ALL data — the UI confirms first. Documented, not a defect.

### C3 — Client revenue overrides the head's direct figure
In `getGroupContribution`, a Hub head's per-client revenue (`ClientRevenue`) **overrides** their direct `GroupRevenue` figure for that month whenever any client entries exist. Intended (by-client rolls up), but worth remembering when both are entered.

### C4 — "Total Entries" vs "uploaded sheets" count mismatch
Rows created via the single-row "Add row" (`createScheduleLog`, `uploadBatchId: null`) or a paste-bulk save without a filename have **no upload batch**, so they count in the system's Total Entries but never appear under any sheet in "Recent uploaded sheets" (a batch-only view). Different populations, not lost data.

### I1 — Two schedule-log surfaces
`/api/database/*` (spreadsheet) and `/api/schedule-logs/*` (client-scoped CRUD) overlap. Consolidation candidate.

### I2 — Seed runs on every deploy
`seed.js` runs on every `npm run start`. Its reconciles are idempotent and null-fill-only (agency), but note: the zero-usage reconcile **re-deactivates** any active channel with no logs and no forecasts on each deploy — an admin-reactivated empty channel reverts next deploy (documented design).

### I3 — No CI
`npm test` is wired but there is no CI pipeline; deployment is Railway auto-deploy on push.

## Not reproduced / verified clean
- No missing `isDeleted` filters in analytics spend queries.
- Report exports (`/api/reports/*`) enforce agency + client scope via `accessibleClientScope`.
- Access control: Hub (GROUP_HEAD) client access is team-based and survives agency moves; client dashboard queries by `clientId` only (shows full history).
- Agency-target proration uses each agency's active months (mid-year starters correct).
