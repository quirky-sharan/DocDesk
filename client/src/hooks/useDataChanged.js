import { useEffect, useRef } from 'react';

const EVENT = 'docdesk:data-changed';

/** Announce that records changed somewhere other than the page showing them. */
export function announceDataChanged(tables = []) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { tables } }));
}

/**
 * Re-run a callback when the assistant (or anything else) changes data.
 * Pass the tables this view shows, or nothing to react to every change.
 */
export function useDataChanged(callback, tables) {
  const latest = useRef(callback);
  latest.current = callback;
  const key = tables ? tables.join(',') : '*';

  useEffect(() => {
    function onChange(event) {
      const changed = event.detail?.tables || [];
      const watched = key === '*' ? null : key.split(',');
      if (!watched || !changed.length || changed.some((t) => watched.includes(t))) {
        latest.current();
      }
    }
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, [key]);
}
