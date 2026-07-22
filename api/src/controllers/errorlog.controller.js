import prisma from '../utils/prisma.js';
import { logError } from '../services/errorLog.service.js';

// Public: the frontend crash reporter posts here (no auth, so it works on the
// login/public pages too). User context, if any, comes from the request body.
export async function reportClientError(req, res) {
  try {
    const b = req.body || {};
    await logError({
      source: 'frontend',
      message: b.message,
      stack: b.stack,
      url: b.url,
      statusCode: b.statusCode,
      userId: b.userId,
      userEmail: b.userEmail,
      userRole: b.userRole,
      userAgent: req.headers['user-agent'],
    });
  } catch { /* never fail a report */ }
  return res.status(204).end();
}

// Admin: list captured errors (paginated, newest first), with optional filters.
export async function listErrors(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 50));
    const where = {};
    if (req.query.resolved === 'true') where.resolved = true;
    else if (req.query.resolved === 'false') where.resolved = false;
    if (req.query.source === 'frontend' || req.query.source === 'backend') where.source = req.query.source;

    const [rows, total, unresolved] = await Promise.all([
      prisma.errorLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.errorLog.count({ where }),
      prisma.errorLog.count({ where: { resolved: false } }),
    ]);
    return res.json({ rows, total, unresolved, page, pageSize });
  } catch (e) {
    console.error('List errors failed:', e);
    return res.status(500).json({ error: 'Failed to load error logs' });
  }
}

// Admin: mark one error resolved / unresolved.
export async function resolveError(req, res) {
  try {
    const id = parseInt(req.params.id);
    const resolved = req.body?.resolved !== false;
    const row = await prisma.errorLog.update({ where: { id }, data: { resolved } });
    return res.json(row);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to update error log' });
  }
}

// Admin: delete one error row.
export async function deleteError(req, res) {
  try {
    await prisma.errorLog.delete({ where: { id: parseInt(req.params.id) } });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to delete error log' });
  }
}

// Admin: clear all errors, or only the resolved ones (?resolved=true).
export async function clearErrors(req, res) {
  try {
    const where = req.query.resolved === 'true' ? { resolved: true } : {};
    const r = await prisma.errorLog.deleteMany({ where });
    return res.json({ deleted: r.count });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to clear error logs' });
  }
}
