// Admin endpoints for forecast windows + the forecast submission history.
// See services/forecastWindow.service.js for how a window changes who can enter
// which month.

import prisma from '../utils/prisma.js';
import { windowEffect, notifyWindowOpened, monthLabel } from '../services/forecastWindow.service.js';

const shapeWindow = (w, nameById) => {
  const eff = windowEffect({ ...w, headUserIds: [] }, 0); // evaluate status/deadline for "everyone"
  return {
    id: w.id,
    year: w.year,
    month: w.month,
    label: monthLabel(w.year, w.month),
    status: w.status,
    deadline: w.deadline,
    note: w.note || '',
    headUserIds: w.headUserIds,
    heads: w.headUserIds.map((id) => ({ id, name: nameById.get(id) || `#${id}` })),
    allHeads: w.headUserIds.length === 0,
    open: !!eff?.open,
    expired: !!eff?.expired,
  };
};

// GET /forecasting/windows - recent + upcoming windows, plus the Hub heads to pick from.
export async function listWindows(req, res) {
  try {
    const [windows, heads] = await Promise.all([
      prisma.forecastWindow.findMany({ orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 36 }),
      prisma.user.findMany({ where: { role: 'GROUP_HEAD' }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    const nameById = new Map(heads.map((h) => [h.id, h.name]));
    return res.json({ windows: windows.map((w) => shapeWindow(w, nameById)), heads });
  } catch (error) {
    console.error('listWindows error:', error);
    return res.status(500).json({ error: 'Failed to load forecast windows', detail: error.message });
  }
}

// POST /forecasting/windows { year, month, status, headUserIds, deadline, note, notify }
// Upserts the window for that month (one per month).
export async function saveWindow(req, res) {
  try {
    const year = parseInt(req.body.year, 10);
    const month = parseInt(req.body.month, 10);
    if (!(year >= 2000 && year <= 2100) || !(month >= 1 && month <= 12)) {
      return res.status(400).json({ error: 'A valid year and month are required' });
    }
    const status = req.body.status === 'CLOSED' ? 'CLOSED' : 'OPEN';
    const headUserIds = Array.isArray(req.body.headUserIds)
      ? [...new Set(req.body.headUserIds.map((n) => parseInt(n, 10)).filter(Number.isInteger))] : [];
    if (headUserIds.length) {
      const valid = await prisma.user.count({ where: { id: { in: headUserIds }, role: 'GROUP_HEAD' } });
      if (valid !== headUserIds.length) return res.status(400).json({ error: 'Only Hub users can be targeted' });
    }
    let deadline = null;
    if (req.body.deadline) {
      deadline = new Date(req.body.deadline);
      if (isNaN(deadline.getTime())) return res.status(400).json({ error: 'Invalid deadline' });
      if (status === 'OPEN' && deadline <= new Date()) return res.status(400).json({ error: 'The deadline must be in the future' });
    }
    const note = req.body.note ? String(req.body.note).slice(0, 300) : null;
    const data = { status, headUserIds, deadline, note, createdById: req.user?.id ?? null };
    const w = await prisma.forecastWindow.upsert({
      where: { year_month: { year, month } },
      update: data,
      create: { year, month, ...data },
    });
    let notified = null;
    if (status === 'OPEN' && req.body.notify !== false) {
      try { notified = await notifyWindowOpened(w); } catch (err) { console.error('notifyWindowOpened failed:', err.message); }
    }
    const heads = await prisma.user.findMany({ where: { id: { in: w.headUserIds } }, select: { id: true, name: true } });
    return res.json({ window: shapeWindow(w, new Map(heads.map((h) => [h.id, h.name]))), notified });
  } catch (error) {
    console.error('saveWindow error:', error);
    return res.status(500).json({ error: 'Failed to save forecast window', detail: error.message });
  }
}

// DELETE /forecasting/windows/:id - remove the override; the calendar rule applies again.
export async function deleteWindow(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid window' });
    await prisma.forecastWindow.deleteMany({ where: { id } });
    return res.json({ deleted: true });
  } catch (error) {
    console.error('deleteWindow error:', error);
    return res.status(500).json({ error: 'Failed to delete forecast window', detail: error.message });
  }
}

// GET /forecasting/submissions?year=&month=&clientId= - every save for a client's
// month (newest first): who, when, the total, and what changed per channel vs the
// previous save.
export async function listSubmissions(req, res) {
  try {
    const year = parseInt(req.query.year, 10);
    const month = parseInt(req.query.month, 10);
    const clientId = parseInt(req.query.clientId, 10);
    if (!year || !month || !clientId) return res.status(400).json({ error: 'year, month and clientId are required' });
    const rows = await prisma.forecastSubmission.findMany({
      where: { year, month, clientId }, orderBy: { submittedAt: 'asc' }, take: 200,
    });
    const userIds = [...new Set(rows.map((r) => r.submittedById))];
    const chIds = [...new Set(rows.flatMap((r) => (r.items || []).map((i) => i.channelMasterId)))];
    const [users, channels] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
      prisma.channelMaster.findMany({ where: { id: { in: chIds } }, select: { id: true, name: true } }),
    ]);
    const userName = new Map(users.map((u) => [u.id, u.name]));
    const chName = new Map(channels.map((c) => [c.id, c.name]));

    let prev = new Map();
    const out = rows.map((r) => {
      const cur = new Map((r.items || []).map((i) => [i.channelMasterId, Number(i.amountMillions)]));
      const changes = [];
      for (const id of new Set([...cur.keys(), ...prev.keys()])) {
        const a = prev.get(id) || 0; const b = cur.get(id) || 0;
        if (Math.abs(a - b) > 1e-9) changes.push({ channel: chName.get(id) || `#${id}`, from: a * 1e6, to: b * 1e6 });
      }
      prev = cur;
      return {
        id: r.id,
        submittedAt: r.submittedAt,
        submittedBy: userName.get(r.submittedById) || `#${r.submittedById}`,
        total: Number(r.totalMillions) * 1e6,
        channelCount: cur.size,
        changes: changes.sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from)),
      };
    });
    return res.json({ year, month, clientId, submissions: out.reverse() });
  } catch (error) {
    console.error('listSubmissions error:', error);
    return res.status(500).json({ error: 'Failed to load submission history', detail: error.message });
  }
}
