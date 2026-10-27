// Drill-down behind a Business Unit Revenue card (Executive Dashboard).
// Level 1: one Annual-Achievement-style bar set per Hub head in the agency
//          (annual target · target up to the latest month · achieved).
// Level 2: click a head → how that revenue built up, month by month, by client
//          (stacked bars + a client × month table, Excel export).
// Data: GET /analytics/dashboard/agency-revenue/:agencyId/hubs?year=
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Legend, ReferenceLine, Cell,
} from 'recharts';
import Icon from './Icon';
import OrbitLoader from './OrbitLoader';
import api from '../lib/api';
import { writeBrandedWorkbook } from '../lib/brandedXlsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CLIENT_COLORS = ['#1F5BB5', '#E85D24', '#15814B', '#7c3aed', '#C2185B', '#0891b2', '#9A5B00', '#6B3FB5', '#065f46', '#C5391F'];
const OTHER_COLOR = '#B4C1D6';
const MAX_SERIES = 10; // clients beyond this roll into "Other clients" in the chart (the table keeps them all)

const fmtCompact = (v) => {
  const n = Number(v) || 0; const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a < 1e4 ? 1 : 0)}K`;
  return Math.round(n).toLocaleString('en-US');
};
const fmtFull = (v) => (Number(v) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const pctColor = (p) => (p == null ? 'var(--muted)' : p >= 100 ? '#15814B' : p >= 85 ? '#9A5B00' : '#C5391F');

function MoneyTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => Number(p.value) !== 0);
  const total = rows.reduce((s, p) => s + Number(p.value || 0), 0);
  return (
    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', boxShadow: '0 4px 12px rgba(0,0,0,.1)', fontSize: 12, maxWidth: 280 }}>
      <div style={{ fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
      {rows.map((p) => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: p.color || 'var(--ink)' }}>
          <span>{p.name}</span><span className="mono">LKR {fmtFull(p.value)}</span>
        </div>
      ))}
      {rows.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)', fontWeight: 700 }}>
          <span>Total</span><span className="mono">LKR {fmtFull(total)}</span>
        </div>
      )}
    </div>
  );
}

// Annual-Achievement style bars for one head.
function HeadAchievementBars({ head, rangeLabel }) {
  const upto = rangeLabel ? rangeLabel.split('–').pop() : '';
  const data = head.annualTarget > 0
    ? [
      { name: 'Annual target', value: head.annualTarget, fill: '#1F5BB5' },
      { name: `Upto ${upto || '-'} target`, value: head.targetToDate, fill: '#9A5B00' },
      { name: upto ? `Achieved upto ${upto}` : 'Achieved', value: head.achieved, fill: '#15814B' },
    ]
    : [{ name: upto ? `Achieved upto ${upto}` : 'Achieved', value: head.achieved, fill: '#15814B' }];
  return (
    <ResponsiveContainer width="100%" height={data.length * 38 + 16}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 4 }}>
        <XAxis type="number" hide domain={[0, (max) => Math.max(max, 1)]} />
        <YAxis type="category" dataKey="name" width={128} tick={{ fontSize: 11.5, fill: '#16243C' }} tickLine={false} axisLine={false} />
        <Bar dataKey="value" barSize={22} radius={[0, 5, 5, 0]} isAnimationActive={false}>
          {data.map((d) => <Cell key={d.name} fill={d.fill} />)}
          <LabelList dataKey="value" position="right" formatter={fmtCompact} style={{ fontSize: 11.5, fontWeight: 700, fill: '#16243C' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function HeadCard({ head, rangeLabel, selected, onClick, muted }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left', background: '#fff', cursor: 'pointer', borderRadius: 12, padding: '12px 14px 8px',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', font: 'inherit',
        border: `1px solid ${selected ? 'var(--coral-600, #E85D24)' : 'var(--border)'}`,
        boxShadow: selected ? '0 0 0 3px rgba(232,93,36,.15)' : '0 1px 2px rgba(15,31,61,.05)',
        borderTop: `3px solid ${muted ? '#B4C1D6' : pctColor(head.pct)}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <div style={{ fontWeight: 750, color: 'var(--ink)', fontSize: 14 }}>{head.headName}</div>
        {head.pct != null && (
          <span className="mono" style={{ fontSize: 12, fontWeight: 800, color: pctColor(head.pct), background: '#F5F6F8', borderRadius: 20, padding: '2px 9px' }}>{head.pct}%</span>
        )}
      </div>
      {muted ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 10px', lineHeight: 1.5 }}>
          Revenue not linked to a Hub head{head.clients.some((c) => c.isResidual) ? ', plus the difference against the agency total' : ''}.
          <div className="mono" style={{ fontWeight: 750, color: 'var(--ink)', fontSize: 13, marginTop: 4 }}>LKR {fmtFull(head.achieved)}</div>
        </div>
      ) : (
        <>
          <HeadAchievementBars head={head} rangeLabel={rangeLabel} />
          {!(head.annualTarget > 0) && (
            <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic', marginBottom: 4 }}>No target set (Admin → Group Revenue → Hub head targets)</div>
          )}
        </>
      )}
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--coral-700, #C44A18)', display: 'flex', alignItems: 'center', gap: 4, paddingTop: 4 }}>
        {selected ? 'Hide client build-up' : 'See client build-up'} <Icon name="chevD" size={13} style={{ transform: selected ? 'rotate(180deg)' : 'none' }} />
      </div>
    </button>
  );
}

function ClientBuildUp({ group, year, agencyName, lastMonth }) {
  const months = MONTHS.slice(0, lastMonth);
  const clients = group.clients;
  const series = clients.slice(0, MAX_SERIES);
  const rest = clients.slice(MAX_SERIES);
  const keyOf = (i) => `c${i}`;

  const chartData = months.map((label, mi) => {
    const row = { label };
    series.forEach((c, i) => { row[keyOf(i)] = c.monthly[mi]; });
    if (rest.length) row.other = rest.reduce((s, c) => s + c.monthly[mi], 0);
    return row;
  });
  const monthlyTarget = group.annualTarget > 0 ? group.annualTarget / 12 : null;
  const colTotals = months.map((_, mi) => clients.reduce((s, c) => s + c.monthly[mi], 0));
  const grand = colTotals.reduce((s, v) => s + v, 0);
  // Share is of real client revenue only (the residual/negative rows would make it meaningless).
  const shareBase = clients.filter((c) => !c.isResidual).reduce((s, c) => s + c.total, 0);

  const exportXlsx = () => {
    const head = ['Client', ...months, 'Total'];
    const rows = clients.map((c) => [c.name, ...c.monthly.slice(0, lastMonth), c.total]);
    rows.push(['Total', ...colTotals, grand]);
    if (monthlyTarget) rows.push(['Monthly target', ...months.map(() => monthlyTarget), monthlyTarget * lastMonth]);
    const aoa = [[`${group.headName} · ${agencyName} · ${year} revenue by client (LKR)`], [], head, ...rows];
    writeBrandedWorkbook([{ name: 'Revenue by client', aoa, cols: [32, ...months.map(() => 14), 16] }],
      `hub-revenue-${group.headName.replace(/[^a-z0-9]+/gi, '-')}-${year}.xlsx`);
  };

  return (
    <div style={{ marginTop: 18, border: '1px solid var(--border)', borderRadius: 14, padding: 16, background: '#FBFCFD' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 750, color: 'var(--ink)' }}>{group.headName} · how the revenue built up</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            Month-wise revenue by client · {year} · LKR {fmtFull(group.achieved)} total from {clients.filter((c) => !c.isResidual && !c.isDirect).length} client(s)
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={exportXlsx}><Icon name="download" size={14} />Excel</button>
      </div>

      {clients.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--muted)', padding: '20px 0', textAlign: 'center' }}>No revenue entered for this Hub head's clients in {year} yet.</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} stackOffset="sign" margin={{ top: 10, right: 16, bottom: 4, left: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={56} />
              <Tooltip content={<MoneyTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11.5 }} />
              {monthlyTarget && (
                <ReferenceLine y={monthlyTarget} stroke="#9A5B00" strokeDasharray="5 4"
                  label={{ value: `Monthly target ${fmtCompact(monthlyTarget)}`, position: 'insideTopRight', fontSize: 11, fill: '#9A5B00' }} />
              )}
              {series.map((c, i) => (
                <Bar key={keyOf(i)} dataKey={keyOf(i)} name={c.name} stackId="rev"
                  fill={c.isResidual ? '#C5391F' : c.isDirect ? OTHER_COLOR : CLIENT_COLORS[i % CLIENT_COLORS.length]} />
              ))}
              {rest.length > 0 && <Bar dataKey="other" name={`Other clients (${rest.length})`} stackId="rev" fill={OTHER_COLOR} />}
            </BarChart>
          </ResponsiveContainer>

          <div className="tbl-wrap" style={{ marginTop: 14, maxHeight: 340, overflow: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ position: 'sticky', left: 0, background: 'var(--bg)', zIndex: 1 }}>Client</th>
                  {months.map((m) => <th key={m} style={{ textAlign: 'right' }}>{m}</th>)}
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'right' }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c, i) => (
                  <tr key={c.clientId ?? `x${i}`}>
                    <td style={{ position: 'sticky', left: 0, background: '#fff', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, marginRight: 7, background: c.isResidual ? '#C5391F' : (i < MAX_SERIES && !c.isDirect ? CLIENT_COLORS[i % CLIENT_COLORS.length] : OTHER_COLOR) }} />
                      <span style={{ fontStyle: c.isResidual || c.isDirect ? 'italic' : 'normal' }}>{c.name}</span>
                    </td>
                    {c.monthly.slice(0, lastMonth).map((v, mi) => (
                      <td key={mi} className="mono" style={{ textAlign: 'right', color: v === 0 ? 'var(--muted)' : v < 0 ? '#C5391F' : 'var(--ink)' }}>{v === 0 ? '-' : fmtFull(v)}</td>
                    ))}
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 750 }}>{fmtFull(c.total)}</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--muted)' }}>{!c.isResidual && shareBase > 0 ? `${((c.total / shareBase) * 100).toFixed(1)}%` : '-'}</td>
                  </tr>
                ))}
                <tr style={{ background: 'var(--bg)' }}>
                  <td style={{ position: 'sticky', left: 0, background: 'var(--bg)', fontWeight: 800 }}>Total</td>
                  {colTotals.map((v, mi) => <td key={mi} className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{fmtFull(v)}</td>)}
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{fmtFull(grand)}</td>
                  <td />
                </tr>
                {monthlyTarget && (
                  <tr>
                    <td style={{ position: 'sticky', left: 0, background: '#fff', color: '#9A5B00', fontWeight: 700 }}>Monthly target</td>
                    {months.map((m, mi) => (
                      <td key={m} className="mono" style={{ textAlign: 'right', color: colTotals[mi] >= monthlyTarget ? '#15814B' : '#9A5B00' }}>{fmtFull(monthlyTarget)}</td>
                    ))}
                    <td className="mono" style={{ textAlign: 'right', color: '#9A5B00', fontWeight: 700 }}>{fmtFull(monthlyTarget * lastMonth)}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function AgencyHubRevenueModal({ agency, year, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedKey, setSelectedKey] = useState(null);
  const detailRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(''); setSelectedKey(null);
    api.get(`/analytics/dashboard/agency-revenue/${agency.agencyId}/hubs`, { params: year ? { year } : {} })
      .then((r) => { if (alive) setData(r.data); })
      .catch((e) => { if (alive) setError(e.response?.data?.error || 'Failed to load Hub revenue.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [agency.agencyId, year]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const groups = useMemo(() => {
    if (!data) return [];
    const list = data.heads.map((h) => ({ ...h, key: `h${h.headUserId}` }));
    if (data.notAssigned) list.push({ ...data.notAssigned, key: 'na', muted: true });
    return list;
  }, [data]);
  const selected = groups.find((g) => g.key === selectedKey) || null;

  // Show months up to the latest one with revenue (agency or this group).
  const lastMonth = useMemo(() => {
    let m = data?.latestMonth || 0;
    if (selected) selected.monthly.forEach((v, i) => { if (v !== 0) m = Math.max(m, i + 1); });
    return Math.max(m, 1);
  }, [data, selected]);

  const pick = (key) => {
    setSelectedKey((k) => (k === key ? null : key));
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  const headsTotal = groups.reduce((s, g) => s + g.achieved, 0);

  return (
    <div className="modal-scrim show" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal hub-rev-modal" style={{ width: 1120, maxHeight: '92vh' }} role="dialog" aria-modal="true" aria-label={`${agency.agencyName} Hub revenue`}>
        <div className="modal-head">
          <div>
            <div style={{ fontSize: 18, fontWeight: 760, color: 'var(--ink)' }}>{agency.agencyName} · Revenue by Hub head</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
              {data ? (
                <>
                  {data.year}{data.rangeLabel ? ` · ${data.rangeLabel}` : ''} · agency total <b className="mono" style={{ color: 'var(--ink)' }}>LKR {fmtFull(data.agencyTotal)}</b>
                  {' '}· target to date = annual ÷ 12 × months elapsed · click a Hub head to see how their revenue built up
                </>
              ) : 'Loading…'}
            </div>
          </div>
          <button className="btn btn-subtle btn-sm" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          {loading ? <OrbitLoader size={48} label="Loading Hub revenue…" /> : error ? (
            <div style={{ color: 'var(--red-600)', fontSize: 13, fontWeight: 600 }}>{error}</div>
          ) : groups.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: 30 }}>
              No Hub heads or revenue for {agency.agencyName} in {data?.year}. Assign clients to Hub heads (Admin → Teams/Users) and enter revenue by client (Admin → Group Revenue).
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
                {groups.map((g) => (
                  <HeadCard key={g.key} head={g} rangeLabel={data.rangeLabel} muted={g.muted} selected={g.key === selectedKey} onClick={() => pick(g.key)} />
                ))}
              </div>
              {Math.abs(headsTotal - data.agencyTotal) >= 1 && data.agencyTotal !== 0 && (
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10 }}>
                  Hub heads add up to LKR {fmtFull(headsTotal)} (agency revenue is entered for fewer months than the client figures).
                </div>
              )}
              <div ref={detailRef}>
                {selected && <ClientBuildUp group={selected} year={data.year} agencyName={agency.agencyName} lastMonth={lastMonth} />}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
