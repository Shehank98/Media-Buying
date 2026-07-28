import prisma from '../utils/prisma.js';
import { getAccessibleClientIds } from '../middleware/access.js';
import { sendEmail } from '../services/email.service.js';

// Fixed recipients (per spec): TO chandra, CC shehan + the managing Hub.
const MBR_TO = 'chandra.kodituwakku@ogilvy.com';
const MBR_CC = 'shehan.kavishka@ogilvy.com';

const MEDIUMS = ['TV', 'RADIO', 'PRINT', 'DIGITAL', 'CINEMA', 'OOH'];
const DEADLINES = {
  'annual': { label: 'Annual buy', lead: 'two weeks' },
  'campaign-special': { label: 'Campaign special buy', lead: 'one week' },
  'new-client': { label: 'New client', lead: 'one to two weeks' },
};

// The Group Head (Hub) who manages a client - agency-aware, mirroring
// accountManagerByClient but returning the user (id/name/email) so we can CC them.
async function managingHeadForClient(clientId) {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { agencyId: true } });
  if (!client) return null;
  const direct = await prisma.userClientAccess.findMany({
    where: { clientId, user: { role: 'GROUP_HEAD' } },
    include: { user: { select: { id: true, name: true, email: true, agencyAccess: { select: { agencyId: true } } } } },
    orderBy: { id: 'desc' },
  });
  const dMatch = direct.find((d) => (d.user.agencyAccess || []).some((a) => a.agencyId === client.agencyId));
  if (dMatch) return dMatch.user;

  const tcs = await prisma.teamClient.findMany({
    where: { clientId },
    include: {
      team: {
        include: {
          head: { select: { id: true, name: true, email: true, role: true } },
          members: { where: { user: { role: 'GROUP_HEAD' } }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { userId: 'asc' } },
        },
      },
    },
  });
  for (const tc of tcs) {
    if (!tc.team || tc.team.agencyId !== client.agencyId) continue;
    if (tc.team.head?.role === 'GROUP_HEAD' && tc.team.head.email) return tc.team.head;
    if (tc.team.members[0]?.user) return tc.team.members[0].user;
  }
  return direct[0]?.user || null;
}

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
const fmtLKR = (v) => (v == null ? '' : 'LKR ' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
// "100% - LKR 1,000,000" / "85%" / "LKR 1,000,000" / "-"
function budgetLabel(s) {
  const parts = [];
  if (s.budgetPct) parts.push(`${s.budgetPct}%`);
  if (s.budgetAmount) parts.push(fmtLKR(s.budgetAmount));
  return parts.join(' - ') || '-';
}
// "Annual buy - by 20 Aug 2026 (buying unit needs two weeks)"
function deadlineText(s) {
  const parts = [];
  if (s.deadlineLabel) parts.push(s.deadlineLabel);
  if (s.deadlineDate) parts.push(`by ${fmtDate(s.deadlineDate)}`);
  const base = parts.join(' - ');
  return base ? (s.deadlineLead ? `${base} (buying unit needs ${s.deadlineLead})` : base) : '-';
}

// Clients the caller may raise a requisition for (their own clients).
export async function listRequisitionClients(req, res) {
  try {
    const user = req.user;
    let where = {};
    if (user.role !== 'SUPER_ADMIN') {
      const ids = await getAccessibleClientIds(user.id, user.role);
      where = { id: { in: ids || [] } };
    }
    const clients = await prisma.client.findMany({
      where: { ...where, isActive: true },
      select: { id: true, name: true, agency: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
    return res.json({ clients: clients.map((c) => ({ id: c.id, name: c.name, agencyId: c.agency?.id, agencyName: c.agency?.name || '' })) });
  } catch (error) {
    console.error('listRequisitionClients error:', error);
    return res.status(500).json({ error: 'Failed to load clients' });
  }
}

function shape(r) {
  return {
    id: r.id,
    clientId: r.clientId,
    clientName: r.client?.name || '',
    agencyName: r.client?.agency?.name || '',
    requesterName: r.requester?.name || '',
    requesterRole: r.requester?.role || '',
    brandCampaign: r.brandCampaign,
    targetGroup: r.targetGroup || '',
    campaignStart: r.campaignStart,
    campaignEnd: r.campaignEnd,
    budgetPct: r.budgetPct,
    budgetAmount: r.budgetAmount == null ? null : Number(r.budgetAmount),
    mediums: r.mediums || [],
    stations: r.stations || {},
    buyingProperty: r.buyingProperty || '',
    deliverables: r.deliverables || {},
    daypartMandates: r.daypartMandates || {},
    discussionPoints: r.discussionPoints || '',
    deadlineType: r.deadlineType || '',
    deadlineLabel: DEADLINES[r.deadlineType]?.label || '',
    deadlineLead: DEADLINES[r.deadlineType]?.lead || '',
    deadlineDate: r.deadlineDate,
    status: r.status,
    createdAt: r.createdAt,
  };
}

// GET /requisitions - SUPER_ADMIN sees all; others see only their own.
export async function listRequisitions(req, res) {
  try {
    const user = req.user;
    const where = user.role === 'SUPER_ADMIN' ? {} : { requestedById: user.id };
    const rows = await prisma.mediaBuyingRequisition.findMany({
      where,
      include: { client: { select: { name: true, agency: { select: { name: true } } } }, requester: { select: { name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ requisitions: rows.map(shape) });
  } catch (error) {
    console.error('listRequisitions error:', error);
    return res.status(500).json({ error: 'Failed to load requisitions' });
  }
}

export async function getRequisition(req, res) {
  try {
    const user = req.user;
    const id = parseInt(req.params.id);
    const r = await prisma.mediaBuyingRequisition.findUnique({
      where: { id },
      include: { client: { select: { name: true, agency: { select: { name: true } } } }, requester: { select: { name: true, role: true } } },
    });
    if (!r) return res.status(404).json({ error: 'Requisition not found' });
    if (user.role !== 'SUPER_ADMIN' && r.requestedById !== user.id) return res.status(403).json({ error: 'No access to this requisition' });
    return res.json({ requisition: shape(r) });
  } catch (error) {
    console.error('getRequisition error:', error);
    return res.status(500).json({ error: 'Failed to load requisition' });
  }
}

// DELETE /requisitions/:id - SUPER_ADMIN removes a requisition request.
export async function deleteRequisition(req, res) {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.mediaBuyingRequisition.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: 'Requisition not found' });
    await prisma.mediaBuyingRequisition.delete({ where: { id } });
    return res.json({ message: 'Requisition deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Requisition not found' });
    console.error('deleteRequisition error:', error);
    return res.status(500).json({ error: 'Failed to delete requisition' });
  }
}

// POST /requisitions - Desk (PLANNER) or Hub (GROUP_HEAD) raises an MBR.
export async function createRequisition(req, res) {
  try {
    const user = req.user;
    const b = req.body || {};
    const clientId = parseInt(b.clientId);
    if (!Number.isInteger(clientId)) return res.status(400).json({ error: 'Client is required' });
    if (!b.brandCampaign || !String(b.brandCampaign).trim()) return res.status(400).json({ error: 'Brand / Campaign is required' });

    // Access: SUPER_ADMIN any; others only their own clients.
    if (user.role !== 'SUPER_ADMIN') {
      const ids = await getAccessibleClientIds(user.id, user.role);
      if (!ids || !ids.includes(clientId)) return res.status(403).json({ error: 'You can only raise requisitions for your own clients' });
    }

    const mediums = Array.isArray(b.mediums) ? b.mediums.filter((m) => MEDIUMS.includes(m)) : [];
    const budgetPct = [100, 85].includes(parseInt(b.budgetPct)) ? parseInt(b.budgetPct) : null;
    const budgetAmountNum = b.budgetAmount != null && b.budgetAmount !== '' && !isNaN(Number(b.budgetAmount)) && Number(b.budgetAmount) > 0 ? Number(b.budgetAmount) : null;
    const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

    const created = await prisma.mediaBuyingRequisition.create({
      data: {
        clientId,
        requestedById: user.id,
        brandCampaign: String(b.brandCampaign).trim(),
        targetGroup: clean(b.targetGroup),
        campaignStart: b.campaignStart ? new Date(b.campaignStart) : null,
        campaignEnd: b.campaignEnd ? new Date(b.campaignEnd) : null,
        budgetPct,
        budgetAmount: budgetAmountNum,
        mediums,
        stations: b.stations && typeof b.stations === 'object' ? b.stations : {},
        buyingProperty: clean(b.buyingProperty),
        deliverables: b.deliverables && typeof b.deliverables === 'object' ? b.deliverables : {},
        daypartMandates: b.daypartMandates && typeof b.daypartMandates === 'object' ? b.daypartMandates : {},
        discussionPoints: clean(b.discussionPoints),
        deadlineType: DEADLINES[b.deadlineType] ? b.deadlineType : null,
        deadlineDate: b.deadlineDate ? new Date(b.deadlineDate) : null,
      },
      include: { client: { select: { name: true, agency: { select: { name: true } } } }, requester: { select: { name: true, role: true } } },
    });

    // Notify + email (best-effort; never fail the request on delivery issues).
    deliver(created).catch((e) => console.error('MBR delivery failed:', e));

    return res.status(201).json({ requisition: shape(created) });
  } catch (error) {
    console.error('createRequisition error:', error);
    return res.status(500).json({ error: 'Failed to create requisition', detail: error.message });
  }
}

// Email chandra (TO), CC shehan + the managing Hub; plus in-app notifications
// to admins and the Hub.
async function deliver(r) {
  const hub = await managingHeadForClient(r.clientId);
  const s = shape(r);
  const period = (s.campaignStart || s.campaignEnd) ? `${fmtDate(s.campaignStart)} – ${fmtDate(s.campaignEnd)}` : '-';
  // Buying unit / admins review under the Buying Requisition tab.
  const link = `${(process.env.FRONTEND_URL || '').split(',')[0] || ''}/buying-requisition`;

  const details = [
    ['Client', s.clientName + (s.agencyName ? ` (${s.agencyName})` : '')],
    ['Brand / Campaign', s.brandCampaign],
    ['Target Group', s.targetGroup || '-'],
    ['Campaign Period', period],
    ['Budget', budgetLabel(s)],
    ['Medium', s.mediums.join(', ') || '-'],
    ['Deadline', deadlineText(s)],
    ['Requested by', `${s.requesterName} (${s.requesterRole})`],
  ];
  for (const m of s.mediums) {
    if (s.stations[m]) details.push([`${m} - Channels/Stations`, s.stations[m]]);
  }
  if (s.buyingProperty) details.push(['Buying Property / Sponsorships', s.buyingProperty]);
  for (const m of s.mediums) {
    if (s.deliverables[m]) details.push([`${m} - Deliverables`, s.deliverables[m]]);
    if (s.daypartMandates[m]) details.push([`${m} - Daypart Mandates`, s.daypartMandates[m]]);
  }
  if (s.discussionPoints) details.push(['Discussion Points', s.discussionPoints]);

  const cc = [MBR_CC];
  if (hub?.email && hub.email !== MBR_TO && hub.email !== MBR_CC) cc.push(hub.email);

  try {
    await sendEmail({
      type: 'requisition',
      to: MBR_TO,
      cc,
      requisitionId: s.id,
      clientName: s.clientName,
      brandCampaign: s.brandCampaign,
      requesterName: s.requesterName,
      hubName: hub?.name || '',
      details: details.map(([label, value]) => ({ label, value: String(value) })),
      link,
    });
  } catch (e) {
    console.error('MBR email failed:', e);
  }

  // In-app notifications - admins and the managing Hub both land on the
  // Buying Requisition tab (admins see every MBR there, the Hub their own).
  const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: { id: true } });
  const title = 'New Media Buying Requisition';
  const message = `${s.requesterName} raised an MBR for ${s.clientName} - ${s.brandCampaign}`;
  const notes = [];
  const seen = new Set([r.requestedById]); // don't notify the requester
  for (const a of admins) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    notes.push({ userId: a.id, type: 'REQUISITION', title, message, link: '/buying-requisition' });
  }
  if (hub?.id && !seen.has(hub.id)) {
    notes.push({ userId: hub.id, type: 'REQUISITION', title, message, link: '/buying-requisition' });
  }
  if (notes.length) await prisma.notification.createMany({ data: notes });
}
