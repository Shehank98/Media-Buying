// Direct Placements — one fixed bucket of DIGITAL channels (Sirasa Digital,
// Swarnawahini Digital, …) that the "Spend by Channel" charts render as a
// SINGLE combined bar instead of one bar per channel. Membership is the
// ChannelMaster.isDirectPlacement flag, set in Admin → Master Data → Direct
// Placements, and every byChannel row from the analytics endpoints carries it.
//
// Scope is deliberate: only the three Spend by Channel charts roll up. Breakdown
// tables, exports, reports and Channel Intelligence keep reporting the member
// channels individually, so no per-channel detail is lost anywhere it matters.
import { useState } from 'react';

export const DIRECT_PLACEMENT_LABEL = 'Direct Placements';

// Segment colours for the combined bar — walked in order, one per member
// channel. Spread across hues (not shades of the digital purple) so adjacent
// segments stay tellable apart on a 6px-tall bar.
export const DP_COLORS = [
  '#6B3FB5', '#E85D24', '#1F5BB5', '#15814B', '#C2185B',
  '#0E7490', '#9A5B00', '#7C3AED', '#0891B2', '#D9521C',
];

// Collapse the flagged digital channels in a byChannel array into one synthetic
// row. Returns the input untouched when nothing is flagged, so the charts behave
// exactly as before until an admin fills the bucket.
//
// The combined row carries `isDirectGroup` + `members` (sorted biggest first)
// and null ids, so click-through stays disabled for it — there is no single
// channel to open.
export function rollUpDirectPlacements(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const isMember = (r) => r?.isDirectPlacement === true && String(r?.medium || '').toUpperCase() === 'DIGITAL';
  const members = list.filter(isMember);
  if (members.length === 0) return list;

  const combined = {
    name: DIRECT_PLACEMENT_LABEL,
    medium: 'DIGITAL',
    mediaGroup: DIRECT_PLACEMENT_LABEL,
    id: null,
    channelMasterId: null,
    isDirectGroup: true,
    members: [...members].sort((a, b) => (b.value || 0) - (a.value || 0)),
    value: members.reduce((s, r) => s + (r.value || 0), 0),
    count: members.reduce((s, r) => s + (r.count || 0), 0),
  };
  return [...list.filter((r) => !isMember(r)), combined].sort((a, b) => (b.value || 0) - (a.value || 0));
}

// Recharts wants one series per colour, so the combined row becomes a stack of
// per-member series: normal rows keep their value in `value` and hold 0 in every
// `dpN`, the combined row does the reverse. Stacked on one stackId, each row
// therefore draws only its own segments.
export function toStackedChannelData(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const group = list.find((r) => r.isDirectGroup);
  const members = group?.members || [];
  const memberKeys = members.map((_, i) => `dp${i}`);
  const data = list.map((r) => {
    const row = { ...r, value: r.isDirectGroup ? 0 : (r.value || 0) };
    memberKeys.forEach((k, i) => { row[k] = r.isDirectGroup ? (members[i].value || 0) : 0; });
    return row;
  });
  return { data, members, memberKeys };
}

// Tooltip for the Spend by Channel bar charts: the per-channel contribution
// breakdown on the combined bar, a plain value on every other bar.
export function ChannelBarTooltip({ active, payload, fmt }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const box = {
    background: '#fff', border: '1px solid #E5E8ED', borderRadius: 9,
    padding: '9px 11px', fontSize: 12, boxShadow: '0 6px 18px rgba(15,31,61,.12)',
  };
  if (!row.isDirectGroup) {
    return (
      <div style={box}>
        <div style={{ fontWeight: 700, color: '#16243C', marginBottom: 2 }}>{row.name}</div>
        <div className="mono" style={{ color: '#3B4A63' }}>{fmt(row.value)}</div>
      </div>
    );
  }
  const total = row.value || 0;
  return (
    <div style={{ ...box, minWidth: 210 }}>
      <div style={{ fontWeight: 700, color: '#16243C' }}>{DIRECT_PLACEMENT_LABEL}</div>
      <div className="mono" style={{ color: '#3B4A63', marginBottom: 7 }}>
        {fmt(total)} · {row.members.length} channel{row.members.length === 1 ? '' : 's'}
      </div>
      {row.members.map((m, i) => (
        <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 3 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: DP_COLORS[i % DP_COLORS.length], flex: 'none' }} />
          <span style={{ flex: 1, color: '#3B4A63', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
          <span className="mono" style={{ color: '#16243C', fontWeight: 600 }}>{fmt(m.value)}</span>
          <span style={{ color: '#93A0B5', minWidth: 38, textAlign: 'right' }}>
            {total > 0 ? ((m.value / total) * 100).toFixed(1) + '%' : '-'}
          </span>
        </div>
      ))}
    </div>
  );
}

// Static colour key for the combined bar, shown under the chart so the segment
// colours mean something without hovering.
export function DirectPlacementLegend({ members, style }) {
  if (!members || members.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 11.5, color: '#6B7790', ...style }}>
      <span style={{ fontWeight: 700, color: '#16243C' }}>{DIRECT_PLACEMENT_LABEL}:</span>
      {members.map((m, i) => (
        <span key={m.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: DP_COLORS[i % DP_COLORS.length] }} />
          {m.name}
        </span>
      ))}
    </div>
  );
}

// The ranked-list bar (Spend Analytics). A normal row draws one solid fill; the
// combined row draws one segment per member channel, each hoverable for its own
// share. Total width is identical either way, so the row still reads as a single
// bar against the same scale.
export function ChannelRankBar({ row, max, color, fmt }) {
  const [hover, setHover] = useState(-1);
  const total = row.value || 0;
  const widthPct = Math.max(2, (total / (max || 1)) * 100);
  const track = { height: 6, borderRadius: 3, background: '#EEF0F3', overflow: 'hidden' };

  if (!row.isDirectGroup) {
    return <div style={track}><div style={{ width: `${widthPct}%`, height: '100%', background: color }} /></div>;
  }

  const hovered = hover >= 0 ? row.members[hover] : null;
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ ...track, display: 'flex' }}>
        <div style={{ width: `${widthPct}%`, height: '100%', display: 'flex' }}>
          {row.members.map((m, i) => (
            <div
              key={m.name}
              title={`${m.name} · ${fmt(m.value)}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(-1)}
              style={{
                width: total > 0 ? `${((m.value || 0) / total) * 100}%` : `${100 / row.members.length}%`,
                height: '100%',
                background: DP_COLORS[i % DP_COLORS.length],
                opacity: hover >= 0 && hover !== i ? 0.4 : 1,
                transition: 'opacity .12s',
              }}
            />
          ))}
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#93A0B5', marginTop: 3, minHeight: 15 }}>
        {hovered ? (
          <span style={{ color: '#3B4A63' }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: DP_COLORS[hover % DP_COLORS.length], marginRight: 5 }} />
            <b>{hovered.name}</b> · <span className="mono">{fmt(hovered.value)}</span>
            {total > 0 ? ` · ${((hovered.value / total) * 100).toFixed(1)}%` : ''}
          </span>
        ) : (
          `${row.members.length} direct placement channel${row.members.length === 1 ? '' : 's'} · hover a segment`
        )}
      </div>
    </div>
  );
}
