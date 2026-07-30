// Re-upload matching: identifying an already-imported ScheduleLog row from a
// spreadsheet row, so a re-upload can CORRECT its label columns in place instead
// of skipping it (the old duplicate behaviour) or deleting the month around it.
//
// The match key is the same one bulk import already uses to detect duplicates:
// Client + Channel + Schedule Month + Schedule Value. Brand and RO are
// deliberately NOT in the key — they are exactly the columns a re-upload is
// allowed to fix, which is why a brand-corrected row still matches its original.
//
// Because scheduleValue is PART of the key, every row this module touches has,
// by definition, the identical value to the file row that matched it. No money
// field is ever in an update payload (enforced by UPDATABLE_FIELDS below), so a
// matched-update pass cannot change any total, in any aggregation, anywhere.

// The only columns a re-upload may overwrite on an existing row.
export const UPDATABLE_FIELDS = ['brandName', 'roNumber'];

// Client + Channel + Month + Value, compared on integer cents so a JS number
// (spreadsheet candidate) and a Decimal(14,2) read back from Postgres key
// identically (avoids float round-trip mismatches).
export function matchKey(o) {
  const v = Number(o.scheduleValue);
  const cents = Number.isFinite(v) ? Math.round(v * 100) : '';
  return [o.clientId, o.channelMasterId, o.scheduleMonth, cents].join('||');
}

// Normalize a label for comparison: null, undefined and '' all mean "not set",
// so a blank cell in the sheet never registers as a change against a null in the
// DB (that would generate a pointless audit row on every re-upload).
function label(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// A re-upload only ever SETS a label, never clears one: a blank cell (or a
// column missing from the sheet entirely) means "no instruction for this field",
// not "erase what's there". Without this, re-uploading a file that happens to
// omit the Brand or RO column would wipe those columns across every matched row.
// Clearing a label stays a deliberate single-cell edit in the Database grid.

/**
 * Work out which existing rows a re-upload should correct.
 *
 * @param {object[]} existingRows - DB rows: {id, clientId, channelMasterId, scheduleMonth, scheduleValue, brandName, roNumber}
 * @param {object[]} candidates   - validated spreadsheet rows (same shape, no id)
 * @param {string[]} [fields]     - subset of UPDATABLE_FIELDS to consider
 * @returns {{updates: object[], ambiguous: object[], unchanged: number, matchedRows: number}}
 *   updates:   [{id, changes: {field: newValue}, before: {field: oldValue}}]
 *   ambiguous: [{key, field, values}] - the file disagrees with itself on this
 *              key, so the correct value is unknowable and nothing is touched.
 */
export function planMatchedUpdates(existingRows, candidates, fields = UPDATABLE_FIELDS) {
  const tracked = fields.filter((f) => UPDATABLE_FIELDS.includes(f));

  // Existing rows grouped by match key (a key can legitimately cover several
  // rows — e.g. two identical schedules in the same month at the same value).
  const existingByKey = new Map();
  for (const row of existingRows) {
    const k = matchKey(row);
    if (!existingByKey.has(k)) existingByKey.set(k, []);
    existingByKey.get(k).push(row);
  }

  // Desired value per key per field, from the file.
  const desiredByKey = new Map();
  for (const c of candidates) {
    const k = matchKey(c);
    if (!existingByKey.has(k)) continue; // genuinely new row — inserted, not updated
    if (!desiredByKey.has(k)) desiredByKey.set(k, new Map());
    const perField = desiredByKey.get(k);
    for (const f of tracked) {
      const v = label(c[f]);
      if (v === null) continue; // blank cell / absent column: no instruction
      if (!perField.has(f)) perField.set(f, new Set());
      perField.get(f).add(v);
    }
  }

  const updates = [];
  const ambiguous = [];
  let unchanged = 0;
  let matchedRows = 0;

  for (const [k, perField] of desiredByKey) {
    const rows = existingByKey.get(k);
    matchedRows += rows.length;

    // Resolve one target value per field, or flag the key as ambiguous.
    const resolved = {};
    for (const f of tracked) {
      const values = [...(perField.get(f) || [])];
      if (values.length === 0) continue;          // nothing to apply for this field
      if (values.length === 1) { resolved[f] = values[0]; continue; }
      // The file carries two different brands for rows that are otherwise
      // indistinguishable; guessing would be worse than leaving it alone.
      ambiguous.push({ key: k, field: f, values });
    }

    for (const row of rows) {
      const changes = {};
      const before = {};
      for (const [f, target] of Object.entries(resolved)) {
        if (label(row[f]) !== target) { changes[f] = target; before[f] = label(row[f]); }
      }
      if (Object.keys(changes).length > 0) updates.push({ id: row.id, changes, before });
      else unchanged++;
    }
  }

  return { updates, ambiguous, unchanged, matchedRows };
}
