import prisma from '../utils/prisma.js';

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
    const { name, type, cost, notes } = req.body;

    if (!name || !type || cost === undefined) {
      return res.status(400).json({ error: 'Name, type, and cost are required' });
    }

    const property = await prisma.property.create({
      data: {
        channelId: parseInt(channelId),
        name,
        type,
        cost,
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
    const { name, type, cost, notes, changeNote } = req.body;

    if (!changeNote) {
      return res.status(400).json({ error: 'changeNote is required when updating a property' });
    }

    const existing = await prisma.property.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Property not found' });
    }

    // Build previous and new values for history
    const previousValues = {};
    const newValues = {};

    if (name !== undefined && name !== existing.name) {
      previousValues.name = existing.name;
      newValues.name = name;
    }
    if (type !== undefined && type !== existing.type) {
      previousValues.type = existing.type;
      newValues.type = type;
    }
    if (cost !== undefined && String(cost) !== String(existing.cost)) {
      previousValues.cost = existing.cost;
      newValues.cost = cost;
    }
    if (notes !== undefined && notes !== existing.notes) {
      previousValues.notes = existing.notes;
      newValues.notes = notes;
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (type !== undefined) updateData.type = type;
    if (cost !== undefined) updateData.cost = cost;
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
