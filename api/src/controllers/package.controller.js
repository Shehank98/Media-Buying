import crypto from 'crypto';
import prisma from '../utils/prisma.js';
import { generateResetToken } from '../services/auth.service.js';
import { sendEmail } from '../services/email.service.js';

const INTERESTS = ['INTERESTED', 'NOT_INTERESTED', 'NEGOTIATE'];
const FOLLOW_UPS = ['PENDING', 'FOLLOWED_UP', 'BOOKED', 'CLOSED'];
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function frontendBase() {
  return (process.env.FRONTEND_URL || 'https://media-buying-production.up.railway.app').split(',')[0].trim();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function num(v) {
  return v == null ? null : Number(v);
}

function serializeLineItem(li) {
  return { ...li, rate: num(li.rate) };
}

// ── Admin: CRUD ────────────────────────────────────────────────────────────────

export async function listPackages(req, res) {
  try {
    const packages = await prisma.mediaPackage.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { id: true, name: true } },
        _count: { select: { lineItems: true, recipients: true } },
      },
    });
    return res.json({ packages });
  } catch (error) {
    console.error('List packages error:', error);
    return res.status(500).json({ error: 'Failed to list packages', detail: error.message });
  }
}

export async function getPackage(req, res) {
  try {
    const id = parseInt(req.params.id);
    const pkg = await prisma.mediaPackage.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, name: true } },
        lineItems: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { recipients: true } },
      },
    });
    if (!pkg) return res.status(404).json({ error: 'Package not found' });
    return res.json({ package: { ...pkg, lineItems: pkg.lineItems.map(serializeLineItem) } });
  } catch (error) {
    console.error('Get package error:', error);
    return res.status(500).json({ error: 'Failed to get package', detail: error.message });
  }
}

// Normalize the line items coming from the client into Prisma create rows.
function lineItemRows(lineItems) {
  if (!Array.isArray(lineItems)) return [];
  return lineItems
    .filter(li => li && String(li.label || '').trim())
    .map((li, idx) => ({
      label: String(li.label).trim(),
      rate: isNaN(parseFloat(li.rate)) ? 0 : parseFloat(li.rate),
      sortOrder: idx,
    }));
}

export async function createPackage(req, res) {
  try {
    const { name, category, emailIntro, lineItems } = req.body;
    if (!name || !category) {
      return res.status(400).json({ error: 'name and category are required' });
    }
    const pkg = await prisma.mediaPackage.create({
      data: {
        name: String(name).trim(),
        category: String(category).trim(),
        emailIntro: emailIntro ? String(emailIntro) : '',
        createdById: req.user.id,
        lineItems: { create: lineItemRows(lineItems) },
      },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } }, _count: { select: { lineItems: true, recipients: true } } },
    });
    return res.status(201).json({ package: { ...pkg, lineItems: pkg.lineItems.map(serializeLineItem) } });
  } catch (error) {
    console.error('Create package error:', error);
    return res.status(500).json({ error: 'Failed to create package', detail: error.message });
  }
}

export async function updatePackage(req, res) {
  try {
    const id = parseInt(req.params.id);
    const { name, category, emailIntro, lineItems } = req.body;

    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (category !== undefined) data.category = String(category).trim();
    if (emailIntro !== undefined) data.emailIntro = String(emailIntro);

    // Replace line items atomically when provided.
    const ops = [prisma.mediaPackage.update({ where: { id }, data })];
    if (Array.isArray(lineItems)) {
      ops.push(prisma.packageLineItem.deleteMany({ where: { packageId: id } }));
      const rows = lineItemRows(lineItems);
      if (rows.length) {
        ops.push(prisma.packageLineItem.createMany({ data: rows.map(r => ({ ...r, packageId: id })) }));
      }
    }
    await prisma.$transaction(ops);

    const pkg = await prisma.mediaPackage.findUnique({
      where: { id },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } }, _count: { select: { lineItems: true, recipients: true } } },
    });
    return res.json({ package: { ...pkg, lineItems: pkg.lineItems.map(serializeLineItem) } });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Package not found' });
    console.error('Update package error:', error);
    return res.status(500).json({ error: 'Failed to update package', detail: error.message });
  }
}

export async function togglePackage(req, res) {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.mediaPackage.findUnique({ where: { id }, select: { isActive: true } });
    if (!existing) return res.status(404).json({ error: 'Package not found' });
    const pkg = await prisma.mediaPackage.update({ where: { id }, data: { isActive: !existing.isActive } });
    return res.json({ package: pkg });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Package not found' });
    console.error('Toggle package error:', error);
    return res.status(500).json({ error: 'Failed to toggle package', detail: error.message });
  }
}

export async function deletePackage(req, res) {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.mediaPackage.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: 'Package not found' });

    const recipientCount = await prisma.packageRecipient.count({ where: { packageId: id } });
    if (recipientCount > 0) {
      return res.status(409).json({
        error: `This package has already been sent to ${recipientCount} recipient(s). Deactivate it instead of deleting to keep response history.`,
      });
    }
    await prisma.mediaPackage.delete({ where: { id } });
    return res.json({ message: 'Package deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Package not found' });
    console.error('Delete package error:', error);
    return res.status(500).json({ error: 'Failed to delete package', detail: error.message });
  }
}

// ── Admin: recipients picker ─────────────────────────────────────────────────

export async function listGroupHeads(req, res) {
  try {
    const users = await prisma.user.findMany({
      where: { role: 'GROUP_HEAD' },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
    return res.json({ users });
  } catch (error) {
    console.error('List group heads error:', error);
    return res.status(500).json({ error: 'Failed to list team heads', detail: error.message });
  }
}

// ── Admin: send ──────────────────────────────────────────────────────────────

export async function sendPackage(req, res) {
  try {
    const id = parseInt(req.params.id);
    const { recipientUserIds, pdfBase64, pdfFileName } = req.body;

    if (!Array.isArray(recipientUserIds) || recipientUserIds.length === 0) {
      return res.status(400).json({ error: 'recipientUserIds is required' });
    }

    const pkg = await prisma.mediaPackage.findUnique({
      where: { id },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!pkg) return res.status(404).json({ error: 'Package not found' });

    const userIds = recipientUserIds.map(Number).filter(Number.isInteger);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, role: 'GROUP_HEAD' },
      select: { id: true, name: true, email: true },
    });
    if (!users.length) return res.status(400).json({ error: 'No valid team-head recipients' });

    const base = frontendBase();
    const lineItemsForEmail = pkg.lineItems.map(li => ({ label: li.label, rate: num(li.rate) }));
    const sent = [];

    for (const u of users) {
      const { token, tokenHash } = generateResetToken();
      // One active token per (package,user): drop any prior unresponded recipient row.
      await prisma.packageRecipient.deleteMany({
        where: { packageId: id, userId: u.id, respondedAt: null },
      });
      await prisma.packageRecipient.create({
        data: {
          packageId: id,
          userId: u.id,
          tokenHash,
          expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
          sentAt: new Date(),
        },
      });

      const responseLink = `${base}/package-response?token=${token}`;
      if (u.email) {
        sendEmail({
          type: 'package',
          to: u.email,
          name: u.name,
          packageName: pkg.name,
          intro: pkg.emailIntro,
          lineItems: lineItemsForEmail,
          responseLink,
          pdfBase64: pdfBase64 || null,
          pdfFileName: pdfFileName || `${pkg.name}.pdf`,
        }).catch(err => console.error(`Package email to ${u.email} failed:`, err));
      }
      sent.push({ id: u.id, name: u.name, email: u.email });
    }

    return res.json({ message: `Package sent to ${sent.length} team head(s)`, recipients: sent });
  } catch (error) {
    console.error('Send package error:', error);
    return res.status(500).json({ error: 'Failed to send package', detail: error.message });
  }
}

// ── Admin: responses dashboard ───────────────────────────────────────────────

export async function getPackageResponses(req, res) {
  try {
    const id = parseInt(req.params.id);
    const pkg = await prisma.mediaPackage.findUnique({
      where: { id },
      include: {
        lineItems: { orderBy: { sortOrder: 'asc' } },
        recipients: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    if (!pkg) return res.status(404).json({ error: 'Package not found' });
    return res.json({
      package: { id: pkg.id, name: pkg.name, category: pkg.category, lineItems: pkg.lineItems.map(serializeLineItem) },
      recipients: pkg.recipients,
    });
  } catch (error) {
    console.error('Get package responses error:', error);
    return res.status(500).json({ error: 'Failed to get responses', detail: error.message });
  }
}

export async function updateFollowUp(req, res) {
  try {
    const recipientId = parseInt(req.params.recipientId);
    const { followUp } = req.body;
    if (!FOLLOW_UPS.includes(followUp)) {
      return res.status(400).json({ error: 'Invalid follow-up status' });
    }
    const recipient = await prisma.packageRecipient.update({
      where: { id: recipientId },
      data: { followUp },
    });
    return res.json({ recipient });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Recipient not found' });
    console.error('Update follow-up error:', error);
    return res.status(500).json({ error: 'Failed to update follow-up', detail: error.message });
  }
}

// ── Public (token-authenticated, no JWT) ─────────────────────────────────────

async function recipientFromToken(token) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  return prisma.packageRecipient.findFirst({
    where: { tokenHash, expiresAt: { gt: new Date() } },
    include: {
      user: { select: { name: true } },
      package: { include: { lineItems: { orderBy: { sortOrder: 'asc' } } } },
    },
  });
}

export async function getPackageByToken(req, res) {
  try {
    const recipient = await recipientFromToken(req.query.token);
    if (!recipient) return res.status(400).json({ error: 'This link is invalid or has expired.' });

    return res.json({
      recipientName: recipient.user?.name || '',
      respondedAt: recipient.respondedAt,
      response: {
        interest: recipient.interest,
        budgetNote: recipient.budgetNote || '',
        clientName: recipient.clientName || '',
        notes: recipient.notes || '',
      },
      package: {
        name: recipient.package.name,
        category: recipient.package.category,
        emailIntro: recipient.package.emailIntro,
        lineItems: recipient.package.lineItems.map(serializeLineItem),
      },
    });
  } catch (error) {
    console.error('Get package by token error:', error);
    return res.status(500).json({ error: 'Failed to load package', detail: error.message });
  }
}

export async function submitPackageResponse(req, res) {
  try {
    const { token, interest, budgetNote, clientName, notes } = req.body;
    if (!INTERESTS.includes(interest)) {
      return res.status(400).json({ error: 'Please select your interest level.' });
    }
    const recipient = await recipientFromToken(token);
    if (!recipient) return res.status(400).json({ error: 'This link is invalid or has expired.' });

    const firstResponse = !recipient.respondedAt;
    await prisma.packageRecipient.update({
      where: { id: recipient.id },
      data: {
        interest,
        budgetNote: budgetNote ? String(budgetNote) : null,
        clientName: clientName ? String(clientName) : null,
        notes: notes ? String(notes) : null,
        respondedAt: recipient.respondedAt || new Date(),
      },
    });

    // Notify admins (derive server-side; public request body is untrusted).
    if (firstResponse) {
      const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: { id: true } });
      const ids = new Set(admins.map(a => a.id));
      ids.add(recipient.package.createdById);
      const label = { INTERESTED: 'Interested', NOT_INTERESTED: 'Not interested', NEGOTIATE: 'Open to negotiate' }[interest];
      await prisma.notification.createMany({
        data: Array.from(ids).map(userId => ({
          userId,
          type: 'PACKAGE_RESPONSE',
          title: 'Package response received',
          message: `${recipient.user?.name || 'A team head'} responded "${label}" to "${recipient.package.name}".`,
        })),
      });
    }

    return res.json({ message: 'Response submitted. Thank you!' });
  } catch (error) {
    console.error('Submit package response error:', error);
    return res.status(500).json({ error: 'Failed to submit response', detail: error.message });
  }
}
