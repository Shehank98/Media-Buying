// ─── Forecasting reminder emails ─────────────────────────────────────────────
// Two scheduled emails to Hub heads (GROUP_HEAD users) about the upcoming
// month's forecast, both CC'd to the finance/admin recipients:
//
//   1. "Forecast open" — on the 15th, when the forecasting window rolls over to
//      the next month (see nextMonth() in forecasting.controller.js). Every Hub
//      head who has roster clients gets a link to the Forecasting page to enter
//      the upcoming month's allocations.
//   2. "Forecast reminder" — on the 25th, only to Hub heads who still have one or
//      more roster clients with NO forecast submitted for the upcoming month.
//      The email lists the pending clients.
//
// Both are best-effort: a single recipient failure never aborts the batch, and
// the whole scheduler is a no-op (with a log line) unless GOOGLE_SCRIPT_URL is
// configured. Cron times/timezone/CC are env-overridable.

import cron from 'node-cron';
import prisma from '../utils/prisma.js';
import { getAccessibleClientIds } from '../middleware/access.js';
import { GROUP_HEAD_CLIENT_OR } from '../controllers/forecasting.controller.js';
import { sendEmail } from './email.service.js';

// The month Hub heads forecast: current calendar month through the 14th, then
// next month from the 15th onward. Mirrors nextMonth() in the controller (kept
// local so the two schedulers can't drift on import cycles).
function upcomingMonth() {
  const d = new Date();
  const rollOver = d.getDate() >= 15;
  d.setDate(1);
  if (rollOver) d.setMonth(d.getMonth() + 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function monthLabel(year, month) {
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// FRONTEND_URL may be a comma-separated CORS whitelist; use the first entry.
function forecastingUrl() {
  const base = (process.env.FRONTEND_URL || 'https://media-buying-production.up.railway.app')
    .split(',')[0].trim().replace(/\/+$/, '');
  return `${base}/forecasting`;
}

// Finance/admin addresses CC'd on both emails (override with FORECAST_EMAIL_CC,
// a comma-separated list).
function ccList() {
  const raw = process.env.FORECAST_EMAIL_CC;
  if (raw) return raw.split(',').map(s => s.trim()).filter(Boolean);
  return ['shehan.kavishka@ogilvy.com', 'chandra.kodituwakku@ogilvy.com'];
}

// Every active Hub head with the ids of their roster clients (active clients
// linked to them through any admin assignment path — see GROUP_HEAD_CLIENT_OR).
async function hubHeadsWithRoster() {
  const heads = await prisma.user.findMany({
    where: { role: 'GROUP_HEAD', isActive: true },
    select: { id: true, name: true, email: true },
  });
  const result = [];
  for (const head of heads) {
    if (!head.email) continue;
    const ids = await getAccessibleClientIds(head.id, 'GROUP_HEAD');
    if (!ids || !ids.length) continue;
    const clients = await prisma.client.findMany({
      where: { isActive: true, id: { in: ids }, OR: GROUP_HEAD_CLIENT_OR },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    if (clients.length) result.push({ ...head, clients });
  }
  return result;
}

// 15th: invite every Hub head with roster clients to enter next month's forecast.
export async function sendForecastOpenEmails() {
  if (!process.env.GOOGLE_SCRIPT_URL) {
    console.warn('[forecast-email] GOOGLE_SCRIPT_URL not set - skipping forecast-open emails');
    return { sent: 0 };
  }
  const { year, month } = upcomingMonth();
  const label = monthLabel(year, month);
  const cc = ccList();
  const link = forecastingUrl();
  const heads = await hubHeadsWithRoster();

  let sent = 0;
  for (const head of heads) {
    try {
      await sendEmail({
        type: 'forecast-open',
        to: head.email,
        cc,
        name: head.name,
        monthLabel: label,
        clientCount: head.clients.length,
        loginUrl: link,
      });
      sent++;
    } catch (err) {
      console.error(`[forecast-email] open email to ${head.email} failed:`, err.message);
    }
  }
  console.log(`[forecast-email] forecast-open sent to ${sent}/${heads.length} Hub head(s) for ${label}`);
  return { sent, total: heads.length, month: label };
}

// 25th: remind only Hub heads who still have pending (not-yet-forecast) clients
// for the upcoming month, listing those clients.
export async function sendForecastReminderEmails() {
  if (!process.env.GOOGLE_SCRIPT_URL) {
    console.warn('[forecast-email] GOOGLE_SCRIPT_URL not set - skipping forecast-reminder emails');
    return { sent: 0 };
  }
  const { year, month } = upcomingMonth();
  const label = monthLabel(year, month);
  const cc = ccList();
  const link = forecastingUrl();
  const heads = await hubHeadsWithRoster();

  let sent = 0;
  let eligible = 0;
  for (const head of heads) {
    const rosterIds = head.clients.map(c => c.id);
    const submitted = await prisma.monthlyForecast.groupBy({
      by: ['clientId'],
      where: { year, month, clientId: { in: rosterIds } },
    });
    const submittedIds = new Set(submitted.map(s => s.clientId));
    const pending = head.clients.filter(c => !submittedIds.has(c.id));
    if (!pending.length) continue; // all forecast → no reminder
    eligible++;
    try {
      await sendEmail({
        type: 'forecast-reminder',
        to: head.email,
        cc,
        name: head.name,
        monthLabel: label,
        pendingCount: pending.length,
        totalCount: head.clients.length,
        pendingClients: pending.map(c => c.name),
        loginUrl: link,
      });
      sent++;
    } catch (err) {
      console.error(`[forecast-email] reminder email to ${head.email} failed:`, err.message);
    }
  }
  console.log(`[forecast-email] forecast-reminder sent to ${sent}/${eligible} Hub head(s) with pending forecasts for ${label}`);
  return { sent, eligible, month: label };
}

// Start both crons. No-op (with a log) unless GOOGLE_SCRIPT_URL is configured.
export function startForecastEmailScheduler() {
  if (!process.env.GOOGLE_SCRIPT_URL) {
    console.log('[forecast-email] disabled - set GOOGLE_SCRIPT_URL to enable the monthly forecast open/reminder emails');
    return;
  }
  const tz = process.env.FORECAST_EMAIL_TZ || 'Asia/Colombo';
  const openExpr = process.env.FORECAST_OPEN_CRON || '0 9 15 * *';       // 15th, 09:00
  const remindExpr = process.env.FORECAST_REMINDER_CRON || '0 9 25 * *'; // 25th, 09:00

  for (const [expr, name, fn] of [
    [openExpr, 'forecast-open', sendForecastOpenEmails],
    [remindExpr, 'forecast-reminder', sendForecastReminderEmails],
  ]) {
    if (!cron.validate(expr)) {
      console.error(`[forecast-email] invalid cron "${expr}" for ${name}; not scheduled`);
      continue;
    }
    cron.schedule(expr, () => { fn().catch(e => console.error(`[forecast-email] ${name} run failed:`, e.message)); }, { timezone: tz });
    console.log(`[forecast-email] scheduled ${name} (cron "${expr}", ${tz})`);
  }
}
