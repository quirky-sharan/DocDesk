import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'docdesk_theme';
const MODES = ['system', 'light', 'dark'];

function readStored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(value) ? value : 'system';
  } catch {
    // Private windows and blocked site data both throw here; falling back to
    // system is correct, not an error worth surfacing.
    return 'system';
  }
}

/**
 * Three-state theme: follow the operating system, or pin light or dark.
 *
 * "System" is a real state rather than just the initial value, so someone who
 * switches their machine to dark in the evening gets it without touching this.
 * The choice is written to the root element as data-theme, which the token
 * blocks in index.css key off.
 */
export function useTheme() {
  const [mode, setMode] = useState(readStored);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  );

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return undefined;
    const onChange = (e) => setSystemDark(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);

    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Not being able to remember the choice is survivable.
    }
  }, [mode]);

  const isDark = mode === 'dark' || (mode === 'system' && systemDark);

  const cycle = useCallback(() => {
    setMode((current) => MODES[(MODES.indexOf(current) + 1) % MODES.length]);
  }, []);

  return { mode, setMode, isDark, cycle };
}

export { MODES as THEME_MODES };
