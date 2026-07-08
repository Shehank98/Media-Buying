import { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import Icon, { Avatar, RoleBadge } from '../components/Icon';
import api from '../lib/api';
import OrbitLoader from '../components/OrbitLoader';
import { TOGGLEABLE_PAGES } from '../lib/permissions';

const ROLES = ['SUPER_ADMIN', 'ADMIN_LEVEL_1', 'GROUP_HEAD', 'PLANNER'];

const MEDIUMS = ['TV', 'RADIO', 'PRINT', 'DIGITAL', 'CINEMA', 'OOH'];

const ROLE_DESC = {
  SUPER_ADMIN: 'Full access; manages agencies, users & assignments',
  ADMIN_LEVEL_1: 'Read-only across assigned agencies; can export reports',
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
  const [mediaGroups, setMediaGroups] = useState([]);
  const [channelMasters, setChannelMasters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  /* ---- agency modal ---- */
  const [showAgencyModal, setShowAgencyModal] = useState(false);
  const [editingAgency, setEditingAgency] = useState(null);
  const [agencyForm, setAgencyForm] = useState({ name: '' });
  const [agencySubmitting, setAgencySubmitting] = useState(false);
  const [agencyError, setAgencyError] = useState('');

  /* ---- client modal ---- */
  const [showClientModal, setShowClientModal] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [clientForm, setClientForm] = useState({ name: '', agencyId: '', commissionType: '', commissionValue: '' });
  const [clientSubmitting, setClientSubmitting] = useState(false);
  const [clientError, setClientError] = useState('');
  // Set when a commission change on an existing client needs a "past records?" choice.
  const [scopePrompt, setScopePrompt] = useState(null); // { clientId, clientName }

  /* ---- user modal ---- */
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userForm, setUserForm] = useState({
    name: '', email: '', password: '', role: 'PLANNER', agencyIds: [], clientIds: [],
    pageAccess: [], canExport: true, readOnly: false,
  });
  const [userSubmitting, setUserSubmitting] = useState(false);
  const [userError, setUserError] = useState('');
  const [userFieldErrors, setUserFieldErrors] = useState({});
  const [userClientSearch, setUserClientSearch] = useState('');

  /* ---- team modal ---- */
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);
  const [teamForm, setTeamForm] = useState({ name: '', agencyId: '', headUserId: '', memberIds: [], clientIds: [] });
  const [teamSubmitting, setTeamSubmitting] = useState(false);
  const [teamError, setTeamError] = useState('');

  /* ---- assign accounts to heads (quick-assign section) ---- */
  const [accountAssignError, setAccountAssignError] = useState('');
  const [assigningClientKey, setAssigningClientKey] = useState(null);

  /* ---- channel master modal ---- */
  const [showChannelModal, setShowChannelModal] = useState(false);
  const [editingChannel, setEditingChannel] = useState(null);
  const [channelForm, setChannelForm] = useState({ name: '', medium: 'TV', mediaGroupId: '', aliases: '' });
  const [channelSubmitting, setChannelSubmitting] = useState(false);
  const [channelError, setChannelError] = useState('');

  /* ---- merge channel master modal ---- */
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeSource, setMergeSource] = useState(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergeSubmitting, setMergeSubmitting] = useState(false);
  const [mergeError, setMergeError] = useState('');

  /* ---- merge client modal ---- */
  const [showClientMerge, setShowClientMerge] = useState(false);
  const [clientMergeSource, setClientMergeSource] = useState(null);
  const [clientMergeTargetId, setClientMergeTargetId] = useState('');
  const [clientMergeSubmitting, setClientMergeSubmitting] = useState(false);
  const [clientMergeError, setClientMergeError] = useState('');

  /* ---- media group modal ---- */
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);
  const [groupForm, setGroupForm] = useState({ name: '' });
  const [groupSubmitting, setGroupSubmitting] = useState(false);
  const [groupError, setGroupError] = useState('');

  /* ---- property category modal ---- */
  const [propertyCategories, setPropertyCategories] = useState([]);
  const [showCatModal, setShowCatModal] = useState(false);
  const [editingCat, setEditingCat] = useState(null);
  const [catForm, setCatForm] = useState({ name: '' });
  const [catSubmitting, setCatSubmitting] = useState(false);
  const [catError, setCatError] = useState('');

  /* ---- annual targets ---- */
  const [annualTargets, setAnnualTargets] = useState([]);
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [editingTarget, setEditingTarget] = useState(null);
  const [targetForm, setTargetForm] = useState({ year: '', totalTargetMillions: '', remoteMonth: '' });
  const [targetSubmitting, setTargetSubmitting] = useState(false);
  const [targetError, setTargetError] = useState('');

  /* ---- forecasting requests ---- */
  const [clientRequests, setClientRequests] = useState([]);
  const [channelRequests, setChannelRequests] = useState([]);

  /* ---- group revenue contribution (per group head, per month) ---- */
  const now = new Date();
  const [grYear, setGrYear] = useState(now.getFullYear());
  const [grMonth, setGrMonth] = useState(now.getMonth() + 1); // 1-12
  const [grHeads, setGrHeads] = useState([]);          // [{ headUserId, headName, amount }]
  const [grAmounts, setGrAmounts] = useState({});      // { headUserId: '12345' }
  const [grLoading, setGrLoading] = useState(false);
  const [grSaving, setGrSaving] = useState(false);
  const [grSavedAt, setGrSavedAt] = useState(null);
  const [grInit, setGrInit] = useState(false); // pinned form to the dashboard's revenue month yet?

  /* ---- database backup (Google Drive) ---- */
  const [backup, setBackup] = useState(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupMsg, setBackupMsg] = useState('');
  const fetchBackup = async () => {
    setBackupLoading(true);
    try {
      const { data } = await api.get('/admin/backup/status');
      setBackup(data);
    } catch { setBackup(null); }
    finally { setBackupLoading(false); }
  };
  useEffect(() => {
    if (activeTab === 'backup') fetchBackup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);
  const runBackupNow = async () => {
    setBackupRunning(true); setBackupMsg('');
    try {
      const { data } = await api.post('/admin/backup/run');
      setBackupMsg(`Backup uploaded: ${data.result?.fileName || 'done'}`);
      await fetchBackup();
    } catch (err) {
      setBackupMsg(err.response?.data?.error || 'Backup failed.');
    } finally { setBackupRunning(false); }
  };

  /* ---- send notification (announcement) ---- */
  const [notifyTitle, setNotifyTitle] = useState('');
  const [notifyMessage, setNotifyMessage] = useState('');
  const [notifyLink, setNotifyLink] = useState('');
  const [notifyRoles, setNotifyRoles] = useState([]); // ['GROUP_HEAD', ...]
  const [notifyUserIds, setNotifyUserIds] = useState([]);
  const [notifyUserSearch, setNotifyUserSearch] = useState('');
  const [notifySending, setNotifySending] = useState(false);
  const [notifyResult, setNotifyResult] = useState(null); // { ok, text }
  const toggleNotifyRole = (r) => setNotifyRoles((s) => (s.includes(r) ? s.filter((x) => x !== r) : [...s, r]));
  const toggleNotifyUser = (id) => setNotifyUserIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const sendNotification = async () => {
    setNotifySending(true); setNotifyResult(null);
    try {
      const { data } = await api.post('/notifications/broadcast', {
        title: notifyTitle, message: notifyMessage, link: notifyLink || undefined,
        roles: notifyRoles, userIds: notifyUserIds,
      });
      setNotifyResult({ ok: true, text: data.message || 'Sent.' });
      setNotifyTitle(''); setNotifyMessage(''); setNotifyLink(''); setNotifyRoles([]); setNotifyUserIds([]);
    } catch (err) {
      setNotifyResult({ ok: false, text: err.response?.data?.error || 'Failed to send.' });
    } finally { setNotifySending(false); }
  };

  /* ---- delete modal ---- */
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteType, setDeleteType] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  /* ---- fetch ---- */
  const fetchData = async () => {
    setLoading(true);
    try {
      const [agenciesRes, usersRes, teamsRes, groupsRes, channelsRes, catsRes, targetsRes, clientReqRes, channelReqRes] = await Promise.allSettled([
        api.get('/admin/agencies'),
        api.get('/admin/users'),
        api.get('/admin/teams'),
        api.get('/masterdata/media-groups'),
        api.get('/masterdata/channel-masters', { params: { includeInactive: 'true' } }),
        api.get('/masterdata/property-categories', { params: { includeInactive: 'true' } }),
        api.get('/admin/annual-targets'),
        api.get('/admin/client-requests'),
        api.get('/admin/channel-requests'),
      ]);
      if (targetsRes.status === 'fulfilled') {
        setAnnualTargets(Array.isArray(targetsRes.value.data) ? targetsRes.value.data : []);
      }
      if (clientReqRes.status === 'fulfilled') setClientRequests(Array.isArray(clientReqRes.value.data) ? clientReqRes.value.data : []);
      if (channelReqRes.status === 'fulfilled') setChannelRequests(Array.isArray(channelReqRes.value.data) ? channelReqRes.value.data : []);
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
      if (groupsRes.status === 'fulfilled') {
        const rawGroups = groupsRes.value.data.mediaGroups || groupsRes.value.data;
        setMediaGroups(Array.isArray(rawGroups) ? rawGroups : []);
      }
      if (channelsRes.status === 'fulfilled') {
        const rawCh = channelsRes.value.data.channelMasters || channelsRes.value.data;
        setChannelMasters(Array.isArray(rawCh) ? rawCh : []);
      }
      if (catsRes.status === 'fulfilled') {
        const rawCats = catsRes.value.data.categories || catsRes.value.data;
        setPropertyCategories(Array.isArray(rawCats) ? rawCats : []);
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
      setAgencyError(err.response?.data?.error || err.response?.data?.message || 'Failed to save agency.');
    } finally {
      setAgencySubmitting(false);
    }
  };

  /* ---- Client CRUD ---- */
  const openAddClient = () => {
    setEditingClient(null);
    setClientForm({ name: '', agencyId: agencies[0]?.id ? String(agencies[0].id) : '', commissionType: '', commissionValue: '' });
    setClientError('');
    setShowClientModal(true);
  };
  const openEditClient = c => {
    setEditingClient(c);
    setClientForm({
      name: c.name,
      agencyId: String(c.agencyId || ''),
      commissionType: c.commissionType || '',
      commissionValue: c.commissionValue == null ? '' : String(c.commissionValue),
    });
    setClientError('');
    setShowClientModal(true);
  };
  const handleClientSubmit = async e => {
    e.preventDefault();
    setClientError('');
    if (!clientForm.name.trim()) { setClientError('Client name is required.'); return; }
    if (!clientForm.agencyId) { setClientError('Please select an agency.'); return; }
    if (clientForm.commissionType && (clientForm.commissionValue === '' || Number.isNaN(parseFloat(clientForm.commissionValue)))) {
      setClientError('Enter a value for the selected commission/AOR, or clear the type.'); return;
    }
    setClientSubmitting(true);
    try {
      let clientId = editingClient?.id;
      if (editingClient) {
        await api.put(`/clients/${editingClient.id}`, { name: clientForm.name.trim(), agencyId: parseInt(clientForm.agencyId) });
      } else {
        const res = await api.post(`/agencies/${clientForm.agencyId}/clients`, { name: clientForm.name.trim() });
        clientId = res.data?.client?.id ?? res.data?.id;
      }
      if (!clientId) { setShowClientModal(false); await fetchData(); return; }

      // Did the commission change vs what the client already had?
      const origType = editingClient?.commissionType || '';
      const origVal = editingClient?.commissionValue == null ? '' : String(editingClient.commissionValue);
      const newType = clientForm.commissionType || '';
      const newVal = clientForm.commissionType ? String(clientForm.commissionValue) : '';
      const commissionChanged = newType !== origType || newVal !== origVal;

      if (editingClient && newType && commissionChanged) {
        // Existing client + a (changed) commission → ask how it applies to past
        // records. Name/agency are already saved; the commission is applied on choice.
        setShowClientModal(false);
        setScopePrompt({ clientId, clientName: clientForm.name.trim() });
        setClientSubmitting(false);
        return;
      }

      // New client, cleared commission, or unchanged: save directly (no past
      // records to reconcile, so scope is moot).
      await applyCommission(clientId, 'all');
      setShowClientModal(false);
      await fetchData();
    } catch (err) {
      setClientError(err.response?.data?.error || err.response?.data?.message || 'Failed to save client.');
    } finally {
      setClientSubmitting(false);
    }
  };
  const applyCommission = (clientId, scope) => api.put(`/admin/clients/${clientId}/commission`, {
    commissionType: clientForm.commissionType || null,
    commissionValue: clientForm.commissionType ? clientForm.commissionValue : null,
    scope,
  });
  const chooseScope = async (scope) => {
    if (!scopePrompt) return;
    setClientSubmitting(true);
    setClientError('');
    try {
      await applyCommission(scopePrompt.clientId, scope);
      setScopePrompt(null);
      await fetchData();
    } catch (err) {
      setClientError(err.response?.data?.error || 'Failed to update commission.');
    } finally {
      setClientSubmitting(false);
    }
  };
  const cancelScope = async () => { setScopePrompt(null); setClientError(''); await fetchData(); };
  const toggleClient = async c => {
    try {
      await api.put(`/admin/clients/${c.id}/toggle`);
      await fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update client status.');
    }
  };
  const reviewRequest = async (kind, r, status) => {
    try {
      const body = { status };
      if (kind === 'client' && status === 'approved' && !r.agencyId) {
        const aId = window.prompt('Agency ID to create this client under (see Agencies tab):');
        if (!aId) return;
        body.agencyId = parseInt(aId);
      }
      await api.put(`/admin/${kind === 'client' ? 'client-requests' : 'channel-requests'}/${r.id}`, body);
      await fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to review request.');
    }
  };

  /* ---- User CRUD ---- */
  const openAddUser = () => {
    setEditingUser(null);
    setUserForm({ name: '', email: '', password: '', role: 'PLANNER', agencyIds: [], clientIds: [], pageAccess: [], canExport: true, readOnly: false });
    setUserError('');
    setUserFieldErrors({});
    setUserClientSearch('');
    setShowUserModal(true);
  };
  const openEditUser = u => {
    setEditingUser(u);
    setUserClientSearch('');
    setUserForm({
      name: u.name,
      email: u.email,
      password: '',
      role: u.role,
      agencyIds: u.agencies?.map(a => a.id) || u.agencyIds || [],
      clientIds: u.clients?.map(c => c.id) || u.clientIds || [],
      pageAccess: Array.isArray(u.pageAccess) ? u.pageAccess : [],
      canExport: u.canExport !== false,
      readOnly: !!u.readOnly,
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
      setUserError(err.response?.data?.error || err.response?.data?.message || 'Failed to save user.');
    } finally {
      setUserSubmitting(false);
    }
  };

  /* ---- Team CRUD ---- */
  const openAddTeam = () => {
    setEditingTeam(null);
    setTeamForm({ name: '', agencyId: '', headUserId: '', memberIds: [], clientIds: [] });
    setTeamError('');
    setShowTeamModal(true);
  };
  const openEditTeam = team => {
    setEditingTeam(team);
    setTeamForm({
      name: team.name,
      agencyId: team.agencyId || '',
      headUserId: team.headUserId || team.head?.id || '',
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
      setTeamError(err.response?.data?.error || err.response?.data?.message || 'Failed to save team.');
    } finally {
      setTeamSubmitting(false);
    }
  };

  /* ---- Assign accounts to heads (quick-assign chip, instant save) ---- */
  const toggleAccountForTeam = async (team, clientId) => {
    setAccountAssignError('');
    const currentIds = team.clients?.map(c => c.id) || [];
    const newIds = currentIds.includes(clientId)
      ? currentIds.filter(id => id !== clientId)
      : [...currentIds, clientId];
    setAssigningClientKey(`${team.id}-${clientId}`);
    try {
      await api.post(`/admin/teams/${team.id}/clients`, { clientIds: newIds });
      await fetchData();
    } catch (err) {
      setAccountAssignError(err.response?.data?.error || 'Failed to update account assignment.');
    } finally {
      setAssigningClientKey(null);
    }
  };

  /* ---- Delete ---- */
  const confirmDelete = (item, type) => {
    setDeleteTarget(item);
    setDeleteType(type);
    setDeleteError('');
    setShowDeleteModal(true);
  };
  // Channels & media groups live under /masterdata; everything else under /admin.
  const deletePath = (type, id) => {
    if (type === 'channels') return `/masterdata/channel-masters/${id}`;
    if (type === 'media-groups') return `/masterdata/media-groups/${id}`;
    if (type === 'clients') return `/clients/${id}`;
    return `/admin/${type}/${id}`;
  };
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api.delete(deletePath(deleteType, deleteTarget.id));
      setShowDeleteModal(false);
      setDeleteTarget(null);
      await fetchData();
    } catch (err) {
      // Keep the modal open and show why (e.g. still referenced by logs).
      setDeleteError(err.response?.data?.error || err.response?.data?.message || `Failed to delete ${deleteType.slice(0, -1)}.`);
    } finally {
      setDeleting(false);
    }
  };

  /* ---- Channel Master CRUD ---- */
  const openAddChannel = () => {
    setEditingChannel(null);
    setChannelForm({ name: '', medium: 'TV', mediaGroupId: '', aliases: '' });
    setChannelError('');
    setShowChannelModal(true);
  };
  const openEditChannel = ch => {
    setEditingChannel(ch);
    setChannelForm({
      name: ch.name,
      medium: ch.medium,
      mediaGroupId: String(ch.mediaGroup?.id || ch.mediaGroupId || ''),
      aliases: (ch.aliases || []).join(', '),
    });
    setChannelError('');
    setShowChannelModal(true);
  };
  const handleChannelSubmit = async e => {
    e.preventDefault();
    setChannelError('');
    if (!channelForm.name.trim()) { setChannelError('Channel name is required.'); return; }
    if (!channelForm.mediaGroupId) { setChannelError('Please select a media group.'); return; }
    setChannelSubmitting(true);
    const payload = {
      name: channelForm.name.trim(),
      medium: channelForm.medium,
      mediaGroupId: parseInt(channelForm.mediaGroupId),
      aliases: channelForm.aliases.split(',').map(a => a.trim()).filter(Boolean),
    };
    try {
      if (editingChannel) await api.put(`/masterdata/channel-masters/${editingChannel.id}`, payload);
      else await api.post('/masterdata/channel-masters', payload);
      setShowChannelModal(false);
      await fetchData();
    } catch (err) {
      setChannelError(err.response?.data?.error || err.response?.data?.message || 'Failed to save channel.');
    } finally {
      setChannelSubmitting(false);
    }
  };
  const toggleChannel = async ch => {
    try {
      await api.patch(`/masterdata/channel-masters/${ch.id}/toggle`);
      await fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update channel status.');
    }
  };
  const openMergeModal = ch => {
    setMergeSource(ch);
    setMergeTargetId('');
    setMergeError('');
    setShowMergeModal(true);
  };
  const handleMergeSubmit = async e => {
    e.preventDefault();
    setMergeError('');
    if (!mergeTargetId) { setMergeError('Please select a channel to merge into.'); return; }
    setMergeSubmitting(true);
    try {
      await api.post('/masterdata/channel-masters/merge', {
        sourceId: mergeSource.id,
        targetId: parseInt(mergeTargetId),
      });
      setShowMergeModal(false);
      setMergeSource(null);
      setMergeTargetId('');
      await fetchData();
    } catch (err) {
      setMergeError(err.response?.data?.error || err.response?.data?.message || 'Failed to merge channels.');
    } finally {
      setMergeSubmitting(false);
    }
  };

  /* ---- Merge client ---- */
  const openClientMerge = c => {
    setClientMergeSource(c);
    setClientMergeTargetId('');
    setClientMergeError('');
    setShowClientMerge(true);
  };

  /* ---- Move client to another agency (point-in-time) ---- */
  const [showMove, setShowMove] = useState(false);
  const [moveClient, setMoveClient] = useState(null);
  const [moveAgencyId, setMoveAgencyId] = useState('');
  const [moveMonth, setMoveMonth] = useState(''); // "YYYY-MM", blank = all history
  const [moveSubmitting, setMoveSubmitting] = useState(false);
  const [moveError, setMoveError] = useState('');
  const [moveMsg, setMoveMsg] = useState('');
  const openMove = c => {
    setMoveClient(c);
    setMoveAgencyId('');
    setMoveMonth('');
    setMoveError(''); setMoveMsg('');
    setShowMove(true);
  };
  const handleMoveSubmit = async e => {
    e.preventDefault();
    setMoveError(''); setMoveMsg('');
    if (!moveAgencyId) { setMoveError('Please pick the agency to move to.'); return; }
    if (String(moveAgencyId) === String(moveClient?.agencyId)) { setMoveError('That is already the client’s agency.'); return; }
    setMoveSubmitting(true);
    try {
      const { data } = await api.post(`/admin/clients/${moveClient.id}/move-agency`, {
        agencyId: parseInt(moveAgencyId),
        effectiveMonth: moveMonth || null,
      });
      setMoveMsg(`${data.message}. Re-stamped ${data.restamped.scheduleLogs} schedule log(s), ${data.restamped.forecasts} forecast(s), ${data.restamped.budgets} budget(s).`);
      await fetchData();
      setTimeout(() => setShowMove(false), 1400);
    } catch (err) {
      setMoveError(err.response?.data?.error || err.response?.data?.detail || 'Failed to move client.');
    } finally {
      setMoveSubmitting(false);
    }
  };
  const handleClientMergeSubmit = async e => {
    e.preventDefault();
    setClientMergeError('');
    if (!clientMergeTargetId) { setClientMergeError('Please select a client to merge into.'); return; }
    setClientMergeSubmitting(true);
    try {
      await api.post('/admin/clients/merge', {
        sourceId: clientMergeSource.id,
        targetId: parseInt(clientMergeTargetId),
      });
      setShowClientMerge(false);
      setClientMergeSource(null);
      setClientMergeTargetId('');
      await fetchData();
    } catch (err) {
      setClientMergeError(err.response?.data?.error || err.response?.data?.detail || 'Failed to merge clients.');
    } finally {
      setClientMergeSubmitting(false);
    }
  };

  /* ---- Media Group CRUD ---- */
  const openAddGroup = () => {
    setEditingGroup(null);
    setGroupForm({ name: '' });
    setGroupError('');
    setShowGroupModal(true);
  };
  const openEditGroup = g => {
    setEditingGroup(g);
    setGroupForm({ name: g.name });
    setGroupError('');
    setShowGroupModal(true);
  };
  const handleGroupSubmit = async e => {
    e.preventDefault();
    setGroupError('');
    if (!groupForm.name.trim()) { setGroupError('Media group name is required.'); return; }
    setGroupSubmitting(true);
    try {
      if (editingGroup) await api.put(`/masterdata/media-groups/${editingGroup.id}`, { name: groupForm.name.trim() });
      else await api.post('/masterdata/media-groups', { name: groupForm.name.trim() });
      setShowGroupModal(false);
      await fetchData();
    } catch (err) {
      setGroupError(err.response?.data?.error || err.response?.data?.message || 'Failed to save media group.');
    } finally {
      setGroupSubmitting(false);
    }
  };
  const toggleGroup = async g => {
    try {
      await api.patch(`/masterdata/media-groups/${g.id}/toggle`);
      await fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update media group status.');
    }
  };

  /* ---- Property Category CRUD ---- */
  const openAddCat = () => {
    setEditingCat(null);
    setCatForm({ name: '' });
    setCatError('');
    setShowCatModal(true);
  };
  const openEditCat = c => {
    setEditingCat(c);
    setCatForm({ name: c.name });
    setCatError('');
    setShowCatModal(true);
  };
  const handleCatSubmit = async e => {
    e.preventDefault();
    setCatError('');
    if (!catForm.name.trim()) { setCatError('Category name is required.'); return; }
    setCatSubmitting(true);
    try {
      if (editingCat) await api.put(`/masterdata/property-categories/${editingCat.id}`, { name: catForm.name.trim() });
      else await api.post('/masterdata/property-categories', { name: catForm.name.trim() });
      setShowCatModal(false);
      await fetchData();
    } catch (err) {
      setCatError(err.response?.data?.error || err.response?.data?.message || 'Failed to save category.');
    } finally {
      setCatSubmitting(false);
    }
  };
  const toggleCat = async c => {
    try {
      await api.patch(`/masterdata/property-categories/${c.id}/toggle`);
      await fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update category status.');
    }
  };

  /* ---- Annual Targets CRUD ---- */
  const openAddTarget = () => {
    setEditingTarget(null);
    setTargetForm({ year: String(new Date().getFullYear()), totalTargetMillions: '', remoteMonth: '' });
    setTargetError('');
    setShowTargetModal(true);
  };
  const openEditTarget = t => {
    setEditingTarget(t);
    setTargetForm({ year: String(t.year), totalTargetMillions: String(t.totalTargetMillions), remoteMonth: t.remoteMonth ? String(t.remoteMonth) : '' });
    setTargetError('');
    setShowTargetModal(true);
  };
  const handleTargetSubmit = async e => {
    e.preventDefault();
    setTargetError('');
    if (!targetForm.year || !targetForm.totalTargetMillions) { setTargetError('Year and annual target are required.'); return; }
    setTargetSubmitting(true);
    try {
      await api.post('/admin/annual-targets', {
        year: parseInt(targetForm.year),
        totalTargetMillions: parseFloat(targetForm.totalTargetMillions),
        remoteMonth: targetForm.remoteMonth ? parseInt(targetForm.remoteMonth) : null,
      });
      setShowTargetModal(false);
      await fetchData();
    } catch (err) {
      setTargetError(err.response?.data?.error || 'Failed to save annual target.');
    } finally {
      setTargetSubmitting(false);
    }
  };

  /* ---- group revenue contribution ---- */
  const fetchGroupRevenue = async () => {
    setGrLoading(true);
    try {
      const { data } = await api.get('/admin/group-revenue', { params: { year: grYear, month: grMonth } });
      // On first open, jump to the month the dashboard's Revenue donut reads.
      const crm = data.currentRevenueMonth;
      if (!grInit && crm && (crm.year !== grYear || crm.month !== grMonth)) {
        setGrInit(true);
        setGrYear(crm.year);
        setGrMonth(crm.month);
        return; // effect re-runs with the corrected month
      }
      setGrInit(true);
      const heads = data.heads || [];
      setGrHeads(heads);
      const amts = {};
      heads.forEach(h => { amts[h.headUserId] = h.amount == null ? '' : String(h.amount); });
      setGrAmounts(amts);
    } catch {
      setGrHeads([]); setGrAmounts({});
    } finally {
      setGrLoading(false);
    }
  };
  useEffect(() => {
    if (activeTab === 'group-revenue') fetchGroupRevenue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, grYear, grMonth]);

  const saveGroupRevenue = async () => {
    setGrSaving(true);
    try {
      const amounts = {};
      Object.entries(grAmounts).forEach(([id, v]) => { amounts[id] = v === '' ? null : Number(v); });
      const { data } = await api.post('/admin/group-revenue', { year: grYear, month: grMonth, amounts });
      const heads = data.heads || [];
      setGrHeads(heads);
      const amts = {};
      heads.forEach(h => { amts[h.headUserId] = h.amount == null ? '' : String(h.amount); });
      setGrAmounts(amts);
      setGrSavedAt(Date.now());
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save group revenue.');
    } finally {
      setGrSaving(false);
    }
  };

  /* ---- helpers ---- */
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const grTotal = Object.values(grAmounts).reduce((s, v) => s + (Number(v) || 0), 0);
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

  const filteredClients = useMemo(() =>
    allClients
      .filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.agencyName || '').toLowerCase().includes(search.toLowerCase())
      )
      .sort((a, b) => a.name.localeCompare(b.name)),
    [allClients, search]);

  const filteredTeams = useMemo(() =>
    teams.filter(t => t.name.toLowerCase().includes(search.toLowerCase())),
    [teams, search]);

  const filteredChannels = useMemo(() =>
    channelMasters.filter(c =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.mediaGroup?.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.medium || '').toLowerCase().includes(search.toLowerCase())
    ), [channelMasters, search]);

  const filteredGroups = useMemo(() =>
    mediaGroups.filter(g => g.name.toLowerCase().includes(search.toLowerCase())),
    [mediaGroups, search]);

  const filteredCats = useMemo(() =>
    propertyCategories.filter(c => c.name.toLowerCase().includes(search.toLowerCase())),
    [propertyCategories, search]);

  const hideClientSelect = userForm.role === 'SUPER_ADMIN' || userForm.role === 'ADMIN_LEVEL_1';

  // Export every admin dataset into one workbook, a sheet per entity.
  const exportAll = () => {
    const wb = XLSX.utils.book_new();
    const add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name.slice(0, 31));
    const yn = (v, def = 'Yes') => (v === false ? 'No' : v === true ? 'Yes' : def);

    add('Users', [
      ['Name', 'Email', 'Role', 'Agencies', 'Clients', 'Must Change Pwd', 'Can Export', 'Read Only', 'Created'],
      ...users.map(u => [
        u.name || '', u.email || '', u.role || '',
        (u.agencies || []).map(a => a.name).join(', '),
        (u.clients || []).map(c => c.name).join(', '),
        u.mustChangePassword ? 'Yes' : 'No',
        u.canExport === false ? 'No' : 'Yes',
        u.readOnly ? 'Yes' : 'No',
        u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-GB') : '',
      ]),
    ]);

    add('Agencies', [
      ['Agency', 'Clients'],
      ...agencies.map(a => [a.name || '', (a.clients || []).length]),
    ]);

    add('Clients', [
      ['Client', 'Agency', 'Active'],
      ...allClients.map(c => [c.name || '', c.agencyName || '', yn(c.isActive)]),
    ]);

    add('Channels', [
      ['Channel', 'Medium', 'Media Group', 'Active', 'Aliases', 'Schedule Logs'],
      ...channelMasters.map(ch => [
        ch.name || '', ch.medium || '', ch.mediaGroup?.name || '',
        yn(ch.isActive),
        Array.isArray(ch.aliases) ? ch.aliases.join(', ') : '',
        ch._count?.scheduleLogs ?? '',
      ]),
    ]);

    add('Media Groups', [
      ['Media Group', 'Active', 'Channels'],
      ...mediaGroups.map(g => [
        g.name || '', yn(g.isActive),
        channelMasters.filter(ch => ch.mediaGroup?.id === g.id).length,
      ]),
    ]);

    add('Teams', [
      ['Team', 'Agency', 'Head', 'Members', 'Clients'],
      ...teams.map(t => [
        t.name || '', t.agency?.name || '', t.head?.name || '',
        (t.members || []).map(m => m.name).join(', '),
        (t.clients || []).map(c => c.name).join(', '),
      ]),
    ]);

    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `ogilvy-orbit-admin-export-${stamp}.xlsx`);
  };

  if (loading) {
    return <OrbitLoader fullHeight label="Loading…" />;
  }

  const tabs = [
    { key: 'users', label: 'Users', count: users.length },
    { key: 'agencies', label: 'Agencies', count: agencies.length },
    { key: 'clients', label: 'Clients', count: allClients.length },
    { key: 'teams', label: 'Teams', count: teams.length },
    { key: 'channels', label: 'Channels', count: channelMasters.length },
    { key: 'media-groups', label: 'Media Groups', count: mediaGroups.length },
    { key: 'property-categories', label: 'Property Categories', count: propertyCategories.length },
    { key: 'annual-targets', label: 'Annual Targets', count: annualTargets.length },
    { key: 'group-revenue', label: 'Group Revenue' },
    { key: 'client-requests', label: 'Client Requests', count: clientRequests.filter(r => r.status === 'pending').length },
    { key: 'channel-requests', label: 'Channel Requests', count: channelRequests.filter(r => r.status === 'pending').length },
    { key: 'notify', label: 'Notify' },
    { key: 'backup', label: 'Backup' },
  ];

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="page-head">
        <div>
          <h1 className="page-title">User Management</h1>
          <p className="page-sub">Super Admin &middot; {users.length} users across {agencies.length} agencies</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={exportAll} title="Export all admin data to one Excel workbook (a sheet per entity)">
            <Icon name="download" size={16} /> Export all
          </button>
          <button className="btn btn-primary" onClick={openAddUser}>
            <Icon name="plus" size={16} /> Create user
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>
          {error}
          <button onClick={() => setError('')} style={{ marginLeft: 8, fontWeight: 600, textDecoration: 'underline', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {tabs.map(tab => {
          const on = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setSearch(''); }}
              style={{
                border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '8px 15px',
                borderRadius: 9, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 7,
                background: on ? '#0F1F3D' : 'transparent', color: on ? '#fff' : '#6B7790',
              }}
            >
              {tab.label}
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 20,
                background: on ? 'rgba(255,255,255,.16)' : '#EEF0F3', color: on ? '#fff' : '#93A0B5',
              }}>{tab.count}</span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {!['group-revenue', 'backup', 'notify'].includes(activeTab) && (
          <div style={{ position: 'relative', flex: '1 1 300px', maxWidth: 320 }}>
            <Icon name="search" size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
            <input
              className="input"
              type="text"
              placeholder={`Search ${activeTab === 'media-groups' ? 'media groups' : activeTab === 'property-categories' ? 'property categories' : activeTab}...`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 32 }}
            />
          </div>
        )}
        {activeTab === 'agencies' && (
          <button className="btn btn-primary" onClick={openAddAgency} style={{ marginLeft: 'auto' }}>
            <Icon name="plus" size={16} /> Add Agency
          </button>
        )}
        {activeTab === 'annual-targets' && (
          <button className="btn btn-primary" onClick={openAddTarget} style={{ marginLeft: 'auto' }}>
            <Icon name="plus" size={16} /> Set Target
          </button>
        )}
        {activeTab === 'clients' && (
          <button className="btn btn-primary" onClick={openAddClient} style={{ marginLeft: 'auto' }}>
            <Icon name="plus" size={16} /> Add Client
          </button>
        )}
        {activeTab === 'teams' && (
          <button className="btn btn-primary" onClick={openAddTeam} style={{ marginLeft: 'auto' }}>
            <Icon name="plus" size={16} /> Add Team
          </button>
        )}
        {activeTab === 'channels' && (
          <button className="btn btn-primary" onClick={openAddChannel} style={{ marginLeft: 'auto' }}>
            <Icon name="plus" size={16} /> Add Channel
          </button>
        )}
        {activeTab === 'media-groups' && (
          <button className="btn btn-primary" onClick={openAddGroup} style={{ marginLeft: 'auto' }}>
            <Icon name="plus" size={16} /> Add Media Group
          </button>
        )}
        {activeTab === 'property-categories' && (
          <button className="btn btn-primary" onClick={openAddCat} style={{ marginLeft: 'auto' }}>
            <Icon name="plus" size={16} /> Add Category
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
                <th style={{ textAlign: 'right', position: 'sticky', right: 0, background: 'var(--card, #fff)', boxShadow: '-8px 0 8px -6px rgba(15,31,61,.12)' }}>Actions</th>
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
                    <td>
                      {u.agencies?.length ? (
                        <span title={u.agencies.map(a => a.name).join(', ')} style={{ display: 'inline-block', maxWidth: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'bottom' }}>
                          {u.agencies.map(a => a.name).join(', ')}
                        </span>
                      ) : '-'}
                    </td>
                    <td>
                      {u.clients?.length ? (
                        <span title={u.clients.map(c => c.name).join(', ')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, maxWidth: 260 }}>
                          <span style={{ flex: 'none', fontWeight: 700, fontSize: 11.5, color: 'var(--ink)', background: 'var(--bg,#eef1f6)', border: '1px solid var(--border)', borderRadius: 20, padding: '1px 8px', lineHeight: 1.5 }}>{u.clients.length}</span>
                          <span style={{ minWidth: 0, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.clients.map(c => c.name).join(', ')}</span>
                        </span>
                      ) : '-'}
                    </td>
                    <td style={{ color: 'var(--muted)' }}>
                      {u.lastLoginAt
                        ? new Date(u.lastLoginAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                        : '-'}
                    </td>
                    <td style={{ position: 'sticky', right: 0, background: 'var(--card, #fff)', boxShadow: '-8px 0 8px -6px rgba(15,31,61,.12)' }}>
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

      {/* ============ CLIENTS (grouped by agency) ============ */}
      {activeTab === 'clients' && (
        filteredClients.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', background: '#fff', border: '1px solid var(--border)', borderRadius: 12 }}>
            <Icon name="search" size={28} style={{ opacity: 0.4, marginBottom: 6 }} />
            <p>No clients found</p>
          </div>
        ) : (
          (() => {
            // Group the (already search-filtered) clients by agency.
            const groups = {};
            for (const c of filteredClients) {
              const key = c.agencyName || 'Unassigned';
              (groups[key] ||= []).push(c);
            }
            const agencyNames = Object.keys(groups).sort((a, b) => a.localeCompare(b));
            return agencyNames.map(ag => (
              <div key={ag} style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '0 0 8px 2px' }}>
                  <Icon name="building" size={15} style={{ color: 'var(--muted)' }} />
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>{ag}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: '#EEF0F3', color: '#93A0B5' }}>{groups[ag].length}</span>
                </div>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Client</th>
                        <th>Channels</th>
                        <th>Status</th>
                        <th>Commission</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups[ag].map(c => (
                        <tr key={c.id} style={{ opacity: c.isActive === false ? 0.55 : 1 }}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <Avatar name={c.name} size={32} />
                              <span className="strong">{c.name}</span>
                            </div>
                          </td>
                          <td>{c._count?.channels ?? c.channelCount ?? '-'}</td>
                          <td>
                            <span style={{
                              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                              background: c.isActive === false ? 'var(--bg-sunken)' : 'var(--green-100)',
                              color: c.isActive === false ? 'var(--muted)' : 'var(--green-600)',
                            }}>{c.isActive === false ? 'Hidden' : 'Active'}</span>
                          </td>
                          <td>
                            {c.commissionType === 'COMMISSION' ? (
                              <span className="mono" style={{ fontWeight: 600 }}>{Number(c.commissionValue)}%</span>
                            ) : c.commissionType === 'AOR' ? (
                              <span className="mono" style={{ fontWeight: 600 }}>LKR {Number(c.commissionValue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            ) : (
                              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: 'var(--amber-50,#FCF4E2)', color: '#9A5B00' }}>Not set</span>
                            )}
                          </td>
                          <td>
                            <div className="row-actions">
                              <button className="act-btn" onClick={() => openEditClient(c)} title="Edit client">
                                <Icon name="edit" size={15} />
                              </button>
                              <button className="act-btn" onClick={() => toggleClient(c)} title={c.isActive === false ? 'Show to group heads' : 'Hide from group heads'} style={{ color: c.isActive === false ? 'var(--green-600)' : 'var(--muted)' }}>
                                <Icon name={c.isActive === false ? 'check' : 'eye'} size={15} />
                              </button>
                              <button className="act-btn" onClick={() => openMove(c)} title="Move to another agency (point-in-time)">
                                <Icon name="building" size={15} />
                              </button>
                              <button className="act-btn" onClick={() => openClientMerge(c)} title="Merge into another client">
                                <Icon name="merge" size={15} />
                              </button>
                              <button className="act-btn" onClick={() => confirmDelete(c, 'clients')} title="Delete client" style={{ color: 'var(--red-600,#dc2626)' }}>
                                <Icon name="x" size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ));
          })()
        )
      )}

      {/* ============ ASSIGN ACCOUNTS TO HEADS ============ */}
      {activeTab === 'teams' && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 4px' }}>Assign Accounts to Heads</h3>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
            Click a client to assign it to that team's head. A client belongs to one team at a time;
            assigning it here moves it off any other team instantly.
          </div>
          {accountAssignError && (
            <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 14 }}>{accountAssignError}</div>
          )}
          {teams.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)' }}>
              No teams yet. Click "Add Team" to create one first.
            </div>
          ) : (
            teams.map(team => {
              const assignedIds = team.clients?.map(c => c.id) || [];
              return (
                <div key={team.id} style={{ padding: '14px 0', borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                    <strong>{team.head?.name || <span style={{ color: 'var(--muted)' }}>No head assigned</span>}</strong>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{team.name} · {team.agency?.name || team.agencyName}</span>
                  </div>
                  <div className="chips">
                    {allClients
                      .filter(c => c.agencyId === team.agencyId || c.agencyId === team.agency?.id)
                      .map(c => {
                        const owner = teams.find(t => t.id !== team.id && t.clients?.some(tc => tc.id === c.id));
                        const active = assignedIds.includes(c.id);
                        const busy = assigningClientKey === `${team.id}-${c.id}`;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            className={'chip' + (active ? ' active' : '')}
                            disabled={busy}
                            onClick={() => toggleAccountForTeam(team, c.id)}
                            title={owner ? `Currently on team "${owner.name}": assigning here will move it` : ''}
                          >
                            {c.name}{owner ? ` (on ${owner.name})` : ''}
                            {active ? <Icon name="x" size={12} /> : <Icon name="plus" size={12} />}
                          </button>
                        );
                      })}
                  </div>
                </div>
              );
            })
          )}
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
                <th>Team Head</th>
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
                  <td>{team.head?.name || <span style={{ color: 'var(--muted)' }}>Not set</span>}</td>
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

      {/* ============ CHANNELS TABLE ============ */}
      {activeTab === 'channels' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Channel Name</th>
                <th>Medium</th>
                <th>Media Group</th>
                <th>Aliases</th>
                <th>Usage</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredChannels.map(ch => (
                <tr key={ch.id} style={{ opacity: ch.isActive === false ? 0.55 : 1 }}>
                  <td className="strong">{ch.name}</td>
                  <td><span className="medium-tag">{ch.medium}</span></td>
                  <td>{ch.mediaGroup?.name || '-'}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 12, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ch.aliases?.length ? ch.aliases.join(', ') : '-'}
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{ch._count?.scheduleLogs ?? 0} logs</td>
                  <td>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                      background: ch.isActive === false ? 'var(--bg-sunken)' : 'var(--green-100)',
                      color: ch.isActive === false ? 'var(--muted)' : 'var(--green-600)',
                    }}>{ch.isActive === false ? 'Inactive' : 'Active'}</span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="act-btn" onClick={() => openEditChannel(ch)} title="Edit channel">
                        <Icon name="edit" size={15} />
                      </button>
                      <button className="act-btn" onClick={() => openMergeModal(ch)} title="Merge into another channel">
                        <Icon name="merge" size={15} />
                      </button>
                      <button
                        className="act-btn"
                        onClick={() => toggleChannel(ch)}
                        title={ch.isActive === false ? 'Activate' : 'Deactivate'}
                        style={{ color: ch.isActive === false ? 'var(--green-600)' : 'var(--muted)' }}
                      >
                        <Icon name={ch.isActive === false ? 'check' : 'eye'} size={15} />
                      </button>
                      <button className="act-btn" onClick={() => confirmDelete(ch, 'channels')} title="Delete permanently" style={{ color: 'var(--red-600,#dc2626)' }}>
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredChannels.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>
              <Icon name="tv" size={28} style={{ opacity: 0.4, marginBottom: 6 }} />
              <p>No channels found</p>
            </div>
          )}
        </div>
      )}

      {/* ============ MEDIA GROUPS TABLE ============ */}
      {activeTab === 'media-groups' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Media Group</th>
                <th>Channels</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredGroups.map(g => (
                <tr key={g.id} style={{ opacity: g.active === false ? 0.55 : 1 }}>
                  <td className="strong">{g.name}</td>
                  <td style={{ color: 'var(--muted)' }}>{g._count?.channelMasters ?? 0} channels</td>
                  <td>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                      background: g.active === false ? 'var(--bg-sunken)' : 'var(--green-100)',
                      color: g.active === false ? 'var(--muted)' : 'var(--green-600)',
                    }}>{g.active === false ? 'Inactive' : 'Active'}</span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="act-btn" onClick={() => openEditGroup(g)} title="Edit media group">
                        <Icon name="edit" size={15} />
                      </button>
                      <button
                        className="act-btn"
                        onClick={() => toggleGroup(g)}
                        title={g.active === false ? 'Activate' : 'Deactivate'}
                        style={{ color: g.active === false ? 'var(--green-600)' : 'var(--muted)' }}
                      >
                        <Icon name={g.active === false ? 'check' : 'eye'} size={15} />
                      </button>
                      <button className="act-btn" onClick={() => confirmDelete(g, 'media-groups')} title="Delete permanently" style={{ color: 'var(--red-600,#dc2626)' }}>
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredGroups.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>
              <Icon name="folder" size={28} style={{ opacity: 0.4, marginBottom: 6 }} />
              <p>No media groups found</p>
            </div>
          )}
        </div>
      )}

      {/* ============ PROPERTY CATEGORIES TABLE ============ */}
      {activeTab === 'property-categories' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Category</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCats.map(c => (
                <tr key={c.id} style={{ opacity: c.isActive === false ? 0.55 : 1 }}>
                  <td className="strong">{c.name}</td>
                  <td>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                      background: c.isActive === false ? 'var(--bg-sunken)' : 'var(--green-100)',
                      color: c.isActive === false ? 'var(--muted)' : 'var(--green-600)',
                    }}>{c.isActive === false ? 'Inactive' : 'Active'}</span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="act-btn" onClick={() => openEditCat(c)} title="Edit category">
                        <Icon name="edit" size={15} />
                      </button>
                      <button
                        className="act-btn"
                        onClick={() => toggleCat(c)}
                        title={c.isActive === false ? 'Activate' : 'Deactivate'}
                        style={{ color: c.isActive === false ? 'var(--green-600)' : 'var(--muted)' }}
                      >
                        <Icon name={c.isActive === false ? 'check' : 'eye'} size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredCats.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>
              <Icon name="folder" size={28} style={{ opacity: 0.4, marginBottom: 6 }} />
              <p>No property categories found</p>
            </div>
          )}
        </div>
      )}

      {/* ============ ANNUAL TARGETS TABLE ============ */}
      {activeTab === 'group-revenue' && (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end', marginBottom: 14 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Month</label>
              <select className="select" value={grMonth} onChange={e => { setGrSavedAt(null); setGrMonth(Number(e.target.value)); }}>
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Year</label>
              <select className="select" value={grYear} onChange={e => { setGrSavedAt(null); setGrYear(Number(e.target.value)); }}>
                {Array.from({ length: (new Date().getFullYear() + 1) - 2022 + 1 }, (_, i) => 2022 + i).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Total entered</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>LKR {grTotal.toLocaleString('en-US')}</div>
            </div>
            <button className="btn btn-primary" onClick={saveGroupRevenue} disabled={grSaving || grLoading}>
              {grSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
            Enter each group head's revenue for <b style={{ color: 'var(--ink)' }}>{MONTHS[grMonth - 1]} {grYear}</b> (full LKR). This feeds the Revenue Contribution donut on the Executive Dashboard, which pairs it with the previous month's schedule-log budget. Leave a head blank to omit them.
            {grSavedAt && <span style={{ color: '#15814B', fontWeight: 700, marginLeft: 8 }}>Saved.</span>}
          </div>
          {grLoading ? (
            <div style={{ padding: '30px 0' }}><OrbitLoader label="Loading group heads…" /></div>
          ) : grHeads.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', background: '#fff', border: '1px solid var(--border)', borderRadius: 14 }}>
              No group heads found. Add users with the GROUP_HEAD role first.
            </div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Group Head</th>
                    <th style={{ textAlign: 'right' }}>Revenue (LKR)</th>
                    <th style={{ textAlign: 'right' }}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {grHeads.map(h => {
                    const val = Number(grAmounts[h.headUserId] || 0);
                    const pct = grTotal > 0 ? (val / grTotal) * 100 : 0;
                    return (
                      <tr key={h.headUserId}>
                        <td className="strong">{h.headName}</td>
                        <td style={{ textAlign: 'right' }}>
                          <input
                            className="input" type="number" min="0" step="1000"
                            value={grAmounts[h.headUserId] ?? ''}
                            onChange={e => { setGrSavedAt(null); setGrAmounts(a => ({ ...a, [h.headUserId]: e.target.value })); }}
                            placeholder="0"
                            style={{ maxWidth: 190, textAlign: 'right' }}
                          />
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{val > 0 ? `${pct.toFixed(1)}%` : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'annual-targets' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Year</th>
                <th>Annual Target (LKR M)</th>
                <th>Pacing Month</th>
                <th>Upto-Month Target (LKR M)</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {annualTargets.map(t => (
                <tr key={t.id}>
                  <td className="strong">{t.year}</td>
                  <td className="mono">{Number(t.totalTargetMillions).toLocaleString('en-US')}M</td>
                  <td>{t.remoteMonth ? MONTHS[t.remoteMonth - 1] : <span style={{ color: 'var(--muted)' }}>Auto</span>}</td>
                  <td className="mono">{t.remoteMonth ? `${Math.round((Number(t.totalTargetMillions) / 12) * t.remoteMonth).toLocaleString('en-US')}M` : <span style={{ color: 'var(--muted)' }}>Auto</span>}</td>
                  <td>
                    <div className="row-actions">
                      <button className="act-btn" onClick={() => openEditTarget(t)} title="Edit target">
                        <Icon name="edit" size={15} />
                      </button>
                      <button className="act-btn" onClick={() => confirmDelete({ ...t, name: `${t.year} target` }, 'annual-targets')} title="Delete target" style={{ color: 'var(--red-600,#dc2626)' }}>
                        <Icon name="x" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {annualTargets.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>
              <Icon name="bar-chart" size={28} style={{ opacity: 0.4, marginBottom: 6 }} />
              <p>No annual targets set. Click "Set Target" to add one.</p>
            </div>
          )}
        </div>
      )}

      {/* ============ CLIENT REQUESTS TABLE ============ */}
      {activeTab === 'client-requests' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Client Name</th><th>Agency</th><th>Requested By</th><th>Notes</th><th>Status</th><th style={{ textAlign: 'right' }}>Action</th></tr>
            </thead>
            <tbody>
              {clientRequests.map(r => (
                <tr key={r.id} style={{ opacity: r.status === 'pending' ? 1 : 0.6 }}>
                  <td className="strong">{r.clientName}</td>
                  <td style={{ color: 'var(--muted)' }}>{r.agencyName || '-'}</td>
                  <td>{r.requestedByName}</td>
                  <td style={{ color: 'var(--muted)' }}>{r.notes || '-'}</td>
                  <td><span className="badge">{r.status}</span></td>
                  <td>
                    {r.status === 'pending' ? (
                      <div className="row-actions">
                        <button className="act-btn" title="Approve" style={{ color: 'var(--green-600)' }} onClick={() => reviewRequest('client', r, 'approved')}><Icon name="check" size={15} /></button>
                        <button className="act-btn" title="Reject" style={{ color: 'var(--red-600,#dc2626)' }} onClick={() => reviewRequest('client', r, 'rejected')}><Icon name="x" size={15} /></button>
                      </div>
                    ) : <span style={{ fontSize: 12, color: 'var(--muted)' }}>{r.status}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {clientRequests.length === 0 && <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}><p>No client requests</p></div>}
        </div>
      )}

      {/* ============ CHANNEL REQUESTS TABLE ============ */}
      {activeTab === 'channel-requests' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Channel Name</th><th>Category</th><th>Requested By</th><th>Notes</th><th>Status</th><th style={{ textAlign: 'right' }}>Action</th></tr>
            </thead>
            <tbody>
              {channelRequests.map(r => (
                <tr key={r.id} style={{ opacity: r.status === 'pending' ? 1 : 0.6 }}>
                  <td className="strong">{r.channelName}</td>
                  <td><span className="medium-tag" data-medium={r.category}>{r.category}</span></td>
                  <td>{r.requestedByName}</td>
                  <td style={{ color: 'var(--muted)' }}>{r.notes || '-'}</td>
                  <td><span className="badge">{r.status}</span></td>
                  <td>
                    {r.status === 'pending' ? (
                      <div className="row-actions">
                        <button className="act-btn" title="Approve" style={{ color: 'var(--green-600)' }} onClick={() => reviewRequest('channel', r, 'approved')}><Icon name="check" size={15} /></button>
                        <button className="act-btn" title="Reject" style={{ color: 'var(--red-600,#dc2626)' }} onClick={() => reviewRequest('channel', r, 'rejected')}><Icon name="x" size={15} /></button>
                      </div>
                    ) : <span style={{ fontSize: 12, color: 'var(--muted)' }}>{r.status}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {channelRequests.length === 0 && <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}><p>No channel requests</p></div>}
        </div>
      )}

      {/* ============ NOTIFY ============ */}
      {activeTab === 'notify' && (
        <div style={{ maxWidth: 720 }}>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 720, color: 'var(--ink)' }}>Send a notification</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3, marginBottom: 16 }}>
              Notify whole roles and/or specific people. Recipients see it in-app and as a desktop notification (if they allowed it).
            </div>

            <div className="field" style={{ marginBottom: 12 }}>
              <label className="field-label">Title<span className="req">*</span></label>
              <input className="input" type="text" maxLength={120} value={notifyTitle} onChange={(e) => setNotifyTitle(e.target.value)} placeholder="e.g. June forecasts due Friday" />
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label className="field-label">Message<span className="req">*</span></label>
              <textarea className="input" rows={3} maxLength={600} value={notifyMessage} onChange={(e) => setNotifyMessage(e.target.value)} placeholder="Write your message…" style={{ resize: 'vertical' }} />
            </div>
            <div className="field" style={{ marginBottom: 16 }}>
              <label className="field-label">Link (optional)</label>
              <input className="input" type="text" value={notifyLink} onChange={(e) => setNotifyLink(e.target.value)} placeholder="e.g. /forecasting" />
              <span style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, display: 'block' }}>Where clicking the notification takes them (in-app path).</span>
            </div>

            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>Send to roles</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
              {['GROUP_HEAD', 'PLANNER', 'ADMIN_LEVEL_1', 'SUPER_ADMIN'].map((r) => {
                const on = notifyRoles.includes(r);
                return (
                  <button key={r} type="button" onClick={() => toggleNotifyRole(r)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
                      border: `1px solid ${on ? 'var(--coral-600, #E85D24)' : 'var(--border)'}`,
                      background: on ? 'var(--coral-50, #fff3ee)' : 'var(--card)',
                      color: on ? 'var(--coral-700, #C44A18)' : 'var(--ink-soft)', fontSize: 12.5, fontWeight: 600 }}>
                    {on && <Icon name="check" size={13} />}{r.replace('_', ' ')}
                  </button>
                );
              })}
            </div>

            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>
              Or specific people {notifyUserIds.length > 0 && <span style={{ color: 'var(--muted)', fontWeight: 500 }}>· {notifyUserIds.length} selected</span>}
            </div>
            <input className="input" type="text" value={notifyUserSearch} onChange={(e) => setNotifyUserSearch(e.target.value)} placeholder="Search people…" style={{ marginBottom: 8 }} />
            <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              {users
                .filter((u) => !notifyUserSearch || (u.name || '').toLowerCase().includes(notifyUserSearch.toLowerCase()) || (u.email || '').toLowerCase().includes(notifyUserSearch.toLowerCase()))
                .map((u) => (
                  <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                    <input type="checkbox" checked={notifyUserIds.includes(u.id)} onChange={() => toggleNotifyUser(u.id)} />
                    <span style={{ flex: 1 }}>{u.name}<span style={{ color: 'var(--muted)', marginLeft: 6, fontSize: 11.5 }}>{u.email}</span></span>
                    <RoleBadge role={u.role} small />
                  </label>
                ))}
              {users.length === 0 && <div style={{ padding: 14, fontSize: 12.5, color: 'var(--muted)' }}>No users.</div>}
            </div>

            {notifyResult && (
              <div style={{ marginTop: 14, fontSize: 13, fontWeight: 600, color: notifyResult.ok ? 'var(--green-600)' : 'var(--red-600)' }}>
                {notifyResult.text}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-primary" disabled={notifySending || !notifyTitle.trim() || !notifyMessage.trim() || (!notifyRoles.length && !notifyUserIds.length)} onClick={sendNotification}>
                <Icon name="bell" size={15} />{notifySending ? 'Sending…' : 'Send notification'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ BACKUP ============ */}
      {activeTab === 'backup' && (
        <div style={{ maxWidth: 760 }}>
          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 720, color: 'var(--ink)' }}>Database backup to Google Drive</div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
                  A full, restorable dump of the whole database, gzipped and uploaded to your Drive folder.
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {backup && (
                  <span className="badge" style={{ background: backup.configured ? '#ECF8F1' : '#FBE0DA', color: backup.configured ? '#15814B' : '#C5391F', fontWeight: 700 }}>
                    {backup.configured ? 'Enabled' : 'Not configured'}
                  </span>
                )}
                <button className="btn btn-primary" disabled={backupRunning || !backup?.configured} onClick={runBackupNow}>
                  {backupRunning ? 'Backing up…' : 'Back up now'}
                </button>
              </div>
            </div>

            {backupMsg && (
              <div style={{ marginTop: 14, fontSize: 12.5, fontWeight: 600, color: /fail|error|not configured/i.test(backupMsg) ? 'var(--red-600)' : 'var(--green-600)' }}>
                {backupMsg}
              </div>
            )}

            {backupLoading ? (
              <div style={{ marginTop: 16, color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
            ) : !backup ? null : (
              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <div className="stat" style={{ padding: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Schedule</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginTop: 4 }}>{backup.schedule} <span style={{ fontWeight: 500, color: 'var(--muted)', fontSize: 12 }}>(cron)</span></div>
                </div>
                <div className="stat" style={{ padding: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Keeps</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginTop: 4 }}>{backup.retention} backups</div>
                </div>
                <div className="stat" style={{ padding: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Last run</div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4, color: backup.lastRun?.status === 'success' ? 'var(--green-600)' : backup.lastRun?.status === 'failed' ? 'var(--red-600)' : 'var(--ink)' }}>
                    {backup.lastRun ? `${backup.lastRun.status}` : 'never'}
                  </div>
                  {backup.lastRun?.at && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{new Date(backup.lastRun.at).toLocaleString()}</div>}
                </div>
              </div>
            )}

            {backup && !backup.configured && (
              <div style={{ marginTop: 16, fontSize: 12.5, color: 'var(--ink-soft)', background: '#F7F8FA', borderRadius: 8, padding: '12px 14px', lineHeight: 1.6 }}>
                To enable, set these environment variables on the server and redeploy:
                <ul style={{ margin: '8px 0 0 18px' }}>
                  <li><code>GOOGLE_SERVICE_ACCOUNT_JSON</code> — a Google service-account key (raw JSON or base64)</li>
                  <li><code>GDRIVE_BACKUP_FOLDER_ID</code> — the Drive folder ID, shared with the service account as Editor</li>
                </ul>
              </div>
            )}
          </div>

          {backup?.configured && (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Backup file</th><th>Size</th><th style={{ textAlign: 'right' }}>Created</th></tr></thead>
                <tbody>
                  {(backup.backups || []).map(f => (
                    <tr key={f.id}>
                      <td className="strong" style={{ fontFamily: "'Spline Sans Mono', monospace", fontSize: 12 }}>{f.name}</td>
                      <td>{f.size ? `${(Number(f.size) / 1024).toFixed(1)} KB` : '-'}</td>
                      <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{f.createdTime ? new Date(f.createdTime).toLocaleString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(backup.backups || []).length === 0 && <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}><p>No backups in the folder yet</p></div>}
              {backup.listError && <div style={{ padding: 12, color: 'var(--red-600)', fontSize: 12.5 }}>Could not list backups: {backup.listError}</div>}
            </div>
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
                      <button key={a.id} type="button" className={'chip' + (userForm.agencyIds.includes(a.id) ? ' active' : '')} onClick={() => setUserForm(p => {
                        const newAgencyIds = toggleArrayItem(p.agencyIds, a.id);
                        const validClientIds = p.clientIds.filter(cid => allClients.some(c => c.id === cid && newAgencyIds.includes(c.agencyId)));
                        return { ...p, agencyIds: newAgencyIds, clientIds: validClientIds };
                      })}>
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
                    {userForm.agencyIds.length === 0 && (
                      <span style={{ fontSize: 13, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Select an agency first to see its clients</span>
                    )}
                    {userForm.agencyIds.length > 0 && allClients.filter(c => userForm.agencyIds.includes(c.agencyId)).length > 0 && (
                      <div style={{ position: 'relative', marginBottom: 10 }}>
                        <Icon name="search" size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
                        <input className="input" placeholder="Search clients…" value={userClientSearch} onChange={e => setUserClientSearch(e.target.value)} style={{ paddingLeft: 32 }} />
                      </div>
                    )}
                    <div className="chips">
                      {(() => {
                        const q = userClientSearch.trim().toLowerCase();
                        const list = allClients
                          .filter(c => userForm.agencyIds.includes(c.agencyId))
                          .filter(c => !q || c.name.toLowerCase().includes(q) || (c.agencyName || '').toLowerCase().includes(q));
                        if (userForm.agencyIds.length > 0 && allClients.filter(c => userForm.agencyIds.includes(c.agencyId)).length === 0) {
                          return <span style={{ fontSize: 13, color: 'var(--muted)' }}>No clients in selected agencies</span>;
                        }
                        if (q && list.length === 0) {
                          return <span style={{ fontSize: 13, color: 'var(--muted)' }}>No clients match “{userClientSearch.trim()}”</span>;
                        }
                        return list.map(c => (
                          <button key={c.id} type="button" className={'chip' + (userForm.clientIds.includes(c.id) ? ' active' : '')} onClick={() => setUserForm(p => ({ ...p, clientIds: toggleArrayItem(p.clientIds, c.id) }))}>
                            {c.name}
                            {userForm.agencyIds.length > 1 && c.agencyName && <span style={{ opacity: 0.6, marginLeft: 4, fontSize: 11 }}>({c.agencyName})</span>}
                            {userForm.clientIds.includes(c.id) ? <Icon name="x" size={12} /> : <Icon name="plus" size={12} />}
                          </button>
                        ));
                      })()}
                    </div>
                  </div>
                )}

                {/* Permissions (not for Super Admin — they always have full access) */}
                {userForm.role !== 'SUPER_ADMIN' && (
                  <div className="field" style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                    <label className="field-label">Page access</label>
                    <span style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>
                      Pick the pages this user can open. Leave all unselected for full access (within their role).
                    </span>
                    <div className="chips">
                      {TOGGLEABLE_PAGES.map(pg => {
                        const on = userForm.pageAccess.includes(pg.key);
                        return (
                          <button key={pg.key} type="button" className={'chip' + (on ? ' active' : '')} onClick={() => setUserForm(p => ({ ...p, pageAccess: toggleArrayItem(p.pageAccess, pg.key) }))}>
                            {pg.label}{on ? <Icon name="x" size={12} /> : <Icon name="plus" size={12} />}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, cursor: 'pointer', margin: 0 }}>
                        <input type="checkbox" checked={userForm.canExport} onChange={e => setUserForm(p => ({ ...p, canExport: e.target.checked }))} />
                        Can export reports (PDF / Excel)
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, cursor: 'pointer', margin: 0 }}>
                        <input type="checkbox" checked={userForm.readOnly} onChange={e => setUserForm(p => ({ ...p, readOnly: e.target.checked }))} />
                        Read-only · can view but not add, edit or delete anything
                      </label>
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

      {/* ============ ANNUAL TARGET MODAL ============ */}
      {showTargetModal && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setShowTargetModal(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{editingTarget ? `Edit ${editingTarget.year} Target` : 'Set Annual Target'}</h2>
              <button className="act-btn" onClick={() => setShowTargetModal(false)}><Icon name="x" size={18} /></button>
            </div>
            <form onSubmit={handleTargetSubmit}>
              <div className="modal-body">
                {targetError && (
                  <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>{targetError}</div>
                )}
                <div className="field-grid2">
                  <div className="field">
                    <label className="field-label">Year <span className="req">*</span></label>
                    <input className="input" type="number" value={targetForm.year} disabled={!!editingTarget} onChange={e => setTargetForm(p => ({ ...p, year: e.target.value }))} placeholder="2026" />
                  </div>
                  <div className="field">
                    <label className="field-label">Pacing month</label>
                    <select className="select" value={targetForm.remoteMonth} onChange={e => setTargetForm(p => ({ ...p, remoteMonth: e.target.value }))}>
                      <option value="">Auto (latest month with data)</option>
                      {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label className="field-label">Annual Budget Target (LKR Millions) <span className="req">*</span></label>
                  <input className="input" type="number" step="0.01" value={targetForm.totalTargetMillions} onChange={e => setTargetForm(p => ({ ...p, totalTargetMillions: e.target.value }))} placeholder="4200" />
                </div>
                <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0' }}>
                  Set the full Jan–Dec target. Leave <b>pacing month</b> on <b>Auto</b> and the dashboard compares actuals against the target up to the latest month you have data for. Only pin a month if you want the upcoming month filled by group-head forecasts instead.
                </p>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setShowTargetModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={targetSubmitting}>{targetSubmitting ? 'Saving…' : editingTarget ? 'Save Changes' : 'Set Target'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ CLIENT MODAL ============ */}
      {showClientModal && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setShowClientModal(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{editingClient ? 'Edit Client' : 'Add Client'}</h2>
              <button className="act-btn" onClick={() => setShowClientModal(false)}><Icon name="x" size={18} /></button>
            </div>
            <form onSubmit={handleClientSubmit}>
              <div className="modal-body">
                {clientError && (
                  <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>{clientError}</div>
                )}
                <div className="field">
                  <label className="field-label">Client Name <span className="req">*</span></label>
                  <input className="input" type="text" value={clientForm.name} onChange={e => setClientForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Dialog Axiata" autoFocus />
                </div>
                <div className="field">
                  <label className="field-label">Agency <span className="req">*</span></label>
                  <select className="select" value={clientForm.agencyId} onChange={e => setClientForm(p => ({ ...p, agencyId: e.target.value }))}>
                    <option value="">Select agency...</option>
                    {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  {editingClient && (
                    <p style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 0' }}>
                      Changing the agency moves this client (and all its channels &amp; properties) to the selected agency.
                    </p>
                  )}
                </div>
                <div className="field">
                  <label className="field-label">Commission / AOR</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select
                      className="select"
                      value={clientForm.commissionType}
                      onChange={e => setClientForm(p => ({ ...p, commissionType: e.target.value, commissionValue: e.target.value ? p.commissionValue : '' }))}
                      style={{ maxWidth: 180 }}
                    >
                      <option value="">None</option>
                      <option value="COMMISSION">Commission (%)</option>
                      <option value="AOR">AOR (fixed LKR)</option>
                    </select>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      min="0"
                      disabled={!clientForm.commissionType}
                      value={clientForm.commissionValue}
                      onChange={e => setClientForm(p => ({ ...p, commissionValue: e.target.value }))}
                      placeholder={clientForm.commissionType === 'AOR' ? 'e.g. 50000' : clientForm.commissionType === 'COMMISSION' ? 'e.g. 4' : '-'}
                      style={{ flex: 1 }}
                    />
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 0' }}>
                    Shown in the Forecasting → Overall Budget tab. Commission is a %, AOR is a fixed LKR fee.
                  </p>
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setShowClientModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={clientSubmitting}>{clientSubmitting ? 'Saving...' : editingClient ? 'Save Changes' : 'Add Client'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ COMMISSION SCOPE MODAL ============ */}
      {scopePrompt && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) cancelScope(); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 470 }}>
            <div className="modal-head">
              <h2>Apply commission to records?</h2>
              <button className="act-btn" onClick={cancelScope}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body">
              {clientError && (
                <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>{clientError}</div>
              )}
              <p style={{ fontSize: 13.5, color: 'var(--ink-soft,#3B4A63)', margin: 0, lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--ink)' }}>{scopePrompt.clientName}</strong> has existing spend records. How should the new commission apply to the Profit tab?
              </p>
              <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
                {[
                  { scope: 'all', title: 'Change all records', desc: 'Recalculate every past month with the new rate (overwrites earlier snapshots). Use this to fix a wrong rate.' },
                  { scope: 'forward', title: 'From now on only', desc: 'Keep past records exactly as they are; apply the new rate only to spend uploaded from now on.' },
                ].map(o => (
                  <button key={o.scope} type="button" disabled={clientSubmitting} onClick={() => chooseScope(o.scope)}
                    style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card)', cursor: clientSubmitting ? 'wait' : 'pointer', display: 'block', width: '100%' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--coral-400,#E8834F)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--ink)' }}>{o.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{o.desc}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={cancelScope} disabled={clientSubmitting}>Cancel</button>
            </div>
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
                  <label className="field-label">Team Head</label>
                  <select className="select" value={teamForm.headUserId} onChange={e => setTeamForm(p => ({ ...p, headUserId: e.target.value }))}>
                    <option value="">No head assigned</option>
                    {users.filter(u => u.role === 'GROUP_HEAD').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                    Each client below reports to this team's head. A client can only belong to one team at a time.
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
                      .map(c => {
                        const owner = teams.find(t => t.id !== editingTeam?.id && t.clients?.some(tc => tc.id === c.id));
                        return (
                          <button key={c.id} type="button" className={'chip' + (teamForm.clientIds.includes(c.id) ? ' active' : '')} onClick={() => setTeamForm(p => ({ ...p, clientIds: toggleArrayItem(p.clientIds, c.id) }))} title={owner ? `Currently on team "${owner.name}": adding here will move it` : ''}>
                            {c.name}{owner ? ` (on ${owner.name})` : ''}
                            {teamForm.clientIds.includes(c.id) ? <Icon name="x" size={12} /> : <Icon name="plus" size={12} />}
                          </button>
                        );
                      })}
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

      {/* ============ CHANNEL MODAL ============ */}
      {showChannelModal && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setShowChannelModal(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-head">
              <h2>{editingChannel ? 'Edit Channel' : 'Add Channel'}</h2>
              <button className="act-btn" onClick={() => setShowChannelModal(false)}><Icon name="x" size={18} /></button>
            </div>
            <form onSubmit={handleChannelSubmit}>
              <div className="modal-body">
                {channelError && (
                  <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>{channelError}</div>
                )}
                <div className="field">
                  <label className="field-label">Channel Name <span className="req">*</span></label>
                  <input className="input" type="text" value={channelForm.name} onChange={e => setChannelForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Hiru TV" />
                </div>
                <div className="field-grid2">
                  <div className="field">
                    <label className="field-label">Medium <span className="req">*</span></label>
                    <select className="select" value={channelForm.medium} onChange={e => setChannelForm(p => ({ ...p, medium: e.target.value }))}>
                      {MEDIUMS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label className="field-label">Media Group <span className="req">*</span></label>
                    <select className="select" value={channelForm.mediaGroupId} onChange={e => setChannelForm(p => ({ ...p, mediaGroupId: e.target.value }))}>
                      <option value="">Select media group...</option>
                      {mediaGroups.filter(g => g.active !== false || String(g.id) === channelForm.mediaGroupId).map(g => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label className="field-label">Aliases</label>
                  <input className="input" type="text" value={channelForm.aliases} onChange={e => setChannelForm(p => ({ ...p, aliases: e.target.value }))} placeholder="Comma-separated, e.g. Hiru, HiruTV" />
                  <span style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                    Alternative names matched automatically when uploading sheets.
                  </span>
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setShowChannelModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={channelSubmitting}>{channelSubmitting ? 'Saving...' : editingChannel ? 'Save Changes' : 'Add Channel'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ MERGE CHANNEL MODAL ============ */}
      {showMergeModal && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) { setShowMergeModal(false); setMergeSource(null); } }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-head">
              <h2>Merge Channel</h2>
              <button className="act-btn" onClick={() => { setShowMergeModal(false); setMergeSource(null); }}><Icon name="x" size={18} /></button>
            </div>
            <form onSubmit={handleMergeSubmit}>
              <div className="modal-body">
                {mergeError && (
                  <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>{mergeError}</div>
                )}
                <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0, marginBottom: 16 }}>
                  Use this when two channel masters are duplicates of the same real channel (e.g. created under the wrong media group).
                  All schedule logs, upload rows, and aliases on <strong style={{ color: 'var(--ink)' }}>{mergeSource?.name}</strong> will move
                  to the channel you pick below, and <strong style={{ color: 'var(--ink)' }}>{mergeSource?.name}</strong> will be deactivated.
                  This cannot be undone.
                </p>
                <div className="field">
                  <label className="field-label">Merging</label>
                  <input className="input" type="text" value={mergeSource?.name || ''} disabled />
                </div>
                <div className="field">
                  <label className="field-label">Merge into <span className="req">*</span></label>
                  <select className="select" value={mergeTargetId} onChange={e => setMergeTargetId(e.target.value)}>
                    <option value="">Select target channel...</option>
                    {channelMasters
                      .filter(c => c.id !== mergeSource?.id)
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(c => (
                        <option key={c.id} value={c.id}>{c.name} ({c.medium}{c.mediaGroup?.name ? `, ${c.mediaGroup.name}` : ''})</option>
                      ))}
                  </select>
                  <span style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                    All data from "{mergeSource?.name}" will appear under this channel going forward.
                  </span>
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => { setShowMergeModal(false); setMergeSource(null); }}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={mergeSubmitting}>{mergeSubmitting ? 'Merging...' : 'Merge Channels'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ MERGE CLIENT MODAL ============ */}
      {showClientMerge && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) { setShowClientMerge(false); setClientMergeSource(null); } }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Merge Client</h2>
              <button className="act-btn" onClick={() => { setShowClientMerge(false); setClientMergeSource(null); }}><Icon name="x" size={18} /></button>
            </div>
            <form onSubmit={handleClientMergeSubmit}>
              <div className="modal-body">
                {clientMergeError && (
                  <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>{clientMergeError}</div>
                )}
                <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0, marginBottom: 16 }}>
                  Use this when two clients are duplicates of the same real client. All schedule logs, channels, brands,
                  forecasts, deals, and team/user assignments on <strong style={{ color: 'var(--ink)' }}>{clientMergeSource?.name}</strong> will
                  move to the client you pick below, and <strong style={{ color: 'var(--ink)' }}>{clientMergeSource?.name}</strong> will be deleted.
                  This cannot be undone.
                </p>
                <div className="field">
                  <label className="field-label">Merging</label>
                  <input className="input" type="text" value={clientMergeSource ? `${clientMergeSource.name}${clientMergeSource.agencyName ? ` (${clientMergeSource.agencyName})` : ''}` : ''} disabled />
                </div>
                <div className="field">
                  <label className="field-label">Merge into <span className="req">*</span></label>
                  <select className="select" value={clientMergeTargetId} onChange={e => setClientMergeTargetId(e.target.value)}>
                    <option value="">Select target client...</option>
                    {allClients
                      .filter(c => c.id !== clientMergeSource?.id)
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name) || (a.agencyName || '').localeCompare(b.agencyName || ''))
                      .map(c => (
                        <option key={c.id} value={c.id}>{c.name}{c.agencyName ? ` (${c.agencyName})` : ''}</option>
                      ))}
                  </select>
                  <span style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                    All data from "{clientMergeSource?.name}" will appear under this client going forward.
                  </span>
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => { setShowClientMerge(false); setClientMergeSource(null); }}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={clientMergeSubmitting}>{clientMergeSubmitting ? 'Merging...' : 'Merge Clients'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ MOVE CLIENT AGENCY MODAL ============ */}
      {showMove && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setShowMove(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Move to another agency</h2>
              <button className="act-btn" onClick={() => setShowMove(false)}><Icon name="x" size={18} /></button>
            </div>
            <form onSubmit={handleMoveSubmit}>
              <div className="modal-body">
                {moveError && <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>{moveError}</div>}
                {moveMsg && <div style={{ background: '#ECF8F1', border: '1px solid #cdebd9', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#15814B', marginBottom: 16 }}>{moveMsg}</div>}
                <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0, marginBottom: 16 }}>
                  Use this when a client changes agencies. Spend, revenue and profit from the effective
                  month onward move to the new agency; everything before it stays with
                  <strong style={{ color: 'var(--ink)' }}> {moveClient?.agencyName || 'the current agency'}</strong>.
                </p>
                <div className="field">
                  <label className="field-label">Client</label>
                  <input className="input" type="text" value={moveClient ? `${moveClient.name}${moveClient.agencyName ? ` — ${moveClient.agencyName}` : ''}` : ''} disabled />
                </div>
                <div className="field">
                  <label className="field-label">Move to agency <span className="req">*</span></label>
                  <select className="select" value={moveAgencyId} onChange={e => setMoveAgencyId(e.target.value)}>
                    <option value="">Select agency…</option>
                    {agencies
                      .filter(a => a.id !== moveClient?.agencyId)
                      .slice().sort((a, b) => a.name.localeCompare(b.name))
                      .map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Effective from (schedule month)</label>
                  <input className="input" type="month" value={moveMonth} onChange={e => setMoveMonth(e.target.value)} />
                  <span style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                    Schedules in this month and after go to the new agency. Leave blank to move the client’s <strong>entire</strong> history.
                  </span>
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setShowMove(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={moveSubmitting}>{moveSubmitting ? 'Moving…' : 'Move client'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ MEDIA GROUP MODAL ============ */}
      {showGroupModal && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setShowGroupModal(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{editingGroup ? 'Edit Media Group' : 'Add Media Group'}</h2>
              <button className="act-btn" onClick={() => setShowGroupModal(false)}><Icon name="x" size={18} /></button>
            </div>
            <form onSubmit={handleGroupSubmit}>
              <div className="modal-body">
                {groupError && (
                  <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>{groupError}</div>
                )}
                <div className="field">
                  <label className="field-label">Media Group Name <span className="req">*</span></label>
                  <input className="input" type="text" value={groupForm.name} onChange={e => setGroupForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Maharaja Group" />
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setShowGroupModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={groupSubmitting}>{groupSubmitting ? 'Saving...' : editingGroup ? 'Save Changes' : 'Add Media Group'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ PROPERTY CATEGORY MODAL ============ */}
      {showCatModal && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setShowCatModal(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{editingCat ? 'Edit Category' : 'Add Property Category'}</h2>
              <button className="act-btn" onClick={() => setShowCatModal(false)}><Icon name="x" size={18} /></button>
            </div>
            <form onSubmit={handleCatSubmit}>
              <div className="modal-body">
                {catError && (
                  <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>{catError}</div>
                )}
                <div className="field">
                  <label className="field-label">Category Name <span className="req">*</span></label>
                  <input className="input" type="text" value={catForm.name} onChange={e => setCatForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Drama Sponsorship" />
                  <span style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, display: 'block' }}>Appears in the Add Property category dropdown.</span>
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setShowCatModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={catSubmitting}>{catSubmitting ? 'Saving...' : editingCat ? 'Save Changes' : 'Add Category'}</button>
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
              {deleteError && (
                <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 14 }}>{deleteError}</div>
              )}
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
