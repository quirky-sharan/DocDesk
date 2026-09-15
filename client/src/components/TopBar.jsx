import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api/client';

const TITLES = {
  '/': 'Dashboard',
  '/reports': 'Reports',
  '/inventory': 'Inventory',
  '/sales': 'Sales',
  '/orders': 'Incoming stock',
  '/customers': 'Customers',
  '/suppliers': 'Suppliers',
  '/files': 'Files',
  '/messages': 'Messages',
  '/settings': 'Settings',
};

function initials(name) {
  return (name || 'DocDesk')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

export default function TopBar() {
  const { pathname } = useLocation();
  const [businessName, setBusinessName] = useState('DocDesk');
  const [waiting, setWaiting] = useState(0);
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  // Re-read on navigation so a change on the Settings page shows up immediately.
  useEffect(() => {
    api.settings.get().then((d) => setBusinessName(d.values.business_name || 'DocDesk')).catch(() => {});
    api.messages.list({ status: 'queued', pageSize: 1 }).then((d) => setWaiting(d.total)).catch(() => {});
  }, [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
      <h2 className="text-sm font-medium text-slate-500">{TITLES[pathname] || 'DocDesk'}</h2>

      <div className="flex items-center gap-2">
        <Link
          to="/messages"
          className="relative rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          title={waiting ? `${waiting} message${waiting === 1 ? '' : 's'} waiting` : 'Messages'}
        >
          Alerts
          {waiting > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
              {waiting > 9 ? '9+' : waiting}
            </span>
          )}
        </Link>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-slate-100"
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
              {initials(businessName)}
            </span>
            <span className="hidden max-w-[160px] truncate text-sm text-slate-700 sm:block">
              {businessName}
            </span>
          </button>

          {open && (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-60 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"
            >
              <div className="border-b border-slate-100 px-3 py-2">
                <p className="truncate text-sm font-medium">{businessName}</p>
                <p className="text-xs text-slate-500">Signed in on this computer</p>
              </div>

              <Link
                to="/settings"
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
              >
                Business settings
              </Link>
              <Link
                to="/files"
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
              >
                Your files
              </Link>

              {/* Accounts aren't built yet - saying so is better than a button
                  that looks live and does nothing. */}
              <div className="mt-1 border-t border-slate-100 px-3 py-2">
                <p className="text-xs text-slate-500">
                  Personal accounts and sign-in are not set up yet.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
