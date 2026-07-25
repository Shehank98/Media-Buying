import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma.js';
import { getAccessibleClientIds, getAccessibleAgencyIds } from '../middleware/access.js';

// ─────────────────────────────────────────────────────────────────────────────
// Where the invoice / payment dates actually live
//
// IMPORTANT: schedule_logs has NO "Invoices Sent Date to Client" or "Payment
// Received Date" column. Those spreadsheet columns are kept verbatim, per row,
// in schedule_logs.import_extra (jsonb, keyed by the ORIGINAL sheet header) by
// the bulk importer — see CLAUDE.md "Data Ingestion / Bulk Import".
//
// So an effective date is resolved as:
//   1. financial_payment_records (the side table this module owns) if a row
//      exists for the schedule log — authoritative, including explicit NULLs, so
//      clearing a payment date sticks instead of falling back to the sheet;
//   2. otherwise, parsed out of import_extra.
//
// PATCH only ever writes to (1). schedule_logs is never modified.
// ─────────────────────────────────────────────────────────────────────────────

// ILIKE patterns matched against import_extra keys. Overridable per environment
// because the exact sheet headers vary between uploads.
const invoiceKeyPatterns = () => splitEnv(process.env.FINANCIAL_INVOICE_SENT_KEYS)
  || ['%invoice%sent%', '%date%invoice%client%', '%billing%date%'];
const paymentKeyPatterns = () => splitEnv(process.env.FINANCIAL_PAYMENT_RECEIVED_KEYS)
  || ['%payment%receiv%', '%received%payment%', '%date%paid%'];

function splitEnv(v) {
  const list = (v || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : null;
}

// Day/month order for ambiguous d/m/Y vs m/d/Y strings. Sri Lankan sheets are
// day-first, hence the default.
const dateFormat = () => (String(process.env.FINANCIAL_DATE_ORDER || 'DMY').toUpperCase() === 'MDY'
  ? 'MM/DD/YYYY' : 'DD/MM/YYYY');

// Set FINANCIAL_IMPORT_EXTRA_DATES=false once every date has been migrated into
// financial_payment_records — the jsonb scan is the expensive part of these
// queries and this removes it entirely.
const useImportExtra = () => String(process.env.FINANCIAL_IMPORT_EXTRA_DATES || 'true') !== 'false';

// Pulls the first import_extra value whose key matches one of `patterns` and
// coerces it to a date. Excel writes real date cells as serial numbers (the
// importer parses sheets without cellDates), so numbers in the plausible range
// are read as days since the 1900 epoch; ISO and d/m/Y strings are also handled.
// Anything else yields NULL rather than erroring.
function extraDateSql(patterns) {
  if (!useImportExtra()) return Prisma.sql`NULL::date`;
  return Prisma.sql`(
    SELECT CASE
      WHEN x.v ~ '^[0-9]+([.][0-9]+)?$' AND x.v::numeric BETWEEN 20000 AND 80000
        THEN (DATE '1899-12-30' + floor(x.v::numeric)::int)
      WHEN x.v ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])'
        THEN (substring(x.v from 1 for 10))::date
      WHEN x.v ~ '^[0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{4}$'
        THEN to_date(replace(x.v, '-', '/'), ${dateFormat()})
      ELSE NULL
    END
    FROM (
      SELECT btrim(e.value) AS v
        FROM jsonb_each_text(COALESCE(sl.import_extra, '{}'::jsonb)) e
       WHERE e.key ILIKE ANY (ARRAY[${Prisma.join(patterns)}]::text[])
         AND btrim(e.value) <> ''
       ORDER BY e.key
       LIMIT 1
    ) x
  )`;
}

// ── Status ───────────────────────────────────────────────────────────────────
export const STATUSES = ['not_yet_invoiced', 'paid', 'pending_0_30', 'pending_31_60', 'pending_61_90', 'overdue_90_plus'];

const STATUS_SQL = Prisma.sql`CASE
  WHEN invoice_sent_date IS NULL              THEN 'not_yet_invoiced'
  WHEN payment_received_date IS NOT NULL      THEN 'paid'
  WHEN (CURRENT_DATE - invoice_sent_date) <= 30 THEN 'pending_0_30'
  WHEN (CURRENT_DATE - invoice_sent_date) <= 60 THEN 'pending_31_60'
  WHEN (CURRENT_DATE - invoice_sent_date) <= 90 THEN 'pending_61_90'
  ELSE 'overdue_90_plus'
END`;

// ── Filters ──────────────────────────────────────────────────────────────────

// A filter value may be an id or a name (and may be a comma-separated list of
// either), so the frontend can pass whichever it has to hand.
function idOrName(raw, idCol, nameCol) {
  const vals = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  if (!vals.length) return null;
  const ids = vals.filter((v) => /^\d+$/.test(v)).map(Number);
  const names = vals.filter((v) => !/^\d+$/.test(v));
  const parts = [];
  if (ids.length) parts.push(Prisma.sql`${idCol} IN (${Prisma.join(ids)})`);
  if (names.length) parts.push(Prisma.sql`${nameCol} ILIKE ANY (ARRAY[${Prisma.join(names)}]::text[])`);
  return Prisma.sql`(${Prisma.join(parts, ' OR ')})`;
}

function textIn(raw, col) {
  const vals = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  if (!vals.length) return null;
  return Prisma.sql`${col} ILIKE ANY (ARRAY[${Prisma.join(vals)}]::text[])`;
}

// "2026-07-14" / "2026-07" / "2026/07" -> "2026-07"; anything else -> null.
function toYearMonth(v) {
  const m = String(v || '').trim().match(/^(\d{4})[-/](\d{1,2})/);
  return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}` : null;
}

function isIsoDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim()) && !Number.isNaN(Date.parse(v));
}

// Row-level scope. Mirrors the rest of the API: control_room sees everything,
// boardroom is limited to its assigned agencies, hub to its assigned clients.
// Set FINANCIAL_SCOPE_ALL_ROLES=true to let all three roles see every record
// (appropriate if the tracker is used as a company-wide finance tool).
async function scopeFragment(user) {
  if (user.role === 'control_room') return null;
  if (String(process.env.FINANCIAL_SCOPE_ALL_ROLES || 'false') === 'true') return null;

  if (user.role === 'boardroom') {
    const ids = await getAccessibleAgencyIds(user.id, 'MANAGER');
    return ids.length ? Prisma.sql`sl.agency_id IN (${Prisma.join(ids)})` : Prisma.sql`false`;
  }
  const ids = await getAccessibleClientIds(user.id, 'GROUP_HEAD');
  return ids.length ? Prisma.sql`sl.client_id IN (${Prisma.join(ids)})` : Prisma.sql`false`;
}

// Everything except the from/to period — the dashboard's 12-month collections
// series deliberately ignores the period while still honouring these.
async function baseFilters(req) {
  const q = req.query;
  const parts = [Prisma.sql`sl.is_deleted = false`];

  const scope = await scopeFragment(req.user);
  if (scope) parts.push(scope);

  const add = (f) => { if (f) parts.push(f); };
  if (q.agency) add(idOrName(q.agency, Prisma.raw('sl.agency_id'), Prisma.raw('a.name')));
  if (q.client) add(idOrName(q.client, Prisma.raw('sl.client_id'), Prisma.raw('c.name')));
  if (q.channel) add(idOrName(q.channel, Prisma.raw('sl.channel_master_id'), Prisma.raw('cm.name')));
  if (q.medium) add(textIn(q.medium, Prisma.raw('sl.medium')));
  if (q.mediaGroup) add(textIn(q.mediaGroup, Prisma.raw('sl.media_group')));
  if (q.scheduleMonth) add(textIn(q.scheduleMonth, Prisma.raw('sl.schedule_month')));
  if (q.invoiceMonth) add(textIn(q.invoiceMonth, Prisma.raw('sl.invoice_month')));
  if (q.roNumber) add(Prisma.sql`sl.ro_number ILIKE ${`%${String(q.roNumber).trim()}%`}`);

  const from = toYearMonth(q.scheduleMonthFrom);
  const to = toYearMonth(q.scheduleMonthTo);
  if (from) parts.push(Prisma.sql`sl.schedule_month >= ${from}`);
  if (to) parts.push(Prisma.sql`sl.schedule_month <= ${to}`);

  return parts;
}

// The dashboard's from/to. `dateBasis` picks what they mean:
//   schedule (default) - the flight month (schedule_logs.schedule_month), the
//                        app's universal period dimension and always present, so
//                        not-yet-invoiced records stay in the period;
//   invoice            - the effective invoice-sent date (excludes records with
//                        no invoice date at all).
function periodFragments(req) {
  const basis = String(req.query.dateBasis || 'schedule').toLowerCase();
  const from = req.query.from;
  const to = req.query.to;
  const pre = [];   // applied in the base CTE (raw columns)
  const post = [];  // applied after the effective dates are resolved

  if (basis === 'invoice') {
    if (isIsoDate(from)) post.push(Prisma.sql`invoice_sent_date >= ${from}::date`);
    if (isIsoDate(to)) post.push(Prisma.sql`invoice_sent_date <= ${to}::date`);
  } else {
    const f = toYearMonth(from);
    const t = toYearMonth(to);
    if (f) pre.push(Prisma.sql`sl.schedule_month >= ${f}`);
    if (t) pre.push(Prisma.sql`sl.schedule_month <= ${t}`);
  }
  return { basis, pre, post };
}

const AND = (parts) => (parts.length ? Prisma.join(parts, ' AND ') : Prisma.sql`true`);

// The one place row shape is defined. `scored` exposes the effective dates and
// the derived status; every endpoint below reads from it.
function scoredCte(where) {
  return Prisma.sql`
    base AS (
      SELECT sl.id,
             sl.agency_id, a.name AS agency,
             sl.client_id, c.name AS client,
             sl.channel_master_id, cm.name AS channel,
             sl.medium, sl.media_group,
             sl.ro_number, sl.brand_name,
             sl.schedule_month, sl.invoice_month,
             sl.schedule_value, sl.schedule_value_with_vat,
             (fpr.id IS NOT NULL) AS has_override,
             CASE WHEN fpr.id IS NOT NULL THEN fpr.invoice_sent_date     ELSE ${extraDateSql(invoiceKeyPatterns())} END AS invoice_sent_date,
             CASE WHEN fpr.id IS NOT NULL THEN fpr.payment_received_date ELSE ${extraDateSql(paymentKeyPatterns())} END AS payment_received_date,
             fpr.note, fpr.updated_at AS payment_updated_at
        FROM schedule_logs sl
        JOIN agencies a        ON a.id  = sl.agency_id
        JOIN clients c         ON c.id  = sl.client_id
        JOIN channel_masters cm ON cm.id = sl.channel_master_id
        LEFT JOIN financial_payment_records fpr ON fpr.schedule_log_id = sl.id
       WHERE ${where}
    ),
    scored AS (
      SELECT b.*, ${STATUS_SQL} AS status,
             CASE WHEN invoice_sent_date IS NOT NULL AND payment_received_date IS NULL
                  THEN (CURRENT_DATE - invoice_sent_date) END AS days_outstanding
        FROM base b
    )`;
}

const SORTS = {
  scheduleMonth: 'schedule_month',
  invoiceMonth: 'invoice_month',
  client: 'client',
  agency: 'agency',
  channel: 'channel',
  value: 'schedule_value',
  status: 'status',
  invoiceSentDate: 'invoice_sent_date',
  paymentReceivedDate: 'payment_received_date',
  daysOutstanding: 'days_outstanding',
};

// ── GET /api/financial/schedules ─────────────────────────────────────────────
export async function listSchedules(req, res) {
  try {
    const parts = await baseFilters(req);
    const { pre, post } = periodFragments(req);
    const where = AND([...parts, ...pre]);

    const after = [...post];
    if (req.query.status) {
      const wanted = String(req.query.status).split(',').map((s) => s.trim()).filter((s) => STATUSES.includes(s));
      if (!wanted.length) {
        return res.status(400).json({ error: `Unknown status. Expected one of: ${STATUSES.join(', ')}` });
      }
      after.push(Prisma.sql`status IN (${Prisma.join(wanted)})`);
    }
    if (req.query.unpaidOnly === 'true') after.push(Prisma.sql`payment_received_date IS NULL`);

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(1000, Math.max(1, parseInt(req.query.pageSize) || 100));
    const sortCol = SORTS[req.query.sortBy] || 'schedule_month';
    const sortDir = String(req.query.sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const filtered = Prisma.sql`SELECT * FROM scored WHERE ${AND(after)}`;

    const [rows, totals] = await Promise.all([
      prisma.$queryRaw`
        WITH ${scoredCte(where)}
        ${filtered}
        ORDER BY ${Prisma.raw(sortCol)} ${Prisma.raw(sortDir)} NULLS LAST, id DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      prisma.$queryRaw`
        WITH ${scoredCte(where)}, f AS (${filtered})
        SELECT COUNT(*)::int AS count,
               COALESCE(SUM(schedule_value), 0)::float8 AS value,
               COALESCE(SUM(schedule_value_with_vat), 0)::float8 AS value_with_vat
          FROM f`,
    ]);

    const t = totals[0] || {};
    return res.json({
      page,
      pageSize,
      total: t.count || 0,
      totalPages: Math.max(1, Math.ceil((t.count || 0) / pageSize)),
      totalValue: t.value || 0,
      totalValueWithVat: t.value_with_vat || 0,
      records: rows.map(serializeRow),
    });
  } catch (error) {
    console.error('[financial] listSchedules error:', error);
    return res.status(500).json({ error: 'Failed to load schedules' });
  }
}

const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

function serializeRow(r) {
  return {
    id: r.id,
    agencyId: r.agency_id,
    agency: r.agency,
    clientId: r.client_id,
    client: r.client,
    channelMasterId: r.channel_master_id,
    channel: r.channel,
    medium: r.medium,
    mediaGroup: r.media_group,
    roNumber: r.ro_number,
    brand: r.brand_name,
    scheduleMonth: r.schedule_month,
    invoiceMonth: r.invoice_month,
    scheduleValue: Number(r.schedule_value),
    scheduleValueWithVat: Number(r.schedule_value_with_vat),
    invoiceSentDate: ymd(r.invoice_sent_date),
    paymentReceivedDate: ymd(r.payment_received_date),
    status: r.status,
    daysOutstanding: r.days_outstanding == null ? null : Number(r.days_outstanding),
    // false = both dates still come from the imported spreadsheet; true = this
    // record has been edited through the financial API.
    hasPaymentRecord: !!r.has_override,
    note: r.note ?? null,
    paymentUpdatedAt: r.payment_updated_at || null,
  };
}

// ── PATCH /api/financial/schedules/:id/payment ───────────────────────────────
// Writes only to financial_payment_records. Because that row becomes
// authoritative for BOTH dates, the currently-effective invoice date is
// snapshotted into it on first write — otherwise recording a payment would
// discard the invoice date the spreadsheet supplied.
export async function updatePayment(req, res) {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid schedule id' });

    const body = req.body || {};
    if (!('paymentReceivedDate' in body) && !('invoiceSentDate' in body) && !('note' in body)) {
      return res.status(400).json({ error: 'paymentReceivedDate is required' });
    }

    const parseDate = (v, field) => {
      if (v === null || v === '' || v === undefined) return null;
      if (!isIsoDate(v)) throw new Error(`${field} must be a date in YYYY-MM-DD format`);
      return new Date(`${v}T00:00:00Z`);
    };

    let paymentDate;
    let invoiceDateOverride;
    try {
      paymentDate = 'paymentReceivedDate' in body ? parseDate(body.paymentReceivedDate, 'paymentReceivedDate') : undefined;
      invoiceDateOverride = 'invoiceSentDate' in body ? parseDate(body.invoiceSentDate, 'invoiceSentDate') : undefined;
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    // Existence + row-level access in one go: re-run the scoped query for this id.
    const scope = await scopeFragment(req.user);
    const where = AND([Prisma.sql`sl.id = ${id}`, Prisma.sql`sl.is_deleted = false`, ...(scope ? [scope] : [])]);
    const found = await prisma.$queryRaw`
      WITH ${scoredCte(where)}
      SELECT * FROM scored LIMIT 1`;
    if (!found.length) {
      // 404 either way — don't leak whether an out-of-scope record exists.
      return res.status(404).json({ error: 'Schedule record not found' });
    }
    const current = found[0];

    const record = await prisma.financialPaymentRecord.upsert({
      where: { scheduleLogId: id },
      create: {
        scheduleLogId: id,
        // Snapshot whatever the sheet said so it isn't lost.
        invoiceSentDate: invoiceDateOverride !== undefined ? invoiceDateOverride : current.invoice_sent_date,
        paymentReceivedDate: paymentDate !== undefined ? paymentDate : current.payment_received_date,
        note: body.note ?? null,
        updatedById: req.user.id,
      },
      update: {
        ...(invoiceDateOverride !== undefined ? { invoiceSentDate: invoiceDateOverride } : {}),
        ...(paymentDate !== undefined ? { paymentReceivedDate: paymentDate } : {}),
        ...('note' in body ? { note: body.note ?? null } : {}),
        updatedById: req.user.id,
      },
    });

    const after = await prisma.$queryRaw`
      WITH ${scoredCte(AND([Prisma.sql`sl.id = ${id}`]))}
      SELECT * FROM scored LIMIT 1`;

    return res.json({
      updated: true,
      record: serializeRow(after[0]),
      updatedBy: { id: req.user.id, name: req.user.name },
      updatedAt: record.updatedAt,
    });
  } catch (error) {
    console.error('[financial] updatePayment error:', error);
    return res.status(500).json({ error: 'Failed to update payment date' });
  }
}

// ── GET /api/financial/dashboard/summary ─────────────────────────────────────
// All aggregation happens in SQL — one pass for the period-filtered figures and
// one for the rolling 12-month collections series (which by definition ignores
// the from/to period but still honours agency/client/channel filters).
export async function dashboardSummary(req, res) {
  try {
    const parts = await baseFilters(req);
    const { basis, pre, post } = periodFragments(req);
    const where = AND([...parts, ...pre]);
    const after = AND(post);

    // Anchor the 12-month series on `to` when given, else the current month.
    const anchor = isIsoDate(req.query.to) ? req.query.to : new Date().toISOString().slice(0, 10);

    const [agg, collected] = await Promise.all([
      prisma.$queryRaw`
        WITH ${scoredCte(where)}, f AS (SELECT * FROM scored WHERE ${after})
        SELECT
          (SELECT COUNT(*)::int FROM f) AS record_count,
          (SELECT COALESCE(SUM(schedule_value), 0)::float8 FROM f) AS total_value,
          (SELECT COALESCE(SUM(schedule_value_with_vat), 0)::float8 FROM f) AS total_value_with_vat,
          (SELECT COALESCE(SUM(schedule_value), 0)::float8 FROM f WHERE status NOT IN ('paid', 'not_yet_invoiced')) AS total_outstanding,
          (SELECT COALESCE(SUM(schedule_value_with_vat), 0)::float8 FROM f WHERE status NOT IN ('paid', 'not_yet_invoiced')) AS total_outstanding_with_vat,
          (SELECT COALESCE(SUM(schedule_value), 0)::float8 FROM f WHERE status = 'not_yet_invoiced') AS total_uninvoiced,
          (SELECT COALESCE(SUM(schedule_value), 0)::float8 FROM f WHERE status = 'paid') AS total_paid,
          (SELECT COALESCE(json_agg(row_to_json(s) ORDER BY s.status), '[]'::json) FROM (
              SELECT status,
                     COUNT(*)::int AS count,
                     COALESCE(SUM(schedule_value), 0)::float8 AS value,
                     COALESCE(SUM(schedule_value_with_vat), 0)::float8 AS value_with_vat
                FROM f GROUP BY status) s) AS by_status,
          (SELECT COALESCE(json_agg(row_to_json(s) ORDER BY s.value DESC), '[]'::json) FROM (
              SELECT agency_id, agency,
                     COUNT(*)::int AS count,
                     COALESCE(SUM(schedule_value), 0)::float8 AS value,
                     COALESCE(SUM(schedule_value_with_vat), 0)::float8 AS value_with_vat
                FROM f WHERE status NOT IN ('paid', 'not_yet_invoiced')
               GROUP BY agency_id, agency) s) AS outstanding_by_agency,
          (SELECT COALESCE(json_agg(row_to_json(s) ORDER BY s.value DESC), '[]'::json) FROM (
              SELECT client_id, client, agency,
                     COUNT(*)::int AS count,
                     COALESCE(SUM(schedule_value), 0)::float8 AS value,
                     COALESCE(SUM(schedule_value_with_vat), 0)::float8 AS value_with_vat
                FROM f WHERE status NOT IN ('paid', 'not_yet_invoiced')
               GROUP BY client_id, client, agency) s) AS outstanding_by_client`,
      prisma.$queryRaw`
        WITH ${scoredCte(AND(parts))},
        months AS (
          SELECT to_char(d, 'YYYY-MM') AS month
            FROM generate_series(
              date_trunc('month', ${anchor}::date) - interval '11 months',
              date_trunc('month', ${anchor}::date),
              interval '1 month') d
        )
        SELECT m.month,
               COALESCE(SUM(s.schedule_value), 0)::float8 AS value,
               COALESCE(SUM(s.schedule_value_with_vat), 0)::float8 AS value_with_vat,
               COUNT(s.id)::int AS count
          FROM months m
          LEFT JOIN scored s
            ON s.payment_received_date IS NOT NULL
           AND to_char(s.payment_received_date, 'YYYY-MM') = m.month
         GROUP BY m.month
         ORDER BY m.month`,
    ]);

    const a = agg[0] || {};
    return res.json({
      filters: {
        from: req.query.from || null,
        to: req.query.to || null,
        dateBasis: basis,
        agency: req.query.agency || null,
        client: req.query.client || null,
        channel: req.query.channel || null,
        medium: req.query.medium || null,
        mediaGroup: req.query.mediaGroup || null,
      },
      totals: {
        recordCount: a.record_count || 0,
        totalValue: a.total_value || 0,
        totalValueWithVat: a.total_value_with_vat || 0,
        // Invoiced but unpaid. Uninvoiced spend is reported separately so the
        // two are never silently conflated.
        totalOutstanding: a.total_outstanding || 0,
        totalOutstandingWithVat: a.total_outstanding_with_vat || 0,
        totalUninvoiced: a.total_uninvoiced || 0,
        totalPaid: a.total_paid || 0,
      },
      byStatus: STATUSES.map((status) => {
        const row = (a.by_status || []).find((r) => r.status === status);
        return {
          status,
          count: row?.count || 0,
          value: row?.value || 0,
          valueWithVat: row?.value_with_vat || 0,
        };
      }),
      monthlyCollected: collected.map((r) => ({
        month: r.month,
        value: r.value,
        valueWithVat: r.value_with_vat,
        count: r.count,
      })),
      outstandingByAgency: (a.outstanding_by_agency || []).map((r) => ({
        agencyId: r.agency_id, agency: r.agency, count: r.count, value: r.value, valueWithVat: r.value_with_vat,
      })),
      outstandingByClient: (a.outstanding_by_client || []).map((r) => ({
        clientId: r.client_id, client: r.client, agency: r.agency, count: r.count, value: r.value, valueWithVat: r.value_with_vat,
      })),
    });
  } catch (error) {
    console.error('[financial] dashboardSummary error:', error);
    return res.status(500).json({ error: 'Failed to build dashboard summary' });
  }
}

// ── GET /api/financial/meta ──────────────────────────────────────────────────
// Filter-dropdown options, scoped to what the caller may see.
export async function meta(req, res) {
  try {
    const parts = await baseFilters({ query: {}, user: req.user });
    const rows = await prisma.$queryRaw`
      SELECT DISTINCT sl.agency_id, a.name AS agency, sl.client_id, c.name AS client,
             sl.channel_master_id, cm.name AS channel, sl.medium, sl.media_group
        FROM schedule_logs sl
        JOIN agencies a         ON a.id  = sl.agency_id
        JOIN clients c          ON c.id  = sl.client_id
        JOIN channel_masters cm ON cm.id = sl.channel_master_id
       WHERE ${AND(parts)}`;

    const uniq = (list, key) => [...new Map(list.map((x) => [x[key], x])).values()];
    const months = await prisma.$queryRaw`
      SELECT DISTINCT sl.schedule_month AS m FROM schedule_logs sl
       WHERE ${AND(parts)} ORDER BY m DESC`;

    return res.json({
      statuses: STATUSES,
      agencies: uniq(rows.map((r) => ({ id: r.agency_id, name: r.agency })), 'id').sort(byName),
      clients: uniq(rows.map((r) => ({ id: r.client_id, name: r.client })), 'id').sort(byName),
      channels: uniq(rows.map((r) => ({ id: r.channel_master_id, name: r.channel })), 'id').sort(byName),
      mediums: [...new Set(rows.map((r) => r.medium).filter(Boolean))].sort(),
      mediaGroups: [...new Set(rows.map((r) => r.media_group).filter(Boolean))].sort(),
      scheduleMonths: months.map((r) => r.m).filter(Boolean),
    });
  } catch (error) {
    console.error('[financial] meta error:', error);
    return res.status(500).json({ error: 'Failed to load filter options' });
  }
}

const byName = (a, b) => a.name.localeCompare(b.name);
