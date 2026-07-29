import prisma from '../utils/prisma.js';
import {
  uploadRateCard, downloadRateCard, deleteRateCard, isRateCardConfigured,
  mimeForFile, isAllowedRateCard, extOf, rateCardName,
} from '../services/ratecard.service.js';
import { sanitizeBenefits } from '../utils/benefits.js';

export async function getChannel(req, res) {
  try {
    const channel = await prisma.channel.findUnique({
      where: { id: parseInt(req.params.channelId) },
      include: {
        client: { include: { agency: true } },
        _count: { select: { properties: true } },
      },
    });

    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    return res.json({
      channel: {
        ...channel,
        clientName: channel.client?.name,
        agencyName: channel.client?.agency?.name,
      },
    });
  } catch (error) {
    console.error('Get channel error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getProperties(req, res) {
  try {
    const properties = await prisma.property.findMany({
      where: { channelId: parseInt(req.params.channelId) },
      include: { creator: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({
      properties: properties.map((p) => ({
        ...p,
        createdByName: p.creator?.name,
      })),
    });
  } catch (error) {
    console.error('Get properties error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createProperty(req, res) {
  try {
    const { category, name, type, cost, notes, bonusCount, startDate, endDate, benefits } = req.body;

    if (!category || !String(category).trim()) {
      return res.status(400).json({ error: 'Property category is required' });
    }
    if (!name || cost == null) {
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
        channelId: parseInt(req.params.channelId),
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
      include: { creator: { select: { id: true, name: true } } },
    });

    return res.status(201).json({ property });
  } catch (error) {
    console.error('Create property error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Channel-client deals (discount %/bonus % negotiation terms) ────────────
// Channel.id is client-specific; ChannelClientDeal keys on channelMasterId +
// clientId, so every handler below resolves those two from the Channel row
// first. A channel not yet linked to a ChannelMaster (channelMasterId null)
// can't have deals recorded against it.

export async function listChannelDeals(req, res) {
  try {
    const channel = await prisma.channel.findUnique({
      where: { id: parseInt(req.params.channelId) },
      select: { clientId: true, channelMasterId: true },
    });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (!channel.channelMasterId) {
      return res.json({ deals: [], channelMasterId: null });
    }

    const deals = await prisma.channelClientDeal.findMany({
      where: { channelMasterId: channel.channelMasterId, clientId: channel.clientId },
      orderBy: { year: 'desc' },
      include: { createdBy: { select: { id: true, name: true } } },
    });

    return res.json({
      deals: deals.map((d) => ({ ...d, createdByName: d.createdBy?.name })),
      channelMasterId: channel.channelMasterId,
    });
  } catch (error) {
    console.error('List channel deals error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function upsertChannelDeal(req, res) {
  try {
    const { year, discountPct, bonusPct, notes } = req.body;
    if (!year || discountPct == null || bonusPct == null) {
      return res.status(400).json({ error: 'Year, discountPct and bonusPct are required' });
    }
    const rateType = ['DISCOUNT', 'CPRP', 'FLAT'].includes(req.body.rateType) ? req.body.rateType : 'DISCOUNT';
    const rateValue = rateType === 'DISCOUNT' ? null : (req.body.rateValue == null || req.body.rateValue === '' ? null : Number(req.body.rateValue));

    const channel = await prisma.channel.findUnique({
      where: { id: parseInt(req.params.channelId) },
      select: { clientId: true, channelMasterId: true },
    });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (!channel.channelMasterId) {
      return res.status(400).json({ error: 'This channel is not linked to a master channel, so deal terms cannot be recorded against it' });
    }

    const deal = await prisma.channelClientDeal.upsert({
      where: {
        channelMasterId_clientId_year: {
          channelMasterId: channel.channelMasterId,
          clientId: channel.clientId,
          year: parseInt(year),
        },
      },
      update: { discountPct, bonusPct, rateType, rateValue, notes: notes || null },
      create: {
        channelMasterId: channel.channelMasterId,
        clientId: channel.clientId,
        year: parseInt(year),
        discountPct,
        bonusPct,
        rateType,
        rateValue,
        notes: notes || null,
        createdById: req.user.id,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });

    return res.status(201).json({ deal: { ...deal, createdByName: deal.createdBy?.name } });
  } catch (error) {
    console.error('Upsert channel deal error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updateChannelDeal(req, res) {
  try {
    const { discountPct, bonusPct, notes } = req.body;
    if (discountPct == null || bonusPct == null) {
      return res.status(400).json({ error: 'discountPct and bonusPct are required' });
    }
    const rateType = ['DISCOUNT', 'CPRP', 'FLAT'].includes(req.body.rateType) ? req.body.rateType : 'DISCOUNT';
    const rateValue = rateType === 'DISCOUNT' ? null : (req.body.rateValue == null || req.body.rateValue === '' ? null : Number(req.body.rateValue));

    const deal = await prisma.channelClientDeal.update({
      where: { id: parseInt(req.params.id) },
      data: { discountPct, bonusPct, rateType, rateValue, notes: notes || null },
      include: { createdBy: { select: { id: true, name: true } } },
    });

    return res.json({ deal: { ...deal, createdByName: deal.createdBy?.name } });
  } catch (error) {
    console.error('Update channel deal error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteChannelDeal(req, res) {
  try {
    await prisma.channelClientDeal.delete({ where: { id: parseInt(req.params.id) } });
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete channel deal error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── Client-specific rate card (SUPER_ADMIN upload/delete; any access downloads) ──
// Stored in Google Drive under Client Rate Cards/<client>/<channel>/, versioned
// like the general (ChannelMaster) rate card. Distinct from the general card:
// this is what the channel offers THIS client.

export async function uploadClientRateCard(req, res) {
  try {
    if (!isRateCardConfigured()) {
      return res.status(503).json({ error: 'Rate card storage is not configured. Set the Google Drive OAuth env vars, or a service account + GDRIVE_RATECARD_FOLDER_ID.' });
    }
    const id = parseInt(req.params.channelId);
    const channel = await prisma.channel.findUnique({
      where: { id },
      select: { id: true, name: true, type: true, rateCardVersions: true, client: { select: { name: true } }, channelMaster: { select: { medium: true } } },
    });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const { fileName, dataBase64 } = req.body || {};
    if (!dataBase64 || typeof dataBase64 !== 'string') return res.status(400).json({ error: 'dataBase64 (the file) is required' });
    const uploaded = String(fileName || 'rate-card.pdf').trim();
    if (!isAllowedRateCard(uploaded)) return res.status(400).json({ error: 'Unsupported file type. Allowed: PDF, JPG, PNG, Excel (xls/xlsx), CSV, Word' });
    const ext = extOf(uploaded);
    const mimeType = mimeForFile(uploaded);
    // Auto-rename to <Channel>_<Medium>_<UploadDate>.<ext> (ignore original name).
    const name = rateCardName(channel.name, channel.channelMaster?.medium || channel.type, ext);

    const b64 = dataBase64.includes(',') ? dataBase64.split(',').pop() : dataBase64;
    const buffer = Buffer.from(b64, 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'Empty file' });
    if (buffer.length > 25 * 1024 * 1024) return res.status(413).json({ error: 'Rate card must be 25 MB or smaller' });

    const prior = Array.isArray(channel.rateCardVersions) ? channel.rateCardVersions : [];
    const version = prior.length + 1;
    const bareName = name.replace(new RegExp(`\\.${ext}$`, 'i'), '');
    const driveName = `${bareName} (v${version}).${ext}`;
    const up = await uploadRateCard(buffer, driveName, {
      folders: ['Client Rate Cards', channel.client?.name || `Client ${id}`, channel.name],
      mimeType,
    });
    const entry = { version, driveId: up.id, fileName: name, mimeType, size: up.size, uploadedAt: new Date().toISOString() };
    const versions = [...prior, entry];

    const saved = await prisma.channel.update({
      where: { id },
      data: {
        rateCardDriveId: up.id, rateCardFileName: name, rateCardMimeType: mimeType,
        rateCardSize: up.size, rateCardUploadedAt: new Date(), rateCardVersions: versions,
      },
      select: { id: true, rateCardFileName: true, rateCardMimeType: true, rateCardSize: true, rateCardUploadedAt: true, rateCardVersions: true },
    });
    return res.json({ channel: saved });
  } catch (error) {
    console.error('uploadClientRateCard error:', error);
    return res.status(500).json({ error: 'Failed to upload rate card', detail: error.message });
  }
}

export async function getClientRateCard(req, res) {
  try {
    const id = parseInt(req.params.channelId);
    const channel = await prisma.channel.findUnique({
      where: { id },
      select: { rateCardDriveId: true, rateCardFileName: true, rateCardMimeType: true, rateCardVersions: true },
    });
    if (!channel || !channel.rateCardDriveId) return res.status(404).json({ error: 'No rate card for this channel' });
    if (!isRateCardConfigured()) return res.status(503).json({ error: 'Rate card storage is not configured' });

    const versions = Array.isArray(channel.rateCardVersions) ? channel.rateCardVersions : [];
    let driveId = channel.rateCardDriveId;
    let fileName = channel.rateCardFileName;
    let mimeType = channel.rateCardMimeType || 'application/pdf';
    if (req.query.driveId) {
      const v = versions.find(x => x.driveId === req.query.driveId);
      if (!v && req.query.driveId !== channel.rateCardDriveId) return res.status(404).json({ error: 'Version not found' });
      driveId = req.query.driveId;
      if (v) { fileName = v.fileName || fileName; mimeType = v.mimeType || mimeType; }
    }
    const buffer = await downloadRateCard(driveId);
    const disp = req.query.download === '1' ? 'attachment' : 'inline';
    const safeName = (fileName || 'rate-card').replace(/["\r\n]/g, '');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `${disp}; filename="${safeName}"`);
    return res.send(buffer);
  } catch (error) {
    console.error('getClientRateCard error:', error);
    return res.status(500).json({ error: 'Failed to fetch rate card', detail: error.message });
  }
}

export async function deleteClientRateCard(req, res) {
  try {
    const id = parseInt(req.params.channelId);
    const channel = await prisma.channel.findUnique({
      where: { id },
      select: { rateCardDriveId: true, rateCardVersions: true },
    });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    const ids = new Set([channel.rateCardDriveId, ...(Array.isArray(channel.rateCardVersions) ? channel.rateCardVersions.map(v => v.driveId) : [])].filter(Boolean));
    for (const did of ids) await deleteRateCard(did).catch(() => {});
    await prisma.channel.update({
      where: { id },
      data: { rateCardDriveId: null, rateCardFileName: null, rateCardMimeType: null, rateCardSize: null, rateCardUploadedAt: null, rateCardVersions: null },
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error('deleteClientRateCard error:', error);
    return res.status(500).json({ error: 'Failed to remove rate card', detail: error.message });
  }
}

// List every channel master that has a GENERAL rate card - feeds the Rate Cards
// page (search by channel name + download). Open to all authenticated roles.
export async function listGeneralRateCards(req, res) {
  try {
    const rows = await prisma.channelMaster.findMany({
      where: { rateCardDriveId: { not: null } },
      select: {
        id: true, name: true, medium: true,
        rateCardFileName: true, rateCardMimeType: true, rateCardSize: true, rateCardUploadedAt: true, rateCardVersions: true,
        mediaGroup: { select: { name: true } },
      },
      orderBy: [{ medium: 'asc' }, { name: 'asc' }],
    });
    const cards = rows.map(r => ({
      channelMasterId: r.id,
      name: r.name,
      medium: r.medium,
      mediaGroup: r.mediaGroup?.name || '',
      fileName: r.rateCardFileName,
      mimeType: r.rateCardMimeType,
      size: r.rateCardSize,
      uploadedAt: r.rateCardUploadedAt,
      versionCount: Array.isArray(r.rateCardVersions) ? r.rateCardVersions.length : 0,
      versions: Array.isArray(r.rateCardVersions) ? r.rateCardVersions : [],
    }));
    return res.json({ cards });
  } catch (error) {
    console.error('listGeneralRateCards error:', error);
    return res.status(500).json({ error: 'Failed to list rate cards', detail: error.message });
  }
}
