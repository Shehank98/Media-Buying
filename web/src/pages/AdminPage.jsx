import { useState, useEffect } from 'react';
import {
  Building2,
  Users,
  UserPlus,
  Plus,
  Pencil,
  Trash2,
  Search,
  UsersRound,
} from 'lucide-react';
import api from '../lib/api';
import LoadingSpinner from '../components/LoadingSpinner';
import Modal from '../components/Modal';

const ROLES = ['SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD', 'PLANNER'];

export default function AdminPage({ initialTab = 'agencies' }) {
  const [activeTab, setActiveTab] = useState(initialTab);

  // Data
  const [agencies, setAgencies] = useState([]);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [allClients, setAllClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  // Agency modal
  const [showAgencyModal, setShowAgencyModal] = useState(false);
  const [editingAgency, setEditingAgency] = useState(null);
  const [agencyForm, setAgencyForm] = useState({ name: '' });
  const [agencySubmitting, setAgencySubmitting] = useState(false);
  const [agencyError, setAgencyError] = useState('');

  // User modal
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userForm, setUserForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'PLANNER',
    agencyIds: [],
    clientIds: [],
  });
  const [userSubmitting, setUserSubmitting] = useState(false);
  const [userError, setUserError] = useState('');

  // Team modal
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);
  const [teamForm, setTeamForm] = useState({
    name: '',
    agencyId: '',
    memberIds: [],
    clientIds: [],
  });
  const [teamSubmitting, setTeamSubmitting] = useState(false);
  const [teamError, setTeamError] = useState('');

  // Delete modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteType, setDeleteType] = useState('');
  const [deleting, setDeleting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [agenciesRes, usersRes, teamsRes] = await Promise.allSettled([
        api.get('/admin/agencies'),
        api.get('/admin/users'),
        api.get('/admin/teams'),
      ]);

      if (agenciesRes.status === 'fulfilled') {
        const agencyData = agenciesRes.value.data.agencies || agenciesRes.value.data || [];
        setAgencies(agencyData);
        // Build clients list from agencies
        const clients = agencyData.flatMap(
          (a) =>
            (a.clients || []).map((c) => ({ ...c, agencyName: a.name }))
        );
        setAllClients(clients);
      }
      if (usersRes.status === 'fulfilled') {
        setUsers(usersRes.value.data.users || usersRes.value.data || []);
      }
      if (teamsRes.status === 'fulfilled') {
        setTeams(teamsRes.value.data.teams || teamsRes.value.data || []);
      }
    } catch {
      setError('Failed to load admin data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Agency CRUD
  const openAddAgency = () => {
    setEditingAgency(null);
    setAgencyForm({ name: '' });
    setAgencyError('');
    setShowAgencyModal(true);
  };

  const openEditAgency = (agency) => {
    setEditingAgency(agency);
    setAgencyForm({ name: agency.name });
    setAgencyError('');
    setShowAgencyModal(true);
  };

  const handleAgencySubmit = async (e) => {
    e.preventDefault();
    setAgencyError('');
    if (!agencyForm.name.trim()) {
      setAgencyError('Agency name is required.');
      return;
    }
    setAgencySubmitting(true);
    try {
      if (editingAgency) {
        await api.put(`/admin/agencies/${editingAgency.id}`, agencyForm);
      } else {
        await api.post('/admin/agencies', agencyForm);
      }
      setShowAgencyModal(false);
      await fetchData();
    } catch (err) {
      setAgencyError(err.response?.data?.message || 'Failed to save agency.');
    } finally {
      setAgencySubmitting(false);
    }
  };

  // User CRUD
  const openAddUser = () => {
    setEditingUser(null);
    setUserForm({
      name: '',
      email: '',
      password: '',
      role: 'PLANNER',
      agencyIds: [],
      clientIds: [],
    });
    setUserError('');
    setShowUserModal(true);
  };

  const openEditUser = (u) => {
    setEditingUser(u);
    setUserForm({
      name: u.name,
      email: u.email,
      password: '',
      role: u.role,
      agencyIds: u.agencies?.map((a) => a.id) || u.agencyIds || [],
      clientIds: u.clients?.map((c) => c.id) || u.clientIds || [],
    });
    setUserError('');
    setShowUserModal(true);
  };

  const handleUserSubmit = async (e) => {
    e.preventDefault();
    setUserError('');
    if (!userForm.name.trim()) {
      setUserError('Name is required.');
      return;
    }
    if (!editingUser && !userForm.email.trim()) {
      setUserError('Email is required.');
      return;
    }
    if (!editingUser && !userForm.password.trim()) {
      setUserError('Temporary password is required.');
      return;
    }
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

  // Team CRUD
  const openAddTeam = () => {
    setEditingTeam(null);
    setTeamForm({ name: '', agencyId: '', memberIds: [], clientIds: [] });
    setTeamError('');
    setShowTeamModal(true);
  };

  const openEditTeam = (team) => {
    setEditingTeam(team);
    setTeamForm({
      name: team.name,
      agencyId: team.agencyId || '',
      memberIds: team.members?.map((m) => m.id) || team.memberIds || [],
      clientIds: team.clients?.map((c) => c.id) || team.clientIds || [],
    });
    setTeamError('');
    setShowTeamModal(true);
  };

  const handleTeamSubmit = async (e) => {
    e.preventDefault();
    setTeamError('');
    if (!teamForm.name.trim()) {
      setTeamError('Team name is required.');
      return;
    }
    if (!teamForm.agencyId) {
      setTeamError('Agency is required.');
      return;
    }
    setTeamSubmitting(true);
    try {
      if (editingTeam) {
        await api.put(`/admin/teams/${editingTeam.id}`, teamForm);
      } else {
        await api.post('/admin/teams', teamForm);
      }
      setShowTeamModal(false);
      await fetchData();
    } catch (err) {
      setTeamError(err.response?.data?.message || 'Failed to save team.');
    } finally {
      setTeamSubmitting(false);
    }
  };

  // Delete
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

  const toggleArrayItem = (arr, id) => {
    return arr.includes(id) ? arr.filter((i) => i !== id) : [...arr, id];
  };

  if (loading) {
    return <LoadingSpinner size="lg" className="py-20" />;
  }

  const tabs = [
    { key: 'agencies', label: 'Agencies', icon: Building2, count: agencies.length },
    { key: 'users', label: 'Users', icon: Users, count: users.length },
    { key: 'teams', label: 'Teams', icon: UsersRound, count: teams.length },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Administration</h1>
        <p className="text-gray-500 mt-1">
          Manage agencies, users, and teams.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {error}
          <button
            onClick={() => setError('')}
            className="ml-2 text-red-800 font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
                setSearch('');
              }}
              className={`flex items-center gap-2 pb-3 border-b-2 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  activeTab === tab.key
                    ? 'bg-indigo-50 text-indigo-600'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </nav>
      </div>

      {/* Search + Add bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder={`Search ${activeTab}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 rounded-lg border border-gray-300 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-colors w-full sm:w-64"
          />
        </div>
        <button
          onClick={
            activeTab === 'agencies'
              ? openAddAgency
              : activeTab === 'users'
              ? openAddUser
              : openAddTeam
          }
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 transition-colors"
        >
          {activeTab === 'users' ? (
            <UserPlus className="h-4 w-4" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Add{' '}
          {activeTab === 'agencies'
            ? 'Agency'
            : activeTab === 'users'
            ? 'User'
            : 'Team'}
        </button>
      </div>

      {/* Agencies Table */}
      {activeTab === 'agencies' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Name
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">
                    Created
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">
                    Clients
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {agencies
                  .filter((a) =>
                    a.name.toLowerCase().includes(search.toLowerCase())
                  )
                  .map((agency) => (
                    <tr
                      key={agency.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {agency.name}
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
                        {agency.createdAt
                          ? new Date(agency.createdAt).toLocaleDateString()
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
                        {agency.clientCount || agency._count?.clients || agency.clients?.length || 0}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEditAgency(agency)}
                            className="rounded-lg p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => confirmDelete(agency, 'agencies')}
                            className="rounded-lg p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Users Table */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Name
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">
                    Email
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Role
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">
                    Agencies
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users
                  .filter(
                    (u) =>
                      u.name.toLowerCase().includes(search.toLowerCase()) ||
                      u.email.toLowerCase().includes(search.toLowerCase())
                  )
                  .map((u) => (
                    <tr
                      key={u.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {u.name}
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">
                        {u.email}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-indigo-50 text-indigo-700">
                          {u.role?.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">
                        {u.agencies
                          ?.map((a) => a.name)
                          .join(', ') || '-'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEditUser(u)}
                            className="rounded-lg p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => confirmDelete(u, 'users')}
                            className="rounded-lg p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Teams Table */}
      {activeTab === 'teams' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Team Name
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">
                    Agency
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Members
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">
                    Clients
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {teams
                  .filter((t) =>
                    t.name.toLowerCase().includes(search.toLowerCase())
                  )
                  .map((team) => (
                    <tr
                      key={team.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {team.name}
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">
                        {team.agency?.name || team.agencyName || '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {team.memberCount || team._count?.members || team.members?.length || 0}
                      </td>
                      <td className="px-4 py-3 text-gray-600 hidden md:table-cell">
                        {team.clientCount || team._count?.clients || team.clients?.length || 0}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEditTeam(team)}
                            className="rounded-lg p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => confirmDelete(team, 'teams')}
                            className="rounded-lg p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Agency Modal */}
      <Modal
        isOpen={showAgencyModal}
        onClose={() => setShowAgencyModal(false)}
        title={editingAgency ? 'Edit Agency' : 'Add Agency'}
      >
        {agencyError && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            {agencyError}
          </div>
        )}
        <form onSubmit={handleAgencySubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Agency Name
            </label>
            <input
              type="text"
              required
              value={agencyForm.name}
              onChange={(e) =>
                setAgencyForm((prev) => ({ ...prev, name: e.target.value }))
              }
              className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-colors"
              placeholder="Enter agency name"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowAgencyModal(false)}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={agencySubmitting}
              className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {agencySubmitting
                ? 'Saving...'
                : editingAgency
                ? 'Save Changes'
                : 'Add Agency'}
            </button>
          </div>
        </form>
      </Modal>

      {/* User Modal */}
      <Modal
        isOpen={showUserModal}
        onClose={() => setShowUserModal(false)}
        title={editingUser ? 'Edit User' : 'Add User'}
        maxWidth="max-w-2xl"
      >
        {userError && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            {userError}
          </div>
        )}
        <form onSubmit={handleUserSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Name
              </label>
              <input
                type="text"
                required
                value={userForm.name}
                onChange={(e) =>
                  setUserForm((prev) => ({ ...prev, name: e.target.value }))
                }
                className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-colors"
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Email
              </label>
              <input
                type="email"
                required={!editingUser}
                disabled={!!editingUser}
                value={userForm.email}
                onChange={(e) =>
                  setUserForm((prev) => ({ ...prev, email: e.target.value }))
                }
                className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-colors disabled:bg-gray-50 disabled:text-gray-400"
                placeholder="user@example.com"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {!editingUser && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Temporary Password
                </label>
                <input
                  type="password"
                  required
                  value={userForm.password}
                  onChange={(e) =>
                    setUserForm((prev) => ({
                      ...prev,
                      password: e.target.value,
                    }))
                  }
                  className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-colors"
                  placeholder="Temporary password"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Role
              </label>
              <select
                value={userForm.role}
                onChange={(e) =>
                  setUserForm((prev) => ({ ...prev, role: e.target.value }))
                }
                className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-colors"
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Agency assignment */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Assigned Agencies
            </label>
            <div className="border border-gray-200 rounded-lg p-3 max-h-36 overflow-y-auto space-y-2">
              {agencies.length === 0 ? (
                <p className="text-sm text-gray-400">No agencies available.</p>
              ) : (
                agencies.map((a) => (
                  <label
                    key={a.id}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={userForm.agencyIds.includes(a.id)}
                      onChange={() =>
                        setUserForm((prev) => ({
                          ...prev,
                          agencyIds: toggleArrayItem(prev.agencyIds, a.id),
                        }))
                      }
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-gray-700">{a.name}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Client assignment */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Assigned Clients
            </label>
            <div className="border border-gray-200 rounded-lg p-3 max-h-36 overflow-y-auto space-y-2">
              {allClients.length === 0 ? (
                <p className="text-sm text-gray-400">No clients available.</p>
              ) : (
                allClients.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={userForm.clientIds.includes(c.id)}
                      onChange={() =>
                        setUserForm((prev) => ({
                          ...prev,
                          clientIds: toggleArrayItem(prev.clientIds, c.id),
                        }))
                      }
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-gray-700">
                      {c.name}
                      {c.agencyName && (
                        <span className="text-gray-400 ml-1">
                          ({c.agencyName})
                        </span>
                      )}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowUserModal(false)}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={userSubmitting}
              className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {userSubmitting
                ? 'Saving...'
                : editingUser
                ? 'Save Changes'
                : 'Add User'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Team Modal */}
      <Modal
        isOpen={showTeamModal}
        onClose={() => setShowTeamModal(false)}
        title={editingTeam ? 'Edit Team' : 'Add Team'}
        maxWidth="max-w-2xl"
      >
        {teamError && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            {teamError}
          </div>
        )}
        <form onSubmit={handleTeamSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Team Name
              </label>
              <input
                type="text"
                required
                value={teamForm.name}
                onChange={(e) =>
                  setTeamForm((prev) => ({ ...prev, name: e.target.value }))
                }
                className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-colors"
                placeholder="Team name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Agency
              </label>
              <select
                required
                value={teamForm.agencyId}
                onChange={(e) =>
                  setTeamForm((prev) => ({
                    ...prev,
                    agencyId: e.target.value,
                  }))
                }
                className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-colors"
              >
                <option value="">Select agency...</option>
                {agencies.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Members */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Members
            </label>
            <div className="border border-gray-200 rounded-lg p-3 max-h-36 overflow-y-auto space-y-2">
              {users.length === 0 ? (
                <p className="text-sm text-gray-400">No users available.</p>
              ) : (
                users.map((u) => (
                  <label
                    key={u.id}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={teamForm.memberIds.includes(u.id)}
                      onChange={() =>
                        setTeamForm((prev) => ({
                          ...prev,
                          memberIds: toggleArrayItem(prev.memberIds, u.id),
                        }))
                      }
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-gray-700">
                      {u.name}{' '}
                      <span className="text-gray-400">
                        ({u.role?.replace('_', ' ')})
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Clients */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Assigned Clients
            </label>
            <div className="border border-gray-200 rounded-lg p-3 max-h-36 overflow-y-auto space-y-2">
              {allClients.length === 0 ? (
                <p className="text-sm text-gray-400">No clients available.</p>
              ) : (
                allClients
                  .filter(
                    (c) => !teamForm.agencyId || c.agencyId === teamForm.agencyId
                  )
                  .map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={teamForm.clientIds.includes(c.id)}
                        onChange={() =>
                          setTeamForm((prev) => ({
                            ...prev,
                            clientIds: toggleArrayItem(prev.clientIds, c.id),
                          }))
                        }
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-gray-700">{c.name}</span>
                    </label>
                  ))
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowTeamModal(false)}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={teamSubmitting}
              className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {teamSubmitting
                ? 'Saving...'
                : editingTeam
                ? 'Save Changes'
                : 'Add Team'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setDeleteTarget(null);
        }}
        title={`Delete ${deleteType.slice(0, -1)}`}
      >
        <p className="text-gray-600 mb-6">
          Are you sure you want to delete{' '}
          <span className="font-semibold text-gray-900">
            {deleteTarget?.name || deleteTarget?.email}
          </span>
          ? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              setShowDeleteModal(false);
              setDeleteTarget(null);
            }}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-500 disabled:opacity-50 transition-colors"
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
