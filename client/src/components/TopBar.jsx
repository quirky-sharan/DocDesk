import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import ThemeToggle from './ThemeToggle';

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
    <header
      className="flex h-14 shrink-0 items-center justify-between px-6 sm:px-10"
      style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
    >
      <h2 className="text-sm font-medium muted">{TITLES[pathname] || 'DocDesk'}</h2>

      <div className="flex items-center gap-1">
        <ThemeToggle />
        <Link
          to="/messages"
          className="btn-ghost relative"
          title={waiting ? `${waiting} message${waiting === 1 ? '' : 's'} waiting` : 'Messages'}
        >
          Alerts
          {waiting > 0 && (
            <span
              className="absolute right-0.5 top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
              style={{ background: 'var(--danger)' }}
            >
              {waiting > 9 ? '9+' : waiting}
            </span>
          )}
        </Link>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="btn-ghost gap-2 py-1 pl-1 pr-2"
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full text-[0.68rem] font-semibold text-white"
              style={{ background: 'var(--accent)' }}
            >
              {initials(businessName)}
            </span>
            <span className="hidden max-w-[160px] truncate text-sm sm:block" style={{ color: 'var(--text)' }}>
              {businessName}
            </span>
          </button>

          {open && (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-60 rounded-xl p-1.5"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-lg)',
              }}
            >
              <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
                <p className="truncate text-sm font-medium">{businessName}</p>
                <p className="text-xs subtle">Signed in on this computer</p>
              </div>

              <Link
                to="/settings"
                onClick={() => setOpen(false)}
                className="btn-edit mt-1 block w-full px-3 py-2 text-left"
              >
                Business settings
              </Link>
              <Link
                to="/files"
                onClick={() => setOpen(false)}
                className="btn-edit block w-full px-3 py-2 text-left"
              >
                Your files
              </Link>

              {/* Accounts aren't built yet - saying so is better than a button
                  that looks live and does nothing. */}
              <div className="mt-1 px-3 py-2" style={{ borderTop: '1px solid var(--border)' }}>
                <p className="text-xs subtle">
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
