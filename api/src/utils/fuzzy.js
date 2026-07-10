// Lightweight fuzzy string matching for bulk-import reconciliation - no external
// dependency. Used to suggest the most likely existing client/channel for a raw
// name from an uploaded file, and to cluster likely variants of the same channel
// ("Sirasa TV", "SirasaTV", "Sirasa-TV") together for review.

export function normalizeName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ') // punctuation → space
    .trim()
    .replace(/\s+/g, ' ');
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}

// 0..1 similarity: the max of an edit-distance ratio on the space-squashed
// strings (so "Sirasa TV" ≈ "SirasaTV") and a token Dice coefficient (so word
// order / extra words still score well). Exact (normalized) match = 1.
export function similarity(a, b) {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const sqA = na.replace(/ /g, ''), sqB = nb.replace(/ /g, '');
  if (sqA === sqB) return 0.98;
  const maxLen = Math.max(sqA.length, sqB.length);
  const editRatio = maxLen ? 1 - levenshtein(sqA, sqB) / maxLen : 0;
  const ta = new Set(na.split(' ')), tb = new Set(nb.split(' '));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const dice = (ta.size + tb.size) ? (2 * inter) / (ta.size + tb.size) : 0;
  return Math.max(editRatio, dice);
}

// Best-scoring candidate for `name` among [{ id, name, aliases? }].
// Returns { candidate, score } (top match even if below threshold; the caller
// decides how to present it) or null when there are no candidates.
export function bestMatch(name, candidates) {
  let best = null, bestScore = -1;
  for (const c of candidates) {
    let s = similarity(name, c.name);
    for (const al of c.aliases || []) s = Math.max(s, similarity(name, al));
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best ? { candidate: best, score: Number(bestScore.toFixed(3)) } : null;
}

// Top N candidates by score (for the "change match" dropdown ordering).
export function rankMatches(name, candidates, limit = 6) {
  return candidates
    .map((c) => {
      let s = similarity(name, c.name);
      for (const al of c.aliases || []) s = Math.max(s, similarity(name, al));
      return { ...c, score: Number(s.toFixed(3)) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Greedily cluster raw names (each { raw, count }) so likely variants of the same
// thing sit together. A name joins the first cluster with any member ≥ threshold.
export function clusterNames(items, threshold = 0.8) {
  const clusters = [];
  for (const it of items) {
    let placed = false;
    for (const cl of clusters) {
      if (cl.some((x) => similarity(it.raw, x.raw) >= threshold)) { cl.push(it); placed = true; break; }
    }
    if (!placed) clusters.push([it]);
  }
  return clusters;
}
