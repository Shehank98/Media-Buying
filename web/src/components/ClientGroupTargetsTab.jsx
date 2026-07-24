import { useState, useEffect, useMemo } from 'react';
import api from '../lib/api';
import OrbitLoader from './OrbitLoader';

const nowYear = new Date().getFullYear();
const cleanMoney = (s) => { const c = String(s).replace(/[^0-9.]/g, ''); return c === '' ? '' : c; };
const fmtMoneyInput = (s) => {
  if (s === '' || s == null) return '';
  const [i, d] = String(s).split('.');
  const gi = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return d != null ? `${gi}.${d}` : gi;
};

// Admin → Targets → Client Group Targets. Sets the annual target (full LKR) per
// parent company for a chosen year. Reuses the /admin/client-groups endpoints.
export default function ClientGroupTargetsTab() {
  const [year, setYear] = useState(nowYear);
  const [groups, setGroups] = useState([]);
  const [drafts, setDrafts] = useState({}); // groupId -> string
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [savedId, setSavedId] = useState(null);

  const yearOptions = useMemo(() => { const out = []; for (let y = nowYear + 1; y >= nowYear - 5; y--) out.push(y); return out; }, []);

  const fetchGroups = () => {
    setLoading(true);
    api.get('/admin/client-groups', { params: { year } })
      .then(r => {
        const g = r.data.groups || [];
        setGroups(g);
        const d = {};
        g.forEach(x => { d[x.id] = x.target != null ? fmtMoneyInput(String(x.target)) : ''; });
        setDrafts(d);
      })
      .catch(() => setError('Failed to load client groups.'))
      .finally(() => setLoading(false));
  };
  useEffect(fetchGroups, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveTarget = async (g) => {
    const raw = (drafts[g.id] || '').replace(/,/g, '');
    if (raw === (g.target != null ? String(g.target) : '')) return; // unchanged
    setSavingId(g.id);
    try {
      await api.post(`/admin/client-groups/${g.id}/target`, { year, amount: raw === '' ? null : Number(raw) });
      setGroups(prev => prev.map(x => x.id === g.id ? { ...x, target: raw === '' ? null : Number(raw) } : x));
      setSavedId(g.id);
      setTimeout(() => setSavedId(s => (s === g.id ? null : s)), 1200);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save target.');
    } finally { setSavingId(null); }
  };

  const total = groups.reduce((s, g) => s + (Number((drafts[g.id] || '').replace(/,/g, '')) || 0), 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', maxWidth: 560, lineHeight: 1.5 }}>
          Annual target per parent company. The agency view rolls up each group&rsquo;s sub-client spend against this. Create groups &amp; assign clients under Agencies &amp; Clients &rarr; Client Groups.
        </div>
        <select className="select" value={year} onChange={e => setYear(Number(e.target.value))} style={{ maxWidth: 120 }} title="Target year">
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c', marginBottom: 14 }}>
          {error}<button onClick={() => setError('')} style={{ marginLeft: 8, fontWeight: 600, textDecoration: 'underline', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}

      {loading ? <OrbitLoader label="Loading groups…" /> : groups.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '44px 0', color: 'var(--muted)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>No client groups yet</div>
          <div style={{ fontSize: 12.5 }}>Create one under Agencies &amp; Clients &rarr; Client Groups first.</div>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ margin: 0, minWidth: 620 }}>
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Agency</th>
                  <th style={{ textAlign: 'right' }}>Clients</th>
                  <th style={{ textAlign: 'right' }}>{year} Target (LKR)</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <tr key={g.id}>
                    <td className="strong">
                      {g.name}
                      {savingId === g.id && <span style={{ fontSize: 11, color: '#93A0B5', marginLeft: 8 }}>Saving…</span>}
                      {savedId === g.id && <span style={{ fontSize: 11, color: '#15814B', marginLeft: 8 }}>✓ Saved</span>}
                    </td>
                    <td style={{ color: 'var(--muted)' }}>{g.agencyName}</td>
                    <td style={{ textAlign: 'right' }}>{g.clientCount}</td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        className="input mono"
                        inputMode="decimal"
                        value={drafts[g.id] ?? ''}
                        placeholder="0"
                        onChange={e => { const c = cleanMoney(e.target.value); setDrafts(p => ({ ...p, [g.id]: fmtMoneyInput(c) })); }}
                        onBlur={() => saveTarget(g)}
                        style={{ width: 180, height: 32, textAlign: 'right' }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700, background: '#FBF6EC' }}>
                  <td colSpan={3}>Total ({groups.length})</td>
                  <td className="mono" style={{ textAlign: 'right' }}>LKR {Math.round(total).toLocaleString('en-US')}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
