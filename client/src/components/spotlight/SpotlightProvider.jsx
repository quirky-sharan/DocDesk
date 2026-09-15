import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import Spotlight from './Spotlight';

const SpotlightContext = createContext(null);

/**
 * Ctrl+K (or Cmd+K) anywhere opens Spotlight: jump to a page, run an action,
 * find a product or customer, or hand the sentence straight to the assistant.
 */
export function SpotlightProvider({ children }) {
  const [state, setState] = useState({ open: false, query: '' });

  const open = useCallback((query = '') => setState({ open: true, query }), []);
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);

  useEffect(() => {
    function onKey(event) {
      const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setState((s) => ({ open: !s.open, query: '' }));
      } else if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setState({ open: true, query: '' });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo(() => ({ open, close, isOpen: state.open }), [open, close, state.open]);

  return (
    <SpotlightContext.Provider value={value}>
      {children}
      <AnimatePresence>{state.open && <Spotlight key="spotlight" initialQuery={state.query} onClose={close} />}</AnimatePresence>
    </SpotlightContext.Provider>
  );
}

export function useSpotlight() {
  const context = useContext(SpotlightContext);
  if (!context) throw new Error('useSpotlight must be used inside SpotlightProvider');
  return context;
}
