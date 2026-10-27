// Admin → Annual Targets: new-year target setup. Shows, for a chosen year, how
// many targets of each kind are set vs expected (and who is still missing), and
// lets the admin copy the previous year's targets forward with an optional %
// uplift. Backed by GET /admin/year-setup and POST /admin/year-setup/copy.
import { useEffect, useState } from 'react';
import Icon from './Icon';
import OrbitLoader from './OrbitLoader';
import api from '../lib/api';

export default function YearSetupCard({ year, onYearChange, onCopied }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uplift, setUplift] = useState('0');
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [open, setOpen] = useState({});

  const load = () => {
    setLoading(true); setError('');
    return api.get('/admin/year-setup', { params: { year } })
      .then(({ data: d }) => setData(d))
      .catch((e) => setError(e.response?.data?.error || 'Failed to load year setup.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); setNote(''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [year]);

  const copy = async (t) => {
    const pct = Number(uplift) || 0;
    const msg = `Copy ${t.label.toLowerCase()} from ${data.prevYear} to ${year}${pct ? ` with ${pct > 0 ? '+' : ''}${pct}%` : ''}?${overwrite ? ' Existing values in ' + year + ' will be overwritten.' : ' Targets already set in ' + year + ' are kept.'}`;
    if (!window.confirm(msg)) return;
    setBusy(t.key); setNote('');
    try {
      const { data: r } = await api.post('/admin/year-setup/copy', { type: t.key, fromYear: data.prevYear, toYear: year, upliftPct: pct, overwrite });
      setNote(`${t.label}: ${r.created} added, ${r.updated} updated, ${r.skipped} kept as is.`);
      await load();
      onCopied?.();
    } catch (e) {
      setError(e.response?.data?.error || 'Copy failed.');
    } finally {
      setBusy('');
    }
  };

  const thisYear = new Date().getFullYear();
  const years = [thisYear + 1, thisYear, thisYear - 1, thisYear - 2];

  return (
    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px', marginBottom: 20 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end', marginBottom: 10 }}>
        <div>
          <h3 style={{ margin: 0, fontWeight: 700, color: 'var(--ink)' }}>Year setup</h3>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--muted)', maxWidth: 560 }}>
            Targets are set per year, so a new year starts empty. See what is still missing for {year} and copy last year's targets forward, then adjust.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginLeft: 'auto', flexWrap: 'wrap' }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Setting up</label>
            <select className="select" value={year} onChange={(e) => onYearChange(Number(e.target.value))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0, width: 110 }}>
            <label>Uplift %</label>
            <input className="input" type="number" step="0.5" value={uplift} onChange={(e) => setUplift(e.target.value)} style={{ textAlign: 'right' }} />
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, paddingBottom: 9 }}>
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> Overwrite existing
          </label>
        </div>
      </div>

      {note && <div style={{ fontSize: 12.5, color: '#15814B', fontWeight: 600, marginBottom: 8 }}>{note}</div>}
      {loading && !data ? <OrbitLoader size={32} /> : error ? (
        <div style={{ fontSize: 12.5, color: 'var(--red-600)' }}>{error}</div>
      ) : data && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Target</th>
                <th style={{ textAlign: 'right' }}>Set for {year}</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>{data.prevYear} values</th>
                <th style={{ width: 150 }} />
              </tr>
            </thead>
            <tbody>
              {data.types.map((t) => {
                const complete = t.expected > 0 ? t.missingCount === 0 : t.set > 0;
                return (
                  <tr key={t.key}>
                    <td className="strong">{t.label}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{t.set}{t.expected ? ` / ${t.expected}` : ''}</td>
                    <td style={{ fontSize: 12.5 }}>
                      {complete ? (
                        <span style={{ color: '#15814B', fontWeight: 700 }}>✓ Complete</span>
                      ) : (
                        <button type="button" onClick={() => setOpen((o) => ({ ...o, [t.key]: !o[t.key] }))}
                          style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: '#9A5B00', fontWeight: 700, font: 'inherit' }}>
                          <Icon name="alert" size={13} /> {t.missingCount} missing
                        </button>
                      )}
                      {!complete && open[t.key] && (
                        <div style={{ marginTop: 4, color: 'var(--muted)', lineHeight: 1.5 }}>
                          {t.missing.join(', ')}{t.missingCount > t.missing.length ? ` … +${t.missingCount - t.missing.length} more` : ''}
                        </div>
                      )}
                    </td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--muted)' }}>{t.prevYearCount || '-'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-ghost btn-sm" disabled={!t.prevYearCount || busy === t.key} onClick={() => copy(t)}>
                        {busy === t.key ? 'Copying…' : `Copy from ${data.prevYear}`}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
