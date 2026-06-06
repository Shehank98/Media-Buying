import { useState, useEffect, useMemo } from 'react';
import Icon, { Avatar, RoleBadge } from '../components/Icon';
import api from '../lib/api';

const ROLES = ['SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD', 'PLANNER'];

const ROLE_DESC = {
  SUPER_ADMIN: 'Full access; manages agencies, users & assignments',
  MANAGER: 'Read-only across assigned agencies; can export reports',
  GROUP_HEAD: 'Manages their team & all clients the team handles',
  PLANNER: 'Adds & edits properties on assigned clients only',
};

function generateTempPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  let pw = '';
  for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

export default function AdminPage({ initialTab = 'users' }) {
  const [activeTab, setActiveTab] = useState(initialTab);

  /* ---- data ---- */
  const [agencies, setAgencies] = useState([]);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [allClients, setAllClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  /* ---- agency modal ---- */
  const [showAgencyModal, setShowAgencyModal] = useState(false);
  const [editingAgency, setEditingAgency] = useState(null);
  const [agencyForm, setAgencyForm] = useState({ name: '' });
  const [agencySubmitting, setAgencySubmitting] = useState(false);
  const [agencyError, setAgencyError] = useState('');

  /* ---- user modal ---- */
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userForm, setUserForm] = useState({
    name: '', email: '', password: '', role: 'PLANNER', agencyIds: [], clientIds: [],
  });
  const [userSubmitting, setUserSubmitting] = useState(false);
  const [userError, setUserError] = useState('');
  const [userFieldErrors, setUserFieldErrors] = useState({});

  /* ---- team modal ---- */
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);
  const [teamForm, setTeamForm] = useState({ name: '', agencyId: '', memberIds: [], clientIds: [] });
  const [teamSubmitting, setTeamSubmitting] = useState(false);
  const [teamError, setTeamError] = useState('');

  /* ---- brands ---- */
  const [brands, setBrands] = useState([]);
  const [showBrandModal, setShowBrandModal] = useState(false);
  const [brandForm, setBrandForm] = useState({ clientId: '', name: '' });
  const [brandSubmitting, setBrandSubmitting] = useState(false);
  const [brandError, setBrandError] = useState('');

  /* ---- campaigns ---- */
  const [campaigns, setCampaigns] = useState([]);
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [campaignForm, setCampaignForm] = useState({ brandId: '', name: '' });
  const [campaignSubmitting, setCampaignSubmitting] = useState(false);
  const [campaignError, setCampaignError] = useState('');

  /* ---- delete modal ---- */
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteType, setDeleteType] = useState('');
  const [deleting, setDeleting] = useState(false);

  /* ---- fetch ---- */
  const fetchData = async () => {
    setLoading(true);
    try {
      const [agenciesRes, usersRes, teamsRes, brandsRes, campaignsRes] = await Promise.allSettled([
        api.get('/admin/agencies'),
        api.get('/admin/users'),
        api.get('/admin/teams'),
        api.get('/masterdata/brands'),
        api.get('/masterdata/campaigns'),
      ]);
      if (agenciesRes.status === 'fulfilled') {
        const rawAg = agenciesRes.value.data.agencies || agenciesRes.value.data;
        const agencyData = Array.isArray(rawAg) ? rawAg : [];
        setAgencies(agencyData);
        const clients = agencyData.flatMap(a =>
          (a.clients || []).map(c => ({ ...c, agencyId: a.id, agencyName: a.name }))
        );
        setAllClients(clients);
      }
      if (usersRes.status === 'fulfilled') {
        const rawUsers = usersRes.value.data.users || usersRes.value.data;
        setUsers(Array.isArray(rawUsers) ? rawUsers : []);
      }
      if (teamsRes.status === 'fulfilled') {
        const rawTeams = teamsRes.value.data.teams || teamsRes.value.data;
        setTeams(Array.isArray(rawTeams) ? rawTeams : []);
      }
      if (brandsRes.status === 'fulfilled') {
        const rawBrands = brandsRes.value.data.brands || brandsRes.value.data;
        setBrands(Array.isArray(rawBrands) ? rawBrands : []);
      }
      if (campaignsRes.status === 'fulfilled') {
        const rawCamp = campaignsRes.value.data.campaigns || campaignsRes.value.data;
        setCampaigns(Array.isArray(rawCamp) ? rawCamp : []);
      }
    } catch {
      setError('Failed to load admin data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  /* ---- Agency CRUD ---- */
  const openAddAgency = () => {
    setEditingAgency(null);
    setAgencyForm({ name: '' });
    setAgencyError('');
    setShowAgencyModal(true);
  };
  const openEditAgency = agency => {
    setEditingAgency(agency);
    setAgencyForm({ name: agency.name });
    setAgencyError('');
    setShowAgencyModal(true);
  };
  const handleAgencySubmit = async e => {
    e.preventDefault();
    setAgencyError('');
    if (!agencyForm.name.trim()) { setAgencyError('Agency name is required.'); return; }
    setAgencySubmitting(true);
    try {
      if (editingAgency) await api.put(`/admin/agencies/${editingAgency.id}`, agencyForm);
      else await api.post('/admin/agencies', agencyForm);
      setShowAgencyModal(false);
      await fetchData();
    } catch (err) {
      setAgencyError(err.response?.data?.message || 'Failed to save agency.');
    } finally {
      setAgencySubmitting(false);
    }
  };

  /* ---- User CRUD ---- */
  const openAddUser = () => {
    setEditingUser(null);
    setUserForm({ name: '', email: '', password: '', role: 'PLANNER', agencyIds: [], clientIds: [] });
    setUserError('');
    setUserFieldErrors({});
    setShowUserModal(true);
  };
  const openEditUser = u => {
    setEditingUser(u);
    setUserForm({
      name: u.name,
      email: u.email,
      password: '',
      role: u.role,
      agencyIds: u.agencies?.map(a => a.id) || u.agencyIds || [],
      clientIds: u.clients?.map(c => c.id) || u.clientIds || [],
    });
    setUserError('');
    setUserFieldErrors({});
    setShowUserModal(true);
  };
  const validateUserForm = () => {
    const errs = {};
    if (!userForm.name.trim()) errs.name = 'Name is required';
    if (!editingUser && !userForm.email.trim()) errs.email = 'Email is required';
    if (!editingUser && userForm.email && !/\S+@\S+\.\S+/.test(userForm.email)) errs.email = 'Invalid email address';
    if (!editingUser && !userForm.password.trim()) errs.password = 'Temporary password is required';
    if (!editingUser && userForm.password && userForm.password.length < 8) errs.password = 'Minimum 8 characters';
    setUserFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };
  const handleUserSubmit = async e => {
    e.preventDefault();
    setUserError('');
    if (!validateUserForm()) return;
    setUserSubmitting(true);
    try {
      const payload = { ...userForm };
      if (editingUser) {
        delete payload.email;
        if (!payload.password) delete payload.password;
        await api.put(`/admin/users/${editingUser.id}`, payload);
      } else {
        await api.post('/admin/users', payload);
      }
      setShowUserModal(false);
      await fetchData();
    } catch (err) {
      setUserError(err.response?.data?.message || 'Failed to save user.');
    } finally {
      setUserSubmitting(false);
    }
  };

  /* ---- Team CRUD ---- */
  const openAddTeam = () => {
    setEditingTeam(null);
    setTeamForm({ name: '', agencyId: '', memberIds: [], clientIds: [] });
    setTeamError('');
    setShowTeamModal(true);
  };
  const openEditTeam = team => {
    setEditingTeam(team);
    setTeamForm({
      name: team.name,
      agencyId: team.agencyId || '',
      memberIds: team.members?.map(m => m.id) || team.memberIds || [],
      clientIds: team.clients?.map(c => c.id) || team.clientIds || [],
    });
    setTeamError('');
    setShowTeamModal(true);
  };
  const handleTeamSubmit = async e => {
    e.preventDefault();
    setTeamError('');
    if (!teamForm.name.trim()) { setTeamError('Team name is required.'); return; }
    if (!teamForm.agencyId) { setTeamError('Agency is required.'); return; }
    setTeamSubmitting(true);
    try {
      if (editingTeam) await api.put(`/admin/teams/${editingTeam.id}`, teamForm);
      else await api.post('/admin/teams', teamForm);
      setShowTeamModal(false);
      await fetchData();
    } catch (err) {
      setTeamError(err.response?.data?.message || 'Failed to save team.');
    } finally {
      setTeamSubmitting(false);
    }
  };

  /* ---- Brand CRUD ---- */
  const openAddBrand = () => { setBrandForm({ clientId: '', name: '' }); setBrandError(''); setShowBrandModal(true); };
  const handleBrandSubmit = async e => {
    e.preventDefault();
    setBrandError('');
    if (!brandForm.name.trim()) { setBrandError('Name is required.'); return; }
    if (!brandForm.clientId) { setBrandError('Client is required.'); return; }
    setBrandSubmitting(true);
    try {
      await api.post('/masterdata/brands', brandForm);
      setShowBrandModal(false);
      await fetchData();
    } catch (err) {
      setBrandError(err.response?.data?.error || 'Failed to create brand.');
    } finally { setBrandSubmitting(false); }
  };
  const handleToggleBrand = async b => {
    try {
      await api.patch(`/masterdata/brands/${b.id}/toggle`);
      await fetchData();
    } catch (err) { setError(err.response?.data?.error || 'Failed to toggle brand.'); }
  };

  /* ---- Campaign CRUD ---- */
  const openAddCampaign = () => { setCampaignForm({ brandId: '', name: '' }); setCampaignError(''); setShowCampaignModal(true); };
  const handleCampaignSubmit = async e => {
    e.preventDefault();
    setCampaignError('');
    if (!campaignForm.name.trim()) { setCampaignError('Name is required.'); return; }
    if (!campaignForm.brandId) { setCampaignError('Brand is required.'); return; }
    setCampaignSubmitting(true);
    try {
      await api.post('/masterdata/campaigns', campaignForm);
      setShowCampaignModal(false);
      await fetchData();
    } catch (err) {
      setCampaignError(err.response?.data?.error || 'Failed to create campaign.');
    } finally { setCampaignSubmitting(false); }
  };
  const handleToggleCampaign = async c => {
    try {
      await api.patch(`/masterdata/campaigns/${c.id}/toggle`);
      await fetchData();
    } catch (err) { setError(err.response?.data?.error || 'Failed to toggle campaign.'); }
  };

  /* ---- Delete ---- */
  const confirmDelete = (item, type) => {
    setDeleteTarget(item);
    setDeleteType(type);
    setShowDeleteModal(true);
  };
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/admin/${deleteType}/${deleteTarget.id}`);
      setShowDeleteModal(false);
      setDeleteTarget(null);
      await fetchData();
    } catch (err) {
      setError(err.response?.data?.message || `Failed to delete ${deleteType.slice(0, -1)}.`);
    } finally {
      setDeleting(false);
    }
  };

  /* ---- helpers ---- */
  const toggleArrayItem = (arr, id) =>
    arr.includes(id) ? arr.filter(i => i !== id) : [...arr, id];

  const filteredUsers = useMemo(() =>
    users.filter(u =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
    ), [users, search]);

  const filteredAgencies = useMemo(() =>
    agencies.filter(a => a.name.toLowerCase().includes(search.toLowerCase())),
    [agencies, search]);

  const filteredTeams = useMemo(() =>
    teams.filter(t => t.name.toLowerCase().includes(search.toLowerCase())),
    [teams, search]);

  const filteredBrands = useMemo(() =>
    brands.filter(b => b.name.toLowerCase().includes(search.toLowerCase()) || b.client?.name?.toLowerCase().includes(search.toLowerCase())),
    [brands, search]);

  const filteredCampaigns = useMemo(() =>
    campaigns.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.brand?.name?.toLowerCase().includes(search.toLowerCase())),
    [campaigns, search]);

  const hideClientSelect = userForm.role === 'SUPER_ADMIN' || userForm.role === 'MANAGER';

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--muted)' }}>
        Loading...
      </div>
    );
  }

  const tabs = [
    { key: 'users', label: 'Users', count: users.length },
    { key: 'agencies', label: 'Agencies', count: agencies.length },
    { key: 'teams', label: 'Teams', count: teams.length },
    { key: 'brands', label: 'Brands', count: brands.length },
    { key: 'campaigns', label: 'Campaigns', count: campaigns.length },
  ];

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="page-head">
        <div>
          <h1 className="page-title">User management</h1>
          <p className="page-sub">Super Admin &middot; {users.length} users across agencies</p>
        </div>
        <button className="btn btn-primary" onClick={openAddUser}>
          <Icon name="plus" size={16} /> Create user
        </button>
      </div>

      {error && (
        <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>
          {error}
          <button onClick={() => setError('')} style={{ marginLeft: 8, fontWeight: 600, textDecoration: 'underline', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        {tabs.map(tab => (
          <button
            key={tab.key}
            className={'tab' + (activeTab === tab.key ? ' active' : '')}
            onClick={() => { setActiveTab(tab.key); setSearch(''); }}
          >
            {tab.label}
            <span className="tcount">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: '1 1 300px', maxWidth: 320 }}>
          <Icon name="search" size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
          <input
            className="input"
            type="text"
            placeholder={`Search ${activeTab}...`}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 32 }}
          />
        </div>
        {activeTab === 'agencies' && (
          <button className="btn btn-primary" onClick={openAddAgency} style={{ marginLeft: 'auto' }}>
            <Icon name="plus" size={16} /> Add Agency
          </button>
        )}
        {activeTab === 'teams' && (
          <button className="btn btn-primary" onClick={openAddTeam} style={{ marginLeft: 'auto' }}>
            <Icon name="plus" size={16} /> Add Team
          </button>
        )}
        {activeTab === 'brands' && (
          <button className="btn btn-primary" onClick={openAddBrand} style={{ marginLeft: 'auto' }}>
            <Icon name="plus" size={16} /> Add Brand
          </button>
        )}
        {activeTab === 'campaigns' && (
          <button className="btn btn-primary" onClick={openAddCampaign} style={{ marginLeft: 'auto' }}>
            <Icon name="plus" size={16} /> Add Campaign
          </button>
        )}
      </div>

      {/* ============ USERS TABLE ============ */}
      {activeTab === 'users' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Agencies</th>
                <th>Clients</th>
                <th>Last login</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map(u => {
                const isNew = u.createdAt && (Date.now() - new Date(u.createdAt).getTime()) < 7 * 24 * 60 * 60 * 1000;
                return (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ position: 'relative', flex: 'none' }}>
                          <Avatar name={u.name} size={32} />
                          {u.isOnline && (
                            <span style={{
                              position: 'absolute', bottom: -1, right: -1,
                              width: 10, height: 10, borderRadius: '50%',
                              background: 'var(--green-600)', border: '2px solid #fff',
                            }} />
                          )}
                        </div>
                        <span className="strong">{u.name}</span>
                        {isNew && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, color: 'var(--green-600)',
                            background: 'var(--green-100)', borderRadius: 4, padding: '2px 6px',
                            letterSpacing: 0.5, lineHeight: 1,
                          }}>NEW</span>
                        )}
                      </div>
                    </td>
                    <td className="mono" style={{ color: 'var(--muted)' }}>{u.email}</td>
                    <td><RoleBadge role={u.role} /></td>
                    <td>{u.agencies?.map(a => a.name).join(', ') || '-'}</td>
                    <td>{u.clients?.map(c => c.name).join(', ') || '-'}</td>
                    <td style={{ color: 'var(--muted)' }}>
                      {u.lastLoginAt
                        ? new Date(u.lastLoginAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                        : '-'}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="act-btn" onClick={() => openEditUser(u)} title="Edit user">
                          <Icon name="edit" size={15} />
                        </button>
                        <button className="act-btn" onClick={() => confirmDelete(u, 'users')} title="Delete user" style={{ color: 'var(--red-600,#dc2626)' }}>
                          <Icon name="x" size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredUsers.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>
              <Icon name="search" size={28} style={{ opacity: 0.4, marginBottom: 6 }} />
              <p>No users found</p>
            </div>
          )}
        </div>
      )}

      {/* ============ AGENCIES TABLE ============ */}
      {activeTab === 'agencies' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Created</th>
                <th>Clients</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAgencies.map(agency => (
                <tr key={agency.id}>
                  <td className="strong">{agency.name}</td>
                  <td style={{ color: 'var(--muted)' }}>
                    {agency.createdAt
                      ? new Date(agency.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                      : '-'}
                  </td>
                  <td>{agency.clientCount || agency._count?.clients || agency.clients?.length || 0}</td>
                  <td>
                    <div className="row-actions">
                      <button className="act-btn" onClick={() => openEditAgency(agency)} title="Edit">
                        <Icon name="edit" size={15} />
                      </button>
                      <button className="act-btn" onClick={() => confirmDelete(agency, 'agencies')} title="Delete">
                        <Icon name="x" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ============ TEAMS TABLE ============ */}
      {activeTab === 'teams' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Team Name</th>
                <th>Agency</th>
                <th>Members</th>
                <th>Clients</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTeams.map(team => (
                <tr key={team.id}>
                  <td className="strong">{team.name}</td>
                  <td>{team.agency?.name || team.agencyName || '-'}</td>
                  <td>{team.memberCount || team._count?.members || team.members?.length || 0}</td>
                  <td>{team.clientCount || team._count?.clients || team.clients?.length || 0}</td>
                  <td>
                    <div className="row-actions">
                      <button className="act-btn" onClick={() => openEditTeam(team)} title="Edit">
                        <Icon name="edit" size={15} />
                      </button>
                      <button className="act-btn" onClick={() => confirmDelete(team, 'teams')} title="Delete">
                        <Icon name="x" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ============ BRANDS TABLE ============ */}
      {activeTab === 'brands' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Brand</th>
                <th>Client</th>
                <th>Campaigns</th>
                <th>Schedule Logs</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredBrands.map(b => (
                <tr key={b.id}>
                  <td className="strong">{b.name}</td>
                  <td style={{ color: 'var(--muted)' }}>{b.client?.name || '-'}</td>
                  <td>{b._count?.campaigns || 0}</td>
                  <td>{b._count?.scheduleLogs || 0}</td>
                  <td>
                    <span style={{
                      background: b.active !== false ? 'var(--green-100,#dcfce7)' : 'var(--red-50,#fef2f2)',
                      color: b.active !== false ? 'var(--green-600)' : 'var(--red-600)',
                      borderRadius: 5, padding: '2px 8px', fontSize: 12, fontWeight: 600,
                    }}>{b.active !== false ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="act-btn" onClick={() => handleToggleBrand(b)} title={b.active !== false ? 'Deactivate' : 'Reactivate'} style={{ color: b.active !== false ? 'var(--red-600)' : 'var(--green-600)' }}>
                        <Icon name={b.active !== false ? 'x' : 'check'} size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredBrands.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>No brands found</div>
          )}
        </div>
      )}

      {/* ============ CAMPAIGNS TABLE ============ */}
      {activeTab === 'campaigns' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Brand</th>
                <th>Client</th>
                <th>Schedule Logs</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCampaigns.map(c => (
                <tr key={c.id}>
                  <td className="strong">{c.name}</td>
                  <td style={{ color: 'var(--muted)' }}>{c.brand?.name || '-'}</td>
                  <td style={{ color: 'var(--muted)' }}>{c.client?.name || '-'}</td>
                  <td>{c._count?.scheduleLogs || 0}</td>
                  <td>
                    <span style={{
                      background: c.active !== false ? 'var(--green-100,#dcfce7)' : 'var(--red-50,#fef2f2)',
                      color: c.active !== false ? 'var(--green-600)' : 'var(--red-600)',
                      borderRadius: 5, padding: '2px 8px', fontSize: 12, fontWeight: 600,
                    }}>{c.active !== false ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="act-btn" onClick={() => handleToggleCampaign(c)} title={c.active !== false ? 'Deactivate' : 'Reactivate'} style={{ color: c.active !== false ? 'var(--red-600)' : 'var(--green-600)' }}>
                        <Icon name={c.active !== false ? 'x' : 'check'} size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredCampaigns.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>No campaigns found</div>
          )}
        </div>
      )}

      {/* ============ USER MODAL ============ */}
      {showUserModal && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setShowUserModal(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
            <div className="modal-head">
              <h2>{editingUser ? 'Edit User' : 'Create user'}</h2>
              <button className="act-btn" onClick={() => setShowUserModal(false)}><Icon name="x" size={18} /></button>
            </div>
            <form onSubmit={handleUserSubmit}>
              <div className="modal-body">
                {userError && (
                  <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>
                    {userError}
                  </div>
                )}
                <div className="field-grid2">
                  <div className="field">
                    <label className="field-label">Full name <span className="req">*</span></label>
                    <input className={'input' + (userFieldErrors.name ? ' err' : '')} type="text" value={userForm.name} onChange={e => setUserForm(p => ({ ...p, name: e.target.value }))} placeholder="Full name" />
                    {userFieldErrors.name && <span className="field-err">{userFieldErrors.name}</span>}
                  </div>
                  <div className="field">
                    <label className="field-label">Email {!editingUser && <span className="req">*</span>}</label>
                    <input className={'input' + (userFieldErrors.email ? ' err' : '')} type="email" disabled={!!editingUser} value={userForm.email} onChange={e => setUserForm(p => ({ ...p, email: e.target.value }))} placeholder="user@example.com" />
                    {userFieldErrors.email && <span className="field-err">{userFieldErrors.email}</span>}
                  </div>
                </div>
                {!editingUser && (
                  <div className="field">
                    <label className="field-label">Temporary password <span className="req">*</span></label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input className={'input' + (userFieldErrors.password ? ' err' : '')} type="text" value={userForm.password} onChange={e => setUserForm(p => ({ ...p, password: e.target.value }))} placeholder="Temporary password" style={{ flex: 1 }} />
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUserForm(p => ({ ...p, password: generateTempPassword() }))}>Generate</button>
                    </div>
                    {userFieldErrors.password && <span className="field-err">{userFieldErrors.password}</span>}
                    <span className="field-hint">User will be asked to change this on first login</span>
                  </div>
                )}
                <div className="field">
                  <label className="field-label">Role <span className="req">*</span></label>
                  <div className="role-grid">
                    {ROLES.map(role => (
                      <label key={role} className={'role-opt' + (userForm.role === role ? ' active' : '')} onClick={() => setUserForm(p => ({ ...p, role }))}>
                        <input type="radio" name="role" value={role} checked={userForm.role === role} onChange={() => setUserForm(p => ({ ...p, role }))} style={{ display: 'none' }} />
                        <RoleBadge role={role} small />
                        <span style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{ROLE_DESC[role]}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label className="field-label">Agencies</label>
                  <div className="chips">
                    {agencies.map(a => (
                      <button key={a.id} type="button" className={'chip' + (userForm.agencyIds.includes(a.id) ? ' active' : '')} onClick={() => setUserForm(p => ({ ...p, agencyIds: toggleArrayItem(p.agencyIds, a.id) }))}>
                        {a.name}
                        {userForm.agencyIds.includes(a.id) ? <Icon name="x" size={12} /> : <Icon name="plus" size={12} />}
                      </button>
                    ))}
                    {agencies.length === 0 && <span style={{ fontSize: 13, color: 'var(--muted)' }}>No agencies available</span>}
                  </div>
                </div>
                {!hideClientSelect && (
                  <div className="field">
                    <label className="field-label">Clients</label>
                    <div className="chips">
                      {allClients.map(c => (
                        <button key={c.id} type="button" className={'chip' + (userForm.clientIds.includes(c.id) ? ' active' : '')} onClick={() => setUserForm(p => ({ ...p, clientIds: toggleArrayItem(p.clientIds, c.id) }))}>
                          {c.name}
                          {c.agencyName && <span style={{ opacity: 0.6, marginLeft: 4, fontSize: 11 }}>({c.agencyName})</span>}
                          {userForm.clientIds.includes(c.id) ? <Icon name="x" size={12} /> : <Icon name="plus" size={12} />}
                        </button>
                      ))}
                      {allClients.length === 0 && <span style={{ fontSize: 13, color: 'var(--muted)' }}>No clients available</span>}
                    </div>
                  </div>
                )}
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setShowUserModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={userSubmitting}>{userSubmitting ? 'Saving...' : editingUser ? 'Save changes' : 'Create user'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ AGENCY MODAL ============ */}
      {showAgencyModal && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setShowAgencyModal(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{editingAgency ? 'Edit Agency' : 'Add Agency'}</h2>
              <button className="act-btn" onClick={() => setShowAgencyModal(false)}><Icon name="x" size={18} /></button>
            </div>
            <form onSubmit={handleAgencySubmit}>
              <div className="modal-body">
                {agencyError && (
                  <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>{agencyError}</div>
                )}
                <div className="field">
                  <label className="field-label">Agency Name <span className="req">*</span></label>
                  <input className="input" type="text" value={agencyForm.name} onChange={e => setAgencyForm(p => ({ ...p, name: e.target.value }))} placeholder="Enter agency name" />
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setShowAgencyModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={agencySubmitting}>{agencySubmitting ? 'Saving...' : editingAgency ? 'Save Changes' : 'Add Agency'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ TEAM MODAL ============ */}
      {showTeamModal && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setShowTeamModal(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
            <div className="modal-head">
              <h2>{editingTeam ? 'Edit Team' : 'Add Team'}</h2>
              <button className="act-btn" onClick={() => setShowTeamModal(false)}><Icon name="x" size={18} /></button>
            </div>
            <form onSubmit={handleTeamSubmit}>
              <div className="modal-body">
                {teamError && (
                  <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>{teamError}</div>
                )}
                <div className="field-grid2">
                  <div className="field">
                    <label className="field-label">Team Name <span className="req">*</span></label>
                    <input className="input" type="text" value={teamForm.name} onChange={e => setTeamForm(p => ({ ...p, name: e.target.value }))} placeholder="Team name" />
                  </div>
                  <div className="field">
                    <label className="field-label">Agency <span className="req">*</span></label>
                    <select className="select" value={teamForm.agencyId} onChange={e => setTeamForm(p => ({ ...p, agencyId: e.target.value }))}>
                      <option value="">Select agency...</option>
                      {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label className="field-label">Members</label>
                  <div className="chips">
                    {users.map(u => (
                      <button key={u.id} type="button" className={'chip' + (teamForm.memberIds.includes(u.id) ? ' active' : '')} onClick={() => setTeamForm(p => ({ ...p, memberIds: toggleArrayItem(p.memberIds, u.id) }))}>
                        {u.name}
                        {teamForm.memberIds.includes(u.id) ? <Icon name="x" size={12} /> : <Icon name="plus" size={12} />}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label className="field-label">Clients</label>
                  <div className="chips">
                    {allClients
                      .filter(c => !teamForm.agencyId || c.agencyId === parseInt(teamForm.agencyId))
                      .map(c => (
                        <button key={c.id} type="button" className={'chip' + (teamForm.clientIds.includes(c.id) ? ' active' : '')} onClick={() => setTeamForm(p => ({ ...p, clientIds: toggleArrayItem(p.clientIds, c.id) }))}>
                          {c.name}
                          {teamForm.clientIds.includes(c.id) ? <Icon name="x" size={12} /> : <Icon name="plus" size={12} />}
                        </button>
                      ))}
                  </div>
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setShowTeamModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={teamSubmitting}>{teamSubmitting ? 'Saving...' : editingTeam ? 'Save Changes' : 'Add Team'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ BRAND MODAL ============ */}
      {showBrandModal && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setShowBrandModal(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Add Brand</h2>
              <button className="act-btn" onClick={() => setShowBrandModal(false)}><Icon name="x" size={18} /></button>
            </div>
            <form onSubmit={handleBrandSubmit}>
              <div className="modal-body">
                {brandError && (
                  <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700)', marginBottom: 16 }}>{brandError}</div>
                )}
                <div className="field">
                  <label className="field-label">Client <span className="req">*</span></label>
                  <select className="select" value={brandForm.clientId} onChange={e => setBrandForm(p => ({ ...p, clientId: e.target.value }))}>
                    <option value="">Select client...</option>
                    {allClients.map(c => <option key={c.id} value={c.id}>{c.name} ({c.agencyName})</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Brand Name <span className="req">*</span></label>
                  <input className="input" value={brandForm.name} onChange={e => setBrandForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Maggi" />
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setShowBrandModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={brandSubmitting}>{brandSubmitting ? 'Saving...' : 'Add Brand'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ CAMPAIGN MODAL ============ */}
      {showCampaignModal && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setShowCampaignModal(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Add Campaign</h2>
              <button className="act-btn" onClick={() => setShowCampaignModal(false)}><Icon name="x" size={18} /></button>
            </div>
            <form onSubmit={handleCampaignSubmit}>
              <div className="modal-body">
                {campaignError && (
                  <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700)', marginBottom: 16 }}>{campaignError}</div>
                )}
                <div className="field">
                  <label className="field-label">Brand <span className="req">*</span></label>
                  <select className="select" value={campaignForm.brandId} onChange={e => setCampaignForm(p => ({ ...p, brandId: e.target.value }))}>
                    <option value="">Select brand...</option>
                    {brands.filter(b => b.active !== false).map(b => <option key={b.id} value={b.id}>{b.name} ({b.client?.name})</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Campaign Name <span className="req">*</span></label>
                  <input className="input" value={campaignForm.name} onChange={e => setCampaignForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Summer Campaign 2026" />
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setShowCampaignModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={campaignSubmitting}>{campaignSubmitting ? 'Saving...' : 'Add Campaign'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ DELETE MODAL ============ */}
      {showDeleteModal && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) { setShowDeleteModal(false); setDeleteTarget(null); } }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Delete {deleteType.slice(0, -1)}</h2>
              <button className="act-btn" onClick={() => { setShowDeleteModal(false); setDeleteTarget(null); }}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--muted)', marginBottom: 0 }}>
                Are you sure you want to delete{' '}
                <strong style={{ color: 'var(--ink)' }}>{deleteTarget?.name || deleteTarget?.email}</strong>?
                This action cannot be undone.
              </p>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => { setShowDeleteModal(false); setDeleteTarget(null); }}>Cancel</button>
              <button type="button" className="btn" style={{ background: 'var(--red-600,#dc2626)', color: '#fff' }} onClick={handleDelete} disabled={deleting}>{deleting ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
