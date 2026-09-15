import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Columns3, Sigma, Table2, Type } from 'lucide-react';
import { FUNCTIONS, KEYWORDS, TOKEN_COLORS, aliasesIn, tokenize, wordAt } from './sql';
import { cn } from '../../lib/cn';

const FONT = "ui-monospace, 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace";
const LINE = 22;

/**
 * A code box for SQL: the text is a real <textarea> (so selection, undo and
 * IME all behave natively) laid exactly over a coloured copy of itself.
 * Suggests tables, columns (after "alias."), functions and keywords as you type.
 */
export default function SqlEditor({ value, onChange, onRun, schema, minRows = 8, disabled }) {
  const areaRef = useRef(null);
  const preRef = useRef(null);
  const gutterRef = useRef(null);
  const mirrorRef = useRef(null);
  const [suggest, setSuggest] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [focused, setFocused] = useState(false);

  const tokens = useMemo(() => tokenize(value), [value]);
  const lines = Math.max(value.split('\n').length, minRows);

  const tableNames = useMemo(() => new Set((schema?.tables || []).map((t) => t.name)), [schema]);

  function syncScroll() {
    const area = areaRef.current;
    if (!area) return;
    if (preRef.current) {
      preRef.current.scrollTop = area.scrollTop;
      preRef.current.scrollLeft = area.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = area.scrollTop;
  }

  function computeSuggestions(text, caret) {
    const at = wordAt(text, caret);
    if (!at || (!at.qualifier && at.word.length < 2)) return null;
    const prefix = at.word.toLowerCase();
    const items = [];
    if (at.qualifier) {
      const aliases = aliasesIn(text, tableNames);
      const table = aliases[at.qualifier.toLowerCase()] || (tableNames.has(at.qualifier.toLowerCase()) ? at.qualifier.toLowerCase() : null);
      const cols = schema?.tables?.find((t) => t.name === table)?.columns || [];
      for (const c of cols) if (c.name.startsWith(prefix)) items.push({ label: c.name, kind: 'column', detail: c.type });
    } else {
      for (const t of schema?.tables || []) if (t.name.startsWith(prefix)) items.push({ label: t.name, kind: 'table', detail: `${t.rows ?? ''} rows` });
      for (const v of schema?.views || []) if (v.name.startsWith(prefix)) items.push({ label: v.name, kind: 'table', detail: 'view' });
      // Columns of tables already named in the query.
      const aliases = aliasesIn(text, tableNames);
      const seen = new Set();
      for (const table of new Set(Object.values(aliases))) {
        for (const c of schema?.tables?.find((t) => t.name === table)?.columns || []) {
          if (c.name.startsWith(prefix) && !seen.has(c.name)) {
            seen.add(c.name);
            items.push({ label: c.name, kind: 'column', detail: table });
          }
        }
      }
      for (const f of FUNCTIONS) if (f.startsWith(prefix)) items.push({ label: f, kind: 'function', detail: 'function' });
      for (const k of KEYWORDS) if (k.startsWith(prefix) && k.length > prefix.length) items.push({ label: k.toUpperCase(), kind: 'keyword', detail: '' });
    }
    const exact = items.filter((i) => i.label.toLowerCase() !== prefix);
    if (!exact.length) return null;
    return { start: at.start, end: caret, items: exact.slice(0, 8) };
  }

  function update(text, caret) {
    onChange(text);
    const next = computeSuggestions(text, caret);
    setSuggest(next);
    setActiveIndex(0);
  }

  function accept(item) {
    if (!suggest) return;
    const area = areaRef.current;
    const insert = item.kind === 'function' ? `${item.label}(` : item.label;
    const text = value.slice(0, suggest.start) + insert + value.slice(suggest.end);
    const caret = suggest.start + insert.length;
    onChange(text);
    setSuggest(null);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(caret, caret);
    });
  }

  function onKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      setSuggest(null);
      const area = areaRef.current;
      const selected = area.selectionStart !== area.selectionEnd ? value.slice(area.selectionStart, area.selectionEnd) : null;
      onRun?.(selected);
      return;
    }
    if (suggest) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggest.items.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + suggest.items.length) % suggest.items.length);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        accept(suggest.items[activeIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setSuggest(null);
        return;
      }
    }
    if (e.key === 'Tab') {
      // Indent instead of leaving the box; Shift+Tab still moves focus out.
      if (e.shiftKey) return;
      e.preventDefault();
      const area = areaRef.current;
      const { selectionStart: s, selectionEnd: end } = area;
      const text = `${value.slice(0, s)}  ${value.slice(end)}`;
      onChange(text);
      requestAnimationFrame(() => area.setSelectionRange(s + 2, s + 2));
    }
  }

  // Where the caret is, for placing the suggestion list under it.
  const [caretPos, setCaretPos] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!suggest || !mirrorRef.current || !areaRef.current) return;
    const marker = mirrorRef.current.querySelector('[data-caret]');
    if (!marker) return;
    setCaretPos({ top: marker.offsetTop - areaRef.current.scrollTop + LINE + 4, left: Math.min(marker.offsetLeft - areaRef.current.scrollLeft, (areaRef.current.clientWidth || 400) - 260) });
  }, [suggest, value]);

  useEffect(() => {
    if (!focused) setSuggest(null);
  }, [focused]);

  const shared = 'm-0 whitespace-pre break-normal border-0 py-3 pl-3 pr-4 text-[13.5px]';
  const style = { fontFamily: FONT, lineHeight: `${LINE}px`, tabSize: 2 };
  const height = Math.min(Math.max(lines, minRows), 22) * LINE + 24;

  return (
    <div className={cn('relative overflow-hidden rounded-[18px] transition-shadow', focused ? 'shadow-[0_0_0_3px_var(--ring)]' : '')} style={{ background: 'rgb(var(--c-sunken))', boxShadow: focused ? '0 0 0 1px rgb(var(--c-accent)), 0 0 0 4px var(--ring)' : 'inset 0 0 0 1px var(--line)' }}>
      <div className="flex" style={{ height }}>
        <div ref={gutterRef} aria-hidden="true" className="select-none overflow-hidden py-3 pl-3 pr-2 text-right text-[12px] text-ink-3" style={{ ...style, minWidth: 40, borderRight: '1px solid var(--line)' }}>
          {Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <div className="relative min-w-0 flex-1">
          <pre ref={preRef} aria-hidden="true" className={cn(shared, 'pointer-events-none absolute inset-0 overflow-hidden')} style={style}>
            {tokens.map((t, i) => (
              <span key={i} style={{ color: TOKEN_COLORS[t.type], fontWeight: t.type === 'keyword' ? 600 : undefined, fontStyle: t.type === 'comment' ? 'italic' : undefined }}>{t.text}</span>
            ))}
            {'\n'}
          </pre>
          <pre ref={mirrorRef} aria-hidden="true" className={cn(shared, 'pointer-events-none invisible absolute inset-0 overflow-hidden')} style={style}>
            {suggest ? value.slice(0, suggest.end) : ''}
            <span data-caret="">&#8203;</span>
          </pre>
          <textarea
            ref={areaRef}
            value={value}
            disabled={disabled}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            aria-label="SQL query"
            data-lenis-prevent
            onChange={(e) => update(e.target.value, e.target.selectionStart)}
            onKeyDown={onKeyDown}
            onScroll={syncScroll}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 120)}
            onClick={() => setSuggest(null)}
            className={cn(shared, 'absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent text-transparent outline-none')}
            style={{ ...style, caretColor: 'rgb(var(--c-accent))', WebkitTextFillColor: 'transparent' }}
          />
          <AnimatePresence>
            {suggest && focused && (
              <motion.ul
                role="listbox"
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.1 } }}
                transition={{ type: 'spring', stiffness: 600, damping: 36 }}
                className="glass absolute z-20 w-[250px] overflow-hidden rounded-[14px] p-1"
                style={{ top: caretPos.top, left: Math.max(caretPos.left, 0), background: 'var(--glass-strong)', boxShadow: 'var(--shadow-lg)' }}
              >
                {suggest.items.map((item, i) => {
                  const Icon = item.kind === 'table' ? Table2 : item.kind === 'column' ? Columns3 : item.kind === 'function' ? Sigma : Type;
                  return (
                    <li
                      key={`${item.kind}-${item.label}`}
                      role="option"
                      aria-selected={i === activeIndex}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        accept(item);
                      }}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={cn('flex cursor-pointer items-center gap-2 rounded-[10px] px-2 py-1.5 text-[12.5px]', i === activeIndex ? 'bg-accent text-white' : 'text-ink')}
                      style={{ fontFamily: FONT }}
                    >
                      <Icon size={13} className={i === activeIndex ? 'text-white' : 'text-ink-3'} />
                      <span className="truncate">{item.label}</span>
                      <span className={cn('ml-auto truncate text-[11px]', i === activeIndex ? 'text-white/75' : 'text-ink-3')}>{item.detail}</span>
                    </li>
                  );
                })}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export { FONT as MONO_FONT };
