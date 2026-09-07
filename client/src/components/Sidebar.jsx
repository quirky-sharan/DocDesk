import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const links = [
  { to: '/patients',     label: 'Patients' },
  { to: '/appointments', label: 'Appointments' },
  { to: '/billing',      label: 'Billing' },
  { to: '/medications',  label: 'Medications' },
];

export default function Sidebar() {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();

  return (
    <aside className="w-56 bg-blue-700 text-white flex flex-col min-h-screen">
      <div className="px-4 py-5 text-2xl font-bold border-b border-blue-600">
        🩺 DocDesk
      </div>

      <nav className="flex-1 mt-4">
        {links.map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            className={`block px-4 py-3 text-sm font-medium transition-colors hover:bg-blue-600 ${
              pathname.startsWith(to) ? 'bg-blue-800' : ''
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-blue-600 text-xs">
        <p className="truncate font-medium">{user?.name}</p>
        <p className="opacity-75 mb-3 capitalize">{user?.role}</p>
        <button
          onClick={logout}
          className="w-full bg-blue-900 hover:bg-blue-950 py-1.5 rounded text-sm"
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
