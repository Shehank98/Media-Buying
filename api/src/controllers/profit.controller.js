import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma.js';
import { blendedPct, round2 } from '../services/profit.service.js';

// ── Filters ──────────────────────────────────────────────────────────────────
// Buckets/ranges are by the SCHEDULE (flight) month — the month the spend ran in
// (schedule_logs.schedule_month, "YYYY-MM") — filtered to a single calendar year
// (Jan–Dec). A month with no uploaded ScheduleLog rows shows 0 (never fabricated).
function parseFilters(req) {
  const now = new Date();
  const year = /^\d{4}$/.test(String(req.query.year)) ? parseInt(req.query.year) : now.getFullYear();
  const agencyId = req.query.agencyId ? parseInt(req.query.agencyId) : null;
  const clientIds = req.query.clientId
    ? String(req.query.clientId).split(',').map((s) => parseInt(s)).filter(Number.isInteger)
    : [];
  return { year, agencyId, clientIds };
}

function whereFragment({ year, agencyId, clientIds }, { monthStart, monthEnd } = {}) {
  const parts = [
    Prisma.sql`sl.is_deleted = false`,
    Prisma.sql`sl.schedule_month >= ${monthStart || `${year}-01`}`,
    Prisma.sql`sl.schedule_month <= ${monthEnd || `${year}-12`}`,
  ];
  if (agencyId) parts.push(Prisma.sql`c.agency_id = ${agencyId}`);
  if (clientIds.length) parts.push(Prisma.sql`sl.client_id IN (${Prisma.join(clientIds)})`);
  return Prisma.join(parts, ' AND ');
}

// Atomic rows — the single source every aggregate sums from, so the numbers
// reconcile by construction. Revenue = SUM(schedule_value) (ex-VAT). Profit:
//   COMMISSION -> ROUND(revenue x rate%, 2)
//   AOR        -> the fixed fee, counted ONCE per (client, schedule-month, fee)
function atomsSql(filter) {
  return Prisma.sql`
    SELECT sl.client_id, c.agency_id,
           sl.schedule_month AS ym,
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
               sl.schedule_month AS ym,
               sl.commission_rate_at_entry AS crate,
               ROUND(SUM(sl.schedule_value), 2) AS revenue
          FROM schedule_logs sl JOIN clients c ON c.id = sl.client_id
         WHERE ${filter} AND sl.commission_type_at_entry = 'AOR'
         GROUP BY sl.client_id, c.agency_id, ym, sl.commission_rate_at_entry
      ) a
    UNION ALL
    -- Confirmed actual spend with NO commission snapshot: revenue counts, profit
    -- is 0 (never fabricated). Keeps "Total Revenue" = total client-side spend.
    SELECT sl.client_id, c.agency_id, sl.schedule_month AS ym,
           NULL::text AS ctype, NULL::numeric AS crate,
           ROUND(SUM(sl.schedule_value), 2) AS revenue, 0::numeric AS profit
      FROM schedule_logs sl JOIN clients c ON c.id = sl.client_id
     WHERE ${filter} AND sl.commission_type_at_entry IS NULL
     GROUP BY sl.client_id, c.agency_id, ym`;
}

const num = (v) => (v == null ? 0 : Number(v));

// Distinct calendar years that have any (non-deleted) schedule data, newest
// first, always including the current year so the picker is never empty.
async function availableYears() {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT left(schedule_month, 4) AS y
      FROM schedule_logs WHERE is_deleted = false AND schedule_month ~ '^[0-9]{4}-'
     ORDER BY y DESC`;
  const set = new Set(rows.map((r) => parseInt(r.y)).filter(Boolean));
  set.add(new Date().getFullYear());
  return [...set].sort((a, b) => b - a);
}

// GET /api/profit/summary — headline cards + the year list for the filter.
// Includes previous-year totals (same scope) for YoY deltas, plus the count of
// distinct clients that contributed revenue.
export async function getProfitSummary(req, res) {
  try {
    const f = parseFilters(req);
    // Current-year totals + the latest schedule month that has data (so the
    // prior-year comparison covers the SAME months — an in-progress year is
    // compared Jan..latest vs last year's Jan..same-month, not vs a full year).
    const rows = await prisma.$queryRaw`
      WITH atoms AS (${atomsSql(whereFragment(f))})
      SELECT COALESCE(SUM(revenue), 0) AS revenue, COALESCE(SUM(profit), 0) AS profit,
             COUNT(DISTINCT client_id) AS clients, MAX(ym) AS max_ym FROM atoms`;
    const revenue = num(rows[0]?.revenue);
    const profit = num(rows[0]?.profit);
    const clientCount = Number(rows[0]?.clients) || 0;
    const maxYm = rows[0]?.max_ym;                          // "YYYY-MM" or null
    const mm = maxYm && /^\d{4}-\d{2}$/.test(maxYm) ? maxYm.slice(5) : '12';
    const prevF = { ...f, year: f.year - 1 };
    const prevRows = await prisma.$queryRaw`
      WITH atoms AS (${atomsSql(whereFragment(prevF, { monthStart: `${prevF.year}-01`, monthEnd: `${prevF.year}-${mm}` }))})
      SELECT COALESCE(SUM(revenue), 0) AS revenue, COALESCE(SUM(profit), 0) AS profit FROM atoms`;
    const prevRevenue = num(prevRows[0]?.revenue);
    const prevProfit = num(prevRows[0]?.profit);
    const pctChange = (cur, prev) => (prev > 0 ? round2(((cur - prev) / prev) * 100) : null);
    return res.json({
      year: f.year, revenue, profit,
      blendedCommissionPct: blendedPct(profit, revenue),
      clientCount,
      avgProfitPerClient: clientCount ? round2(profit / clientCount) : 0,
      prevYear: f.year - 1, prevRevenue, prevProfit,
      // The month window the YoY covers, e.g. "Jan–Jun" for a mid-year 2026.
      comparisonThroughMonth: mm,
      revenueYoYPct: pctChange(revenue, prevRevenue),
      profitYoYPct: pctChange(profit, prevProfit),
      availableYears: await availableYears(),
    });
  } catch (error) {
    console.error('getProfitSummary error:', error);
    return res.status(500).json({ error: 'Failed to build profit summary', detail: error.message });
  }
}

// GET /api/profit/by-commission-type — revenue/profit/client split across the
// three commission buckets (COMMISSION, AOR, NONE) for the commission-mix chart.
export async function getProfitByCommissionType(req, res) {
  try {
    const f = parseFilters(req);
    const rows = await prisma.$queryRaw`
      WITH atoms AS (${atomsSql(whereFragment(f))})
      SELECT COALESCE(ctype, 'NONE') AS type,
             SUM(revenue) AS revenue, SUM(profit) AS profit,
             COUNT(DISTINCT client_id) AS clients
        FROM atoms GROUP BY COALESCE(ctype, 'NONE') ORDER BY profit DESC`;
    return res.json({
      types: rows.map((r) => ({ type: r.type, revenue: num(r.revenue), profit: num(r.profit), clients: Number(r.clients) || 0 })),
    });
  } catch (error) {
    console.error('getProfitByCommissionType error:', error);
    return res.status(500).json({ error: 'Failed to build commission mix', detail: error.message });
  }
}

// GET /api/profit/monthly — profit per schedule (flight) month.
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

// GET /api/profit/client-breakdown — the Detailed Breakdown: one row per client
// (year totals + commission) with a nested month-by-month revenue/profit list.
export async function getProfitClientBreakdown(req, res) {
  try {
    const f = parseFilters(req);
    const filter = whereFragment(f);
    const [rows, commRows] = await Promise.all([
      prisma.$queryRaw`
        WITH atoms AS (${atomsSql(filter)})
        SELECT atoms.client_id, cl.name AS client, ag.name AS agency, atoms.ym,
               SUM(atoms.revenue) AS revenue, SUM(atoms.profit) AS profit
          FROM atoms JOIN clients cl ON cl.id = atoms.client_id JOIN agencies ag ON ag.id = atoms.agency_id
         GROUP BY atoms.client_id, cl.name, ag.name, atoms.ym`,
      // Distinct commission snapshots per client, to label the rate column.
      prisma.$queryRaw`
        SELECT DISTINCT sl.client_id, sl.commission_type_at_entry AS ctype, sl.commission_rate_at_entry AS crate
          FROM schedule_logs sl JOIN clients c ON c.id = sl.client_id WHERE ${filter}`,
    ]);

    // One commission label per client: the single snapshot if uniform, else "MIXED".
    const commByClient = new Map();
    for (const r of commRows) {
      if (!r.ctype) continue;
      const list = commByClient.get(r.client_id) || [];
      list.push({ ctype: r.ctype, crate: r.crate == null ? null : Number(r.crate) });
      commByClient.set(r.client_id, list);
    }
    const commissionOf = (cid) => {
      const list = commByClient.get(cid) || [];
      if (!list.length) return { commissionType: null, commissionValue: null };
      const uniq = [...new Map(list.map((x) => [`${x.ctype}:${x.crate}`, x])).values()];
      return uniq.length === 1
        ? { commissionType: uniq[0].ctype, commissionValue: uniq[0].crate }
        : { commissionType: 'MIXED', commissionValue: null };
    };

    const byClient = new Map();
    for (const r of rows) {
      const g = byClient.get(r.client_id) || { clientId: r.client_id, client: r.client, agency: r.agency, revenue: 0, profit: 0, months: [] };
      const revenue = num(r.revenue), profit = num(r.profit);
      g.months.push({ month: r.ym, revenue, profit });
      g.revenue = round2(g.revenue + revenue);
      g.profit = round2(g.profit + profit);
      byClient.set(r.client_id, g);
    }

    const clients = [...byClient.values()].map((g) => {
      g.months.sort((a, b) => a.month.localeCompare(b.month));
      const comm = commissionOf(g.clientId);
      return { ...g, revenue: round2(g.revenue), profit: round2(g.profit), ...comm };
    }).sort((a, b) => b.profit - a.profit || b.revenue - a.revenue || a.client.localeCompare(b.client));

    return res.json({ clients });
  } catch (error) {
    console.error('getProfitClientBreakdown error:', error);
    return res.status(500).json({ error: 'Failed to build client breakdown', detail: error.message });
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
