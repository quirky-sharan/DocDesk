import { useCallback, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, useScroll, useTransform } from 'motion/react';
import { Bell, Building2, Database, FolderOpen, LogOut, Menu, Package, Search, Settings } from 'lucide-react';
import { api } from '../../api/client';
import { useShell } from './ShellProvider';
import { useSmoothScroll } from './SmoothScroll';
import { NAV } from './Sidebar';
import Popover, { MenuItem } from '../ui/Popover';
import Avatar from '../ui/Avatar';
import Spinner from '../ui/Spinner';
import { useSettings } from '../../lib/settings';
import { displayNameFor, useAuth } from '../../auth/AuthProvider';
import { useSpotlight } from '../spotlight/SpotlightProvider';
import { formatRelative } from '../../lib/format';
import { cn } from '../../lib/cn';

const TITLES = Object.fromEntries(NAV.flatMap((g) => g.items.map((i) => [i.path, i.name])));

export default function TopBar() {
  const { pathname } = useLocation();
  const { scrollerRef } = useSmoothScroll();
  const { setDrawerOpen } = useShell();
  const spotlight = useSpotlight();
  const { scrollY } = useScroll({ container: scrollerRef });

  // Glass fades in as soon as content passes beneath it; the compact title only
  // once the page's large title has scrolled away.
  const barOpacity = useTransform(scrollY, [0, 28], [0, 1]);
  const titleOpacity = useTransform(scrollY, [56, 104], [0, 1]);
  const titleY = useTransform(scrollY, [56, 104], [8, 0]);

  return (
    <header className="sticky top-0 z-30">
      <motion.div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          opacity: barOpacity,
          background: 'var(--glass-bg)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          backdropFilter: 'blur(24px) saturate(180%)',
          borderBottom: '1px solid var(--line)',
        }}
      />
      <div className="relative mx-auto flex h-16 max-w-[1360px] items-center gap-2 px-4 sm:px-8">
        <button type="button" className="btn-ghost btn-icon lg:hidden" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
          <Menu size={19} />
        </button>

        <motion.p style={{ opacity: titleOpacity, y: titleY }} className="truncate text-[15px] font-semibold tracking-[-0.018em]">
          {TITLES[pathname] || 'DocDesk'}
        </motion.p>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => spotlight.open()}
            className="group hidden h-9 w-[250px] items-center gap-2 rounded-full px-3.5 text-left text-[13.5px] text-ink-3 transition-[box-shadow,background-color] duration-200 md:flex xl:w-[300px]"
            style={{ background: 'rgb(var(--c-elevated) / 0.75)', boxShadow: '0 0 0 1px var(--line), var(--shadow-xs)' }}
          >
            <Search size={15} strokeWidth={2.2} />
            <span className="flex-1 truncate">Search or ask anything…</span>
            <span className="kbd">Ctrl K</span>
          </button>
          <button type="button" onClick={() => spotlight.open()} className="btn-ghost btn-icon md:hidden" aria-label="Search">
            <Search size={18} />
          </button>
          <Notifications />
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
}

function Notifications() {
  const anchor = useRef(null);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(null);
  const { counts } = useShell();
  const close = useCallback(() => setOpen(false), []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setMessages(null);
      try {
        const data = await api.messages.list({ status: 'queued', pageSize: 5, sort: 'created_at', dir: 'desc' });
        setMessages(data.rows);
      } catch {
        setMessages([]);
      }
    }
  }

  const total = counts.queued;

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={toggle}
        className="btn-ghost btn-icon relative"
        aria-label={total ? `${total} alerts waiting` : 'Alerts'}
        aria-expanded={open}
      >
        <motion.span animate={total ? { rotate: [0, -14, 12, -8, 5, 0] } : { rotate: 0 }} transition={{ duration: 0.9, delay: 0.4 }} className="inline-flex">
          <Bell size={18} />
        </motion.span>
        {total > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9.5px] font-semibold text-white tabular" style={{ background: 'var(--danger-solid)', boxShadow: '0 0 0 2px rgb(var(--c-canvas))' }}>
            {total > 9 ? '9+' : total}
          </span>
        )}
      </button>
      <Popover anchorRef={anchor} open={open} onClose={close} className="w-[360px] p-2" label="Alerts">
        <div className="flex items-center justify-between px-2.5 pb-2 pt-1.5">
          <p className="text-[14px] font-semibold">Alerts</p>
          <Link to="/messages" onClick={close} className="text-[12.5px] font-medium text-accent-ink hover:underline">
            View all
          </Link>
        </div>
        {counts.restock > 0 && (
          <Link to="/inventory" onClick={close} className="mb-1 flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-[var(--wash-strong)]">
            <span className="grid h-8 w-8 place-items-center rounded-full" style={{ background: 'var(--warning-soft)', color: 'rgb(var(--c-warning))' }}>
              <Package size={15} strokeWidth={2.2} />
            </span>
            <span className="min-w-0 flex-1 text-[13px]">
              <span className="font-medium">{counts.restock} item{counts.restock === 1 ? '' : 's'} need restocking</span>
              <span className="block text-[12px] text-ink-3">Open inventory</span>
            </span>
          </Link>
        )}
        {messages === null ? (
          <div className="grid h-24 place-items-center text-ink-3">
            <Spinner />
          </div>
        ) : messages.length === 0 ? (
          <p className="px-2.5 py-6 text-center text-[13px] text-ink-3">Nothing waiting. You're all caught up.</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto" data-lenis-prevent>
            {messages.map((m, i) => (
              <motion.li key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <Link to="/messages" onClick={close} className="flex gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-[var(--wash-strong)]">
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full')} style={{ background: 'rgb(var(--c-accent))' }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{m.subject || 'Message'}</span>
                    <span className="line-clamp-2 block text-[12px] leading-snug text-ink-2">{m.body}</span>
                    <span className="mt-0.5 block text-[11.5px] text-ink-3">{formatRelative(m.created_at)}</span>
                  </span>
                </Link>
              </motion.li>
            ))}
          </ul>
        )}
      </Popover>
    </>
  );
}

/** The account photo where the provider gave us one, initials where it did not. */
function AccountFace({ user, name, size }) {
  if (user?.photoURL) {
    return (
      <img
        src={user.photoURL}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size, boxShadow: '0 0 0 1px var(--line)' }}
      />
    );
  }
  return <Avatar name={name} size={size} />;
}

function ProfileMenu() {
  const anchor = useRef(null);
  const [open, setOpen] = useState(false);
  const { businessName } = useSettings();
  const { user, signOut } = useAuth();
  const close = useCallback(() => setOpen(false), []);

  const name = displayNameFor(user) || businessName;

  return (
    <>
      <button ref={anchor} type="button" onClick={() => setOpen((v) => !v)} className="ml-1 rounded-full transition-transform duration-300 hover:scale-105 active:scale-95" aria-label="Account menu" aria-expanded={open}>
        <AccountFace user={user} name={name} size={34} />
      </button>
      <Popover anchorRef={anchor} open={open} onClose={close} className="w-64 p-1.5" role="menu" label="Account">
        <div className="flex items-center gap-3 px-2.5 pb-3 pt-2">
          <AccountFace user={user} name={name} size={40} />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold">{name}</p>
            <p className="truncate text-[12px] text-ink-3">{user?.email || businessName}</p>
          </div>
        </div>
        <div className="divider mx-1 mb-1" />
        <MenuItem as={Link} to="/settings" icon={Building2} onClick={close}>Business details</MenuItem>
        <MenuItem as={Link} to="/files" icon={FolderOpen} onClick={close}>Your files</MenuItem>
        <MenuItem as={Link} to="/database" icon={Database} onClick={close}>Database</MenuItem>
        <MenuItem as={Link} to="/settings" icon={Settings} onClick={close}>Settings</MenuItem>
        <div className="divider mx-1 my-1" />
        <MenuItem
          icon={LogOut}
          onClick={() => {
            close();
            // Signing out drops the whole private tree and the landing page
            // takes over; no navigation needed.
            signOut().catch(() => {});
          }}
        >
          Sign out
        </MenuItem>
      </Popover>
    </>
  );
}
