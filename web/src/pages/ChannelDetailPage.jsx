import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  Plus,
  Pencil,
  Trash2,
  History,
  Tv,
  Radio,
  Newspaper,
  Clock,
  User as UserIcon,
} from 'lucide-react';
import api from '../lib/api';
import LoadingSpinner from '../components/LoadingSpinner';
import Modal from '../components/Modal';

const typeColors = {
  TV: 'bg-blue-100 text-blue-700',
  RADIO: 'bg-green-100 text-green-700',
  PRINT: 'bg-orange-100 text-orange-700',
};

const typeIcons = {
  TV: Tv,
  RADIO: Radio,
  PRINT: Newspaper,
};

const propertyTypeBadge = {
  BOUGHT_AIRTIME: 'bg-purple-100 text-purple-700',
  SPONSORSHIP: 'bg-blue-100 text-blue-700',
  BONUS_COMMERCIAL: 'bg-green-100 text-green-700',
  OTHER: 'bg-gray-100 text-gray-700',
};

const propertyTypeLabels = {
  BOUGHT_AIRTIME: 'Bought Airtime',
  SPONSORSHIP: 'Sponsorship',
  BONUS_COMMERCIAL: 'Bonus Commercial',
  OTHER: 'Other',
};

const canModify = (role) =>
  ['PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'].includes(role);

export default function ChannelDetailPage() {
  const { channelId } = useParams();
  const { user } = useAuth();

  const [channel, setChannel] = useState(null);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Add/Edit property modal
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [editingProperty, setEditingProperty] = useState(null);
  const [propertyForm, setPropertyForm] = useState({
    name: '',
    type: 'BOUGHT_AIRTIME',
    cost: '',
    notes: '',
    changeNote: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // History modal
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyData, setHistoryData] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPropertyName, setHistoryPropertyName] = useState('');

  // Delete confirmation
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingProperty, setDeletingProperty] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const fetchData = async () => {
    try {
      const [channelRes, propertiesRes] = await Promise.all([
        api.get(`/channels/${channelId}`),
        api.get(`/channels/${channelId}/properties`),
      ]);
      setChannel(channelRes.data.channel || channelRes.data);
      setProperties(propertiesRes.data.properties || propertiesRes.data || []);
    } catch (err) {
      setError('Failed to load channel details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [channelId]);

  const openAddModal = () => {
    setEditingProperty(null);
    setPropertyForm({
      name: '',
      type: 'BOUGHT_AIRTIME',
      cost: '',
      notes: '',
      changeNote: '',
    });
    setFormError('');
    setShowPropertyModal(true);
  };

  const openEditModal = (property) => {
    setEditingProperty(property);
    setPropertyForm({
      name: property.name,
      type: property.type,
      cost: property.cost?.toString() || '',
      notes: property.notes || '',
      changeNote: '',
    });
    setFormError('');
    setShowPropertyModal(true);
  };

  const handlePropertySubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!propertyForm.name.trim()) {
      setFormError('Property name is required.');
      return;
    }

    if (!propertyForm.cost || isNaN(Number(propertyForm.cost)) || Number(propertyForm.cost) < 0) {
      setFormError('Please enter a valid cost.');
      return;
    }

    if (editingProperty && !propertyForm.changeNote.trim()) {
      setFormError('Change note is required when editing a property.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: propertyForm.name,
        type: propertyForm.type,
        cost: Number(propertyForm.cost),
        notes: propertyForm.notes,
      };

      if (editingProperty) {
        payload.changeNote = propertyForm.changeNote;
        await api.put(`/properties/${editingProperty.id}`, payload);
      } else {
        await api.post(`/channels/${channelId}/properties`, payload);
      }

      setShowPropertyModal(false);
      await fetchData();
    } catch (err) {
      setFormError(
        err.response?.data?.message || 'Failed to save property.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingProperty) return;
    setDeleting(true);
    try {
      await api.delete(`/properties/${deletingProperty.id}`);
      setShowDeleteModal(false);
      setDeletingProperty(null);
      await fetchData();
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to delete property.');
    } finally {
      setDeleting(false);
    }
  };

  const openHistory = async (property) => {
    setHistoryPropertyName(property.name);
    setHistoryLoading(true);
    setShowHistoryModal(true);
    try {
      const { data } = await api.get(`/properties/${property.id}/history`);
      setHistoryData(data.history || data || []);
    } catch {
      setHistoryData([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const formatCurrency = (value) => {
    if (value == null) return '-';
    return Number(value).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    });
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

  const TypeIcon = typeIcons[channel?.type] || Tv;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div
            className={`h-14 w-14 rounded-xl flex items-center justify-center flex-shrink-0 ${
              typeColors[channel?.type] || 'bg-gray-100 text-gray-600'
            }`}
          >
            <TypeIcon className="h-7 w-7" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                {channel?.name}
              </h1>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  typeColors[channel?.type] || 'bg-gray-100 text-gray-700'
                }`}
              >
                {channel?.type}
              </span>
            </div>
            <p className="text-gray-500 mt-0.5">
              Client:{' '}
              <Link
                to={`/clients/${channel?.clientId}`}
                className="text-indigo-600 hover:text-indigo-500"
              >
                {channel?.client?.name || channel?.clientName || 'Client'}
              </Link>
            </p>
          </div>
        </div>
        {canModify(user?.role) && (
          <button
            onClick={openAddModal}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Property
          </button>
        )}
      </div>

      {/* Properties table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {properties.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-500">No properties yet. Add one to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Name
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Type
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">
                    Cost
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">
                    Created By
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">
                    Date
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {properties.map((property) => (
                  <tr
                    key={property.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {property.name}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          propertyTypeBadge[property.type] ||
                          'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {propertyTypeLabels[property.type] || property.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {formatCurrency(property.cost)}
                    </td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">
                      {property.createdBy?.name || property.createdByName || '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">
                      {property.createdAt
                        ? new Date(property.createdAt).toLocaleDateString()
                        : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openHistory(property)}
                          title="View History"
                          className="rounded-lg p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                        >
                          <History className="h-4 w-4" />
                        </button>
                        {canModify(user?.role) && (
                          <>
                            <button
                              onClick={() => openEditModal(property)}
                              title="Edit"
                              className="rounded-lg p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => {
                                setDeletingProperty(property);
                                setShowDeleteModal(true);
                              }}
                              title="Delete"
                              className="rounded-lg p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Property Modal */}
      <Modal
        isOpen={showPropertyModal}
        onClose={() => setShowPropertyModal(false)}
        title={editingProperty ? 'Edit Property' : 'Add Property'}
      >
        {formError && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            {formError}
          </div>
        )}
        <form onSubmit={handlePropertySubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Name
            </label>
            <input
              type="text"
              required
              value={propertyForm.name}
              onChange={(e) =>
                setPropertyForm((prev) => ({ ...prev, name: e.target.value }))
              }
              className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-colors"
              placeholder="Property name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Type
            </label>
            <select
              value={propertyForm.type}
              onChange={(e) =>
                setPropertyForm((prev) => ({ ...prev, type: e.target.value }))
              }
              className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-colors"
            >
              <option value="BOUGHT_AIRTIME">Bought Airtime</option>
              <option value="SPONSORSHIP">Sponsorship</option>
              <option value="BONUS_COMMERCIAL">Bonus Commercial</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Cost
            </label>
            <input
              type="number"
              required
              min="0"
              step="0.01"
              value={propertyForm.cost}
              onChange={(e) =>
                setPropertyForm((prev) => ({ ...prev, cost: e.target.value }))
              }
              className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-colors"
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Notes
            </label>
            <textarea
              rows={3}
              value={propertyForm.notes}
              onChange={(e) =>
                setPropertyForm((prev) => ({ ...prev, notes: e.target.value }))
              }
              className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-colors resize-none"
              placeholder="Optional notes..."
            />
          </div>
          {editingProperty && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Change Note <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={2}
                required
                value={propertyForm.changeNote}
                onChange={(e) =>
                  setPropertyForm((prev) => ({
                    ...prev,
                    changeNote: e.target.value,
                  }))
                }
                className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-colors resize-none"
                placeholder="Describe what changed and why..."
              />
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowPropertyModal(false)}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {submitting
                ? 'Saving...'
                : editingProperty
                ? 'Save Changes'
                : 'Add Property'}
            </button>
          </div>
        </form>
      </Modal>

      {/* History Modal */}
      <Modal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        title={`History: ${historyPropertyName}`}
        maxWidth="max-w-2xl"
      >
        {historyLoading ? (
          <LoadingSpinner size="md" className="py-8" />
        ) : historyData.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No history available.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <div className="relative border-l-2 border-gray-200 ml-4 space-y-6 py-2">
              {historyData.map((entry, index) => (
                <div key={entry.id || index} className="relative pl-6">
                  <div className="absolute -left-[9px] top-1 h-4 w-4 rounded-full bg-white border-2 border-indigo-400" />
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-sm">
                      <UserIcon className="h-3.5 w-3.5 text-gray-400" />
                      <span className="font-medium text-gray-900">
                        {entry.changedBy?.name || entry.changedByName || 'Unknown'}
                      </span>
                      <span className="text-gray-400">-</span>
                      <Clock className="h-3.5 w-3.5 text-gray-400" />
                      <span className="text-gray-500">
                        {entry.createdAt
                          ? new Date(entry.createdAt).toLocaleString()
                          : '-'}
                      </span>
                    </div>
                    {entry.changeNote && (
                      <p className="mt-2 text-sm text-gray-700 italic">
                        &quot;{entry.changeNote}&quot;
                      </p>
                    )}
                    {entry.changes && (
                      <div className="mt-2 text-xs text-gray-600 space-y-1">
                        {Object.entries(
                          typeof entry.changes === 'string'
                            ? JSON.parse(entry.changes)
                            : entry.changes
                        ).map(([key, val]) => (
                          <div key={key}>
                            <span className="font-medium">{key}:</span>{' '}
                            {typeof val === 'object'
                              ? `${val.from || '-'} → ${val.to || '-'}`
                              : String(val)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setDeletingProperty(null);
        }}
        title="Delete Property"
      >
        <p className="text-gray-600 mb-6">
          Are you sure you want to delete{' '}
          <span className="font-semibold text-gray-900">
            {deletingProperty?.name}
          </span>
          ? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              setShowDeleteModal(false);
              setDeletingProperty(null);
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
