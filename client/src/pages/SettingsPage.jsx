import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bot, Building2, Check, CircleDot, Clock, Command, Database, ExternalLink, Globe2, HardDrive, Keyboard, Monitor, Moon,
  Palette, Receipt, RefreshCw, Save, Sparkles, Sun, Trash2, Wallet, Wand2,
} from 'lucide-react';
import { api } from '../api/client';
import { useSettings } from '../lib/settings';
import { useTheme } from '../hooks/useTheme';
import { Badge, Button, ConfirmButton, ErrorNote, Field, PageHeader, useToast } from '../components/ui';
import { Reveal } from '../components/motion/Reveal';
import { cn } from '../lib/cn';

const CURRENCIES = ['₹', '$', '€', '£', '¥', 'AED', 'Rs'];
const SECTIONS = [
  ['business', 'Business', Building2],
  ['money', 'Money & tax', Wallet],
  ['receipts', 'Receipts', Receipt],
  ['region', 'Region', Globe2],
  ['appearance', 'Appearance', Palette],
  ['assistant', 'Assistant', Bot],
  ['data', 'Data', Database],
  ['shortcuts', 'Shortcuts', Keyboard],
];

const ZONES = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC', 'Asia/Kolkata', 'Europe/London', 'America/New_York'];
  }
})();

export default function SettingsPage() {
  const { reload: reloadSettings } = useSettings();
  const [values, setValues] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.settings
      .get()
      .then((data) => {
        setValues(data.values);
        setSaved(data.values);
      })
      .catch((err) => setError(err.message));
  }, []);

  const dirty = values && saved && Object.keys(values).some((k) => String(values[k] ?? '') !== String(saved[k] ?? ''));
  const set = (key) => (value) => setValues((v) => ({ ...v, [key]: value }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.settings.update(values);
      setValues(result.values);
      setSaved(result.values);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1600);
      toast.success('Settings saved', { description: 'New receipts and reports use them straight away.' });
      reloadSettings();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Your business details, how DocDesk looks, and the data behind it." eyebrow="Preferences" icon={Wand2} />
      <ErrorNote error={error} onDismiss={() => setError(null)} />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="hidden lg:block" aria-label="Settings sections">
          <ul className="sticky top-24 space-y-0.5">
            {SECTIONS.map(([id, label, Icon]) => (
              <li key={id}>
                <a href={`#settings-${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className="flex items-center gap-2.5 rounded-[12px] px-3 py-2 text-[13.5px] text-ink-2 transition-colors hover:bg-[var(--wash)] hover:text-ink">
                  <Icon size={15} /> {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6 pb-24">
          {!values ? (
            Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton h-56 rounded-[24px]" />)
          ) : (
            <>
              <Group id="business" icon={Building2} title="Business" subtitle="Shown at the top of every receipt." tint="#0a84ff">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Business name"><input className="input-field" value={values.business_name} onChange={(e) => set('business_name')(e.target.value)} /></Field>
                  <Field label="Phone"><input className="input-field" value={values.business_phone} onChange={(e) => set('business_phone')(e.target.value)} /></Field>
                  <Field label="Email"><input className="input-field" type="email" value={values.business_email} onChange={(e) => set('business_email')(e.target.value)} /></Field>
                  <Field label="Address" className="sm:col-span-2"><textarea className="input-field" rows="2" value={values.business_address} onChange={(e) => set('business_address')(e.target.value)} /></Field>
                </div>
              </Group>

              <Group id="money" icon={Wallet} title="Money & tax" subtitle="How amounts are written and the tax new sales start with." tint="#30d158">
                <Field label="Currency symbol" hint="Left blank, amounts show as plain numbers">
                  <div className="flex flex-wrap items-center gap-2">
                    <input className="input-field w-24 text-center text-[16px] font-semibold" maxLength={8} value={values.currency_symbol} onChange={(e) => set('currency_symbol')(e.target.value)} />
                    {CURRENCIES.map((c) => (
                      <motion.button key={c} type="button" whileTap={{ scale: 0.9 }} onClick={() => set('currency_symbol')(c)} className={cn('h-9 min-w-9 rounded-full px-3 text-[14px] font-medium transition-colors', values.currency_symbol === c ? 'bg-accent text-white' : 'bg-[var(--wash-strong)] text-ink-2 hover:text-ink')}>
                        {c}
                      </motion.button>
                    ))}
                  </div>
                </Field>
                <Field label="Default tax" hint="Pre-filled on new sales - you can still change it per sale" className="mt-5">
                  <div className="flex items-center gap-4">
                    <input type="range" min="0" max="28" step="0.5" value={Number(values.default_tax_rate) || 0} onChange={(e) => set('default_tax_rate')(e.target.value)} className="h-1.5 flex-1 cursor-pointer accent-[rgb(var(--c-accent))]" aria-label="Default tax rate" />
                    <div className="relative w-24">
                      <input className="input-field pr-7 text-right tabular" type="number" min="0" max="100" step="0.01" value={values.default_tax_rate} onChange={(e) => set('default_tax_rate')(e.target.value)} />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">%</span>
                    </div>
                  </div>
                </Field>
                <TaxExample symbol={values.currency_symbol} rate={Number(values.default_tax_rate) || 0} />
              </Group>

              <Group id="receipts" icon={Receipt} title="Receipts" subtitle="A preview of how the top and bottom of a receipt will read." tint="#ff9f0a">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_260px]">
                  <Field label="Receipt footer" hint="A thank-you note, return policy, or opening hours">
                    <textarea className="input-field" rows="4" value={values.receipt_footer} onChange={(e) => set('receipt_footer')(e.target.value)} />
                  </Field>
                  <ReceiptPreview values={values} />
                </div>
              </Group>

              <Group id="region" icon={Globe2} title="Region" subtitle="Which clock decides where a day starts - for reports, receipts and 'today'." tint="#5e5ce6">
                <TimezoneField value={values.timezone} onChange={set('timezone')} />
              </Group>
            </>
          )}

          <AppearanceGroup />
          <AssistantGroup />
          <DataGroup />
          <ShortcutsGroup />
        </div>
      </div>

      {/* A floating save bar appears only when something has changed. */}
      <AnimatePresence>
        {dirty && (
          <motion.div
            initial={{ y: 80, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 80, opacity: 0, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="glass fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full py-2 pl-5 pr-2"
            style={{ background: 'var(--glass-strong)', boxShadow: 'var(--shadow-xl)' }}
          >
            <CircleDot size={14} className="text-warning" />
            <span className="whitespace-nowrap text-[13.5px] font-medium">Unsaved changes</span>
            <Button variant="ghost" size="sm" onClick={() => setValues(saved)}>Discard</Button>
            <Button size="sm" icon={Save} loading={busy} success={justSaved} onClick={save}>Save</Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Group({ id, icon: Icon, title, subtitle, tint, children, action }) {
  return (
    <Reveal>
      <section id={`settings-${id}`} className="card scroll-mt-24">
        <div className="mb-5 flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] text-white" style={{ background: `linear-gradient(145deg, ${tint}, ${tint}cc)`, boxShadow: `0 6px 16px -8px ${tint}` }}>
            <Icon size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold tracking-[-0.018em]">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13px] text-ink-2">{subtitle}</p>}
          </div>
          {action}
        </div>
        {children}
      </section>
    </Reveal>
  );
}

function TaxExample({ symbol, rate }) {
  const base = 1000;
  const tax = Math.round(base * rate) / 100;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[16px] px-4 py-3 text-[13px] text-ink-2" style={{ background: 'var(--wash)' }}>
      <Sparkles size={14} className="text-ink-3" />
      A {symbol}{base.toLocaleString()} sale becomes
      <motion.span key={`${symbol}${rate}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="font-semibold text-ink tabular">
        {symbol}{(base + tax).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </motion.span>
      with {rate}% tax.
    </div>
  );
}

function ReceiptPreview({ values }) {
  return (
    <div className="relative rotate-[1.2deg] rounded-[6px] px-5 pb-6 pt-5 font-mono text-[11.5px] leading-relaxed text-[#1d1d1f]" style={{ background: '#fffdf8', boxShadow: 'var(--shadow-lg)' }} aria-label="Receipt preview">
      <p className="text-center text-[13px] font-bold">{values.business_name || 'Your business'}</p>
      {values.business_address && <p className="whitespace-pre-line text-center text-[#6e6e73]">{values.business_address}</p>}
      {(values.business_phone || values.business_email) && <p className="text-center text-[#6e6e73]">{[values.business_phone, values.business_email].filter(Boolean).join(' · ')}</p>}
      <div className="my-3 border-t border-dashed border-[#c7c7cc]" />
      <div className="flex justify-between"><span>2 × Notebook</span><span>{values.currency_symbol}120.00</span></div>
      <div className="flex justify-between text-[#6e6e73]"><span>Tax {Number(values.default_tax_rate) || 0}%</span><span>{values.currency_symbol}{(1.2 * (Number(values.default_tax_rate) || 0)).toFixed(2)}</span></div>
      <div className="my-3 border-t border-dashed border-[#c7c7cc]" />
      <p className="whitespace-pre-line text-center text-[#6e6e73]">{values.receipt_footer || 'Thank you!'}</p>
    </div>
  );
}

function TimezoneField({ value, onChange }) {
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const zone = value || browserZone;
  const clock = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now);
    } catch {
      return null;
    }
  }, [zone, now]);

  return (
    <div className="grid grid-cols-1 items-end gap-5 sm:grid-cols-[1fr_auto]">
      <Field label="Business timezone" hint={value ? 'Reports count days in this zone' : `Blank uses each browser's own zone (${browserZone})`}>
        <input className="input-field" list="docdesk-zones" placeholder={browserZone} value={value} onChange={(e) => onChange(e.target.value)} />
        <datalist id="docdesk-zones">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
      </Field>
      <div className="flex items-center gap-3 rounded-[18px] px-4 py-3" style={{ background: 'var(--wash)' }}>
        <Clock size={18} className="text-ink-3" />
        <div>
          <p className="text-[18px] font-semibold tracking-[-0.02em] tabular">{clock || 'Unknown zone'}</p>
          <p className="text-[11.5px] text-ink-3">{zone}</p>
        </div>
        {!value && <Button variant="ghost" size="sm" onClick={() => onChange(browserZone)}>Use this</Button>}
      </div>
    </div>
  );
}

function AppearanceGroup() {
  const { mode, setMode } = useTheme();
  const options = [
    ['light', 'Light', Sun, 'linear-gradient(160deg,#ffffff,#eef0f4)'],
    ['dark', 'Dark', Moon, 'linear-gradient(160deg,#2c2c30,#0f0f11)'],
    ['system', 'Automatic', Monitor, 'linear-gradient(115deg,#ffffff 50%,#1c1c1f 50%)'],
  ];
  return (
    <Group id="appearance" icon={Palette} title="Appearance" subtitle="Saved in this browser. Automatic follows your computer's setting." tint="#bf5af2">
      <div className="grid grid-cols-3 gap-3 sm:max-w-lg">
        {options.map(([value, label, Icon, preview]) => {
          const active = mode === value;
          return (
            <button key={value} type="button" onClick={(e) => setMode(value, { x: e.clientX, y: e.clientY })} className="group text-left" aria-pressed={active}>
              <motion.div whileHover={{ y: -3 }} whileTap={{ scale: 0.96 }} className="relative mb-2 aspect-[4/3] overflow-hidden rounded-[16px]" style={{ background: preview, boxShadow: active ? '0 0 0 2.5px rgb(var(--c-accent)), var(--shadow-md)' : '0 0 0 1px var(--line), var(--shadow-sm)' }}>
                <div className="absolute left-2.5 top-2.5 h-[70%] w-[22%] rounded-[6px]" style={{ background: value === 'dark' ? 'rgb(255 255 255 / 0.08)' : 'rgb(0 0 0 / 0.05)' }} />
                <div className="absolute left-[34%] top-2.5 h-2 w-[40%] rounded-full" style={{ background: value === 'dark' ? 'rgb(255 255 255 / 0.2)' : 'rgb(0 0 0 / 0.12)' }} />
                <div className="absolute bottom-3 left-[34%] right-2.5 top-7 rounded-[6px]" style={{ background: value === 'dark' ? 'rgb(255 255 255 / 0.06)' : 'rgb(255 255 255 / 0.9)', boxShadow: '0 1px 3px rgb(0 0 0 / 0.1)' }} />
                <AnimatePresence>
                  {active && (
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute bottom-2 right-2 grid h-5 w-5 place-items-center rounded-full bg-accent text-white">
                      <Check size={12} strokeWidth={3} />
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.div>
              <span className={cn('flex items-center gap-1.5 text-[13px]', active ? 'font-semibold text-ink' : 'text-ink-2')}><Icon size={13} /> {label}</span>
            </button>
          );
        })}
      </div>
    </Group>
  );
}

function AssistantGroup() {
  const [status, setStatus] = useState(null);
  const [probing, setProbing] = useState(false);
  useEffect(() => {
    api.ai.status().then(setStatus).catch(() => setStatus({ configured: false }));
  }, []);

  async function probe() {
    setProbing(true);
    try {
      setStatus(await api.ai.status(true));
    } catch {
      setStatus((s) => ({ ...s, reachable: false }));
    } finally {
      setProbing(false);
    }
  }

  return (
    <Group
      id="assistant"
      icon={Bot}
      title="Assistant"
      subtitle="Ask DocDesk questions or have it make changes in plain English."
      tint="#ff375f"
      action={status?.configured && <Button variant="secondary" size="sm" icon={RefreshCw} loading={probing} onClick={probe}>Test</Button>}
    >
      {!status ? (
        <div className="skeleton h-16 rounded-[16px]" />
      ) : status.configured ? (
        <div className="flex flex-wrap items-center gap-4 rounded-[18px] px-4 py-3.5" style={{ background: 'var(--wash)' }}>
          <span className="ai-orb h-10 w-10 shrink-0 rounded-full" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold">{status.label || status.provider}</p>
            <p className="truncate text-[12.5px] text-ink-2">{status.model || 'Model chosen on first use'}</p>
          </div>
          {status.reachable === null ? <Badge tone="blue">Configured</Badge> : status.reachable ? <Badge tone="green" icon>Reachable</Badge> : <Badge tone="red" icon>Not reachable</Badge>}
        </div>
      ) : (
        <div className="rounded-[18px] px-4 py-4 text-[13.5px] leading-relaxed text-ink-2" style={{ background: 'var(--wash)' }}>
          <p className="mb-2 font-medium text-ink">No AI provider is connected.</p>
          Add a free key to <code className="kbd">server/.env</code> as <code className="kbd">{status.keyVar || 'GROQ_API_KEY'}</code> and restart the server. Everything else in DocDesk works without it.
          {status.providers?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {status.providers.map((p) => (
                <a key={p.name} href={p.console} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">{p.label} <ExternalLink size={12} /></a>
              ))}
            </div>
          )}
        </div>
      )}
    </Group>
  );
}

function DataGroup() {
  const [health, setHealth] = useState(null);
  const [stats, setStats] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const toast = useToast();

  const load = () => {
    api.health().then(setHealth).catch(() => {});
    api.stats().then(setStats).catch(() => {});
  };
  useEffect(load, []);

  const records = stats ? ['products', 'customers', 'suppliers', 'sales', 'purchase_orders', 'files'].reduce((sum, t) => sum + Number(stats.counts[t] || 0), 0) : 0;

  async function loadSample() {
    setSeeding(true);
    try {
      const result = await api.seed();
      const n = result.inserted || {};
      toast.success('Sample data loaded', { description: `${n.products ?? ''} products, ${n.sales ?? ''} sales and five months of history.` });
      load();
    } catch (err) {
      toast.error('Could not load sample data', { description: err.message });
    } finally {
      setSeeding(false);
    }
  }

  async function clearAll() {
    try {
      await api.clearSeed();
      toast.success('All records cleared', { description: 'A backup was not made automatically - take one from the Database page first next time.' });
      load();
    } catch (err) {
      toast.error('Could not clear', { description: err.message });
    }
  }

  const db = health?.database;
  return (
    <Group id="data" icon={Database} title="Data" subtitle="Where your records live and how to look after them." tint="#64d2ff">
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Engine', db ? (db.mode === 'embedded' ? 'Embedded' : 'Hosted') : '…', HardDrive],
          ['PostgreSQL', db?.version ? String(db.version).split(' ')[0] : '…', Database],
          ['Tables', db?.tables ?? '…', Command],
          ['Records', stats ? records.toLocaleString() : '…', Sparkles],
        ].map(([label, value, Icon]) => (
          <div key={label} className="rounded-[16px] px-4 py-3" style={{ background: 'var(--wash)' }}>
            <p className="flex items-center gap-1.5 text-[11.5px] text-ink-3"><Icon size={12} /> {label}</p>
            <p className="mt-0.5 truncate text-[16px] font-semibold tabular">{value}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/database" className="btn-primary"><Database size={15} /> Open database console</Link>
        <Link to="/database?tab=backups" className="btn-secondary">Backups & restore</Link>
        <span className="flex-1" />
        <Button variant="secondary" icon={Sparkles} loading={seeding} onClick={loadSample} disabled={records > 0} title={records > 0 ? 'Only on an empty database' : undefined}>Load sample data</Button>
        <ConfirmButton className="btn-danger" icon={Trash2} confirmLabel="Clear everything" message="Delete every product, sale, customer, supplier, order and file record? Settings stay. Take a backup first if in doubt." onConfirm={clearAll} disabled={records === 0}>
          Clear all records
        </ConfirmButton>
      </div>
    </Group>
  );
}

function ShortcutsGroup() {
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  const shortcuts = [
    [[mod, 'K'], 'Search everything and jump anywhere'],
    [['/'], 'Search, when not typing in a field'],
    [[mod, 'J'], 'Open the assistant'],
    [['Esc'], 'Close the top dialog or panel'],
    [['←', '→'], 'Move through a segmented control or chart'],
  ];
  return (
    <Group id="shortcuts" icon={Keyboard} title="Keyboard shortcuts" tint="#8e8e93">
      <ul className="divide-y divide-[var(--line)]">
        {shortcuts.map(([keys, label]) => (
          <li key={label} className="flex items-center justify-between gap-4 py-2.5 text-[13.5px]">
            <span className="text-ink-2">{label}</span>
            <span className="flex gap-1">{keys.map((k) => <kbd key={k} className="kbd">{k}</kbd>)}</span>
          </li>
        ))}
      </ul>
    </Group>
  );
}
