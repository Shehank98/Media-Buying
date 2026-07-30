// Pure unit tests for re-upload matched-row correction. No DB required
// (same convention as profit.reconcile.test.js) — run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMatchedUpdates, matchKey, UPDATABLE_FIELDS } from '../src/utils/importMatch.js';

// A DB row and the spreadsheet row that should match it.
const dbRow = (over = {}) => ({
  id: 1, clientId: 10, channelMasterId: 20, scheduleMonth: '2026-03',
  scheduleValue: '150000.00', brandName: 'Old Brand', roNumber: 'RO-1', ...over,
});
const fileRow = (over = {}) => ({
  clientId: 10, channelMasterId: 20, scheduleMonth: '2026-03',
  scheduleValue: 150000, brandName: 'New Brand', roNumber: 'RO-1', ...over,
});

test('the money column can never be updated', () => {
  // The guarantee the whole feature rests on: no aggregate can move.
  assert.ok(!UPDATABLE_FIELDS.includes('scheduleValue'));
  assert.ok(!UPDATABLE_FIELDS.includes('scheduleValueWithVat'));

  const { updates } = planMatchedUpdates([dbRow()], [fileRow()]);
  for (const u of updates) {
    for (const f of Object.keys(u.changes)) assert.ok(UPDATABLE_FIELDS.includes(f), `${f} must not be updatable`);
  }
});

test('a Decimal string and a JS number key identically', () => {
  // Float round-trip safety: Postgres Decimal(14,2) vs a parsed spreadsheet cell.
  assert.equal(matchKey({ clientId: 1, channelMasterId: 2, scheduleMonth: '2026-01', scheduleValue: '674253.66' }),
               matchKey({ clientId: 1, channelMasterId: 2, scheduleMonth: '2026-01', scheduleValue: 674253.66 }));
});

test('corrects the brand on a matched row', () => {
  const { updates, unchanged } = planMatchedUpdates([dbRow()], [fileRow()]);
  assert.equal(updates.length, 1);
  assert.equal(unchanged, 0);
  assert.deepEqual(updates[0], { id: 1, changes: { brandName: 'New Brand' }, before: { brandName: 'Old Brand' } });
});

test('a row whose brand already matches is left alone (no audit churn)', () => {
  const { updates, unchanged } = planMatchedUpdates([dbRow()], [fileRow({ brandName: 'Old Brand' })]);
  assert.equal(updates.length, 0);
  assert.equal(unchanged, 1);
});

test('a blank brand never clears an existing one', () => {
  for (const blank of [null, undefined, '', '   ']) {
    const { updates } = planMatchedUpdates([dbRow()], [fileRow({ brandName: blank })]);
    assert.equal(updates.length, 0, `blank ${JSON.stringify(blank)} must not clear the brand`);
  }
});

test('a sheet missing the RO column does not wipe RO numbers', () => {
  // import-all defaults a missing RO to '-'; the controller passes the RAW value
  // for matching so the absent column reads as "no instruction".
  const { updates } = planMatchedUpdates([dbRow()], [{ ...fileRow(), brandName: 'New Brand', roNumber: null }]);
  assert.equal(updates.length, 1);
  assert.deepEqual(Object.keys(updates[0].changes), ['brandName']);
});

test('a genuinely new row is not an update (it gets inserted instead)', () => {
  const { updates, matchedRows } = planMatchedUpdates([dbRow()], [fileRow({ scheduleValue: 999 })]);
  assert.equal(updates.length, 0);
  assert.equal(matchedRows, 0);
});

test('a different value on the same client/channel/month is a separate row', () => {
  // Value is in the key, so an edited amount is a NEW row, never a silent overwrite.
  const { updates } = planMatchedUpdates(
    [dbRow(), dbRow({ id: 2, scheduleValue: '200000.00', brandName: 'Other' })],
    [fileRow()],
  );
  assert.deepEqual(updates.map((u) => u.id), [1]);
});

test('identical duplicate rows all get the same correction', () => {
  const rows = [dbRow({ id: 1 }), dbRow({ id: 2 })];
  const { updates } = planMatchedUpdates(rows, [fileRow(), fileRow()]);
  assert.deepEqual(updates.map((u) => u.id).sort(), [1, 2]);
});

test('the file disagreeing with itself is flagged ambiguous, not guessed', () => {
  const { updates, ambiguous } = planMatchedUpdates(
    [dbRow()],
    [fileRow({ brandName: 'Brand A' }), fileRow({ brandName: 'Brand B' })],
  );
  assert.equal(updates.length, 0, 'must not pick a winner');
  assert.equal(ambiguous.length, 1);
  assert.equal(ambiguous[0].field, 'brandName');
  assert.deepEqual(ambiguous[0].values.sort(), ['Brand A', 'Brand B']);
});

test('an ambiguous brand does not block an unambiguous RO fix on the same row', () => {
  const { updates, ambiguous } = planMatchedUpdates(
    [dbRow()],
    [fileRow({ brandName: 'A', roNumber: 'RO-9' }), fileRow({ brandName: 'B', roNumber: 'RO-9' })],
  );
  assert.equal(ambiguous.length, 1);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].changes, { roNumber: 'RO-9' });
});

test('brand comparison ignores surrounding whitespace but keeps the trimmed value', () => {
  const { updates } = planMatchedUpdates([dbRow({ brandName: 'Signal' })], [fileRow({ brandName: '  Signal  ' })]);
  assert.equal(updates.length, 0);
  const changed = planMatchedUpdates([dbRow({ brandName: 'Signal' })], [fileRow({ brandName: '  Signal Ice  ' })]);
  assert.equal(changed.updates[0].changes.brandName, 'Signal Ice');
});

test('restricting the tracked fields is honoured', () => {
  const { updates } = planMatchedUpdates(
    [dbRow()], [fileRow({ brandName: 'New Brand', roNumber: 'RO-9' })], ['brandName'],
  );
  assert.deepEqual(Object.keys(updates[0].changes), ['brandName']);
});

test('an unknown field cannot be smuggled in via the fields argument', () => {
  const { updates } = planMatchedUpdates(
    [dbRow()], [{ ...fileRow(), scheduleValue: 150000, agencyId: 99 }], ['agencyId', 'scheduleValue'],
  );
  assert.equal(updates.length, 0);
});
