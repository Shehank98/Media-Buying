import prisma from '../utils/prisma.js';
import { generateExcel, generatePdf } from '../services/export.service.js';

export async function byChannel(req, res) {
  try {
    const { channelId } = req.params;
    const { format } = req.query;

    const channel = await prisma.channel.findUnique({
      where: { id: parseInt(channelId) },
      include: {
        client: {
          include: {
            agency: { select: { id: true, name: true } },
          },
        },
        properties: {
          include: {
            creator: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const reportData = {
      agency: channel.client.agency,
      client: { id: channel.client.id, name: channel.client.name },
      channel: { id: channel.id, name: channel.name, type: channel.type },
      properties: channel.properties,
    };

    if (format === 'excel' || format === 'pdf') {
      const flatData = channel.properties.map((p) => ({
        Agency: channel.client.agency.name,
        Client: channel.client.name,
        Channel: channel.name,
        'Channel Type': channel.type,
        Property: p.name,
        Type: p.type,
        Cost: String(p.cost),
        Notes: p.notes || '',
        'Created By': p.creator.name,
        'Created At': p.createdAt.toISOString().split('T')[0],
      }));

      const title = `Channel Report - ${channel.name}`;

      if (format === 'excel') {
        const buffer = await generateExcel(flatData, title);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="channel-report-${channelId}.xlsx"`);
        return res.send(buffer);
      }

      if (format === 'pdf') {
        const buffer = await generatePdf(flatData, title);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="channel-report-${channelId}.pdf"`);
        return res.send(buffer);
      }
    }

    return res.json(reportData);
  } catch (error) {
    console.error('Report by channel error:', error);
    return res.status(500).json({ error: 'Failed to generate channel report' });
  }
}

export async function byClient(req, res) {
  try {
    const { clientId } = req.params;
    const { format } = req.query;

    const client = await prisma.client.findUnique({
      where: { id: parseInt(clientId) },
      include: {
        agency: { select: { id: true, name: true } },
        channels: {
          include: {
            properties: {
              include: {
                creator: { select: { id: true, name: true } },
              },
              orderBy: { createdAt: 'desc' },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const reportData = {
      agency: client.agency,
      client: { id: client.id, name: client.name },
      channels: client.channels,
    };

    if (format === 'excel' || format === 'pdf') {
      const flatData = [];
      for (const channel of client.channels) {
        for (const p of channel.properties) {
          flatData.push({
            Agency: client.agency.name,
            Client: client.name,
            Channel: channel.name,
            'Channel Type': channel.type,
            Property: p.name,
            Type: p.type,
            Cost: String(p.cost),
            Notes: p.notes || '',
            'Created By': p.creator.name,
            'Created At': p.createdAt.toISOString().split('T')[0],
          });
        }
      }

      const title = `Client Report - ${client.name}`;

      if (format === 'excel') {
        const buffer = await generateExcel(flatData, title);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="client-report-${clientId}.xlsx"`);
        return res.send(buffer);
      }

      if (format === 'pdf') {
        const buffer = await generatePdf(flatData, title);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="client-report-${clientId}.pdf"`);
        return res.send(buffer);
      }
    }

    return res.json(reportData);
  } catch (error) {
    console.error('Report by client error:', error);
    return res.status(500).json({ error: 'Failed to generate client report' });
  }
}

export async function byAgency(req, res) {
  try {
    const { agencyId } = req.params;
    const { format } = req.query;

    const agency = await prisma.agency.findUnique({
      where: { id: parseInt(agencyId) },
      include: {
        clients: {
          include: {
            channels: {
              include: {
                properties: {
                  include: {
                    creator: { select: { id: true, name: true } },
                  },
                  orderBy: { createdAt: 'desc' },
                },
              },
              orderBy: { name: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!agency) {
      return res.status(404).json({ error: 'Agency not found' });
    }

    const reportData = {
      agency: { id: agency.id, name: agency.name },
      clients: agency.clients,
    };

    if (format === 'excel' || format === 'pdf') {
      const flatData = [];
      for (const client of agency.clients) {
        for (const channel of client.channels) {
          for (const p of channel.properties) {
            flatData.push({
              Agency: agency.name,
              Client: client.name,
              Channel: channel.name,
              'Channel Type': channel.type,
              Property: p.name,
              Type: p.type,
              Cost: String(p.cost),
              Notes: p.notes || '',
              'Created By': p.creator.name,
              'Created At': p.createdAt.toISOString().split('T')[0],
            });
          }
        }
      }

      const title = `Agency Report - ${agency.name}`;

      if (format === 'excel') {
        const buffer = await generateExcel(flatData, title);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="agency-report-${agencyId}.xlsx"`);
        return res.send(buffer);
      }

      if (format === 'pdf') {
        const buffer = await generatePdf(flatData, title);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="agency-report-${agencyId}.pdf"`);
        return res.send(buffer);
      }
    }

    return res.json(reportData);
  } catch (error) {
    console.error('Report by agency error:', error);
    return res.status(500).json({ error: 'Failed to generate agency report' });
  }
}
