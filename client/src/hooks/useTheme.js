import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'docdesk_theme';
const MODES = ['system', 'light', 'dark'];

// One store for the whole app, so the sidebar switch and the Settings page can
// never disagree about which theme is on.
const listeners = new Set();
let mode = readStored();

function readStored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(value) ? value : 'system';
  } catch {
    // Private windows and blocked site data throw here; system is the right fallback.
    return 'system';
  }
}

const darkQuery = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : null;

function applyToDocument(next) {
  const root = document.documentElement;
  if (next === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not remembering the choice is survivable.
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  darkQuery?.addEventListener('change', listener);
  return () => {
    listeners.delete(listener);
    darkQuery?.removeEventListener('change', listener);
  };
}

function snapshot() {
  return `${mode}|${darkQuery?.matches ? 1 : 0}`;
}

/**
 * Switches theme. When the browser supports view transitions the new theme
 * spreads out as a circle from the point that was clicked; otherwise it just
 * changes. Either way the attribute is set synchronously inside the transition,
 * so the captured "after" frame is already the new theme.
 */
export function setThemeMode(next, origin) {
  if (!MODES.includes(next) || next === mode) return;
  const change = () => {
    mode = next;
    applyToDocument(next);
    emit();
  };

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduced) {
    change();
    return;
  }

  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? 0;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const transition = document.startViewTransition(change);
  transition.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 700, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    })
    .catch(() => {});
}

/**
 * Three-state theme: follow the operating system, or pin light or dark.
 * "System" is a real state, so someone who switches their machine to dark in the
 * evening gets it without touching DocDesk. index.html applies the saved choice
 * before React mounts, so there is never a flash of the wrong theme.
 */
export function useTheme() {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [current, systemDark] = state.split('|');
  const isDark = current === 'dark' || (current === 'system' && systemDark === '1');

  const cycle = useCallback((origin) => {
    setThemeMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length], origin);
  }, []);

  const setMode = useCallback((next, origin) => setThemeMode(next, origin), []);

  return { mode: current, setMode, isDark, cycle };
}

export { MODES as THEME_MODES };
