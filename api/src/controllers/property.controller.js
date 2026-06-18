import prisma from '../utils/prisma.js';
import { getAccessibleClientIds } from '../middleware/access.js';

// Resolve a property -> its channel's client and confirm the caller can reach it.
// Returns { status, property } where status is 200 / 403 / 404.
async function resolvePropertyAccess(user, propertyId) {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    include: { channel: { select: { clientId: true } } },
  });
  if (!property) return { status: 404 };
  if (user.role === 'SUPER_ADMIN') return { status: 200, property };
  const ids = await getAccessibleClientIds(user.id, user.role);
  if (!ids.includes(property.channel.clientId)) return { status: 403 };
  return { status: 200, property };
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
    const { category, name, type, cost, notes, bonusValue } = req.body;

    if (!category || !String(category).trim()) {
      return res.status(400).json({ error: 'Property category is required' });
    }
    if (!name || cost === undefined) {
      return res.status(400).json({ error: 'Name and property value are required' });
    }

    const property = await prisma.property.create({
      data: {
        channelId: parseInt(channelId),
        category: String(category).trim(),
        name,
        type: type ? String(type).trim() : null,
        cost,
        bonusValue: bonusValue === '' || bonusValue == null ? 0 : Number(bonusValue),
        notes: notes || null,
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
    const { category, name, type, cost, notes, bonusValue, changeNote } = req.body;

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
    if (bonusValue !== undefined) {
      const newB = bonusValue === '' || bonusValue == null ? 0 : Number(bonusValue);
      const oldB = existing.bonusValue == null ? 0 : Number(existing.bonusValue);
      if (newB !== oldB) {
        previousValues.bonusValue = oldB;
        newValues.bonusValue = newB;
      }
    }
    if (notes !== undefined && notes !== existing.notes) {
      previousValues.notes = existing.notes;
      newValues.notes = notes;
    }

    const updateData = {};
    if (category !== undefined) updateData.category = String(category).trim();
    if (name !== undefined) updateData.name = name;
    if (type !== undefined) updateData.type = type ? String(type).trim() : null;
    if (cost !== undefined) updateData.cost = cost;
    if (bonusValue !== undefined) updateData.bonusValue = bonusValue === '' || bonusValue == null ? 0 : Number(bonusValue);
    if (notes !== undefined) updateData.notes = notes;

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
