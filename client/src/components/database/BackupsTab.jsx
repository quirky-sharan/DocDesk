import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Archive, ArchiveRestore, CalendarClock, Download, FileCode2, FileUp, FolderOpen, HardDrive, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { api, backupDownloadUrl, sqlExportUrl } from '../../api/client';
import { Badge, Button, Card, CardHeader, ConfirmButton, Empty, ErrorNote, Modal, useToast } from '../ui';
import { Reveal } from '../motion/Reveal';
import { announceDataChanged } from '../../hooks/useDataChanged';
import { formatBytes, formatDateTime, formatRelative } from '../../lib/format';
import { cn } from '../../lib/cn';

const KIND = {
  manual: { label: 'Manual', tone: 'blue' },
  automatic: { label: 'Daily', tone: 'violet' },
  'before-restore': { label: 'Before restore', tone: 'amber' },
};

export default function BackupsTab({ capabilities, onRestored }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState(null);
  const [restoring, setRestoring] = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);
  const toast = useToast();
  const admin = capabilities?.admin ?? data?.admin;

  const load = useCallback(() => {
    api.db.backups().then((d) => { setData(d); setError(null); }).catch((err) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  async function create() {
    setCreating(true);
    try {
      const backup = await api.db.createBackup();
      setFresh(backup.name);
      toast.success('Backup saved', { description: `${backup.name} · ${formatBytes(backup.sizeBytes)}` });
      load();
      setTimeout(() => setFresh(null), 2400);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function remove(name) {
    try {
      await api.db.deleteBackup(name);
      toast.success('Backup deleted', { description: name });
      load();
    } catch (err) {
      toast.error('Could not delete', { description: err.message });
    }
  }

  const backups = data?.backups || [];
  const latest = backups[0];
  const total = backups.reduce((s, b) => s + b.sizeBytes, 0);

  return (
    <div className="space-y-6">
      <ErrorNote error={error} onDismiss={() => setError(null)} />

      <Reveal>
        <section className="relative overflow-hidden rounded-[28px] p-7 sm:p-9" style={{ background: 'radial-gradient(80% 120% at 100% 0%, rgb(48 209 88 / 0.12), transparent 60%), rgb(var(--c-surface))', boxShadow: '0 0 0 1px var(--line), var(--shadow-md), var(--edge-highlight)' }}>
          <div className="flex flex-wrap items-center gap-8">
            <VaultIcon busy={creating} done={Boolean(fresh)} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink-2">Backups</p>
              <h2 className="mt-1 text-[30px] font-semibold leading-tight tracking-[-0.035em] sm:text-[36px]">
                {latest ? `Last saved ${formatRelative(latest.createdAt)}` : 'No backups yet'}
              </h2>
              <p className="mt-2 max-w-xl text-[14.5px] leading-relaxed text-ink-2">
                A backup is one compressed file with every record in every table. {capabilities?.mode === 'embedded' ? 'One is also made automatically each day, and the last 14 are kept.' : 'On a hosted database, your provider also keeps its own backups.'}
              </p>
              <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-3">
                <span className="flex items-center gap-1.5"><Archive size={13} /> {backups.length} saved · {formatBytes(total)}</span>
                {data?.directory && <span className="flex min-w-0 items-center gap-1.5"><FolderOpen size={13} className="shrink-0" /> <span className="truncate">{data.directory}</span></span>}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button icon={Archive} loading={creating} success={Boolean(fresh)} onClick={create}>Back up now</Button>
              <a className="btn-secondary" href={sqlExportUrl()}><FileCode2 size={15} /> Export as SQL</a>
            </div>
          </div>
        </section>
      </Reveal>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Reveal>
          <Card padded={false} className="h-full overflow-hidden">
            <div className="px-5 pt-5"><CardHeader title="Saved backups" subtitle="Newest first. Download one to keep a copy somewhere safe." icon={HardDrive} /></div>
            {!data ? (
              <div className="space-y-2 p-5">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-14 rounded-[14px]" />)}</div>
            ) : backups.length === 0 ? (
              <div className="p-5"><Empty compact icon={Archive} title="Nothing saved yet" message="Press Back up now to make the first one." /></div>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                <AnimatePresence initial={false}>
                  {backups.map((b) => {
                    const kind = KIND[b.kind] || { label: b.kind, tone: 'slate' };
                    return (
                      <motion.li key={b.name} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto', backgroundColor: fresh === b.name ? 'var(--success-soft)' : 'rgba(0,0,0,0)' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                        <div className="flex flex-wrap items-center gap-3 px-5 py-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px]" style={{ background: 'var(--wash-strong)' }}><Archive size={16} className="text-ink-2" /></span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13.5px] font-medium">{formatDateTime(b.createdAt)}</p>
                            <p className="truncate text-[11.5px] text-ink-3" title={b.name}>{b.name}</p>
                          </div>
                          <Badge tone={kind.tone}>{kind.label}</Badge>
                          <span className="w-16 text-right text-[12px] text-ink-2 tabular">{formatBytes(b.sizeBytes)}</span>
                          <div className="flex gap-1">
                            <a className="btn-edit btn-icon" href={backupDownloadUrl(b.name)} aria-label="Download" title="Download"><Download size={15} /></a>
                            {admin && <button type="button" className="btn-edit btn-icon" onClick={() => setRestoring({ name: b.name, createdAt: b.createdAt })} aria-label="Restore" title="Restore"><ArchiveRestore size={15} /></button>}
                            {admin && <ConfirmButton className="btn-danger btn-icon" icon={Trash2} title="Delete" message="Delete this backup file? The data in the database is not affected." onConfirm={() => remove(b.name)} />}
                          </div>
                        </div>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            )}
          </Card>
        </Reveal>

        <Reveal delay={0.05}>
          <Card className="h-full">
            <CardHeader title="Restore from a file" subtitle="Bring back a backup downloaded earlier, from this or another DocDesk." icon={FileUp} />
            {admin ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files[0]; if (file) setRestoring({ file }); }}
                className={cn('flex flex-col items-center rounded-[20px] px-5 py-9 text-center transition-all', dragging && 'scale-[1.01]')}
                style={{ background: dragging ? 'var(--accent-soft)' : 'var(--wash)', boxShadow: dragging ? 'inset 0 0 0 2px rgb(var(--c-accent))' : 'inset 0 0 0 1.5px var(--line)' }}
              >
                <motion.div animate={dragging ? { y: -6, scale: 1.08 } : { y: 0, scale: 1 }} className="mb-3 grid h-12 w-12 place-items-center rounded-2xl" style={{ background: 'rgb(var(--c-elevated))', boxShadow: 'var(--shadow-md)' }}>
                  <FileUp size={20} className="text-accent-ink" />
                </motion.div>
                <p className="text-[14px] font-medium">{dragging ? 'Drop to restore' : 'Drop a .json.gz backup here'}</p>
                <button type="button" className="mt-1 text-[13px] text-accent-ink hover:underline" onClick={() => fileInput.current?.click()}>or choose a file</button>
                <input ref={fileInput} type="file" accept=".gz,.json,application/gzip,application/json" className="hidden" onChange={(e) => { const file = e.target.files[0]; if (file) setRestoring({ file }); e.target.value = ''; }} />
              </div>
            ) : (
              <p className="rounded-[16px] px-4 py-4 text-[13px] text-ink-2" style={{ background: 'var(--wash)' }}>Restoring is switched off for this installation. Set <code className="kbd">DB_ADMIN=on</code> on the server to allow it.</p>
            )}
            <ul className="mt-5 space-y-2.5 text-[12.5px] text-ink-2">
              <li className="flex gap-2"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-success" /> A safety backup of the current data is made first, automatically.</li>
              <li className="flex gap-2"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-success" /> It runs as one transaction - if anything fails, nothing changes.</li>
              <li className="flex gap-2"><CalendarClock size={14} className="mt-0.5 shrink-0 text-ink-3" /> Backups from an older DocDesk restore fine; a newer one is refused.</li>
            </ul>
          </Card>
        </Reveal>
      </div>

      <AnimatePresence>
        {restoring && (
          <RestoreModal
            key="restore"
            target={restoring}
            onClose={() => setRestoring(null)}
            onDone={(result) => {
              setRestoring(null);
              const rows = Object.values(result.restored || {}).reduce((s, n) => s + n, 0);
              toast.success('Restore complete', { description: `${rows.toLocaleString()} rows restored in ${result.durationMs} ms. Safety copy: ${result.safetyBackup}` });
              load();
              onRestored?.();
              // Every page's data just changed underneath it.
              announceDataChanged();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function VaultIcon({ busy, done }) {
  return (
    <div className="relative grid h-[120px] w-[120px] shrink-0 place-items-center">
      <motion.div
        className="absolute inset-0 rounded-[32px]"
        style={{ background: 'linear-gradient(145deg, #34c759, #0a84ff)', boxShadow: '0 20px 40px -18px rgb(10 132 255 / 0.6)' }}
        animate={busy ? { rotate: [0, 4, -4, 0] } : done ? { scale: [1, 1.08, 1] } : { rotate: 0, scale: 1 }}
        transition={busy ? { repeat: Infinity, duration: 0.6 } : { type: 'spring', stiffness: 300, damping: 12 }}
      />
      <AnimatePresence mode="wait">
        {busy ? (
          <motion.div key="busy" initial={{ y: -40, opacity: 0 }} animate={{ y: [-40, 0], opacity: [0, 1] }} transition={{ repeat: Infinity, duration: 0.8 }} className="relative">
            <FileCode2 size={30} color="#fff" />
          </motion.div>
        ) : (
          <motion.div key="idle" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative">
            {done ? <ShieldCheck size={46} color="#fff" /> : <Archive size={44} color="#fff" strokeWidth={1.6} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RestoreModal({ target, onClose, onDone }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ready = typed.trim().toUpperCase() === 'RESTORE';

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = target.file ? await api.db.restoreFile(target.file) : await api.db.restoreSaved(target.name);
      onDone(result);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Restore this backup?" subtitle={target.file ? `${target.file.name} · ${formatBytes(target.file.size)}` : `Saved ${formatDateTime(target.createdAt)}`} icon={ArchiveRestore} onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex gap-3 rounded-[16px] p-4" style={{ background: 'var(--danger-soft)' }}>
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-[13.5px] leading-relaxed">
            Every product, sale, customer, supplier, order, payment and file record is <b>replaced</b> with the backup&apos;s. Anything entered since it was made is lost - except in the safety backup made just before.
          </p>
        </div>
        <ErrorNote error={error} onDismiss={() => setError(null)} />
        <label className="block text-[13px] text-ink-2">
          Type <b className="font-semibold text-ink">RESTORE</b> to confirm
          <input className="input-field mt-1.5 font-semibold tracking-[0.2em]" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus disabled={busy} autoComplete="off" />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="danger" icon={ArchiveRestore} loading={busy} disabled={!ready}>Restore</Button>
        </div>
      </form>
    </Modal>
  );
}
