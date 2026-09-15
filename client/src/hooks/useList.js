import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Shared list state: search, sort, paging and loading, for any endpoint that
 * returns { rows, total, page, pageCount }.
 *
 * Every list page needs the same five pieces of state and the same debounce,
 * so they share this rather than each hand-rolling it slightly differently.
 */
export function useList(fetcher, { initialSort, initialDir = 'asc', filters = {}, pageSize = 25 } = {}) {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pageCount: 1, pageSize });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(initialSort);
  const [dir, setDir] = useState(initialDir);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const filterKey = JSON.stringify(filters);

  // Only the newest request is allowed to write state, so a slow earlier
  // response can't overwrite a newer one.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const data = await fetcher({ search, sort, dir, page, pageSize, ...JSON.parse(filterKey) });
      if (id !== requestId.current) return;
      setRows(data.rows || []);
      setMeta({
        total: data.total ?? 0,
        page: data.page ?? 1,
        pageCount: data.pageCount ?? 1,
        pageSize: data.pageSize ?? pageSize,
      });
      setError(null);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err.message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
    // fetcher is redefined every render by callers, so it is deliberately not a
    // dependency; filterKey is a stable string standing in for the object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, sort, dir, page, pageSize, filterKey]);

  useEffect(() => {
    // Debounced so typing in the search box doesn't fire a request per keystroke.
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);

  // Any change to what is being filtered should land you back on page one,
  // otherwise you can end up on a page that no longer exists.
  useEffect(() => {
    setPage(1);
  }, [search, filterKey]);

  function toggleSort(key) {
    if (sort === key) {
      setDir(dir === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(key);
      setDir('asc');
    }
    setPage(1);
  }

  return {
    rows, meta, loading, error, setError,
    search, setSearch,
    // setSort/setDir are exposed so the assistant can drive sorting directly,
    // not just the column headers.
    sort, dir, toggleSort, setSort, setDir,
    page, setPage,
    reload: load,
  };
}
