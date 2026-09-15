import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, apiUrl } from '../api/client';
import { announceDataChanged } from '../hooks/useDataChanged';
import { hasOpenLayer } from '../hooks/useLayer';

const AssistantContext = createContext(null);
const STORAGE_KEY = 'docdesk.assistant.v1';

function load() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && Array.isArray(saved.entries) && Array.isArray(saved.history)) return saved;
  } catch {
    // Unreadable storage just means a fresh conversation.
  }
  return { entries: [], history: [], cards: {} };
}

let counter = 0;
const nextId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function AssistantProvider({ children }) {
  const initial = useMemo(load, []);
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState(initial.entries);
  const [cards, setCards] = useState(
    // A card left "confirming" by a reload never finished from this tab's view.
    Object.fromEntries(
      Object.entries(initial.cards || {}).map(([id, c]) => [id, c.state === 'confirming' ? { ...c, state: 'open' } : c])
    )
  );
  const [busy, setBusy] = useState(false);
  const [busySince, setBusySince] = useState(null);
  const [status, setStatus] = useState(null);

  const history = useRef(initial.history);
  const views = useRef(new Map());
  const pendingView = useRef(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    api.ai.status(true).then(setStatus).catch(() => setStatus({ configured: false, error: true }));
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ entries: entries.slice(-60), history: history.current, cards })
      );
    } catch {
      // Storage full or blocked: the conversation still works for this session.
    }
  }, [entries, cards]);

  // Ctrl/Cmd+K belongs to Spotlight, which hands sentences to the assistant.
  // Ctrl/Cmd+J opens the assistant directly; Escape closes it when nothing
  // (a dialog, a popover, Spotlight) is layered on top.
  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open && !hasOpenLayer()) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const registerView = useCallback((table, apply) => {
    views.current.set(table, apply);
    const waiting = pendingView.current;
    if (waiting && waiting.table === table) {
      pendingView.current = null;
      // Let the page finish its first render before changing its state.
      setTimeout(() => apply(waiting.view), 0);
    }
    return () => {
      if (views.current.get(table) === apply) views.current.delete(table);
    };
  }, []);

  const runActions = useCallback(
    (actions = []) => {
      for (const action of actions) {
        if (action.type === 'navigate') {
          if (pathRef.current !== action.path) navigate(action.path);
        } else if (action.type === 'view') {
          const apply = views.current.get(action.table);
          if (apply && pathRef.current === action.path) {
            apply(action.view);
          } else {
            pendingView.current = { table: action.table, view: action.view };
            navigate(action.path);
          }
        } else if (action.type === 'download') {
          const link = document.createElement('a');
          link.href = apiUrl(action.url);
          link.rel = 'noopener';
          link.download = '';
          document.body.appendChild(link);
          link.click();
          link.remove();
        } else if (action.type === 'refresh') {
          announceDataChanged(action.tables || []);
        }
      }
    },
    [navigate]
  );

  const absorb = useCallback(
    (response) => {
      history.current = response.messages || history.current;
      const pendingIds = (response.pending || []).map((p) => p.id);
      if (pendingIds.length) {
        setCards((current) => {
          const next = { ...current };
          for (const proposal of response.pending) next[proposal.id] = { ...proposal, state: 'open' };
          return next;
        });
      }
      setEntries((current) => [
        ...current,
        {
          id: nextId(),
          role: 'assistant',
          text: response.reply,
          blocks: response.blocks || [],
          activity: response.activity || [],
          pendingIds,
          model: response.model,
          at: Date.now(),
        },
      ]);
      runActions(response.actions);
    },
    [runActions]
  );

  const startBusy = () => {
    setBusy(true);
    setBusySince(Date.now());
  };
  const stopBusy = () => {
    setBusy(false);
    setBusySince(null);
  };

  const send = useCallback(
    async (text) => {
      const trimmed = String(text || '').trim();
      if (!trimmed || busy) return;
      setOpen(true);
      setEntries((current) => [...current, { id: nextId(), role: 'user', text: trimmed, at: Date.now() }]);
      startBusy();
      try {
        absorb(await api.assistant.message({ text: trimmed, messages: history.current, page: pathRef.current }));
      } catch (err) {
        setEntries((current) => [
          ...current,
          { id: nextId(), role: 'error', text: err.message, retry: trimmed, at: Date.now() },
        ]);
      } finally {
        stopBusy();
      }
    },
    [busy, absorb]
  );

  const confirm = useCallback(
    async (id) => {
      const card = cards[id];
      if (!card || card.state !== 'open' || busy) return;
      setCards((current) => ({ ...current, [id]: { ...current[id], state: 'confirming' } }));
      startBusy();
      const openIds = Object.values(cards).filter((c) => c.state === 'open' && c.id !== id).map((c) => c.id);
      try {
        const response = await api.assistant.confirm({ id, messages: history.current, page: pathRef.current, openIds });
        const ok = response.confirmed?.ok;
        setCards((current) => ({
          ...current,
          [id]: {
            ...current[id],
            state: ok ? 'done' : 'failed',
            result: ok ? response.confirmed.message : response.confirmed?.error,
          },
        }));
        absorb(response);
      } catch (err) {
        setCards((current) => ({ ...current, [id]: { ...current[id], state: 'failed', result: err.message } }));
      } finally {
        stopBusy();
      }
    },
    [cards, busy, absorb]
  );

  const cancel = useCallback(
    (id) => {
      const card = cards[id];
      if (!card || card.state !== 'open') return;
      api.assistant.cancel(id).catch(() => {});
      setCards((current) => ({ ...current, [id]: { ...current[id], state: 'cancelled' } }));
      // Tell the model, so a later "go ahead" isn't read as permission for this.
      history.current = [
        ...history.current,
        { role: 'user', content: `(System note: the user cancelled "${card.summary}". Do not do it.)` },
        { role: 'assistant', content: "Okay, I won't do that." },
      ];
    },
    [cards]
  );

  const reset = useCallback(() => {
    for (const card of Object.values(cards)) {
      if (card.state === 'open') api.assistant.cancel(card.id).catch(() => {});
    }
    history.current = [];
    setEntries([]);
    setCards({});
  }, [cards]);

  const value = {
    open, setOpen, entries, cards, busy, busySince, status,
    send, confirm, cancel, reset, registerView,
    openCount: Object.values(cards).filter((c) => c.state === 'open').length,
  };

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant() {
  const context = useContext(AssistantContext);
  if (!context) throw new Error('useAssistant must be used inside AssistantProvider');
  return context;
}
