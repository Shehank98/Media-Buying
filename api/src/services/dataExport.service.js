// ─── Daily per-tab Excel export to Google Drive ───────────────────────────────
// Exports each revenue / master-data / targets "tab" as its OWN dated .xlsx file
// into Google Drive, organised as:
//
//   <backup top folder>/Data Exports/<Dataset>/<Dataset>_<YYYY-MM-DD>.xlsx
//
// Runs daily (node-cron, default 02:00 Asia/Colombo) and keeps only the newest
// EXPORT_RETENTION (default 10) files per dataset folder, pruning older ones.
// Reuses the Google Drive auth + folder helpers from backup.service.js, so it
// needs no extra configuration beyond the existing backup Drive setup.
//
// Optional env:
//   EXPORT_CRON       cron expression (default "0 2 * * *" = 02:00 daily)
//   EXPORT_RETENTION  files to keep per dataset folder (default 10)
//   EXPORT_TZ         timezone for the schedule (default "Asia/Colombo")

import cron from 'node-cron';
import ExcelJS from 'exceljs';
import prisma from '../utils/prisma.js';
import { getDriveAccessToken, ensureFolder, isBackupConfigured } from './backup.service.js';
import { atomProfit, round2 } from './profit.service.js';

const ROOT_FOLDER = 'Data Exports';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let lastRun = null; // { status, at, datasets:[{name,fileName,rows,pruned,error}], durationMs, trigger }
let running = false;

const num = (v) => (v == null ? null : Number(v));
const monthName = (m) => (m >= 1 && m <= 12 ? MONTHS[m - 1] : String(m));
const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

export function getDataExportStatus() {
  return {
    configured: isBackupConfigured(),
    running,
    schedule: process.env.EXPORT_CRON || '0 2 * * *',
    retention: parseInt(process.env.EXPORT_RETENTION || '10', 10),
    lastRun,
  };
}

// Build a single-sheet workbook from column defs + row objects. Returns a Buffer.
async function workbook(sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Ogilvy Orbit';
  wb.created = new Date();
  for (const { name, columns, rows } of sheets) {
    const ws = wb.addWorksheet(String(name).slice(0, 31));
    ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 18 }));
    ws.getRow(1).font = { bold: true };
    ws.addRows(rows || []);
  }
  return wb.xlsx.writeBuffer();
}

// ── Drive helpers ──

// Top backup folder (same as backup.service): configured id, else app-owned.
async function topFolder(token) {
  return process.env.GDRIVE_BACKUP_FOLDER_ID || ensureFolder('Orbit Backups', null, token);
}

// Multipart upload of an xlsx buffer into a Drive folder.
async function uploadXlsx(buffer, fileName, folderId, token) {
  const metadata = { name: fileName, parents: [folderId] };
  const boundary = 'orbit_' + Date.now().toString(36);
  const pre = Buffer.from(
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + '\r\n' +
    `--${boundary}\r\n` +
    `Content-Type: ${XLSX_MIME}\r\n\r\n`,
    'utf8',
  );
  const post = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const payload = Buffer.concat([pre, Buffer.from(buffer), post]);
  const resp = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,size',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(payload.length),
      },
      body: payload,
    },
  );
  if (!resp.ok) throw new Error(`Drive upload failed (${resp.status}): ${(await resp.text()).slice(0, 300)}`);
  return resp.json();
}

// Keep only the newest `retention` xlsx files in a folder; delete the rest.
async function pruneFolder(folderId, token, retention) {
  if (!(retention > 0)) return 0;
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&pageSize=1000&fields=files(id,createdTime)&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) return 0;
  const { files = [] } = await resp.json();
  let deleted = 0;
  for (const f of files.slice(retention)) {
    const d = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?supportsAllDrives=true`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    if (d.ok || d.status === 204) deleted += 1;
  }
  return deleted;
}

// ── Dataset builders (each returns { sheets, rowCount }) ──

async function buildRevenueByBilling() {
  const rows = await prisma.clientRevenue.findMany({
    include: { client: { select: { name: true, agency: { select: { name: true } } } }, verifier: { select: { name: true } } },
    orderBy: [{ year: 'desc' }, { month: 'asc' }],
  });
  const detail = rows.map((r) => ({
    year: r.year, month: monthName(r.month), client: r.client?.name || '', agency: r.client?.agency?.name || '',
    revenue: num(r.amount), revenueFromFinance: num(r.revenueFromFinance), verifyStatus: r.verifyStatus,
    verifiedAmount: num(r.verifiedAmount), verifyReason: r.verifyReason || '', verifiedBy: r.verifier?.name || '',
  }));
  const totalsMap = new Map();
  for (const r of rows) { const k = ym(r.year, r.month); totalsMap.set(k, round2((totalsMap.get(k) || 0) + Number(r.amount || 0))); }
  const totals = [...totalsMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({ month: k, revenue: v }));
  return {
    rowCount: detail.length,
    sheets: [
      { name: 'By Client-Month', columns: [
        { header: 'Year', key: 'year', width: 8 }, { header: 'Month', key: 'month', width: 8 },
        { header: 'Client', key: 'client', width: 34 }, { header: 'Agency', key: 'agency', width: 18 },
        { header: 'Revenue (LKR)', key: 'revenue', width: 16 }, { header: 'Rev from Finance (LKR)', key: 'revenueFromFinance', width: 18 },
        { header: 'Verify Status', key: 'verifyStatus', width: 14 }, { header: 'Verified Amount', key: 'verifiedAmount', width: 16 },
        { header: 'Note', key: 'verifyReason', width: 30 }, { header: 'Verified By', key: 'verifiedBy', width: 18 },
      ], rows: detail },
      { name: 'Monthly Totals', columns: [
        { header: 'Month', key: 'month', width: 12 }, { header: 'Revenue (LKR)', key: 'revenue', width: 18 },
      ], rows: totals },
    ],
  };
}

async function buildRevenueBySchedule() {
  // Aggregate atoms straight from ScheduleLog (client, agency, schedule-month,
  // snapshotted commission), then compute revenue + agency-commission per atom.
  const rows = await prisma.$queryRaw`
    SELECT sl.client_id AS "clientId", sl.agency_id AS "agencyId", sl.schedule_month AS ym,
           sl.commission_type_at_entry AS ctype, sl.commission_rate_at_entry AS crate,
           SUM(sl.schedule_value) AS revenue
      FROM schedule_logs sl
     WHERE sl.is_deleted = false
     GROUP BY sl.client_id, sl.agency_id, sl.schedule_month, sl.commission_type_at_entry, sl.commission_rate_at_entry`;
  const [clients, agencies] = await Promise.all([
    prisma.client.findMany({ select: { id: true, name: true } }),
    prisma.agency.findMany({ select: { id: true, name: true } }),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const agencyName = new Map(agencies.map((a) => [a.id, a.name]));
  // Per (client, month) totals from the atoms.
  const byCM = new Map();
  for (const r of rows) {
    const revenue = Number(r.revenue) || 0;
    const commission = atomProfit({ ctype: r.ctype, crate: num(r.crate), revenue });
    const key = `${r.clientId}|${r.ym}`;
    const g = byCM.get(key) || { clientId: r.clientId, month: r.ym, revenue: 0, commission: 0 };
    g.revenue = round2(g.revenue + revenue);
    g.commission = round2(g.commission + commission);
    byCM.set(key, g);
  }
  const detail = [...byCM.values()]
    .sort((a, b) => a.month.localeCompare(b.month) || (clientName.get(a.clientId) || '').localeCompare(clientName.get(b.clientId) || ''))
    .map((g) => ({ month: g.month, client: clientName.get(g.clientId) || '', scheduleValue: g.revenue, agencyCommission: g.commission }));
  // Per-client year totals.
  const byClient = new Map();
  for (const g of byCM.values()) {
    const cid = g.clientId;
    const c = byClient.get(cid) || { client: clientName.get(cid) || '', scheduleValue: 0, agencyCommission: 0 };
    c.scheduleValue = round2(c.scheduleValue + g.revenue);
    c.agencyCommission = round2(c.agencyCommission + g.commission);
    byClient.set(cid, c);
  }
  const clientTotals = [...byClient.values()].sort((a, b) => b.scheduleValue - a.scheduleValue);
  return {
    rowCount: detail.length,
    sheets: [
      { name: 'By Client', columns: [
        { header: 'Client', key: 'client', width: 34 }, { header: 'Schedule Value (LKR)', key: 'scheduleValue', width: 20 },
        { header: 'Agency Commission (LKR)', key: 'agencyCommission', width: 22 },
      ], rows: clientTotals },
      { name: 'By Client-Month', columns: [
        { header: 'Month', key: 'month', width: 12 }, { header: 'Client', key: 'client', width: 34 },
        { header: 'Schedule Value (LKR)', key: 'scheduleValue', width: 20 }, { header: 'Agency Commission (LKR)', key: 'agencyCommission', width: 22 },
      ], rows: detail },
    ],
  };
}

async function buildAvr() {
  const rows = await prisma.aorRevenue.findMany({ orderBy: [{ year: 'desc' }, { month: 'asc' }, { createdAt: 'asc' }] });
  const detail = rows.map((r) => ({ year: r.year, month: monthName(r.month), channel: r.channel, amount: num(r.amount), reason: r.reason || '' }));
  return {
    rowCount: detail.length,
    sheets: [{ name: 'AVR', columns: [
      { header: 'Year', key: 'year', width: 8 }, { header: 'Month', key: 'month', width: 8 },
      { header: 'Channel', key: 'channel', width: 28 }, { header: 'Amount (LKR)', key: 'amount', width: 16 },
      { header: 'Reason', key: 'reason', width: 30 },
    ], rows: detail }],
  };
}

async function buildGroupRevenue() {
  const [heads, agencies] = await Promise.all([
    prisma.groupRevenue.findMany({ include: { head: { select: { name: true } } }, orderBy: [{ year: 'desc' }, { month: 'asc' }] }),
    prisma.agencyRevenue.findMany({ include: { agency: { select: { name: true } } }, orderBy: [{ year: 'desc' }, { month: 'asc' }] }),
  ]);
  const headRows = heads.map((r) => ({ year: r.year, month: monthName(r.month), head: r.head?.name || '', amount: num(r.amount) }));
  const agencyRows = agencies.map((r) => ({ year: r.year, month: monthName(r.month), agency: r.agency?.name || '', amount: num(r.amount) }));
  return {
    rowCount: headRows.length + agencyRows.length,
    sheets: [
      { name: 'By Hub Head', columns: [
        { header: 'Year', key: 'year', width: 8 }, { header: 'Month', key: 'month', width: 8 },
        { header: 'Hub Head', key: 'head', width: 26 }, { header: 'Revenue (LKR)', key: 'amount', width: 18 },
      ], rows: headRows },
      { name: 'By Agency', columns: [
        { header: 'Year', key: 'year', width: 8 }, { header: 'Month', key: 'month', width: 8 },
        { header: 'Agency', key: 'agency', width: 22 }, { header: 'Actual Billing (LKR)', key: 'amount', width: 18 },
      ], rows: agencyRows },
    ],
  };
}

async function buildAgencies() {
  const rows = await prisma.agency.findMany({ include: { _count: { select: { clients: true } } }, orderBy: { name: 'asc' } });
  const detail = rows.map((a) => ({ id: a.id, name: a.name, clients: a._count.clients, createdAt: a.createdAt?.toISOString().slice(0, 10) }));
  return {
    rowCount: detail.length,
    sheets: [{ name: 'Agencies', columns: [
      { header: 'ID', key: 'id', width: 8 }, { header: 'Agency', key: 'name', width: 28 },
      { header: 'Clients', key: 'clients', width: 10 }, { header: 'Created', key: 'createdAt', width: 14 },
    ], rows: detail }],
  };
}

async function buildClients() {
  const rows = await prisma.client.findMany({ include: { agency: { select: { name: true } } }, orderBy: [{ name: 'asc' }] });
  const detail = rows.map((c) => ({
    id: c.id, name: c.name, agency: c.agency?.name || '', active: c.isActive ? 'Yes' : 'No',
    commissionType: c.commissionType || '', commissionValue: num(c.commissionValue), aliases: (c.aliases || []).join(', '),
  }));
  return {
    rowCount: detail.length,
    sheets: [{ name: 'Clients', columns: [
      { header: 'ID', key: 'id', width: 8 }, { header: 'Client', key: 'name', width: 34 },
      { header: 'Agency', key: 'agency', width: 18 }, { header: 'Active', key: 'active', width: 8 },
      { header: 'Commission Type', key: 'commissionType', width: 16 }, { header: 'Commission Value', key: 'commissionValue', width: 16 },
      { header: 'Aliases', key: 'aliases', width: 40 },
    ], rows: detail }],
  };
}

async function buildChannels() {
  const rows = await prisma.channelMaster.findMany({
    include: { mediaGroup: { select: { name: true } }, _count: { select: { scheduleLogs: true } } },
    orderBy: [{ medium: 'asc' }, { name: 'asc' }],
  });
  const detail = rows.map((c) => ({
    id: c.id, name: c.name, medium: c.medium, mediaGroup: c.mediaGroup?.name || '',
    active: c.isActive ? 'Yes' : 'No', sortOrder: c.sortOrder ?? '', scheduleLogs: c._count.scheduleLogs, aliases: (c.aliases || []).join(', '),
  }));
  return {
    rowCount: detail.length,
    sheets: [{ name: 'Channels', columns: [
      { header: 'ID', key: 'id', width: 8 }, { header: 'Channel', key: 'name', width: 30 },
      { header: 'Medium', key: 'medium', width: 10 }, { header: 'Media Group', key: 'mediaGroup', width: 26 },
      { header: 'Active', key: 'active', width: 8 }, { header: 'Sort', key: 'sortOrder', width: 8 },
      { header: 'Schedule Logs', key: 'scheduleLogs', width: 14 }, { header: 'Aliases', key: 'aliases', width: 40 },
    ], rows: detail }],
  };
}

async function buildMediaGroups() {
  const rows = await prisma.mediaGroup.findMany({ include: { _count: { select: { channelMasters: true } } }, orderBy: { name: 'asc' } });
  const detail = rows.map((g) => ({ id: g.id, name: g.name, active: g.active ? 'Yes' : 'No', channels: g._count.channelMasters }));
  return {
    rowCount: detail.length,
    sheets: [{ name: 'Media Groups', columns: [
      { header: 'ID', key: 'id', width: 8 }, { header: 'Media Group', key: 'name', width: 34 },
      { header: 'Active', key: 'active', width: 8 }, { header: 'Channels', key: 'channels', width: 10 },
    ], rows: detail }],
  };
}

async function buildAnnualTargets() {
  const rows = await prisma.annualTarget.findMany({ orderBy: { year: 'desc' } });
  const detail = rows.map((t) => ({ year: t.year, targetMillions: num(t.totalTargetMillions), remoteMonth: t.remoteMonth ? monthName(t.remoteMonth) : 'Auto' }));
  return {
    rowCount: detail.length,
    sheets: [{ name: 'Annual Targets', columns: [
      { header: 'Year', key: 'year', width: 8 }, { header: 'Target (LKR millions)', key: 'targetMillions', width: 20 },
      { header: 'Pacing Month', key: 'remoteMonth', width: 14 },
    ], rows: detail }],
  };
}

async function buildAgencyTargets() {
  const rows = await prisma.agencyAnnualTarget.findMany({ include: { agency: { select: { name: true } } }, orderBy: [{ year: 'desc' }] });
  const detail = rows.map((t) => ({ year: t.year, agency: t.agency?.name || '', targetMillions: num(t.totalTargetMillions) }));
  return {
    rowCount: detail.length,
    sheets: [{ name: 'Agency Targets', columns: [
      { header: 'Year', key: 'year', width: 8 }, { header: 'Agency', key: 'agency', width: 24 },
      { header: 'Target (LKR millions)', key: 'targetMillions', width: 20 },
    ], rows: detail }],
  };
}

async function buildClientTargets() {
  const rows = await prisma.clientTarget.findMany({ include: { client: { select: { name: true, agency: { select: { name: true } } } } }, orderBy: [{ year: 'desc' }] });
  const detail = rows.map((t) => ({ year: t.year, client: t.client?.name || '', agency: t.client?.agency?.name || '', target: num(t.amount) }));
  return {
    rowCount: detail.length,
    sheets: [{ name: 'Client Targets', columns: [
      { header: 'Year', key: 'year', width: 8 }, { header: 'Client', key: 'client', width: 34 },
      { header: 'Agency', key: 'agency', width: 18 }, { header: 'Target (LKR)', key: 'target', width: 18 },
    ], rows: detail }],
  };
}

async function buildForecasts() {
  const [rows, agencies] = await Promise.all([
    prisma.monthlyForecast.findMany({
      include: { client: { select: { name: true } }, channelMaster: { select: { name: true, medium: true } } },
      orderBy: [{ year: 'desc' }, { month: 'asc' }],
    }),
    prisma.agency.findMany({ select: { id: true, name: true } }),
  ]);
  const agencyName = new Map(agencies.map((a) => [a.id, a.name]));
  const detail = rows.map((f) => ({
    year: f.year, month: monthName(f.month), agency: agencyName.get(f.agencyId) || '', client: f.client?.name || '',
    medium: f.channelMaster?.medium || '', channel: f.channelMaster?.name || '', amountMillions: num(f.amountMillions), notes: f.notes || '',
  }));
  return {
    rowCount: detail.length,
    sheets: [{ name: 'Monthly Forecasts', columns: [
      { header: 'Year', key: 'year', width: 8 }, { header: 'Month', key: 'month', width: 8 },
      { header: 'Agency', key: 'agency', width: 16 }, { header: 'Client', key: 'client', width: 30 },
      { header: 'Medium', key: 'medium', width: 10 }, { header: 'Channel', key: 'channel', width: 24 },
      { header: 'Amount (LKR millions)', key: 'amountMillions', width: 20 }, { header: 'Notes', key: 'notes', width: 30 },
    ], rows: detail }],
  };
}

async function buildCommitments() {
  const rows = await prisma.channelCommitment.findMany({ include: { channelMaster: { select: { name: true, medium: true } } }, orderBy: [{ id: 'asc' }] });
  const detail = rows.map((c) => ({
    channel: c.channelMaster?.name || '', medium: c.channelMaster?.medium || '', type: c.type,
    monthlyAmount: num(c.monthlyAmount), totalAmount: num(c.totalAmount),
    period: c.startYear ? `${ym(c.startYear, c.startMonth || 1)} → ${c.endYear ? ym(c.endYear, c.endMonth || 12) : '...'}` : (c.year ? String(c.year) : ''),
  }));
  return {
    rowCount: detail.length,
    sheets: [{ name: 'Channel Commitments', columns: [
      { header: 'Channel', key: 'channel', width: 28 }, { header: 'Medium', key: 'medium', width: 10 },
      { header: 'Type', key: 'type', width: 12 }, { header: 'Monthly (LKR)', key: 'monthlyAmount', width: 16 },
      { header: 'Total (LKR)', key: 'totalAmount', width: 16 }, { header: 'Period', key: 'period', width: 22 },
    ], rows: detail }],
  };
}

// Dataset registry: folder name (the "tab folder") + file slug + builder.
export const DATASETS = [
  { folder: 'Revenue - By Billing', slug: 'RevenueByBilling', build: buildRevenueByBilling },
  { folder: 'Revenue - By Schedule Value', slug: 'RevenueBySchedule', build: buildRevenueBySchedule },
  { folder: 'Revenue - AVR', slug: 'AVR', build: buildAvr },
  { folder: 'Revenue - Group Revenue', slug: 'GroupRevenue', build: buildGroupRevenue },
  { folder: 'Master - Agencies', slug: 'Agencies', build: buildAgencies },
  { folder: 'Master - Clients', slug: 'Clients', build: buildClients },
  { folder: 'Master - Channels', slug: 'Channels', build: buildChannels },
  { folder: 'Master - Media Groups', slug: 'MediaGroups', build: buildMediaGroups },
  { folder: 'Targets - Annual', slug: 'AnnualTargets', build: buildAnnualTargets },
  { folder: 'Targets - Agency', slug: 'AgencyTargets', build: buildAgencyTargets },
  { folder: 'Targets - Client', slug: 'ClientTargets', build: buildClientTargets },
  { folder: 'Forecasts - Monthly', slug: 'MonthlyForecasts', build: buildForecasts },
  { folder: 'Commitments - Channel', slug: 'ChannelCommitments', build: buildCommitments },
];

// Run one full export: build every dataset → upload → prune. Best-effort per
// dataset (one failure does not abort the rest). Returns the run summary.
export async function runDataExport({ trigger = 'manual' } = {}) {
  if (!isBackupConfigured()) {
    const err = 'Data export needs the Google Drive backup to be configured (GOOGLE_SERVICE_ACCOUNT_JSON + GDRIVE_BACKUP_FOLDER_ID, or OAuth creds).';
    lastRun = { status: 'failed', at: new Date().toISOString(), error: err, trigger };
    throw new Error(err);
  }
  if (running) throw new Error('A data export is already in progress');
  running = true;
  const startedAt = Date.now();
  const retention = parseInt(process.env.EXPORT_RETENTION || '10', 10);
  const dateStr = new Date().toISOString().slice(0, 10);
  const results = [];
  try {
    const token = await getDriveAccessToken();
    const top = await topFolder(token);
    const root = await ensureFolder(ROOT_FOLDER, top, token);
    for (const ds of DATASETS) {
      const entry = { name: ds.folder, fileName: `${ds.slug}_${dateStr}.xlsx` };
      try {
        const { sheets, rowCount } = await ds.build();
        const buf = await workbook(sheets);
        const folder = await ensureFolder(ds.folder, root, token);
        await uploadXlsx(buf, entry.fileName, folder, token);
        let pruned = 0;
        try { pruned = await pruneFolder(folder, token, retention); } catch { /* best-effort */ }
        entry.rows = rowCount; entry.pruned = pruned;
      } catch (err) {
        entry.error = err.message;
        console.error(`[data-export] ${ds.folder} failed:`, err.message);
      }
      results.push(entry);
    }
    const failed = results.filter((r) => r.error).length;
    lastRun = {
      status: failed === results.length ? 'failed' : (failed ? 'partial' : 'success'),
      at: new Date().toISOString(), datasets: results, durationMs: Date.now() - startedAt, trigger,
    };
    console.log(`[data-export] ${results.length - failed}/${results.length} datasets uploaded (${dateStr})`);
    return lastRun;
  } catch (err) {
    lastRun = { status: 'failed', at: new Date().toISOString(), datasets: results, error: err.message, durationMs: Date.now() - startedAt, trigger };
    console.error('[data-export] failed:', err.message);
    throw err;
  } finally {
    running = false;
  }
}

// Start the daily cron. No-op (with a log) when the Drive backup is unconfigured.
export function startDataExportScheduler() {
  const expr = process.env.EXPORT_CRON || '0 2 * * *';
  if (!isBackupConfigured()) {
    console.log('[data-export] disabled - configure the Google Drive backup to enable daily per-tab Excel exports');
    return;
  }
  if (!cron.validate(expr)) {
    console.error(`[data-export] invalid EXPORT_CRON "${expr}"; scheduler not started`);
    return;
  }
  cron.schedule(expr, () => { runDataExport({ trigger: 'schedule' }).catch(() => {}); }, { timezone: process.env.EXPORT_TZ || 'Asia/Colombo' });
  console.log(`[data-export] scheduled daily per-tab Excel export (cron "${expr}")`);
}
