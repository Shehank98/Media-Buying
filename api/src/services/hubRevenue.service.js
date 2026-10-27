// Business Unit Revenue drill-down: one agency's revenue broken down by Hub head
// and, under each head, by client and month.
//
//   - Achievement = ClientRevenue.amount ("Revenue (LKR)" in Admin → Group
//     Revenue), attributed to the client's CURRENT agency and to its Hub head via
//     accountManagerRecordByClient (same rules as every other head view). Rows
//     with only a finance figure (amount null) don't count, like the donut.
//   - A head-month with no client-level rows falls back to the head's direct
//     GroupRevenue figure, shown as a "Hub total (no client split)" row - but
//     only when all that head's clients sit in this one agency, since the direct
//     figure has no agency of its own.
//   - Target = HubRevenueTarget (annual, full LKR, per head per agency);
//     target-to-date = annual ÷ 12 × the agency's latest month with revenue,
//     the same proration as the agency card.
//   - "Not assigned" reconciles the popup to the agency card: clients with no
//     Hub head, plus a "Difference vs agency total" row for any month where the
//     admin-entered AgencyRevenue doesn't equal the sum of the heads.

import prisma from '../utils/prisma.js';
import { accountManagerRecordByClient } from '../controllers/forecastInsights.controller.js';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const zeros = () => Array(12).fill(0);
const round2 = (n) => Number(n.toFixed(2));
const sum = (arr) => arr.reduce((s, v) => s + v, 0);

// Every client mapped to its Hub head ({id, name}) - resolved once over all
// clients so we also know which agencies each head works across.
export async function headsForAllClients() {
  const clients = await prisma.client.findMany({ select: { id: true, name: true, agencyId: true, isActive: true } });
  const headByClient = await accountManagerRecordByClient(clients.map((c) => c.id));
  const agenciesByHead = new Map();
  for (const c of clients) {
    const h = headByClient.get(c.id);
    if (!h) continue;
    if (!agenciesByHead.has(h.id)) agenciesByHead.set(h.id, new Set());
    agenciesByHead.get(h.id).add(c.agencyId);
  }
  return { clients, headByClient, agenciesByHead };
}

// Heads (GROUP_HEAD users) that belong to each agency: anyone with an active
// client there, plus anyone who already has a target there for the year.
export async function hubHeadsByAgency(year, kind = 'revenue') {
  const targetModel = kind === 'spend' ? prisma.hubSpendTarget : prisma.hubRevenueTarget;
  const [{ clients, headByClient }, targets] = await Promise.all([
    headsForAllClients(),
    targetModel.findMany({ where: { year }, include: { head: { select: { id: true, name: true } } } }),
  ]);
  const byAgency = new Map();
  const add = (agencyId, head) => {
    if (!byAgency.has(agencyId)) byAgency.set(agencyId, new Map());
    byAgency.get(agencyId).set(head.id, head.name);
  };
  for (const c of clients) {
    const h = headByClient.get(c.id);
    if (h && c.isActive !== false) add(c.agencyId, h);
  }
  for (const t of targets) if (t.head) add(t.agencyId, t.head);
  return { byAgency, targets };
}

export async function buildHubRevenueBreakdown(agencyId, yearParam) {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId }, select: { id: true, name: true } });
  if (!agency) return null;

  // Same year anchoring as the agency cards: the selected year, else the
  // latest year this agency has revenue for.
  let year = parseInt(yearParam, 10);
  if (!(year >= 2000)) {
    const latest = await prisma.agencyRevenue.findFirst({
      where: { agencyId }, orderBy: [{ year: 'desc' }, { month: 'desc' }], select: { year: true },
    });
    year = latest ? latest.year : new Date().getFullYear();
  }

  const { clients, headByClient, agenciesByHead } = await headsForAllClients();
  const agencyClients = clients.filter((c) => c.agencyId === agencyId);
  const agencyClientIds = agencyClients.map((c) => c.id);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  const [clientRev, agencyRev, targets, groupRev, clientTargetRows] = await Promise.all([
    agencyClientIds.length
      ? prisma.clientRevenue.findMany({ where: { year, clientId: { in: agencyClientIds }, amount: { not: null } }, select: { clientId: true, month: true, amount: true } })
      : [],
    prisma.agencyRevenue.findMany({ where: { year, agencyId }, select: { month: true, amount: true } }),
    prisma.hubRevenueTarget.findMany({ where: { year, agencyId }, include: { head: { select: { id: true, name: true } } } }),
    prisma.groupRevenue.findMany({ where: { year }, select: { headUserId: true, month: true, amount: true } }),
    agencyClientIds.length
      ? prisma.clientRevenueTarget.findMany({ where: { year, clientId: { in: agencyClientIds } }, select: { clientId: true, amount: true } })
      : [],
  ]);
  const clientTarget = new Map(clientTargetRows.map((t) => [t.clientId, Number(t.amount)]));

  // Head -> { name, clients: Map(clientId -> monthly[12]) }
  const heads = new Map();
  const ensureHead = (id, name) => {
    if (!heads.has(id)) heads.set(id, { headUserId: id, headName: name, clients: new Map() });
    return heads.get(id);
  };
  const unassigned = new Map(); // clientId -> monthly[12]

  for (const r of clientRev) {
    const h = headByClient.get(r.clientId);
    const bucket = h ? ensureHead(h.id, h.name).clients : unassigned;
    if (!bucket.has(r.clientId)) bucket.set(r.clientId, zeros());
    bucket.get(r.clientId)[r.month - 1] += Number(r.amount);
  }

  // Heads with an active client here or a target here still get a block
  // (showing zero), so a missing target / missing revenue is visible.
  for (const c of agencyClients) {
    const h = headByClient.get(c.id);
    if (h && c.isActive !== false) ensureHead(h.id, h.name);
  }
  // A client with a target but no revenue yet still gets a (0%) row.
  for (const c of agencyClients) {
    if (!(clientTarget.get(c.id) > 0)) continue;
    const h = headByClient.get(c.id);
    const bucket = h ? ensureHead(h.id, h.name).clients : unassigned;
    if (!bucket.has(c.id)) bucket.set(c.id, zeros());
  }
  const targetByHead = new Map();
  for (const t of targets) {
    if (t.head) ensureHead(t.head.id, t.head.name);
    targetByHead.set(t.headUserId, Number(t.amount));
  }

  // Direct per-head figure for months the head has no client split, only when
  // the head works in this agency alone.
  const directRows = new Map(); // headId -> monthly[12]
  for (const g of groupRev) {
    const head = heads.get(g.headUserId);
    if (!head) continue;
    const ags = agenciesByHead.get(g.headUserId);
    if (!ags || ags.size !== 1 || !ags.has(agencyId)) continue;
    const hasClientSplit = [...head.clients.values()].some((m) => m[g.month - 1] !== 0);
    if (hasClientSplit) continue;
    if (!directRows.has(g.headUserId)) directRows.set(g.headUserId, zeros());
    directRows.get(g.headUserId)[g.month - 1] += Number(g.amount);
  }

  const agencyMonthly = zeros();
  const agencyHasMonth = Array(12).fill(false);
  for (const r of agencyRev) { agencyMonthly[r.month - 1] += Number(r.amount); agencyHasMonth[r.month - 1] = true; }

  // Latest month with revenue: the agency card's anchor, else any client revenue.
  let latestMonth = 0;
  agencyRev.forEach((r) => { latestMonth = Math.max(latestMonth, r.month); });
  if (!latestMonth) clientRev.forEach((r) => { latestMonth = Math.max(latestMonth, r.month); });
  if (!latestMonth) groupRev.forEach((g) => { if (heads.has(g.headUserId)) latestMonth = Math.max(latestMonth, g.month); });

  // Annual client target + the same Jan-based "target to date" as the head/agency.
  const targetToDateOf = (annual) => (annual > 0 && latestMonth ? round2((annual / 12) * latestMonth) : 0);
  const shapeClients = (map) => [...map.entries()]
    .map(([clientId, monthly]) => {
      const annualTarget = clientTarget.get(clientId) || 0;
      return { clientId, name: clientName.get(clientId) || `#${clientId}`, monthly: monthly.map(round2), total: round2(sum(monthly)), annualTarget, targetToDate: targetToDateOf(annualTarget) };
    })
    .filter((c) => c.total !== 0 || c.annualTarget > 0 || c.monthly.some((v) => v !== 0))
    .sort((a, b) => b.total - a.total);

  const shapeGroup = (headUserId, headName, clientRows, annualTarget) => {
    const monthly = zeros();
    clientRows.forEach((c) => c.monthly.forEach((v, i) => { monthly[i] += v; }));
    const achieved = sum(monthly);
    const targetToDate = annualTarget > 0 && latestMonth ? round2((annualTarget / 12) * latestMonth) : 0;
    return {
      headUserId,
      headName,
      annualTarget,
      monthlyTarget: annualTarget > 0 ? round2(annualTarget / 12) : 0,
      targetToDate,
      achieved: round2(achieved),
      pct: targetToDate > 0 ? Number(((achieved / targetToDate) * 100).toFixed(1)) : null,
      monthly: monthly.map(round2),
      clients: clientRows,
    };
  };

  const headList = [...heads.values()].map((h) => {
    const rows = shapeClients(h.clients);
    const direct = directRows.get(h.headUserId);
    if (direct && direct.some((v) => v !== 0)) {
      rows.push({ clientId: null, name: 'Hub total (no client split)', isDirect: true, monthly: direct.map(round2), total: round2(sum(direct)) });
    }
    return shapeGroup(h.headUserId, h.headName, rows, targetByHead.get(h.headUserId) || 0);
  }).sort((a, b) => b.achieved - a.achieved || a.headName.localeCompare(b.headName));

  // "Not assigned": no-head clients + the residual against the agency figure.
  const naRows = shapeClients(unassigned);
  const assignedMonthly = zeros();
  [...headList.flatMap((h) => h.clients), ...naRows].forEach((c) => c.monthly.forEach((v, i) => { assignedMonthly[i] += v; }));
  const residual = agencyMonthly.map((v, i) => (agencyHasMonth[i] ? round2(v - assignedMonthly[i]) : 0));
  if (residual.some((v) => Math.abs(v) >= 1)) {
    naRows.push({ clientId: null, name: 'Difference vs agency total', isResidual: true, monthly: residual, total: round2(sum(residual)) });
  }
  const notAssigned = naRows.length ? shapeGroup(null, 'Not assigned', naRows, 0) : null;

  return {
    kind: 'revenue',
    year,
    agencyId,
    agencyName: agency.name,
    latestMonth: latestMonth || null,
    rangeLabel: latestMonth ? (latestMonth === 1 ? 'Jan' : `Jan–${MONTH_NAMES[latestMonth - 1]}`) : null,
    agencyMonthly: agencyMonthly.map(round2),
    agencyTotal: round2(sum(agencyMonthly)),
    heads: headList,
    notAssigned,
  };
}
