import { NavLink } from 'react-router-dom';

const NAV = [{ name: 'Dashboard', path: '/' }];

export default function Sidebar() {
  return (
    <aside className="flex w-60 flex-col bg-slate-900 text-white">
      <div className="border-b border-slate-800 p-6">
        <h1 className="text-xl font-bold">DocDesk</h1>
        <p className="mt-1 text-sm text-slate-400">Front desk &amp; inventory</p>
      </div>
      <nav className="flex-1 space-y-1 p-4">
        {NAV.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `block rounded-lg px-4 py-2 transition-colors ${
                isActive ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800'
              }`
            }
          >
            {item.name}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-800 p-4 text-xs text-slate-500">Phase 1 — wire-up</div>
    </aside>
  );
}
