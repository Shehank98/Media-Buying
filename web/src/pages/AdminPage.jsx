import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import * as XLSX from 'xlsx';
import Icon, { Avatar, RoleBadge, fmtLKR, roleLabel } from '../components/Icon';
import MoneyInput from '../components/MoneyInput';
import api from '../lib/api';
import OrbitLoader from '../components/OrbitLoader';
import ClientGroupsTab from '../components/ClientGroupsTab';
import ClientGroupTargetsTab from '../components/ClientGroupTargetsTab';
import { TOGGLEABLE_PAGES } from '../lib/permissions';
import { writeBrandedWorkbook } from '../lib/brandedXlsx';

const ROLES = ['SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD', 'PLANNER'];

const MEDIUMS = ['TV', 'RADIO', 'PRINT', 'DIGITAL', 'CINEMA', 'OOH'];

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

// Full LKR with thousands separators (no M/K abbreviation) - used where the
// exact figure must be readable/re-enterable, e.g. a disputed revenue amount.
const fmtLKRFull = (v) => (v == null || v === '' ? '-' : 'LKR ' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// Parse a money cell that may use accounting parentheses for negatives, e.g.
// "(1,000)" → -1000, "-1000" → -1000, "1,000" → 1000, "" → null.
function parseAccountingAmount(v) {
  if (v == null) return null;
  let s = String(v).trim();
  if (s === '') return null;
  const neg = (s.startsWith('(') && s.includes(')')) || s.trim().startsWith('-');
  s = s.replace(/[^0-9.]/g, ''); // strip parens, commas, sign, currency, spaces
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Dice coefficient on character bigrams - a cheap fuzzy-name similarity (0..1).
function diceSim(a, b) {
  a = normName(a); b = normName(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const bg = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const ma = bg(a), mb = bg(b);
  let inter = 0;
  ma.forEach((cnt, g) => { if (mb.has(g)) inter += Math.min(cnt, mb.get(g)); });
  return (2 * inter) / ((a.length - 1) + (b.length - 1));
}

// Rank roster clients by name similarity to a raw imported name.
function suggestClients(rawName, clients) {
  const target = normName(rawName);
  return clients
    .map((c) => {
      const n = normName(c.name);
      let score = diceSim(rawName, c.name);
      if (n === target) score = 1;
      else if (target && (n.includes(target) || target.includes(n))) score = Math.max(score, 0.82);
      return { clientId: c.clientId, name: c.name, score };
    })
    .filter((s) => s.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

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
  const [activeTab, setActiveTab] = useState(
    initialTab === 'client-requests' || initialTab === 'channel-requests' ? 'requests'
      : initialTab === 'teams' ? 'users'   // Teams tab removed; fold into Users
        : initialTab,
  );
  const [requestSubTab, setRequestSubTab] = useState(initialTab === 'client-requests' ? 'client' : 'channel');

  /* ---- data ---- */
  const [agencies, setAgencies] = useState([]);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [allClients, setAllClients] = useState([]);
  const [mediaGroups, setMediaGroups] = useState([]);
  const [channelMasters, setChannelMasters] = useState([]);
  const [deletedChannels, setDeletedChannels] = useState([]);
  const [restoringId, setRestoringId] = useState(null);
  const [expandedGroup, setExpandedGroup] = useState(null); // media-group id whose channels are shown
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  /* ---- error logs ---- */
  const [errorLogs, setErrorLogs] = useState([]);
  const [errLoading, setErrLoading] = useState(false);
  const [errFilter, setErrFilter] = useState('unresolved'); // unresolved | all | frontend | backend
  const [errUnresolved, setErrUnresolved] = useState(0);
  const [errTotal, setErrTotal] = useState(0);
  const [errExpanded, setErrExpanded] = useState(null); // id of the expanded row (full message + stack)

  /* ---- client records (Admin → Database) ---- */
  const [recAgencyId, setRecAgencyId] = useState('');    // optional agency narrowing for the picker
  const [recClientId, setRecClientId] = useState('');
  const [recSummary, setRecSummary] = useState(null);
  const [recLoading, setRecLoading] = useState(false);
  const [recConfirmName, setRecConfirmName] = useState('');
  const [recPurging, setRecPurging] = useState(false);
  const [recResult, setRecResult] = useState('');
  const [recError, setRecError] = useState('');

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

  /* ---- channel rate card upload ---- */
  const rcInputRef = useRef(null);
  const [rcTarget, setRcTarget] = useState(null);
  const [rcBusyId, setRcBusyId] = useState(null);

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

  /* ---- direct placements (the digital roll-up bucket) ---- */
  const [dpChannels, setDpChannels] = useState([]);      // every digital channel master
  const [dpSelected, setDpSelected] = useState([]);      // ids currently in the bucket (local, saved on Save)
  const [dpSearch, setDpSearch] = useState('');
  const [dpLoading, setDpLoading] = useState(false);
  const [dpSaving, setDpSaving] = useState(false);
  const [dpSavedAt, setDpSavedAt] = useState(null);

  /* ---- annual targets ---- */
  const [annualTargets, setAnnualTargets] = useState([]);
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [editingTarget, setEditingTarget] = useState(null);
  const [targetForm, setTargetForm] = useState({ year: '', totalTargetMillions: '', remoteMonth: '' });

  /* ---- per-agency annual targets (Spend Analytics agency achievement) ---- */
  const [agTargetYear, setAgTargetYear] = useState(new Date().getFullYear());
  const [agTargetYears, setAgTargetYears] = useState([]);
  const [agTargets, setAgTargets] = useState([]);       // [{ agencyId, agencyName, totalTargetMillions }]
  const [agTargetVals, setAgTargetVals] = useState({}); // { agencyId: '2000' }
  const [agTargetLoading, setAgTargetLoading] = useState(false);
  const [agTargetSavingId, setAgTargetSavingId] = useState(null);
  const [targetSubmitting, setTargetSubmitting] = useState(false);
  const [targetError, setTargetError] = useState('');

  /* ---- forecasting requests ---- */
  const [clientRequests, setClientRequests] = useState([]);
  const [channelRequests, setChannelRequests] = useState([]);
  const [channelReqGroup, setChannelReqGroup] = useState({}); // { requestId: mediaGroupId } for approval

  /* ---- group revenue contribution (per group head, per month) ---- */
  const now = new Date();
  const [grYear, setGrYear] = useState(now.getFullYear());
  const [grMonth, setGrMonth] = useState(now.getMonth() + 1); // 1-12
  const [grHeads, setGrHeads] = useState([]);          // [{ headUserId, headName, amount }]
  const [grAmounts, setGrAmounts] = useState({});      // { headUserId: '12345' }
  const [grAgencies, setGrAgencies] = useState([]);    // [{ agencyId, agencyName, amount }]
  const [grAgencyAmounts, setGrAgencyAmounts] = useState({}); // { agencyId: '12345' }
  const [grClients, setGrClients] = useState([]);      // [{ clientId, name, agencyName, headName, amount }]
  const [grClientAmounts, setGrClientAmounts] = useState({}); // { clientId: '12345' }
  const [grClientFinanceAmounts, setGrClientFinanceAmounts] = useState({}); // { clientId: '12345' } Rev. from finance
  const [crSave, setCrSave] = useState({}); // { clientId: 'saving' | 'saved' } auto-save mark
  const crEditsRef = useRef({ amounts: {}, finance: {} }); // latest edits for debounced save
  const crTimersRef = useRef({}); // { clientId: timeoutId }
  const grCtxRef = useRef({ year: null, month: null });
  // Excel import of Revenue by Client
  const [crImport, setCrImport] = useState(null); // { fileName, rows: [{ id, rawClient, revenue, finance, matchId, suggestions }] }
  const [crImporting, setCrImporting] = useState(false);
  const crFileRef = useRef(null);
  const [grRevMode, setGrRevMode] = useState('head'); // 'head' | 'client'
  const [grRevenueTarget, setGrRevenueTarget] = useState(''); // annual revenue target (full LKR)
  const [grLoading, setGrLoading] = useState(false);
  const [grSaving, setGrSaving] = useState(false);
  const [grSavedAt, setGrSavedAt] = useState(null);
  const [grInit, setGrInit] = useState(false); // pinned form to the dashboard's revenue month yet?

  /* ---- monthly actual billing (company-wide, one figure per month) ---- */
  const [billingAmount, setBillingAmount] = useState('');   // for grYear/grMonth
  const [billingSaving, setBillingSaving] = useState(false);
  const [billingSavedAt, setBillingSavedAt] = useState(null);

  /* ---- AOR revenue (monthly per-channel lines; company-wide) ---- */
  const [aorYear, setAorYear] = useState(now.getFullYear());
  const [aorMonth, setAorMonth] = useState(now.getMonth() + 1); // 1-12
  const [aorEntries, setAorEntries] = useState([]);        // all rows for aorYear
  const [aorMonthTotals, setAorMonthTotals] = useState({}); // { month: total }
  const [aorLoading, setAorLoading] = useState(false);
  const [aorSaving, setAorSaving] = useState(false);
  const [aorForm, setAorForm] = useState({ channel: '', amount: '', reason: '' });

  /* ---- channel commitments (yearly target per channel) ---- */
  const [ccChannels, setCcChannels] = useState([]);   // [{ channelMasterId, name, medium, mediaGroup, monthlyAmount, start/end }]
  // per-channel commitment: { monthlyAmount, startMonth, startYear, endMonth, endYear }
  const [ccRows, setCcRows] = useState({});
  const [ccLoading, setCcLoading] = useState(false);
  const [ccSavingId, setCcSavingId] = useState(null);
  const [ccSearch, setCcSearch] = useState('');
  const [ccSubTab, setCcSubTab] = useState('channel'); // 'channel' | 'group'
  const [ccMedium, setCcMedium] = useState(''); // active medium tab (single-channel view)
  // Deal groups: one target across several channels (combined achievement).
  const [cgGroups, setCgGroups] = useState([]);
  const [cgModalOpen, setCgModalOpen] = useState(false);
  const [cgSaving, setCgSaving] = useState(false);
  const [cgError, setCgError] = useState('');
  const emptyCgForm = () => {
    const y = new Date().getFullYear();
    return { id: null, name: '', type: 'ANNUAL', amount: '', channelMasterIds: [], startMonth: 1, startYear: y, endMonth: 12, endYear: y };
  };
  const [cgForm, setCgForm] = useState(emptyCgForm());
  const [cgChannelSearch, setCgChannelSearch] = useState('');

  /* ---- client yearly targets ---- */
  const [ctYear, setCtYear] = useState(new Date().getFullYear());
  const [ctYears, setCtYears] = useState([]);
  const [ctClients, setCtClients] = useState([]);   // [{ clientId, name, agencyName, amount }]
  const [ctAmounts, setCtAmounts] = useState({});   // { clientId: '120000000' }
  const [ctLoading, setCtLoading] = useState(false);
  const [ctSavingId, setCtSavingId] = useState(null);
  const [ctSearch, setCtSearch] = useState('');
  const [ctSavedId, setCtSavedId] = useState(null); // last client saved (transient tick)

  /* ---- database backup (Google Drive) ---- */
  const [backup, setBackup] = useState(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupMsg, setBackupMsg] = useState('');
  // Schedule-log yearly archive to Drive
  const [slArchive, setSlArchive] = useState(null); // { configured, years: [{year, rows}] }
  const [slYear, setSlYear] = useState('');
  const [slArchiving, setSlArchiving] = useState(false);
  const [slMsg, setSlMsg] = useState('');
  const fetchScheduleArchive = async () => {
    try {
      const { data } = await api.get('/admin/schedule-logs/archive');
      setSlArchive(data);
      if (data.years?.length && !slYear) setSlYear(String(data.years[0].year));
    } catch { setSlArchive(null); }
  };
  const archiveScheduleYear = async () => {
    if (!slYear) return;
    setSlArchiving(true); setSlMsg('');
    try {
      const { data } = await api.post('/admin/schedule-logs/archive', { year: Number(slYear) });
      setSlMsg(`Exported ${data.rows.toLocaleString('en-US')} rows (${data.columns} columns) to Drive: ${data.folder} / ${data.fileName}`);
    } catch (err) {
      setSlMsg(err.response?.data?.error || 'Failed to export schedule logs.');
    } finally { setSlArchiving(false); }
  };
  const fetchBackup = async () => {
    setBackupLoading(true);
    try {
      const { data } = await api.get('/admin/backup/status');
      setBackup(data);
    } catch { setBackup(null); }
    finally { setBackupLoading(false); }
  };
  useEffect(() => {
    if (activeTab === 'backup') { fetchBackup(); fetchScheduleArchive(); }
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

  // Per-tab Excel export (revenue / master data / targets) to Google Drive.
  const [dataExport, setDataExport] = useState(null);
  const [dataExportRunning, setDataExportRunning] = useState(false);
  const [dataExportMsg, setDataExportMsg] = useState('');
  const fetchDataExport = async () => {
    try { const { data } = await api.get('/admin/backup/data-export/status'); setDataExport(data); }
    catch { setDataExport(null); }
  };
  useEffect(() => {
    if (activeTab === 'backup') fetchDataExport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);
  const runDataExportNow = async () => {
    setDataExportRunning(true); setDataExportMsg('');
    try {
      const { data } = await api.post('/admin/backup/data-export/run');
      const r = data.result || {};
      const okCount = (r.datasets || []).filter((d) => !d.error).length;
      setDataExportMsg(`Exported ${okCount}/${(r.datasets || []).length} tabs to Google Drive.`);
      await fetchDataExport();
    } catch (err) {
      setDataExportMsg(err.response?.data?.error || 'Data export failed.');
    } finally { setDataExportRunning(false); }
  };

  const [backupDownloading, setBackupDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const restoreInputRef = useRef(null);

  // Download a fresh full-database dump (all data + settings) to the browser.
  const downloadBackupNow = async () => {
    setBackupDownloading(true); setBackupMsg('');
    try {
      const res = await api.get('/admin/backup/download', { responseType: 'blob' });
      const cd = res.headers['content-disposition'] || '';
      const m = /filename="?([^"]+)"?/.exec(cd);
      const name = (m && m[1]) || `orbit-backup-${new Date().toISOString().slice(0, 10)}.sql.gz`;
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click();
      a.remove(); window.URL.revokeObjectURL(url);
      setBackupMsg(`Backup downloaded: ${name}`);
    } catch (err) {
      setBackupMsg(err.response?.data?.error || 'Download failed.');
    } finally { setBackupDownloading(false); }
  };

  // Restore the whole database from a chosen dump file. DESTRUCTIVE.
  const restoreFromFile = async (file) => {
    if (!file) return;
    const ok = window.confirm(
      `Restore the ENTIRE database from "${file.name}"?\n\n` +
      'This REPLACES all current data, targets, settings and numbers with the ' +
      'contents of this backup. It cannot be undone. Continue?');
    if (!ok) return;
    setRestoring(true); setBackupMsg('');
    try {
      const buf = await file.arrayBuffer();
      const { data } = await api.post('/admin/backup/restore', buf, {
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      setBackupMsg(data.message || 'Database restored.');
      await fetchBackup();
    } catch (err) {
      setBackupMsg(err.response?.data?.detail || err.response?.data?.error || 'Restore failed.');
    } finally {
      setRestoring(false);
      if (restoreInputRef.current) restoreInputRef.current.value = '';
    }
  };

  // Restore from one of the backups already in the Drive folder. DESTRUCTIVE.
  const restoreFromDriveBackup = async (f) => {
    const ok = window.confirm(
      `Restore the ENTIRE database from the Drive backup "${f.name}"?\n\n` +
      'This REPLACES all current data with that backup and cannot be undone. Continue?');
    if (!ok) return;
    setRestoring(true); setBackupMsg('');
    try {
      const { data } = await api.post('/admin/backup/restore-drive', { fileId: f.id });
      setBackupMsg(data.message || 'Database restored.');
      await fetchBackup();
    } catch (err) {
      setBackupMsg(err.response?.data?.detail || err.response?.data?.error || 'Restore failed.');
    } finally { setRestoring(false); }
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
      // Recently-deleted channels (for the restore panel) - best-effort.
      api.get('/masterdata/channel-masters/deleted')
        .then((r) => setDeletedChannels(Array.isArray(r.data.channelMasters) ? r.data.channelMasters : []))
        .catch(() => {});
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
      if (kind === 'channel' && status === 'approved') {
        const gid = channelReqGroup[r.id];
        if (!gid) { setError('Pick a media group for this channel before approving.'); return; }
        body.mediaGroupId = parseInt(gid);
      }
      await api.put(`/admin/${kind === 'client' ? 'client-requests' : 'channel-requests'}/${r.id}`, body);
      setError('');
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

  const restoreChannel = async (ch) => {
    setRestoringId(ch.id);
    try {
      await api.patch(`/masterdata/channel-masters/${ch.id}/restore`);
      await fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to restore channel.');
    } finally {
      setRestoringId(null);
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

  // Download every usage (schedule-log) row for a single channel as Excel.
  const [chLogBusyId, setChLogBusyId] = useState(null);
  const downloadChannelLogs = async ch => {
    setChLogBusyId(ch.id);
    try {
      const res = await api.get('/reports/schedule-logs', {
        params: { channelMasterId: ch.id, groupBy: 'all', format: 'excel' },
        responseType: 'blob',
      });
      const safe = String(ch.name || 'channel').replace(/[\\/:*?"<>|]+/g, ' ').trim();
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.download = `usage-logs-${safe}.xlsx`; document.body.appendChild(a); a.click();
      a.remove(); window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to download usage logs.');
    } finally { setChLogBusyId(null); }
  };

  // ── Channel rate card (PDF in Google Drive) ──
  const pickRateCard = ch => { setRcTarget(ch); rcInputRef.current?.click(); };
  const onRateCardFile = async e => {
    const file = e.target.files?.[0];
    const ch = rcTarget;
    e.target.value = '';
    if (!file || !ch) return;
    if (!/\.(pdf|jpg|jpeg|png|gif|webp|xls|xlsx|csv|doc|docx)$/i.test(file.name)) { setError('Rate card must be a PDF, image (JPG/PNG), Excel, CSV or Word file.'); return; }
    setRcBusyId(ch.id);
    try {
      const dataBase64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',').pop());
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      await api.post(`/admin/channel-masters/${ch.id}/rate-card`, { fileName: file.name, dataBase64 });
      await fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to upload rate card.');
    } finally {
      setRcBusyId(null);
      setRcTarget(null);
    }
  };
  const removeRateCard = async ch => {
    if (!window.confirm(`Remove the rate card for ${ch.name}?`)) return;
    setRcBusyId(ch.id);
    try {
      await api.delete(`/admin/channel-masters/${ch.id}/rate-card`);
      await fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove rate card.');
    } finally {
      setRcBusyId(null);
    }
  };
  const viewRateCard = async ch => {
    try {
      const res = await api.get(`/analytics/channel/${ch.id}/rate-card`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setError('Could not open the rate card.');
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
  const [moveBeforeAgencyId, setMoveBeforeAgencyId] = useState(''); // agency for months before eff (optional correction)
  const [moveSubmitting, setMoveSubmitting] = useState(false);
  const [moveError, setMoveError] = useState('');
  const [moveMsg, setMoveMsg] = useState('');
  const openMove = c => {
    setMoveClient(c);
    setMoveAgencyId('');
    setMoveMonth('');
    setMoveBeforeAgencyId('');
    setMoveError(''); setMoveMsg('');
    setShowMove(true);
  };
  const handleMoveSubmit = async e => {
    e.preventDefault();
    setMoveError(''); setMoveMsg('');
    if (!moveAgencyId) { setMoveError('Please pick the agency to move to.'); return; }
    // Allow re-running even when the target equals the current agency IF a
    // "before" agency is set (that's a history correction, not a plain move).
    if (String(moveAgencyId) === String(moveClient?.agencyId) && !moveBeforeAgencyId) {
      setMoveError('That is already the client’s agency. To fix past months, also set the "before" agency.'); return;
    }
    if (moveBeforeAgencyId && !moveMonth) { setMoveError('Set the effective month before choosing a "before" agency.'); return; }
    setMoveSubmitting(true);
    try {
      const { data } = await api.post(`/admin/clients/${moveClient.id}/move-agency`, {
        agencyId: parseInt(moveAgencyId),
        effectiveMonth: moveMonth || null,
        beforeAgencyId: moveBeforeAgencyId ? parseInt(moveBeforeAgencyId) : null,
      });
      setMoveMsg(`${data.message}. Re-stamped ${data.restamped.scheduleLogs} schedule log(s)${data.restamped.beforeScheduleLogs ? ` (+${data.restamped.beforeScheduleLogs} before)` : ''}, ${data.restamped.forecasts} forecast(s), ${data.restamped.budgets} budget(s).`);
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
      const ags = data.agencies || [];
      setGrAgencies(ags);
      const aamts = {};
      ags.forEach(a => { aamts[a.agencyId] = a.amount == null ? '' : String(a.amount); });
      setGrAgencyAmounts(aamts);
      const cls = data.clients || [];
      setGrClients(cls);
      const camts = {}; const cfamts = {};
      cls.forEach(c => {
        camts[c.clientId] = c.amount == null ? '' : String(c.amount);
        cfamts[c.clientId] = c.revenueFromFinance == null ? '' : String(c.revenueFromFinance);
      });
      setGrClientAmounts(camts);
      setGrClientFinanceAmounts(cfamts);
      setGrRevenueTarget(data.annualRevenueTarget == null ? '' : String(data.annualRevenueTarget));
    } catch {
      setGrHeads([]); setGrAmounts({}); setGrAgencies([]); setGrAgencyAmounts({}); setGrClients([]); setGrClientAmounts({}); setGrClientFinanceAmounts({}); setGrRevenueTarget('');
    } finally {
      setGrLoading(false);
    }
  };
  useEffect(() => {
    if (activeTab === 'group-revenue') fetchGroupRevenue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, grYear, grMonth]);

  // Auto-fill each Hub head's figure from the sum of their clients' Revenue as
  // the admin fills the By-client grid. The Hub inputs stay editable (a manual
  // override sticks until a client amount changes again). Negatives net in.
  useEffect(() => {
    if (!grClients.length || !grHeads.length) return;
    const idByName = new Map(grHeads.map(h => [h.headName, h.headUserId]));
    const sumByHead = new Map(); // headUserId -> { sum, count }
    grClients.forEach(c => {
      const hid = idByName.get(c.headName);
      if (hid == null) return;
      const raw = grClientAmounts[c.clientId];
      if (raw === '' || raw == null) return;
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      const cur = sumByHead.get(hid) || { sum: 0, count: 0 };
      cur.sum += n; cur.count += 1;
      sumByHead.set(hid, cur);
    });
    if (sumByHead.size === 0) return;
    setGrAmounts(prev => {
      const next = { ...prev };
      let changed = false;
      sumByHead.forEach((v, hid) => {
        const val = String(round2(v.sum)); // 2dp - avoid float artifacts like 2,961,704.1399999997
        if (next[hid] !== val) { next[hid] = val; changed = true; }
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grClientAmounts, grClients, grHeads]);

  // Auto-fill the "Actual billing by agency" section from the sum of each client's
  // Revenue, grouped by the client's CURRENT agency - so entering client numbers
  // (or moving a client to another agency) flows straight into the agency totals.
  // The agency inputs stay editable (a manual override sticks until a client
  // amount changes again). Uses agencyId (fresh each fetch) so re-agencied clients
  // roll up under the new agency.
  useEffect(() => {
    if (!grClients.length || !grAgencies.length) return;
    const sumByAgency = new Map(); // agencyId -> sum
    grClients.forEach(c => {
      if (c.agencyId == null) return;
      const raw = grClientAmounts[c.clientId];
      if (raw === '' || raw == null) return;
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      sumByAgency.set(c.agencyId, (sumByAgency.get(c.agencyId) || 0) + n);
    });
    if (sumByAgency.size === 0) return;
    setGrAgencyAmounts(prev => {
      const next = { ...prev };
      let changed = false;
      sumByAgency.forEach((sum, aid) => {
        const val = String(round2(sum));
        if (next[aid] !== val) { next[aid] = val; changed = true; }
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grClientAmounts, grClients, grAgencies]);

  // Keep refs of the latest edits + month/year so the debounced auto-save reads
  // fresh values (setTimeout closures would otherwise capture stale state).
  useEffect(() => { crEditsRef.current.amounts = grClientAmounts; }, [grClientAmounts]);
  useEffect(() => { crEditsRef.current.finance = grClientFinanceAmounts; }, [grClientFinanceAmounts]);
  useEffect(() => { grCtxRef.current = { year: grYear, month: grMonth }; }, [grYear, grMonth]);

  // Auto-save a single client's Revenue + Rev. from finance (used by the by-client
  // grid). Posts only that client so it's cheap; the response refreshes the row's
  // verification status. Shows a per-row saving/saved mark.
  // Hub head roll-up (per-head sum of their clients' Revenue) → persisted so the
  // By-Hub figures save automatically alongside the by-client entries.
  const computeHubRollup = (clientAmounts) => {
    const idByName = new Map(grHeads.map(h => [h.headName, h.headUserId]));
    const sums = {};
    grClients.forEach(c => {
      const hid = idByName.get(c.headName);
      if (hid == null) return;
      const raw = clientAmounts[c.clientId];
      if (raw === '' || raw == null) return;
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      sums[hid] = round2((sums[hid] || 0) + n);
    });
    return sums;
  };

  // Agency roll-up (per-agency sum of their clients' Revenue) → persisted so the
  // "Actual billing by agency" figures + agency Revenue donut save automatically
  // alongside the by-client entries, grouped by each client's current agency.
  const computeAgencyRollup = (clientAmounts) => {
    const sums = {};
    grClients.forEach(c => {
      if (c.agencyId == null) return;
      const raw = clientAmounts[c.clientId];
      if (raw === '' || raw == null) return;
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      sums[c.agencyId] = round2((sums[c.agencyId] || 0) + n);
    });
    return sums;
  };

  // Admin can undo a wrongly-entered dispute/confirmation on a client's finance
  // figure → back to Pending (keeps the finance figure). Reuses the shared
  // revenue-verification endpoint (SUPER_ADMIN is unrestricted there).
  const resetVerification = async (clientId) => {
    try {
      await api.post('/revenue/verification', { year: grYear, month: grMonth, clientId, action: 'reset' });
      setGrClients(prev => prev.map(c => c.clientId === clientId
        ? { ...c, verifyStatus: 'PENDING', verifiedAmount: null, verifyReason: null, verifiedByName: null }
        : c));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to reset verification.');
    }
  };

  const autoSaveClient = async (clientId) => {
    const { year, month } = grCtxRef.current;
    const revRaw = crEditsRef.current.amounts[clientId];
    const finRaw = crEditsRef.current.finance[clientId];
    const toVal = (v) => (v === '' || v == null ? null : Number(v));
    setCrSave(s => ({ ...s, [clientId]: 'saving' }));
    try {
      const { data } = await api.post('/admin/group-revenue', {
        year, month,
        clientAmounts: { [clientId]: toVal(revRaw) },
        clientFinanceAmounts: { [clientId]: toVal(finRaw) },
        amounts: computeHubRollup(crEditsRef.current.amounts),
        agencyAmounts: computeAgencyRollup(crEditsRef.current.amounts),
      });
      // Refresh row metadata (verification badge, head) without touching the
      // inputs the admin is still editing.
      if (Array.isArray(data.clients)) setGrClients(data.clients);
      setCrSave(s => ({ ...s, [clientId]: 'saved' }));
      setTimeout(() => setCrSave(s => {
        if (s[clientId] !== 'saved') return s;
        const n = { ...s }; delete n[clientId]; return n;
      }), 2000);
    } catch (err) {
      setCrSave(s => { const n = { ...s }; delete n[clientId]; return n; });
      setError(err.response?.data?.error || 'Failed to auto-save revenue.');
    }
  };

  // Debounce a client's auto-save ~700ms after the last keystroke. `flush` (on
  // blur) saves immediately.
  const scheduleClientSave = (clientId, flush = false) => {
    const timers = crTimersRef.current;
    if (timers[clientId]) { clearTimeout(timers[clientId]); delete timers[clientId]; }
    if (flush) { autoSaveClient(clientId); return; }
    timers[clientId] = setTimeout(() => { delete timers[clientId]; autoSaveClient(clientId); }, 700);
  };

  const saveGroupRevenue = async () => {
    setGrSaving(true);
    try {
      const amounts = {};
      Object.entries(grAmounts).forEach(([id, v]) => { amounts[id] = v === '' ? null : Number(v); });
      const agencyAmounts = {};
      Object.entries(grAgencyAmounts).forEach(([id, v]) => { agencyAmounts[id] = v === '' ? null : Number(v); });
      const clientAmounts = {};
      Object.entries(grClientAmounts).forEach(([id, v]) => { clientAmounts[id] = v === '' ? null : Number(v); });
      const clientFinanceAmounts = {};
      Object.entries(grClientFinanceAmounts).forEach(([id, v]) => { clientFinanceAmounts[id] = v === '' ? null : Number(v); });
      const { data } = await api.post('/admin/group-revenue', { year: grYear, month: grMonth, amounts, agencyAmounts, clientAmounts, clientFinanceAmounts, annualRevenueTarget: grRevenueTarget === '' ? null : Number(grRevenueTarget) });
      const heads = data.heads || [];
      setGrHeads(heads);
      const amts = {};
      heads.forEach(h => { amts[h.headUserId] = h.amount == null ? '' : String(h.amount); });
      setGrAmounts(amts);
      const ags = data.agencies || [];
      setGrAgencies(ags);
      const aamts = {};
      ags.forEach(a => { aamts[a.agencyId] = a.amount == null ? '' : String(a.amount); });
      setGrAgencyAmounts(aamts);
      const cls = data.clients || [];
      setGrClients(cls);
      const camts = {}; const cfamts = {};
      cls.forEach(c => {
        camts[c.clientId] = c.amount == null ? '' : String(c.amount);
        cfamts[c.clientId] = c.revenueFromFinance == null ? '' : String(c.revenueFromFinance);
      });
      setGrClientAmounts(camts);
      setGrClientFinanceAmounts(cfamts);
      setGrRevenueTarget(data.annualRevenueTarget == null ? '' : String(data.annualRevenueTarget));
      setGrSavedAt(Date.now());
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save group revenue.');
    } finally {
      setGrSaving(false);
    }
  };

  /* ---- monthly actual billing (loaded with the Group Revenue tab) ---- */
  const fetchMonthlyBilling = async () => {
    try {
      const { data } = await api.get('/admin/monthly-billing', { params: { year: grYear } });
      const m = (data.months || []).find(x => x.month === grMonth);
      setBillingAmount(m && m.amount != null ? String(m.amount) : '');
    } catch { setBillingAmount(''); }
  };
  useEffect(() => {
    if (activeTab === 'group-revenue') fetchMonthlyBilling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, grYear, grMonth]);

  const saveMonthlyBilling = async () => {
    setBillingSaving(true);
    try {
      await api.post('/admin/monthly-billing', { year: grYear, month: grMonth, amount: billingAmount === '' ? null : Number(billingAmount) });
      setBillingSavedAt(Date.now());
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save billing.');
    } finally {
      setBillingSaving(false);
    }
  };

  /* ---- AOR revenue ---- */
  const applyAorData = (data) => {
    setAorEntries(data.entries || []);
    setAorMonthTotals(data.monthTotals || {});
  };
  const fetchAorRevenue = async () => {
    setAorLoading(true);
    try {
      const { data } = await api.get('/admin/aor-revenue', { params: { year: aorYear } });
      applyAorData(data);
    } catch { setAorEntries([]); setAorMonthTotals({}); } finally { setAorLoading(false); }
  };
  useEffect(() => {
    if (activeTab === 'aor') fetchAorRevenue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, aorYear]);

  /* ---- error logs ---- */
  const fetchErrorLogs = async () => {
    setErrLoading(true);
    try {
      const params = { pageSize: 100 };
      if (errFilter === 'unresolved') params.resolved = false;
      else if (errFilter === 'frontend' || errFilter === 'backend') params.source = errFilter;
      const { data } = await api.get('/admin/errors', { params });
      setErrorLogs(Array.isArray(data.rows) ? data.rows : []);
      setErrUnresolved(data.unresolved || 0);
      setErrTotal(data.total || 0);
    } catch {
      setErrorLogs([]);
    } finally {
      setErrLoading(false);
    }
  };
  useEffect(() => {
    if (activeTab === 'errors') fetchErrorLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, errFilter]);

  /* ---- client records: inspect + purge one client's schedule logs ---- */
  const fetchClientRecords = async (clientId) => {
    if (!clientId) { setRecSummary(null); return; }
    setRecLoading(true); setRecError(''); setRecResult('');
    try {
      const { data } = await api.get('/admin/client-records', { params: { clientId } });
      setRecSummary(data);
    } catch (err) {
      setRecSummary(null);
      setRecError(err.response?.data?.error || 'Failed to load this client\'s records.');
    } finally {
      setRecLoading(false);
    }
  };
  useEffect(() => {
    if (activeTab === 'client-records') { setRecConfirmName(''); fetchClientRecords(recClientId); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, recClientId]);

  const purgeClientRecords = async () => {
    if (!recSummary || !recClientId) return;
    const name = recSummary.client?.name || '';
    if (!window.confirm(`Delete all ${recSummary.rows} schedule records for ${name}?\n\nThey stop counting everywhere immediately and you can re-upload the client from scratch.`)) return;
    setRecPurging(true); setRecError(''); setRecResult('');
    try {
      const { data } = await api.post('/admin/client-records/purge', { clientId: Number(recClientId), confirmName: recConfirmName });
      setRecResult(`Removed ${data.deleted} record${data.deleted === 1 ? '' : 's'} for ${data.clientName}. You can re-upload this client now.`);
      setRecConfirmName('');
      fetchClientRecords(recClientId);
    } catch (err) {
      setRecError(err.response?.data?.error || 'Failed to delete the records.');
    } finally {
      setRecPurging(false);
    }
  };

  const resolveErrorLog = async (id, resolved) => {
    try {
      await api.patch(`/admin/errors/${id}/resolve`, { resolved });
      fetchErrorLogs();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update error.');
    }
  };
  const deleteErrorLog = async (id) => {
    if (!window.confirm('Delete this error log entry?')) return;
    try {
      await api.delete(`/admin/errors/${id}`);
      fetchErrorLogs();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete error.');
    }
  };
  const clearErrorLogs = async (onlyResolved) => {
    if (!window.confirm(onlyResolved ? 'Delete all RESOLVED error logs?' : 'Delete ALL error logs? This cannot be undone.')) return;
    try {
      await api.delete('/admin/errors', { params: onlyResolved ? { resolved: true } : {} });
      fetchErrorLogs();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to clear errors.');
    }
  };

  const addAorEntry = async () => {
    const channel = aorForm.channel.trim();
    if (!channel) { setError('Channel is required.'); return; }
    if (aorForm.amount === '' || isNaN(Number(aorForm.amount))) { setError('Enter a valid amount.'); return; }
    setAorSaving(true);
    try {
      const { data } = await api.post('/admin/aor-revenue', {
        year: aorYear, month: aorMonth, channel, amount: Number(aorForm.amount), reason: aorForm.reason.trim(),
      });
      applyAorData(data);
      setAorForm({ channel: '', amount: '', reason: '' });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add AOR entry.');
    } finally {
      setAorSaving(false);
    }
  };
  const deleteAorEntry = async (id) => {
    try {
      const { data } = await api.delete(`/admin/aor-revenue/${id}`);
      applyAorData(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete AOR entry.');
    }
  };

  /* ---- channel commitments ---- */
  const fetchChannelCommitments = async () => {
    setCcLoading(true);
    try {
      const { data } = await api.get('/admin/channel-commitments');
      const chans = data.channels || [];
      setCcChannels(chans);
      const curY = new Date().getFullYear();
      const rows = {};
      chans.forEach(c => {
        const amt = c.type === 'ANNUAL' ? c.totalAmount : c.monthlyAmount;
        rows[c.channelMasterId] = {
          type: c.type || 'MONTHLY',
          amount: amt == null ? '' : String(amt),
          startMonth: c.startMonth ?? 1,
          startYear: c.startYear ?? curY,
          endMonth: c.endMonth ?? 12,
          endYear: c.endYear ?? curY,
        };
      });
      setCcRows(rows);
    } catch {
      setCcChannels([]); setCcRows({});
    } finally {
      setCcLoading(false);
    }
  };
  useEffect(() => {
    if (activeTab === 'channel-commitments') fetchChannelCommitments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const setCcField = (channelMasterId, field, value) =>
    setCcRows(r => ({ ...r, [channelMasterId]: { ...r[channelMasterId], [field]: value } }));

  const saveChannelCommitment = async (channelMasterId) => {
    const row = ccRows[channelMasterId] || {};
    setCcSavingId(channelMasterId);
    try {
      await api.post('/admin/channel-commitments', {
        channelMasterId,
        type: row.type || 'MONTHLY',
        amount: row.amount === '' ? null : Number(row.amount),
        startYear: row.startYear, startMonth: row.startMonth,
        endYear: row.endYear, endMonth: row.endMonth,
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save commitment.');
    } finally {
      setCcSavingId(null);
    }
  };

  /* ---- direct placements ---- */
  const fetchDirectPlacements = async () => {
    setDpLoading(true);
    try {
      const { data } = await api.get('/masterdata/direct-placements');
      setDpChannels(data.channels || []);
      setDpSelected(data.selectedIds || []);
      setDpSavedAt(null);
    } catch {
      setDpChannels([]); setDpSelected([]);
    } finally {
      setDpLoading(false);
    }
  };
  useEffect(() => {
    if (activeTab === 'direct-placements') fetchDirectPlacements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const toggleDpChannel = (id) =>
    setDpSelected(sel => (sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]));

  const saveDirectPlacements = async () => {
    setDpSaving(true);
    try {
      await api.post('/masterdata/direct-placements', { channelMasterIds: dpSelected });
      setDpChannels(chs => chs.map(c => ({ ...c, isDirectPlacement: dpSelected.includes(c.id) })));
      setDpSavedAt(new Date());
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save direct placements.');
    } finally {
      setDpSaving(false);
    }
  };

  /* ---- channel commitment deal groups (one target across several channels) ---- */
  const fetchCommitmentGroups = async () => {
    try {
      const { data } = await api.get('/admin/commitment-groups');
      setCgGroups(data.groups || []);
    } catch {
      setCgGroups([]);
    }
  };
  useEffect(() => {
    if (activeTab === 'channel-commitments') fetchCommitmentGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const openCgModal = (g) => {
    setCgError('');
    if (g) {
      setCgForm({
        id: g.id, name: g.name, type: g.type || 'ANNUAL',
        amount: g.amount == null ? '' : String(g.amount),
        channelMasterIds: g.channelMasterIds || [],
        startMonth: g.startMonth ?? 1, startYear: g.startYear ?? new Date().getFullYear(),
        endMonth: g.endMonth ?? 12, endYear: g.endYear ?? new Date().getFullYear(),
      });
    } else {
      setCgForm(emptyCgForm());
    }
    setCgChannelSearch('');
    setCgModalOpen(true);
  };
  const toggleCgChannel = (id) =>
    setCgForm(f => ({ ...f, channelMasterIds: f.channelMasterIds.includes(id) ? f.channelMasterIds.filter(x => x !== id) : [...f.channelMasterIds, id] }));

  const saveCommitmentGroup = async () => {
    setCgError('');
    if (!cgForm.name.trim()) { setCgError('Enter a group name.'); return; }
    if (cgForm.channelMasterIds.length < 2) { setCgError('Pick at least two channels.'); return; }
    if (cgForm.amount === '' || Number(cgForm.amount) <= 0) { setCgError('Enter a target amount.'); return; }
    setCgSaving(true);
    try {
      await api.post('/admin/commitment-groups', {
        id: cgForm.id,
        name: cgForm.name.trim(),
        type: cgForm.type,
        amount: Number(cgForm.amount),
        channelMasterIds: cgForm.channelMasterIds,
        startYear: cgForm.startYear, startMonth: cgForm.startMonth,
        endYear: cgForm.endYear, endMonth: cgForm.endMonth,
      });
      setCgModalOpen(false);
      await fetchCommitmentGroups();
    } catch (err) {
      setCgError(err.response?.data?.error || 'Failed to save deal group.');
    } finally {
      setCgSaving(false);
    }
  };
  const deleteCommitmentGroup = async (g) => {
    if (!window.confirm(`Delete the deal group "${g.name}"?`)) return;
    try {
      await api.delete(`/admin/commitment-groups/${g.id}`);
      await fetchCommitmentGroups();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete deal group.');
    }
  };

  const fetchClientTargets = async () => {
    setCtLoading(true);
    try {
      const { data } = await api.get('/admin/client-targets', { params: { year: ctYear } });
      setCtYears(data.availableYears || []);
      const cls = data.clients || [];
      setCtClients(cls);
      const amts = {};
      cls.forEach(c => { amts[c.clientId] = c.amount == null ? '' : String(c.amount); });
      setCtAmounts(amts);
    } catch {
      setCtClients([]); setCtAmounts({});
    } finally {
      setCtLoading(false);
    }
  };
  useEffect(() => {
    if (activeTab === 'client-targets') fetchClientTargets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, ctYear]);

  const saveClientTarget = async (clientId) => {
    const raw = ctAmounts[clientId];
    setCtSavingId(clientId);
    try {
      await api.post('/admin/client-targets', { clientId, year: ctYear, amount: raw === '' ? null : Number(raw) });
      setCtSavedId(clientId);
      setTimeout(() => setCtSavedId(id => (id === clientId ? null : id)), 1600);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save client target.');
    } finally {
      setCtSavingId(null);
    }
  };

  /* ---- per-agency annual targets ---- */
  const fetchAgencyTargets = async () => {
    setAgTargetLoading(true);
    try {
      const { data } = await api.get('/admin/agency-targets', { params: { year: agTargetYear } });
      setAgTargetYears(data.availableYears || []);
      setAgTargets(data.agencies || []);
      const v = {};
      (data.agencies || []).forEach(a => { v[a.agencyId] = a.totalTargetMillions == null ? '' : String(a.totalTargetMillions); });
      setAgTargetVals(v);
    } catch {
      setAgTargets([]); setAgTargetVals({});
    } finally {
      setAgTargetLoading(false);
    }
  };
  useEffect(() => {
    if (activeTab === 'annual-targets') fetchAgencyTargets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, agTargetYear]);

  const saveAgencyTarget = async (agencyId) => {
    const raw = agTargetVals[agencyId];
    setAgTargetSavingId(agencyId);
    try {
      await api.post('/admin/agency-targets', { agencyId, year: agTargetYear, totalTargetMillions: raw === '' ? null : Number(raw) });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save agency target.');
    } finally {
      setAgTargetSavingId(null);
    }
  };

  /* ---- helpers ---- */
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const grTotal = Object.values(grAmounts).reduce((s, v) => s + (Number(v) || 0), 0);
  const grAgencyTotal = Object.values(grAgencyAmounts).reduce((s, v) => s + (Number(v) || 0), 0);
  const grClientTotal = Object.values(grClientAmounts).reduce((s, v) => s + (Number(v) || 0), 0);
  const grClientFinanceTotal = Object.values(grClientFinanceAmounts).reduce((s, v) => s + (Number(v) || 0), 0);
  // Clients grouped by Hub head (for the by-client entry grid), with per-head subtotals.
  const grClientsByHead = (() => {
    const map = new Map();
    grClients.forEach(c => {
      const noHead = c.hasHead === false || !c.headName || c.headName === 'Unassigned';
      // Unassigned clients: always list ACTIVE ones (so a just-moved/reassigned
      // client is visible for revenue entry even before its Hub head resolves).
      // INACTIVE unassigned clients (e.g. a paused Mobitel) are only listed when
      // they actually carry a revenue figure, so dead accounts don't clutter.
      if (noHead && c.isActive === false) {
        const rev = grClientAmounts[c.clientId];
        const fin = grClientFinanceAmounts[c.clientId];
        const hasVal = (rev !== '' && rev != null) || (fin !== '' && fin != null);
        if (!hasVal) return;
      }
      const key = noHead ? 'Unassigned' : c.headName;
      if (!map.has(key)) map.set(key, { headName: key, noHead, clients: [], subtotal: 0, financeSubtotal: 0 });
      const g = map.get(key);
      g.clients.push(c);
      g.subtotal += Number(grClientAmounts[c.clientId] || 0);
      g.financeSubtotal += Number(grClientFinanceAmounts[c.clientId] || 0);
    });
    // Real Hub heads first (alphabetical), the "Unassigned" bucket always last.
    return [...map.values()].sort((a, b) => (a.noHead ? 1 : 0) - (b.noHead ? 1 : 0) || a.headName.localeCompare(b.headName));
  })();

  // Export the by-client revenue worksheet (Revenue + Rev. from finance + head verification).
  const exportClientRevenue = async () => {
    const rows = [
      ['Group Head', 'Client', 'Agency', 'Status', 'Revenue (LKR)', 'Rev. from Finance (LKR)', 'Verification', 'Verified Amount (LKR)', 'Note', 'Verified By'],
      ...grClients.map(c => [
        (c.hasHead === false ? 'Unassigned' : (c.headName || 'Unassigned')), c.name, c.agencyName,
        c.isActive === false ? 'Inactive' : 'Active',
        grClientAmounts[c.clientId] === '' || grClientAmounts[c.clientId] == null ? '' : Number(grClientAmounts[c.clientId]),
        grClientFinanceAmounts[c.clientId] === '' || grClientFinanceAmounts[c.clientId] == null ? '' : Number(grClientFinanceAmounts[c.clientId]),
        c.verifyStatus || 'PENDING',
        c.verifiedAmount == null ? '' : Number(c.verifiedAmount),
        c.verifyReason || '',
        c.verifiedByName || '',
      ]),
    ];
    await writeBrandedWorkbook([{ name: 'Revenue by Client', aoa: rows }], `revenue-by-client-${grYear}-${String(grMonth).padStart(2, '0')}.xlsx`);
  };

  // Parse an uploaded Excel/CSV with columns: Client, Revenue, Rev. from finance.
  // Auto-matches each client name to the Hub roster; unmatched rows get "did you
  // mean?" suggestions the admin resolves before importing.
  const onImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (crFileRef.current) crFileRef.current.value = '';
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
      if (!aoa.length) { setError('The file appears to be empty.'); return; }
      // Locate the header row + the three columns by keyword.
      let headerIdx = 0, col = null;
      for (let i = 0; i < Math.min(aoa.length, 8); i++) {
        const cells = aoa[i].map((c) => String(c).toLowerCase().trim());
        const ci = cells.findIndex((c) => c.includes('client') || c.includes('account'));
        const fi = cells.findIndex((c) => c.includes('finance'));
        const ri = cells.findIndex((c) => (c.includes('revenue') || c === 'rev') && !c.includes('finance'));
        if (ci !== -1 && (ri !== -1 || fi !== -1)) { headerIdx = i; col = { client: ci, revenue: ri, finance: fi }; break; }
      }
      if (!col) { setError('Could not find Client / Revenue / Rev. from finance columns in the file.'); return; }
      const rows = [];
      for (let i = headerIdx + 1; i < aoa.length; i++) {
        const r = aoa[i];
        const rawClient = String(r[col.client] ?? '').trim();
        if (!rawClient) continue;
        const revenue = col.revenue !== -1 ? parseAccountingAmount(r[col.revenue]) : null;
        const finance = col.finance !== -1 ? parseAccountingAmount(r[col.finance]) : null;
        if (revenue == null && finance == null) continue;
        const suggestions = suggestClients(rawClient, grClients);
        const exact = suggestions.find((s) => normName(s.name) === normName(rawClient));
        rows.push({
          id: `${i}`,
          rawClient,
          revenue,
          finance,
          suggestions,
          matchId: exact ? exact.clientId : (suggestions[0] && suggestions[0].score >= 0.6 ? suggestions[0].clientId : ''),
          exact: !!exact,
        });
      }
      if (!rows.length) { setError('No client rows with amounts were found in the file.'); return; }
      setError('');
      setCrImport({ fileName: file.name, rows, hasRevenueCol: col.revenue !== -1, hasFinanceCol: col.finance !== -1 });
    } catch (err) {
      setError('Failed to read the file: ' + (err.message || 'unknown error'));
    }
  };

  const setImportMatch = (rowId, clientId) => {
    setCrImport((imp) => imp && ({ ...imp, rows: imp.rows.map((r) => (r.id === rowId ? { ...r, matchId: clientId } : r)) }));
  };

  const applyImport = async () => {
    if (!crImport) return;
    const resolved = crImport.rows.filter((r) => r.matchId !== '' && r.matchId != null);
    if (!resolved.length) { setError('No rows are matched to a client. Pick a client (or Skip) for each row.'); return; }
    // The uploaded sheet is the WHOLE month for the columns it carries: import
    // REPLACES the month. Every client gets its imported value, and any client
    // NOT in the sheet has that column cleared (e.g. a previously-entered Maliban
    // that's absent from the new sheet is removed). Only fields whose column
    // exists in the file are touched.
    const hasRevCol = crImport.hasRevenueCol !== false;
    const hasFinCol = crImport.hasFinanceCol !== false;
    const importByClient = new Map();
    for (const r of resolved) importByClient.set(r.matchId, r); // last row wins
    const clientAmounts = {}; const clientFinanceAmounts = {};
    grClients.forEach((c) => {
      const imp = importByClient.get(c.clientId);
      if (hasRevCol) clientAmounts[c.clientId] = imp && imp.revenue != null ? imp.revenue : null;
      if (hasFinCol) clientFinanceAmounts[c.clientId] = imp && imp.finance != null ? imp.finance : null;
    });
    // Recompute the By-Hub roll-up from the resulting (post-replace) Revenue.
    const amounts = hasRevCol ? computeHubRollup(clientAmounts) : undefined;
    setCrImporting(true);
    try {
      await api.post('/admin/group-revenue', {
        year: grYear, month: grMonth,
        ...(hasRevCol ? { clientAmounts } : {}),
        ...(hasFinCol ? { clientFinanceAmounts } : {}),
        ...(amounts ? { amounts } : {}),
      });
      await fetchGroupRevenue();
      setCrImport(null);
      setGrSavedAt(Date.now());
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to import revenue.');
    } finally {
      setCrImporting(false);
    }
  };

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

  const hideClientSelect = userForm.role === 'SUPER_ADMIN' || userForm.role === 'MANAGER';

  // Export every admin dataset into one workbook, a sheet per entity.
  const exportAll = async () => {
    const sheets = [];
    const add = (name, rows) => sheets.push({ name: name.slice(0, 31), aoa: rows });
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
    await writeBrandedWorkbook(sheets, `ogilvy-orbit-admin-export-${stamp}.xlsx`);
  };

  if (loading) {
    return <OrbitLoader fullHeight label="Loading…" />;
  }

  // Two-level tabs: top-level groups, each with one or more leaf tabs. `activeTab`
  // stays the LEAF key so every content block / effect below is unchanged.
  const reqPending = clientRequests.filter(r => r.status === 'pending').length + channelRequests.filter(r => r.status === 'pending').length;
  const tabGroups = [
    { label: 'Users', members: [{ key: 'users', label: 'Users', count: users.length }] },
    { label: 'Agencies & Clients', members: [
      { key: 'agencies', label: 'Agencies', count: agencies.length },
      { key: 'clients', label: 'Clients', count: allClients.length },
      { key: 'client-groups', label: 'Client Groups' },
    ] },
    { label: 'Master Data', members: [
      { key: 'channels', label: 'Channels', count: channelMasters.length },
      { key: 'media-groups', label: 'Media Groups', count: mediaGroups.length },
      { key: 'property-categories', label: 'Property Categories', count: propertyCategories.length },
      { key: 'direct-placements', label: 'Direct Placements' },
    ] },
    { label: 'Targets', members: [
      { key: 'annual-targets', label: 'Annual Targets', count: annualTargets.length },
      { key: 'client-targets', label: 'Client Targets' },
      { key: 'client-group-targets', label: 'Client Group Targets' },
    ] },
    { label: 'Channel Commitments', members: [{ key: 'channel-commitments', label: 'Channel Commitments' }] },
    { label: 'Group Revenue', members: [{ key: 'group-revenue', label: 'Group Revenue' }] },
    { label: 'AVR', members: [{ key: 'aor', label: 'AVR' }] },
    { label: 'Requests', members: [{ key: 'requests', label: 'Requests', count: reqPending }] },
    { label: 'Notify', members: [{ key: 'notify', label: 'Notify' }] },
    { label: 'Backup', members: [{ key: 'backup', label: 'Backup' }] },
    { label: 'Database', members: [
      { key: 'client-records', label: 'Client Records' },
      { key: 'errors', label: 'Errors', count: errUnresolved || undefined },
    ] },
  ];
  const activeGroup = tabGroups.find(g => g.members.some(m => m.key === activeTab)) || tabGroups[0];

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="page-head">
        <div>
          <h1 className="page-title">User Management</h1>
          <p className="page-sub">Control Room &middot; {users.length} users across {agencies.length} agencies</p>
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

      {/* Top-level tab groups */}
      <div style={{ display: 'flex', gap: 6, marginBottom: activeGroup.members.length > 1 ? 10 : 18, flexWrap: 'wrap' }}>
        {tabGroups.map(group => {
          const on = group.members.some(m => m.key === activeTab);
          const badge = group.members.length === 1 ? group.members[0].count : undefined;
          return (
            <button
              key={group.label}
              onClick={() => { if (!on) { setActiveTab(group.members[0].key); setSearch(''); } }}
              style={{
                border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '8px 15px',
                borderRadius: 9, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 7,
                background: on ? '#0F1F3D' : 'transparent', color: on ? '#fff' : '#6B7790',
              }}
            >
              {group.label}
              {badge != null && (
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 20,
                  background: on ? 'rgba(255,255,255,.16)' : '#EEF0F3', color: on ? '#fff' : '#93A0B5',
                }}>{badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Sub-tabs for the active group (only when it has more than one) */}
      {activeGroup.members.length > 1 && (
        <div style={{ display: 'inline-flex', gap: 4, marginBottom: 18, background: '#F1F3F6', borderRadius: 9, padding: 3, flexWrap: 'wrap' }}>
          {activeGroup.members.map(m => {
            const on = activeTab === m.key;
            return (
              <button
                key={m.key}
                onClick={() => { setActiveTab(m.key); setSearch(''); }}
                style={{
                  border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, padding: '6px 13px',
                  borderRadius: 7, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
                  background: on ? '#fff' : 'transparent', color: on ? '#0F1F3D' : '#6B7790',
                  boxShadow: on ? '0 1px 2px rgba(15,31,61,.12)' : 'none',
                }}
              >
                {m.label}
                {m.count != null && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: on ? '#EEF0F3' : '#E4E7EC', color: '#93A0B5' }}>{m.count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {!['group-revenue', 'aor', 'channel-commitments', 'client-targets', 'client-group-targets', 'backup', 'notify', 'errors', 'client-records', 'client-groups', 'direct-placements'].includes(activeTab) && (
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
                        ? new Date(u.lastLoginAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : <span title="Has not signed in since this was added">Never</span>}
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
                              <button className="act-btn" onClick={() => toggleClient(c)} title={c.isActive === false ? 'Show to Hub' : 'Hide from Hub'} style={{ color: c.isActive === false ? 'var(--green-600)' : 'var(--muted)' }}>
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
                            {active ? <Icon name="check" size={12} /> : <Icon name="plus" size={12} />}
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
          <input ref={rcInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.xls,.xlsx,.csv,.doc,.docx" style={{ display: 'none' }} onChange={onRateCardFile} />
          <table className="tbl">
            <thead>
              <tr>
                <th>Channel Name</th>
                <th>Medium</th>
                <th>Media Group</th>
                <th>Aliases</th>
                <th>Usage</th>
                <th>Rate Card</th>
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
                    {rcBusyId === ch.id ? (
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>Working…</span>
                    ) : ch.rateCardFileName ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => viewRateCard(ch)} title={ch.rateCardFileName} style={{ gap: 4 }}>
                          <Icon name="file" size={13} /> View
                        </button>
                        {Array.isArray(ch.rateCardVersions) && ch.rateCardVersions.length > 1 && (
                          <span className="badge" title={`${ch.rateCardVersions.length} versions kept`} style={{ fontSize: 10.5 }}>v{ch.rateCardVersions.length}</span>
                        )}
                        <button className="act-btn" onClick={() => pickRateCard(ch)} title="Upload a new version (keeps the old ones)"><Icon name="upload" size={13} /></button>
                        <button className="act-btn" onClick={() => removeRateCard(ch)} title="Remove rate card (all versions)" style={{ color: 'var(--red-600,#dc2626)' }}><Icon name="trash" size={13} /></button>
                      </div>
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => pickRateCard(ch)} style={{ gap: 4 }}>
                        <Icon name="upload" size={13} /> Upload PDF
                      </button>
                    )}
                  </td>
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
                      <button
                        className="act-btn"
                        onClick={() => downloadChannelLogs(ch)}
                        disabled={chLogBusyId === ch.id || !(ch._count?.scheduleLogs > 0)}
                        title={ch._count?.scheduleLogs > 0 ? 'Download usage logs (Excel)' : 'No usage logs to download'}
                        style={{ color: ch._count?.scheduleLogs > 0 ? 'var(--blue-700)' : 'var(--muted-2)' }}
                      >
                        <Icon name={chLogBusyId === ch.id ? 'history' : 'download'} size={15} />
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
                      <button className="act-btn" onClick={() => confirmDelete(ch, 'channels')} title="Delete (recoverable - moves to Recently deleted)" style={{ color: 'var(--red-600,#dc2626)' }}>
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

          {deletedChannels.length > 0 && (
            <div style={{ marginTop: 22, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-sunken)', padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Icon name="trash" size={15} style={{ color: 'var(--muted)' }} />
                <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>Recently deleted</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>({deletedChannels.length}) - restore any channel here</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {deletedChannels.map((ch) => (
                  <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px' }}>
                    <span className="medium-tag" style={{ flexShrink: 0 }}>{ch.medium}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{ch.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                        {ch.mediaGroup?.name || 'No media group'}
                        {ch.deletedAt && ` · deleted ${new Date(ch.deletedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                        {ch.deletedByName && ` by ${ch.deletedByName}`}
                      </div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => restoreChannel(ch)} disabled={restoringId === ch.id} style={{ gap: 5, flexShrink: 0 }}>
                      <Icon name={restoringId === ch.id ? 'history' : 'check'} size={13} /> {restoringId === ch.id ? 'Restoring…' : 'Restore'}
                    </button>
                  </div>
                ))}
              </div>
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
              {filteredGroups.map(g => {
                const groupChannels = channelMasters.filter(ch => (ch.mediaGroup?.id ?? ch.mediaGroupId) === g.id);
                const isOpen = expandedGroup === g.id;
                return (
                <Fragment key={g.id}>
                <tr style={{ opacity: g.active === false ? 0.55 : 1 }}>
                  <td className="strong">
                    <button
                      onClick={() => setExpandedGroup(isOpen ? null : g.id)}
                      title={isOpen ? 'Hide channels' : 'Show channels'}
                      disabled={groupChannels.length === 0}
                      style={{ border: 'none', background: 'transparent', cursor: groupChannels.length ? 'pointer' : 'default', padding: 0, marginRight: 8, color: groupChannels.length ? 'var(--ink-soft,#3B4A63)' : 'var(--muted)', verticalAlign: 'middle' }}
                    >
                      <Icon name={isOpen ? 'chevDown' : 'chevR'} size={14} />
                    </button>
                    {g.name}
                  </td>
                  <td style={{ color: 'var(--muted)' }}>
                    <button
                      onClick={() => groupChannels.length && setExpandedGroup(isOpen ? null : g.id)}
                      style={{ border: 'none', background: 'transparent', cursor: groupChannels.length ? 'pointer' : 'default', padding: 0, color: 'inherit', fontSize: 'inherit' }}
                    >
                      {g._count?.channelMasters ?? groupChannels.length} channels
                    </button>
                  </td>
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
                {isOpen && (
                  <tr>
                    <td colSpan={4} style={{ background: '#F7F8FA', padding: '10px 16px 12px 38px' }}>
                      {groupChannels.length === 0 ? (
                        <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>No channels in this media group.</span>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {groupChannels.slice().sort((a, b) => a.name.localeCompare(b.name)).map(ch => (
                            <span key={ch.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #E5E8ED', borderRadius: 999, padding: '4px 11px', fontSize: 12.5, opacity: ch.isActive === false ? 0.55 : 1 }}>
                              <span className="medium-tag" data-medium={ch.medium} style={{ fontSize: 9.5 }}>{ch.medium}</span>
                              <span style={{ fontWeight: 600, color: '#16243C' }}>{ch.name}</span>
                              {ch.isActive === false && <span style={{ fontSize: 10, color: 'var(--muted)' }}>(inactive)</span>}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
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

      {/* ============ DIRECT PLACEMENTS ============ */}
      {activeTab === 'direct-placements' && (() => {
        const q = dpSearch.trim().toLowerCase();
        const list = dpChannels.filter(c => !q || (c.name || '').toLowerCase().includes(q) || (c.mediaGroup?.name || '').toLowerCase().includes(q));
        const saved = dpChannels.filter(c => c.isDirectPlacement).map(c => c.id).sort().join(',');
        const dirty = [...dpSelected].sort().join(',') !== saved;
        return (
          <div>
            <div style={{ background: 'var(--bg-sunken,#F5F6F8)', border: '1px solid var(--border)', borderRadius: 10, padding: '13px 16px', marginBottom: 16, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.55 }}>
              Digital channels bought as <b>direct placements</b> (Sirasa Digital, Swarnawahini Digital, …).
              The channels ticked here are shown as <b>one combined "Direct Placements" bar</b> in the Digital tab of every
              Spend by Channel chart — Spend Analytics, Group Dashboard and Client Dashboard — coloured per channel, with the
              split on hover. Everywhere else (breakdown tables, All Channels, exports, reports, Channel Intelligence) each
              channel is still reported on its own, so no detail is lost.
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none', display: 'flex' }}><Icon name="search" size={15} /></span>
                <input className="input" value={dpSearch} onChange={e => setDpSearch(e.target.value)} placeholder="Search digital channels…" style={{ paddingLeft: 32, width: '100%' }} />
              </div>
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                {dpSelected.length} of {dpChannels.length} digital channel{dpChannels.length === 1 ? '' : 's'} selected
              </span>
              {dpSelected.length > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={() => setDpSelected([])} disabled={dpSaving}>Clear all</button>
              )}
              <button className="btn btn-primary" onClick={saveDirectPlacements} disabled={dpSaving || !dirty}>
                {dpSaving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
              </button>
              {dpSavedAt && !dirty && (
                <span style={{ fontSize: 12, color: 'var(--green-600,#15814B)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Icon name="check" size={14} /> Saved
                </span>
              )}
            </div>

            {dpLoading ? (
              <div style={{ padding: '30px 0' }}><OrbitLoader label="Loading digital channels…" /></div>
            ) : dpChannels.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>
                <Icon name="folder" size={28} style={{ opacity: 0.4, marginBottom: 6 }} />
                <p>No digital channels yet. Add one under Master Data → Channels with medium DIGITAL.</p>
              </div>
            ) : list.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>No digital channels match "{dpSearch}".</div>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}>In bucket</th>
                      <th>Channel</th>
                      <th>Media Group</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Usage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map(c => {
                      const on = dpSelected.includes(c.id);
                      return (
                        <tr key={c.id} className="clickable" onClick={() => toggleDpChannel(c.id)} style={{ background: on ? 'var(--coral-50,#FDF1EB)' : undefined }}>
                          <td onClick={e => e.stopPropagation()}>
                            <input type="checkbox" checked={on} onChange={() => toggleDpChannel(c.id)} style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--coral-700,#C44A18)' }} />
                          </td>
                          <td className="strong">{c.name}</td>
                          <td style={{ color: 'var(--muted)' }}>{c.mediaGroup?.name || '-'}</td>
                          <td>
                            <span style={{
                              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                              background: c.isActive === false ? 'var(--bg-sunken)' : 'var(--green-100)',
                              color: c.isActive === false ? 'var(--muted)' : 'var(--green-600)',
                            }}>{c.isActive === false ? 'Inactive' : 'Active'}</span>
                          </td>
                          <td className="mono" style={{ textAlign: 'right' }}>{c._count?.scheduleLogs ?? 0}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {/* ============ CHANNEL COMMITMENTS ============ */}
      {activeTab === 'channel-commitments' && (
        <div>
          {/* Single Channel / Deal Groups sub-tabs */}
          <div style={{ display: 'inline-flex', gap: 4, marginBottom: 16, background: '#F1F3F6', borderRadius: 9, padding: 3 }}>
            {[['channel', 'Single Channel'], ['group', `Deal Groups${cgGroups.length ? ` (${cgGroups.length})` : ''}`]].map(([k, lbl]) => {
              const on = ccSubTab === k;
              return (
                <button key={k} onClick={() => setCcSubTab(k)}
                  style={{ border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, padding: '6px 14px', borderRadius: 7, background: on ? '#fff' : 'transparent', color: on ? '#0F1F3D' : '#6B7790', boxShadow: on ? '0 1px 2px rgba(15,31,61,.12)' : 'none' }}>
                  {lbl}
                </button>
              );
            })}
          </div>

          {ccSubTab === 'channel' && (() => {
            // Channels grouped by medium; a medium tab bar (TV / Radio / …) keeps
            // each view short. The active medium falls back to the first present.
            const mediumsPresent = MEDIUMS.filter(m => ccChannels.some(c => c.medium === m));
            const others = [...new Set(ccChannels.map(c => c.medium).filter(m => m && !MEDIUMS.includes(m)))];
            const mediumTabs = [...mediumsPresent, ...others];
            const activeMed = mediumTabs.includes(ccMedium) ? ccMedium : (mediumTabs[0] || '');
            const rowsForMedium = ccChannels
              .filter(c => c.medium === activeMed)
              .filter(c => !ccSearch || c.name.toLowerCase().includes(ccSearch.toLowerCase()) || (c.mediaGroup || '').toLowerCase().includes(ccSearch.toLowerCase()));
            return (
          <>
          {ccLoading ? null : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, borderBottom: '1px solid #EEF0F3', paddingBottom: 2 }}>
              {mediumTabs.map(m => {
                const on = m === activeMed;
                return (
                  <button key={m} onClick={() => setCcMedium(m)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: on ? '#0F1F3D' : '#6B7790', borderBottom: `2px solid ${on ? '#0F1F3D' : 'transparent'}`, marginBottom: -2 }}>
                    <span className="medium-tag">{m}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#93A0B5' }}>{ccChannels.filter(c => c.medium === m).length}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div style={{ marginBottom: 14 }}>
            <div className="field" style={{ margin: 0, maxWidth: 320, position: 'relative' }}>
              <label>Search channel</label>
              <input className="input" type="text" value={ccSearch} onChange={e => setCcSearch(e.target.value)} placeholder="Filter channels…" />
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
            Set each channel's commitment <b style={{ color: 'var(--ink)' }}>type</b> and the <b style={{ color: 'var(--ink)' }}>period</b> it runs over (start month → end month, and it can cross years, e.g. Mar 2026 → Apr 2027).
            <br /><b style={{ color: 'var(--ink)' }}>Monthly commitment</b>: enter the amount per month - each month is judged on its own (met = green, missed = red).
            <b style={{ color: 'var(--ink)' }}> Annual target</b>: enter the total for the whole period - it is judged cumulatively (pacing to date), not month by month.
            The dashboard counts only the channel's active months in the selected year, starting from the start month. Click <b style={{ color: 'var(--ink)' }}>Save</b> per row; clear the amount and Save to remove.
          </div>
          {ccLoading ? (
            <div style={{ padding: '30px 0' }}><OrbitLoader label="Loading channels…" /></div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Type</th>
                    <th style={{ textAlign: 'right' }}>Amount (LKR)</th>
                    <th>Start</th>
                    <th>End</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rowsForMedium
                    .map(c => {
                      const row = ccRows[c.channelMasterId] || {};
                      const yrs = Array.from({ length: (new Date().getFullYear() + 2) - 2022 + 1 }, (_, i) => 2022 + i);
                      return (
                        <tr key={c.channelMasterId}>
                          <td className="strong">{c.name}{c.mediaGroup ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {c.mediaGroup}</span> : null}</td>
                          <td>
                            <select className="select" style={{ minWidth: 130 }} value={row.type || 'MONTHLY'} onChange={e => setCcField(c.channelMasterId, 'type', e.target.value)}>
                              <option value="MONTHLY">Monthly commitment</option>
                              <option value="ANNUAL">Annual target</option>
                            </select>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <MoneyInput
                              className="input"
                              value={row.amount ?? ''}
                              onValueChange={v => setCcField(c.channelMasterId, 'amount', v)}
                              placeholder={row.type === 'ANNUAL' ? 'total for period' : 'per month'}
                              title={row.type === 'ANNUAL' ? 'Total for the whole period' : 'Amount per month'}
                              style={{ maxWidth: 170, textAlign: 'right' }}
                            />
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <select className="select" style={{ minWidth: 78 }} value={row.startMonth} onChange={e => setCcField(c.channelMasterId, 'startMonth', Number(e.target.value))}>
                                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                              </select>
                              <select className="select" style={{ minWidth: 84 }} value={row.startYear} onChange={e => setCcField(c.channelMasterId, 'startYear', Number(e.target.value))}>
                                {yrs.map(y => <option key={y} value={y}>{y}</option>)}
                              </select>
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <select className="select" style={{ minWidth: 78 }} value={row.endMonth} onChange={e => setCcField(c.channelMasterId, 'endMonth', Number(e.target.value))}>
                                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                              </select>
                              <select className="select" style={{ minWidth: 84 }} value={row.endYear} onChange={e => setCcField(c.channelMasterId, 'endYear', Number(e.target.value))}>
                                {yrs.map(y => <option key={y} value={y}>{y}</option>)}
                              </select>
                            </div>
                          </td>
                          <td>
                            <button className="btn btn-sm btn-subtle" onClick={() => saveChannelCommitment(c.channelMasterId)} disabled={ccSavingId === c.channelMasterId}>
                              {ccSavingId === c.channelMasterId ? '…' : 'Save'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
          </>
          ); })()}

          {/* ── Deal groups: one target across several channels ── */}
          {ccSubTab === 'group' && (
          <div style={{ paddingTop: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 740, color: 'var(--ink)' }}>Deal groups</div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3, maxWidth: 560, lineHeight: 1.5 }}>
                  One target across several channels (e.g. a media-group buy: Hiru FM + Sooriyan FM + Sun FM).
                  Achievement combines the spend of every channel in the group. Shown as one combined row on the Executive Dashboard.
                </div>
              </div>
              <button className="btn btn-primary" onClick={() => openCgModal(null)}>New deal group</button>
            </div>
            {cgGroups.length === 0 ? (
              <div style={{ padding: '18px', background: '#F7F8FA', borderRadius: 10, color: 'var(--muted)', fontSize: 13 }}>
                No deal groups yet. Create one to track a combined target across multiple channels.
              </div>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Group</th>
                      <th>Channels</th>
                      <th>Type</th>
                      <th style={{ textAlign: 'right' }}>Target (LKR)</th>
                      <th>Period</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cgGroups.map(g => (
                      <tr key={g.id}>
                        <td className="strong">{g.name}</td>
                        <td style={{ fontSize: 12.5 }}>{(g.channels || []).map(c => c.name).join(', ')}</td>
                        <td>{g.type === 'ANNUAL' ? 'Annual (total)' : 'Monthly'}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{g.amount != null ? fmtLKR(g.amount) : '-'}</td>
                        <td style={{ fontSize: 12.5, color: 'var(--muted)' }}>{MONTHS[(g.startMonth || 1) - 1]} {g.startYear} – {MONTHS[(g.endMonth || 1) - 1]} {g.endYear}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn btn-sm btn-subtle" onClick={() => openCgModal(g)}>Edit</button>
                          <button className="btn btn-sm btn-subtle" style={{ marginLeft: 6, color: '#C5391F' }} onClick={() => deleteCommitmentGroup(g)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          )}
        </div>
      )}

      {/* ============ DEAL GROUP MODAL ============ */}
      {cgModalOpen && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setCgModalOpen(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <div className="modal-head">
              <h2>{cgForm.id ? 'Edit deal group' : 'New deal group'}</h2>
              <button className="act-btn" onClick={() => setCgModalOpen(false)}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body">
              {cgError && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c', marginBottom: 16 }}>{cgError}</div>
              )}
              <div className="field">
                <label className="field-label">Group name <span className="req">*</span></label>
                <input className="input" value={cgForm.name} onChange={e => setCgForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Asia Broadcasting Radio deal" autoFocus />
              </div>
              <div className="field-grid2">
                <div className="field">
                  <label className="field-label">Type</label>
                  <select className="select" value={cgForm.type} onChange={e => setCgForm(f => ({ ...f, type: e.target.value }))}>
                    <option value="ANNUAL">Annual (total for period)</option>
                    <option value="MONTHLY">Monthly (per month)</option>
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">{cgForm.type === 'ANNUAL' ? 'Total target (LKR)' : 'Monthly target (LKR)'} <span className="req">*</span></label>
                  <MoneyInput className="input" value={cgForm.amount} onValueChange={v => setCgForm(f => ({ ...f, amount: v }))} placeholder="e.g. 10,000,000" style={{ textAlign: 'right' }} />
                </div>
              </div>
              <div className="field-grid2">
                <div className="field">
                  <label className="field-label">Start</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select className="select" value={cgForm.startMonth} onChange={e => setCgForm(f => ({ ...f, startMonth: Number(e.target.value) }))}>
                      {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                    </select>
                    <select className="select" value={cgForm.startYear} onChange={e => setCgForm(f => ({ ...f, startYear: Number(e.target.value) }))}>
                      {Array.from({ length: (new Date().getFullYear() + 2) - 2022 + 1 }, (_, i) => 2022 + i).map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label className="field-label">End</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select className="select" value={cgForm.endMonth} onChange={e => setCgForm(f => ({ ...f, endMonth: Number(e.target.value) }))}>
                      {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                    </select>
                    <select className="select" value={cgForm.endYear} onChange={e => setCgForm(f => ({ ...f, endYear: Number(e.target.value) }))}>
                      {Array.from({ length: (new Date().getFullYear() + 2) - 2022 + 1 }, (_, i) => 2022 + i).map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="field">
                <label className="field-label">Channels in this group <span className="req">*</span> <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({cgForm.channelMasterIds.length} selected)</span></label>
                <input className="input" value={cgChannelSearch} onChange={e => setCgChannelSearch(e.target.value)} placeholder="Search channels…" style={{ marginBottom: 8 }} />
                <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                  {ccChannels
                    .filter(c => !cgChannelSearch || c.name.toLowerCase().includes(cgChannelSearch.toLowerCase()) || (c.mediaGroup || '').toLowerCase().includes(cgChannelSearch.toLowerCase()))
                    .map(c => {
                      const on = cgForm.channelMasterIds.includes(c.channelMasterId);
                      return (
                        <label key={c.channelMasterId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', cursor: 'pointer', borderBottom: '1px solid #F1F2F5', background: on ? '#F5F0FB' : 'transparent' }}>
                          <input type="checkbox" checked={on} onChange={() => toggleCgChannel(c.channelMasterId)} />
                          <span style={{ fontSize: 13, fontWeight: on ? 700 : 500 }}>{c.name}</span>
                          <span className="medium-tag">{c.medium}</span>
                          {c.mediaGroup && <span style={{ fontSize: 11.5, color: 'var(--muted)', marginLeft: 'auto' }}>{c.mediaGroup}</span>}
                        </label>
                      );
                    })}
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setCgModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveCommitmentGroup} disabled={cgSaving}>{cgSaving ? 'Saving…' : 'Save group'}</button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'client-targets' && (() => {
        const filtered = ctClients.filter(c => !ctSearch || c.name.toLowerCase().includes(ctSearch.toLowerCase()) || (c.agencyName || '').toLowerCase().includes(ctSearch.toLowerCase()));
        const totalTarget = filtered.reduce((s, c) => s + (Number(ctAmounts[c.clientId]) || 0), 0);
        const setCount = filtered.filter(c => Number(ctAmounts[c.clientId]) > 0).length;
        // Group filtered clients by agency (preserve order).
        const groups = [];
        const gmap = new Map();
        filtered.forEach(c => {
          const key = c.agencyName || 'No agency';
          if (!gmap.has(key)) { gmap.set(key, { name: key, clients: [] }); groups.push(gmap.get(key)); }
          gmap.get(key).clients.push(c);
        });
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Toolbar */}
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 1px 2px rgba(15,31,61,.06)', padding: '16px 18px', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: 'linear-gradient(135deg,#D9521C,#B23F12)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="trending-up" size={20} /></div>
                <div>
                  <div style={{ fontSize: 16.5, fontWeight: 780, color: 'var(--ink)', lineHeight: 1.05 }}>Client Targets</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Yearly spend target per client · achieved from actual schedule spend</div>
                </div>
              </div>
              <div className="field" style={{ margin: 0, marginLeft: 'auto' }}>
                <label>Year</label>
                <select className="select" value={ctYear} onChange={e => setCtYear(Number(e.target.value))}>
                  {(ctYears.length ? ctYears : [ctYear]).map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div className="field" style={{ margin: 0, minWidth: 200 }}>
                <label>Search</label>
                <input className="input" type="text" value={ctSearch} onChange={e => setCtSearch(e.target.value)} placeholder="Client or agency…" />
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>Total target · {setCount} set</div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 750, color: '#D9521C' }}>{fmtLKR(totalTarget)}</div>
              </div>
            </div>

            {/* Table */}
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ padding: '11px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                Enter each client's <b style={{ color: 'var(--ink)' }}>yearly spend target</b> for {ctYear} (full LKR). Saved automatically when you leave a field; clear a value to remove the target.
              </div>
              {ctLoading ? (
                <div style={{ padding: '30px 0' }}><OrbitLoader label="Loading clients…" /></div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)' }}>No clients match your search.</div>
              ) : (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Client</th>
                        <th style={{ textAlign: 'right', width: 240 }}>Yearly Target (LKR)</th>
                        <th style={{ width: 90 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map(g => (
                        <Fragment key={g.name}>
                          <tr style={{ background: 'var(--bg,#F5F6F8)' }}>
                            <td colSpan={3} style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#6B7790', padding: '8px 12px' }}>
                              {g.name} <span style={{ color: 'var(--muted)', fontWeight: 600 }}>· {g.clients.length}</span>
                            </td>
                          </tr>
                          {g.clients.map(c => {
                            const has = Number(ctAmounts[c.clientId]) > 0;
                            return (
                              <tr key={c.clientId}>
                                <td className="strong">{c.name}</td>
                                <td style={{ textAlign: 'right' }}>
                                  <MoneyInput
                                    className="input"
                                    value={ctAmounts[c.clientId] ?? ''}
                                    onValueChange={v => setCtAmounts(a => ({ ...a, [c.clientId]: v }))}
                                    onBlur={() => saveClientTarget(c.clientId)}
                                    placeholder="Not set"
                                    style={{ maxWidth: 220, textAlign: 'right', ...(has ? {} : { color: 'var(--muted)' }) }}
                                    disabled={ctSavingId === c.clientId}
                                  />
                                </td>
                                <td style={{ fontSize: 12, color: '#15814B', fontWeight: 700 }}>
                                  {ctSavingId === c.clientId ? <span style={{ color: 'var(--muted)' }}>Saving…</span> : ctSavedId === c.clientId ? '✓ Saved' : ''}
                                </td>
                              </tr>
                            );
                          })}
                        </Fragment>
                      ))}
                      <tr style={{ borderTop: '2px solid var(--border)' }}>
                        <td className="strong">Total ({setCount} set)</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 750 }}>{fmtLKR(totalTarget)}</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ============ ANNUAL TARGETS TABLE ============ */}
      {activeTab === 'group-revenue' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* ── Toolbar ── */}
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 1px 2px rgba(15,31,61,.06)', padding: '16px 18px', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: 'linear-gradient(135deg,#15814B,#0E6B3D)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="money" size={20} /></div>
              <div>
                <div style={{ fontSize: 16.5, fontWeight: 780, color: 'var(--ink)', lineHeight: 1.05 }}>Group Revenue</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Actual billing, targets &amp; revenue by Hub</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginLeft: 'auto', flexWrap: 'wrap' }}>
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
              <button className="btn btn-primary" onClick={saveGroupRevenue} disabled={grSaving || grLoading}>
                {grSaving ? 'Saving…' : 'Save all'}
              </button>
              {grSavedAt && !grSaving && <span style={{ color: '#15814B', fontWeight: 700, fontSize: 13, alignSelf: 'center', whiteSpace: 'nowrap' }}>✓ Saved</span>}
            </div>
          </div>

          {/* ── Actual billing + Monthly target (two columns) ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>
            {/* Actual billing by agency */}
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: '#EAF0FA', color: '#1F5BB5', display: 'grid', placeItems: 'center' }}><Icon name="bar-chart" size={15} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 720, color: 'var(--ink)' }}>Actual billing</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{MONTHS[grMonth - 1]} {grYear} · by agency</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>Total</div>
                  <div className="mono" style={{ fontSize: 15, fontWeight: 750, color: '#1F5BB5' }}>{fmtLKR(grAgencyTotal)}</div>
                </div>
              </div>
              <div style={{ padding: '14px 16px' }}>
                {grAgencies.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '8px 0' }}>No agencies found.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {grAgencies.map(a => {
                      const av = Number(grAgencyAmounts[a.agencyId] || 0);
                      const apct = grAgencyTotal > 0 ? (av / grAgencyTotal) * 100 : 0;
                      return (
                        <div key={a.agencyId}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{a.agencyName}</label>
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{av > 0 ? `${apct.toFixed(1)}%` : ''}</span>
                          </div>
                          <MoneyInput
                            className="input"
                            value={grAgencyAmounts[a.agencyId] ?? ''}
                            onValueChange={v => { setGrSavedAt(null); setGrAgencyAmounts(m => ({ ...m, [a.agencyId]: v })); }}
                            placeholder="0"
                            style={{ textAlign: 'right' }}
                          />
                          <div style={{ height: 4, borderRadius: 3, background: '#EEF0F3', marginTop: 6, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(100, apct)}%`, height: '100%', background: '#1F5BB5', borderRadius: 3 }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 12, lineHeight: 1.5, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
                  Drives the <b style={{ color: 'var(--ink)' }}>Business Units Contribution</b> Revenue donut, and the month total feeds the <b style={{ color: 'var(--ink)' }}>Revenue Achievement</b> chart - no separate billing entry needed.
                </div>
              </div>
            </div>

            {/* Annual revenue target */}
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: '#FBF1DC', color: '#9A5B00', display: 'grid', placeItems: 'center' }}><Icon name="trending-up" size={15} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 720, color: 'var(--ink)' }}>Annual revenue target</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{grYear} · split evenly across 12 months</div>
                </div>
              </div>
              <div style={{ padding: '14px 16px' }}>
                <div className="field" style={{ margin: 0 }}>
                  <label style={{ fontSize: 12 }}>Amount per year (full LKR)</label>
                  <MoneyInput
                    className="input"
                    value={grRevenueTarget}
                    onValueChange={v => { setGrSavedAt(null); setGrRevenueTarget(v); }}
                    placeholder="e.g. 600,000,000"
                    style={{ textAlign: 'right' }}
                  />
                </div>
                {grRevenueTarget !== '' && Number(grRevenueTarget) > 0 && (
                  <div style={{ marginTop: 12, padding: '10px 12px', background: '#FCF7EC', border: '1px solid #F0E2C4', borderRadius: 10 }}>
                    <div style={{ fontSize: 10.5, color: '#9A5B00', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, marginBottom: 6 }}>
                      Monthly = {fmtLKR(Number(grRevenueTarget) / 12)} · cumulative = monthly × month
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {[3, 6, 9, 12].map(mn => (
                        <div key={mn} style={{ flex: '1 1 70px', textAlign: 'center', background: '#fff', border: '1px solid #F0E2C4', borderRadius: 8, padding: '6px 4px' }}>
                          <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700 }}>Up to {MONTHS[mn - 1]}</div>
                          <div className="mono" style={{ fontSize: 12.5, fontWeight: 750, color: 'var(--ink)' }}>{fmtLKR((Number(grRevenueTarget) / 12) * mn)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 12, lineHeight: 1.5, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
                  The yellow <b style={{ color: 'var(--ink)' }}>Target</b> bar on the Revenue Achievement chart = this ÷ 12 × months elapsed (e.g. an annual 120 → 60 at June). Leave blank to fall back to the prorated Annual Target.
                </div>
              </div>
            </div>
          </div>

          {/* ── Revenue by group head ── */}
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: '#ECF8F1', color: '#15814B', display: 'grid', placeItems: 'center' }}><Icon name="users" size={15} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 720, color: 'var(--ink)' }}>Revenue by Hub</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{MONTHS[grMonth - 1]} {grYear} · feeds the Revenue Contribution donut{grRevMode === 'client' ? ' · client entries roll up to each Hub' : ''}</div>
              </div>
              <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                {[['head', 'By Hub'], ['client', 'By client']].map(([k, lbl]) => (
                  <button key={k} onClick={() => setGrRevMode(k)} style={{ border: 'none', padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: grRevMode === k ? '#15814B' : '#fff', color: grRevMode === k ? '#fff' : 'var(--ink-soft)' }}>{lbl}</button>
                ))}
              </div>
              {grRevMode === 'client' && (
                <>
                  <input ref={crFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onImportFile} style={{ display: 'none' }} />
                  <button className="btn btn-ghost btn-sm" onClick={() => crFileRef.current?.click()} disabled={grLoading || grClients.length === 0} title="Import Client / Revenue / Rev. from finance from Excel">
                    <Icon name="upload" size={14} /> Import
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={exportClientRevenue} disabled={grLoading || grClients.length === 0}>
                    <Icon name="download" size={14} /> Export
                  </button>
                </>
              )}
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>Total</div>
                <div className="mono" style={{ fontSize: 15, fontWeight: 750, color: '#15814B' }}>{fmtLKR(grRevMode === 'client' ? grClientTotal : grTotal)}</div>
              </div>
            </div>
            {grLoading ? (
              <div style={{ padding: '30px 0' }}><OrbitLoader label="Loading Hub users…" /></div>
            ) : grRevMode === 'client' ? (
              grClients.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)' }}>
                  No Hub-assigned clients found. Assign clients to a Hub (Teams / Users) first.
                </div>
              ) : (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Client</th>
                        <th>Agency</th>
                        <th style={{ textAlign: 'right', width: 180 }}>Revenue (LKR)</th>
                        <th style={{ textAlign: 'right', width: 180 }}>Rev. from finance (LKR)</th>
                        <th style={{ width: 170 }}>Verification</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grClientsByHead.map(g => (
                        <Fragment key={g.headName}>
                          <tr style={{ background: g.noHead ? '#FBF2EF' : '#F6F8FA' }}>
                            <td colSpan={2} style={{ fontWeight: 750, color: g.noHead ? '#C5391F' : '#15814B' }}>
                              {g.noHead ? 'Unassigned' : g.headName}
                              {g.noHead && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: '#C5391F', background: '#FBE0DA', padding: '2px 7px', borderRadius: 5, textTransform: 'uppercase', letterSpacing: '.03em' }}>No Hub head</span>}
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 750 }} className="mono">{fmtLKR(g.subtotal)}</td>
                            <td style={{ textAlign: 'right', fontWeight: 750 }} className="mono">{fmtLKR(g.financeSubtotal)}</td>
                            <td />
                          </tr>
                          {g.clients.map(c => {
                            const vb = { VERIFIED: { bg: '#ECF8F1', fg: '#15814B', label: 'Verified' }, DISPUTED: { bg: '#FBE0DA', fg: '#C5391F', label: 'Disputed' }, PENDING: { bg: '#F1F3F6', fg: '#6B7790', label: 'Pending' } }[c.verifyStatus] || { bg: '#F1F3F6', fg: '#6B7790', label: 'Pending' };
                            return (
                            <tr key={c.clientId}>
                              <td className="strong" style={{ paddingLeft: 22 }}>
                                {c.name}
                                {c.isActive === false && <span style={{ marginLeft: 7, fontSize: 10.5, fontWeight: 700, color: '#9A5B00', background: '#FCF4E2', padding: '2px 7px', borderRadius: 5, textTransform: 'uppercase', letterSpacing: '.03em' }}>Inactive</span>}
                              </td>
                              <td style={{ color: 'var(--muted)', fontSize: 12 }}>{c.agencyName}</td>
                              <td style={{ textAlign: 'right' }}>
                                <MoneyInput
                                  className="input"
                                  value={grClientAmounts[c.clientId] ?? ''}
                                  onValueChange={v => { setGrSavedAt(null); setGrClientAmounts(a => ({ ...a, [c.clientId]: v })); scheduleClientSave(c.clientId); }}
                                  onBlur={() => scheduleClientSave(c.clientId, true)}
                                  placeholder="0"
                                  style={{ maxWidth: 160, textAlign: 'right' }}
                                />
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                                  <MoneyInput
                                    className="input"
                                    value={grClientFinanceAmounts[c.clientId] ?? ''}
                                    onValueChange={v => { setGrSavedAt(null); setGrClientFinanceAmounts(a => ({ ...a, [c.clientId]: v })); scheduleClientSave(c.clientId); }}
                                    onBlur={() => scheduleClientSave(c.clientId, true)}
                                    placeholder="0"
                                    style={{ maxWidth: 160, textAlign: 'right' }}
                                  />
                                  <span style={{ width: 16, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} title={crSave[c.clientId] === 'saving' ? 'Saving…' : crSave[c.clientId] === 'saved' ? 'Saved' : ''}>
                                    {crSave[c.clientId] === 'saving' && <span style={{ width: 12, height: 12, border: '2px solid #C7D0DD', borderTopColor: '#15814B', borderRadius: '50%', display: 'inline-block', animation: 'ob-spin .7s linear infinite' }} />}
                                    {crSave[c.clientId] === 'saved' && <Icon name="check" size={14} style={{ color: '#15814B' }} />}
                                  </span>
                                </div>
                              </td>
                              <td>
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: vb.bg, color: vb.fg }}>{vb.label}</span>
                                  {(c.verifyStatus === 'DISPUTED' || c.verifyStatus === 'VERIFIED') && (
                                    <button className="link-btn" title="Undo - reset back to Pending" onClick={() => resetVerification(c.clientId)}
                                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#9A5B00', fontWeight: 600, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                      <Icon name="history" size={12} /> Reset
                                    </button>
                                  )}
                                </div>
                                {c.verifyStatus === 'DISPUTED' && (
                                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }} title={c.verifyReason || ''}>
                                    → <span className="mono" style={{ fontWeight: 600 }}>{fmtLKRFull(c.verifiedAmount)}</span>{c.verifiedByName ? ` · ${c.verifiedByName}` : ''}
                                  </div>
                                )}
                                {c.verifyStatus === 'VERIFIED' && (
                                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }} title={c.verifyReason || ''}>
                                    {c.verifyReason || 'Confirmed with the finance'}{c.verifiedByName ? ` · ${c.verifiedByName}` : ''}
                                  </div>
                                )}
                              </td>
                            </tr>
                            );
                          })}
                        </Fragment>
                      ))}
                      <tr style={{ borderTop: '2px solid var(--border)' }}>
                        <td className="strong" colSpan={2}>Total</td>
                        <td style={{ textAlign: 'right', fontWeight: 750 }} className="mono">{fmtLKR(grClientTotal)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 750 }} className="mono">{fmtLKR(grClientFinanceTotal)}</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )
            ) : grHeads.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)' }}>
                No Hub users found. Add users with the Hub role first.
              </div>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Hub</th>
                      <th style={{ textAlign: 'right', width: 210 }}>Revenue (LKR)</th>
                      <th style={{ minWidth: 200 }}>Share</th>
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
                            <MoneyInput
                              className="input"
                              value={grAmounts[h.headUserId] ?? ''}
                              onValueChange={v => { setGrSavedAt(null); setGrAmounts(a => ({ ...a, [h.headUserId]: v })); }}
                              placeholder="0"
                              style={{ maxWidth: 190, textAlign: 'right' }}
                            />
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ flex: 1, background: '#EEF0F3', borderRadius: 5, height: 8, overflow: 'hidden' }}>
                                <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: '#15814B', borderRadius: 5 }} />
                              </div>
                              <span className="mono" style={{ width: 46, textAlign: 'right', fontWeight: 700, color: val > 0 ? 'var(--ink)' : 'var(--muted)' }}>{val > 0 ? `${pct.toFixed(1)}%` : '-'}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={{ borderTop: '2px solid var(--border)' }}>
                      <td className="strong">Total</td>
                      <td style={{ textAlign: 'right', fontWeight: 750 }} className="mono">{fmtLKR(grTotal)}</td>
                      <td style={{ color: 'var(--muted)', fontSize: 12 }}>{grHeads.length} Hub{grHeads.length === 1 ? '' : ' users'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'annual-targets' && (
        <div>
          {annualTargets.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--muted)', background: '#fff', border: '1px solid var(--border)', borderRadius: 14 }}>
              <Icon name="bar-chart" size={30} style={{ opacity: 0.4, marginBottom: 8 }} />
              <p style={{ margin: 0 }}>No annual targets set. Click "Set Target" to add one.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
              {annualTargets.slice().sort((a, b) => b.year - a.year).map(t => {
                const upto = t.remoteMonth ? Math.round((Number(t.totalTargetMillions) / 12) * t.remoteMonth) : null;
                return (
                  <div key={t.id} style={{ position: 'relative', overflow: 'hidden', background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14, boxShadow: '0 1px 2px rgba(15,31,61,.06)', padding: 18 }}>
                    <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #1F5BB5, #1F5BB51A 70%, transparent)' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 10, background: '#EDF3FD', color: '#1F5BB5', display: 'grid', placeItems: 'center' }}><Icon name="bar-chart" size={16} /></div>
                        <span style={{ fontSize: 18, fontWeight: 750, color: '#16243C' }}>{t.year}</span>
                      </div>
                      <div className="row-actions">
                        <button className="act-btn" onClick={() => openEditTarget(t)} title="Edit target"><Icon name="edit" size={15} /></button>
                        <button className="act-btn" onClick={() => confirmDelete({ ...t, name: `${t.year} target` }, 'annual-targets')} title="Delete target" style={{ color: 'var(--red-600,#dc2626)' }}><Icon name="x" size={15} /></button>
                      </div>
                    </div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#93A0B5' }}>Annual Target</div>
                    <div className="mono" style={{ fontSize: 26, fontWeight: 750, color: '#16243C', lineHeight: 1.1, marginTop: 2 }}>{Number(t.totalTargetMillions).toLocaleString('en-US')}<span style={{ fontSize: 14, color: 'var(--muted)', marginLeft: 3 }}>M</span></div>
                    <div style={{ display: 'flex', gap: 18, marginTop: 14, paddingTop: 12, borderTop: '1px solid #EEF0F3' }}>
                      <div>
                        <div style={{ fontSize: 10.5, color: '#93A0B5', marginBottom: 2 }}>Pacing month</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: t.remoteMonth ? '#16243C' : 'var(--muted)' }}>{t.remoteMonth ? MONTHS[t.remoteMonth - 1] : 'Auto'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10.5, color: '#93A0B5', marginBottom: 2 }}>Upto-month target</div>
                        <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: upto != null ? '#16243C' : 'var(--muted)' }}>{upto != null ? `${upto.toLocaleString('en-US')}M` : 'Auto'}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Per-agency targets → Spend Analytics agency-wise Annual Achievement */}
          <div style={{ marginTop: 28 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end', marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontWeight: 700, color: 'var(--ink)' }}>Agency Targets</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>Per-agency annual target (LKR millions). Drives the agency-wise Annual Achievement chart on Spend Analytics. Saved when you leave a field; clear to remove.</p>
              </div>
              <div className="field" style={{ margin: 0, marginLeft: 'auto' }}>
                <label>Year</label>
                <select className="select" value={agTargetYear} onChange={e => setAgTargetYear(Number(e.target.value))}>
                  {(agTargetYears.length ? agTargetYears : [agTargetYear]).map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
            {agTargetLoading ? (
              <div style={{ padding: '24px 0' }}><OrbitLoader label="Loading agencies…" /></div>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Agency</th>
                      <th style={{ textAlign: 'right' }}>Annual Target (LKR M)</th>
                      <th style={{ textAlign: 'right' }}>Monthly pace (÷12)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agTargets.map(a => {
                      const val = Number(agTargetVals[a.agencyId] || 0);
                      return (
                        <tr key={a.agencyId}>
                          <td className="strong">{a.agencyName}</td>
                          <td style={{ textAlign: 'right' }}>
                            <MoneyInput
                              className="input"
                              value={agTargetVals[a.agencyId] ?? ''}
                              onValueChange={v => setAgTargetVals(vals => ({ ...vals, [a.agencyId]: v }))}
                              onBlur={() => saveAgencyTarget(a.agencyId)}
                              placeholder="-"
                              style={{ maxWidth: 170, textAlign: 'right' }}
                              disabled={agTargetSavingId === a.agencyId}
                            />
                          </td>
                          <td style={{ textAlign: 'right', color: 'var(--muted)' }} className="mono">{val > 0 ? `${(val / 12).toFixed(1)}M` : '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============ AOR REVENUE (monthly per-channel lines) ============ */}
      {activeTab === 'aor' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Toolbar */}
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 1px 2px rgba(15,31,61,.06)', padding: '16px 18px', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: 'linear-gradient(135deg,#E85D24,#C44A18)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="money" size={20} /></div>
              <div>
                <div style={{ fontSize: 16.5, fontWeight: 780, color: 'var(--ink)', lineHeight: 1.05 }}>AVR Revenue</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Monthly AVR revenue by channel · stacked on the Revenue-by-billing chart</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginLeft: 'auto', flexWrap: 'wrap' }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Month</label>
                <select className="select" value={aorMonth} onChange={e => setAorMonth(Number(e.target.value))}>
                  {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Year</label>
                <select className="select" value={aorYear} onChange={e => setAorYear(Number(e.target.value))}>
                  {Array.from({ length: (new Date().getFullYear() + 1) - 2022 + 1 }, (_, i) => 2022 + i).map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Add entry + month list */}
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 720, color: 'var(--ink)' }}>{MONTHS[aorMonth - 1]} {aorYear}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>one row per channel</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>Month total</div>
                <div className="mono" style={{ fontSize: 15, fontWeight: 750, color: '#E85D24' }}>{fmtLKR(aorMonthTotals[aorMonth] || 0)}</div>
              </div>
            </div>
            {/* Add row */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="field" style={{ margin: 0, flex: '2 1 180px' }}>
                <label>Channel</label>
                <input className="input" value={aorForm.channel} placeholder="e.g. Derana TV" onChange={e => setAorForm(f => ({ ...f, channel: e.target.value }))} />
              </div>
              <div className="field" style={{ margin: 0, flex: '1 1 140px' }}>
                <label>Amount (LKR)</label>
                <MoneyInput className="input" value={aorForm.amount} onValueChange={v => setAorForm(f => ({ ...f, amount: v }))} placeholder="0" style={{ textAlign: 'right' }} />
              </div>
              <div className="field" style={{ margin: 0, flex: '2 1 200px' }}>
                <label>Reason</label>
                <input className="input" value={aorForm.reason} placeholder="optional" onChange={e => setAorForm(f => ({ ...f, reason: e.target.value }))} />
              </div>
              <button className="btn btn-primary" onClick={addAorEntry} disabled={aorSaving}>{aorSaving ? 'Adding…' : 'Add'}</button>
            </div>
            {/* Month entries */}
            <div style={{ padding: '4px 0' }}>
              {aorLoading ? (
                <div style={{ padding: 20 }}><OrbitLoader label="Loading AVR…" /></div>
              ) : (() => {
                const rows = aorEntries.filter(e => e.month === aorMonth);
                if (rows.length === 0) return <div style={{ padding: '18px 16px', fontSize: 12.5, color: 'var(--muted)' }}>No AVR entries for {MONTHS[aorMonth - 1]} {aorYear} yet.</div>;
                return (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="tbl" style={{ margin: 0 }}>
                      <thead>
                        <tr><th>Channel</th><th style={{ textAlign: 'right' }}>Amount</th><th>Reason</th><th style={{ width: 60 }} /></tr>
                      </thead>
                      <tbody>
                        {rows.map(e => (
                          <tr key={e.id}>
                            <td className="strong">{e.channel}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(e.amount)}</td>
                            <td style={{ color: 'var(--muted)', fontSize: 12.5 }}>{e.reason || '-'}</td>
                            <td style={{ textAlign: 'right' }}>
                              <button className="btn btn-ghost btn-sm" onClick={() => deleteAorEntry(e.id)} title="Delete"><Icon name="trash" size={14} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Year-at-a-glance month totals */}
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ fontSize: 13.5, fontWeight: 720, color: 'var(--ink)', marginBottom: 10 }}>{aorYear} · AVR by month</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
              {MONTHS.map((m, i) => {
                const t = aorMonthTotals[i + 1] || 0;
                const on = (i + 1) === aorMonth;
                return (
                  <button key={m} onClick={() => setAorMonth(i + 1)} style={{ textAlign: 'left', cursor: 'pointer', background: on ? '#FCEEE6' : '#F7F8FA', border: `1px solid ${on ? '#E85D24' : 'var(--border)'}`, borderRadius: 9, padding: '8px 10px' }}>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700 }}>{m}</div>
                    <div className="mono" style={{ fontSize: 12, fontWeight: 700, color: t ? 'var(--ink)' : 'var(--muted)' }}>{t ? fmtLKR(t) : '-'}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ============ REQUESTS (Channel / Client sub-tabs) ============ */}
      {activeTab === 'requests' && (
        <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
          {[
            ['channel', 'Channel Request', channelRequests.filter(r => r.status === 'pending').length],
            ['client', 'Client Request', clientRequests.filter(r => r.status === 'pending').length],
          ].map(([k, lbl, cnt]) => (
            <button key={k} onClick={() => setRequestSubTab(k)}
              style={{ border: 'none', padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: requestSubTab === k ? '#0A1729' : '#fff', color: requestSubTab === k ? '#fff' : 'var(--ink-soft)', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              {lbl}
              {cnt > 0 && <span style={{ fontSize: 11, fontWeight: 800, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, display: 'inline-grid', placeItems: 'center', background: requestSubTab === k ? '#E85D24' : '#FBE0DA', color: requestSubTab === k ? '#fff' : '#C5391F' }}>{cnt}</span>}
            </button>
          ))}
        </div>
      )}

      {/* ============ CLIENT REQUESTS TABLE ============ */}
      {activeTab === 'requests' && requestSubTab === 'client' && (
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
      {activeTab === 'requests' && requestSubTab === 'channel' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Channel Name</th><th>Category</th><th>Requested By</th><th>Notes</th><th>Media Group</th><th>Status</th><th style={{ textAlign: 'right' }}>Action</th></tr>
            </thead>
            <tbody>
              {channelRequests.map(r => (
                <tr key={r.id} style={{ opacity: r.status === 'pending' ? 1 : 0.6 }}>
                  <td className="strong">{r.channelName}</td>
                  <td><span className="medium-tag" data-medium={r.category}>{r.category}</span></td>
                  <td>{r.requestedByName}</td>
                  <td style={{ color: 'var(--muted)' }}>{r.notes || '-'}</td>
                  <td>
                    {r.status === 'pending' ? (
                      <select
                        className="select"
                        style={{ minWidth: 190, maxWidth: 240 }}
                        value={channelReqGroup[r.id] || ''}
                        onChange={e => setChannelReqGroup(m => ({ ...m, [r.id]: e.target.value }))}
                      >
                        <option value="">Select media group…</option>
                        {mediaGroups.filter(g => g.isActive !== false).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    ) : <span style={{ fontSize: 12, color: 'var(--muted)' }}>-</span>}
                  </td>
                  <td><span className="badge">{r.status}</span></td>
                  <td>
                    {r.status === 'pending' ? (
                      <div className="row-actions">
                        <button className="act-btn" title={channelReqGroup[r.id] ? 'Approve' : 'Pick a media group first'} style={{ color: channelReqGroup[r.id] ? 'var(--green-600)' : 'var(--muted)' }} disabled={!channelReqGroup[r.id]} onClick={() => reviewRequest('channel', r, 'approved')}><Icon name="check" size={15} /></button>
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
              {['GROUP_HEAD', 'PLANNER', 'MANAGER', 'SUPER_ADMIN'].map((r) => {
                const on = notifyRoles.includes(r);
                return (
                  <button key={r} type="button" onClick={() => toggleNotifyRole(r)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
                      border: `1px solid ${on ? 'var(--coral-600, #E85D24)' : 'var(--border)'}`,
                      background: on ? 'var(--coral-50, #fff3ee)' : 'var(--card)',
                      color: on ? 'var(--coral-700, #C44A18)' : 'var(--ink-soft)', fontSize: 12.5, fontWeight: 600 }}>
                    {on && <Icon name="check" size={13} />}{roleLabel(r)}
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
          {/* Schedule-log yearly archive to Drive (keeps DB rows) */}
          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 720, color: 'var(--ink)' }}>Schedule logs archive to Google Drive</div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5, maxWidth: 520 }}>
                  Export a full year of schedule logs (all columns) to an Excel file in Drive, in a per-year folder (Orbit Schedule Logs / year). The rows stay in the database.
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {slArchive && (
                  <span className="badge" style={{ background: slArchive.configured ? '#ECF8F1' : '#FBE0DA', color: slArchive.configured ? '#15814B' : '#C5391F', fontWeight: 700 }}>
                    {slArchive.configured ? 'Drive ready' : 'Not configured'}
                  </span>
                )}
                <select className="select" value={slYear} onChange={e => { setSlMsg(''); setSlYear(e.target.value); }} style={{ minWidth: 130 }}>
                  {(slArchive?.years || []).length === 0 && <option value="">No data</option>}
                  {(slArchive?.years || []).map(y => (
                    <option key={y.year} value={y.year}>{y.year} ({y.rows.toLocaleString('en-US')} rows)</option>
                  ))}
                </select>
                <button className="btn btn-primary" disabled={slArchiving || !slYear || !slArchive?.configured} onClick={archiveScheduleYear}>
                  {slArchiving ? 'Exporting…' : 'Export to Drive'}
                </button>
              </div>
            </div>
            {slMsg && (
              <div style={{ marginTop: 14, fontSize: 12.5, fontWeight: 600, color: /fail|error|not configured|no schedule/i.test(slMsg) ? 'var(--red-600)' : 'var(--green-600)' }}>
                {slMsg}
              </div>
            )}
            {slArchive && !slArchive.configured && (
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                Uses the same Google Drive connection as the database backup below. Configure that first (OAuth env vars, or a service account + folder id).
              </div>
            )}
          </div>

          {/* Daily per-tab Excel export (revenue / master data / targets) */}
          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 720, color: 'var(--ink)' }}>Daily data export to Google Drive (Excel)</div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5, maxWidth: 540 }}>
                  Every revenue, master-data and target tab is auto-exported as its own Excel file into a date-wise
                  Drive tree <b>Data Exports / year / month / date /</b> (all that day's backup Excels in one date folder).
                  Runs daily at 02:00 (Asia/Colombo); the newest {dataExport?.retention ?? 10} days are kept and older date folders removed.
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {dataExport && (
                  <span className="badge" style={{ background: dataExport.configured ? '#ECF8F1' : '#FBE0DA', color: dataExport.configured ? '#15814B' : '#C5391F', fontWeight: 700 }}>
                    Drive: {dataExport.configured ? 'Enabled' : 'Not configured'}
                  </span>
                )}
                <button className="btn btn-primary" disabled={dataExportRunning || !dataExport?.configured} onClick={runDataExportNow}>
                  {dataExportRunning ? 'Exporting…' : 'Export now'}
                </button>
              </div>
            </div>
            {dataExport?.lastRun && (
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
                Last run: <b style={{ color: 'var(--ink)' }}>{dataExport.lastRun.status}</b>
                {dataExport.lastRun.at ? ` · ${new Date(dataExport.lastRun.at).toLocaleString()}` : ''}
                {Array.isArray(dataExport.lastRun.datasets) ? ` · ${dataExport.lastRun.datasets.filter(d => !d.error).length}/${dataExport.lastRun.datasets.length} tabs` : ''}
              </div>
            )}
            {dataExportMsg && (
              <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 600, color: /fail|error|not configured/i.test(dataExportMsg) ? 'var(--red-600)' : 'var(--green-600)' }}>
                {dataExportMsg}
              </div>
            )}
            {dataExport && !dataExport.configured && (
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                Uses the same Google Drive connection as the database backup below. Configure that first.
              </div>
            )}
          </div>

          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 720, color: 'var(--ink)' }}>Database backup &amp; restore</div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
                  A full, restorable dump of the whole database - every table, target, setting and number.
                  Download a copy locally, upload to Google Drive, or restore from a backup file.
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {backup && (
                  <span className="badge" style={{ background: backup.configured ? '#ECF8F1' : '#FBE0DA', color: backup.configured ? '#15814B' : '#C5391F', fontWeight: 700 }}>
                    Drive: {backup.configured ? 'Enabled' : 'Not configured'}
                  </span>
                )}
                <button className="btn btn-ghost" disabled={backupDownloading || restoring} onClick={downloadBackupNow}>
                  {backupDownloading ? 'Preparing…' : 'Download backup'}
                </button>
                <button className="btn btn-primary" disabled={backupRunning || !backup?.configured} onClick={runBackupNow}>
                  {backupRunning ? 'Backing up…' : 'Back up to Drive'}
                </button>
              </div>
            </div>

            {/* Restore from an uploaded backup file */}
            <div style={{ marginTop: 16, padding: '14px 16px', background: '#FFF7F5', border: '1px solid #F3D3CB', borderRadius: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 720, color: '#9A3412' }}>Restore from a backup file</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2, maxWidth: 460 }}>
                    Upload a <code>.sql</code> or <code>.sql.gz</code> dump to replace ALL current data with that
                    backup. This cannot be undone.
                  </div>
                </div>
                <input
                  ref={restoreInputRef}
                  type="file"
                  accept=".gz,.sql,application/gzip,application/sql,application/octet-stream"
                  style={{ display: 'none' }}
                  onChange={(e) => restoreFromFile(e.target.files?.[0])}
                />
                <button
                  className="btn btn-ghost"
                  style={{ borderColor: '#E4A08C', color: '#9A3412' }}
                  disabled={restoring || backupRunning}
                  onClick={() => restoreInputRef.current?.click()}
                >
                  {restoring ? 'Restoring…' : 'Choose file & restore'}
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
                  <li><code>GOOGLE_SERVICE_ACCOUNT_JSON</code>: a Google service-account key (raw JSON or base64)</li>
                  <li><code>GDRIVE_BACKUP_FOLDER_ID</code>: the Drive folder ID, shared with the service account as Editor</li>
                </ul>
              </div>
            )}
          </div>

          {backup?.configured && (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Backup file</th><th>Size</th><th>Created</th><th style={{ textAlign: 'right' }}>Restore</th></tr></thead>
                <tbody>
                  {(backup.backups || []).map(f => (
                    <tr key={f.id}>
                      <td className="strong" style={{ fontFamily: "'Spline Sans Mono', monospace", fontSize: 12 }}>{f.name}</td>
                      <td>{f.size ? `${(Number(f.size) / 1024).toFixed(1)} KB` : '-'}</td>
                      <td style={{ color: 'var(--muted)' }}>{f.createdTime ? new Date(f.createdTime).toLocaleString() : '-'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-ghost btn-sm" disabled={restoring || backupRunning} onClick={() => restoreFromDriveBackup(f)}>
                          Restore
                        </button>
                      </td>
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

      {/* ============ CLIENT GROUPS ============ */}
      {activeTab === 'client-groups' && (
        <ClientGroupsTab agencies={agencies} allClients={allClients} />
      )}

      {/* ============ CLIENT GROUP TARGETS ============ */}
      {activeTab === 'client-group-targets' && (
        <ClientGroupTargetsTab />
      )}

      {/* ============ ERRORS ============ */}
      {activeTab === 'client-records' && (() => {
        const recClients = allClients
          .filter(c => !recAgencyId || String(c.agencyId) === String(recAgencyId))
          .slice()
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        const s = recSummary;
        const nameMatches = !!s && recConfirmName.trim().toLowerCase() === (s.client?.name || '').trim().toLowerCase();
        const fmtM = (ym) => {
          if (!ym) return '-';
          const [y, m] = String(ym).split('-');
          return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        };
        return (
          <div>
            <div className="card" style={{ padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 720, color: 'var(--ink)', marginBottom: 4 }}>Client records</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 16, maxWidth: 760, lineHeight: 1.55 }}>
                Wipe every schedule record for one client so you can re-upload it from scratch - for example after
                the client renames or restructures its brands. Removed rows stop counting everywhere immediately
                (dashboards, revenue, exports) and no longer block re-upload as duplicates. This is the same
                reversible delete the batch delete uses, so the rows stay recoverable in the database.
              </div>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="field" style={{ margin: 0, minWidth: 200 }}>
                  <label>Agency (optional)</label>
                  <select className="select" value={recAgencyId} onChange={(e) => { setRecAgencyId(e.target.value); setRecClientId(''); }}>
                    <option value="">All agencies</option>
                    {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="field" style={{ margin: 0, minWidth: 260 }}>
                  <label>Client</label>
                  <select className="select" value={recClientId} onChange={(e) => { setRecClientId(e.target.value); setRecConfirmName(''); }}>
                    <option value="">Select a client…</option>
                    {recClients.map(c => <option key={c.id} value={c.id}>{c.name}{c.isActive === false ? ' (inactive)' : ''}</option>)}
                  </select>
                </div>
                {recClientId && (
                  <button className="btn btn-ghost" onClick={() => fetchClientRecords(recClientId)} disabled={recLoading}>
                    <Icon name="history" size={15} /> Refresh
                  </button>
                )}
              </div>
            </div>

            {recError && (
              <div style={{ marginBottom: 14, padding: '10px 13px', borderRadius: 9, background: 'var(--red-100,#fef2f2)', color: 'var(--red-600,#b91c1c)', fontSize: 13, fontWeight: 600 }}>{recError}</div>
            )}
            {recResult && (
              <div style={{ marginBottom: 14, padding: '10px 13px', borderRadius: 9, background: 'var(--green-100,#ecfdf5)', color: 'var(--green-600,#15814B)', fontSize: 13, fontWeight: 600 }}>{recResult}</div>
            )}

            {!recClientId ? (
              <div className="card" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)' }}>
                <Icon name="database" size={28} style={{ opacity: 0.35, marginBottom: 8 }} />
                <div style={{ fontSize: 13.5 }}>Pick a client to see what is currently stored for it.</div>
              </div>
            ) : recLoading ? (
              <OrbitLoader label="Loading client records…" />
            ) : !s ? null : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
                  {[
                    ['Records', s.rows.toLocaleString('en-US'), 'live schedule rows'],
                    ['Schedule value', fmtLKR(s.totalValue), 'total of those rows'],
                    ['Period', s.firstMonth ? `${fmtM(s.firstMonth)} - ${fmtM(s.lastMonth)}` : '-', `${s.monthCount} month${s.monthCount === 1 ? '' : 's'}`],
                    ['Uploads', String(s.batchCount), `${s.brandCount} brand${s.brandCount === 1 ? '' : 's'}`],
                  ].map(([label, value, sub]) => (
                    <div key={label} className="card" style={{ padding: '14px 16px' }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#93A0B5', marginBottom: 6 }}>{label}</div>
                      <div className="mono" style={{ fontSize: 17, fontWeight: 750, color: 'var(--ink)', wordBreak: 'break-word' }}>{value}</div>
                      <div style={{ fontSize: 11, color: '#93A0B5', marginTop: 3 }}>{sub}</div>
                    </div>
                  ))}
                </div>

                {s.months.length > 0 && (
                  <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
                    <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13.5 }}>
                      What would be removed - {s.monthCount} month{s.monthCount === 1 ? '' : 's'}
                    </div>
                    <div className="tbl-wrap" style={{ maxHeight: 260, overflow: 'auto' }}>
                      <table className="tbl" style={{ margin: 0 }}>
                        <thead><tr><th>Month</th><th style={{ textAlign: 'right' }}>Records</th><th style={{ textAlign: 'right' }}>Schedule value</th></tr></thead>
                        <tbody>
                          {s.months.map(m => (
                            <tr key={m.month}>
                              <td className="strong">{fmtM(m.month)}</td>
                              <td style={{ textAlign: 'right' }}>{m.rows}</td>
                              <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(m.value)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="card" style={{ padding: 20, border: '1px solid var(--red-200,#fecaca)' }}>
                  <div style={{ fontSize: 14, fontWeight: 720, color: 'var(--red-600,#b91c1c)', marginBottom: 4 }}>Delete all records for this client</div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.55 }}>
                    {s.rows === 0
                      ? <>There are no live records for <b>{s.client?.name}</b>{s.alreadyDeleted > 0 ? <> ({s.alreadyDeleted.toLocaleString('en-US')} already removed earlier)</> : ''} - nothing to delete. You can upload this client fresh from the Database page.</>
                      : <>This removes all <b>{s.rows.toLocaleString('en-US')}</b> records for <b>{s.client?.name}</b>{s.client?.agencyName ? ` (${s.client.agencyName})` : ''}, across {fmtM(s.firstMonth)} - {fmtM(s.lastMonth)}. Type the client name to confirm.</>}
                  </div>
                  {s.rows > 0 && (
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <input
                        className="input"
                        value={recConfirmName}
                        onChange={(e) => setRecConfirmName(e.target.value)}
                        placeholder={s.client?.name || 'Client name'}
                        style={{ maxWidth: 300 }}
                      />
                      <button
                        className="btn btn-primary"
                        onClick={purgeClientRecords}
                        disabled={!nameMatches || recPurging}
                        style={{ background: nameMatches ? 'var(--red-600,#dc2626)' : undefined, borderColor: 'transparent' }}
                      >
                        <Icon name="trash" size={15} /> {recPurging ? 'Deleting…' : `Delete ${s.rows.toLocaleString('en-US')} records`}
                      </button>
                      {!nameMatches && recConfirmName && (
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Name does not match yet.</span>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })()}

      {activeTab === 'errors' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                { k: 'unresolved', label: 'Unresolved' },
                { k: 'all', label: 'All' },
                { k: 'frontend', label: 'Frontend' },
                { k: 'backend', label: 'Backend' },
              ].map(f => {
                const on = errFilter === f.k;
                return (
                  <button key={f.k} onClick={() => setErrFilter(f.k)} style={{
                    border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '7px 13px',
                    borderRadius: 8, fontFamily: 'inherit', background: on ? '#0F1F3D' : '#EEF0F3', color: on ? '#fff' : '#6B7790',
                  }}>{f.label}</button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                {errUnresolved} unresolved &middot; {errTotal} shown
              </span>
              <button className="btn btn-ghost btn-sm" onClick={fetchErrorLogs}>Refresh</button>
              <button className="btn btn-ghost btn-sm" onClick={() => clearErrorLogs(true)} title="Delete resolved entries">Clear resolved</button>
              <button className="btn btn-ghost btn-sm" onClick={() => clearErrorLogs(false)} title="Delete every entry" style={{ color: 'var(--red-600,#dc2626)' }}>Clear all</button>
            </div>
          </div>

          {errLoading ? (
            <OrbitLoader label="Loading errors…" />
          ) : errorLogs.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '48px 0', color: 'var(--muted)' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>No errors logged</div>
              <div style={{ fontSize: 12.5 }}>{errFilter === 'unresolved' ? 'Nothing unresolved right now.' : 'Nothing to show for this filter.'}</div>
            </div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Source</th>
                    <th>User</th>
                    <th>Page / Route</th>
                    <th>Message</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {errorLogs.map(row => (
                    <Fragment key={row.id}>
                      <tr style={{ opacity: row.resolved ? 0.55 : 1 }}>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{new Date(row.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                        <td>
                          <span className="badge" style={{ background: row.source === 'frontend' ? '#EAF1FC' : '#F3ECFB', color: row.source === 'frontend' ? '#1F5BB5' : '#6B34C0', fontWeight: 700, fontSize: 11 }}>
                            {row.source}{row.statusCode ? ` ${row.statusCode}` : ''}
                          </span>
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {row.userEmail ? (
                            <span title={row.userRole || ''}>{row.userEmail}</span>
                          ) : <span style={{ color: 'var(--muted)' }}>anonymous</span>}
                        </td>
                        <td style={{ fontSize: 12, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.url || ''}>
                          {row.method ? <b style={{ color: 'var(--muted)' }}>{row.method} </b> : ''}{row.url || '-'}
                        </td>
                        <td style={{ fontSize: 12.5, maxWidth: 340 }}>
                          <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.message}>{row.message}</span>
                          {/* Always expandable - a long message is unreadable in the
                              cell even when there is no stack to go with it. */}
                          <button onClick={() => setErrExpanded(errExpanded === row.id ? null : row.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--coral-700,#C44A18)', fontWeight: 600, fontSize: 11.5, padding: 0, marginTop: 2 }}>
                            {errExpanded === row.id ? 'Hide details' : 'Show details'}
                          </button>
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button onClick={() => resolveErrorLog(row.id, !row.resolved)} className="btn btn-ghost btn-sm" title={row.resolved ? 'Mark unresolved' : 'Mark resolved'}>
                            {row.resolved ? 'Reopen' : 'Resolve'}
                          </button>
                          <button onClick={() => deleteErrorLog(row.id)} className="btn btn-ghost btn-sm" title="Delete" style={{ marginLeft: 6, color: 'var(--red-600,#dc2626)' }}>
                            <Icon name="trash" size={14} />
                          </button>
                        </td>
                      </tr>
                      {errExpanded === row.id && (
                        <tr>
                          <td colSpan={6} style={{ background: '#0A1729', padding: '14px 18px' }}>
                            {/* The full message the user was shown, then the technical
                                context. The message is what support actually needs. */}
                            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#7C8CA6', marginBottom: 5 }}>Message shown to the user</div>
                            <pre style={{ margin: '0 0 14px', color: '#FFD9CC', fontSize: 12.5, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--font-mono, monospace)' }}>
                              {row.message}
                            </pre>
                            <div style={{ fontSize: 11.5, color: '#8FA0B8', lineHeight: 1.7, marginBottom: row.stack ? 12 : 0 }}>
                              <div><b style={{ color: '#C7D2E0' }}>When:</b> {new Date(row.createdAt).toLocaleString('en-GB')}</div>
                              <div><b style={{ color: '#C7D2E0' }}>User:</b> {row.userEmail || 'anonymous'}{row.userRole ? ` · ${row.userRole}` : ''}</div>
                              <div style={{ wordBreak: 'break-all' }}><b style={{ color: '#C7D2E0' }}>Where:</b> {row.method ? `${row.method} ` : ''}{row.url || '-'}{row.statusCode ? ` · HTTP ${row.statusCode}` : ''}</div>
                              {row.userAgent && <div style={{ wordBreak: 'break-all' }}><b style={{ color: '#C7D2E0' }}>Browser:</b> {row.userAgent}</div>}
                            </div>
                            {row.stack && (
                              <>
                                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#7C8CA6', marginBottom: 5 }}>Stack trace</div>
                                <pre style={{ margin: 0, color: '#C7D2E0', fontSize: 11.5, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--font-mono, monospace)', maxHeight: 320, overflow: 'auto' }}>
                                  {row.stack}
                                </pre>
                              </>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ============ IMPORT REVENUE BY CLIENT MODAL ============ */}
      {crImport && (() => {
        const isMatched = (r) => r.matchId !== '' && r.matchId != null;
        const status = (r) => (!isMatched(r) ? 'skip' : (r.exact ? 'matched' : 'confirm'));
        const matched = crImport.rows.filter(isMatched).length;
        const confirmCount = crImport.rows.filter(r => status(r) === 'confirm').length;
        const skipCount = crImport.rows.filter(r => status(r) === 'skip').length;
        const rosterSorted = [...grClients].sort((a, b) => a.name.localeCompare(b.name));
        const fmtAmt = (n) => (n == null ? '-' : (n < 0 ? `(${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })));
        const ST = {
          matched: { bg: '#ECF8F1', fg: '#15814B', dot: '#15814B', icon: 'check', label: 'Matched' },
          confirm: { bg: '#FCF4E2', fg: '#9A5B00', dot: '#E0A423', icon: 'alert', label: 'Confirm' },
          skip: { bg: '#FBE0DA', fg: '#C5391F', dot: '#C5391F', icon: 'x', label: 'Skipped' },
        };
        const Chip = ({ n, s }) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 9, background: ST[s].bg, minWidth: 118 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: ST[s].dot, flexShrink: 0 }} />
            <span style={{ fontSize: 18, fontWeight: 800, color: ST[s].fg, lineHeight: 1 }}>{n}</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: ST[s].fg, textTransform: 'uppercase', letterSpacing: '.03em' }}>{ST[s].label}</span>
          </div>
        );
        return (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setCrImport(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 900, width: '100%', padding: 0, overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 22px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: '#EDF3FD', color: '#1F5BB5', display: 'grid', placeItems: 'center' }}><Icon name="upload" size={18} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16.5, fontWeight: 750, color: 'var(--ink)' }}>Import Revenue by Client</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <Icon name="file" size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />{crImport.fileName} · into <b style={{ color: 'var(--ink-soft)' }}>{MONTHS[grMonth - 1]} {grYear}</b> · {crImport.rows.length} row(s)
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setCrImport(null)}><Icon name="x" size={16} /></button>
            </div>

            {/* Summary chips */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '14px 22px', background: '#F8FAFC', borderBottom: '1px solid var(--border)' }}>
              <Chip n={matched} s="matched" />
              {confirmCount > 0 && <Chip n={confirmCount} s="confirm" />}
              {skipCount > 0 && <Chip n={skipCount} s="skip" />}
              <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)', maxWidth: 320, lineHeight: 1.45, textAlign: 'right' }}>
                Confirm the amber rows (pick the right client or Skip). Amounts like <b>(1,000)</b> import as negative. <b style={{ color: '#C5391F' }}>This replaces {MONTHS[grMonth - 1]} {grYear}</b> - clients not in the file are cleared.
              </div>
            </div>

            {/* Rows */}
            <div style={{ maxHeight: '50vh', overflowY: 'auto', padding: '6px 12px 2px' }}>
              <table className="tbl" style={{ tableLayout: 'fixed', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ width: 34 }} />
                    <th>Client in file</th>
                    <th style={{ width: 130, textAlign: 'right' }}>Revenue</th>
                    <th style={{ width: 130, textAlign: 'right' }}>Rev. finance</th>
                    <th style={{ width: 260 }}>Match to client</th>
                  </tr>
                </thead>
                <tbody>
                  {crImport.rows.map(r => {
                    const st = status(r); const S = ST[st];
                    return (
                    <tr key={r.id}>
                      <td style={{ textAlign: 'center' }}>
                        <span title={S.label} style={{ display: 'inline-grid', placeItems: 'center', width: 22, height: 22, borderRadius: '50%', background: S.bg, color: S.fg }}>
                          <Icon name={S.icon} size={13} />
                        </span>
                      </td>
                      <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span className="strong" title={r.rawClient}>{r.rawClient}</span>
                        {st === 'confirm' && <div style={{ fontSize: 11, color: '#9A5B00', marginTop: 2 }}>did you mean this client?</div>}
                        {st === 'skip' && <div style={{ fontSize: 11, color: '#C5391F', marginTop: 2 }}>no match - will be skipped</div>}
                      </td>
                      <td className="mono" style={{ textAlign: 'right', color: r.revenue < 0 ? '#C5391F' : 'var(--ink)' }}>{fmtAmt(r.revenue)}</td>
                      <td className="mono" style={{ textAlign: 'right', color: r.finance < 0 ? '#C5391F' : 'var(--ink)' }}>{fmtAmt(r.finance)}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <select className="select" value={r.matchId} onChange={e => setImportMatch(r.id, e.target.value === '' ? '' : Number(e.target.value))} style={{ flex: 1, minWidth: 0, borderColor: st === 'confirm' ? '#E0A423' : st === 'skip' ? '#E7A79A' : undefined }}>
                            <option value="">Skip this row</option>
                            {r.suggestions.length > 0 && (
                              <optgroup label="Suggested">
                                {r.suggestions.map(s => (
                                  <option key={s.clientId} value={s.clientId}>{s.name}{s.score < 1 ? ` (${Math.round(s.score * 100)}% match)` : ''}</option>
                                ))}
                              </optgroup>
                            )}
                            <optgroup label="All clients">
                              {rosterSorted.map(c => <option key={c.clientId} value={c.clientId}>{c.name}</option>)}
                            </optgroup>
                          </select>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 22px', borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                {matched === 0 ? 'Match at least one row to import.' : <>Ready to import <b style={{ color: '#15814B' }}>{matched}</b> client{matched === 1 ? '' : 's'}{skipCount > 0 ? ` · ${skipCount} skipped` : ''}.</>}
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => setCrImport(null)} disabled={crImporting}>Cancel</button>
                <button className="btn btn-primary" onClick={applyImport} disabled={crImporting || matched === 0}>
                  {crImporting ? 'Importing…' : `Import ${matched} row${matched === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

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
                      <label key={role} className={'role-opt' + (userForm.role === role ? ' sel' : '')} onClick={() => setUserForm(p => ({ ...p, role }))}>
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
                        {userForm.agencyIds.includes(a.id) ? <Icon name="check" size={12} /> : <Icon name="plus" size={12} />}
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
                            {userForm.clientIds.includes(c.id) ? <Icon name="check" size={12} /> : <Icon name="plus" size={12} />}
                          </button>
                        ));
                      })()}
                    </div>
                  </div>
                )}

                {/* Permissions (not for Control Room - they always have full access) */}
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
                            {pg.label}{on ? <Icon name="check" size={12} /> : <Icon name="plus" size={12} />}
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
                  <MoneyInput className="input" value={targetForm.totalTargetMillions} onValueChange={v => setTargetForm(p => ({ ...p, totalTargetMillions: v }))} placeholder="4,200" />
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
                    <MoneyInput
                      className="input"
                      disabled={!clientForm.commissionType}
                      value={clientForm.commissionValue}
                      onValueChange={v => setClientForm(p => ({ ...p, commissionValue: v }))}
                      placeholder={clientForm.commissionType === 'AOR' ? 'e.g. 50,000' : clientForm.commissionType === 'COMMISSION' ? 'e.g. 4' : '-'}
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
                        {teamForm.memberIds.includes(u.id) ? <Icon name="check" size={12} /> : <Icon name="plus" size={12} />}
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
                            {teamForm.clientIds.includes(c.id) ? <Icon name="check" size={12} /> : <Icon name="plus" size={12} />}
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
                  <input className="input" type="text" value={moveClient ? `${moveClient.name}${moveClient.agencyName ? ` · ${moveClient.agencyName}` : ''}` : ''} disabled />
                </div>
                <div className="field">
                  <label className="field-label">Move to agency <span className="req">*</span></label>
                  <select className="select" value={moveAgencyId} onChange={e => setMoveAgencyId(e.target.value)}>
                    <option value="">Select agency…</option>
                    {agencies
                      .slice().sort((a, b) => a.name.localeCompare(b.name))
                      .map(a => <option key={a.id} value={a.id}>{a.name}{a.id === moveClient?.agencyId ? ' (current)' : ''}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Effective from (schedule month)</label>
                  <input className="input" type="month" value={moveMonth} onChange={e => setMoveMonth(e.target.value)} />
                  <span style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                    Schedules in this month and after go to the new agency. Leave blank to move the client’s <strong>entire</strong> history.
                  </span>
                </div>
                {moveMonth && (
                  <div className="field">
                    <label className="field-label">Before {moveMonth}, agency was <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
                    <select className="select" value={moveBeforeAgencyId} onChange={e => setMoveBeforeAgencyId(e.target.value)}>
                      <option value="">Leave the earlier months as they are</option>
                      {agencies.slice().sort((a, b) => a.name.localeCompare(b.name)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <span style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                      Set this to <strong>correct past months</strong> that were mis-attributed (e.g. put everything before {moveMonth} back under its old agency).
                    </span>
                  </div>
                )}
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
                {deleteType === 'channels'
                  ? ' It will move to “Recently deleted” at the bottom of the Channels tab, where you can restore it anytime.'
                  : ' This action cannot be undone.'}
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
