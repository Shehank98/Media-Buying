import prisma from '../utils/prisma.js';
import { getAccessibleClientIds } from '../middleware/access.js';

// ═══════════════════════════════════════════════════════════════════════════
// Revenue Verification  (Spend Analytics "Rev Verification")
//
// The admin enters each client's `revenueFromFinance` on ClientRevenue (Admin →
// Group Revenue → Revenue by Client). The client's group head then reviews that
// finance figure here and either CONFIRMS it (verifyStatus=VERIFIED) or DISPUTES
// it with a corrected amount + reason (verifyStatus=DISPUTED). GROUP_HEAD sees
// only their own clients; SUPER_ADMIN sees all. Past months are browsable.
// ═══════════════════════════════════════════════════════════════════════════

const num = (v) => (v == null || v === '' ? null : Number(v));
const dec = (v) => (v == null ? null : Number(v));

// null = unrestricted (SUPER_ADMIN); else the client ids the caller may verify.
async function verifyScope(user) {
  if (user.role === 'SUPER_ADMIN') return null;
  if (user.role === 'GROUP_HEAD') {
    const ids = await getAccessibleClientIds(user.id, 'GROUP_HEAD');
    return ids.length ? ids : [-1];
  }
  return [-1];
}

function rowToDto(r) {
  return {
    clientId: r.clientId,
    clientName: r.client?.name || '',
    agencyName: r.client?.agency?.name || '',
    revenueFromFinance: dec(r.revenueFromFinance),
    verifyStatus: r.verifyStatus,
    verifiedAmount: dec(r.verifiedAmount),
    verifyReason: r.verifyReason || null,
    verifiedByName: r.verifier?.name || null,
    verifiedAt: r.verifiedAt || null,
  };
}

export async function listRevenueVerification(req, res) {
  try {
    const scope = await verifyScope(req.user);
    const year = parseInt(req.query.year);
    const month = parseInt(req.query.month);

    // Only rows the admin populated with a finance figure need review.
    const baseWhere = {
      revenueFromFinance: { not: null },
      ...(scope ? { clientId: { in: scope } } : {}),
    };

    const monthRows = await prisma.clientRevenue.findMany({
      where: baseWhere,
      select: { year: true, month: true },
      distinct: ['year', 'month'],
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    const availableMonths = monthRows.map((m) => ({ year: m.year, month: m.month }));

    const target = (year && month) ? { year, month } : (availableMonths[0] || null);

    let clients = [];
    if (target) {
      const rows = await prisma.clientRevenue.findMany({
        where: { year: target.year, month: target.month, ...baseWhere },
        include: {
          client: { select: { id: true, name: true, agency: { select: { name: true } } } },
          verifier: { select: { name: true } },
        },
      });
      clients = rows.map(rowToDto).sort((a, b) => a.clientName.localeCompare(b.clientName));
    }

    return res.json({
      year: target?.year || year || null,
      month: target?.month || month || null,
      availableMonths,
      clients,
    });
  } catch (error) {
    console.error('listRevenueVerification error:', error);
    return res.status(500).json({ error: 'Failed to load revenue verification', detail: error.message });
  }
}

export async function submitRevenueVerification(req, res) {
  try {
    const year = parseInt(req.body.year);
    const month = parseInt(req.body.month);
    const clientId = parseInt(req.body.clientId);
    const action = req.body.action;
    if (!year || !month || !clientId) return res.status(400).json({ error: 'year, month and clientId are required' });
    if (!['confirm', 'dispute'].includes(action)) return res.status(400).json({ error: "action must be 'confirm' or 'dispute'" });

    const scope = await verifyScope(req.user);
    if (scope && !scope.includes(clientId)) return res.status(403).json({ error: 'Access denied to this client' });

    const row = await prisma.clientRevenue.findUnique({ where: { year_month_clientId: { year, month, clientId } } });
    if (!row || row.revenueFromFinance == null) {
      return res.status(404).json({ error: 'No finance revenue recorded for this client and month' });
    }

    let data;
    if (action === 'confirm') {
      data = { verifyStatus: 'VERIFIED', verifiedAmount: row.revenueFromFinance, verifyReason: null, verifiedById: req.user.id, verifiedAt: new Date() };
    } else {
      const amount = num(req.body.amount);
      const reason = (req.body.reason || '').trim();
      if (amount == null) return res.status(400).json({ error: 'A corrected amount is required to dispute' });
      if (!reason) return res.status(400).json({ error: 'A note is required to dispute' });
      data = { verifyStatus: 'DISPUTED', verifiedAmount: amount, verifyReason: reason, verifiedById: req.user.id, verifiedAt: new Date() };
    }

    await prisma.clientRevenue.update({ where: { id: row.id }, data });
    return listRevenueVerification({ query: { year, month }, user: req.user }, res);
  } catch (error) {
    console.error('submitRevenueVerification error:', error);
    return res.status(500).json({ error: 'Failed to submit verification', detail: error.message });
  }
}
