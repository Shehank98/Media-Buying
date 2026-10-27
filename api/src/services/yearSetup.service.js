// New-year target setup. Every target is keyed by year, so a fresh year starts
// empty. This module powers Admin → Annual Targets → "Year setup": a checklist of
// what's still missing for a year, and a "copy from previous year" action (with
// an optional % uplift) per target type. All pure Prisma - no schema of its own.

import prisma from '../utils/prisma.js';
import { hubHeadsByAgency } from './hubRevenue.service.js';

// key -> { model delegate name, amount column, identity columns besides year }
export const TARGET_TYPES = [
  { key: 'companySpend', label: 'Company spend target', model: 'annualTarget', amount: 'totalTargetMillions', ids: [] },
  { key: 'companyRevenue', label: 'Company revenue target', model: 'yearRevenueTarget', amount: 'monthlyAmount', ids: [] },
  { key: 'agencySpend', label: 'Agency spend targets', model: 'agencyAnnualTarget', amount: 'totalTargetMillions', ids: ['agencyId'] },
  { key: 'agencyRevenue', label: 'Agency revenue targets', model: 'agencyRevenueTarget', amount: 'totalTargetAmount', ids: ['agencyId'] },
  { key: 'hubSpend', label: 'Hub head spend targets', model: 'hubSpendTarget', amount: 'amount', ids: ['headUserId', 'agencyId'] },
  { key: 'hubRevenue', label: 'Hub head revenue targets', model: 'hubRevenueTarget', amount: 'amount', ids: ['headUserId', 'agencyId'] },
  { key: 'clientSpend', label: 'Client spend targets', model: 'clientTarget', amount: 'amount', ids: ['clientId'] },
  { key: 'clientRevenue', label: 'Client revenue targets', model: 'clientRevenueTarget', amount: 'amount', ids: ['clientId'] },
];

const round2 = (n) => Number(n.toFixed(2));
const idKey = (row, ids) => (ids.length ? ids.map((f) => row[f]).join(':') : 'company');

// Who is EXPECTED to have a target: Map(idKey -> display label).
async function roster(type, year) {
  const m = new Map();
  if (type.key.startsWith('company')) { m.set('company', 'Company'); return m; }
  if (type.key.startsWith('agency')) {
    (await prisma.agency.findMany({ select: { id: true, name: true } })).forEach((a) => m.set(String(a.id), a.name));
    return m;
  }
  if (type.key.startsWith('client')) {
    (await prisma.client.findMany({ where: { isActive: true }, select: { id: true, name: true } })).forEach((c) => m.set(String(c.id), c.name));
    return m;
  }
  // hub: head × agency, keyed headUserId:agencyId (same order as TARGET_TYPES ids)
  const [{ byAgency }, agencies] = await Promise.all([
    hubHeadsByAgency(year, type.key === 'hubSpend' ? 'spend' : 'revenue'),
    prisma.agency.findMany({ select: { id: true, name: true } }),
  ]);
  const agencyName = new Map(agencies.map((a) => [a.id, a.name]));
  for (const [agencyId, heads] of byAgency) {
    for (const [headId, headName] of heads) m.set(`${headId}:${agencyId}`, `${headName} · ${agencyName.get(agencyId) || agencyId}`);
  }
  return m;
}

export async function getYearSetup(year) {
  const types = [];
  for (const t of TARGET_TYPES) {
    const [rows, prevCount, expected] = await Promise.all([
      prisma[t.model].findMany({ where: { year } }),
      prisma[t.model].count({ where: { year: year - 1 } }),
      roster(t, year),
    ]);
    const have = new Set(rows.filter((r) => Number(r[t.amount]) > 0).map((r) => idKey(r, t.ids)));
    const missing = [...expected.entries()].filter(([k]) => !have.has(k)).map(([, label]) => label).sort((a, b) => a.localeCompare(b));
    types.push({
      key: t.key,
      label: t.label,
      set: have.size,
      expected: expected.size,
      missingCount: missing.length,
      missing: missing.slice(0, 12),
      prevYearCount: prevCount,
    });
  }
  return { year, prevYear: year - 1, types };
}

// Copy `fromYear` targets of one type into `toYear`, scaled by upliftPct. Existing
// targets in the new year are kept unless overwrite is true.
export async function copyTargets({ type: key, fromYear, toYear, upliftPct = 0, overwrite = false, userId = null }) {
  const t = TARGET_TYPES.find((x) => x.key === key);
  if (!t) throw new Error('Unknown target type');
  if (!(fromYear >= 2000 && toYear >= 2000) || fromYear === toYear) throw new Error('Pick two different valid years');
  const factor = 1 + (Number(upliftPct) || 0) / 100;
  if (!(factor > 0)) throw new Error('Uplift must be greater than -100%');

  const source = (await prisma[t.model].findMany({ where: { year: fromYear } })).filter((r) => Number(r[t.amount]) > 0);
  let created = 0, updated = 0, skipped = 0;
  for (const r of source) {
    const identity = Object.fromEntries(t.ids.map((f) => [f, r[f]]));
    const amount = round2(Number(r[t.amount]) * factor);
    const existing = await prisma[t.model].findFirst({ where: { year: toYear, ...identity } });
    if (existing) {
      if (!overwrite && Number(existing[t.amount]) > 0) { skipped++; continue; }
      await prisma[t.model].update({ where: { id: existing.id }, data: { [t.amount]: amount, createdById: userId } });
      updated++;
    } else {
      await prisma[t.model].create({ data: { ...identity, year: toYear, [t.amount]: amount, createdById: userId } });
      created++;
    }
  }
  return { created, updated, skipped, sourceCount: source.length };
}
