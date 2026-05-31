import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Building2, Users, ArrowRight, Search } from 'lucide-react';
import api from '../lib/api';
import LoadingSpinner from '../components/LoadingSpinner';

export default function AgencyDetailPage() {
  const { agencyId } = useParams();
  const [agency, setAgency] = useState(null);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

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

  const filtered = clients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

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
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
            <Building2 className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {agency?.name}
            </h1>
            <p className="text-gray-500 mt-0.5">
              {clients.length} client{clients.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search clients..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 rounded-lg border border-gray-300 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-colors w-full sm:w-64"
          />
        </div>
      </div>

      {/* Clients */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Users className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <h3 className="font-medium text-gray-900 mb-1">No clients found</h3>
          <p className="text-sm text-gray-500">
            {search
              ? 'Try adjusting your search term.'
              : 'This agency has no clients yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((client) => (
            <Link
              key={client.id}
              to={`/clients/${client.id}`}
              className="group bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md hover:border-indigo-200 transition-all"
            >
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
                  <Users className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-gray-900 truncate group-hover:text-indigo-600 transition-colors">
                    {client.name}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {client.channelCount || client._count?.channels || 0} channels
                  </p>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-end text-sm text-indigo-600 font-medium">
                View channels <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
