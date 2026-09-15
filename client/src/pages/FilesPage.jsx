import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Download, Eye, File as FileIcon, FileImage, FileSpreadsheet, FileText, FolderOpen, HardDrive, LayoutGrid, Pencil,
  Presentation, Rows3, Trash2, UploadCloud,
} from 'lucide-react';
import { api, fileContentUrl } from '../api/client';
import { useList } from '../hooks/useList';
import { useAssistantView } from '../assistant/useAssistantView';
import {
  Badge, Button, ConfirmButton, Empty, ErrorNote, ExportMenu, Field, Modal, PageHeader, Pagination, SearchInput,
  SegmentedControl, Table, useToast,
} from '../components/ui';
import { formatBytes, formatDate, formatRelative } from '../lib/format';
import { cn } from '../lib/cn';

const KINDS = [['', 'All'], ['image', 'Images'], ['pdf', 'PDFs'], ['document', 'Office'], ['data', 'Text & CSV']];
const PREVIEWABLE = /^(image\/(jpeg|png|gif|webp)|application\/pdf|text\/plain)/;

function kindOf(mime = '') {
  if (mime.startsWith('image/')) return { tone: 'blue', label: 'Image', icon: FileImage, hue: '#0a84ff' };
  if (mime === 'application/pdf') return { tone: 'red', label: 'PDF', icon: FileText, hue: '#ff453a' };
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv') return { tone: 'green', label: 'Spreadsheet', icon: FileSpreadsheet, hue: '#30d158' };
  if (mime.includes('presentation') || mime.includes('powerpoint')) return { tone: 'amber', label: 'Slides', icon: Presentation, hue: '#ff9f0a' };
  if (mime.includes('word') || mime.includes('document')) return { tone: 'blue', label: 'Document', icon: FileText, hue: '#5e5ce6' };
  return { tone: 'slate', label: 'File', icon: FileIcon, hue: '#8e8e93' };
}

export default function FilesPage() {
  const [kind, setKind] = useState('');
  const [info, setInfo] = useState(null);
  const [uploading, setUploading] = useState(null);
  const [preview, setPreview] = useState(null);
  const [editing, setEditing] = useState(null);
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem('docdesk.files.view') || 'grid';
    } catch {
      return 'grid';
    }
  });
  const toast = useToast();

  const fetcher = useCallback((p) => api.files.list(p), []);
  const list = useList(fetcher, { initialSort: 'created_at', initialDir: 'desc', filters: { kind }, pageSize: 24 });
  useAssistantView('files', list, { kind: setKind }, { defaultSort: 'created_at', defaultDir: 'desc' });

  useEffect(() => {
    api.files.info().then(setInfo).catch(() => {});
  }, [list.meta.total]);

  function changeView(next) {
    setView(next);
    try {
      localStorage.setItem('docdesk.files.view', next);
    } catch {
      // Optional.
    }
  }

  async function upload(fileList, description) {
    if (!fileList?.length) return;
    setUploading({ count: fileList.length });
    list.setError(null);
    try {
      const form = new FormData();
      for (const file of fileList) form.append('files', file);
      if (description) form.append('description', description);
      const result = await api.files.upload(form);
      toast.success(`${result.files.length} file${result.files.length === 1 ? '' : 's'} uploaded`, { description: result.files.map((f) => f.original_name).join(', ') });
      await list.reload();
    } catch (err) {
      list.setError(err.message);
    } finally {
      setUploading(null);
    }
  }

  async function remove(file) {
    try {
      await api.files.remove(file.id);
      toast.success('File deleted', { description: file.original_name });
      await list.reload();
    } catch (err) {
      list.setError(err.message);
    }
  }

  const actions = (f) => (
    <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
      {PREVIEWABLE.test(f.mime_type) && <button type="button" className="btn-edit btn-icon" onClick={() => setPreview(f)} aria-label="Preview"><Eye size={14} /></button>}
      <a className="btn-edit btn-icon" href={fileContentUrl(f.id, { download: true })} aria-label="Download"><Download size={14} /></a>
      <button type="button" className="btn-edit btn-icon" onClick={() => setEditing(f)} aria-label="Edit note"><Pencil size={14} /></button>
      <ConfirmButton className="btn-danger btn-icon" icon={Trash2} title="Delete" message={`Delete "${f.original_name}"? The file is removed from disk too.`} onConfirm={() => remove(f)} />
    </div>
  );

  const columns = [
    {
      key: 'original_name',
      label: 'File',
      render: (f) => {
        const k = kindOf(f.mime_type);
        const Icon = k.icon;
        return (
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-[12px]" style={{ background: `${k.hue}1f`, color: k.hue }}><Icon size={17} /></span>
            <div className="min-w-0">
              <p className="truncate font-medium">{f.original_name}</p>
              {f.description && <p className="truncate text-[12px] text-ink-3">{f.description}</p>}
            </div>
          </div>
        );
      },
    },
    { key: 'mime_type', label: 'Type', render: (f) => <Badge tone={kindOf(f.mime_type).tone}>{kindOf(f.mime_type).label}</Badge> },
    { key: 'size_bytes', label: 'Size', align: 'right', render: (f) => <span className="tabular text-ink-2">{formatBytes(f.size_bytes)}</span> },
    { key: 'created_at', label: 'Added', render: (f) => <span className="text-ink-2">{formatRelative(f.created_at)}</span> },
    { key: 'actions', label: '', sortable: false, align: 'right', render: actions },
  ];

  const usedPct = info ? Math.min((info.totalBytes / (1024 * 1024 * 1024)) * 100, 100) : 0;

  return (
    <div>
      <PageHeader title="Files" subtitle="Invoices, photos, delivery notes - anything worth keeping." eyebrow="Workspace" icon={FolderOpen}>
        <ExportMenu table="files" params={{ search: list.search, kind }} label="Export list" />
      </PageHeader>

      <ErrorNote error={list.error} onDismiss={() => list.setError(null)} />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
        <DropZone onFiles={upload} uploading={uploading} info={info} />
        {info && (
          <div className="panel flex flex-col justify-between p-5">
            <div className="flex items-center gap-2 text-[13px] font-medium text-ink-2"><HardDrive size={15} /> Storage</div>
            <div>
              <p className="text-[30px] font-semibold tracking-[-0.035em]">{formatBytes(info.totalBytes)}</p>
              <p className="text-[12.5px] text-ink-3">{info.count} file{info.count === 1 ? '' : 's'} · up to {formatBytes(info.maxFileBytes)} each</p>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--chart-track)' }}>
              <motion.div className="h-full rounded-full" style={{ background: 'var(--series-1)' }} initial={{ width: 0 }} animate={{ width: `${Math.max(usedPct, info.totalBytes ? 1.5 : 0)}%` }} transition={{ type: 'spring', stiffness: 80, damping: 18 }} />
            </div>
            <p className="mt-1.5 text-[11.5px] text-ink-3">of the first GB</p>
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search files and notes…" />
        <SegmentedControl size="sm" value={kind} onChange={setKind} options={KINDS} ariaLabel="File type" />
        <SegmentedControl size="sm" className="ml-auto" value={view} onChange={changeView} options={[['grid', 'Grid', LayoutGrid], ['list', 'List', Rows3]]} ariaLabel="View" />
      </div>

      {view === 'list' ? (
        <Table columns={columns} rows={list.rows} loading={list.loading} sort={list.sort} dir={list.dir} onSort={list.toggleSort} emptyIcon={FolderOpen} emptyTitle="No files" empty={list.search || kind ? 'Nothing matches that.' : 'Drop files above to keep them here.'} />
      ) : list.rows.length === 0 && !list.loading ? (
        <Empty icon={FolderOpen} title="No files" message={list.search || kind ? 'Nothing matches that.' : 'Drop files above to keep them here.'} />
      ) : (
        <motion.ul layout className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6" style={{ opacity: list.loading ? 0.55 : 1 }}>
          <AnimatePresence>
            {list.rows.map((f, i) => {
              const k = kindOf(f.mime_type);
              const Icon = k.icon;
              const isImage = /^image\/(jpeg|png|gif|webp)/.test(f.mime_type);
              return (
                <motion.li key={f.id} layout initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ delay: Math.min(i, 12) * 0.025, type: 'spring', stiffness: 300, damping: 26 }}>
                  <div className="group card-hover panel relative overflow-hidden">
                    <button type="button" className="block w-full" onClick={() => (PREVIEWABLE.test(f.mime_type) ? setPreview(f) : window.open(fileContentUrl(f.id, { download: true }), '_self'))}>
                      <div className="relative grid aspect-[4/3] place-items-center overflow-hidden" style={{ background: `linear-gradient(160deg, ${k.hue}22, ${k.hue}08)` }}>
                        {isImage ? (
                          <img src={fileContentUrl(f.id)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                        ) : (
                          <motion.span whileHover={{ rotate: -6, scale: 1.08 }} className="grid h-14 w-14 place-items-center rounded-2xl" style={{ background: 'rgb(var(--c-elevated))', color: k.hue, boxShadow: 'var(--shadow-md)' }}>
                            <Icon size={24} />
                          </motion.span>
                        )}
                      </div>
                    </button>
                    <div className="p-3">
                      <p className="truncate text-[13.5px] font-medium" title={f.original_name}>{f.original_name}</p>
                      <p className="truncate text-[12px] text-ink-3">{formatBytes(f.size_bytes)} · {formatDate(f.created_at, { day: 'numeric', month: 'short' })}</p>
                    </div>
                    <div className="absolute right-2 top-2 rounded-full opacity-0 transition-opacity group-hover:opacity-100" style={{ background: 'var(--glass-strong)', boxShadow: 'var(--shadow-md)' }}>{actions(f)}</div>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </motion.ul>
      )}
      <Pagination meta={list.meta} page={list.page} onPage={list.setPage} loading={list.loading} />

      <AnimatePresence>{preview && <PreviewModal key="preview" file={preview} onClose={() => setPreview(null)} />}</AnimatePresence>
      <AnimatePresence>
        {editing && <NoteModal key="note" file={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); toast.success('Note saved'); await list.reload(); }} />}
      </AnimatePresence>
    </div>
  );
}

function DropZone({ onFiles, uploading, info }) {
  const [dragging, setDragging] = useState(false);
  const [description, setDescription] = useState('');
  const inputRef = useRef(null);
  const depth = useRef(0);

  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); depth.current += 1; setDragging(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => { depth.current -= 1; if (depth.current <= 0) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); depth.current = 0; setDragging(false); onFiles(Array.from(e.dataTransfer.files), description); setDescription(''); }}
      className="relative overflow-hidden rounded-[24px] px-6 py-8 text-center transition-all duration-300"
      style={{
        background: dragging ? 'var(--accent-soft)' : 'rgb(var(--c-surface))',
        boxShadow: dragging ? '0 0 0 2px rgb(var(--c-accent)), var(--shadow-lg)' : '0 0 0 1px var(--line), var(--shadow-sm)',
        transform: dragging ? 'scale(1.005)' : 'none',
      }}
    >
      <motion.div animate={dragging ? { y: -8, scale: 1.1 } : uploading ? { y: [0, -6, 0] } : { y: 0, scale: 1 }} transition={uploading ? { repeat: Infinity, duration: 1.2 } : { type: 'spring', stiffness: 300, damping: 18 }} className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl" style={{ background: 'linear-gradient(145deg, #3aa0ff, #5e5ce6)', boxShadow: '0 10px 24px -8px rgb(10 132 255 / 0.6)' }}>
        <UploadCloud size={24} color="#fff" />
      </motion.div>
      <p className="text-[16px] font-semibold">{uploading ? `Uploading ${uploading.count} file${uploading.count === 1 ? '' : 's'}…` : dragging ? 'Drop to upload' : 'Drop files here'}</p>
      <p className="mt-1 text-[13px] text-ink-2">
        or <button type="button" className="font-medium text-accent-ink hover:underline" onClick={() => inputRef.current?.click()} disabled={Boolean(uploading)}>choose from your computer</button>
      </p>
      {info && <p className="mt-1 text-[12px] text-ink-3">{info.allowed}</p>}
      <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { onFiles(Array.from(e.target.files), description); setDescription(''); e.target.value = ''; }} />
      <input className="input-field mx-auto mt-4 max-w-sm rounded-full text-center" placeholder="Optional note for these files" value={description} onChange={(e) => setDescription(e.target.value)} />
    </div>
  );
}

function PreviewModal({ file, onClose }) {
  const url = fileContentUrl(file.id);
  const isImage = file.mime_type.startsWith('image/');
  return (
    <Modal title={file.original_name} subtitle={`${formatBytes(file.size_bytes)} · ${kindOf(file.mime_type).label}`} onClose={onClose} size="xl">
      <div className={cn('overflow-hidden rounded-2xl', !isImage && 'h-[65vh]')} style={{ background: 'var(--wash)' }}>
        {isImage ? (
          <motion.img initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} src={url} alt={file.original_name} className="mx-auto max-h-[68vh]" />
        ) : (
          // Sandboxed: uploaded documents render with no scripts and no access to the app.
          <iframe src={url} title={file.original_name} sandbox="" className="h-full w-full" />
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <a className="btn-primary" href={fileContentUrl(file.id, { download: true })}><Download size={15} /> Download</a>
      </div>
    </Modal>
  );
}

function NoteModal({ file, onClose, onSaved }) {
  const [description, setDescription] = useState(file.description || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.files.update(file.id, { description });
      await onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit note" subtitle={file.original_name} icon={Pencil} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote error={error} onDismiss={() => setError(null)} />
        <Field label="Note" hint="What this file is, so you can find it later"><textarea className="input-field" rows="3" value={description} onChange={(e) => setDescription(e.target.value)} autoFocus /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}
