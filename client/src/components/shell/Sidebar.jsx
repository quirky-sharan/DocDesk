import { NavLink } from 'react-router-dom';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import {
  Bell, Building2, ChartColumnBig, Database, FolderOpen, LayoutGrid, Monitor, Moon, Package,
  PanelLeftClose, PanelLeftOpen, Receipt, Settings, Sparkles, Sun, Truck, Users, X,
} from 'lucide-react';
import AppIcon from './AppIcon';
import Tooltip from '../ui/Tooltip';
import { useShell } from './ShellProvider';
import { useSettings } from '../../lib/settings';
import { useTheme } from '../../hooks/useTheme';
import { useAssistant } from '../../assistant/AssistantProvider';
import { cn } from '../../lib/cn';
import { spring, springSoft } from '../../lib/motion';
import { useScrollLock } from './SmoothScroll';
import { useEscapeLayer } from '../../hooks/useLayer';

export const NAV = [
  {
    label: 'Overview',
    items: [
      { name: 'Dashboard', path: '/', icon: LayoutGrid },
      { name: 'Reports', path: '/reports', icon: ChartColumnBig },
    ],
  },
  {
    label: 'Operations',
    items: [
      { name: 'Sales', path: '/sales', icon: Receipt },
      { name: 'Inventory', path: '/inventory', icon: Package, badge: 'restock' },
      { name: 'Incoming stock', path: '/orders', icon: Truck },
    ],
  },
  {
    label: 'People',
    items: [
      { name: 'Customers', path: '/customers', icon: Users },
      { name: 'Suppliers', path: '/suppliers', icon: Building2 },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { name: 'Files', path: '/files', icon: FolderOpen },
      { name: 'Messages', path: '/messages', icon: Bell, badge: 'queued' },
      { name: 'Database', path: '/database', icon: Database },
      { name: 'Settings', path: '/settings', icon: Settings },
    ],
  },
];

const EXPANDED = 256;
const COLLAPSED = 76;

export default function Sidebar() {
  const { collapsed, drawerOpen, setDrawerOpen } = useShell();

  return (
    <>
      <motion.aside
        className="glass fixed bottom-3 left-3 top-3 z-40 hidden flex-col rounded-[26px] lg:flex"
        initial={false}
        animate={{ width: collapsed ? COLLAPSED : EXPANDED }}
        transition={springSoft}
        aria-label="Main navigation"
      >
        <SidebarBody collapsed={collapsed} layoutId="desktop" />
      </motion.aside>

      <AnimatePresence>
        {drawerOpen && <MobileDrawer onClose={() => setDrawerOpen(false)} />}
      </AnimatePresence>
    </>
  );
}

function MobileDrawer({ onClose }) {
  useScrollLock(true);
  useEscapeLayer(onClose, true);
  return (
    <div className="fixed inset-0 z-[55] lg:hidden">
      <motion.div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.aside
        initial={{ x: '-105%' }}
        animate={{ x: 0 }}
        exit={{ x: '-105%' }}
        transition={springSoft}
        className="glass absolute bottom-2 left-2 top-2 flex w-[280px] flex-col rounded-[26px]"
        style={{ background: 'var(--glass-strong)' }}
        aria-label="Main navigation"
      >
        <button type="button" onClick={onClose} className="btn-ghost btn-icon btn-sm absolute right-3 top-4" aria-label="Close menu">
          <X size={17} />
        </button>
        <SidebarBody collapsed={false} layoutId="mobile" />
      </motion.aside>
    </div>
  );
}

function SidebarBody({ collapsed, layoutId }) {
  const { counts, setCollapsed } = useShell();
  const { businessName } = useSettings();

  // Namespaced, so the desktop sidebar (hidden but mounted on a phone) and the
  // drawer never try to animate one shared pill between them.
  return (
    <LayoutGroup id={`sidebar-${layoutId}`}>
      <div className={cn('flex items-center gap-3 pb-3 pt-4', collapsed ? 'justify-center px-2' : 'px-4')}>
        <motion.div whileHover={{ rotate: -6, scale: 1.06 }} whileTap={{ scale: 0.92 }} transition={spring}>
          <AppIcon size={collapsed ? 38 : 36} />
        </motion.div>
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6, transition: { duration: 0.1 } }}
              className="min-w-0"
            >
              <p className="text-[15.5px] font-semibold leading-tight tracking-[-0.02em]">DocDesk</p>
              <p className="truncate text-[12px] leading-tight text-ink-3">{businessName}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <nav className={cn('min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-2', collapsed ? 'px-2.5' : 'px-3')} data-lenis-prevent>
        {NAV.map((group) => (
            <div key={group.label} className="mb-3">
              {collapsed ? (
                <div className="mx-auto mb-2 mt-1 h-px w-7" style={{ background: 'var(--line)' }} />
              ) : (
                <p className="px-3 pb-1 pt-1 text-[11.5px] font-medium text-ink-3">{group.label}</p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavItem key={item.path} item={item} collapsed={collapsed} badge={item.badge ? counts[item.badge] : 0} />
                ))}
              </div>
            </div>
          ))}
      </nav>

      <div className={cn('space-y-2 pb-3 pt-2', collapsed ? 'px-2.5' : 'px-3')}>
        <AskCard collapsed={collapsed} />
        <ThemeSwitch collapsed={collapsed} />
        {layoutId === 'desktop' && (
          <Tooltip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right" className="flex">
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              className={cn('btn-ghost btn-sm w-full', collapsed ? 'justify-center px-0' : 'justify-start')}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              {!collapsed && <span>Collapse</span>}
            </button>
          </Tooltip>
        )}
      </div>
    </LayoutGroup>
  );
}

function NavItem({ item, collapsed, badge }) {
  const Icon = item.icon;
  const link = (
    <NavLink to={item.path} end={item.path === '/'} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--c-accent)/0.5)]">
      {({ isActive }) => (
        <motion.span
          whileTap={{ scale: 0.97 }}
          transition={spring}
          className={cn(
            'relative flex h-10 items-center gap-3 rounded-xl text-[13.5px] font-medium transition-colors duration-200',
            collapsed ? 'justify-center px-0' : 'px-3',
            isActive ? 'text-ink' : 'text-ink-2 hover:bg-[var(--wash)] hover:text-ink'
          )}
        >
          {isActive && (
            <motion.span
              layoutId="nav-pill"
              className="absolute inset-0 rounded-xl"
              style={{ background: 'var(--nav-pill)', boxShadow: 'var(--nav-pill-shadow)' }}
              transition={spring}
            />
          )}
          <Icon
            size={18}
            strokeWidth={isActive ? 2.2 : 1.8}
            className="relative z-10 shrink-0 transition-colors"
            style={{ color: isActive ? 'rgb(var(--c-accent))' : undefined }}
          />
          {!collapsed && <span className="relative z-10 truncate">{item.name}</span>}
          <AnimatePresence>
            {badge > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={spring}
                className={cn(
                  'relative z-10 grid place-items-center rounded-full font-semibold text-white tabular',
                  collapsed ? 'absolute right-1.5 top-1.5 h-4 min-w-4 px-1 text-[9.5px]' : 'ml-auto h-5 min-w-5 px-1.5 text-[11px]'
                )}
                style={{ background: item.badge === 'restock' ? 'var(--warning-solid)' : 'var(--danger-solid)' }}
              >
                {badge > 99 ? '99+' : badge}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.span>
      )}
    </NavLink>
  );

  return collapsed ? (
    <Tooltip label={item.name} side="right" className="block">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function AskCard({ collapsed }) {
  const assistant = useAssistant();
  const busy = assistant.busy;

  if (collapsed) {
    return (
      <Tooltip label="Ask DocDesk" side="right" className="flex justify-center">
        <button type="button" onClick={() => assistant.setOpen(true)} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-[var(--wash)]" aria-label="Ask DocDesk">
          <span className={cn('ai-orb h-6 w-6', busy && 'is-busy')} />
        </button>
      </Tooltip>
    );
  }

  return (
    <motion.button
      type="button"
      onClick={() => assistant.setOpen(true)}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.97 }}
      transition={spring}
      className="group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl p-3 text-left"
      style={{ background: 'rgb(var(--c-elevated) / 0.7)', boxShadow: '0 0 0 1px var(--line), var(--shadow-sm)' }}
    >
      <span className={cn('ai-orb h-8 w-8 shrink-0', busy && 'is-busy')} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-[13.5px] font-semibold">
          Ask DocDesk <Sparkles size={12} className="text-violet" />
        </span>
        <span className="block truncate text-[12px] text-ink-3">{busy ? 'Working on it…' : 'Your AI front desk'}</span>
      </span>
      <span className="kbd">Ctrl J</span>
    </motion.button>
  );
}

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Auto', icon: Monitor },
];

function ThemeSwitch({ collapsed }) {
  const { mode, setMode, cycle } = useTheme();

  if (collapsed) {
    const current = THEMES.find((t) => t.value === mode) || THEMES[2];
    const Icon = current.icon;
    return (
      <Tooltip label={`Theme: ${current.label}`} side="right" className="flex justify-center">
        <button
          type="button"
          onClick={(e) => cycle({ x: e.clientX, y: e.clientY })}
          className="grid h-10 w-10 place-items-center rounded-xl text-ink-2 hover:bg-[var(--wash)] hover:text-ink"
          aria-label={`Theme: ${current.label}. Click to change.`}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={mode} initial={{ rotate: -90, scale: 0.5, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} exit={{ rotate: 90, scale: 0.5, opacity: 0 }} transition={spring}>
              <Icon size={17} />
            </motion.span>
          </AnimatePresence>
        </button>
      </Tooltip>
    );
  }

  return (
    <div className="flex rounded-full p-[3px]" style={{ background: 'var(--wash-strong)', boxShadow: 'inset 0 0 0 1px var(--line)' }} role="radiogroup" aria-label="Theme">
      {THEMES.map(({ value, label, icon: Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={(e) => setMode(value, { x: e.clientX, y: e.clientY })}
            className={cn('relative isolate flex h-7 flex-1 items-center justify-center gap-1.5 rounded-full text-[12px] font-medium transition-colors', active ? 'text-ink' : 'text-ink-3 hover:text-ink')}
          >
            {active && (
              <motion.span layoutId="theme-pill" className="absolute inset-0 -z-10 rounded-full" style={{ background: 'var(--segment-pill)', boxShadow: 'var(--segment-shadow)' }} transition={spring} />
            )}
            <Icon size={13} strokeWidth={2.2} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
