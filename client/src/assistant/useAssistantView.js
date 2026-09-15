import { useEffect, useRef } from 'react';
import { useAssistant } from './AssistantProvider';
import { useDataChanged } from '../hooks/useDataChanged';

/**
 * Lets the assistant drive the list on this page, and keeps the list fresh when
 * the assistant changes data behind it.
 *
 * `filterSetters` maps a filter name the assistant uses (category, stock,
 * payment_status...) to the page's own state setter, so "show unpaid sales"
 * moves the real Payment dropdown rather than a hidden filter the user can't see.
 */
export function useAssistantView(table, list, filterSetters = {}, { defaultSort, defaultDir = 'asc', onChange } = {}) {
  const { registerView } = useAssistant();
  const latest = useRef({ list, filterSetters, onChange });
  latest.current = { list, filterSetters, onChange };

  useEffect(
    () =>
      registerView(table, (view = {}) => {
        const { list: current, filterSetters: setters } = latest.current;
        // A new view replaces the old one entirely, so a stale category filter
        // doesn't silently hide rows the user just asked to see.
        for (const [key, setter] of Object.entries(setters)) {
          setter(view.filters?.[key] !== undefined ? String(view.filters[key]) : '');
        }
        current.setSearch(view.search || '');
        current.setSort(view.sort || defaultSort);
        current.setDir(view.sort ? view.dir || 'asc' : defaultDir);
        current.setPage(1);
      }),
    [table, registerView, defaultSort, defaultDir]
  );

  useDataChanged(() => {
    latest.current.list.reload();
    latest.current.onChange?.();
  }, [table]);
}
