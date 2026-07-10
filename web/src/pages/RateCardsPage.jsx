import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';
import api from '../lib/api';
import OrbitLoader from '../components/OrbitLoader';

const fmtSize = (b) => (b == null ? '' : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.gif,.webp,.xls,.xlsx,.csv,.doc,.docx';

// The GENERAL rate cards directory: what each channel offers as its standard
// (non-client-specific) rate card. Search by channel + download any version.
// Client-specific rate cards live on each client's channel page instead.
export default function RateCardsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN';
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState(null); // channelMasterId with version history open

  // Admin upload (replace/add): channel picker + file
  const [allChannels, setAllChannels] = useState([]);
  const [uploadFor, setUploadFor] = useState(''); // channelMasterId to upload for
  const [busyId, setBusyId] = useState(null);
  const fileRef = useRef(null);
  const pendingRef = useRef(null); // channelMasterId the picked file is for

  const fetchCards = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/channels/rate-cards/general');
      setCards(data.cards || []);
    } catch {
      setError('Failed to load rate cards.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchCards(); }, []);
  useEffect(() => {
    if (!isAdmin) return;
    api.get('/masterdata/channel-masters').then(r => setAllChannels(r.data || [])).catch(() => {});
  }, [isAdmin]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return cards;
    return cards.filter(c => c.name.toLowerCase().includes(s) || (c.mediaGroup || '').toLowerCase().includes(s) || (c.medium || '').toLowerCase().includes(s));
  }, [cards, q]);

  const open = async (channelMasterId, download, driveId, fileName) => {
    try {
      const params = {};
      if (download) params.download = 1;
      if (driveId) params.driveId = driveId;
      const res = await api.get(`/analytics/channel/${channelMasterId}/rate-card`, { params, responseType: 'blob' });
      const url = URL.createObjectURL(res.data); // blob carries the right MIME
      if (download) {
        const a = document.createElement('a');
        a.href = url; a.download = fileName || 'rate-card';
        document.body.appendChild(a); a.click(); a.remove();
      } else {
        window.open(url, '_blank');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setError('Could not open the rate card.');
    }
  };

  const pickFor = (channelMasterId) => { pendingRef.current = channelMasterId; fileRef.current?.click(); };
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    const chId = pendingRef.current;
    e.target.value = '';
    pendingRef.current = null;
    if (!file || !chId) return;
    if (!/\.(pdf|jpg|jpeg|png|gif|webp|xls|xlsx|csv|doc|docx)$/i.test(file.name)) {
      setError('Rate card must be a PDF, image (JPG/PNG), Excel, CSV or Word file.'); return;
    }
    setBusyId(chId); setError('');
    try {
      const dataBase64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',').pop());
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      await api.post(`/admin/channel-masters/${chId}/rate-card`, { fileName: file.name, dataBase64 });
      setUploadFor('');
      await fetchCards();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to upload rate card.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (c) => {
    if (!window.confirm(`Remove the general rate card for ${c.name}? All versions are deleted.`)) return;
    setBusyId(c.channelMasterId); setError('');
    try {
      await api.delete(`/admin/channel-masters/${c.channelMasterId}/rate-card`);
      await fetchCards();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove rate card.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fade-in" style={{ maxWidth: 1320, margin: '0 auto' }}>
      <input ref={fileRef} type="file" accept={ACCEPT} style={{ display: 'none' }} onChange={onFile} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.6px', margin: 0, color: '#16243C' }}>Rate Cards</h1>
          <div style={{ fontSize: 13, color: '#6B7790', marginTop: 4 }}>General channel rate cards — search by channel and download. Any format (PDF, image, Excel). Client-specific rate cards live on each client's channel page.</div>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="select" value={uploadFor} onChange={e => setUploadFor(e.target.value)} style={{ minWidth: 200 }}>
              <option value="">Upload for channel…</option>
              {allChannels.filter(c => c.isActive !== false).map(c => (
                <option key={c.id} value={c.id}>{c.name} · {c.medium}</option>
              ))}
            </select>
            <button className="btn btn-primary btn-sm" disabled={!uploadFor || busyId === Number(uploadFor)} onClick={() => pickFor(Number(uploadFor))}>
              <Icon name="upload" size={15} /> {busyId === Number(uploadFor) ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>{error}</div>
      )}

      <div style={{ position: 'relative', marginBottom: 16, maxWidth: 360 }}>
        <Icon name="search" size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
        <input className="input" placeholder="Search channel, medium or media group…" value={q} onChange={e => setQ(e.target.value)} style={{ paddingLeft: 34 }} />
      </div>

      {loading ? (
        <div style={{ padding: '40px 0' }}><OrbitLoader label="Loading rate cards…" /></div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '48px 24px', textAlign: 'center', color: '#6B7790', background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14 }}>
          {cards.length === 0 ? 'No rate cards uploaded yet.' : 'No channels match your search.'}
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Channel</th>
                <th>Medium</th>
                <th>Media Group</th>
                <th>File</th>
                <th>Updated</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const isOpen = expanded === c.channelMasterId;
                const versions = [...(c.versions || [])].reverse(); // newest first
                return [
                  <tr key={c.channelMasterId}>
                    <td className="strong">{c.name}</td>
                    <td><span className="medium-tag" data-medium={c.medium}>{c.medium}</span></td>
                    <td style={{ color: 'var(--muted)' }}>{c.mediaGroup || '-'}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 12 }} title={c.fileName}>
                      {c.fileName}{c.size ? ` · ${fmtSize(c.size)}` : ''}
                      {c.versionCount > 1 && (
                        <button className="badge" onClick={() => setExpanded(isOpen ? null : c.channelMasterId)} style={{ marginLeft: 8, cursor: 'pointer', fontSize: 10.5 }} title={`${c.versionCount} versions`}>
                          v{c.versionCount}
                        </button>
                      )}
                    </td>
                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>{fmtDate(c.uploadedAt)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => open(c.channelMasterId, false)}><Icon name="file" size={14} /> View</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => open(c.channelMasterId, true, null, c.fileName)}><Icon name="download" size={14} /></button>
                        {isAdmin && (
                          <>
                            <button className="btn btn-ghost btn-sm" disabled={busyId === c.channelMasterId} onClick={() => pickFor(c.channelMasterId)} title="Upload new version">
                              <Icon name="upload" size={14} /> {busyId === c.channelMasterId ? '…' : 'Replace'}
                            </button>
                            <button className="btn btn-ghost btn-sm" disabled={busyId === c.channelMasterId} onClick={() => remove(c)} title="Remove all versions"><Icon name="trash" size={14} /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>,
                  isOpen && (
                    <tr key={`${c.channelMasterId}-v`}>
                      <td colSpan={6} style={{ background: '#F7F8FA' }}>
                        <div style={{ padding: '4px 4px 8px' }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#93A0B5', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Version history</div>
                          {versions.map((v, i) => (
                            <div key={v.driveId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderTop: i ? '1px solid var(--border)' : 'none', fontSize: 12.5 }}>
                              <span className="badge" style={{ fontSize: 10.5 }}>v{v.version}</span>
                              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.fileName}>{v.fileName}</span>
                              <span style={{ color: 'var(--muted)' }}>{fmtSize(v.size)}</span>
                              <span style={{ color: 'var(--muted)' }}>{fmtDate(v.uploadedAt)}</span>
                              <button className="btn btn-ghost btn-sm" onClick={() => open(c.channelMasterId, false, v.driveId)}><Icon name="file" size={13} /> View</button>
                              <button className="btn btn-ghost btn-sm" onClick={() => open(c.channelMasterId, true, v.driveId, v.fileName)}><Icon name="download" size={13} /></button>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
