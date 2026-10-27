// Business Unit Performance drill-down: one agency's SPEND (schedule value)
// broken down by Hub head and, under each head, by client and month. The spend
// twin of hubRevenue.service.js - same response shape so the web modal is shared.
//
//   - Achievement = ScheduleLog.scheduleValue (isDeleted:false) booked on this
//     agency (the per-row agencyId snapshot, so a client that moved agencies keeps
//     its history split), attributed to the client's Hub head via
//     accountManagerRecordByClient. Clients with no head roll into "Not assigned".
//   - Target = HubSpendTarget (annual, full LKR, per head per agency). Client rows
//     use the client's yearly spend target (ClientTarget).
//   - Target-to-date uses the ACTIVE-MONTHS rule of the Business Unit Performance
//     card: annual ÷ (months from the agency's first month with spend to Dec) ×
//     (months elapsed from that first month to the latest), so a mid-year starter
//     is measured over its operating months, not from January.

import prisma from '../utils/prisma.js';
import { headsForAllClients } from './hubRevenue.service.js';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const zeros = () => Array(12).fill(0);
const round2 = (n) => Number(n.toFixed(2));
const sum = (arr) => arr.reduce((s, v) => s + v, 0);

export async function buildHubSpendBreakdown(agencyId, yearParam) {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId }, select: { id: true, name: true } });
  if (!agency) return null;

  let year = parseInt(yearParam, 10);
  if (!(year >= 2000)) {
    const latest = await prisma.scheduleLog.findFirst({
      where: { agencyId, isDeleted: false }, orderBy: { scheduleMonth: 'desc' }, select: { scheduleMonth: true },
    });
    year = latest ? parseInt(String(latest.scheduleMonth).slice(0, 4), 10) : new Date().getFullYear();
  }

  const [spendRows, targets, { clients, headByClient }] = await Promise.all([
    prisma.scheduleLog.groupBy({
      by: ['clientId', 'scheduleMonth'],
      where: { agencyId, isDeleted: false, scheduleMonth: { gte: `${year}-01`, lte: `${year}-12` } },
      _sum: { scheduleValue: true },
    }),
    prisma.hubSpendTarget.findMany({ where: { year, agencyId }, include: { head: { select: { id: true, name: true } } } }),
    headsForAllClients(),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const agencyClients = clients.filter((c) => c.agencyId === agencyId);

  const clientTargetRows = await prisma.clientTarget.findMany({
    where: { year, clientId: { in: [...new Set([...spendRows.map((r) => r.clientId), ...agencyClients.map((c) => c.id)])] } },
    select: { clientId: true, amount: true },
  });
  const clientTarget = new Map(clientTargetRows.map((t) => [t.clientId, Number(t.amount)]));

  // Active-months window of this agency in the year.
  const monthsWithSpend = [...new Set(spendRows.map((r) => parseInt(String(r.scheduleMonth).slice(5), 10)))].sort((a, b) => a - b);
  const firstMonth = monthsWithSpend.length ? monthsWithSpend[0] : null;
  const latestMonth = monthsWithSpend.length ? monthsWithSpend[monthsWithSpend.length - 1] : null;
  const activeMonths = firstMonth ? 12 - firstMonth + 1 : 0;
  const elapsed = firstMonth ? latestMonth - firstMonth + 1 : 0;
  const targetToDateOf = (annual) => (annual > 0 && activeMonths > 0 && elapsed > 0 ? round2((annual / activeMonths) * elapsed) : 0);
  const monthlyTargetOf = (annual) => (annual > 0 && activeMonths > 0 ? round2(annual / activeMonths) : 0);

  const heads = new Map();
  const ensureHead = (id, name) => {
    if (!heads.has(id)) heads.set(id, { headUserId: id, headName: name, clients: new Map() });
    return heads.get(id);
  };
  const unassigned = new Map();
  const bucketFor = (clientId) => {
    const h = headByClient.get(clientId);
    return h ? ensureHead(h.id, h.name).clients : unassigned;
  };

  for (const r of spendRows) {
    const bucket = bucketFor(r.clientId);
    if (!bucket.has(r.clientId)) bucket.set(r.clientId, zeros());
    bucket.get(r.clientId)[parseInt(String(r.scheduleMonth).slice(5), 10) - 1] += Number(r._sum.scheduleValue || 0);
  }
  for (const c of agencyClients) {
    const h = headByClient.get(c.id);
    if (h && c.isActive !== false) ensureHead(h.id, h.name);
    if (clientTarget.get(c.id) > 0) {
      const bucket = bucketFor(c.id);
      if (!bucket.has(c.id)) bucket.set(c.id, zeros());
    }
  }
  const targetByHead = new Map();
  for (const t of targets) {
    if (t.head) ensureHead(t.head.id, t.head.name);
    targetByHead.set(t.headUserId, Number(t.amount));
  }

  const shapeClients = (map) => [...map.entries()]
    .map(([clientId, monthly]) => {
      const annualTarget = clientTarget.get(clientId) || 0;
      return { clientId, name: clientName.get(clientId) || `#${clientId}`, monthly: monthly.map(round2), total: round2(sum(monthly)), annualTarget, targetToDate: targetToDateOf(annualTarget) };
    })
    .filter((c) => c.total !== 0 || c.annualTarget > 0)
    .sort((a, b) => b.total - a.total);

  const shapeGroup = (headUserId, headName, clientRows, annualTarget) => {
    const monthly = zeros();
    clientRows.forEach((c) => c.monthly.forEach((v, i) => { monthly[i] += v; }));
    const achieved = sum(monthly);
    const targetToDate = targetToDateOf(annualTarget);
    return {
      headUserId,
      headName,
      annualTarget,
      monthlyTarget: monthlyTargetOf(annualTarget),
      targetToDate,
      achieved: round2(achieved),
      pct: targetToDate > 0 ? Number(((achieved / targetToDate) * 100).toFixed(1)) : null,
      monthly: monthly.map(round2),
      clients: clientRows,
    };
  };

  const headList = [...heads.values()]
    .map((h) => shapeGroup(h.headUserId, h.headName, shapeClients(h.clients), targetByHead.get(h.headUserId) || 0))
    .sort((a, b) => b.achieved - a.achieved || a.headName.localeCompare(b.headName));
  const naRows = shapeClients(unassigned);
  const notAssigned = naRows.length ? shapeGroup(null, 'Not assigned', naRows, 0) : null;

  const agencyMonthly = zeros();
  [...headList, ...(notAssigned ? [notAssigned] : [])].forEach((g) => g.monthly.forEach((v, i) => { agencyMonthly[i] += v; }));

  return {
    kind: 'spend',
    year,
    agencyId,
    agencyName: agency.name,
    firstMonth,
    latestMonth,
    rangeLabel: latestMonth
      ? (firstMonth === latestMonth ? MONTH_NAMES[latestMonth - 1] : `${MONTH_NAMES[firstMonth - 1]}–${MONTH_NAMES[latestMonth - 1]}`)
      : null,
    agencyMonthly: agencyMonthly.map(round2),
    agencyTotal: round2(sum(agencyMonthly)),
    heads: headList,
    notAssigned,
  };
}
