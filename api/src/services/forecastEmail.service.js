// ─── Forecasting reminder emails ─────────────────────────────────────────────
// Two scheduled emails to Hub heads (GROUP_HEAD users) about the month they are
// forecasting, both CC'd to the finance/admin recipients:
//
//   1. "Forecast open" - on the 20th, when the forecasting window rolls over to
//      the next month (see nextMonth() in forecasting.controller.js). Every Hub
//      head who has roster clients gets a link to the Forecasting page.
//   2. "Forecast reminder" - on the 1st, for the month that is STILL open (on
//      Oct 1st the open month is October, not November). By default only Hub
//      heads who have entered nothing for that month are reminded; the email
//      lists their pending clients.
//
// Each email is paired with an in-app notification. Reliability:
//   - "today" is read in Asia/Colombo (not the server's UTC clock), so the
//     forecast month is the one the team sees.
//   - Instead of a one-shot cron on a single day (missed entirely if the server
//     is restarting/redeploying at that minute), a daily check runs at 09:00
//     and on startup, and sends each email once per month inside a short
//     catch-up window. "Already sent" is recorded as a *_RUN notification to
//     the SUPER_ADMINs (which also tells them the reminder went out).
//
// Admins can also send the reminder manually for any month (Admin → Notify).
// Everything is best-effort per recipient and a no-op unless GOOGLE_SCRIPT_URL
// is configured.

import cron from 'node-cron';
import prisma from '../utils/prisma.js';
import { getAccessibleClientIds } from '../middleware/access.js';
import { GROUP_HEAD_CLIENT_OR } from '../controllers/forecasting.controller.js';
import { sendEmail } from './email.service.js';

const TZ = process.env.FORECAST_EMAIL_TZ || 'Asia/Colombo';
// Day the forecasting window rolls over to next month (mirrors nextMonth()).
const ROLLOVER_DAY = 20;
const REMINDER_DAY = Math.min(Math.max(parseInt(process.env.FORECAST_REMINDER_DAY, 10) || 1, 1), ROLLOVER_DAY - 1);
const SEND_HOUR = Math.min(Math.max(parseInt(process.env.FORECAST_EMAIL_HOUR, 10) || 9, 0), 23);
// How many days after the due day a missed send is still caught up.
const CATCH_UP_DAYS = 4;

// Today's date parts in the forecasting timezone.
function todayParts(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23',
    }).formatToParts(now).map(p => [p.type, p.value]),
  );
  return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour };
}

// The month Hub heads are forecasting on a given day: the current calendar
// month through the 19th, next month from the 20th onward.
export function forecastMonthFor({ year, month, day }) {
  if (day >= ROLLOVER_DAY) {
    return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  }
  return { year, month };
}

export function currentForecastMonth() {
  return forecastMonthFor(todayParts());
}

function monthLabel(year, month) {
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function resolveMonth(opts = {}) {
  const y = parseInt(opts.year, 10);
  const m = parseInt(opts.month, 10);
  if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12) return { year: y, month: m };
  return currentForecastMonth();
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

// Every active Hub head with their roster clients (active clients linked to
// them through any admin assignment path - see GROUP_HEAD_CLIENT_OR).
async function hubHeadsWithRoster() {
  const heads = await prisma.user.findMany({
    where: { role: 'GROUP_HEAD' },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });
  const result = [];
  for (const head of heads) {
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

// Per Hub head: which roster clients have / haven't been forecast for the month.
async function forecastStatusByHead(year, month) {
  const heads = await hubHeadsWithRoster();
  const allIds = [...new Set(heads.flatMap(h => h.clients.map(c => c.id)))];
  const submitted = allIds.length
    ? await prisma.monthlyForecast.groupBy({ by: ['clientId'], where: { year, month, clientId: { in: allIds } } })
    : [];
  const submittedIds = new Set(submitted.map(s => s.clientId));
  return heads.map(h => {
    const pending = h.clients.filter(c => !submittedIds.has(c.id));
    return {
      ...h,
      pending,
      submittedCount: h.clients.length - pending.length,
    };
  });
}

// Record a run for the SUPER_ADMINs: tells them it went out and marks the month
// as done so the daily catch-up check doesn't send it twice.
async function logRun(type, key, title, message) {
  const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: { id: true } });
  if (!admins.length) return;
  await prisma.notification.createMany({
    data: admins.map(a => ({ userId: a.id, type, title, message, month: key, link: '/forecasting' })),
  });
}

async function alreadyRan(type, key) {
  return !!(await prisma.notification.findFirst({ where: { type, month: key }, select: { id: true } }));
}

// 20th: invite every Hub head with roster clients to enter the forecast.
export async function sendForecastOpenEmails(opts = {}) {
  const { year, month } = resolveMonth(opts);
  const label = monthLabel(year, month);
  const key = monthKey(year, month);
  const cc = ccList();
  const link = forecastingUrl();
  const heads = await hubHeadsWithRoster();
  const emailOn = !!process.env.GOOGLE_SCRIPT_URL;

  await prisma.notification.createMany({
    data: heads.map(h => ({
      userId: h.id,
      type: 'FORECAST_OPEN',
      title: `Forecasting open: ${label}`,
      message: `Please enter the ${label} forecast for your ${h.clients.length} account${h.clients.length === 1 ? '' : 's'}. Finalise before the ${ROLLOVER_DAY}th.`,
      month: key,
      link: '/forecasting',
    })),
  });

  let sent = 0;
  const failed = [];
  if (emailOn) {
    for (const head of heads) {
      if (!head.email) continue;
      try {
        await sendEmail({
          type: 'forecast-open',
          to: head.email,
          cc,
          name: head.name,
          monthLabel: label,
          forecastMonth: label,
          clientCount: head.clients.length,
          deadlineDay: ROLLOVER_DAY,
          loginUrl: link,
        });
        sent++;
      } catch (err) {
        failed.push(head.email);
        console.error(`[forecast-email] open email to ${head.email} failed:`, err.message);
      }
    }
  }
  await logRun('FORECAST_OPEN_RUN', key, `Forecast-open sent: ${label}`,
    `${heads.length} Hub head(s) notified in-app, ${sent} by email${failed.length ? ` (${failed.length} email failure${failed.length === 1 ? '' : 's'})` : ''}.`);
  console.log(`[forecast-email] forecast-open for ${label}: ${heads.length} notified, ${sent} emailed, ${failed.length} failed`);
  return { month: label, forecastMonth: key, notified: heads.length, sent, failed, emailEnabled: emailOn };
}

// Remind Hub heads about the forecast month that is still open.
//   mode 'empty'   (default, used by the auto run) - only heads who have
//                   entered nothing for the month.
//   mode 'pending' - every head with at least one pending client.
export async function sendForecastReminderEmails(opts = {}) {
  const { year, month } = resolveMonth(opts);
  const mode = opts.mode === 'pending' ? 'pending' : 'empty';
  const label = monthLabel(year, month);
  const key = monthKey(year, month);
  const cc = ccList();
  const link = forecastingUrl();
  const emailOn = !!process.env.GOOGLE_SCRIPT_URL;

  const status = await forecastStatusByHead(year, month);
  const targets = status.filter(h => h.pending.length > 0 && (mode === 'pending' || h.submittedCount === 0));

  if (targets.length) {
    await prisma.notification.createMany({
      data: targets.map(h => ({
        userId: h.id,
        type: 'FORECAST_REMINDER',
        title: `Forecast reminder: ${label}`,
        message: `${h.pending.length} of ${h.clients.length} account${h.clients.length === 1 ? '' : 's'} still need a ${label} forecast.`,
        month: key,
        link: '/forecasting',
      })),
    });
  }

  let sent = 0;
  const failed = [];
  if (emailOn) {
    for (const head of targets) {
      if (!head.email) continue;
      try {
        await sendEmail({
          type: 'forecast-reminder',
          to: head.email,
          cc,
          name: head.name,
          monthLabel: label,
          forecastMonth: label,
          pendingCount: head.pending.length,
          totalCount: head.clients.length,
          pendingClients: head.pending.map(c => c.name),
          deadlineDay: ROLLOVER_DAY,
          loginUrl: link,
        });
        sent++;
      } catch (err) {
        failed.push(head.email);
        console.error(`[forecast-email] reminder email to ${head.email} failed:`, err.message);
      }
    }
  }

  const who = mode === 'pending' ? 'with pending accounts' : 'who had submitted nothing';
  await logRun('FORECAST_REMINDER_RUN', key, `Forecast reminder sent: ${label}`,
    `${targets.length} Hub head(s) ${who} reminded in-app, ${sent} by email${failed.length ? ` (${failed.length} email failure${failed.length === 1 ? '' : 's'})` : ''}.`);
  console.log(`[forecast-email] forecast-reminder for ${label} (${mode}): ${targets.length} reminded, ${sent} emailed, ${failed.length} failed`);
  return {
    month: label,
    forecastMonth: key,
    mode,
    reminded: targets.length,
    sent,
    failed,
    emailEnabled: emailOn,
    recipients: targets.map(h => ({ id: h.id, name: h.name, email: h.email, pending: h.pending.length, total: h.clients.length })),
  };
}

// For the Admin → Notify card: who would be reminded for a month.
export async function previewForecastReminder(opts = {}) {
  const { year, month } = resolveMonth(opts);
  const key = monthKey(year, month);
  const status = await forecastStatusByHead(year, month);
  const lastRun = await prisma.notification.findFirst({
    where: { type: 'FORECAST_REMINDER_RUN', month: key },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, message: true },
  });
  const today = currentForecastMonth();
  return {
    year, month, forecastMonth: key, monthLabel: monthLabel(year, month),
    currentForecastMonth: monthKey(today.year, today.month),
    reminderDay: REMINDER_DAY,
    rolloverDay: ROLLOVER_DAY,
    emailEnabled: !!process.env.GOOGLE_SCRIPT_URL,
    lastRun,
    heads: status.map(h => ({
      id: h.id, name: h.name, email: h.email,
      total: h.clients.length, submitted: h.submittedCount, pending: h.pending.length,
      pendingClients: h.pending.map(c => c.name),
    })),
  };
}

// Daily check: send whichever email is due this month and hasn't gone out yet.
let running = false;
export async function runDueForecastEmails(now = new Date()) {
  if (running) return;
  running = true;
  try {
    const t = todayParts(now);
    if (t.hour < SEND_HOUR) return;

    // Reminder: from REMINDER_DAY for a few days, for the month still open.
    if (t.day >= REMINDER_DAY && t.day <= REMINDER_DAY + CATCH_UP_DAYS) {
      const fm = forecastMonthFor(t);
      if (!(await alreadyRan('FORECAST_REMINDER_RUN', monthKey(fm.year, fm.month)))) {
        await sendForecastReminderEmails({ ...fm, mode: 'empty' });
      }
    }
    // Open: from the rollover day for a few days, for next month.
    if (t.day >= ROLLOVER_DAY && t.day <= ROLLOVER_DAY + CATCH_UP_DAYS) {
      const fm = forecastMonthFor(t);
      if (!(await alreadyRan('FORECAST_OPEN_RUN', monthKey(fm.year, fm.month)))) {
        await sendForecastOpenEmails(fm);
      }
    }
  } catch (err) {
    console.error('[forecast-email] scheduled run failed:', err.message);
  } finally {
    running = false;
  }
}

// Daily check at SEND_HOUR + once shortly after startup (catches a run missed
// while the server was down). No-op unless GOOGLE_SCRIPT_URL is configured.
export function startForecastEmailScheduler() {
  if (!process.env.GOOGLE_SCRIPT_URL) {
    console.log('[forecast-email] disabled - set GOOGLE_SCRIPT_URL to enable the monthly forecast open/reminder emails');
    return;
  }
  const expr = `0 ${SEND_HOUR} * * *`;
  cron.schedule(expr, () => { runDueForecastEmails(); }, { timezone: TZ });
  setTimeout(() => { runDueForecastEmails(); }, 60 * 1000);
  console.log(`[forecast-email] daily check at ${String(SEND_HOUR).padStart(2, '0')}:00 ${TZ} - reminder on day ${REMINDER_DAY}, open on day ${ROLLOVER_DAY} (+${CATCH_UP_DAYS}d catch-up)`);
}
