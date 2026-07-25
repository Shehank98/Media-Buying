# Financial API (`/api/financial`)

An isolated, additive API for an external financial payment tracker (Lovable
frontend). It reads the same PostgreSQL database and authenticates against the
same `users` table as Orbit, but shares no routes, middleware, controllers or
tokens with the existing app.

**Nothing existing was modified** except two lines of wiring in
`api/src/index.js` (mount the router; skip the app's global CORS handler for
this one prefix so the two never both set `Access-Control-Allow-Origin`).

| Concern | File |
|---|---|
| Routes | `api/src/routes/financial.routes.js` |
| Login | `api/src/controllers/financialAuth.controller.js` |
| Data endpoints | `api/src/controllers/financial.controller.js` |
| Token sign/verify + role map | `api/src/services/financialAuth.service.js` |
| Auth middleware | `api/src/middleware/financialAuth.js` |
| CORS | `api/src/middleware/financialCors.js` |
| New table | `FinancialPaymentRecord` in `api/prisma/schema.prisma` |

Kill switch: `FINANCIAL_API_ENABLED=false` removes the whole surface.

---

## 1. Role mapping

The DB `Role` enum is **unchanged**. It maps onto the three financial role
strings using the app's own display names (see CLAUDE.md → Roles):

| Orbit role (DB enum) | Orbit UI label | Financial role |
|---|---|---|
| `SUPER_ADMIN` | Control Room | `control_room` |
| `MANAGER` | Boardroom | `boardroom` |
| `GROUP_HEAD` | Hub | `hub` |
| `PLANNER` | Desk | **none — 403 at login** |

The mapping is 1:1 for the first three. `PLANNER` is the odd one out: it has no
equivalent, so those accounts get `403 Your account does not have access to the
financial app` with valid credentials.

Roles are re-read from the database on every request, so a role change takes
effect immediately rather than when the token expires.

### Row-level scoping

By default each role sees the same rows it sees everywhere else in Orbit:

| Role | Sees |
|---|---|
| `control_room` | every record |
| `boardroom` | records for its assigned agencies (`UserAgencyAccess`) |
| `hub` | records for its assigned clients (teams + direct `UserClientAccess`) |

Set **`FINANCIAL_SCOPE_ALL_ROLES=true`** to let all three roles see every
record — appropriate if the tracker is a company-wide finance tool rather than a
per-account view. `PATCH` obeys the same scope: patching an out-of-scope record
returns `404` (not `403`, so it doesn't leak that the record exists).

---

## 2. Where the invoice/payment dates come from — read this

`schedule_logs` has **no** "Invoices Sent Date to Client" or "Payment Received
Date" column. The bulk importer keeps every non-core spreadsheet column verbatim
in `schedule_logs.import_extra` (jsonb, keyed by the original sheet header) — see
CLAUDE.md → Data Ingestion. Those two dates live in there.

An effective date is therefore resolved as:

1. **`financial_payment_records`** — the new side table this module owns. If a
   row exists it is authoritative for both dates, *including explicit NULLs*, so
   clearing a payment date sticks instead of silently reverting to the sheet.
2. Otherwise, **parsed out of `import_extra`**.

`PATCH` only ever writes to (1); `schedule_logs` is never written to. On the
first write for a record the currently-effective invoice date is snapshotted into
the side table, so recording a payment never discards the sheet's invoice date.

**Key matching.** `import_extra` keys are matched with case-insensitive `ILIKE`
patterns, overridable per environment:

* invoice sent — default `%invoice%sent%`, `%date%invoice%client%`, `%billing%date%`
  (`FINANCIAL_INVOICE_SENT_KEYS`)
* payment received — default `%payment%receiv%`, `%received%payment%`, `%date%paid%`
  (`FINANCIAL_PAYMENT_RECEIVED_KEYS`)

**Value parsing.** The importer parses workbooks without `cellDates`, so real
date cells arrive as Excel serial numbers. All of these are handled, and anything
unrecognised becomes `NULL` rather than erroring:

| Stored value | Read as |
|---|---|
| `45812` (Excel serial, 20000–80000) | `1899-12-30 + n days` |
| `2026-07-14` / `2026-07-14T00:00:00.000Z` | `2026-07-14` |
| `14/07/2026` or `14-07-2026` | day-first by default (`FINANCIAL_DATE_ORDER=MDY` to flip) |
| `N/A`, `""`, anything else | `null` → `not_yet_invoiced` |

Once every date has been migrated into `financial_payment_records`, set
**`FINANCIAL_IMPORT_EXTRA_DATES=false`**: it drops the per-row jsonb scan, which
is the expensive part of these queries.

---

## 3. Status

Computed server-side, in SQL, on every read. Never stored.

| Status | Rule |
|---|---|
| `not_yet_invoiced` | no invoice-sent date |
| `paid` | has a payment-received date |
| `pending_0_30` | unpaid, 0–30 days since invoice sent |
| `pending_31_60` | unpaid, 31–60 days |
| `pending_61_90` | unpaid, 61–90 days |
| `overdue_90_plus` | unpaid, more than 90 days |

Checked in order, so `paid` wins over any ageing bucket. "Days" is calendar days
against the database's `CURRENT_DATE`.

---

## 4. Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `FINANCIAL_JWT_SECRET` | **yes** | falls back to `JWT_SECRET` + a warning | Signs financial tokens. Must differ from `JWT_SECRET` — sharing it would make a 12h financial token valid against the whole Orbit API. |
| `ALLOWED_FINANCIAL_ORIGIN` | **yes** | *(unset = no cross-origin access)* | Comma-separated origin allow-list for `/api/financial/*`. `*` wildcards allowed, e.g. `https://*.lovable.app,https://tracker.yourdomain.com` |
| `FINANCIAL_TOKEN_TTL` | no | `12h` | Token lifetime (any `jsonwebtoken` expiry string). |
| `FINANCIAL_API_ENABLED` | no | `true` | `false` unmounts the whole API. |
| `FINANCIAL_SCOPE_ALL_ROLES` | no | `false` | `true` = all three roles see every record. |
| `FINANCIAL_INVOICE_SENT_KEYS` | no | see §2 | `import_extra` key patterns for the invoice date. |
| `FINANCIAL_PAYMENT_RECEIVED_KEYS` | no | see §2 | `import_extra` key patterns for the payment date. |
| `FINANCIAL_DATE_ORDER` | no | `DMY` | `DMY` or `MDY` for ambiguous `d/m/Y` strings. |
| `FINANCIAL_IMPORT_EXTRA_DATES` | no | `true` | `false` = ignore `import_extra`, use only `financial_payment_records`. |

`DATABASE_URL`, `JWT_SECRET` and `JWT_REFRESH_SECRET` are already set for the app
and are unchanged.

---

## 5. Endpoints

Base URL: `https://<your-orbit-host>/api/financial`

All money values are **LKR**, plain JSON numbers, 2-decimal precision.
All dates are `YYYY-MM-DD` strings (no timezones — the API never returns a
timestamp where a date is meant).

### `POST /auth/login` — public

```jsonc
// request
{ "username": "someone@ogilvy.com", "password": "..." }   // "email" also accepted
```
```jsonc
// 200
{
  "token": "eyJhbGciOi...",
  "role": "control_room",          // "hub" | "boardroom" | "control_room"
  "name": "Shehan Kavishka",
  "username": "someone@ogilvy.com",
  "expiresIn": "12h"
}
```

Errors: `400` missing fields · `401` bad credentials · `403` PLANNER, or the
account still has a forced password change pending · `429` account locked
(5 failed attempts → 15 min, shared with the main Orbit login) or rate limited
(30 attempts / 15 min / IP).

Send the token as `Authorization: Bearer <token>` on every other endpoint.
`401` on any call means re-login (expired, or revoked by an Orbit logout /
password change).

### `GET /auth/me`

```jsonc
{ "username": "someone@ogilvy.com", "name": "Shehan Kavishka", "role": "control_room" }
```

### `GET /meta`

Dropdown options, already scoped to what the caller may see.

```jsonc
{
  "statuses": ["not_yet_invoiced", "paid", "pending_0_30", "pending_31_60", "pending_61_90", "overdue_90_plus"],
  "agencies":    [{ "id": 1, "name": "Ogilvy Media" }],
  "clients":     [{ "id": 1, "name": "Maliban" }],
  "channels":    [{ "id": 1, "name": "Sirasa TV" }],
  "mediums":     ["RADIO", "TV"],
  "mediaGroups": ["MTV Channel (Pvt) LTD"],
  "scheduleMonths": ["2026-07", "2026-06"]
}
```

### `GET /schedules`

Query parameters — **all optional**, all comma-separated for multi-select, and
every id-ish one accepts **either an id or a name** (`client=1,Maliban` is valid):

| Param | Notes |
|---|---|
| `agency`, `client`, `channel` | id or name |
| `medium`, `mediaGroup` | name |
| `scheduleMonth`, `invoiceMonth` | `YYYY-MM` |
| `scheduleMonthFrom`, `scheduleMonthTo` | `YYYY-MM` range |
| `status` | one or more of the six statuses |
| `roNumber` | substring match |
| `unpaidOnly` | `true` = exclude paid |
| `page`, `pageSize` | default `1` / `100`, max `1000` |
| `sortBy` | `scheduleMonth` (default), `invoiceMonth`, `client`, `agency`, `channel`, `value`, `status`, `invoiceSentDate`, `paymentReceivedDate`, `daysOutstanding` |
| `sortDir` | `asc` \| `desc` (default) |

```jsonc
// 200
{
  "page": 1,
  "pageSize": 100,
  "total": 8,                 // rows matching the filter, not just this page
  "totalPages": 1,
  "totalValue": 3600000,      // filtered total, not just this page
  "totalValueWithVat": 4248000,
  "records": [
    {
      "id": 3,
      "agencyId": 1, "agency": "Ogilvy Media",
      "clientId": 1, "client": "Maliban",
      "channelMasterId": 2, "channel": "Shakthi FM",
      "medium": "RADIO",
      "mediaGroup": "MTV Channel (Pvt) LTD",
      "roNumber": "RO-3",
      "brand": "BrandX",
      "scheduleMonth": "2026-06",
      "invoiceMonth": "2026-06",
      "scheduleValue": 300000,
      "scheduleValueWithVat": 354000,
      "invoiceSentDate": "2026-07-15",
      "paymentReceivedDate": null,
      "status": "pending_0_30",
      "daysOutstanding": 10,        // null when not invoiced or already paid
      "hasPaymentRecord": false,    // false = dates still come from the sheet
      "note": null,
      "paymentUpdatedAt": null
    }
  ]
}
```

Errors: `400` unknown `status` · `401` · `403`.

### `PATCH /schedules/:id/payment`

Allowed for **all three roles** — with two caveats worth confirming (see §6):
the record must be in the caller's scope, and accounts flagged `readOnly` in
Orbit are refused, matching how every other write in the app behaves.

```jsonc
// request — paymentReceivedDate is the documented field
{ "paymentReceivedDate": "2026-07-24" }   // null or "" clears it
// also accepted, for convenience
{ "invoiceSentDate": "2026-06-15", "note": "cheque #4471" }
```
```jsonc
// 200 — the full re-computed record, so the UI can update a row without refetching
{
  "updated": true,
  "record": { /* same shape as a /schedules record; status recomputed */ },
  "updatedBy": { "id": 1, "name": "Admin One" },
  "updatedAt": "2026-07-25T07:29:47.847Z"
}
```

Errors: `400` bad id or a date that isn't `YYYY-MM-DD` · `401` · `403` read-only
account · `404` no such record, **or** it exists but is outside the caller's scope.

### `GET /dashboard/summary`

| Param | Notes |
|---|---|
| `from`, `to` | `YYYY-MM-DD` (or `YYYY-MM`) |
| `dateBasis` | `schedule` (default) or `invoice` — see below |
| `agency`, `client`, `channel`, `medium`, `mediaGroup` | same as `/schedules` |

`dateBasis=schedule` filters on the **flight month** (`schedule_month`) — the
app's universal period dimension, always present, so not-yet-invoiced records
stay inside the period. `dateBasis=invoice` filters on the effective invoice-sent
date instead, which necessarily excludes records that have no invoice date.

`monthlyCollected` deliberately **ignores `from`/`to`** (it is always the rolling
12 months ending at `to`, or at the current month) while still honouring the
agency/client/channel filters. All twelve months are always present, zero-filled.

```jsonc
// 200
{
  "filters": { "from": null, "to": null, "dateBasis": "schedule", "agency": null, "client": null, "channel": null, "medium": null, "mediaGroup": null },
  "totals": {
    "recordCount": 8,
    "totalValue": 3600000,
    "totalValueWithVat": 4248000,
    "totalOutstanding": 1500000,        // invoiced AND unpaid
    "totalOutstandingWithVat": 1770000,
    "totalUninvoiced": 800000,          // reported separately, never folded into outstanding
    "totalPaid": 1300000
  },
  // always all six, in this order, zero-filled
  "byStatus": [
    { "status": "not_yet_invoiced", "count": 2, "value": 800000,  "valueWithVat": 944000 },
    { "status": "paid",             "count": 3, "value": 1300000, "valueWithVat": 1534000 },
    { "status": "pending_0_30",     "count": 0, "value": 0,       "valueWithVat": 0 },
    { "status": "pending_31_60",    "count": 1, "value": 400000,  "valueWithVat": 472000 },
    { "status": "pending_61_90",    "count": 1, "value": 500000,  "valueWithVat": 590000 },
    { "status": "overdue_90_plus",  "count": 1, "value": 600000,  "valueWithVat": 708000 }
  ],
  // always 12 entries, oldest first
  "monthlyCollected": [
    { "month": "2025-08", "value": 0,      "valueWithVat": 0,      "count": 0 },
    { "month": "2026-07", "value": 500000, "valueWithVat": 590000, "count": 2 }
  ],
  // outstanding = invoiced and unpaid; biggest first
  "outstandingByAgency": [
    { "agencyId": 1, "agency": "Ogilvy Media", "count": 2, "value": 900000, "valueWithVat": 1062000 }
  ],
  "outstandingByClient": [
    { "clientId": 2, "client": "Keells", "agency": "Ogilvy Media", "count": 2, "value": 900000, "valueWithVat": 1062000 }
  ]
}
```

`totalUninvoiced + totalPaid + totalOutstanding === totalValue`, always.

Aggregation is entirely in SQL — one pass for the period-filtered figures, one
for the 12-month collections series.

---

## 6. Things to confirm before merging to main

1. **Row scoping for `hub` / `boardroom`.** Defaults to the same per-account
   scope as the rest of Orbit. If finance staff need company-wide numbers, set
   `FINANCIAL_SCOPE_ALL_ROLES=true`; if they're `control_room` anyway, leave it.
2. **Who may record payments.** All three roles can, per spec. The two guardrails
   added on top follow existing app conventions rather than the spec: scope
   (a `hub` user can only patch its own clients' records) and `User.readOnly`.
   Both are one-line changes if payments should be `control_room`-only.
3. **The exact `import_extra` header strings** in the client's workbooks. The
   default ILIKE patterns are best guesses; confirm against real data
   (`SELECT DISTINCT jsonb_object_keys(import_extra) FROM schedule_logs;`) and
   set `FINANCIAL_INVOICE_SENT_KEYS` / `FINANCIAL_PAYMENT_RECEIVED_KEYS`.
4. **`from`/`to` semantics** on the dashboard — currently the flight month.
   Switch the default to `dateBasis=invoice` if finance thinks in invoice dates.
