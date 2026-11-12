import test from 'node:test';
import assert from 'node:assert/strict';
import { windowEffect } from '../src/services/forecastWindow.service.js';

const now = new Date('2026-12-10T09:00:00Z');
const win = (over = {}) => ({ status: 'OPEN', headUserIds: [], deadline: null, ...over });

test('no window: calendar rule applies (null)', () => {
  assert.equal(windowEffect(null, 5, now), null);
});

test('an open window with no heads targets everyone', () => {
  assert.equal(windowEffect(win(), 5, now).open, true);
  assert.equal(windowEffect(win(), 99, now).open, true);
});

test('a window targeting specific heads ignores everyone else', () => {
  const w = win({ headUserIds: [5] });
  assert.equal(windowEffect(w, 5, now).open, true);
  assert.equal(windowEffect(w, 6, now), null);
});

test('a CLOSED window locks the month for the heads it targets', () => {
  const e = windowEffect(win({ status: 'CLOSED' }), 5, now);
  assert.equal(e.open, false);
  assert.equal(e.expired, false);
});

test('an OPEN window locks itself once its deadline passes', () => {
  const before = windowEffect(win({ deadline: new Date('2026-12-11T00:00:00Z') }), 5, now);
  const after = windowEffect(win({ deadline: new Date('2026-12-09T00:00:00Z') }), 5, now);
  assert.equal(before.open, true);
  assert.equal(after.open, false);
  assert.equal(after.expired, true);
});
