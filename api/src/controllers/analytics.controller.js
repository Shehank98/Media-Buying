import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a raw SQL fragment that restricts schedule_logs to the MANAGER's
 * accessible agencies, or to an explicit agencyId if provided.
 * Returns a Prisma.sql fragment ready to embed in a WHERE clause with AND.
 */
function buildAgencyFilter(user, agencyId) {
  if (agencyId) {
    return Prisma.sql`AND c.agency_id = ${parseInt(agencyId)}`;
  }
  if (user.role === 'MANAGER') {
    return Prisma.sql`AND c.agency_id IN (
      SELECT agency_id FROM user_agency_access WHERE user_id = ${user.id}
    )`;
  }
  return Prisma.sql``;
}

/** Format a Date to "YYYY-MM" */
function toYearMonth(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().slice(0, 7);
}

function safeNum(v) {
  if (v == null) return null;
  return Number(v);
}

// ── Channel Intelligence ──────────────────────────────────────────────────────

/**
 * GET /analytics/channel/:channelMasterId/summary
 * Access: SUPER_ADMIN, MANAGER, GROUP_HEAD
 */
export async function getChannelSummary(req, res) {
  try {
    const channelMasterId = parseInt(req.params.channelMasterId);

    const channel = await prisma.channelMaster.findUnique({
      where: { id: channelMasterId },
      select: { id: true, name: true, medium: true },
    });
    if (!channel) return res.status(404).json({ error: 'Channel master not found' });

    const [ytdRows, lastYearRows, bestMonthRows, activeClientsRows, totalRows] =
      await Promise.all([
        prisma.$queryRaw`
          SELECT COALESCE(SUM(invoice_value), 0) AS total
          FROM schedule_logs
          WHERE channel_master_id = ${channelMasterId}
            AND EXTRACT(year FROM schedule_month) = EXTRACT(year FROM NOW())
        `,
        prisma.$queryRaw`
          SELECT COALESCE(SUM(invoice_value), 0) AS total
          FROM schedule_logs
          WHERE channel_master_id = ${channelMasterId}
            AND EXTRACT(year FROM schedule_month) = EXTRACT(year FROM NOW()) - 1
        `,
        prisma.$queryRaw`
          SELECT DATE_TRUNC('month', schedule_month) AS month,
                 SUM(invoice_value)                  AS total
          FROM schedule_logs
          WHERE channel_master_id = ${channelMasterId}
            AND invoice_value IS NOT NULL
          GROUP BY DATE_TRUNC('month', schedule_month)
          ORDER BY SUM(invoice_value) DESC
          LIMIT 1
        `,
        prisma.$queryRaw`
          SELECT COUNT(DISTINCT client_id) AS cnt
          FROM schedule_logs
          WHERE channel_master_id = ${channelMasterId}
            AND EXTRACT(year FROM schedule_month) = EXTRACT(year FROM NOW())
        `,
        prisma.$queryRaw`
          SELECT COUNT(*) AS cnt
          FROM schedule_logs
          WHERE channel_master_id = ${channelMasterId}
        `,
      ]);

    const ytdSpend = safeNum(ytdRows[0]?.total) ?? 0;
    const lastYearSpend = safeNum(lastYearRows[0]?.total) ?? 0;
    const yoyGrowthPct =
      lastYearSpend > 0 ? ((ytdSpend - lastYearSpend) / lastYearSpend) * 100 : null;

    const bm = bestMonthRows[0];
    const bestMonth = bm
      ? { month: toYearMonth(bm.month), value: safeNum(bm.total) }
      : null;

    return res.json({
      channel,
      ytdSpend,
      lastYearSpend,
      yoyGrowthPct: yoyGrowthPct != null ? Number(yoyGrowthPct.toFixed(2)) : null,
      activeClientsCount: Number(activeClientsRows[0]?.cnt ?? 0),
      bestMonth,
      totalEntries: Number(totalRows[0]?.cnt ?? 0),
    });
  } catch (error) {
    console.error('getChannelSummary error:', error);
    return res.status(500).json({ error: 'Failed to get channel summary' });
  }
}

/**
 * GET /analytics/channel/:channelMasterId/monthly-spend
 * Query: ?agencyId=&clientId=&yearFrom=&yearTo=
 */
export async function getChannelMonthlySpend(req, res) {
  try {
    const channelMasterId = parseInt(req.params.channelMasterId);
    const { agencyId, clientId, yearFrom, yearTo } = req.query;

    let dateFilter = Prisma.sql``;
    if (yearFrom) dateFilter = Prisma.sql`${dateFilter} AND EXTRACT(year FROM sl.schedule_month) >= ${parseInt(yearFrom)}`;
    if (yearTo)   dateFilter = Prisma.sql`${dateFilter} AND EXTRACT(year FROM sl.schedule_month) <= ${parseInt(yearTo)}`;

    let clientFilter = Prisma.sql``;
    if (clientId) {
      clientFilter = Prisma.sql`AND sl.client_id = ${parseInt(clientId)}`;
    } else if (agencyId) {
      clientFilter = Prisma.sql`AND sl.client_id IN (SELECT id FROM clients WHERE agency_id = ${parseInt(agencyId)})`;
    } else if (req.user.role === 'MANAGER') {
      clientFilter = Prisma.sql`AND sl.client_id IN (
        SELECT id FROM clients WHERE agency_id IN (
          SELECT agency_id FROM user_agency_access WHERE user_id = ${req.user.id}
        )
      )`;
    }

    const rows = await prisma.$queryRaw`
      SELECT DATE_TRUNC('month', sl.schedule_month)    AS month,
             COALESCE(SUM(sl.invoice_value), 0)        AS invoice_value,
             COALESCE(SUM(sl.schedule_value), 0)       AS schedule_value
      FROM schedule_logs sl
      WHERE sl.channel_master_id = ${channelMasterId}
        ${dateFilter}
        ${clientFilter}
      GROUP BY DATE_TRUNC('month', sl.schedule_month)
      ORDER BY month ASC
    `;

    // Compute 12-month rolling average for invoice_value
    const values = rows.map(r => Number(r.invoice_value));
    const result = rows.map((r, i) => {
      const windowStart = Math.max(0, i - 11);
      const window = values.slice(windowStart, i + 1);
      const avg = window.reduce((a, b) => a + b, 0) / window.length;
      const iv = Number(r.invoice_value);
      return {
        month: toYearMonth(r.month),
        invoiceValue: iv,
        scheduleValue: Number(r.schedule_value),
        isAboveAverage: iv > avg * 1.2,
        isBelowAverage: iv < avg * 0.8,
      };
    });

    return res.json(result);
  } catch (error) {
    console.error('getChannelMonthlySpend error:', error);
    return res.status(500).json({ error: 'Failed to get monthly spend' });
  }
}

/**
 * GET /analytics/channel/:channelMasterId/clients
 * Query: ?yearFrom=&yearTo=
 */
export async function getChannelClients(req, res) {
  try {
    const channelMasterId = parseInt(req.params.channelMasterId);
    const { yearFrom, yearTo } = req.query;

    let dateFilter = Prisma.sql``;
    if (yearFrom) dateFilter = Prisma.sql`${dateFilter} AND EXTRACT(year FROM sl.schedule_month) >= ${parseInt(yearFrom)}`;
    if (yearTo)   dateFilter = Prisma.sql`${dateFilter} AND EXTRACT(year FROM sl.schedule_month) <= ${parseInt(yearTo)}`;

    let managerFilter = Prisma.sql``;
    if (req.user.role === 'MANAGER') {
      managerFilter = Prisma.sql`AND sl.client_id IN (
        SELECT id FROM clients WHERE agency_id IN (
          SELECT agency_id FROM user_agency_access WHERE user_id = ${req.user.id}
        )
      )`;
    }

    const rows = await prisma.$queryRaw`
      SELECT sl.client_id                                         AS "clientId",
             cl.name                                             AS "clientName",
             cl.agency_id                                        AS "agencyId",
             a.name                                              AS "agencyName",
             COALESCE(SUM(sl.schedule_value), 0)                 AS "totalScheduleValue",
             COALESCE(SUM(sl.invoice_value), 0)                  AS "totalInvoiceValue",
             COUNT(DISTINCT DATE_TRUNC('month', sl.schedule_month)) AS "monthsActive",
             MAX(DATE_TRUNC('month', sl.schedule_month))          AS "lastActive"
      FROM schedule_logs sl
      JOIN clients cl ON cl.id = sl.client_id
      JOIN agencies a ON a.id = cl.agency_id
      WHERE sl.channel_master_id = ${channelMasterId}
        ${dateFilter}
        ${managerFilter}
      GROUP BY sl.client_id, cl.name, cl.agency_id, a.name
      ORDER BY SUM(sl.invoice_value) DESC NULLS LAST
    `;

    const result = rows.map(r => ({
      clientId: Number(r.clientId),
      clientName: r.clientName,
      agencyId: Number(r.agencyId),
      agencyName: r.agencyName,
      totalScheduleValue: Number(r.totalScheduleValue),
      totalInvoiceValue: Number(r.totalInvoiceValue),
      monthsActive: Number(r.monthsActive),
      lastActive: toYearMonth(r.lastActive),
    }));

    return res.json(result);
  } catch (error) {
    console.error('getChannelClients error:', error);
    return res.status(500).json({ error: 'Failed to get channel clients' });
  }
}

/**
 * GET /analytics/channel/:channelMasterId/property-history
 * Query: ?propertyName=&clientId=&yearFrom=&yearTo=
 */
export async function getChannelPropertyHistory(req, res) {
  try {
    const channelMasterId = parseInt(req.params.channelMasterId);
    const { propertyName, clientId, yearFrom, yearTo } = req.query;

    let filters = Prisma.sql``;
    if (clientId)      filters = Prisma.sql`${filters} AND cl.id = ${parseInt(clientId)}`;
    if (propertyName)  filters = Prisma.sql`${filters} AND p.name ILIKE ${'%' + propertyName + '%'}`;
    if (yearFrom)      filters = Prisma.sql`${filters} AND EXTRACT(year FROM p.created_at) >= ${parseInt(yearFrom)}`;
    if (yearTo)        filters = Prisma.sql`${filters} AND EXTRACT(year FROM p.created_at) <= ${parseInt(yearTo)}`;

    const rows = await prisma.$queryRaw`
      SELECT
        p.id,
        p.name                                  AS "propertyName",
        p.type,
        p.cost,
        p.bonus_pct                             AS "bonusPct",
        p.sponsorship_details                   AS "sponsorshipDetails",
        p.notes,
        p.created_at                            AS "createdAt",
        EXTRACT(year FROM p.created_at)::int    AS year,
        cl.name                                 AS "clientName",
        a.name                                  AS "agencyName",
        u.name                                  AS "creatorName",
        ch.name                                 AS "channelName"
      FROM properties p
      JOIN channels ch ON ch.id = p.channel_id
      JOIN clients cl ON cl.id = ch.client_id
      JOIN agencies a ON a.id = cl.agency_id
      JOIN users u ON u.id = p.created_by
      WHERE ch.channel_master_id = ${channelMasterId}
        ${filters}
      ORDER BY p.name ASC, p.created_at ASC
    `;

    // Group by property name and compute % change from previous year entry
    const grouped = {};
    for (const r of rows) {
      const key = r.propertyName;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({
        id: Number(r.id),
        year: r.year,
        clientName: r.clientName,
        agencyName: r.agencyName,
        type: r.type,
        cost: Number(r.cost),
        bonusPct: r.bonusPct != null ? Number(r.bonusPct) : null,
        sponsorshipDetails: r.sponsorshipDetails ?? null,
        notes: r.notes ?? null,
        creatorName: r.creatorName,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
        changeFromPrev: null,
        changeDirection: null,
      });
    }

    // Compute year-over-year change within each property group
    const result = Object.entries(grouped).map(([name, entries]) => {
      // Sort by year
      entries.sort((a, b) => a.year - b.year);
      for (let i = 1; i < entries.length; i++) {
        const prev = entries[i - 1].cost;
        const curr = entries[i].cost;
        if (prev !== 0) {
          const pct = ((curr - prev) / prev) * 100;
          entries[i].changeFromPrev = Number(pct.toFixed(2));
          entries[i].changeDirection = pct > 0 ? 'up' : pct < 0 ? 'down' : 'same';
        } else {
          entries[i].changeFromPrev = null;
          entries[i].changeDirection = null;
        }
      }
      return { propertyName: name, entries };
    });

    return res.json(result);
  } catch (error) {
    console.error('getChannelPropertyHistory error:', error);
    return res.status(500).json({ error: 'Failed to get property history' });
  }
}

// ── Executive Dashboard ───────────────────────────────────────────────────────

/**
 * GET /analytics/dashboard/summary
 * Access: SUPER_ADMIN, MANAGER
 */
export async function getDashboardSummary(req, res) {
  try {
    const { agencyId } = req.query;
    const agencyFilter = buildAgencyFilter(req.user, agencyId);

    const [thisMonthRows, ytdRows, lastYearYtdRows, activeClientsRows, logsThisMonthRows, activeChannelsRows] =
      await Promise.all([
        prisma.$queryRaw`
          SELECT COALESCE(SUM(sl.invoice_value), 0) AS total
          FROM schedule_logs sl
          JOIN clients c ON c.id = sl.client_id
          WHERE DATE_TRUNC('month', sl.schedule_month) = DATE_TRUNC('month', NOW())
            ${agencyFilter}
        `,
        prisma.$queryRaw`
          SELECT COALESCE(SUM(sl.invoice_value), 0) AS total
          FROM schedule_logs sl
          JOIN clients c ON c.id = sl.client_id
          WHERE EXTRACT(year FROM sl.schedule_month) = EXTRACT(year FROM NOW())
            ${agencyFilter}
        `,
        prisma.$queryRaw`
          SELECT COALESCE(SUM(sl.invoice_value), 0) AS total
          FROM schedule_logs sl
          JOIN clients c ON c.id = sl.client_id
          WHERE EXTRACT(year FROM sl.schedule_month) = EXTRACT(year FROM NOW()) - 1
            AND EXTRACT(month FROM sl.schedule_month) <= EXTRACT(month FROM NOW())
            ${agencyFilter}
        `,
        prisma.$queryRaw`
          SELECT COUNT(DISTINCT sl.client_id) AS cnt
          FROM schedule_logs sl
          JOIN clients c ON c.id = sl.client_id
          WHERE EXTRACT(year FROM sl.schedule_month) = EXTRACT(year FROM NOW())
            ${agencyFilter}
        `,
        prisma.$queryRaw`
          SELECT COUNT(*) AS cnt
          FROM schedule_logs sl
          JOIN clients c ON c.id = sl.client_id
          WHERE DATE_TRUNC('month', sl.schedule_month) = DATE_TRUNC('month', NOW())
            ${agencyFilter}
        `,
        prisma.$queryRaw`
          SELECT COUNT(DISTINCT sl.channel_master_id) AS cnt
          FROM schedule_logs sl
          JOIN clients c ON c.id = sl.client_id
          WHERE DATE_TRUNC('month', sl.schedule_month) = DATE_TRUNC('month', NOW())
            ${agencyFilter}
        `,
      ]);

    const billingsYTD = Number(ytdRows[0]?.total ?? 0);
    const lastYearYTD = Number(lastYearYtdRows[0]?.total ?? 0);
    const yoyGrowthPct = lastYearYTD > 0
      ? Number(((billingsYTD - lastYearYTD) / lastYearYTD * 100).toFixed(2))
      : null;

    return res.json({
      billingsThisMonth: Number(thisMonthRows[0]?.total ?? 0),
      billingsYTD,
      yoyGrowthPct,
      activeClients: Number(activeClientsRows[0]?.cnt ?? 0),
      logsThisMonth: Number(logsThisMonthRows[0]?.cnt ?? 0),
      activeChannelsThisMonth: Number(activeChannelsRows[0]?.cnt ?? 0),
    });
  } catch (error) {
    console.error('getDashboardSummary error:', error);
    return res.status(500).json({ error: 'Failed to get dashboard summary' });
  }
}

/**
 * GET /analytics/dashboard/agency-comparison
 * Access: SUPER_ADMIN, MANAGER
 */
export async function getAgencyComparison(req, res) {
  try {
    let agencyWhere = Prisma.sql``;
    if (req.user.role === 'MANAGER') {
      agencyWhere = Prisma.sql`WHERE a.id IN (
        SELECT agency_id FROM user_agency_access WHERE user_id = ${req.user.id}
      )`;
    }

    const agencies = await prisma.$queryRaw`
      SELECT a.id, a.name FROM agencies a ${agencyWhere} ORDER BY a.name
    `;

    const result = await Promise.all(agencies.map(async agency => {
      const agencyId = Number(agency.id);

      const [ytdRows, activeClientsRows, activeChannelsRows, lastYearRows, monthlyRows] =
        await Promise.all([
          prisma.$queryRaw`
            SELECT COALESCE(SUM(invoice_value), 0) AS total
            FROM schedule_logs
            WHERE client_id IN (SELECT id FROM clients WHERE agency_id = ${agencyId})
              AND EXTRACT(year FROM schedule_month) = EXTRACT(year FROM NOW())
          `,
          prisma.$queryRaw`
            SELECT COUNT(DISTINCT client_id) AS cnt
            FROM schedule_logs
            WHERE client_id IN (SELECT id FROM clients WHERE agency_id = ${agencyId})
              AND EXTRACT(year FROM schedule_month) = EXTRACT(year FROM NOW())
          `,
          prisma.$queryRaw`
            SELECT COUNT(DISTINCT channel_master_id) AS cnt
            FROM schedule_logs
            WHERE client_id IN (SELECT id FROM clients WHERE agency_id = ${agencyId})
              AND EXTRACT(year FROM schedule_month) = EXTRACT(year FROM NOW())
          `,
          prisma.$queryRaw`
            SELECT COALESCE(SUM(invoice_value), 0) AS total
            FROM schedule_logs
            WHERE client_id IN (SELECT id FROM clients WHERE agency_id = ${agencyId})
              AND EXTRACT(year FROM schedule_month) = EXTRACT(year FROM NOW()) - 1
              AND EXTRACT(month FROM schedule_month) <= EXTRACT(month FROM NOW())
          `,
          prisma.$queryRaw`
            SELECT DATE_TRUNC('month', schedule_month)    AS month,
                   COALESCE(SUM(invoice_value), 0)        AS invoice_value,
                   COALESCE(SUM(schedule_value), 0)       AS schedule_value
            FROM schedule_logs
            WHERE client_id IN (SELECT id FROM clients WHERE agency_id = ${agencyId})
              AND schedule_month >= NOW() - INTERVAL '12 months'
            GROUP BY DATE_TRUNC('month', schedule_month)
            ORDER BY month ASC
          `,
        ]);

      const ytdBillings = Number(ytdRows[0]?.total ?? 0);
      const lastYearBillings = Number(lastYearRows[0]?.total ?? 0);
      const ytdGrowthPct = lastYearBillings > 0
        ? Number(((ytdBillings - lastYearBillings) / lastYearBillings * 100).toFixed(2))
        : null;

      return {
        agencyId,
        agencyName: agency.name,
        ytdBillings,
        activeClients: Number(activeClientsRows[0]?.cnt ?? 0),
        activeChannels: Number(activeChannelsRows[0]?.cnt ?? 0),
        ytdGrowthPct,
        monthly: monthlyRows.map(r => ({
          month: toYearMonth(r.month),
          invoiceValue: Number(r.invoice_value),
          scheduleValue: Number(r.schedule_value),
        })),
      };
    }));

    return res.json(result);
  } catch (error) {
    console.error('getAgencyComparison error:', error);
    return res.status(500).json({ error: 'Failed to get agency comparison' });
  }
}

/**
 * GET /analytics/dashboard/top-clients
 * Access: SUPER_ADMIN, MANAGER
 */
export async function getTopClients(req, res) {
  try {
    let agencyFilter = Prisma.sql``;
    if (req.user.role === 'MANAGER') {
      agencyFilter = Prisma.sql`AND c.agency_id IN (
        SELECT agency_id FROM user_agency_access WHERE user_id = ${req.user.id}
      )`;
    }

    const rows = await prisma.$queryRaw`
      SELECT sl.client_id                               AS "clientId",
             c.name                                     AS "clientName",
             c.agency_id                                AS "agencyId",
             a.name                                     AS "agencyName",
             COALESCE(SUM(sl.invoice_value), 0)         AS "ytdBilling",
             SUM(CASE WHEN DATE_TRUNC('month', sl.schedule_month) = DATE_TRUNC('month', NOW())
                      THEN COALESCE(sl.invoice_value, 0) ELSE 0 END) AS "currentMonth",
             SUM(CASE WHEN DATE_TRUNC('month', sl.schedule_month) = DATE_TRUNC('month', NOW() - INTERVAL '1 month')
                      THEN COALESCE(sl.invoice_value, 0) ELSE 0 END) AS "prevMonth"
      FROM schedule_logs sl
      JOIN clients c ON c.id = sl.client_id
      JOIN agencies a ON a.id = c.agency_id
      WHERE EXTRACT(year FROM sl.schedule_month) = EXTRACT(year FROM NOW())
        ${agencyFilter}
      GROUP BY sl.client_id, c.name, c.agency_id, a.name
      ORDER BY "ytdBilling" DESC NULLS LAST
      LIMIT 10
    `;

    const result = rows.map((r, idx) => {
      const curr = Number(r.currentMonth);
      const prev = Number(r.prevMonth);
      let momTrend = null;
      let momDirection = 'same';
      if (prev > 0) {
        momTrend = Number(((curr - prev) / prev * 100).toFixed(2));
        momDirection = momTrend > 0 ? 'up' : momTrend < 0 ? 'down' : 'same';
      }
      return {
        rank: idx + 1,
        clientId: Number(r.clientId),
        clientName: r.clientName,
        agencyId: Number(r.agencyId),
        agencyName: r.agencyName,
        ytdBilling: Number(r.ytdBilling),
        momTrend,
        momDirection,
      };
    });

    return res.json(result);
  } catch (error) {
    console.error('getTopClients error:', error);
    return res.status(500).json({ error: 'Failed to get top clients' });
  }
}

/**
 * GET /analytics/dashboard/top-channels
 * Access: SUPER_ADMIN, MANAGER
 */
export async function getTopChannels(req, res) {
  try {
    let agencyFilter = Prisma.sql``;
    if (req.user.role === 'MANAGER') {
      agencyFilter = Prisma.sql`AND sl.client_id IN (
        SELECT id FROM clients WHERE agency_id IN (
          SELECT agency_id FROM user_agency_access WHERE user_id = ${req.user.id}
        )
      )`;
    }

    const rows = await prisma.$queryRaw`
      SELECT sl.channel_master_id                              AS "channelMasterId",
             cm.name                                          AS "channelName",
             cm.medium,
             COALESCE(SUM(sl.invoice_value), 0)               AS "ytdSpend",
             COUNT(DISTINCT sl.client_id)                     AS "clientCount"
      FROM schedule_logs sl
      JOIN channel_masters cm ON cm.id = sl.channel_master_id
      WHERE EXTRACT(year FROM sl.schedule_month) = EXTRACT(year FROM NOW())
        ${agencyFilter}
      GROUP BY sl.channel_master_id, cm.name, cm.medium
      ORDER BY "ytdSpend" DESC NULLS LAST
      LIMIT 10
    `;

    // Get last-year spend for YoY
    const result = await Promise.all(rows.map(async (r, idx) => {
      const cmId = Number(r.channelMasterId);
      const lastYearRows = await prisma.$queryRaw`
        SELECT COALESCE(SUM(invoice_value), 0) AS total
        FROM schedule_logs
        WHERE channel_master_id = ${cmId}
          AND EXTRACT(year FROM schedule_month) = EXTRACT(year FROM NOW()) - 1
      `;
      const ytdSpend = Number(r.ytdSpend);
      const lastYear = Number(lastYearRows[0]?.total ?? 0);
      const yoyChange = lastYear > 0
        ? Number(((ytdSpend - lastYear) / lastYear * 100).toFixed(2))
        : null;
      return {
        rank: idx + 1,
        channelMasterId: cmId,
        channelName: r.channelName,
        medium: r.medium,
        ytdSpend,
        clientCount: Number(r.clientCount),
        yoyChange,
      };
    }));

    return res.json(result);
  } catch (error) {
    console.error('getTopChannels error:', error);
    return res.status(500).json({ error: 'Failed to get top channels' });
  }
}

/**
 * GET /analytics/dashboard/medium-split
 * Access: SUPER_ADMIN, MANAGER
 * Query: ?agencyId=
 */
export async function getMediumSplit(req, res) {
  try {
    const { agencyId } = req.query;
    const agencyFilter = buildAgencyFilter(req.user, agencyId);

    const [currentMonthRows, ytdRows, lastYearYtdRows] = await Promise.all([
      prisma.$queryRaw`
        SELECT cm.medium,
               COALESCE(SUM(sl.invoice_value), 0) AS value
        FROM schedule_logs sl
        JOIN clients c ON c.id = sl.client_id
        JOIN channel_masters cm ON cm.id = sl.channel_master_id
        WHERE DATE_TRUNC('month', sl.schedule_month) = DATE_TRUNC('month', NOW())
          ${agencyFilter}
        GROUP BY cm.medium
      `,
      prisma.$queryRaw`
        SELECT cm.medium,
               COALESCE(SUM(sl.invoice_value), 0) AS value
        FROM schedule_logs sl
        JOIN clients c ON c.id = sl.client_id
        JOIN channel_masters cm ON cm.id = sl.channel_master_id
        WHERE EXTRACT(year FROM sl.schedule_month) = EXTRACT(year FROM NOW())
          ${agencyFilter}
        GROUP BY cm.medium
      `,
      prisma.$queryRaw`
        SELECT cm.medium,
               COALESCE(SUM(sl.invoice_value), 0) AS value
        FROM schedule_logs sl
        JOIN clients c ON c.id = sl.client_id
        JOIN channel_masters cm ON cm.id = sl.channel_master_id
        WHERE EXTRACT(year FROM sl.schedule_month) = EXTRACT(year FROM NOW()) - 1
          AND EXTRACT(month FROM sl.schedule_month) <= EXTRACT(month FROM NOW())
          ${agencyFilter}
        GROUP BY cm.medium
      `,
    ]);

    function toSplit(rows) {
      const total = rows.reduce((s, r) => s + Number(r.value), 0);
      return rows.map(r => ({
        medium: r.medium,
        value: Number(r.value),
        pct: total > 0 ? Number(((Number(r.value) / total) * 100).toFixed(2)) : 0,
      }));
    }

    return res.json({
      currentMonth: toSplit(currentMonthRows),
      ytd: toSplit(ytdRows),
      lastYearYtd: toSplit(lastYearYtdRows),
    });
  } catch (error) {
    console.error('getMediumSplit error:', error);
    return res.status(500).json({ error: 'Failed to get medium split' });
  }
}

/**
 * GET /analytics/dashboard/monthly-trend
 * Access: SUPER_ADMIN, MANAGER
 */
export async function getMonthlyTrend(req, res) {
  try {
    let agencyFilter = Prisma.sql``;
    if (req.user.role === 'MANAGER') {
      agencyFilter = Prisma.sql`AND c.agency_id IN (
        SELECT agency_id FROM user_agency_access WHERE user_id = ${req.user.id}
      )`;
    }

    const [combinedRows, agencyRows, agencyList] = await Promise.all([
      prisma.$queryRaw`
        SELECT DATE_TRUNC('month', sl.schedule_month)   AS month,
               COALESCE(SUM(sl.invoice_value), 0)       AS invoice_value
        FROM schedule_logs sl
        JOIN clients c ON c.id = sl.client_id
        WHERE sl.schedule_month >= NOW() - INTERVAL '24 months'
          ${agencyFilter}
        GROUP BY DATE_TRUNC('month', sl.schedule_month)
        ORDER BY month ASC
      `,
      prisma.$queryRaw`
        SELECT c.agency_id                                  AS "agencyId",
               DATE_TRUNC('month', sl.schedule_month)       AS month,
               COALESCE(SUM(sl.invoice_value), 0)           AS invoice_value
        FROM schedule_logs sl
        JOIN clients c ON c.id = sl.client_id
        WHERE sl.schedule_month >= NOW() - INTERVAL '24 months'
          ${agencyFilter}
        GROUP BY c.agency_id, DATE_TRUNC('month', sl.schedule_month)
        ORDER BY "agencyId", month ASC
      `,
      prisma.$queryRaw`
        SELECT DISTINCT a.id, a.name
        FROM agencies a
        JOIN clients c ON c.agency_id = a.id
        JOIN schedule_logs sl ON sl.client_id = c.id
        WHERE sl.schedule_month >= NOW() - INTERVAL '24 months'
          ${agencyFilter}
        ORDER BY a.name
      `,
    ]);

    // Group agency monthly data
    const agencyMap = {};
    for (const r of agencyRows) {
      const id = Number(r.agencyId);
      if (!agencyMap[id]) agencyMap[id] = [];
      agencyMap[id].push({ month: toYearMonth(r.month), invoiceValue: Number(r.invoice_value) });
    }

    const byAgency = agencyList.map(a => ({
      agencyId: Number(a.id),
      agencyName: a.name,
      data: agencyMap[Number(a.id)] ?? [],
    }));

    return res.json({
      combined: combinedRows.map(r => ({
        month: toYearMonth(r.month),
        invoiceValue: Number(r.invoice_value),
      })),
      byAgency,
    });
  } catch (error) {
    console.error('getMonthlyTrend error:', error);
    return res.status(500).json({ error: 'Failed to get monthly trend' });
  }
}

/**
 * GET /analytics/dashboard/activity-log
 * Access: SUPER_ADMIN only
 * Query: ?agencyId=&userId=&page=1&limit=50
 */
export async function getActivityLog(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page ?? '1'));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit ?? '50')));
    const { agencyId, userId } = req.query;

    let slAgencyFilter = Prisma.sql``;
    if (agencyId) slAgencyFilter = Prisma.sql`AND c.agency_id = ${parseInt(agencyId)}`;
    let slUserFilter = Prisma.sql``;
    if (userId) slUserFilter = Prisma.sql`AND sl.created_by = ${parseInt(userId)}`;

    let phAgencyFilter = Prisma.sql``;
    if (agencyId) phAgencyFilter = Prisma.sql`AND c.agency_id = ${parseInt(agencyId)}`;
    let phUserFilter = Prisma.sql``;
    if (userId) phUserFilter = Prisma.sql`AND ph.changed_by = ${parseInt(userId)}`;

    const halfLimit = Math.ceil(limit / 2);

    const [slRows, phRows] = await Promise.all([
      prisma.$queryRaw`
        SELECT
          sl.id,
          sl.created_by                 AS "userId",
          u.name                        AS "userName",
          a.name                        AS "agencyName",
          c.name                        AS "clientName",
          sl.created_at                 AS "timestamp",
          sl.schedule_month             AS "scheduleMonth",
          sl.schedule_value             AS "scheduleValue",
          cm.name                       AS "channelName"
        FROM schedule_logs sl
        JOIN clients c ON c.id = sl.client_id
        JOIN agencies a ON a.id = c.agency_id
        JOIN users u ON u.id = sl.created_by
        JOIN channel_masters cm ON cm.id = sl.channel_master_id
        WHERE 1=1
          ${slAgencyFilter}
          ${slUserFilter}
        ORDER BY sl.created_at DESC
        LIMIT ${halfLimit}
      `,
      prisma.$queryRaw`
        SELECT
          ph.id,
          ph.changed_by                 AS "userId",
          u.name                        AS "userName",
          a.name                        AS "agencyName",
          c.name                        AS "clientName",
          ph.changed_at                 AS "timestamp",
          p.name                        AS "propertyName",
          ph.change_note                AS "changeNote"
        FROM property_history ph
        JOIN properties p ON p.id = ph.property_id
        JOIN channels ch ON ch.id = p.channel_id
        JOIN clients c ON c.id = ch.client_id
        JOIN agencies a ON a.id = c.agency_id
        JOIN users u ON u.id = ph.changed_by
        WHERE 1=1
          ${phAgencyFilter}
          ${phUserFilter}
        ORDER BY ph.changed_at DESC
        LIMIT ${halfLimit}
      `,
    ]);

    const items = [
      ...slRows.map(r => ({
        type: 'schedule_log',
        userId: Number(r.userId),
        userName: r.userName,
        agencyName: r.agencyName,
        clientName: r.clientName,
        action: 'created',
        timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
        detail: `Schedule log for ${r.channelName} — ${toYearMonth(r.scheduleMonth)} — LKR ${Number(r.scheduleValue).toLocaleString()}`,
      })),
      ...phRows.map(r => ({
        type: 'property_edit',
        userId: Number(r.userId),
        userName: r.userName,
        agencyName: r.agencyName,
        clientName: r.clientName,
        action: 'edited',
        timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
        detail: `Property "${r.propertyName}" updated — ${r.changeNote || 'no note'}`,
      })),
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const total = items.length;
    const offset = (page - 1) * limit;
    const paged = items.slice(offset, offset + limit);

    return res.json({ items: paged, total, page });
  } catch (error) {
    console.error('getActivityLog error:', error);
    return res.status(500).json({ error: 'Failed to get activity log' });
  }
}
