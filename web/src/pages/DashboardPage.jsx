import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Building2, Users, BarChart3, FileText, ArrowRight } from 'lucide-react';
import api from '../lib/api';
import LoadingSpinner from '../components/LoadingSpinner';

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ agencies: 0, clients: 0, properties: 0 });
  const [agencies, setAgencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const [agenciesRes, statsRes] = await Promise.allSettled([
          api.get('/agencies'),
          api.get('/dashboard/stats'),
        ]);

        if (agenciesRes.status === 'fulfilled') {
          const agencyData = agenciesRes.value.data.agencies || agenciesRes.value.data || [];
          setAgencies(agencyData);
        }

        if (statsRes.status === 'fulfilled') {
          setStats(statsRes.value.data);
        } else if (agenciesRes.status === 'fulfilled') {
          const agencyData = agenciesRes.value.data.agencies || agenciesRes.value.data || [];
          const clientCount = agencyData.reduce(
            (sum, a) => sum + (a.clientCount || a._count?.clients || 0),
            0
          );
          setStats({
            agencies: agencyData.length,
            clients: clientCount,
            properties: 0,
          });
        }
      } catch (err) {
        setError('Failed to load dashboard data.');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboard();
  }, []);

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

  const statCards = [
    {
      name: 'My Agencies',
      value: stats.agencies,
      icon: Building2,
      color: 'bg-indigo-50 text-indigo-600',
      href: '/agencies',
    },
    {
      name: 'My Clients',
      value: stats.clients,
      icon: Users,
      color: 'bg-emerald-50 text-emerald-600',
      href: '/agencies',
    },
    {
      name: 'Recent Properties',
      value: stats.properties,
      icon: FileText,
      color: 'bg-amber-50 text-amber-600',
      href: null,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back, {user?.name?.split(' ')[0] || 'User'}
        </h1>
        <p className="text-gray-500 mt-1">
          Here is an overview of your media buying activity.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map((stat) => (
          <div
            key={stat.name}
            className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">{stat.name}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">
                  {stat.value}
                </p>
              </div>
              <div
                className={`h-12 w-12 rounded-xl ${stat.color} flex items-center justify-center`}
              >
                <stat.icon className="h-6 w-6" />
              </div>
            </div>
            {stat.href && (
              <Link
                to={stat.href}
                className="mt-4 inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-500 font-medium"
              >
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        ))}
      </div>

      {/* Quick access */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Quick Access
        </h2>
        {agencies.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <Building2 className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">
              No agencies assigned yet. Contact your administrator.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {agencies.map((agency) => (
              <Link
                key={agency.id}
                to={`/agencies/${agency.id}`}
                className="group bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md hover:border-indigo-200 transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0 group-hover:bg-indigo-100 transition-colors">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate group-hover:text-indigo-600 transition-colors">
                      {agency.name}
                    </h3>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {agency.clientCount || agency._count?.clients || 0} clients
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-end text-sm text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="font-medium">View details</span>
                  <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
