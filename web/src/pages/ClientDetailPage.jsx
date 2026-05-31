import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Tv, Radio, Newspaper, Plus, ArrowRight } from 'lucide-react';
import api from '../lib/api';
import LoadingSpinner from '../components/LoadingSpinner';
import Modal from '../components/Modal';

const channelTypes = [
  { key: 'TV', label: 'TV Channels', icon: Tv, color: 'bg-blue-50 text-blue-600' },
  { key: 'RADIO', label: 'Radio Channels', icon: Radio, color: 'bg-green-50 text-green-600' },
  { key: 'PRINT', label: 'Print', icon: Newspaper, color: 'bg-orange-50 text-orange-600' },
];

const canAddChannel = (role) =>
  ['PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'].includes(role);

export default function ClientDetailPage() {
  const { clientId } = useParams();
  const { user } = useAuth();
  const [client, setClient] = useState(null);
  const [channels, setChannels] = useState([]);
  const [activeTab, setActiveTab] = useState('TV');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState({ name: '', type: 'TV' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const fetchData = async () => {
    try {
      const [clientRes, channelsRes] = await Promise.all([
        api.get(`/clients/${clientId}`),
        api.get(`/clients/${clientId}/channels`),
      ]);
      setClient(clientRes.data.client || clientRes.data);
      setChannels(channelsRes.data.channels || channelsRes.data || []);
    } catch (err) {
      setError('Failed to load client details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [clientId]);

  const filteredChannels = channels.filter((c) => c.type === activeTab);

  const handleAddChannel = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!formData.name.trim()) {
      setFormError('Channel name is required.');
      return;
    }

    setSubmitting(true);
    try {
      await api.post(`/clients/${clientId}/channels`, formData);
      setShowAddModal(false);
      setFormData({ name: '', type: 'TV' });
      await fetchData();
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to add channel.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <LoadingSpinner size="lg" className="py-20" />;
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{client?.name}</h1>
          <p className="text-gray-500 mt-0.5">
            Agency:{' '}
            <Link
              to={`/agencies/${client?.agencyId}`}
              className="text-indigo-600 hover:text-indigo-500"
            >
              {client?.agency?.name || client?.agencyName || 'Agency'}
            </Link>
          </p>
        </div>
        {canAddChannel(user?.role) && (
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Channel
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {channelTypes.map((type) => (
            <button
              key={type.key}
              onClick={() => setActiveTab(type.key)}
              className={`flex items-center gap-2 pb-3 border-b-2 text-sm font-medium transition-colors ${
                activeTab === type.key
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <type.icon className="h-4 w-4" />
              {type.label}
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  activeTab === type.key
                    ? 'bg-indigo-50 text-indigo-600'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {channels.filter((c) => c.type === type.key).length}
              </span>
            </button>
          ))}
        </nav>
      </div>

      {/* Channel cards */}
      {filteredChannels.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          {(() => {
            const typeInfo = channelTypes.find((t) => t.key === activeTab);
            const Icon = typeInfo?.icon || Tv;
            return <Icon className="h-12 w-12 text-gray-300 mx-auto mb-3" />;
          })()}
          <h3 className="font-medium text-gray-900 mb-1">
            No {activeTab.toLowerCase()} channels
          </h3>
          <p className="text-sm text-gray-500">
            Add a {activeTab.toLowerCase()} channel to get started.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredChannels.map((channel) => {
            const typeInfo = channelTypes.find((t) => t.key === channel.type);
            const Icon = typeInfo?.icon || Tv;
            return (
              <Link
                key={channel.id}
                to={`/channels/${channel.id}`}
                className="group bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md hover:border-indigo-200 transition-all"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`h-10 w-10 rounded-lg ${typeInfo?.color || 'bg-gray-50 text-gray-600'} flex items-center justify-center flex-shrink-0`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-gray-900 truncate group-hover:text-indigo-600 transition-colors">
                      {channel.name}
                    </h3>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {channel.propertyCount || channel._count?.properties || 0}{' '}
                      properties
                    </p>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-end text-sm text-indigo-600 font-medium">
                  View properties <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Add Channel Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setFormError('');
          setFormData({ name: '', type: 'TV' });
        }}
        title="Add Channel"
      >
        {formError && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            {formError}
          </div>
        )}
        <form onSubmit={handleAddChannel} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Channel Name
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
              className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-colors"
              placeholder="Enter channel name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Type
            </label>
            <select
              value={formData.type}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, type: e.target.value }))
              }
              className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-colors"
            >
              <option value="TV">TV</option>
              <option value="RADIO">Radio</option>
              <option value="PRINT">Print</option>
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowAddModal(false);
                setFormError('');
              }}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Adding...' : 'Add Channel'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
