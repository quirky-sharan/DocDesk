import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight, Building2, CornerDownLeft, Database, FileSpreadsheet, Moon, Package, PackagePlus,
  Receipt, Search, Sun, Truck, Upload, UserPlus, Users,
} from 'lucide-react';
import { api, exportUrl } from '../../api/client';
import { NAV } from '../shell/Sidebar';
import { useAssistant } from '../../assistant/AssistantProvider';
import { useTheme } from '../../hooks/useTheme';
import { useEscapeLayer, useFocusTrap } from '../../hooks/useLayer';
import { useScrollLock } from '../shell/SmoothScroll';
import { useSettings } from '../../lib/settings';
import Spinner from '../ui/Spinner';
import Avatar from '../ui/Avatar';
import { cn } from '../../lib/cn';
import { spring, springSoft } from '../../lib/motion';

const PAGE_KEYWORDS = {
  '/': 'home overview today summary',
  '/reports': 'analytics charts revenue profit graphs',
  '/sales': 'receipts bills invoices orders sell',
  '/inventory': 'products stock items catalogue',
  '/orders': 'purchase orders restock deliveries incoming',
  '/customers': 'clients people buyers',
  '/suppliers': 'vendors wholesalers',
  '/files': 'documents uploads photos pdf',
  '/messages': 'alerts notifications email sms',
  '/database': 'tables sql schema backup query dbms',
  '/settings': 'business name tax currency receipt preferences',
};

const EXAMPLES = ['How are we doing today?', 'What needs reordering?', 'Show unpaid sales'];

function score(text, query) {
  const hay = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  if (hay.startsWith(q)) return 3;
  if (hay.split(/\s+/).some((w) => w.startsWith(q))) return 2;
  return hay.includes(q) ? 1 : 0;
}

export default function Spotlight({ initialQuery = '', onClose }) {
  const navigate = useNavigate();
  const assistant = useAssistant();
  const { isDark, setMode } = useTheme();
  const { money } = useSettings();
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const [records, setRecords] = useState({ loading: false, items: [] });

  useScrollLock(true);
  useEscapeLayer(onClose, true);
  useFocusTrap(panelRef, true);

  // Live record search, debounced; only the newest response is kept.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setRecords({ loading: false, items: [] });
      return undefined;
    }
    let cancelled = false;
    setRecords((r) => ({ ...r, loading: true }));
    const timer = setTimeout(async () => {
      // One request, ranked by trigram similarity in PostgreSQL - so "balpoint"
      // still finds "Ballpoint Pen" and the closest names come first.
      const found = await api.search(q, 4).then((d) => d.results || []).catch(() => []);
      if (cancelled) return;
      const of = (kind, max) => found.filter((r) => r.kind === kind).slice(0, max);
      setRecords({
        loading: false,
        items: [
          ...of('product', 4).map((p) => ({
            id: `product-${p.id}`, group: 'Products', label: p.title, icon: Package,
            meta: `${p.subtitle}${p.amount !== null ? ` · ${money(p.amount)}` : ''}`,
            run: () => navigate(`/inventory?view=${p.id}`),
          })),
          ...of('customer', 3).map((c) => ({
            id: `customer-${c.id}`, group: 'Customers', label: c.title, avatar: c.title,
            meta: c.subtitle || 'Customer',
            run: () => navigate(`/customers?history=${c.id}`),
          })),
          ...of('supplier', 2).map((s) => ({
            id: `supplier-${s.id}`, group: 'Suppliers', label: s.title, icon: Building2,
            meta: s.subtitle || 'Supplier',
            run: () => navigate(`/suppliers?search=${encodeURIComponent(s.title)}`),
          })),
          ...of('sale', 3).map((s) => ({
            id: `sale-${s.id}`, group: 'Sales', label: s.title, icon: Receipt,
            meta: `${s.subtitle} · ${money(s.amount)}`,
            run: () => navigate(`/sales?receipt=${s.id}`),
          })),
        ],
      });
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, navigate, money]);

  const items = useMemo(() => {
    const q = query.trim();
    const list = [];

    if (q) {
      list.push({
        id: 'ask', group: 'Ask DocDesk', label: `“${q}”`, orb: true, meta: 'Let the assistant do it or answer it',
        run: () => assistant.send(q),
      });
    }

    const pages = NAV.flatMap((g) => g.items)
      .map((item) => ({ item, s: score(`${item.name} ${PAGE_KEYWORDS[item.path] || ''}`, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, q ? 4 : 11)
      .map(({ item }) => ({
        id: `page-${item.path}`, group: 'Go to', label: item.name, icon: item.icon, hint: 'Page',
        run: () => navigate(item.path),
      }));

    const actions = [
      { id: 'new-sale', label: 'New sale', icon: Receipt, keywords: 'sell receipt bill checkout', run: () => navigate('/sales?new=1') },
      { id: 'add-product', label: 'Add a product', icon: PackagePlus, keywords: 'item stock create', run: () => navigate('/inventory?new=1') },
      { id: 'new-order', label: 'Order stock from a supplier', icon: Truck, keywords: 'purchase restock', run: () => navigate('/orders?new=1') },
      { id: 'add-customer', label: 'Add a customer', icon: UserPlus, keywords: 'client person create', run: () => navigate('/customers?new=1') },
      { id: 'add-supplier', label: 'Add a supplier', icon: Users, keywords: 'vendor create', run: () => navigate('/suppliers?new=1') },
      { id: 'upload', label: 'Upload files', icon: Upload, keywords: 'documents photos invoices', run: () => navigate('/files') },
      { id: 'export', label: 'Download inventory as Excel', icon: FileSpreadsheet, keywords: 'export xlsx spreadsheet', run: () => { window.location.href = exportUrl('products', 'xlsx'); } },
      { id: 'backup', label: 'Back up the database', icon: Database, keywords: 'backup dump restore sql', run: () => navigate('/database?tab=backups') },
      {
        id: 'theme', label: isDark ? 'Switch to light appearance' : 'Switch to dark appearance', icon: isDark ? Sun : Moon, keywords: 'theme dark light mode',
        run: () => setMode(isDark ? 'light' : 'dark'),
      },
    ]
      .map((a) => ({ a, s: score(`${a.label} ${a.keywords}`, q) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s)
      .slice(0, q ? 4 : 5)
      .map(({ a }) => ({ ...a, group: 'Actions' }));

    if (q) list.push(...records.items, ...actions, ...pages);
    else {
      list.push(...actions, ...pages);
      list.push(...EXAMPLES.map((text) => ({ id: `ex-${text}`, group: 'Try asking', label: text, orb: true, run: () => assistant.send(text) })));
    }
    return list;
  }, [query, records.items, assistant, navigate, isDark, setMode]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function run(item) {
    if (!item) return;
    onClose();
    // Let the palette start closing before the page underneath changes.
    requestAnimationFrame(() => item.run());
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(items[active]);
    }
  }

  let lastGroup = null;

  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-start justify-center px-3 pt-[12vh]">
      <motion.div
        className="absolute inset-0"
        style={{ background: 'rgb(0 0 0 / 0.22)', WebkitBackdropFilter: 'blur(4px)', backdropFilter: 'blur(4px)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onMouseDown={onClose}
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        initial={{ opacity: 0, scale: 0.96, y: -12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -8, transition: { duration: 0.15 } }}
        transition={springSoft}
        className="glass relative flex max-h-[72vh] w-full max-w-[660px] flex-col overflow-hidden rounded-[26px]"
        style={{ background: 'var(--glass-strong)' }}
      >
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
          <Search size={20} strokeWidth={2.1} className="shrink-0 text-ink-3" />
          <input
            ref={inputRef}
            data-autofocus
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search products, customers, pages - or ask anything"
            className="min-w-0 flex-1 bg-transparent text-[17px] tracking-[-0.015em] text-ink outline-none placeholder:text-ink-3"
            aria-label="Search or ask"
            aria-activedescendant={items[active] ? `spotlight-${items[active].id}` : undefined}
          />
          <AnimatePresence>{records.loading && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-ink-3"><Spinner size={16} /></motion.span>}</AnimatePresence>
          <span className="kbd">Esc</span>
        </div>

        <div ref={listRef} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2" data-lenis-prevent>
          {items.length === 0 && <p className="px-3 py-10 text-center text-[13.5px] text-ink-3">No matches.</p>}
          {items.map((item, index) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            const Icon = item.icon;
            const selected = index === active;
            return (
              <div key={item.id}>
                {header && <p className="px-3 pb-1.5 pt-3 text-[11.5px] font-medium text-ink-3 first:pt-1">{header}</p>}
                <button
                  id={`spotlight-${item.id}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-index={index}
                  onMouseMove={() => setActive(index)}
                  onClick={() => run(item)}
                  className="relative flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left"
                >
                  {selected && (
                    <motion.span layoutId="spotlight-active" className="absolute inset-0 rounded-[14px]" style={{ background: 'rgb(var(--c-accent) / 0.12)' }} transition={spring} />
                  )}
                  <span className="relative grid h-8 w-8 shrink-0 place-items-center">
                    {item.orb ? (
                      <span className="ai-orb h-7 w-7" />
                    ) : item.avatar ? (
                      <Avatar name={item.avatar} size={30} />
                    ) : (
                      <span className="grid h-8 w-8 place-items-center rounded-[10px]" style={{ background: selected ? 'rgb(var(--c-accent))' : 'var(--wash-strong)', color: selected ? '#fff' : 'rgb(var(--c-text-2))', transition: 'background-color 160ms, color 160ms' }}>
                        {Icon && <Icon size={16} strokeWidth={2} />}
                      </span>
                    )}
                  </span>
                  <span className="relative min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">{item.label}</span>
                    {item.meta && <span className="block truncate text-[12.5px] text-ink-3">{item.meta}</span>}
                  </span>
                  <span className="relative flex items-center gap-1.5 text-ink-3">
                    {item.hint && !selected && <span className="text-[12px]">{item.hint}</span>}
                    {selected && (item.orb ? <CornerDownLeft size={15} /> : <ArrowRight size={15} />)}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-2.5 text-[12px] text-ink-3" style={{ borderTop: '1px solid var(--line)' }}>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1"><span className="kbd">↑</span><span className="kbd">↓</span> move</span>
            <span className="flex items-center gap-1"><span className="kbd">↵</span> open</span>
          </span>
          <span className={cn('hidden items-center gap-1.5 sm:flex')}>
            <span className="ai-orb h-3.5 w-3.5" /> Type a sentence and press ↵ to ask DocDesk
          </span>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
