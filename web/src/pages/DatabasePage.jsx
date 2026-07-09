import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';
import RecentUploads from '../components/RecentUploads';
import api from '../lib/api';
import * as XLSX from 'xlsx';
import OrbitLoader from '../components/OrbitLoader';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';

const fmtShort = (v) => {
  const n = Number(v) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(Math.round(n));
};
const MEDIUM_COLORS = { TV: '#1F5BB5', RADIO: '#E85D24', PRINT: '#15814B', DIGITAL: '#6B3FB5', CINEMA: '#C2185B', OOH: '#0E7490' };

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function computeInvoiceMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `${MONTHS[parseInt(m) - 1]} ${y}`;
}

function fmtLKR(v) {
  if (v == null || v === '') return '';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normalizeMonth(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  // Already YYYY-MM
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  // Try "Jan 2025", "January 2025", "2025-01-15", etc.
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  // Try "MM/YYYY" or "M/YYYY"
  const slashMatch = s.match(/^(\d{1,2})[/\-](\d{4})$/);
  if (slashMatch) return `${slashMatch[2]}-${slashMatch[1].padStart(2, '0')}`;
  return s;
}

const EDITABLE_FIELDS = ['roNumber', 'scheduleMonth', 'brandName', 'channelMasterId', 'scheduleValue'];

// trim+lower — the same normalization the importer uses to key names.
const nrm = (s) => String(s ?? '').trim().toLowerCase();

// Normalized headers the bulk import maps to system fields (or derives) — every
// OTHER column in the sheet is retained verbatim in the row's `extra` JSON.
const CORE_IMPORT_HEADERS = new Set([
  'year', 'agency', 'client', 'advertiser', 'channel',
  'sch month', 'schedule month', 'month',
  'ro', 'ro number', 'channel estimate', 'estimate', 'channel estimate ro number', 'channel estimate/ ro number',
  'brand', 'schedule value', 'value', 'amount', 'medium', 'media group',
]);

const COLUMNS = [
  { key: 'groupHead', label: 'Group', width: 120, readOnly: true },
  { key: 'year', label: 'Year', width: 60, readOnly: true },
  { key: 'roNumber', label: 'Channel Estimate / RO Number', width: 200 },
  { key: 'scheduleMonth', label: 'Sch: Month', width: 120, type: 'month' },
  { key: 'invoiceMonth', label: 'Invoice Month', width: 120, readOnly: true },
  { key: 'clientName', label: 'Client', width: 130, readOnly: true },
  { key: 'brandName', label: 'Brand', width: 140, type: 'brand' },
  { key: 'medium', label: 'Medium', width: 80, readOnly: true },
  { key: 'mediaGroup', label: 'Media Group', width: 140, readOnly: true },
  { key: 'channelMasterId', label: 'Channel', width: 160, type: 'channel' },
  { key: 'scheduleValue', label: 'Schedule Value', width: 130, type: 'number', align: 'right' },
];

export default function DatabasePage() {
  const { user } = useAuth();
  const role = user?.role;
  const canWrite = ['SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'].includes(role);

  const [agencies, setAgencies] = useState([]);
  const [clients, setClients] = useState([]);
  const [selectedAgencyId, setSelectedAgencyId] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [channelMasters, setChannelMasters] = useState([]);
  const [metadata, setMetadata] = useState({ groupHeadName: '', brandSuggestions: [], client: null });

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('scheduleMonth');
  const [sortOrder, setSortOrder] = useState('desc');

  const [newRows, setNewRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);

  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Upload modal
  const [showUpload, setShowUpload] = useState(false);
  const [uploadPreview, setUploadPreview] = useState([]);
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadScheduleMonth, setUploadScheduleMonth] = useState('');
  const fileInputRef = useRef(null);
  // Per-client upload channel reconciliation (fuzzy-match unmatched channels)
  const [uploadRecon, setUploadRecon] = useState(null);        // { channelClusters, matchedChannels }
  const [uploadReconChoice, setUploadReconChoice] = useState({}); // clusterIdx -> { action, channelId, name, medium, notes }
  const [uploadReconBusy, setUploadReconBusy] = useState(false);
  const [uploadHeld, setUploadHeld] = useState(0);

  // Bulk import (all clients) modal
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const [showImport, setShowImport] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const [importFileName, setImportFileName] = useState('');
  const [importCreateClients, setImportCreateClients] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importCheck, setImportCheck] = useState(null); // dry-run result (new vs duplicate)
  const importInputRef = useRef(null);
  // Reconciliation (name matching) before commit
  const [recon, setRecon] = useState(null);            // { clients, channelClusters, matchedChannels }
  const [reconClient, setReconClient] = useState({});  // raw -> { action:'map'|'new', clientId, name, agencyId, notes }
  const [reconChannel, setReconChannel] = useState({}); // clusterIdx -> { action:'map'|'new', channelId, name, medium, notes }
  const [reconciling, setReconciling] = useState(false);
  const [importAllClients, setImportAllClients] = useState([]); // full client list for the reconcile map dropdown

  // Upload batches
  const [uploadBatches, setUploadBatches] = useState([]);
  const [showBatches, setShowBatches] = useState(false);
  const [deletingBatch, setDeletingBatch] = useState(null);

  // Focus tracking for column paste
  const [focusedCol, setFocusedCol] = useState(null);
  const [focusedRowIdx, setFocusedRowIdx] = useState(null);

  // Client analytics summary (overview cards + mini chart)
  const [clientStats, setClientStats] = useState(null);

  useEffect(() => {
    if (!selectedClientId || !selectedAgencyId) { setClientStats(null); return; }
    api.get('/database/analytics', { params: { agencyId: selectedAgencyId, clientId: selectedClientId } })
      .then(r => setClientStats(r.data))
      .catch(() => setClientStats(null));
  }, [selectedAgencyId, selectedClientId, saveResult]);

  useEffect(() => {
    api.get('/agencies').then(r => {
      const list = r.data.agencies || r.data || [];
      setAgencies(Array.isArray(list) ? list : []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedAgencyId) { setClients([]); setSelectedClientId(''); return; }
    api.get(`/agencies/${selectedAgencyId}/clients`).then(r => {
      const list = r.data.clients || r.data || [];
      setClients(Array.isArray(list) ? list : []);
      setSelectedClientId('');
    }).catch(() => setClients([]));
  }, [selectedAgencyId]);

  useEffect(() => {
    api.get('/masterdata/channel-masters').then(r => {
      const list = r.data.channelMasters || r.data || [];
      setChannelMasters(Array.isArray(list) ? list : []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedClientId) { setMetadata({ groupHeadName: '', brandSuggestions: [], client: null }); return; }
    api.get('/database/metadata', { params: { clientId: selectedClientId } }).then(r => {
      setMetadata(r.data);
    }).catch(() => {});
  }, [selectedClientId]);

  const fetchLogs = useCallback(async () => {
    if (!selectedClientId) return;
    setLoading(true);
    try {
      const params = { clientId: selectedClientId, page, limit: 100, sort: sortField, order: sortOrder };
      if (search) params.search = search;
      const { data } = await api.get('/database', { params });
      setRows(data.items || []);
      setTotal(data.total || 0);
    } catch { setRows([]); setTotal(0); }
    setLoading(false);
  }, [selectedClientId, page, sortField, sortOrder, search]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const fetchBatches = useCallback(async () => {
    if (!selectedClientId) { setUploadBatches([]); return; }
    try {
      const { data } = await api.get('/database/batches', { params: { clientId: selectedClientId } });
      setUploadBatches(data.batches || []);
    } catch { setUploadBatches([]); }
  }, [selectedClientId]);

  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  const totalPages = Math.ceil(total / 100);

  const getChannelMedium = (id) => channelMasters.find(c => c.id === parseInt(id))?.medium || '';
  const getChannelMediaGroup = (id) => channelMasters.find(c => c.id === parseInt(id))?.mediaGroup?.name || '';

  const matchChannelByName = (name) => {
    if (!name) return '';
    const lower = name.trim().toLowerCase();
    const match = channelMasters.find(cm =>
      cm.name.toLowerCase() === lower || (cm.aliases || []).some(a => String(a).toLowerCase() === lower));
    return match ? String(match.id) : '';
  };

  const currentMonth = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const currentYear = new Date().getFullYear();
  const clientName = metadata.client?.name || clients.find(c => String(c.id) === selectedClientId)?.name || '';

  // ── New row management ──

  const createEmptyRow = () => ({
    _id: Date.now() + Math.random(),
    roNumber: '',
    scheduleMonth: currentMonth,
    brandName: '',
    channelMasterId: '',
    scheduleValue: '',
  });

  const addNewRow = () => {
    setNewRows(prev => [...prev, createEmptyRow()]);
  };

  const updateNewRow = (idx, field, value) => {
    setNewRows(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  };

  const removeNewRow = (idx) => {
    setNewRows(prev => prev.filter((_, i) => i !== idx));
  };

  const saveNewRows = async () => {
    const validRows = newRows.filter(r => r.roNumber && r.scheduleMonth && r.channelMasterId && r.scheduleValue);
    if (validRows.length === 0) return;

    setSaving(true);
    setSaveResult(null);
    try {
      const payload = validRows.map(r => ({
        clientId: parseInt(selectedClientId),
        channelMasterId: parseInt(r.channelMasterId),
        roNumber: r.roNumber,
        scheduleMonth: r.scheduleMonth,
        scheduleValue: parseFloat(r.scheduleValue),
        brandName: r.brandName || null,
        extra: r._extra || undefined,
      }));

      const { data } = await api.post('/database/bulk', { rows: payload, fileName: uploadFileName || null });
      const createdCount = data.createdCount ?? (Array.isArray(data.created) ? data.created.length : (data.created || 0));
      const errorCount = data.errors?.length || 0;
      setSaveResult({ created: createdCount, errors: errorCount, duplicates: data.duplicates || 0 });

      if (createdCount > 0) {
        if (errorCount > 0) {
          const errorIndices = new Set(data.errors.map(e => e.row));
          setNewRows(prev => prev.filter((_, i) => errorIndices.has(i)));
        } else {
          setNewRows([]);
          setUploadFileName('');
        }
        fetchLogs();
        fetchBatches();
        api.get('/database/metadata', { params: { clientId: selectedClientId } }).then(r => setMetadata(r.data)).catch(() => {});
      }
    } catch (err) {
      setSaveResult({ created: 0, errors: -1, message: err.response?.data?.error || 'Failed to save' });
    }
    setSaving(false);
  };

  // ── Inline edit existing rows ──

  const startEdit = (rowId, colKey, currentValue) => {
    if (!canWrite) return;
    setEditingCell({ rowId, colKey });
    setEditValue(currentValue ?? '');
  };

  const cancelEdit = () => { setEditingCell(null); setEditValue(''); };

  const commitEdit = async () => {
    if (!editingCell) return;
    const { rowId, colKey } = editingCell;
    const row = rows.find(r => r.id === rowId);
    if (!row) { cancelEdit(); return; }

    const oldValue = colKey === 'channelMasterId' ? String(row.channelMasterId) : (row[colKey] ?? '');
    if (String(editValue) === String(oldValue)) { cancelEdit(); return; }

    setEditSaving(true);
    try {
      const payload = { editNote: `Inline edit: ${colKey}` };
      if (colKey === 'scheduleValue') payload.scheduleValue = parseFloat(editValue);
      else if (colKey === 'channelMasterId') payload.channelMasterId = parseInt(editValue);
      else payload[colKey] = editValue;
      await api.put(`/database/${rowId}`, payload);
      fetchLogs();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update');
    }
    setEditSaving(false);
    cancelEdit();
  };

  const handleEditKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') cancelEdit();
    if (e.key === 'Tab') { e.preventDefault(); commitEdit(); }
  };

  // ── Paste handler ──
  // Supports: multi-row paste (creates new rows) OR column paste (fills down a column)

  const handlePaste = (e) => {
    const clipboardData = e.clipboardData?.getData('text');
    if (!clipboardData || !selectedClientId || !canWrite) return;

    const lines = clipboardData.split('\n').filter(l => l.trim());
    if (lines.length === 0) return;

    // Check if the paste target is inside a cell input (let it handle normally for single values)
    const activeEl = document.activeElement;
    const isInCellInput = activeEl?.classList?.contains('cell-input');

    // Single column paste: if focused on an editable new-row cell and data is single-column
    const isSingleColumn = lines.every(l => !l.includes('\t'));

    if (isSingleColumn && isInCellInput && focusedCol && focusedRowIdx != null) {
      e.preventDefault();
      const values = lines.map(l => l.trim());
      setNewRows(prev => {
        const updated = [...prev];
        // Ensure enough rows exist
        while (updated.length < focusedRowIdx + values.length) {
          updated.push({
            _id: Date.now() + Math.random(),
            roNumber: '', scheduleMonth: currentMonth, brandName: '', channelMasterId: '', scheduleValue: '',
          });
        }
        // Fill column values starting from focused row
        for (let i = 0; i < values.length; i++) {
          const targetIdx = focusedRowIdx + i;
          let val = values[i];
          if (focusedCol === 'channelMasterId') {
            val = matchChannelByName(val) || val;
          } else if (focusedCol === 'scheduleMonth') {
            val = normalizeMonth(val) || val;
          } else if (focusedCol === 'scheduleValue') {
            val = val.replace(/[^0-9.]/g, '');
          }
          updated[targetIdx] = { ...updated[targetIdx], [focusedCol]: val };
        }
        return updated;
      });
      return;
    }

    // Multi-column paste: treat as full rows
    if (!isSingleColumn || !isInCellInput) {
      // Only intercept if lines > 1 OR it's a multi-column line
      if (lines.length <= 1 && isSingleColumn && isInCellInput) return; // let default handle single cell

      e.preventDefault();
      const pastedRows = lines.map(line => {
        const cols = line.split('\t');
        const row = createEmptyRow();
        // Expected: RO Number | Sch Month | Brand | Channel | Schedule Value
        if (cols[0]) row.roNumber = cols[0].trim();
        if (cols[1]) row.scheduleMonth = normalizeMonth(cols[1]);
        if (cols[2]) row.brandName = cols[2].trim();
        if (cols[3]) row.channelMasterId = matchChannelByName(cols[3]) || '';
        if (cols[4]) row.scheduleValue = cols[4].trim().replace(/[^0-9.]/g, '');
        return row;
      });
      setNewRows(prev => [...prev, ...pastedRows]);
    }
  };

  // ── Excel Upload ──

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(ws, { defval: '' });

        // Map columns - try to match by header name. Every column that isn't one
        // of the core/derived fields is kept verbatim in `_extra` (keyed by its
        // original header) so nothing in the sheet — CAG, AOR, invoice numbers,
        // dates, etc. — is lost; it rides through to ScheduleLog.importExtra and
        // the schedule-logs export.
        const mapped = jsonData.map(row => {
          const r = createEmptyRow();
          const extra = {};
          for (const [key, val] of Object.entries(row)) {
            const k = key.toLowerCase().trim();
            if (k.includes('estimate') || k.includes('channel est') || (k.includes('ro') && !k.includes('group') && !k.includes('media'))) {
              r.roNumber = String(val).trim();
            } else if ((k.includes('sch') && k.includes('month')) || k === 'month' || k.includes('schedule month')) {
              r.scheduleMonth = normalizeMonth(String(val));
            } else if (k.includes('brand')) {
              r.brandName = String(val).trim();
            } else if (k.includes('channel') && !k.includes('est') && !k.includes('value')) {
              r.channelMasterId = matchChannelByName(String(val)) || '';
              r._channelRaw = String(val).trim();
            } else if (k.includes('value') || k.includes('schedule val') || k.includes('amount')) {
              r.scheduleValue = String(val).replace(/[^0-9.]/g, '');
            }
            const nk = String(key).toLowerCase().replace(/:/g, '').replace(/\s+/g, ' ').trim();
            if (!CORE_IMPORT_HEADERS.has(nk) && val !== '' && val != null) extra[String(key).trim()] = typeof val === 'string' ? val.trim() : val;
          }
          if (Object.keys(extra).length) r._extra = extra;
          return r;
        }).filter(r => r.roNumber || r.scheduleValue || r.channelMasterId);

        // Pick a default schedule month for the whole sheet: the first month
        // parsed from the file, otherwise the current month. Fill any rows that
        // didn't carry a month so the Sch:Month column is never blank.
        const defaultMonth = mapped.find(r => r.scheduleMonth)?.scheduleMonth || currentMonth;
        setUploadScheduleMonth(defaultMonth);
        setUploadPreview(mapped.map(r => ({ ...r, scheduleMonth: r.scheduleMonth || defaultMonth })));
        setShowUpload(true);
      } catch {
        alert('Failed to read Excel file. Please check the format.');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const confirmUpload = () => {
    setNewRows(prev => [...prev, ...uploadPreview]);
    closeUpload();
  };

  const closeUpload = () => {
    setShowUpload(false);
    setUploadPreview([]);
    setUploadRecon(null);
    setUploadReconChoice({});
    setUploadHeld(0);
  };

  // ── Per-client upload: channel reconciliation ──
  // Distinct channel names in the preview that didn't resolve to a channel id.
  const uploadUnmatchedChannels = () => {
    const m = new Map();
    for (const r of uploadPreview) {
      if (!r.channelMasterId && r._channelRaw) m.set(r._channelRaw, (m.get(r._channelRaw) || 0) + 1);
    }
    return [...m.entries()].map(([raw, count]) => ({ raw, count }));
  };

  // Fuzzy-match the unmatched channels against the master list. Exact/alias hits
  // are auto-applied to the preview; the rest are clustered for the user to map
  // or request as new (backed by the same reconcile endpoint as the bulk import).
  const runUploadRecon = async () => {
    const names = uploadUnmatchedChannels();
    if (!names.length || uploadReconBusy) return;
    setUploadReconBusy(true);
    try {
      const { data } = await api.post('/database/import-reconcile', { clientNames: [], channelNames: names });
      // Auto-apply alias/exact hits reconcile found but the grid's exact matcher missed.
      if (data.matchedChannels?.length) {
        const hit = new Map(data.matchedChannels.map(m => [nrm(m.raw), m.match.id]));
        setUploadPreview(prev => prev.map(row => (!row.channelMasterId && row._channelRaw && hit.has(nrm(row._channelRaw)))
          ? { ...row, channelMasterId: String(hit.get(nrm(row._channelRaw))) } : row));
      }
      const choice = {};
      (data.channelClusters || []).forEach((cl, i) => {
        choice[i] = cl.suggestion
          ? { action: 'map', channelId: cl.suggestion.id, name: cl.variants[0].raw, medium: cl.suggestion.medium || 'TV', notes: '' }
          : { action: 'new', channelId: '', name: cl.variants[0].raw, medium: 'TV', notes: '' };
      });
      setUploadReconChoice(choice);
      setUploadRecon((data.channelClusters || []).length ? data : null);
    } catch (err) {
      alert(err.response?.data?.error || 'Auto-match failed');
    }
    setUploadReconBusy(false);
  };

  const uploadChannelResolved = (i) => {
    const r = uploadReconChoice[i]; if (!r) return false;
    return r.action === 'map' ? !!r.channelId : !!(r.name && r.medium);
  };
  const allUploadReconciled = uploadRecon && (uploadRecon.channelClusters || []).every((_, i) => uploadChannelResolved(i));

  // Apply the choices: learn aliases for mapped channels (+ rewrite the preview
  // rows onto them), file requests for new channels and HOLD their rows until an
  // admin approves — dropping those rows from the grid preview.
  const applyUploadRecon = async () => {
    if (!allUploadReconciled || uploadReconBusy) return;
    setUploadReconBusy(true);
    try {
      const channelMappings = [], newChannels = [];
      const pendingRaws = new Set();
      (uploadRecon.channelClusters || []).forEach((cl, i) => {
        const r = uploadReconChoice[i];
        if (r.action === 'new') { newChannels.push({ raw: cl.variants[0].raw, name: r.name, medium: r.medium, notes: r.notes }); cl.variants.forEach(v => pendingRaws.add(nrm(v.raw))); }
        else { cl.variants.forEach(v => channelMappings.push({ raw: v.raw, channelId: r.channelId })); }
      });
      const agencyNm = agencies.find(a => String(a.id) === String(selectedAgencyId))?.name || '';
      const heldRowsData = uploadPreview
        .filter(row => !row.channelMasterId && row._channelRaw && pendingRaws.has(nrm(row._channelRaw)))
        .map(row => ({ client: clientName, agency: agencyNm, channel: row._channelRaw, roNumber: row.roNumber, scheduleMonth: row.scheduleMonth, scheduleValue: row.scheduleValue, brand: row.brandName, extra: row._extra }));

      const { data } = await api.post('/database/import-apply', {
        fileName: uploadFileName, rows: heldRowsData,
        clientMappings: [], channelMappings, newClients: [], newChannels,
      });
      // Refresh masters so newly-learned aliases resolve on subsequent uploads.
      api.get('/masterdata/channel-masters').then(r => setChannelMasters(r.data.channelMasters || r.data || [])).catch(() => {});

      const mapByRaw = new Map(channelMappings.map(m => [nrm(m.raw), String(m.channelId)]));
      const pendingChannels = new Set(data.pendingChannelNames || []);
      setUploadPreview(prev => prev
        .filter(row => !(!row.channelMasterId && row._channelRaw && pendingChannels.has(nrm(row._channelRaw))))
        .map(row => (!row.channelMasterId && row._channelRaw && mapByRaw.has(nrm(row._channelRaw)))
          ? { ...row, channelMasterId: mapByRaw.get(nrm(row._channelRaw)) } : row));
      setUploadHeld(h => h + (data.held || 0));
      setUploadRecon(null);
      setUploadReconChoice({});
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to apply');
    }
    setUploadReconBusy(false);
  };

  // ── Bulk import across all clients ──
  const downloadImportTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Year', 'RO', 'Sch: Month', 'Agency', 'Client', 'Brand', 'Medium', 'Media Group', 'Channel', 'Schedule Value'],
      [2023, 'RO-1001', 'Jan', 'Ogilvy Media', 'Maliban', 'Maliban Milk', 'TV', 'Power House Limited', 'TV Derana', 250000],
      [2024, 'RO-1002', 'Feb', 'RedWorks Media', 'Nestle', '', 'TV', 'MTV Channel (Pvt) LTD', 'Sirasa TV', 480000.5],
    ]);
    ws['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 10 }, { wch: 18 }, { wch: 24 }, { wch: 18 }, { wch: 10 }, { wch: 24 }, { wch: 20 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Schedule Data');
    XLSX.writeFile(wb, 'bulk-import-template.xlsx');
  };

  // Export a subset of the just-uploaded rows (by 1-based row number) back to
  // Excel — the original columns, optionally with a Reason column — so the user
  // can fix the failed/duplicate rows and re-upload just those.
  const downloadImportSubset = (indices, filename, errMap) => {
    if (!indices?.length) return;
    const header = ['Year', 'RO', 'Sch: Month', 'Agency', 'Client', 'Brand', 'Channel', 'Schedule Value'];
    if (errMap) header.push('Reason');
    const aoa = [header];
    for (const idx of indices) {
      const r = importRows[idx - 1];
      if (!r) continue;
      const row = [r.year, r.roNumber, r.scheduleMonth, r.agency, r.client, r.brand, r.channel, r.scheduleValue];
      if (errMap) row.push(errMap[idx] || '');
      aoa.push(row);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Rows');
    XLSX.writeFile(wb, filename);
  };
  const downloadErrorRows = (errs) => {
    const map = {};
    (errs || []).forEach(e => { map[e.row] = e.error; });
    downloadImportSubset((errs || []).map(e => e.row), 'rows-to-fix.xlsx', map);
  };

  // Exact-header lookup (handles "Sch: Month", trailing spaces, case) with fallbacks.
  const buildHeaderMap = (row) => {
    const m = {};
    for (const [k, v] of Object.entries(row)) {
      const nk = String(k).toLowerCase().replace(/:/g, '').replace(/\s+/g, ' ').trim();
      m[nk] = String(v ?? '').trim();
    }
    return m;
  };
  const firstOf = (m, ...keys) => { for (const k of keys) { if (m[k] != null && m[k] !== '') return m[k]; } return ''; };

  const handleImportFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const rows = json.map(row => {
          const m = buildHeaderMap(row);
          // Every remaining column (Invoice Value, CAG/AOR, invoice numbers, dates,
          // Payment Received, etc.) is kept verbatim in `extra`, keyed by its
          // original header, so nothing in the sheet is lost — the system only
          // computes with the core columns below.
          const extra = {};
          for (const [k, v] of Object.entries(row)) {
            const nk = String(k).toLowerCase().replace(/:/g, '').replace(/\s+/g, ' ').trim();
            if (CORE_IMPORT_HEADERS.has(nk)) continue;
            if (v === '' || v == null) continue;
            extra[String(k).trim()] = typeof v === 'string' ? v.trim() : v;
          }
          return {
            year: firstOf(m, 'year'),
            agency: firstOf(m, 'agency'),
            client: firstOf(m, 'client', 'advertiser'),
            channel: firstOf(m, 'channel'),
            scheduleMonth: firstOf(m, 'sch month', 'schedule month', 'month'),
            roNumber: firstOf(m, 'ro', 'ro number', 'channel estimate', 'estimate'),
            brand: firstOf(m, 'brand'),
            scheduleValue: firstOf(m, 'schedule value', 'value', 'amount').replace(/[^0-9.\-]/g, ''),
            extra: Object.keys(extra).length ? extra : undefined,
          };
        }).filter(r => r.client || r.channel || r.scheduleValue);
        setImportRows(rows);
        setImportResult(null);
        setImportCheck(null);
        setRecon(null); setReconClient({}); setReconChannel({});
        setShowImport(true);
      } catch {
        alert('Failed to read the file. Please use the template format.');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  // Step 1: dry-run check — how many rows are new vs already in the database.
  // Nothing is written. If there are no duplicates we import straight away;
  // otherwise we ask the user how to proceed.
  const distinctNames = (rows, key) => {
    const m = new Map();
    for (const r of rows) { const raw = String(r[key] ?? '').trim(); if (!raw) continue; m.set(raw, (m.get(raw) || 0) + 1); }
    return [...m.entries()].map(([raw, count]) => ({ raw, count }));
  };

  // The single agency the file assigns to a raw client name (via its Agency
  // column), or null when the sheet has no/mixed agency for it. Used to scope the
  // reconcile "map to existing" dropdown so an Ogilvy import only offers Ogilvy
  // clients, not Geometry ones.
  const fileAgencyForClient = (raw) => {
    const set = new Set();
    for (const row of importRows) { if (nrm(row.client) === nrm(raw) && row.agency) set.add(nrm(row.agency)); }
    return set.size === 1 ? [...set][0] : null;
  };

  // Full client list (with agency) for the reconciliation "map to existing" picker.
  useEffect(() => {
    if (!showImport || !isSuperAdmin || importAllClients.length) return;
    api.get('/admin/clients').then(r => setImportAllClients(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, [showImport, isSuperAdmin, importAllClients.length]);

  // Step 1: name reconciliation. Flag client/channel names with no exact match so
  // the user maps them (or requests new) before anything is committed.
  const submitImport = async () => {
    if (!importRows.length || importing || reconciling) return;
    setReconciling(true);
    setImportResult(null);
    setImportCheck(null);
    try {
      const { data } = await api.post('/database/import-reconcile', {
        clientNames: distinctNames(importRows, 'client'),
        channelNames: distinctNames(importRows, 'channel'),
      });
      if (data.hasIssues) {
        // Seed default resolutions (pre-select the fuzzy suggestion).
        const rc = {};
        for (const c of data.clients) {
          if (c.status === 'matched') continue;
          if (c.status === 'ambiguous') { rc[c.raw] = { action: 'map', clientId: c.options[0]?.id, name: c.raw, agencyId: '', notes: '' }; continue; }
          // Only pre-select the suggestion if it sits under the agency the file
          // assigns to this client (or the file gives no agency for it).
          const sa = fileAgencyForClient(c.raw);
          const sugOk = c.suggestion && (!sa || nrm(c.suggestion.agencyName) === sa);
          rc[c.raw] = { action: 'map', clientId: sugOk ? c.suggestion.id : '', name: c.raw, agencyId: '', notes: '' };
        }
        const rch = {};
        (data.channelClusters || []).forEach((cl, i) => {
          rch[i] = cl.suggestion ? { action: 'map', channelId: cl.suggestion.id, name: cl.variants[0].raw, medium: 'TV', notes: '' }
            : { action: 'new', channelId: '', name: cl.variants[0].raw, medium: 'TV', notes: '' };
        });
        setReconClient(rc);
        setReconChannel(rch);
        setRecon(data);
        setReconciling(false);
      } else {
        setRecon(null);
        await proceedDryRun(importRows);
      }
    } catch (err) {
      setImportResult({ error: err.response?.data?.error || 'Reconciliation failed' });
      setReconciling(false);
    }
  };

  const clientResolved = (c) => {
    const r = reconClient[c.raw]; if (!r) return false;
    return r.action === 'map' ? !!r.clientId : !!(r.name && r.agencyId);
  };
  const channelResolved = (i) => {
    const r = reconChannel[i]; if (!r) return false;
    return r.action === 'map' ? !!r.channelId : !!(r.name && r.medium);
  };
  const allReconciled = recon
    && recon.clients.filter(c => c.status !== 'matched').every(clientResolved)
    && (recon.channelClusters || []).every((_, i) => channelResolved(i));

  // Step 2: apply mappings (learn aliases) + file new-name requests + hold their
  // rows, then dry-run the remaining rows.
  const confirmReconciliation = async () => {
    if (!allReconciled || reconciling) return;
    setReconciling(true);
    try {
      const clientMappings = [], newClients = [], channelMappings = [], newChannels = [];
      const ambiguousAgency = {}; // raw client -> agency name (to pin the row)
      const agencyName = (id) => agencies.find(a => String(a.id) === String(id))?.name || '';
      for (const c of recon.clients) {
        if (c.status === 'matched') continue;
        const r = reconClient[c.raw];
        if (r.action === 'new') { newClients.push({ raw: c.raw, name: r.name, agencyId: r.agencyId, notes: r.notes }); }
        else {
          clientMappings.push({ raw: c.raw, clientId: r.clientId });
          if (c.status === 'ambiguous') { const opt = c.options.find(o => o.id === r.clientId); if (opt) ambiguousAgency[c.raw] = opt.agencyName; }
        }
      }
      const pendingChannelRaws = new Set();
      (recon.channelClusters || []).forEach((cl, i) => {
        const r = reconChannel[i];
        if (r.action === 'new') { newChannels.push({ raw: cl.variants[0].raw, name: r.name, medium: r.medium, notes: r.notes }); cl.variants.forEach(v => pendingChannelRaws.add(v.raw)); }
        else { cl.variants.forEach(v => channelMappings.push({ raw: v.raw, channelId: r.channelId })); }
      });

      const { data } = await api.post('/database/import-apply', {
        fileName: importFileName, rows: importRows,
        clientMappings, channelMappings, newClients, newChannels,
      });
      const pendingClients = new Set((data.pendingClientNames || []));
      const pendingChannels = new Set((data.pendingChannelNames || []));
      // Rewrite ambiguous clients' agency + drop held rows (tied to a new request).
      const remaining = importRows
        .map(row => (ambiguousAgency[String(row.client ?? '').trim()] ? { ...row, agency: ambiguousAgency[String(row.client).trim()] } : row))
        .filter(row => !pendingClients.has(nrm(row.client)) && !pendingChannels.has(nrm(row.channel)));
      setRecon(null);
      if (!remaining.length) {
        setImportResult({ created: 0, held: data.held || 0, onlyHeld: true });
        setReconciling(false);
        return;
      }
      await proceedDryRun(remaining, data.held || 0);
    } catch (err) {
      setImportResult({ error: err.response?.data?.error || 'Failed to apply reconciliation' });
    } finally {
      setReconciling(false);
    }
  };

  const proceedDryRun = async (rows, heldCount = 0) => {
    setImporting(true);
    try {
      const { data } = await api.post('/database/import-all', {
        rows, fileName: importFileName, createMissingClients: importCreateClients, dryRun: true,
      });
      data.__rows = rows; data.__held = heldCount;
      if (data.duplicates > 0 || data.failed > 0) {
        setImportCheck(data);
        setImporting(false);
      } else {
        await runImport(false, rows, heldCount);
      }
    } catch (err) {
      setImportResult({ error: err.response?.data?.error || 'Import failed' });
      setImporting(false);
    }
  };

  // Step 3: actually import. allowDuplicates=false → only new rows; true → all rows.
  const runImport = async (allowDuplicates, rows = importRows, heldCount = 0) => {
    setImporting(true);
    try {
      const { data } = await api.post('/database/import-all', {
        rows,
        fileName: importFileName,
        createMissingClients: importCreateClients,
        allowDuplicates,
      });
      setImportResult({ ...data, held: heldCount });
      setImportCheck(null);
      if (selectedClientId) { fetchLogs(); fetchBatches(); }
    } catch (err) {
      setImportResult({ error: err.response?.data?.error || 'Import failed' });
    } finally {
      setImporting(false);
    }
  };

  // Set the schedule month for the whole upload at once (auto-fills every row).
  const applyUploadMonth = (month) => {
    setUploadScheduleMonth(month);
    setUploadPreview(prev => prev.map(r => ({ ...r, scheduleMonth: month })));
  };

  const updateUploadRow = (idx, field, value) => {
    setUploadPreview(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  };

  const removeUploadRow = (idx) => {
    setUploadPreview(prev => prev.filter((_, i) => i !== idx));
  };

  // ── Sort ──
  const handleSort = (field) => {
    if (sortField === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortOrder('desc'); }
    setPage(1);
  };

  // ── Delete ──
  const handleDelete = async (id) => {
    if (!confirm('Delete this row?')) return;
    try { await api.delete(`/database/${id}`); fetchLogs(); }
    catch (err) { alert(err.response?.data?.error || 'Failed to delete'); }
  };

  const handleDeleteBatch = async (batchId, fileName) => {
    if (!confirm(`Delete all rows uploaded from "${fileName}"? This will remove all entries from that upload.`)) return;
    setDeletingBatch(batchId);
    try {
      await api.delete(`/database/batches/${batchId}`);
      fetchLogs();
      fetchBatches();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete batch');
    }
    setDeletingBatch(null);
  };

  const brandSuggestions = metadata.brandSuggestions || [];
  const grandTotal = useMemo(() => rows.reduce((s, r) => s + (Number(r.scheduleValue) || 0), 0), [rows]);

  return (
    <div className="fade-in" onPaste={handlePaste}>
      <style>{`
        .db-hero { position:relative; overflow:hidden; border-radius:16px; margin-bottom:16px; background:linear-gradient(135deg,#0A1729 0%,#122842 60%,#0F1F3D 100%); padding:20px 24px; color:#fff; }
        .db-hero::before { content:''; position:absolute; top:-50px; right:-40px; width:190px; height:190px; background:radial-gradient(circle,rgba(232,93,36,.28),transparent 70%); border-radius:50%; }
        .db-hero-in { position:relative; z-index:1; }
        .db-title { font-size:22px; font-weight:750; letter-spacing:-.5px; margin:0; }
        .db-sub { font-size:13px; color:rgba(255,255,255,.55); margin:5px 0 0; }
        .db-stat { position:relative; overflow:hidden; background:#fff; border:1px solid #E5E8ED; border-radius:12px; box-shadow:0 1px 2px rgba(15,31,61,.06); padding:14px 16px; transition:transform .16s ease, box-shadow .16s ease; }
        .db-stat::before { content:''; position:absolute; top:0; left:0; right:0; height:3px; background:linear-gradient(90deg,#E85D24,rgba(232,93,36,.1) 70%,transparent); }
        .db-stat:hover { transform:translateY(-2px); box-shadow:0 8px 20px rgba(15,31,61,.10); }
        .db-stat-label { font-size:11.5px; color:#6B7790; font-weight:600; }
        .db-stat-val { font-size:19px; font-weight:750; letter-spacing:-.4px; font-family:'Spline Sans Mono',monospace; color:#16243C; margin-top:6px; }
        .db-card { background:#fff; border:1px solid #E5E8ED; border-radius:12px; box-shadow:0 1px 2px rgba(15,31,61,.06); }
      `}</style>
      <div className="db-hero">
        <div className="db-hero-in">
          <h1 className="db-title">Schedule Database</h1>
          <p className="db-sub">Enter data like a spreadsheet - paste columns or upload Excel</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="filterbar" style={{ marginBottom: 12 }}>
        <div className="filter-field">
          <label>Agency</label>
          <select className="select" value={selectedAgencyId} onChange={e => { setSelectedAgencyId(e.target.value); setPage(1); }}>
            <option value="">Select Agency</option>
            {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Client</label>
          <select className="select" value={selectedClientId} onChange={e => { setSelectedClientId(e.target.value); setPage(1); setNewRows([]); }} disabled={!selectedAgencyId}>
            <option value="">Select Client</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {selectedClientId && (
          <div className="filter-field">
            <label>Search</label>
            <input className="input" placeholder="RO number, brand..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
        )}
        {isSuperAdmin && (
          <div style={{ marginLeft: 'auto', alignSelf: 'flex-end' }}>
            <button className="btn btn-primary btn-sm" onClick={() => { setImportResult(null); importInputRef.current?.click(); }}>
              <Icon name="upload" size={14} /> Bulk import (all clients)
            </button>
            <input ref={importInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleImportFileSelect} />
          </div>
        )}
      </div>

      {!selectedClientId ? (
        <>
          <div style={{ textAlign: 'center', padding: '48px 0 16px', color: 'var(--muted)' }}>
            <Icon name="database" size={48} style={{ opacity: 0.2, marginBottom: 12, display: 'inline-block' }} />
            <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Select an agency and client to view data</p>
          </div>
          <RecentUploads title="Recent uploaded sheets" />
        </>
      ) : (
        <>
          {/* Toolbar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {!(clientStats && clientStats.totalEntries > 0) && (
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>{total} records</span>
              )}
              {metadata.groupHeadName && (
                <span style={{ fontSize: 12, background: 'var(--blue-50, #eff6ff)', color: 'var(--blue-700, #1d4ed8)', padding: '3px 8px', borderRadius: 4, fontWeight: 600 }}>
                  Group: {metadata.groupHeadName}
                </span>
              )}
            </div>
            {canWrite && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()}>
                  <Icon name="upload" size={14} /> Upload Excel
                </button>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFileSelect} />
                <button className="btn btn-ghost btn-sm" onClick={addNewRow}>
                  <Icon name="plus" size={14} /> Add Row
                </button>
                {newRows.length > 0 && (
                  <button className="btn btn-primary btn-sm" onClick={saveNewRows} disabled={saving}>
                    {saving ? 'Saving...' : `Save ${newRows.filter(r => r.roNumber && r.channelMasterId && r.scheduleValue).length} rows`}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Client overview cards + monthly mini chart */}
          {clientStats && clientStats.totalEntries > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr)) 2fr', gap: 12, marginBottom: 12 }}>
              <div className="db-stat">
                <div className="db-stat-label">Records</div>
                <div className="db-stat-val">{clientStats.totalEntries.toLocaleString()}</div>
              </div>
              <div className="db-stat">
                <div className="db-stat-label">Schedule Value</div>
                <div className="db-stat-val">{fmtShort(clientStats.totalValue)}</div>
              </div>
              <div className="db-stat">
                <div className="db-stat-label">Months · Channels</div>
                <div className="db-stat-val">{(clientStats.byMonth?.length || 0)} · {(clientStats.byChannel?.length || 0)}</div>
              </div>
              <div className="db-card" style={{ padding: '10px 14px 6px' }}>
                <div style={{ fontSize: 11.5, color: '#6B7790', fontWeight: 600, marginBottom: 2 }}>Monthly schedule value</div>
                {clientStats.byMonth?.length > 0 ? (
                  <ResponsiveContainer width="100%" height={70}>
                    <BarChart data={clientStats.byMonth.map(m => ({ ...m, label: fmtMonth(m.month) }))} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <Tooltip formatter={(v) => ['LKR ' + fmtShort(v), 'Value']} labelFormatter={(l, p) => (p && p[0] ? fmtMonth(p[0].payload.month) : l)} contentStyle={{ borderRadius: 8, border: '1px solid #E5E8ED', fontSize: 11 }} />
                      <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                        {clientStats.byMonth.map((m, i) => <Cell key={i} fill={MEDIUM_COLORS[m.medium] || '#1F5BB5'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <div style={{ height: 70 }} />}
              </div>
            </div>
          )}

          {/* Upload Batches */}
          {canWrite && uploadBatches.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowBatches(p => !p)}
                style={{ fontSize: 12, gap: 4 }}
              >
                <Icon name="upload" size={13} />
                Upload History ({uploadBatches.length})
                <Icon name={showBatches ? 'chevD' : 'chevR'} size={12} />
              </button>
              {showBatches && (
                <div style={{ marginTop: 8, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  <table className="tbl" style={{ margin: 0, fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>File Name</th>
                        <th>Uploaded By</th>
                        <th>Date</th>
                        <th style={{ textAlign: 'right' }}>Rows</th>
                        <th style={{ width: 80 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {uploadBatches.map(b => (
                        <tr key={b.id}>
                          <td style={{ fontWeight: 600 }}>{b.fileName}</td>
                          <td style={{ color: 'var(--muted)' }}>{b.uploader?.name || '-'}</td>
                          <td style={{ color: 'var(--muted)' }}>
                            {new Date(b.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td style={{ textAlign: 'right' }}>{b.activeRows}</td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ color: '#dc2626', fontSize: 11, padding: '3px 8px' }}
                              onClick={() => handleDeleteBatch(b.id, b.fileName)}
                              disabled={deletingBatch === b.id}
                            >
                              {deletingBatch === b.id ? 'Deleting...' : 'Delete All'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Save result */}
          {saveResult && (
            <div style={{
              padding: '8px 12px', marginBottom: 10, borderRadius: 6, fontSize: 13,
              background: saveResult.errors > 0 ? '#fffbeb' : '#ecfdf5',
              color: saveResult.errors > 0 ? '#b45309' : '#15803d',
              border: `1px solid ${saveResult.errors > 0 ? '#fcd34d' : '#86efac'}`,
            }}>
              {saveResult.created > 0 && <span>{saveResult.created} rows saved successfully. </span>}
              {saveResult.duplicates > 0 && <span>{saveResult.duplicates} duplicate{saveResult.duplicates === 1 ? '' : 's'} skipped. </span>}
              {saveResult.errors > 0 && <span>{saveResult.errors} rows had errors. </span>}
              {saveResult.message && <span>{saveResult.message}</span>}
              <button onClick={() => setSaveResult(null)} style={{ marginLeft: 8, background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', color: 'inherit' }}>Dismiss</button>
            </div>
          )}

          {/* Paste/Upload hint */}
          {canWrite && newRows.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="file" size={13} />
              <span>Paste from Excel (RO | Month | Brand | Channel | Value) or copy a column and paste into any column. Or use Upload Excel.</span>
            </div>
          )}

          {/* Spreadsheet Table */}
          <div className="tbl-wrap" style={{ overflowX: 'auto' }}>
            <table className="tbl spreadsheet-tbl" style={{ minWidth: 1200, fontSize: 13 }}>
              <thead>
                <tr>
                  {COLUMNS.map(col => (
                    <th
                      key={col.key}
                      style={{ width: col.width, minWidth: col.width, textAlign: col.align || 'left', cursor: col.readOnly ? 'default' : 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}
                      onClick={() => !col.readOnly && handleSort(col.key)}
                    >
                      {col.label}
                      {sortField === col.key && <span style={{ marginLeft: 4 }}>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  ))}
                  {canWrite && <th style={{ width: 40 }}></th>}
                </tr>
              </thead>
              <tbody>
                {/* New entry rows */}
                {newRows.map((nRow, idx) => (
                  <tr key={nRow._id} className="new-row">
                    <td className="cell cell-readonly">{metadata.groupHeadName || '-'}</td>
                    <td className="cell cell-readonly">{currentYear}</td>
                    <td className="cell cell-editable">
                      <input
                        className="cell-input"
                        value={nRow.roNumber}
                        onChange={e => updateNewRow(idx, 'roNumber', e.target.value)}
                        onFocus={() => { setFocusedCol('roNumber'); setFocusedRowIdx(idx); }}
                        placeholder="RO-001"
                      />
                    </td>
                    <td className="cell cell-editable">
                      <input
                        className="cell-input"
                        type="month"
                        value={nRow.scheduleMonth}
                        onChange={e => updateNewRow(idx, 'scheduleMonth', e.target.value)}
                        onFocus={() => { setFocusedCol('scheduleMonth'); setFocusedRowIdx(idx); }}
                      />
                    </td>
                    <td className="cell cell-readonly">{nRow.scheduleMonth ? fmtMonth(computeInvoiceMonth(nRow.scheduleMonth)) : ''}</td>
                    <td className="cell cell-readonly">{clientName}</td>
                    <td className="cell cell-editable">
                      <input
                        className="cell-input"
                        list={`brand-list-${idx}`}
                        value={nRow.brandName}
                        onChange={e => updateNewRow(idx, 'brandName', e.target.value)}
                        onFocus={() => { setFocusedCol('brandName'); setFocusedRowIdx(idx); }}
                        placeholder="Brand"
                      />
                      <datalist id={`brand-list-${idx}`}>
                        {brandSuggestions.map(b => <option key={b} value={b} />)}
                      </datalist>
                    </td>
                    <td className="cell cell-readonly">{nRow.channelMasterId ? getChannelMedium(nRow.channelMasterId) : ''}</td>
                    <td className="cell cell-readonly">{nRow.channelMasterId ? getChannelMediaGroup(nRow.channelMasterId) : ''}</td>
                    <td className="cell cell-editable">
                      <select
                        className="cell-input cell-select"
                        value={nRow.channelMasterId}
                        onChange={e => updateNewRow(idx, 'channelMasterId', e.target.value)}
                        onFocus={() => { setFocusedCol('channelMasterId'); setFocusedRowIdx(idx); }}
                      >
                        <option value="">Select...</option>
                        {channelMasters.filter(c => c.isActive !== false).map(cm => (
                          <option key={cm.id} value={cm.id}>{cm.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="cell cell-editable" style={{ textAlign: 'right' }}>
                      <input
                        className="cell-input"
                        type="number"
                        step="0.01"
                        min="0"
                        value={nRow.scheduleValue}
                        onChange={e => updateNewRow(idx, 'scheduleValue', e.target.value)}
                        onFocus={() => { setFocusedCol('scheduleValue'); setFocusedRowIdx(idx); }}
                        placeholder="0.00"
                        style={{ textAlign: 'right' }}
                      />
                    </td>
                    <td className="cell" style={{ textAlign: 'center' }}>
                      <button className="icon-btn" onClick={() => removeNewRow(idx)} title="Remove">
                        <Icon name="x" size={14} style={{ color: '#ef4444' }} />
                      </button>
                    </td>
                  </tr>
                ))}

                {/* Existing rows */}
                {loading ? (
                  <tr><td colSpan={COLUMNS.length + 1} style={{ padding: 24 }}><OrbitLoader label="Loading rows…" /></td></tr>
                ) : rows.length === 0 && newRows.length === 0 ? (
                  <tr><td colSpan={COLUMNS.length + 1} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>No entries. Click "Add Row", paste from Excel, or use Upload Excel.</td></tr>
                ) : rows.map(row => {
                  const isEditing = (colKey) => editingCell?.rowId === row.id && editingCell?.colKey === colKey;
                  const [yr] = (row.scheduleMonth || '').split('-');

                  return (
                    <tr key={row.id} className={row.isDeleted ? 'deleted-row' : ''}>
                      <td className="cell cell-readonly">{metadata.groupHeadName || '-'}</td>
                      <td className="cell cell-readonly">{yr || '-'}</td>
                      <td className="cell cell-click" onDoubleClick={() => startEdit(row.id, 'roNumber', row.roNumber)}>
                        {isEditing('roNumber') ? (
                          <input className="cell-input" autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={handleEditKeyDown} onBlur={commitEdit} />
                        ) : <span>{row.roNumber || '-'}</span>}
                      </td>
                      <td className="cell cell-click" onDoubleClick={() => startEdit(row.id, 'scheduleMonth', row.scheduleMonth)}>
                        {isEditing('scheduleMonth') ? (
                          <input className="cell-input" type="month" autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={handleEditKeyDown} onBlur={commitEdit} />
                        ) : <span>{fmtMonth(row.scheduleMonth)}</span>}
                      </td>
                      <td className="cell cell-readonly">{fmtMonth(row.invoiceMonth)}</td>
                      <td className="cell cell-readonly">{clientName}</td>
                      <td className="cell cell-click" onDoubleClick={() => startEdit(row.id, 'brandName', row.brandName || '')}>
                        {isEditing('brandName') ? (
                          <>
                            <input className="cell-input" list="brand-edit-list" autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={handleEditKeyDown} onBlur={commitEdit} />
                            <datalist id="brand-edit-list">{brandSuggestions.map(b => <option key={b} value={b} />)}</datalist>
                          </>
                        ) : <span>{row.brandName || '-'}</span>}
                      </td>
                      <td className="cell cell-readonly">
                        <span className="medium-tag" data-medium={row.medium}>{row.medium || '-'}</span>
                      </td>
                      <td className="cell cell-readonly">{row.mediaGroup || '-'}</td>
                      <td className="cell cell-click" onDoubleClick={() => startEdit(row.id, 'channelMasterId', String(row.channelMasterId))}>
                        {isEditing('channelMasterId') ? (
                          <select className="cell-input cell-select" autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={handleEditKeyDown} onBlur={commitEdit}>
                            <option value="">Select...</option>
                            {channelMasters.filter(c => c.isActive !== false).map(cm => <option key={cm.id} value={cm.id}>{cm.name}</option>)}
                          </select>
                        ) : <span>{row.channelMaster?.name || '-'}</span>}
                      </td>
                      <td className="cell cell-click" style={{ textAlign: 'right' }} onDoubleClick={() => startEdit(row.id, 'scheduleValue', row.scheduleValue)}>
                        {isEditing('scheduleValue') ? (
                          <input className="cell-input" type="number" step="0.01" autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={handleEditKeyDown} onBlur={commitEdit} style={{ textAlign: 'right' }} />
                        ) : <span className="mono">{fmtLKR(row.scheduleValue)}</span>}
                      </td>
                      {canWrite && (
                        <td className="cell" style={{ textAlign: 'center' }}>
                          {!row.isDeleted && (
                            <button className="icon-btn" onClick={() => handleDelete(row.id)} title="Delete">
                              <Icon name="trash" size={13} style={{ color: '#ef4444' }} />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={10} style={{ fontWeight: 700 }}>Total ({total} entries)</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }} className="mono">{fmtLKR(grandTotal)}</td>
                    {canWrite && <td></td>}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>Page {page} of {totalPages}</span>
              <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </>
      )}

      {/* Upload Preview Modal */}
      {showUpload && (
        <div className="modal-scrim show" onClick={closeUpload}>
          <div className="modal" style={{ maxWidth: 1100, width: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2>Review Upload</h2>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{uploadFileName} - {uploadPreview.length} rows detected</span>
              </div>
              <button className="act-btn" onClick={closeUpload}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body" style={{ overflow: 'auto', flex: 1, padding: 0 }}>
              {/* Auto-fill bar: pick the schedule month once for the whole sheet */}
              <div style={{ padding: '12px 16px', background: 'var(--bg-sunken)', borderBottom: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 18 }}>
                <div className="filter-field" style={{ margin: 0 }}>
                  <label>Schedule month (applies to all rows)</label>
                  <input
                    type="month"
                    className="input"
                    value={uploadScheduleMonth}
                    onChange={e => applyUploadMonth(e.target.value)}
                    style={{ width: 170 }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Invoice month (auto)</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{fmtMonth(computeInvoiceMonth(uploadScheduleMonth)) || '-'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Client (auto)</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{clientName || '-'}</div>
                </div>
              </div>
              <div style={{ padding: '10px 16px', background: '#eff6ff', fontSize: 12, color: '#1d4ed8', borderBottom: '1px solid var(--border)' }}>
                Schedule month, invoice month, client, medium and media group are filled automatically. Unmatched channels appear in red - select the correct channel from the dropdown.
              </div>

              {/* Channel reconciliation: fuzzy-match unmatched channels in one step */}
              {uploadRecon ? (
                <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', background: '#fff' }}>
                  <div style={{ background: '#FCF4E2', border: '1px solid #F0DFAE', borderRadius: 10, padding: '11px 14px', fontSize: 12.5, color: '#9A5B00', marginBottom: 14, lineHeight: 1.5 }}>
                    <Icon name="alert" size={13} style={{ marginRight: 5, verticalAlign: '-2px' }} />
                    Map each channel to an existing one, or request it as new. A mapping is remembered as an alias so it auto-matches next time. Rows for a requested new channel are held until an admin approves it.
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>Channels to resolve ({uploadRecon.channelClusters.length} group{uploadRecon.channelClusters.length === 1 ? '' : 's'})</div>
                  {uploadRecon.channelClusters.map((cl, i) => {
                    const r = uploadReconChoice[i] || {};
                    const set = (patch) => setUploadReconChoice(p => ({ ...p, [i]: { ...p[i], ...patch } }));
                    const chList = [...(cl.suggestion ? [cl.suggestion] : []), ...channelMasters.filter(x => x.isActive !== false && x.id !== cl.suggestion?.id).map(x => ({ id: x.id, name: x.name, medium: x.medium })).sort((a, b) => a.name.localeCompare(b.name))];
                    return (
                      <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px', marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                          <div style={{ fontSize: 12.5, flex: 1, minWidth: 200 }}>
                            <span style={{ color: 'var(--muted)' }}>Variants: </span>
                            {cl.variants.map(v => <span key={v.raw} style={{ display: 'inline-block', background: '#EEF0F3', borderRadius: 5, padding: '1px 7px', margin: '0 4px 4px 0', fontSize: 11.5 }}>{v.raw} ×{v.count}</span>)}
                            {cl.suggestion && <div style={{ color: '#15814B', fontSize: 11.5, marginTop: 2 }}>Did you mean <b>{cl.suggestion.name}</b>? ({Math.round(cl.suggestion.score * 100)}% match)</div>}
                          </div>
                          <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
                            {['map', 'new'].map(a => (
                              <button key={a} type="button" onClick={() => set({ action: a })}
                                style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', border: 'none', cursor: 'pointer', background: (r.action || 'map') === a ? '#1F5BB5' : 'transparent', color: (r.action || 'map') === a ? '#fff' : 'var(--muted)' }}>
                                {a === 'map' ? 'Map to existing' : 'Request new'}</button>
                            ))}
                          </div>
                        </div>
                        {(r.action || 'map') === 'map' ? (
                          <select className="select" value={r.channelId || ''} onChange={e => set({ channelId: parseInt(e.target.value) || '' })} style={{ width: '100%' }}>
                            <option value="">Select channel…</option>
                            {chList.map(o => <option key={o.id} value={o.id}>{o.name} ({o.medium}){o.id === cl.suggestion?.id ? '  (suggested)' : ''}</option>)}
                          </select>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <input className="input" placeholder="New channel name" value={r.name ?? cl.variants[0].raw} onChange={e => set({ name: e.target.value })} />
                            <select className="select" value={r.medium || 'TV'} onChange={e => set({ medium: e.target.value })}>
                              {['TV', 'RADIO', 'PRINT', 'CINEMA', 'OOH', 'DIGITAL'].map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                            <input className="input" placeholder="Notes (optional)" value={r.notes || ''} onChange={e => set({ notes: e.target.value })} style={{ gridColumn: '1 / -1' }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setUploadRecon(null); setUploadReconChoice({}); }} disabled={uploadReconBusy}>Cancel</button>
                    <button className="btn btn-primary btn-sm" onClick={applyUploadRecon} disabled={!allUploadReconciled || uploadReconBusy} title={allUploadReconciled ? '' : 'Resolve every channel first'}>
                      {uploadReconBusy ? 'Working…' : 'Apply matches'}
                    </button>
                  </div>
                </div>
              ) : uploadUnmatchedChannels().length > 0 && (
                <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: '#FCF4E2', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 12.5, color: '#9A5B00', flex: 1, minWidth: 200 }}>
                    <Icon name="alert" size={13} style={{ marginRight: 5, verticalAlign: '-2px' }} />
                    {uploadUnmatchedChannels().length} unmatched channel name{uploadUnmatchedChannels().length === 1 ? '' : 's'}. Auto-match suggests the closest channel and lets you request new ones.
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={runUploadRecon} disabled={uploadReconBusy}>
                    {uploadReconBusy ? 'Matching…' : 'Auto-match channels'}
                  </button>
                </div>
              )}
              {uploadHeld > 0 && (
                <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: '#EDF3FD', fontSize: 12.5, color: '#1F5BB5' }}>
                  <Icon name="clock" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                  {uploadHeld} row{uploadHeld === 1 ? '' : 's'} held pending approval of the new channel request(s). They'll import automatically once an admin approves (Admin → Channel Requests).
                </div>
              )}

              <table className="tbl spreadsheet-tbl" style={{ margin: 0, fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>#</th>
                    <th>RO Number</th>
                    <th>Sch Month</th>
                    <th>Invoice Month</th>
                    <th>Brand</th>
                    <th>Channel</th>
                    <th style={{ textAlign: 'right' }}>Value</th>
                    <th style={{ width: 36 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {uploadPreview.map((r, idx) => (
                    <tr key={r._id}>
                      <td className="cell cell-readonly" style={{ textAlign: 'center', fontSize: 11 }}>{idx + 1}</td>
                      <td className="cell cell-editable">
                        <input className="cell-input" value={r.roNumber} onChange={e => updateUploadRow(idx, 'roNumber', e.target.value)} />
                      </td>
                      <td className="cell cell-editable">
                        <input className="cell-input" type="month" value={r.scheduleMonth} onChange={e => updateUploadRow(idx, 'scheduleMonth', e.target.value)} />
                      </td>
                      <td className="cell cell-readonly" style={{ color: 'var(--muted)' }}>{fmtMonth(computeInvoiceMonth(r.scheduleMonth))}</td>
                      <td className="cell cell-editable">
                        <input className="cell-input" list="brand-upload-list" value={r.brandName} onChange={e => updateUploadRow(idx, 'brandName', e.target.value)} />
                      </td>
                      <td className="cell cell-editable" style={{ background: r.channelMasterId ? '' : '#fef2f2' }}>
                        <select className="cell-input cell-select" value={r.channelMasterId} onChange={e => updateUploadRow(idx, 'channelMasterId', e.target.value)}>
                          <option value="">{r._channelRaw ? `⚠ "${r._channelRaw}"` : 'Select...'}</option>
                          {channelMasters.filter(c => c.isActive !== false).map(cm => <option key={cm.id} value={cm.id}>{cm.name}</option>)}
                        </select>
                      </td>
                      <td className="cell cell-editable">
                        <input className="cell-input" type="number" step="0.01" value={r.scheduleValue} onChange={e => updateUploadRow(idx, 'scheduleValue', e.target.value)} style={{ textAlign: 'right' }} />
                      </td>
                      <td className="cell" style={{ textAlign: 'center' }}>
                        <button className="icon-btn" onClick={() => removeUploadRow(idx)}><Icon name="x" size={13} style={{ color: '#ef4444' }} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <datalist id="brand-upload-list">{brandSuggestions.map(b => <option key={b} value={b} />)}</datalist>
            </div>
            <div className="modal-foot">
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {uploadPreview.filter(r => !r.channelMasterId).length > 0 && (
                  <span style={{ color: '#dc2626' }}>{uploadPreview.filter(r => !r.channelMasterId).length} rows missing channel</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" onClick={closeUpload}>Cancel</button>
                <button className="btn btn-primary" onClick={confirmUpload} disabled={uploadPreview.length === 0}>
                  {uploadPreview.length === 0 ? 'Nothing to import' : `Import ${uploadPreview.length} rows to grid`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk import (all clients) modal */}
      {showImport && (
        <div className="modal-scrim show" onClick={() => !importing && setShowImport(false)}>
          <div className="modal" style={{ maxWidth: 760 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h3 style={{ margin: 0 }}>Bulk import · all clients</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>{importFileName} · {importRows.length} rows</p>
              </div>
              <button className="act-btn" onClick={() => !importing && setShowImport(false)}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body">
              {recon ? (
                <>
                  <div style={{ background: '#FCF4E2', border: '1px solid #F0DFAE', borderRadius: 10, padding: '11px 14px', fontSize: 12.5, color: '#9A5B00', marginBottom: 16, lineHeight: 1.5 }}>
                    <Icon name="alert" size={13} style={{ marginRight: 5, verticalAlign: '-2px' }} />
                    Some names in this file don't exactly match the system. Map each to an existing record, or request it as new. <b>Import unlocks once every item is resolved.</b> A mapping is remembered as an alias so it auto-matches next time.
                  </div>

                  {recon.clients.filter(c => c.status !== 'matched').length > 0 && (
                    <div style={{ marginBottom: 18 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>Clients to resolve ({recon.clients.filter(c => c.status !== 'matched').length})</div>
                      {recon.clients.filter(c => c.status !== 'matched').map(c => {
                        const r = reconClient[c.raw] || {};
                        const set = (patch) => setReconClient(p => ({ ...p, [c.raw]: { ...p[c.raw], ...patch } }));
                        // Scope the picker to the agency the file assigns this client
                        // (via its Agency column), so an Ogilvy import doesn't list
                        // Geometry clients. No/mixed agency in the file -> show all.
                        const scopeAgency = fileAgencyForClient(c.raw);
                        const suggestionOk = c.suggestion && (!scopeAgency || nrm(c.suggestion.agencyName) === scopeAgency);
                        const list = c.status === 'ambiguous' ? c.options
                          : [...(suggestionOk ? [c.suggestion] : []), ...importAllClients
                              .filter(x => x.id !== c.suggestion?.id)
                              .filter(x => !scopeAgency || nrm(x.agencyName) === scopeAgency)
                              .map(x => ({ id: x.id, name: x.name, agencyName: x.agencyName })).sort((a, b) => a.name.localeCompare(b.name))];
                        return (
                          <div key={c.raw} style={{ border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px', marginBottom: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                              <div style={{ fontSize: 13 }}><b>"{c.raw}"</b> <span style={{ color: 'var(--muted)' }}>· {c.count} row{c.count === 1 ? '' : 's'} · {c.status === 'ambiguous' ? 'exists under multiple agencies' : 'no match'}</span></div>
                              <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
                                {['map', 'new'].map(a => (
                                  <button key={a} type="button" onClick={() => set({ action: a })}
                                    style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', border: 'none', cursor: 'pointer', background: (r.action || 'map') === a ? '#1F5BB5' : 'transparent', color: (r.action || 'map') === a ? '#fff' : 'var(--muted)' }}>
                                    {a === 'map' ? 'Map to existing' : 'Request new'}</button>
                                ))}
                              </div>
                            </div>
                            {(r.action || 'map') === 'map' ? (
                              <select className="select" value={r.clientId || ''} onChange={e => set({ clientId: parseInt(e.target.value) || '' })} style={{ width: '100%' }}>
                                <option value="">Select client…</option>
                                {list.map(o => <option key={o.id} value={o.id}>{o.name}{o.agencyName ? ` (${o.agencyName})` : ''}{o.score != null && o.id === c.suggestion?.id ? '  (suggested)' : ''}</option>)}
                              </select>
                            ) : (
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                <input className="input" placeholder="New client name" value={r.name ?? c.raw} onChange={e => set({ name: e.target.value })} />
                                <select className="select" value={r.agencyId || ''} onChange={e => set({ agencyId: e.target.value })}>
                                  <option value="">Agency…</option>
                                  {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                </select>
                                <input className="input" placeholder="Notes (optional)" value={r.notes || ''} onChange={e => set({ notes: e.target.value })} style={{ gridColumn: '1 / -1' }} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {(recon.channelClusters || []).length > 0 && (
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>Channels to resolve ({recon.channelClusters.length} group{recon.channelClusters.length === 1 ? '' : 's'})</div>
                      {recon.channelClusters.map((cl, i) => {
                        const r = reconChannel[i] || {};
                        const set = (patch) => setReconChannel(p => ({ ...p, [i]: { ...p[i], ...patch } }));
                        const chList = [...(cl.suggestion ? [cl.suggestion] : []), ...channelMasters.filter(x => x.isActive !== false && x.id !== cl.suggestion?.id).map(x => ({ id: x.id, name: x.name, medium: x.medium })).sort((a, b) => a.name.localeCompare(b.name))];
                        return (
                          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px', marginBottom: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                              <div style={{ fontSize: 12.5, flex: 1, minWidth: 200 }}>
                                <span style={{ color: 'var(--muted)' }}>Variants: </span>
                                {cl.variants.map(v => <span key={v.raw} style={{ display: 'inline-block', background: '#EEF0F3', borderRadius: 5, padding: '1px 7px', margin: '0 4px 4px 0', fontSize: 11.5 }}>{v.raw} ×{v.count}</span>)}
                                {cl.suggestion && <div style={{ color: '#15814B', fontSize: 11.5, marginTop: 2 }}>Did you mean <b>{cl.suggestion.name}</b>? ({Math.round(cl.suggestion.score * 100)}% match)</div>}
                              </div>
                              <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
                                {['map', 'new'].map(a => (
                                  <button key={a} type="button" onClick={() => set({ action: a })}
                                    style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', border: 'none', cursor: 'pointer', background: (r.action || 'map') === a ? '#1F5BB5' : 'transparent', color: (r.action || 'map') === a ? '#fff' : 'var(--muted)' }}>
                                    {a === 'map' ? 'Map to existing' : 'Request new'}</button>
                                ))}
                              </div>
                            </div>
                            {(r.action || 'map') === 'map' ? (
                              <select className="select" value={r.channelId || ''} onChange={e => set({ channelId: parseInt(e.target.value) || '' })} style={{ width: '100%' }}>
                                <option value="">Select channel…</option>
                                {chList.map(o => <option key={o.id} value={o.id}>{o.name} ({o.medium}){o.id === cl.suggestion?.id ? '  (suggested)' : ''}</option>)}
                              </select>
                            ) : (
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                <input className="input" placeholder="New channel name" value={r.name ?? cl.variants[0].raw} onChange={e => set({ name: e.target.value })} />
                                <select className="select" value={r.medium || 'TV'} onChange={e => set({ medium: e.target.value })}>
                                  {['TV', 'RADIO', 'PRINT', 'CINEMA', 'OOH', 'DIGITAL'].map(m => <option key={m} value={m}>{m}</option>)}
                                </select>
                                <input className="input" placeholder="Notes (optional)" value={r.notes || ''} onChange={e => set({ notes: e.target.value })} style={{ gridColumn: '1 / -1' }} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (!importResult && !importCheck) ? (
                <>
                  <div style={{ background: '#F5F6F8', border: '1px solid #E5E8ED', borderRadius: 10, padding: '12px 14px', fontSize: 12.5, color: '#3B4A63', marginBottom: 14 }}>
                    Expected columns: <b>Year</b>, <b>RO</b>, <b>Sch: Month</b> (e.g. Jan, Feb…), <b>Agency</b> (optional), <b>Client</b>, <b>Brand</b>, <b>Medium</b>, <b>Media Group</b>, <b>Channel</b>, <b>Schedule Value</b>. Client and channel are matched by name; medium &amp; media group come from the channel; VAT (18%) is computed automatically. Add the <b>Agency</b> column when a client (e.g. Nestle, Godrej) exists under more than one agency, so the right one is used.
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 14, cursor: 'pointer' }}>
                    <input type="checkbox" checked={importCreateClients} onChange={e => setImportCreateClients(e.target.checked)} />
                    Create clients that don't exist yet (needs an Agency column to know where)
                  </label>
                  <div className="tbl-wrap" style={{ maxHeight: 300, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                    <table className="tbl" style={{ margin: 0, fontSize: 12 }}>
                      <thead><tr><th>#</th><th>Year</th><th>Month</th><th>Agency</th><th>Client</th><th>Channel</th><th>RO</th><th>Brand</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
                      <tbody>
                        {importRows.slice(0, 50).map((r, i) => (
                          <tr key={i}>
                            <td style={{ color: 'var(--muted)' }}>{i + 1}</td>
                            <td>{r.year}</td><td>{r.scheduleMonth}</td>
                            <td style={{ color: r.agency ? 'inherit' : 'var(--muted-2)' }}>{r.agency || '-'}</td>
                            <td>{r.client}</td><td>{r.channel}</td>
                            <td>{r.roNumber}</td><td>{r.brand}</td>
                            <td style={{ textAlign: 'right' }} className="mono">{r.scheduleValue}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {importRows.length > 50 && <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0 0' }}>Showing first 50 of {importRows.length} rows.</p>}
                </>
              ) : (importCheck && !importResult) ? (
                <div>
                  <div style={{ background: '#FEF6E7', border: '1px solid #F2E2BD', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#9A5B00', marginBottom: 4 }}>
                      {importCheck.newRows} of {importCheck.total} row{importCheck.total === 1 ? '' : 's'} can be imported
                    </div>
                    <div style={{ fontSize: 13, color: '#6B5A3C' }}>
                      {importCheck.duplicates > 0 && `${importCheck.duplicates} already in the database`}
                      {importCheck.duplicates > 0 && importCheck.failed > 0 && ' · '}
                      {importCheck.failed > 0 && `${importCheck.failed} can't be imported (see below)`}
                      . How do you want to proceed?
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div style={{ flex: 1, background: '#ECF8F1', border: '1px solid #cdebd9', borderRadius: 10, padding: '14px 16px' }}>
                      <div style={{ fontSize: 22, fontWeight: 750, color: '#15814B', fontFamily: 'Spline Sans Mono, monospace' }}>{importCheck.newRows}</div>
                      <div style={{ fontSize: 12, color: '#3B4A63' }}>new rows</div>
                    </div>
                    <div style={{ flex: 1, background: '#FEF6E7', border: '1px solid #F2E2BD', borderRadius: 10, padding: '14px 16px' }}>
                      <div style={{ fontSize: 22, fontWeight: 750, color: '#9A5B00', fontFamily: 'Spline Sans Mono, monospace' }}>{importCheck.duplicates}</div>
                      <div style={{ fontSize: 12, color: '#3B4A63' }}>duplicates</div>
                    </div>
                    {importCheck.failed > 0 && (
                      <div style={{ flex: 1, background: '#FBE0DA', border: '1px solid #f6c9bb', borderRadius: 10, padding: '14px 16px' }}>
                        <div style={{ fontSize: 22, fontWeight: 750, color: '#C5391F', fontFamily: 'Spline Sans Mono, monospace' }}>{importCheck.failed}</div>
                        <div style={{ fontSize: 12, color: '#3B4A63' }}>can't be imported</div>
                      </div>
                    )}
                  </div>
                  {importCheck.newRows > 0 && importCheck.newSample?.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#15814B', marginBottom: 6 }}>
                        Rows it sees as new{importCheck.newRows > importCheck.newSample.length ? ` (showing ${importCheck.newSample.length} of ${importCheck.newRows})` : ''}
                        {importCheck.newClientRows > 0 ? ` · ${importCheck.newClientRows} are for clients not yet created` : ''}
                      </div>
                      <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }}>
                        <table className="tbl" style={{ margin: 0, fontSize: 11.5 }}>
                          <thead><tr><th>Client</th><th>Channel</th><th>Month</th><th>RO</th><th>Brand</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
                          <tbody>
                            {importCheck.newSample.map((r, i) => (
                              <tr key={i}>
                                <td>{r.client}</td><td>{r.channel}</td><td>{r.month}</td>
                                <td>{r.ro}</td><td>{r.brand || '-'}</td>
                                <td style={{ textAlign: 'right' }} className="mono">{r.value}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {(importCheck.errors?.length > 0 || importCheck.duplicates > 0) && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                      {importCheck.errors?.length > 0 && (
                        <button className="btn btn-ghost btn-sm" onClick={() => downloadErrorRows(importCheck.errors)}>
                          <Icon name="download" size={14} /> Download rows to fix ({importCheck.errors.length})
                        </button>
                      )}
                      {importCheck.duplicates > 0 && importCheck.duplicateRows?.length > 0 && (
                        <button className="btn btn-ghost btn-sm" onClick={() => downloadImportSubset(importCheck.duplicateRows, 'duplicate-rows.xlsx')}>
                          <Icon name="download" size={14} /> Download duplicates ({importCheck.duplicateRows.length})
                        </button>
                      )}
                    </div>
                  )}
                  {importCheck.errors?.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#C5391F', marginBottom: 6 }}>Rows that can't be imported</div>
                      <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', background: '#fff' }}>
                        {importCheck.errors.slice(0, 200).map((e, i) => (
                          <div key={i} style={{ fontSize: 12, color: '#6B7790', padding: '2px 0' }}>Row {e.row}: {e.error}</div>
                        ))}
                        {importCheck.errors.length > 200 && <div style={{ fontSize: 12, color: 'var(--muted)', padding: '4px 0 0' }}>…and {importCheck.errors.length - 200} more. Download to see them all.</div>}
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0 0' }}>
                        A duplicate = same <b>Year+Month, Client, Channel and Schedule Value</b> as a row already in the database (brand &amp; RO are ignored; repeats within this file are kept). Tip: clients under more than one agency need an <b>Agency</b> column. Fix the downloaded rows and re-upload, or choose Re-upload everything.
                      </p>
                    </div>
                  )}
                  <p style={{ fontSize: 12, color: 'var(--muted)', margin: '12px 0 0' }}>
                    {importCheck.duplicates > 0
                      ? <><b>Upload only new</b> skips duplicates &amp; error rows. <b>Re-upload everything</b> also re-inserts the {importCheck.duplicates} duplicate{importCheck.duplicates === 1 ? '' : 's'}.</>
                      : <>Proceeding imports the {importCheck.newRows} valid row{importCheck.newRows === 1 ? '' : 's'} and skips the rest. Fix the file first if you'd rather not skip them.</>}
                  </p>
                </div>
              ) : importResult.error ? (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '14px', color: '#b91c1c', fontSize: 13 }}>{importResult.error}</div>
              ) : (
                <div>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                    <div style={{ flex: 1, background: '#ECF8F1', border: '1px solid #cdebd9', borderRadius: 10, padding: '14px 16px' }}>
                      <div style={{ fontSize: 22, fontWeight: 750, color: '#15814B', fontFamily: 'Spline Sans Mono, monospace' }}>{importResult.created}</div>
                      <div style={{ fontSize: 12, color: '#3B4A63' }}>records imported</div>
                    </div>
                    <div style={{ flex: 1, background: importResult.failed ? '#FBE0DA' : '#F5F6F8', border: '1px solid #E5E8ED', borderRadius: 10, padding: '14px 16px' }}>
                      <div style={{ fontSize: 22, fontWeight: 750, color: importResult.failed ? '#C5391F' : '#6B7790', fontFamily: 'Spline Sans Mono, monospace' }}>{importResult.failed}</div>
                      <div style={{ fontSize: 12, color: '#3B4A63' }}>rows skipped</div>
                    </div>
                    <div style={{ flex: 1, background: importResult.duplicates ? '#FEF6E7' : '#F5F6F8', border: '1px solid #F2E2BD', borderRadius: 10, padding: '14px 16px' }}>
                      <div style={{ fontSize: 22, fontWeight: 750, color: importResult.duplicates ? '#9A5B00' : '#6B7790', fontFamily: 'Spline Sans Mono, monospace' }}>{importResult.duplicates || 0}</div>
                      <div style={{ fontSize: 12, color: '#3B4A63' }}>duplicates skipped</div>
                    </div>
                    <div style={{ flex: 1, background: '#EDF3FD', border: '1px solid #d4e2f7', borderRadius: 10, padding: '14px 16px' }}>
                      <div style={{ fontSize: 22, fontWeight: 750, color: '#1F5BB5', fontFamily: 'Spline Sans Mono, monospace' }}>{importResult.createdClients?.length || 0}</div>
                      <div style={{ fontSize: 12, color: '#3B4A63' }}>new clients created</div>
                    </div>
                  </div>
                  {importResult.held > 0 && (
                    <div style={{ fontSize: 12.5, color: '#1F5BB5', background: '#EDF3FD', border: '1px solid #d4e2f7', borderRadius: 8, padding: '9px 12px', marginBottom: 12 }}>
                      <Icon name="clock" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                      {importResult.held} row{importResult.held === 1 ? '' : 's'} are <b>held pending approval</b> of the new client/channel request(s). They'll import automatically once an admin approves (Admin → Client/Channel Requests).
                    </div>
                  )}
                  {importResult.duplicates > 0 && (
                    <div style={{ fontSize: 12, color: '#9A5B00', background: '#FEF6E7', border: '1px solid #F2E2BD', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
                      {importResult.duplicates} row{importResult.duplicates === 1 ? ' was' : 's were'} already in the database and skipped to avoid duplicates.
                    </div>
                  )}
                  {importResult.errors?.length > 0 && (
                    <>
                      <button className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }} onClick={() => downloadErrorRows(importResult.errors)}>
                        <Icon name="download" size={14} /> Download rows to fix ({importResult.errors.length})
                      </button>
                      <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Skipped rows</div>
                        {importResult.errors.slice(0, 200).map((e, i) => (
                          <div key={i} style={{ fontSize: 12, color: '#6B7790', padding: '2px 0' }}>Row {e.row}: {e.error}</div>
                        ))}
                        {importResult.errors.length > 200 && <div style={{ fontSize: 12, color: 'var(--muted)', padding: '4px 0 0' }}>…and {importResult.errors.length - 200} more. Download to see them all.</div>}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost btn-sm" onClick={downloadImportTemplate} style={{ marginRight: 'auto' }}><Icon name="download" size={14} /> Template</button>
              <div style={{ display: 'flex', gap: 8 }}>
                {recon ? (
                  <>
                    <button className="btn btn-ghost" onClick={() => setRecon(null)} disabled={reconciling}>Back</button>
                    <button className="btn btn-primary" onClick={confirmReconciliation} disabled={!allReconciled || reconciling} title={allReconciled ? '' : 'Resolve every flagged name first'}>
                      {reconciling ? 'Working…' : 'Confirm & Import'}
                    </button>
                  </>
                ) : importResult ? (
                  <button className="btn btn-primary" onClick={() => setShowImport(false)}>Done</button>
                ) : importCheck ? (
                  <>
                    <button className="btn btn-ghost" onClick={() => setImportCheck(null)} disabled={importing}>Back</button>
                    {importCheck.duplicates > 0 && (
                      <button className="btn btn-ghost" onClick={() => runImport(true, importCheck.__rows || importRows, importCheck.__held || 0)} disabled={importing} title="Insert every row, including duplicates">
                        {importing ? 'Working…' : 'Re-upload everything'}
                      </button>
                    )}
                    <button className="btn btn-primary" onClick={() => runImport(false, importCheck.__rows || importRows, importCheck.__held || 0)} disabled={importing || importCheck.newRows === 0}>
                      {importing ? 'Working…' : importCheck.duplicates > 0 ? `Upload ${importCheck.newRows} new only` : `Import ${importCheck.newRows} valid row${importCheck.newRows === 1 ? '' : 's'}`}
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-ghost" onClick={() => setShowImport(false)} disabled={importing}>Cancel</button>
                    <button className="btn btn-primary" onClick={submitImport} disabled={importing || !importRows.length}>
                      {importing ? 'Checking…' : `Import ${importRows.length} rows`}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
