import prisma from '../utils/prisma.js';
import { getAccessibleClientIds } from '../middleware/access.js';
import { sanitizeBenefits, benefitsSummary } from '../utils/benefits.js';
import {
  isEvaluationConfigured, isAllowedEvaluation, mimeForEvaluation, extOf,
  evaluationName, uploadEvaluation, downloadEvaluation, deleteEvaluation,
} from '../services/evaluation.service.js';

// Resolve a property -> its channel's client and confirm the caller can reach it.
// Returns { status, property } where status is 200 / 403 / 404.
async function resolvePropertyAccess(user, propertyId, includeNames = false) {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    include: includeNames
      ? { channel: { select: { clientId: true, name: true, client: { select: { name: true } } } } }
      : { channel: { select: { clientId: true } } },
  });
  if (!property) return { status: 404 };
  if (user.role === 'SUPER_ADMIN') return { status: 200, property };
  const ids = await getAccessibleClientIds(user.id, user.role);
  if (!ids.includes(property.channel.clientId)) return { status: 403 };
  return { status: 200, property };
}

// POST /api/properties/:id/evaluation - upload/replace the evaluation document
// (PDF or Excel, raw binary body). Header `x-file-name` carries the file name.
export async function uploadPropertyEvaluation(req, res) {
  try {
    const id = parseInt(req.params.id);
    if (!isEvaluationConfigured()) {
      return res.status(400).json({ error: 'Evaluation storage is not configured. Set up the Google Drive connection first.' });
    }
    const fileName = String(req.headers['x-file-name'] || req.query.fileName || '').trim();
    if (!fileName || !isAllowedEvaluation(fileName)) {
      return res.status(400).json({ error: 'Only PDF or Excel (.pdf, .xls, .xlsx) files are allowed.' });
    }
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ error: 'No file received.' });
    }
    const access = await resolvePropertyAccess(req.user, id, true);
    if (access.status === 404) return res.status(404).json({ error: 'Property not found' });
    if (access.status === 403) return res.status(403).json({ error: 'You do not have access to this property' });
    const p = access.property;

    const ext = extOf(fileName);
    const driveName = evaluationName(p.name, ext);
    const uploaded = await uploadEvaluation(body, driveName, {
      client: p.channel.client?.name || 'Client',
      channel: p.channel.name || 'Channel',
      mimeType: mimeForEvaluation(fileName),
    });
    // Replace any previous evaluation (best-effort delete of the old Drive file).
    if (p.evaluationDriveId) deleteEvaluation(p.evaluationDriveId).catch(() => {});

    const updated = await prisma.property.update({
      where: { id },
      data: {
        evaluationDriveId: uploaded.id,
        evaluationFileName: fileName,
        evaluationMimeType: mimeForEvaluation(fileName),
        evaluationSize: uploaded.size,
        evaluationUploadedAt: new Date(),
      },
      include: { creator: { select: { id: true, name: true } } },
    });
    return res.json(updated);
  } catch (error) {
    console.error('uploadPropertyEvaluation error:', error);
    return res.status(500).json({ error: 'Failed to upload evaluation', detail: error.message });
  }
}

// GET /api/properties/:id/evaluation - stream the evaluation document to the browser.
export async function downloadPropertyEvaluation(req, res) {
  try {
    const id = parseInt(req.params.id);
    const access = await resolvePropertyAccess(req.user, id);
    if (access.status === 404) return res.status(404).json({ error: 'Property not found' });
    if (access.status === 403) return res.status(403).json({ error: 'You do not have access to this property' });
    const p = access.property;
    if (!p.evaluationDriveId) return res.status(404).json({ error: 'No evaluation document for this property' });
    const buf = await downloadEvaluation(p.evaluationDriveId);
    res.setHeader('Content-Type', p.evaluationMimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${(p.evaluationFileName || 'evaluation').replace(/"/g, '')}"`);
    res.setHeader('Content-Length', String(buf.length));
    return res.end(buf);
  } catch (error) {
    console.error('downloadPropertyEvaluation error:', error);
    return res.status(500).json({ error: 'Failed to download evaluation', detail: error.message });
  }
}

// DELETE /api/properties/:id/evaluation - remove the evaluation document.
export async function deletePropertyEvaluation(req, res) {
  try {
    const id = parseInt(req.params.id);
    const access = await resolvePropertyAccess(req.user, id);
    if (access.status === 404) return res.status(404).json({ error: 'Property not found' });
    if (access.status === 403) return res.status(403).json({ error: 'You do not have access to this property' });
    const p = access.property;
    if (p.evaluationDriveId) deleteEvaluation(p.evaluationDriveId).catch(() => {});
    const updated = await prisma.property.update({
      where: { id },
      data: { evaluationDriveId: null, evaluationFileName: null, evaluationMimeType: null, evaluationSize: null, evaluationUploadedAt: null },
      include: { creator: { select: { id: true, name: true } } },
    });
    return res.json(updated);
  } catch (error) {
    console.error('deletePropertyEvaluation error:', error);
    return res.status(500).json({ error: 'Failed to delete evaluation', detail: error.message });
  }
}

export async function list(req, res) {
  try {
    const { channelId } = req.params;

    const properties = await prisma.property.findMany({
      where: { channelId: parseInt(channelId) },
      include: {
        creator: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(properties);
  } catch (error) {
    console.error('List properties error:', error);
    return res.status(500).json({ error: 'Failed to list properties' });
  }
}

export async function create(req, res) {
  try {
    const { channelId } = req.params;
    const { category, name, type, cost, notes, bonusCount, startDate, endDate, benefits } = req.body;

    if (!category || !String(category).trim()) {
      return res.status(400).json({ error: 'Property category is required' });
    }
    if (!name || cost === undefined) {
      return res.status(400).json({ error: 'Name and property value are required' });
    }
    if (!startDate) {
      return res.status(400).json({ error: 'Start date is required' });
    }

    // bonusCount = bonus percentage; bonus value is derived = value x bonus% / 100
    const bonusPctNum = bonusCount === '' || bonusCount == null ? 0 : Math.max(0, Math.round(Number(bonusCount)));
    const bonusValueNum = Math.round((Number(cost) * bonusPctNum / 100) * 100) / 100;

    const property = await prisma.property.create({
      data: {
        channelId: parseInt(channelId),
        category: String(category).trim(),
        name,
        type: type ? String(type).trim() : null,
        cost,
        bonusCount: bonusPctNum,
        bonusValue: bonusValueNum,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        notes: notes || null,
        benefits: sanitizeBenefits(benefits),
        createdBy: req.user.id,
      },
      include: {
        creator: { select: { id: true, name: true } },
      },
    });

    return res.status(201).json(property);
  } catch (error) {
    console.error('Create property error:', error);
    return res.status(500).json({ error: 'Failed to create property' });
  }
}

export async function update(req, res) {
  try {
    const { id } = req.params;
    const { category, name, type, cost, notes, bonusCount, startDate, endDate, changeNote, benefits } = req.body;

    if (!changeNote) {
      return res.status(400).json({ error: 'changeNote is required when updating a property' });
    }

    const access = await resolvePropertyAccess(req.user, parseInt(id));
    if (access.status === 404) return res.status(404).json({ error: 'Property not found' });
    if (access.status === 403) return res.status(403).json({ error: 'You do not have access to this property' });
    const existing = access.property;

    // Build previous and new values for history
    const previousValues = {};
    const newValues = {};

    if (category !== undefined && String(category).trim() !== (existing.category || '')) {
      previousValues.category = existing.category || null;
      newValues.category = String(category).trim();
    }
    if (name !== undefined && name !== existing.name) {
      previousValues.name = existing.name;
      newValues.name = name;
    }
    if (type !== undefined && (type || null) !== (existing.type || null)) {
      previousValues.type = existing.type || null;
      newValues.type = type ? String(type).trim() : null;
    }
    if (cost !== undefined && String(cost) !== String(existing.cost)) {
      previousValues.cost = existing.cost;
      newValues.cost = cost;
    }
    // bonusCount = bonus percentage; bonus value is derived = value x bonus% / 100
    if (bonusCount !== undefined) {
      const newC = bonusCount === '' || bonusCount == null ? 0 : Math.max(0, Math.round(Number(bonusCount)));
      const oldC = existing.bonusCount == null ? 0 : Number(existing.bonusCount);
      if (newC !== oldC) {
        previousValues.bonusCount = oldC;
        newValues.bonusCount = newC;
      }
    }
    if (notes !== undefined && notes !== existing.notes) {
      previousValues.notes = existing.notes;
      newValues.notes = notes;
    }
    const toDateStr = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
    if (startDate !== undefined && toDateStr(startDate) !== toDateStr(existing.startDate)) {
      previousValues.startDate = toDateStr(existing.startDate);
      newValues.startDate = toDateStr(startDate);
    }
    if (endDate !== undefined && toDateStr(endDate) !== toDateStr(existing.endDate)) {
      previousValues.endDate = toDateStr(existing.endDate);
      newValues.endDate = toDateStr(endDate);
    }
    // Benefits are diffed on their readable summary ("50 Trailers · 20 Mid
    // intro") so the history timeline shows what actually changed rather than
    // a blob of JSON.
    let benefitsClean;
    if (benefits !== undefined) {
      benefitsClean = sanitizeBenefits(benefits);
      const oldSummary = benefitsSummary(existing.benefits);
      const newSummary = benefitsSummary(benefitsClean);
      if (oldSummary !== newSummary) {
        previousValues.benefits = oldSummary || null;
        newValues.benefits = newSummary || null;
      }
    }

    const updateData = {};
    if (category !== undefined) updateData.category = String(category).trim();
    if (name !== undefined) updateData.name = name;
    if (type !== undefined) updateData.type = type ? String(type).trim() : null;
    if (cost !== undefined) updateData.cost = cost;
    if (bonusCount !== undefined) updateData.bonusCount = bonusCount === '' || bonusCount == null ? 0 : Math.max(0, Math.round(Number(bonusCount)));
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
    if (notes !== undefined) updateData.notes = notes;
    if (benefits !== undefined) updateData.benefits = benefitsClean;
    // Recompute the derived bonus value whenever the value or the bonus % changes.
    if (cost !== undefined || bonusCount !== undefined) {
      const baseCost = cost !== undefined ? Number(cost) : Number(existing.cost);
      const basePct = bonusCount !== undefined
        ? (bonusCount === '' || bonusCount == null ? 0 : Math.max(0, Math.round(Number(bonusCount))))
        : Number(existing.bonusCount || 0);
      const newBonusValue = Math.round((baseCost * basePct / 100) * 100) / 100;
      updateData.bonusValue = newBonusValue;
      const oldBonusValue = existing.bonusValue == null ? 0 : Number(existing.bonusValue);
      if (newBonusValue !== oldBonusValue) {
        previousValues.bonusValue = oldBonusValue;
        newValues.bonusValue = newBonusValue;
      }
    }

    const [history, property] = await prisma.$transaction([
      prisma.propertyHistory.create({
        data: {
          propertyId: parseInt(id),
          changedBy: req.user.id,
          previousValues,
          newValues,
          changeNote,
        },
      }),
      prisma.property.update({
        where: { id: parseInt(id) },
        data: updateData,
        include: {
          creator: { select: { id: true, name: true } },
        },
      }),
    ]);

    return res.json(property);
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Property not found' });
    }
    console.error('Update property error:', error);
    return res.status(500).json({ error: 'Failed to update property' });
  }
}

export async function getHistory(req, res) {
  try {
    const { id } = req.params;

    const access = await resolvePropertyAccess(req.user, parseInt(id));
    if (access.status === 404) return res.status(404).json({ error: 'Property not found' });
    if (access.status === 403) return res.status(403).json({ error: 'You do not have access to this property' });

    const history = await prisma.propertyHistory.findMany({
      where: { propertyId: parseInt(id) },
      include: {
        changer: { select: { id: true, name: true } },
      },
      orderBy: { changedAt: 'desc' },
    });

    return res.json(history);
  } catch (error) {
    console.error('Get property history error:', error);
    return res.status(500).json({ error: 'Failed to get property history' });
  }
}

export async function remove(req, res) {
  try {
    const { id } = req.params;

    const access = await resolvePropertyAccess(req.user, parseInt(id));
    if (access.status === 404) return res.status(404).json({ error: 'Property not found' });
    if (access.status === 403) return res.status(403).json({ error: 'You do not have access to this property' });

    await prisma.property.delete({ where: { id: parseInt(id) } });
    return res.json({ message: 'Property deleted successfully' });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Property not found' });
    }
    console.error('Delete property error:', error);
    return res.status(500).json({ error: 'Failed to delete property' });
  }
}
