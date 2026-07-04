import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, reconcile, atomProfit, blendedPct, round2 } from '../src/services/profit.service.js';

// Atomic rows mirror what the SQL in profit.controller.js emits: one row per
// (client, entry-month, commission type, snapshotted rate/fee).
const atoms = [
  { clientId: 1, agencyId: 10, ym: '2026-07', ctype: 'COMMISSION', rate: 4, revenue: 12301750 },
  { clientId: 2, agencyId: 10, ym: '2026-07', ctype: 'COMMISSION', rate: 10, revenue: 5000000 },
  { clientId: 3, agencyId: 20, ym: '2026-07', ctype: 'AOR', fee: 50000, revenue: 7501210 },
  // No commission set -> contributes 0 profit (not forecast-substituted).
  { clientId: 4, agencyId: 20, ym: '2026-07', ctype: null, rate: null, revenue: 1000000 },
  // Same commission client, an earlier entry-month.
  { clientId: 1, agencyId: 10, ym: '2026-06', ctype: 'COMMISSION', rate: 4, revenue: 8000000 },
];

test('COMMISSION profit = revenue x rate%', () => {
  assert.equal(atomProfit({ ctype: 'COMMISSION', rate: 4, revenue: 12301750 }), 492070);
});

test('AOR profit = fixed fee, independent of revenue', () => {
  assert.equal(atomProfit({ ctype: 'AOR', fee: 50000, revenue: 7501210 }), 50000);
  assert.equal(atomProfit({ ctype: 'AOR', fee: 50000, revenue: 0 }), 50000);
});

test('no commission => 0 profit (never substitutes forecast)', () => {
  assert.equal(atomProfit({ ctype: null, revenue: 1000000 }), 0);
});

test('reconciliation: sum of parts equals the whole at every grouping', () => {
  const r = reconcile(atoms);
  assert.ok(r.ok, `reconcile failed: ${JSON.stringify(r.checks)}`);

  const s = summarize(atoms);
  const sumBy = (g) => round2(g.reduce((x, row) => x + row.profit, 0));
  // Grand total = 492070 + 500000 + 50000 + 0 + 320000 = 1362070
  assert.equal(s.total.profit, 1362070);
  assert.equal(sumBy(s.byAgency), s.total.profit);
  assert.equal(sumBy(s.byClient), s.total.profit);
  assert.equal(sumBy(s.byMonth), s.total.profit);
});

test('AOR fee counts once per client-month, not per revenue', () => {
  const s = summarize([
    { clientId: 3, agencyId: 20, ym: '2026-07', ctype: 'AOR', fee: 50000, revenue: 7501210 },
  ]);
  assert.equal(s.total.profit, 50000);
  assert.equal(s.total.revenue, 7501210);
});

test('blended commission % = profit / revenue x 100', () => {
  assert.equal(blendedPct(50, 1000), 5);
  assert.equal(blendedPct(0, 0), 0);
});
