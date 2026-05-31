import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import Icon from '../components/Icon';

export default function AgenciesPage() {
  const [agencies, setAgencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchAgencies = async () => {
      try {
        const { data } = await api.get('/agencies');
        const raw = data.agencies || data;
        setAgencies(Array.isArray(raw) ? raw : []);
      } catch (err) {
        setError('Failed to load agencies.');
      } finally {
        setLoading(false);
      }
    };
    fetchAgencies();
  }, []);

  if (loading) return null;

  if (error) {
    return (
      <div className="content-narrow fade-in">
        <p style={{ color: 'var(--coral-600)', padding: 16 }}>{error}</p>
      </div>
    );
  }

  return (
    <div className="content-narrow fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Agencies</h1>
          <p className="page-sub">Agencies you have access to</p>
        </div>
        <button className="btn btn-primary"><Icon name="plus" size={16} />Add agency</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 18 }}>
        {agencies.map(ag => {
          const count = ag._count?.clients || ag.clientCount || 0;
          return (
            <button key={ag.id} className="stat" style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)' }}
              onClick={() => navigate(`/agencies/${ag.id}`)}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--navy-400)'}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border)'}>
              <div className="stat-top">
                <div className="stat-ico" style={{ background: 'var(--navy-900)', color: '#fff' }}>{ag.name[0]}</div>
                <div className="stat-label">{ag.name}</div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{count} clients · active</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
