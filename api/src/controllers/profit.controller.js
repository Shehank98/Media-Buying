import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma.js';
import { blendedPct } from '../services/profit.service.js';

// ── Filters ──────────────────────────────────────────────────────────────────
// All buckets/ranges are by ENTRY date (schedule_logs.created_at), per spec — the
// date the actual spend was recorded in the system, NOT the flight month.
function parseFilters(req) {
  const now = new Date();
  const start = req.query.startDate ? new Date(req.query.startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
  let endExclusive;
  if (req.query.endDate) {
    const e = new Date(req.query.endDate);
    endExclusive = new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1); // inclusive of the endDate day
  } else {
    endExclusive = new Date(now.getFullYear(), now.getMonth() + 1, 1); // through end of the current month
  }
  const agencyId = req.query.agencyId ? parseInt(req.query.agencyId) : null;
  const clientIds = req.query.clientId
    ? String(req.query.clientId).split(',').map((s) => parseInt(s)).filter(Number.isInteger)
    : [];
  return { start, endExclusive, agencyId, clientIds };
}

function whereFragment({ start, endExclusive, agencyId, clientIds }) {
  const parts = [
    Prisma.sql`sl.is_deleted = false`,
    Prisma.sql`sl.created_at >= ${start}`,
    Prisma.sql`sl.created_at < ${endExclusive}`,
  ];
  if (agencyId) parts.push(Prisma.sql`c.agency_id = ${agencyId}`);
  if (clientIds.length) parts.push(Prisma.sql`sl.client_id IN (${Prisma.join(clientIds)})`);
  return Prisma.join(parts, ' AND ');
}

// Atomic rows — the single source every aggregate sums from, so the numbers
// reconcile by construction. Revenue = SUM(schedule_value) (ex-VAT). Profit:
//   COMMISSION -> ROUND(revenue x rate%, 2)
//   AOR        -> the fixed fee, counted ONCE per (client, entry-month, fee)
function atomsSql(filter) {
  return Prisma.sql`
    SELECT sl.client_id, c.agency_id,
           to_char(sl.created_at, 'YYYY-MM') AS ym,
           'COMMISSION'::text AS ctype,
           sl.commission_rate_at_entry AS crate,
           ROUND(SUM(sl.schedule_value), 2) AS revenue,
           ROUND(SUM(sl.schedule_value) * sl.commission_rate_at_entry / 100.0, 2) AS profit
      FROM schedule_logs sl JOIN clients c ON c.id = sl.client_id
     WHERE ${filter} AND sl.commission_type_at_entry = 'COMMISSION'
     GROUP BY sl.client_id, c.agency_id, ym, sl.commission_rate_at_entry
    UNION ALL
    SELECT a.client_id, a.agency_id, a.ym, 'AOR'::text AS ctype, a.crate, a.revenue, a.crate AS profit
      FROM (
        SELECT sl.client_id, c.agency_id,
               to_char(sl.created_at, 'YYYY-MM') AS ym,
               sl.commission_rate_at_entry AS crate,
               ROUND(SUM(sl.schedule_value), 2) AS revenue
          FROM schedule_logs sl JOIN clients c ON c.id = sl.client_id
         WHERE ${filter} AND sl.commission_type_at_entry = 'AOR'
         GROUP BY sl.client_id, c.agency_id, ym, sl.commission_rate_at_entry
      ) a
    UNION ALL
    -- Confirmed actual spend with NO commission snapshot: revenue counts, profit
    -- is 0 (never fabricated). Keeps "Total Revenue" = total client-side spend.
    SELECT sl.client_id, c.agency_id, to_char(sl.created_at, 'YYYY-MM') AS ym,
           NULL::text AS ctype, NULL::numeric AS crate,
           ROUND(SUM(sl.schedule_value), 2) AS revenue, 0::numeric AS profit
      FROM schedule_logs sl JOIN clients c ON c.id = sl.client_id
     WHERE ${filter} AND sl.commission_type_at_entry IS NULL
     GROUP BY sl.client_id, c.agency_id, ym`;
}

const num = (v) => (v == null ? 0 : Number(v));

// GET /api/profit/summary — the 3 cards.
export async function getProfitSummary(req, res) {
  try {
    const f = parseFilters(req);
    const rows = await prisma.$queryRaw`
      WITH atoms AS (${atomsSql(whereFragment(f))})
      SELECT COALESCE(SUM(revenue), 0) AS revenue, COALESCE(SUM(profit), 0) AS profit FROM atoms`;
    const revenue = num(rows[0]?.revenue);
    const profit = num(rows[0]?.profit);
    return res.json({ revenue, profit, blendedCommissionPct: blendedPct(profit, revenue) });
  } catch (error) {
    console.error('getProfitSummary error:', error);
    return res.status(500).json({ error: 'Failed to build profit summary', detail: error.message });
  }
}

// GET /api/profit/monthly — profit per entry-month.
export async function getProfitMonthly(req, res) {
  try {
    const f = parseFilters(req);
    const rows = await prisma.$queryRaw`
      WITH atoms AS (${atomsSql(whereFragment(f))})
      SELECT ym, SUM(revenue) AS revenue, SUM(profit) AS profit FROM atoms GROUP BY ym ORDER BY ym ASC`;
    return res.json({ months: rows.map((r) => ({ month: r.ym, revenue: num(r.revenue), profit: num(r.profit) })) });
  } catch (error) {
    console.error('getProfitMonthly error:', error);
    return res.status(500).json({ error: 'Failed to build monthly profit', detail: error.message });
  }
}

// GET /api/profit/by-agency
export async function getProfitByAgency(req, res) {
  try {
    const f = parseFilters(req);
    const rows = await prisma.$queryRaw`
      WITH atoms AS (${atomsSql(whereFragment(f))})
      SELECT ag.id AS agency_id, ag.name AS agency, SUM(atoms.revenue) AS revenue, SUM(atoms.profit) AS profit
        FROM atoms JOIN agencies ag ON ag.id = atoms.agency_id
       GROUP BY ag.id, ag.name ORDER BY profit DESC`;
    return res.json({ agencies: rows.map((r) => ({ agencyId: r.agency_id, agency: r.agency, revenue: num(r.revenue), profit: num(r.profit) })) });
  } catch (error) {
    console.error('getProfitByAgency error:', error);
    return res.status(500).json({ error: 'Failed to build agency profit', detail: error.message });
  }
}

// GET /api/profit/by-client
export async function getProfitByClient(req, res) {
  try {
    const f = parseFilters(req);
    const rows = await prisma.$queryRaw`
      WITH atoms AS (${atomsSql(whereFragment(f))})
      SELECT cl.id AS client_id, cl.name AS client, ag.name AS agency,
             SUM(atoms.revenue) AS revenue, SUM(atoms.profit) AS profit
        FROM atoms JOIN clients cl ON cl.id = atoms.client_id JOIN agencies ag ON ag.id = atoms.agency_id
       GROUP BY cl.id, cl.name, ag.name ORDER BY profit DESC`;
    return res.json({ clients: rows.map((r) => ({ clientId: r.client_id, client: r.client, agency: r.agency, revenue: num(r.revenue), profit: num(r.profit) })) });
  } catch (error) {
    console.error('getProfitByClient error:', error);
    return res.status(500).json({ error: 'Failed to build client profit', detail: error.message });
  }
}

// GET /api/profit/details — paginated ground-truth rows (one per atom).
const SORT_COLS = { client: 'client', agency: 'agency', revenue: 'revenue', commission: 'crate', profit: 'profit', month: 'ym' };
export async function getProfitDetails(req, res) {
  try {
    const f = parseFilters(req);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 50));
    const offset = (page - 1) * pageSize;
    const sortCol = SORT_COLS[req.query.sortBy] || 'profit';
    const sortDir = String(req.query.sortDir).toLowerCase() === 'asc' ? Prisma.raw('ASC') : Prisma.raw('DESC');
    const orderBy = Prisma.raw(sortCol);

    const atoms = atomsSql(whereFragment(f));
    const [rows, countRows] = await Promise.all([
      prisma.$queryRaw`
        WITH atoms AS (${atoms})
        SELECT cl.name AS client, ag.name AS agency, atoms.revenue, atoms.ctype, atoms.crate, atoms.profit, atoms.ym
          FROM atoms JOIN clients cl ON cl.id = atoms.client_id JOIN agencies ag ON ag.id = atoms.agency_id
         ORDER BY ${orderBy} ${sortDir}, client ASC
         LIMIT ${pageSize} OFFSET ${offset}`,
      prisma.$queryRaw`WITH atoms AS (${atoms}) SELECT COUNT(*)::int AS n FROM atoms`,
    ]);

    const total = countRows[0]?.n || 0;
    return res.json({
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      rows: rows.map((r) => ({
        client: r.client,
        agency: r.agency,
        revenue: num(r.revenue),
        commissionType: r.ctype,
        commissionValue: num(r.crate),
        profit: num(r.profit),
        month: r.ym,
      })),
    });
  } catch (error) {
    console.error('getProfitDetails error:', error);
    return res.status(500).json({ error: 'Failed to build profit details', detail: error.message });
  }
}
