import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commissionSnapshot } from '../src/utils/commission.js';
import { requireRole } from '../src/middleware/auth.js';

// ── Snapshot capture + immutability ──────────────────────────────────────────
test('commissionSnapshot captures a COMMISSION rate', () => {
  assert.deepEqual(
    commissionSnapshot({ commissionType: 'COMMISSION', commissionValue: 4 }),
    { commissionTypeAtEntry: 'COMMISSION', commissionRateAtEntry: 4 },
  );
});

test('commissionSnapshot captures an AOR fee', () => {
  assert.deepEqual(
    commissionSnapshot({ commissionType: 'AOR', commissionValue: 50000 }),
    { commissionTypeAtEntry: 'AOR', commissionRateAtEntry: 50000 },
  );
});

test('commissionSnapshot is null for no-commission clients', () => {
  assert.deepEqual(commissionSnapshot({ commissionType: null, commissionValue: null }),
    { commissionTypeAtEntry: null, commissionRateAtEntry: null });
  assert.deepEqual(commissionSnapshot(null),
    { commissionTypeAtEntry: null, commissionRateAtEntry: null });
});

test('snapshot does not track later commission changes (immutability at capture)', () => {
  const client = { commissionType: 'COMMISSION', commissionValue: 4 };
  const snap = commissionSnapshot(client);
  client.commissionValue = 10; // client rate edited afterwards
  assert.equal(snap.commissionRateAtEntry, 4); // captured value is frozen
});

// ── Role access on the Profit API (SUPER_ADMIN only) ─────────────────────────
function runGuard(role) {
  const mw = requireRole('SUPER_ADMIN');
  const out = { status: null, nexted: false };
  const res = { status(s) { out.status = s; return this; }, json() { return this; } };
  mw({ user: role ? { role } : null }, res, () => { out.nexted = true; });
  return out;
}

test('profit route guard: non-super-admin roles get 403', () => {
  for (const role of ['MANAGER', 'GROUP_HEAD', 'PLANNER']) {
    const r = runGuard(role);
    assert.equal(r.status, 403, `${role} should be forbidden`);
    assert.equal(r.nexted, false);
  }
});

test('profit route guard: unauthenticated gets 401', () => {
  const r = runGuard(null);
  assert.equal(r.status, 401);
  assert.equal(r.nexted, false);
});

test('profit route guard: SUPER_ADMIN passes through', () => {
  const r = runGuard('SUPER_ADMIN');
  assert.equal(r.nexted, true);
  assert.equal(r.status, null);
});
