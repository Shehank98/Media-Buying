import { useState, useEffect } from 'react';
import { BarChart3, Download, FileText, Search } from 'lucide-react';
import api from '../lib/api';
import LoadingSpinner from '../components/LoadingSpinner';

export default function ReportsPage() {
  const [mode, setMode] = useState('channel');
  const [agencies, setAgencies] = useState([]);
  const [channels, setChannels] = useState([]);
  const [clients, setClients] = useState([]);
  const [results, setResults] = useState([]);

  const [selectedAgency, setSelectedAgency] = useState('');
  const [selectedChannel, setSelectedChannel] = useState('');
  const [selectedClient, setSelectedClient] = useState('');

  const [loading, setLoading] = useState(false);
  const [agenciesLoading, setAgenciesLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortField, setSortField] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  useEffect(() => {
    const fetchAgencies = async () => {
      try {
        const { data } = await api.get('/agencies');
        setAgencies(data.agencies || data || []);
      } catch {
        setError('Failed to load agencies.');
      } finally {
        setAgenciesLoading(false);
      }
    };
    fetchAgencies();
  }, []);

  useEffect(() => {
    if (!selectedAgency) {
      setChannels([]);
      setClients([]);
      setResults([]);
      return;
    }

    const fetchOptions = async () => {
      try {
        if (mode === 'channel') {
          const { data } = await api.get(
            `/agencies/${selectedAgency}/clients`
          );
          const allClients = data.clients || data || [];
          setClients(allClients);
          const channelPromises = allClients.map((c) =>
            api.get(`/clients/${c.id}/channels`).then((r) => {
              const chs = r.data.channels || r.data || [];
              return chs.map((ch) => ({ ...ch, clientName: c.name }));
            }).catch(() => [])
          );
          const channelArrays = await Promise.all(channelPromises);
          setChannels(channelArrays.flat());
        } else {
          const { data } = await api.get(
            `/agencies/${selectedAgency}/clients`
          );
          setClients(data.clients || data || []);
        }
      } catch {
        // Silently handle
      }
    };
    fetchOptions();
  }, [selectedAgency, mode]);

  const fetchReport = async () => {
    setLoading(true);
    setError('');
    try {
      let url = '';
      if (mode === 'channel' && selectedChannel) {
        url = `/reports/channel/${selectedChannel}`;
      } else if (mode === 'client' && selectedClient) {
        url = `/reports/client/${selectedClient}`;
      } else {
        setLoading(false);
        return;
      }
      const { data } = await api.get(url);
      setResults(data.properties || data.results || data || []);
    } catch (err) {
      setError('Failed to load report data.');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (format) => {
    try {
      let url = '';
      if (mode === 'channel' && selectedChannel) {
        url = `/reports/channel/${selectedChannel}?format=${format}`;
      } else if (mode === 'client' && selectedClient) {
        url = `/reports/client/${selectedClient}?format=${format}`;
      } else {
        return;
      }
      const response = await api.get(url, { responseType: 'blob' });
      const blob = new Blob([response.data]);
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `report.${format === 'excel' ? 'xlsx' : 'pdf'}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch {
      setError(`Failed to export ${format}.`);
    }
  };

  const sortedResults = [...results].sort((a, b) => {
    let aVal = a[sortField];
    let bVal = b[sortField];
    if (sortField === 'cost') {
      aVal = Number(aVal) || 0;
      bVal = Number(bVal) || 0;
    } else {
      aVal = String(aVal || '').toLowerCase();
      bVal = String(bVal || '').toLowerCase();
    }
    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortIcon = (field) => {
    if (sortField !== field) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const formatCurrency = (value) => {
    if (value == null) return '-';
    return Number(value).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-gray-500 mt-1">
          Generate and export media buying reports.
        </p>
      </div>

      {/* Mode tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          <button
            onClick={() => {
              setMode('channel');
              setResults([]);
              setSelectedChannel('');
              setSelectedClient('');
            }}
            className={`flex items-center gap-2 pb-3 border-b-2 text-sm font-medium transition-colors ${
              mode === 'channel'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <BarChart3 className="h-4 w-4" />
            By Channel
          </button>
          <button
            onClick={() => {
              setMode('client');
              setResults([]);
              setSelectedChannel('');
              setSelectedClient('');
            }}
            className={`flex items-center gap-2 pb-3 border-b-2 text-sm font-medium transition-colors ${
              mode === 'client'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <FileText className="h-4 w-4" />
            By Client
          </button>
        </nav>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Agency
            </label>
            <select
              value={selectedAgency}
              onChange={(e) => {
                setSelectedAgency(e.target.value);
                setSelectedChannel('');
                setSelectedClient('');
                setResults([]);
              }}
              disabled={agenciesLoading}
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

          {mode === 'channel' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Channel
              </label>
              <select
                value={selectedChannel}
                onChange={(e) => {
                  setSelectedChannel(e.target.value);
                  setResults([]);
                }}
                disabled={!selectedAgency}
                className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-colors disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">Select channel...</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.type})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Client
              </label>
              <select
                value={selectedClient}
                onChange={(e) => {
                  setSelectedClient(e.target.value);
                  setResults([]);
                }}
                disabled={!selectedAgency}
                className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-colors disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">Select client...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-end">
            <button
              onClick={fetchReport}
              disabled={
                loading ||
                !selectedAgency ||
                (mode === 'channel' ? !selectedChannel : !selectedClient)
              }
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors w-full justify-center"
            >
              <Search className="h-4 w-4" />
              Generate Report
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Results */}
      {loading ? (
        <LoadingSpinner size="lg" className="py-12" />
      ) : results.length > 0 ? (
        <div className="space-y-4">
          {/* Export buttons */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              {results.length} propert{results.length !== 1 ? 'ies' : 'y'}{' '}
              found
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => handleExport('excel')}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Download className="h-4 w-4" />
                Export Excel
              </button>
              <button
                onClick={() => handleExport('pdf')}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Download className="h-4 w-4" />
                Export PDF
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th
                      className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                      onClick={() => handleSort('name')}
                    >
                      Name{sortIcon('name')}
                    </th>
                    <th
                      className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                      onClick={() => handleSort('type')}
                    >
                      Type{sortIcon('type')}
                    </th>
                    <th
                      className="text-right px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                      onClick={() => handleSort('cost')}
                    >
                      Cost{sortIcon('cost')}
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">
                      {mode === 'client' ? 'Channel' : 'Client'}
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">
                      Created By
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedResults.map((item) => (
                    <tr
                      key={item.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {item.name}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">
                          {item.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">
                        {formatCurrency(item.cost)}
                      </td>
                      <td className="px-4 py-3 text-gray-600 hidden md:table-cell">
                        {mode === 'client'
                          ? item.channel?.name || item.channelName || '-'
                          : item.client?.name || item.clientName || '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
                        {item.createdBy?.name || item.createdByName || '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">
                        {item.createdAt
                          ? new Date(item.createdAt).toLocaleDateString()
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td
                      colSpan={2}
                      className="px-4 py-3 font-semibold text-gray-900"
                    >
                      Total
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">
                      {formatCurrency(
                        results.reduce(
                          (sum, r) => sum + (Number(r.cost) || 0),
                          0
                        )
                      )}
                    </td>
                    <td
                      colSpan={3}
                      className="hidden md:table-cell"
                    />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
