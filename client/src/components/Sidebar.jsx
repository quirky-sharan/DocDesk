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
    <aside
      className="flex h-full w-[15rem] shrink-0 flex-col"
      style={{ background: 'var(--sidebar-bg)', borderRight: '1px solid var(--sidebar-border)' }}
    >
      <div className="px-6 py-6">
        <h1
          className="text-lg font-semibold tracking-[-0.01em]"
          style={{ color: 'var(--sidebar-text-active)' }}
        >
          DocDesk
        </h1>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--sidebar-text)' }}>
          Front desk &amp; inventory
        </p>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
        {GROUPS.map((group, i) => (
          <div key={i}>
            {group.label && (
              <p
                className="px-3 pb-2 text-[0.68rem] font-semibold uppercase tracking-[0.08em]"
                style={{ color: 'var(--sidebar-text)', opacity: 0.6 }}
              >
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink key={item.path} to={item.path} end={item.path === '/'}>
                  {({ isActive }) => (
                    <span
                      className="block rounded-lg px-3 py-2 text-sm transition-colors"
                      style={{
                        background: isActive ? 'var(--sidebar-active)' : 'transparent',
                        color: isActive ? 'var(--sidebar-text-active)' : 'var(--sidebar-text)',
                        fontWeight: isActive ? 500 : 400,
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) e.currentTarget.style.background = 'var(--sidebar-hover)';
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      {item.name}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
