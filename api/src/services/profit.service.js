// Pure profit aggregation - mirrors the SQL in profit.controller.js and is the
// unit-testable ground truth for the reconciliation invariant.
//
// An "atom" is the smallest unit every total is summed from: one
// (clientId, agencyId, entry-month `ym`, commission type, snapshotted rate/fee)
// group. Rounding happens once, at the atom level, so sums of parts equal the
// whole exactly at every grouping (client / agency / month / total).

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Profit for one atom.
//   COMMISSION -> revenue x rate%  (rate stored in `rate`/`crate`)
//   AOR        -> the fixed fee, counted once for this client-month (in `fee`/`crate`)
// A null/absent commission earns 0.
export function atomProfit(atom) {
  const type = atom.ctype || atom.commissionTypeAtEntry || null;
  const val = Number(atom.rate ?? atom.fee ?? atom.crate ?? 0);
  if (!type || Number.isNaN(val)) return 0;
  if (type === 'AOR') return round2(val);
  return round2((Number(atom.revenue) || 0) * val / 100);
}

export function summarize(atoms) {
  const rows = atoms.map((a) => ({
    agencyId: a.agencyId,
    clientId: a.clientId,
    ym: a.ym,
    revenue: round2(a.revenue),
    profit: a.profit != null ? round2(a.profit) : atomProfit(a),
  }));
  const sum = (list, key) => round2(list.reduce((s, r) => s + Number(r[key]), 0));
  const groupBy = (keyFn) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      const g = m.get(k) || { key: k, revenue: 0, profit: 0 };
      g.revenue = round2(g.revenue + r.revenue);
      g.profit = round2(g.profit + r.profit);
      m.set(k, g);
    }
    return [...m.values()];
  };
  return {
    total: { revenue: sum(rows, 'revenue'), profit: sum(rows, 'profit') },
    byAgency: groupBy((r) => r.agencyId),
    byClient: groupBy((r) => r.clientId),
    byMonth: groupBy((r) => r.ym),
  };
}

// Reconciliation invariant: the sum of each grouping's profit must equal the
// grand-total profit exactly. Returns { ok, total, checks }.
export function reconcile(atoms) {
  const s = summarize(atoms);
  const t = s.total.profit;
  const sumOf = (g) => round2(g.reduce((x, r) => x + r.profit, 0));
  const checks = {
    byAgency: sumOf(s.byAgency) === t,
    byClient: sumOf(s.byClient) === t,
    byMonth: sumOf(s.byMonth) === t,
  };
  return { ok: Object.values(checks).every(Boolean), total: t, checks };
}

// Blended commission % = total profit / total revenue x 100 (0 when no revenue).
export function blendedPct(totalProfit, totalRevenue) {
  const r = Number(totalRevenue) || 0;
  if (r === 0) return 0;
  return round2((Number(totalProfit) / r) * 100);
}
