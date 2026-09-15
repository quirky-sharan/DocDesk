import { useCallback } from 'react';

/**
 * Turns an ask-bar outcome into a change on the page.
 *
 * Sort and filter describe a view, so they drive the list's own state rather
 * than writing anything. Everything else already happened on the server, so the
 * page just reloads.
 *
 * `filterHandlers` lets a page intercept a filter on a column it has a real
 * control for (a category dropdown, say) instead of falling back to search.
 */
export function useAskOutcome(list, { onChanged, filterHandlers = {} } = {}) {
  return useCallback(
    (outcome) => {
      if (outcome.kind === 'changed') {
        (onChanged || list.reload)();
        return;
      }

      const op = outcome.operation;
      if (!op) return;

      if (op.type === 'sort') {
        list.setSort(op.column);
        list.setDir(op.direction);
        list.setPage(1);
        return;
      }

      if (op.type === 'filter') {
        const condition = op.conditions[0];
        const handler = filterHandlers[condition.column];
        if (handler) {
          handler(condition.value, condition);
        } else {
          // No dedicated control for that column, so fall back to search. It
          // won't always be an exact match, but the user sees the list react
          // rather than nothing happening.
          list.setSearch(String(condition.value));
        }
        list.setPage(1);
      }
    },
    [list, onChanged, filterHandlers]
  );
}
