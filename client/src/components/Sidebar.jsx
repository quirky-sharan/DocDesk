import { NavLink } from 'react-router-dom';

const GROUPS = [
  {
    items: [
      { name: 'Dashboard', path: '/' },
      { name: 'Reports', path: '/reports' },
    ],
  },
  {
    label: 'Day to day',
    items: [
      { name: 'Inventory', path: '/inventory' },
      { name: 'Sales', path: '/sales' },
      { name: 'Incoming stock', path: '/orders' },
    ],
  },
  {
    label: 'Records',
    items: [
      { name: 'Customers', path: '/customers' },
      { name: 'Suppliers', path: '/suppliers' },
      { name: 'Files', path: '/files' },
    ],
  },
  {
    items: [
      { name: 'Messages', path: '/messages' },
      { name: 'Settings', path: '/settings' },
    ],
  },
];

export default function Sidebar() {
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col bg-slate-900 text-white">
      <div className="border-b border-slate-800 p-6">
        <h1 className="text-xl font-bold">DocDesk</h1>
        <p className="mt-1 text-sm text-slate-400">Front desk &amp; inventory</p>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto p-3">
        {GROUPS.map((group, i) => (
          <div key={i}>
            {group.label && (
              <p className="px-4 pb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                {group.label}
              </p>
            )}
            <div className="space-y-1">
              {group.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) =>
                    `block rounded-lg px-4 py-2 text-sm transition-colors ${
                      isActive ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800'
                    }`
                  }
                >
                  {item.name}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
