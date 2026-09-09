import { Link, useLocation } from 'react-router-dom';

const Sidebar = () => {
  const location = useLocation();
  
  const navItems = [
    { name: 'Dashboard', path: '/' },
    { name: 'Doctors', path: '/doctors' },
    { name: 'Patients', path: '/patients' },
    { name: 'Appointments', path: '/appointments' },
    { name: 'Medicines', path: '/medicines' },
    { name: 'Inventory', path: '/inventory' },
    { name: 'Bills', path: '/bills' },
  ];

  return (
    <div className="w-64 bg-slate-900 text-white min-h-screen flex flex-col shadow-2xl">
      <div className="p-6 border-b border-slate-800">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-teal-400 to-blue-500 bg-clip-text text-transparent">
          DocDesk
        </h1>
        <p className="text-slate-400 text-sm mt-1">Clinic Management</p>
      </div>
      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.name}
              to={item.path}
              className={`block px-4 py-3 rounded-lg transition-all duration-300 ${
                isActive 
                  ? 'bg-gradient-to-r from-teal-500 to-blue-600 text-white shadow-lg transform translate-x-2' 
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white hover:translate-x-1'
              }`}
            >
              {item.name}
            </Link>
          );
        })}
      </nav>
      <div className="p-6 border-t border-slate-800 text-sm text-slate-500">
        &copy; 2026 DocDesk
      </div>
    </div>
  );
};

export default Sidebar;
