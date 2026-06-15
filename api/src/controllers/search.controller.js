import prisma from '../utils/prisma.js';
import { getAccessibleClientIds } from '../middleware/access.js';

// Global search across agencies, clients, channels and properties.
// Results are scoped to what the caller can access.
export async function globalSearch(req, res) {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ results: [] });

    const user = req.user;
    const take = 6;
    const contains = { contains: q, mode: 'insensitive' };

    // SUPER_ADMIN sees everything; other roles are scoped to accessible clients.
    const clientIds = user.role === 'SUPER_ADMIN' ? null : await getAccessibleClientIds(user.id, user.role);
    const clientScope = clientIds ? { id: { in: clientIds } } : {};
    const channelScope = clientIds ? { clientId: { in: clientIds } } : {};
    const agencyScope = clientIds ? { clients: { some: { id: { in: clientIds } } } } : {};

    const [clients, channels, agencies, properties] = await Promise.all([
      prisma.client.findMany({
        where: { name: contains, ...clientScope }, take,
        select: { id: true, name: true, agency: { select: { name: true } } },
      }),
      prisma.channel.findMany({
        where: { name: contains, ...channelScope }, take,
        select: { id: true, name: true, client: { select: { name: true } } },
      }),
      prisma.agency.findMany({
        where: { name: contains, ...agencyScope }, take,
        select: { id: true, name: true },
      }),
      prisma.property.findMany({
        where: { name: contains, channel: channelScope }, take,
        select: { id: true, name: true, channel: { select: { id: true, name: true } } },
      }),
    ]);

    const results = [
      ...clients.map((c) => ({ type: 'Client', label: c.name, sub: c.agency?.name || '', to: `/clients/${c.id}` })),
      ...channels.map((c) => ({ type: 'Channel', label: c.name, sub: c.client?.name || '', to: `/channels/${c.id}` })),
      ...agencies.map((a) => ({ type: 'Agency', label: a.name, sub: '', to: `/agencies/${a.id}` })),
      ...properties.map((p) => ({ type: 'Property', label: p.name, sub: p.channel?.name || '', to: `/channels/${p.channel?.id}` })),
    ];

    return res.json({ results });
  } catch (error) {
    console.error('Global search error:', error);
    return res.status(500).json({ error: 'Search failed' });
  }
}
