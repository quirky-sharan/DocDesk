import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../../api/client';
import { useDataChanged } from '../../hooks/useDataChanged';

const ShellContext = createContext(null);
const COLLAPSE_KEY = 'docdesk.sidebar.collapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * State the chrome shares: whether the sidebar is collapsed (remembered), the
 * phone drawer, and the small counts shown as badges - alerts waiting, items to
 * restock - refreshed on navigation, on any data change and once a minute.
 */
export function ShellProvider({ children }) {
  const [collapsed, setCollapsedState] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [counts, setCounts] = useState({ queued: 0, restock: 0 });
  const { pathname } = useLocation();

  const setCollapsed = useCallback((value) => {
    setCollapsedState((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // Remembering the choice is a nicety, not a requirement.
      }
      return next;
    });
  }, []);

  const refreshCounts = useCallback(async () => {
    try {
      const [queued, summary] = await Promise.all([
        api.messages.list({ status: 'queued', pageSize: 1 }),
        api.products.summary(),
      ]);
      setCounts({ queued: queued.total || 0, restock: (summary.lowStock || 0) + (summary.outOfStock || 0) });
    } catch {
      // Badges quietly stay as they were if the server is unreachable.
    }
  }, []);

  useEffect(() => {
    refreshCounts();
    setDrawerOpen(false);
  }, [pathname, refreshCounts]);

  useEffect(() => {
    const timer = setInterval(refreshCounts, 60_000);
    return () => clearInterval(timer);
  }, [refreshCounts]);

  useDataChanged(() => refreshCounts());

  const value = useMemo(
    () => ({ collapsed, setCollapsed, drawerOpen, setDrawerOpen, counts, refreshCounts }),
    [collapsed, setCollapsed, drawerOpen, counts, refreshCounts]
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell() {
  const context = useContext(ShellContext);
  if (!context) throw new Error('useShell must be used inside ShellProvider');
  return context;
}
