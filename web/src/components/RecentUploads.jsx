import { useState, useEffect, useCallback } from 'react';
import Icon from './Icon';
import api from '../lib/api';

const fmtMonth = (ym) => {
  if (!ym) return '-';
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

/**
 * Recent upload sheets (upload batches) the user can access, with delete.
 * Reused on the Database page and inside the Admin panel.
 *
 * Props:
 *   title     - section heading (default "Recent upload sheets")
 *   limit     - max rows to fetch (default 20)
 *   showAgency- show the Agency column (default true)
 *   onChanged - called after a successful delete
 */
export default function RecentUploads({ title = 'Recent upload sheets', limit = 20, showAgency = true, onChanged }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState('');

  const fetchBatches = useCallback(() => {
    setLoading(true);
    api.get('/database/recent-batches', { params: { limit } })
      .then(r => setBatches(r.data.batches || []))
      .catch(() => setBatches([]))
      .finally(() => setLoading(false));
  }, [limit]);

  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  const handleDelete = async (b) => {
    const label = b.fileName || 'this sheet';
    if (!window.confirm(`Delete all rows uploaded from "${label}"? This will remove ${b.activeRows} entr${b.activeRows === 1 ? 'y' : 'ies'} from the database.`)) return;
    setDeleting(b.id);
    setError('');
    try {
      await api.delete(`/database/batches/${b.id}`);
      fetchBatches();
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete upload');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="section-card" style={{ marginTop: 20 }}>
      <div className="section-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="upload" size={16} />{title}
          {!loading && <span className="count-badge">{batches.length}</span>}
        </h3>
        <button className="act-btn" title="Refresh" onClick={fetchBatches} disabled={loading}>
          <Icon name="history" size={15} />
        </button>
      </div>

      {error && (
        <div style={{ margin: '0 20px 12px', background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--red-700,#b91c1c)' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading uploads…</div>
      ) : batches.length === 0 ? (
        <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          <Icon name="upload" size={28} style={{ opacity: 0.25, marginBottom: 6, display: 'inline-block' }} />
          <p style={{ margin: 0 }}>No recent uploads</p>
        </div>
      ) : (
        <div className="tbl-wrap" style={{ margin: 0 }}>
          <table className="tbl" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>File</th>
                <th>Month</th>
                {showAgency && <th>Agency</th>}
                <th>Client(s)</th>
                <th style={{ textAlign: 'right' }}>Rows</th>
                <th>Uploaded by</th>
                <th>When</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {batches.map(b => (
                <tr key={b.id}>
                  <td className="strong" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.fileName || 'Untitled sheet'}
                  </td>
                  <td>{fmtMonth(b.scheduleMonth)}</td>
                  {showAgency && <td style={{ color: 'var(--muted)' }}>{b.agencyName || '-'}</td>}
                  <td style={{ color: 'var(--muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.clientNames?.length ? b.clientNames.join(', ') : '-'}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{b.activeRows}</td>
                  <td style={{ color: 'var(--muted)' }}>{b.uploader?.name || '-'}</td>
                  <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtDate(b.createdAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {b.canDelete ? (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--red-600,#dc2626)' }}
                        onClick={() => handleDelete(b)}
                        disabled={deleting === b.id}
                      >
                        <Icon name="trash" size={14} />
                        {deleting === b.id ? 'Deleting…' : 'Delete'}
                      </button>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
