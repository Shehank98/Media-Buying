// Property "benefits" — what a negotiated deal actually delivers, as structured
// rows: [{ item, qty }], e.g. [{item:'Trailers',qty:50},{item:'Mid intro',qty:20}].
//
// Kept structured rather than folded into the free-text sponsorshipDetails so
// the Negotiation Planner can answer "at this budget, on this channel, deals
// have historically included …" without parsing prose.

const MAX_ROWS = 40;      // a single deal listing more than this is a data-entry mistake
const MAX_ITEM_LEN = 80;

// Normalise whatever the client posted into a clean [{item, qty}] array.
// Rows with a blank item are dropped (the qty alone means nothing); qty is a
// non-negative integer, defaulting to 0 so "Trailers" with no number still
// records that trailers were part of the deal. Returns null when nothing is
// left, so the column stays NULL rather than holding an empty array.
export function sanitizeBenefits(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const row of raw.slice(0, MAX_ROWS)) {
    if (!row || typeof row !== 'object') continue;
    const item = String(row.item ?? '').trim().slice(0, MAX_ITEM_LEN);
    if (!item) continue;
    const n = Number(row.qty);
    const qty = Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
    out.push({ item, qty });
  }
  return out.length ? out : null;
}

// Read a stored value back defensively — the column is Json, so a hand-edited
// or legacy row could hold anything.
export function readBenefits(value) {
  return Array.isArray(value) ? value.filter((b) => b && typeof b === 'object' && b.item) : [];
}

// "50 Trailers · 20 Mid intro" — for emails, exports and history notes.
export function benefitsSummary(value) {
  return readBenefits(value)
    .map((b) => (b.qty > 0 ? `${b.qty} ${b.item}` : b.item))
    .join(' · ');
}
