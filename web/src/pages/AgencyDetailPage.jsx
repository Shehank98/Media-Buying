import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import Icon from '../components/Icon';

export default function AgencyDetailPage() {
  const { agencyId } = useParams();
  const navigate = useNavigate();
  const [agency, setAgency] = useState(null);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchAgencyDetail = async () => {
      try {
        const [agencyRes, clientsRes] = await Promise.all([
          api.get(`/agencies/${agencyId}`),
          api.get(`/agencies/${agencyId}/clients`),
        ]);
        setAgency(agencyRes.data.agency || agencyRes.data);
        setClients(clientsRes.data.clients || clientsRes.data || []);
      } catch (err) {
        setError('Failed to load agency details.');
      } finally {
        setLoading(false);
      }
    };
    fetchAgencyDetail();
  }, [agencyId]);

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
          <h1 className="page-title">{agency?.name}</h1>
          <p className="page-sub">{clients.length} clients</p>
        </div>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr>
            <th>Client</th><th>Channels</th><th style={{ width: 40 }}></th>
          </tr></thead>
          <tbody>
            {clients.map(c => {
              const count = c._count?.channels || c.channelCount || 0;
              return (
                <tr key={c.id} className="clickable" onClick={() => navigate(`/clients/${c.id}`)}>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--bg-sunken)', color: 'var(--navy-800)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13, flex: 'none' }}>{c.name[0]}</div>
                    <span className="strong">{c.name}</span>
                  </div></td>
                  <td><span className="count-badge">{count} channels</span></td>
                  <td><Icon name="chevR" size={16} style={{ color: 'var(--muted-2)' }} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
