import prisma from '../utils/prisma.js';
import { sendEmail } from '../services/email.service.js';
import { getAccessibleClientIds } from '../middleware/access.js';

const INTERESTS = ['INTERESTED', 'NOT_INTERESTED', 'NEGOTIATE'];
const FOLLOW_UPS = ['PENDING', 'FOLLOWED_UP', 'BOOKED', 'CLOSED'];
const INTEREST_LABEL = { INTERESTED: 'Interested', NOT_INTERESTED: 'Not interested', NEGOTIATE: 'Open to negotiate' };

function frontendBase() {
  return (process.env.FRONTEND_URL || 'https://media-buying-production.up.railway.app').split(',')[0].trim().replace(/\/+$/, '');
}

function num(v) {
  return v == null ? null : Number(v);
}

function parseDeadline(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Auto-deactivate any package whose deadline has passed (lazy; runs on every
// list/inbox fetch since there's no scheduler). Best-effort.
async function deactivateExpiredPackages() {
  try {
    await prisma.mediaPackage.updateMany({
      where: { isActive: true, deadline: { not: null, lt: new Date() } },
      data: { isActive: false },
    });
  } catch (e) { console.warn('deactivateExpiredPackages skipped:', e.message); }
}

function serializeLineItem(li) {
  return { ...li, rate: num(li.rate) };
}

// ── Admin: CRUD ────────────────────────────────────────────────────────────────

export async function listPackages(req, res) {
  try {
    await deactivateExpiredPackages();
    const packages = await prisma.mediaPackage.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { id: true, name: true } },
        lineItems: { select: { rate: true } },
        recipients: { select: { interest: true } },
        _count: { select: { lineItems: true, recipients: true } },
      },
    });
    const now = new Date();
    const shaped = packages.map(p => {
      const totalValue = p.lineItems.reduce((s, li) => s + (num(li.rate) || 0), 0);
      const responses = { interested: 0, negotiate: 0, declined: 0, pending: 0 };
      for (const r of p.recipients) {
        if (r.interest === 'INTERESTED') responses.interested++;
        else if (r.interest === 'NEGOTIATE') responses.negotiate++;
        else if (r.interest === 'NOT_INTERESTED') responses.declined++;
        else responses.pending++;
      }
      const expired = !!(p.deadline && new Date(p.deadline) < now);
      const status = expired ? 'expired' : (p.isActive ? 'active' : 'inactive');
      const { lineItems, recipients, ...rest } = p;
      return { ...rest, totalValue, responses, expired, status };
    });
    return res.json({ packages: shaped });
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
    const { name, category, emailIntro, lineItems, deadline } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    const pkg = await prisma.mediaPackage.create({
      data: {
        name: String(name).trim(),
        category: category ? String(category).trim() : null,
        emailIntro: emailIntro ? String(emailIntro) : '',
        deadline: parseDeadline(deadline),
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
    const { name, category, emailIntro, lineItems, deadline } = req.body;

    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (category !== undefined) data.category = category ? String(category).trim() : null;
    if (emailIntro !== undefined) data.emailIntro = String(emailIntro);
    if (deadline !== undefined) data.deadline = parseDeadline(deadline);

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

    // A sent package is guarded by default (keeps response history); `?force=true`
    // permanently deletes it — cascade removes its recipients + line items.
    const force = String(req.query.force) === 'true';
    if (!force) {
      const recipientCount = await prisma.packageRecipient.count({ where: { packageId: id } });
      if (recipientCount > 0) {
        return res.status(409).json({
          recipientCount,
          error: `This package has already been sent to ${recipientCount} recipient(s). Deactivate it instead of deleting to keep response history.`,
        });
      }
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
    const inboxLink = `${base}/my-packages`;
    const lineItemsForEmail = pkg.lineItems.map(li => ({ label: li.label, rate: num(li.rate) }));
    const sent = [];

    for (const u of users) {
      // One recipient row per (package,user). Re-sending refreshes the timestamp
      // and keeps any existing response intact.
      const existing = await prisma.packageRecipient.findFirst({
        where: { packageId: id, userId: u.id },
      });
      if (existing) {
        await prisma.packageRecipient.update({ where: { id: existing.id }, data: { sentAt: new Date() } });
      } else {
        await prisma.packageRecipient.create({ data: { packageId: id, userId: u.id, sentAt: new Date() } });
      }

      // In-app notification so they see it the moment they log in.
      await prisma.notification.create({
        data: {
          userId: u.id,
          type: 'PACKAGE_SHARED',
          title: 'New media package shared',
          message: `"${pkg.name}" was shared with you. Open Media Packages to respond.`,
        },
      }).catch(() => {});

      // Email points to the in-app inbox (login required) — no public token link.
      if (u.email) {
        sendEmail({
          type: 'package',
          to: u.email,
          name: u.name,
          packageName: pkg.name,
          intro: pkg.emailIntro,
          lineItems: lineItemsForEmail,
          deadline: pkg.deadline ? new Date(pkg.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null,
          responseLink: inboxLink,
          pdfBase64: pdfBase64 || null,
          pdfFileName: pdfFileName || `${pkg.name}.pdf`,
        }).catch(err => console.error(`Package email to ${u.email} failed:`, err));
      }
      sent.push({ id: u.id, name: u.name, email: u.email });
    }

    return res.json({ message: `Package shared with ${sent.length} team head(s)`, recipients: sent });
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

    // Resolve every recipient's interested-client ids to names in one query.
    const allIds = [...new Set(pkg.recipients.flatMap(r => r.interestedClientIds || []))];
    const clients = allIds.length
      ? await prisma.client.findMany({ where: { id: { in: allIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(clients.map(c => [c.id, c.name]));
    const recipients = pkg.recipients.map(r => ({
      ...r,
      interestedClients: (r.interestedClientIds || []).map(cid => ({ id: cid, name: nameById.get(cid) || `#${cid}` })),
    }));

    return res.json({
      package: { id: pkg.id, name: pkg.name, category: pkg.category, deadline: pkg.deadline, lineItems: pkg.lineItems.map(serializeLineItem) },
      recipients,
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

// ── Team head (GROUP_HEAD): in-app inbox ─────────────────────────────────────

// Packages shared with the signed-in team head — opened in their own interface.
export async function listMyPackages(req, res) {
  try {
    await deactivateExpiredPackages();
    const rows = await prisma.packageRecipient.findMany({
      where: { userId: req.user.id, sentAt: { not: null } },
      orderBy: { sentAt: 'desc' },
      include: {
        package: {
          include: {
            lineItems: { orderBy: { sortOrder: 'asc' } },
            creator: { select: { name: true } },
          },
        },
      },
    });

    // The team head's own clients — for the "interested clients" multi-select.
    const myClientIds = await getAccessibleClientIds(req.user.id, 'GROUP_HEAD');
    const myClients = myClientIds.length
      ? await prisma.client.findMany({ where: { id: { in: myClientIds } }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
      : [];

    const now = new Date();
    const items = rows.map(r => {
      const expired = !!(r.package.deadline && new Date(r.package.deadline) < now);
      return {
        recipientId: r.id,
        sentAt: r.sentAt,
        respondedAt: r.respondedAt,
        response: {
          interest: r.interest,
          budgetNote: r.budgetNote || '',
          clientName: r.clientName || '',
          interestedClientIds: r.interestedClientIds || [],
          notes: r.notes || '',
        },
        package: {
          id: r.package.id,
          name: r.package.name,
          category: r.package.category,
          emailIntro: r.package.emailIntro,
          isActive: r.package.isActive,
          deadline: r.package.deadline,
          expired,
          sharedBy: r.package.creator?.name || '',
          lineItems: r.package.lineItems.map(serializeLineItem),
        },
      };
    });
    return res.json({ items, myClients });
  } catch (error) {
    console.error('List my packages error:', error);
    return res.status(500).json({ error: 'Failed to load your packages', detail: error.message });
  }
}

export async function respondToMyPackage(req, res) {
  try {
    const recipientId = parseInt(req.params.recipientId);
    const { interest, budgetNote, clientName, notes, interestedClientIds } = req.body;
    if (!INTERESTS.includes(interest)) {
      return res.status(400).json({ error: 'Please select your interest level.' });
    }

    const recipient = await prisma.packageRecipient.findUnique({
      where: { id: recipientId },
      include: { package: true, user: { select: { name: true } } },
    });
    // Only the recipient may respond to their own shared package.
    if (!recipient || recipient.userId !== req.user.id) {
      return res.status(404).json({ error: 'Package not found.' });
    }
    // A closed (past-deadline) proposal can't take new responses.
    if (recipient.package.deadline && new Date(recipient.package.deadline) < new Date()) {
      return res.status(409).json({ error: 'This proposal has closed — its deadline has passed.' });
    }

    // Keep only client ids the team head actually manages.
    let clientIds = [];
    if (Array.isArray(interestedClientIds) && interestedClientIds.length) {
      const accessible = new Set(await getAccessibleClientIds(req.user.id, 'GROUP_HEAD'));
      clientIds = [...new Set(interestedClientIds.map(Number).filter(n => Number.isInteger(n) && accessible.has(n)))];
    }

    await prisma.packageRecipient.update({
      where: { id: recipientId },
      data: {
        interest,
        budgetNote: budgetNote ? String(budgetNote) : null,
        clientName: clientName ? String(clientName) : null,
        interestedClientIds: clientIds,
        notes: notes ? String(notes) : null,
        respondedAt: recipient.respondedAt || new Date(),
      },
    });

    // Notify the package creator + super admins so they see the reply at their end.
    const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: { id: true } });
    const ids = new Set(admins.map(a => a.id));
    ids.add(recipient.package.createdById);
    await prisma.notification.createMany({
      data: Array.from(ids).map(userId => ({
        userId,
        type: 'PACKAGE_RESPONSE',
        title: 'Package response received',
        message: `${recipient.user?.name || 'A team head'} responded "${INTEREST_LABEL[interest]}" to "${recipient.package.name}".`,
      })),
    }).catch(() => {});

    return res.json({ message: 'Response submitted. Thank you!' });
  } catch (error) {
    console.error('Respond to my package error:', error);
    return res.status(500).json({ error: 'Failed to submit response', detail: error.message });
  }
}
