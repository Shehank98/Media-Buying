// Forecast windows: which months a Hub head (GROUP_HEAD) may enter forecasts /
// budget for. The calendar rule (the month passed in as `def`, from
// nextMonth() in forecasting.controller.js) stays the default; an admin-created
// ForecastWindow overrides it for the heads it targets (see the schema comment).
// SUPER_ADMIN is never restricted. Deadlines are enforced lazily on every check,
// so a window "locks itself" the moment its deadline passes - no cron needed.

import prisma from '../utils/prisma.js';
import { sendEmail } from './email.service.js';

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (y, m) => `${MONTH_NAMES[m - 1]} ${y}`;
const sameMonth = (a, b) => a.year === b.year && a.month === b.month;

// What a window means for one user: null = it doesn't target them (calendar rule
// applies), else { open, status, deadline, expired }.
export function windowEffect(w, userId, now = new Date()) {
  if (!w) return null;
  if (w.headUserIds?.length && !w.headUserIds.includes(userId)) return null;
  const expired = w.status === 'OPEN' && !!w.deadline && now >= new Date(w.deadline);
  return { open: w.status === 'OPEN' && !expired, status: w.status, deadline: w.deadline || null, expired };
}

// Is (year, month) open for this user? `def` = the calendar default month.
export async function monthState(user, year, month, def) {
  if (user.role === 'SUPER_ADMIN') return { open: true, deadline: null, reason: null };
  const w = await prisma.forecastWindow.findUnique({ where: { year_month: { year, month } } });
  const eff = windowEffect(w, user.id);
  if (eff) {
    return {
      open: eff.open,
      deadline: eff.deadline,
      reason: eff.open ? null : eff.expired ? 'the deadline has passed' : 'it has been closed by an admin',
    };
  }
  const isDefault = sameMonth({ year, month }, def);
  return { open: isDefault, deadline: null, reason: isDefault ? null : 'it is not open for forecasting' };
}

// Every month this user may currently enter, oldest first. Includes the calendar
// default month unless a window closed it for them.
export async function openMonthsFor(user, def) {
  if (user.role === 'SUPER_ADMIN') return [{ ...def, deadline: null, isDefault: true }];
  const windows = await prisma.forecastWindow.findMany({ orderBy: [{ year: 'asc' }, { month: 'asc' }] });
  const out = new Map();
  const defState = await monthState(user, def.year, def.month, def);
  if (defState.open) out.set(`${def.year}-${def.month}`, { ...def, deadline: defState.deadline, isDefault: true });
  for (const w of windows) {
    const eff = windowEffect(w, user.id);
    if (eff?.open) out.set(`${w.year}-${w.month}`, { year: w.year, month: w.month, deadline: eff.deadline, isDefault: sameMonth(w, def) });
  }
  return [...out.values()].sort((a, b) => a.year - b.year || a.month - b.month);
}

// Month a Hub head's screens should show: the requested one if it is open for
// them, else the calendar default if open, else their first open month, else the
// default (shown read-only).
export async function pickMonthFor(user, requested, def) {
  const open = await openMonthsFor(user, def);
  if (requested && open.some((o) => sameMonth(o, requested))) return { year: requested.year, month: requested.month };
  if (open.some((o) => sameMonth(o, def))) return def;
  if (open.length) return { year: open[0].year, month: open[0].month };
  return def;
}

// Tell the targeted Hub heads a month has been opened: in-app notification +
// (when Apps Script is configured) an email using the generic announcement
// template, so no Apps Script redeploy is needed.
export async function notifyWindowOpened(w) {
  const heads = await prisma.user.findMany({
    where: { role: 'GROUP_HEAD', ...(w.headUserIds?.length ? { id: { in: w.headUserIds } } : {}) },
    select: { id: true, name: true, email: true },
  });
  const label = monthLabel(w.year, w.month);
  const until = w.deadline
    ? ` Please submit before ${new Date(w.deadline).toLocaleString('en-GB', { timeZone: process.env.FORECAST_EMAIL_TZ || 'Asia/Colombo', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.`
    : '';
  const title = `Forecasting open: ${label}`;
  const message = `The ${label} forecast is now open for entry.${until}${w.note ? ` ${w.note}` : ''}`;
  await prisma.notification.createMany({
    data: heads.map((h) => ({ userId: h.id, type: 'FORECAST_OPEN', title, message, month: `${w.year}-${String(w.month).padStart(2, '0')}`, link: '/forecasting' })),
  });
  let emailed = 0;
  const failed = [];
  if (process.env.GOOGLE_SCRIPT_URL) {
    const base = (process.env.FRONTEND_URL || 'https://media-buying-production.up.railway.app').split(',')[0].trim().replace(/\/+$/, '');
    for (const h of heads) {
      if (!h.email) continue;
      try {
        await sendEmail({ type: 'announcement', to: h.email, name: h.name, title, message, link: `${base}/forecasting` });
        emailed++;
      } catch (err) {
        failed.push(h.email);
        console.error(`[forecast-window] email to ${h.email} failed:`, err.message);
      }
    }
  }
  return { notified: heads.length, emailed, failed };
}
