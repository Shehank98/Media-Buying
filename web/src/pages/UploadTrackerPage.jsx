import { useState, useEffect, useMemo } from 'react';
import Icon, { Avatar } from '../components/Icon';
import api from '../lib/api';
import OrbitLoader from '../components/OrbitLoader';

const fmtLKR = v => v == null ? '-' : 'LKR ' + Math.round(Number(v)).toLocaleString('en-US');
const fmtMonth = ym => {
  if (!ym) return '-';
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};
const fmtMonthLong = ym => {
  if (!ym) return '-';
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

export default function UploadTrackerPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [tracker, setTracker] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [sendingReminder, setSendingReminder] = useState({});
  const [exporting, setExporting] = useState(false);
  const [reminderMsg, setReminderMsg] = useState('');

  const years = useMemo(() => {
    const y = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, i) => y - i);
  }, []);

  useEffect(() => {
    setLoading(true);
    api.get('/notifications/upload-tracker', { params: { year } })
      .then(r => setTracker(r.data))
      .catch(() => setError('Failed to load upload tracker.'))
      .finally(() => setLoading(false));
  }, [year]);

  const handleSendReminder = async (userIds, month) => {
    const key = `${month}-${userIds.join(',')}`;
    setSendingReminder(p => ({ ...p, [key]: true }));
    try {
      await api.post('/notifications/send-reminder', {
        userIds,
        month,
        message: reminderMsg || undefined,
      });
      // Refresh tracker
      const r = await api.get('/notifications/upload-tracker', { params: { year } });
      setTracker(r.data);
    } catch {
      setError('Failed to send reminder.');
    } finally {
      setSendingReminder(p => ({ ...p, [key]: false }));
    }
  };

  const handleSendAllReminders = async (month, pendingUsers) => {
    const userIds = pendingUsers.map(u => u.id);
    if (!userIds.length) return;
    await handleSendReminder(userIds, month);
  };

  const handleExport = async (month) => {
    setExporting(true);
    try {
      const response = await api.get('/notifications/master-sheet', {
        params: { month },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `Master_Sheet_${fmtMonth(month).replace(/\s/g, '_')}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setError('Failed to export master sheet.');
    } finally {
      setExporting(false);
    }
  };

  const selectedData = useMemo(() => {
    if (!tracker || !selectedMonth) return null;
    return tracker.months.find(m => m.month === selectedMonth);
  }, [tracker, selectedMonth]);

  const currentYM = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

  if (loading) {
    return (
      <OrbitLoader fullHeight label="Loading…" />
    );
  }

  return (
    <div className="fade-in" style={{ maxWidth: 1320, margin: '0 auto' }}>
      <style>{`
        .tracker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; margin-bottom: 24px; }
        .month-card { background: #FAFBFC; border: 1.5px solid #E5E8ED; border-radius: 12px; padding: 14px 16px; cursor: pointer; transition: all 0.15s; position: relative; }
        .month-card:hover { border-color: #C7D0DD; box-shadow: 0 4px 12px rgba(15,31,61,0.06); }
        .month-card.selected { background: #fff; border-color: #E85D24; box-shadow: 0 4px 14px rgba(232,93,36,0.12); }
        .month-card.future { opacity: 0.5; pointer-events: none; }
        .month-label { font-size: 14px; font-weight: 700; color: #16243C; margin-bottom: 8px; }
        .month-stat { font-size: 12px; color: #6B7790; display: flex; align-items: center; margin-bottom: 3px; }
        .status-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; margin-right: 6px; flex: none; }
        .status-dot.green { background: #15814B; }
        .status-dot.red { background: #C5391F; }
        .status-dot.gray { background: #93A0B5; }
        .detail-panel { background: #fff; border: 1px solid #E5E8ED; border-radius: 14px; box-shadow: 0 1px 2px rgba(15,31,61,.06); padding: 22px; }
        .agency-row { background: #FAFBFC; border: 1px solid #EEF0F3; border-radius: 11px; padding: 16px; margin-bottom: 12px; }
        .agency-row-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 13px; }
        .agency-name { font-size: 14px; font-weight: 700; color: #16243C; }
        .user-list { display: flex; flex-wrap: wrap; gap: 8px; }
        .user-chip-tracker { display: flex; align-items: center; gap: 9px; background: #fff; border: 1px solid #E5E8ED; border-radius: 9px; padding: 6px 12px 6px 9px; font-size: 13px; }
        .user-chip-tracker.uploaded { border-color: #CDEBD9; background: #F0FBF4; }
        .user-chip-tracker.pending { border-color: #F6D2C5; background: #FDEEE9; }
        .reminder-info { font-size: 11px; color: #93A0B5; margin-top: 2px; }
      `}</style>

      <div className="page-head">
        <div>
          <h1 className="page-title">Upload Tracker</h1>
          <p className="page-sub">Monitor monthly schedule uploads by agency</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <select className="select" value={year} onChange={e => { setYear(parseInt(e.target.value)); setSelectedMonth(null); }} style={{ minWidth: 120 }}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {error && (
        <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>
          {error}
          <button onClick={() => setError('')} style={{ marginLeft: 8, fontWeight: 600, textDecoration: 'underline', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}

      {/* Month Grid */}
      {tracker && (
        <div className="tracker-grid">
          {tracker.months.map(m => {
            const isFuture = m.month > currentYM;
            const allDone = m.uploadedAgencies === m.totalAgencies && m.totalAgencies > 0;
            const hasPending = m.pendingAgencies > 0 && !isFuture;
            const totalLogs = m.agencies.reduce((s, a) => s + a.totalLogs, 0);

            return (
              <div
                key={m.month}
                className={`month-card${selectedMonth === m.month ? ' selected' : ''}${allDone ? ' all-done' : hasPending ? ' pending' : ''}${isFuture ? ' future' : ''}`}
                onClick={() => !isFuture && setSelectedMonth(selectedMonth === m.month ? null : m.month)}
              >
                <div className="month-label">{fmtMonthLong(m.month)}</div>
                <div className="month-stat">
                  <span><span className="status-dot green" />{m.uploadedAgencies} uploaded</span>
                </div>
                <div className="month-stat">
                  <span><span className="status-dot red" />{m.pendingAgencies} pending</span>
                </div>
                <div className="month-stat" style={{ marginTop: 4, fontWeight: 600, color: 'var(--ink)' }}>
                  <span>{totalLogs} entries</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Panel */}
      {selectedData && (
        <div className="detail-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 720, color: 'var(--ink)' }}>
                {fmtMonthLong(selectedData.month)}
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
                {selectedData.uploadedAgencies}/{selectedData.totalAgencies} agencies uploaded
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(() => {
                const allPending = selectedData.agencies.flatMap(a => a.pendingUsers || []);
                if (!allPending.length) return null;
                return (
                  <button
                    className="btn btn-ghost"
                    onClick={() => handleSendAllReminders(selectedData.month, allPending)}
                    disabled={sendingReminder[`${selectedData.month}-all`]}
                    style={{ fontSize: 13 }}
                  >
                    <Icon name="bell" size={14} />
                    Remind All ({allPending.length})
                  </button>
                );
              })()}
              <button
                className="btn btn-primary"
                onClick={() => handleExport(selectedData.month)}
                disabled={exporting}
                style={{ fontSize: 13 }}
              >
                <Icon name="download" size={14} />
                {exporting ? 'Exporting...' : 'Export Master Sheet'}
              </button>
            </div>
          </div>

          {/* Custom reminder message */}
          <div style={{ marginBottom: 16 }}>
            <input
              className="input"
              placeholder="Custom reminder message (optional)..."
              value={reminderMsg}
              onChange={e => setReminderMsg(e.target.value)}
              style={{ maxWidth: 500, fontSize: 13 }}
            />
          </div>

          {/* Agency breakdown */}
          {selectedData.agencies.map(agency => {
            const allUploaded = agency.pendingUsers.length === 0 && agency.hasUploaded;
            return (
              <div key={agency.agencyId} className="agency-row">
                <div className="agency-row-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className={`status-dot ${agency.hasUploaded ? 'green' : 'red'}`} />
                    <span className="agency-name">{agency.agencyName}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {agency.totalLogs} entries &middot; {fmtLKR(agency.totalValue)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {agency.pendingUsers.length > 0 && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleSendReminder(
                          agency.pendingUsers.map(u => u.id),
                          selectedData.month
                        )}
                        disabled={sendingReminder[`${selectedData.month}-${agency.agencyId}`]}
                        style={{ fontSize: 12 }}
                      >
                        <Icon name="bell" size={13} />
                        Remind ({agency.pendingUsers.length})
                      </button>
                    )}
                    {allUploaded && (
                      <span style={{ fontSize: 12, color: 'var(--green-600)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Icon name="check" size={14} /> All uploaded
                      </span>
                    )}
                  </div>
                </div>

                <div className="user-list">
                  {agency.uploadedUsers.map(u => (
                    <div key={u.id} className="user-chip-tracker uploaded">
                      <Avatar name={u.name} size={24} />
                      <div>
                        <div style={{ fontWeight: 600, lineHeight: 1.2 }}>{u.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--green-600)' }}>
                          {u.logCount} entries uploaded
                        </div>
                      </div>
                    </div>
                  ))}
                  {agency.pendingUsers.map(u => (
                    <div key={u.id} className="user-chip-tracker pending">
                      <Avatar name={u.name} size={24} />
                      <div>
                        <div style={{ fontWeight: 600, lineHeight: 1.2 }}>{u.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--coral-600)' }}>
                          Not uploaded
                          {u.reminderSentAt && (
                            <span style={{ color: 'var(--muted)', marginLeft: 6 }}>
                              (reminded {new Date(u.reminderSentAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        className="act-btn"
                        title="Send reminder"
                        onClick={() => handleSendReminder([u.id], selectedData.month)}
                        disabled={sendingReminder[`${selectedData.month}-${u.id}`]}
                        style={{ marginLeft: 4 }}
                      >
                        <Icon name="bell" size={14} />
                      </button>
                    </div>
                  ))}
                  {agency.assignedUserCount === 0 && (
                    <span style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>No users assigned to this agency</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
