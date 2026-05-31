import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import api from '../lib/api';

export default function ClientsPage() {
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchClients = async () => {
      try {
        const { data: agenciesData } = await api.get('/agencies');
        const agencies = agenciesData.agencies || agenciesData || [];
        const allClients = [];
        for (const ag of agencies) {
          try {
            const { data: clientsData } = await api.get(`/agencies/${ag.id}/clients`);
            const cls = clientsData.clients || clientsData || [];
            cls.forEach(c => allClients.push({ ...c, agencyName: ag.name }));
          } catch { /* skip agency */ }
        }
        setClients(allClients);
      } catch { /* ignore */ } finally { setLoading(false); }
    };
    fetchClients();
  }, []);

  if (loading) return <div className="content-narrow fade-in" style={{padding:'60px 0',textAlign:'center',color:'var(--muted)'}}>Loading…</div>;

  return (
    <div className="content-narrow fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="page-sub">Ogilvy Media · {clients.length} clients you can access</p>
        </div>
        <button className="btn btn-primary"><Icon name="plus" size={16} />Add client</button>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr>
            <th>Client</th>
            <th>Agency</th>
            <th style={{textAlign:'center'}}>Channels</th>
            <th style={{width: 40}}></th>
          </tr></thead>
          <tbody>
            {clients.map(c => (
              <tr key={c.id} className="clickable" onClick={() => navigate(`/clients/${c.id}`)}>
                <td><div style={{display:'flex',alignItems:'center',gap:11}}>
                  <div style={{width:34,height:34,borderRadius:9,background:'var(--bg-sunken)',color:'var(--navy-800)',display:'grid',placeItems:'center',fontWeight:700,fontSize:13,flex:'none'}}>{c.name?.[0]}</div>
                  <span className="strong">{c.name}</span>
                </div></td>
                <td style={{color:'var(--muted)'}}>{c.agencyName || '—'}</td>
                <td style={{textAlign:'center'}}><span className="count-badge">{c._count?.channels || c.channelCount || 0}</span></td>
                <td><Icon name="chevR" size={16} style={{color:'var(--muted-2)'}} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
