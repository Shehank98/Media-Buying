import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma.js';

// ═══════════════════════════════════════════════════════════════════════════
// Revenue by Billing
//
// The "Revenue by billing" tab of the Revenue page. Mirrors the schedule-value
// Profit tab's layout, but every figure comes from admin-entered per-client
// billing revenue — ClientRevenue.amount ("Revenue (LKR)" in Admin → Group
// Revenue → By client). Revenue-only: no commission/profit/margin concept.
//
// Buckets are by ClientRevenue.month within a calendar year. Amounts may be
// negative (credits/adjustments) or 0 — totals sum them NET. Agency attribution
// uses the client's CURRENT agency (billing is admin-entered, not snapshotted).
// SUPER_ADMIN only (enforced on the route).
// ═══════════════════════════════════════════════════════════════════════════

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
  const parts = [Prisma.sql`cr.year = ${year}`];
  if (monthStart != null) parts.push(Prisma.sql`cr.month >= ${monthStart}`);
  if (monthEnd != null) parts.push(Prisma.sql`cr.month <= ${monthEnd}`);
  if (agencyId) parts.push(Prisma.sql`c.agency_id = ${agencyId}`);
  if (clientIds.length) parts.push(Prisma.sql`cr.client_id IN (${Prisma.join(clientIds)})`);
  return Prisma.join(parts, ' AND ');
}

const num = (v) => (v == null ? 0 : Number(v));
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const ymOf = (year, m) => `${year}-${String(m).padStart(2, '0')}`;

// Distinct years that have any ClientRevenue, newest first, incl. current year.
async function availableYears() {
  const rows = await prisma.$queryRaw`SELECT DISTINCT year FROM client_revenues ORDER BY year DESC`;
  const set = new Set(rows.map((r) => Number(r.year)).filter(Boolean));
  set.add(new Date().getFullYear());
  return [...set].sort((a, b) => b - a);
}

// GET /api/profit/billing/summary
export async function getBillingSummary(req, res) {
  try {
    const f = parseFilters(req);
    const rows = await prisma.$queryRaw`
      SELECT COALESCE(SUM(cr.amount), 0) AS revenue,
             COALESCE(SUM(cr.revenue_from_finance), 0) AS finance_revenue,
             COUNT(DISTINCT cr.client_id) FILTER (WHERE cr.amount IS NOT NULL) AS clients,
             MAX(cr.month) AS max_m
        FROM client_revenues cr JOIN clients c ON c.id = cr.client_id
       WHERE ${whereFragment(f)}`;
    const revenue = round2(num(rows[0]?.revenue));
    const financeRevenue = round2(num(rows[0]?.finance_revenue));
    const clientCount = Number(rows[0]?.clients) || 0;
    const maxM = rows[0]?.max_m ? Number(rows[0].max_m) : 12;
    const prevF = { ...f, year: f.year - 1 };
    const prevRows = await prisma.$queryRaw`
      SELECT COALESCE(SUM(cr.amount), 0) AS revenue
        FROM client_revenues cr JOIN clients c ON c.id = cr.client_id
       WHERE ${whereFragment(prevF, { monthStart: 1, monthEnd: maxM })}`;
    const prevRevenue = round2(num(prevRows[0]?.revenue));
    const pctChange = (cur, prev) => (prev !== 0 ? round2(((cur - prev) / Math.abs(prev)) * 100) : null);
    return res.json({
      year: f.year,
      revenue,
      financeRevenue,
      clientCount,
      avgRevenuePerClient: clientCount ? round2(revenue / clientCount) : 0,
      prevYear: f.year - 1,
      prevRevenue,
      comparisonThroughMonth: String(maxM).padStart(2, '0'),
      revenueYoYPct: pctChange(revenue, prevRevenue),
      availableYears: await availableYears(),
    });
  } catch (error) {
    console.error('getBillingSummary error:', error);
    return res.status(500).json({ error: 'Failed to build billing summary', detail: error.message });
  }
}

// GET /api/profit/billing/monthly
export async function getBillingMonthly(req, res) {
  try {
    const f = parseFilters(req);
    const rows = await prisma.$queryRaw`
      SELECT cr.month AS m, SUM(cr.amount) AS revenue
        FROM client_revenues cr JOIN clients c ON c.id = cr.client_id
       WHERE ${whereFragment(f)} GROUP BY cr.month ORDER BY cr.month ASC`;
    return res.json({ months: rows.map((r) => ({ month: ymOf(f.year, Number(r.m)), revenue: round2(num(r.revenue)) })) });
  } catch (error) {
    console.error('getBillingMonthly error:', error);
    return res.status(500).json({ error: 'Failed to build monthly billing', detail: error.message });
  }
}

// GET /api/profit/billing/by-agency
export async function getBillingByAgency(req, res) {
  try {
    const f = parseFilters(req);
    const rows = await prisma.$queryRaw`
      SELECT c.agency_id AS agency_id, ag.name AS agency,
             SUM(cr.amount) AS revenue,
             COUNT(DISTINCT cr.client_id) FILTER (WHERE cr.amount IS NOT NULL) AS clients
        FROM client_revenues cr JOIN clients c ON c.id = cr.client_id JOIN agencies ag ON ag.id = c.agency_id
       WHERE ${whereFragment(f)} GROUP BY c.agency_id, ag.name ORDER BY revenue DESC`;
    return res.json({ agencies: rows.map((r) => ({ agencyId: r.agency_id, agency: r.agency, revenue: round2(num(r.revenue)), clients: Number(r.clients) || 0 })) });
  } catch (error) {
    console.error('getBillingByAgency error:', error);
    return res.status(500).json({ error: 'Failed to build agency billing', detail: error.message });
  }
}

// GET /api/profit/billing/by-client
export async function getBillingByClient(req, res) {
  try {
    const f = parseFilters(req);
    const rows = await prisma.$queryRaw`
      SELECT cr.client_id AS client_id, c.name AS client, ag.name AS agency, SUM(cr.amount) AS revenue
        FROM client_revenues cr JOIN clients c ON c.id = cr.client_id JOIN agencies ag ON ag.id = c.agency_id
       WHERE ${whereFragment(f)} GROUP BY cr.client_id, c.name, ag.name ORDER BY revenue DESC`;
    return res.json({ clients: rows.map((r) => ({ clientId: r.client_id, client: r.client, agency: r.agency, revenue: round2(num(r.revenue)) })) });
  } catch (error) {
    console.error('getBillingByClient error:', error);
    return res.status(500).json({ error: 'Failed to build client billing', detail: error.message });
  }
}

// GET /api/profit/billing/aor-monthly - company-wide AOR revenue per month for the
// year (from admin-entered AorRevenue lines). Not client/agency scoped — AOR has no
// client link — so only the year filter applies. Feeds the stacked AOR series on the
// Monthly Revenue chart and the "Total AOR Revenue" card.
export async function getAorMonthly(req, res) {
  try {
    const f = parseFilters(req);
    const rows = await prisma.$queryRaw`
      SELECT month AS m, SUM(amount) AS amount
        FROM aor_revenues WHERE year = ${f.year} GROUP BY month ORDER BY month ASC`;
    const months = rows.map((r) => ({ month: ymOf(f.year, Number(r.m)), amount: round2(num(r.amount)) }));
    const total = round2(months.reduce((s, r) => s + r.amount, 0));
    return res.json({ year: f.year, months, total });
  } catch (error) {
    console.error('getAorMonthly error:', error);
    return res.status(500).json({ error: 'Failed to build AOR monthly', detail: error.message });
  }
}

// GET /api/profit/billing/client-breakdown - one row per client (year total) with
// a nested month-by-month revenue list.
export async function getBillingClientBreakdown(req, res) {
  try {
    const f = parseFilters(req);
    const rows = await prisma.$queryRaw`
      SELECT cr.client_id AS client_id, c.name AS client, ag.name AS agency, cr.month AS m, SUM(cr.amount) AS revenue
        FROM client_revenues cr JOIN clients c ON c.id = cr.client_id JOIN agencies ag ON ag.id = c.agency_id
       WHERE ${whereFragment(f)} GROUP BY cr.client_id, c.name, ag.name, cr.month`;
    const byClient = new Map();
    for (const r of rows) {
      const g = byClient.get(r.client_id) || { clientId: r.client_id, client: r.client, agency: r.agency, revenue: 0, months: [] };
      const revenue = round2(num(r.revenue));
      g.months.push({ month: ymOf(f.year, Number(r.m)), revenue });
      g.revenue = round2(g.revenue + revenue);
      byClient.set(r.client_id, g);
    }
    const clients = [...byClient.values()].map((g) => {
      g.months.sort((a, b) => a.month.localeCompare(b.month));
      return g;
    }).sort((a, b) => b.revenue - a.revenue || a.client.localeCompare(b.client));
    return res.json({ clients });
  } catch (error) {
    console.error('getBillingClientBreakdown error:', error);
    return res.status(500).json({ error: 'Failed to build billing breakdown', detail: error.message });
  }
}
