import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fileContentUrl } from '../api/client';
import { useList } from '../hooks/useList';
import {
  PageHeader, ErrorNote, Table, Modal, Field, Badge, ConfirmButton,
  ExportButtons, SearchInput, Select, Pagination, formatBytes,
} from '../components/ui';

const KINDS = [
  ['image', 'Images'],
  ['pdf', 'PDFs'],
  ['document', 'Word & Excel'],
  ['data', 'Text & CSV'],
];

const PREVIEWABLE = /^(image\/|application\/pdf|text\/plain)/;

function kindLabel(mime) {
  if (mime.startsWith('image/')) return { tone: 'blue', label: 'Image' };
  if (mime === 'application/pdf') return { tone: 'red', label: 'PDF' };
  if (mime.includes('spreadsheet') || mime.includes('excel')) return { tone: 'green', label: 'Spreadsheet' };
  if (mime.includes('word') || mime.includes('document')) return { tone: 'blue', label: 'Document' };
  if (mime.includes('presentation') || mime.includes('powerpoint')) return { tone: 'amber', label: 'Slides' };
  if (mime === 'text/csv') return { tone: 'green', label: 'CSV' };
  if (mime.startsWith('text/') || mime === 'application/json') return { tone: 'slate', label: 'Text' };
  return { tone: 'slate', label: 'File' };
}

export default function FilesPage() {
  const [kind, setKind] = useState('');
  const [info, setInfo] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [editing, setEditing] = useState(null);

  const fetcher = useCallback((params) => api.files.list(params), []);
  const list = useList(fetcher, { initialSort: 'created_at', initialDir: 'desc', filters: { kind } });

  useEffect(() => {
    api.files.info().then(setInfo).catch(() => {});
  }, [list.meta.total]);

  async function upload(fileList, description) {
    if (!fileList?.length) return;
    setUploading(true);
    list.setError(null);
    try {
      const form = new FormData();
      for (const file of fileList) form.append('files', file);
      if (description) form.append('description', description);
      await api.files.upload(form);
      await list.reload();
    } catch (err) {
      list.setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function remove(id) {
    try {
      await api.files.remove(id);
      await list.reload();
    } catch (err) {
      list.setError(err.message);
    }
  }

  const columns = [
    {
      key: 'original_name',
      label: 'File',
      render: (f) => (
        <div>
          <div className="font-medium">{f.original_name}</div>
          {f.description && <div className="text-xs text-slate-500">{f.description}</div>}
        </div>
      ),
    },
    {
      key: 'mime_type',
      label: 'Type',
      render: (f) => {
        const { tone, label } = kindLabel(f.mime_type);
        return <Badge tone={tone}>{label}</Badge>;
      },
    },
    { key: 'size_bytes', label: 'Size', align: 'right', render: (f) => formatBytes(f.size_bytes) },
    {
      key: 'related_type',
      label: 'Attached to',
      render: (f) => (f.related_type ? `${f.related_type} #${f.related_id}` : '—'),
    },
    { key: 'created_at', label: 'Added', render: (f) => new Date(f.created_at).toLocaleDateString() },
    {
      key: 'actions',
      label: '',
      sortable: false,
      align: 'right',
      render: (f) => (
        <div className="flex justify-end gap-2">
          {PREVIEWABLE.test(f.mime_type) && (
            <button className="btn-edit" onClick={() => setPreview(f)}>View</button>
          )}
          <a className="btn-edit" href={fileContentUrl(f.id, { download: true })}>Download</a>
          <button className="btn-edit" onClick={() => setEditing(f)}>Rename</button>
          <ConfirmButton
            message={`Delete "${f.original_name}"? This removes the file from your computer too.`}
            onConfirm={() => remove(f.id)}
          >
            Delete
          </ConfirmButton>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Files" subtitle="Invoices, photos, delivery notes — anything worth keeping.">
        <ExportButtons table="files" params={{ search: list.search }} />
      </PageHeader>

      <ErrorNote error={list.error} onDismiss={() => list.setError(null)} />

      <DropZone onFiles={upload} uploading={uploading} info={info} />

      <div className="mb-4 mt-6 flex flex-wrap items-center gap-3">
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search files…" />
        <Select value={kind} onChange={setKind} options={KINDS} placeholder="All types" />
        {info && (
          <span className="text-sm text-slate-500">
            {info.count} files · {formatBytes(info.totalBytes)} stored
          </span>
        )}
        {list.loading && <span className="text-sm text-slate-400">Loading…</span>}
      </div>

      <Table
        columns={columns}
        rows={list.rows}
        sort={list.sort}
        dir={list.dir}
        onSort={list.toggleSort}
        empty={list.search || kind ? 'No files match that.' : 'No files yet. Drop one above to get started.'}
      />
      <Pagination meta={list.meta} page={list.page} onPage={list.setPage} loading={list.loading} />

      {preview && <PreviewModal file={preview} onClose={() => setPreview(null)} />}
      {editing && (
        <RenameModal
          file={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await list.reload();
          }}
          onError={list.setError}
        />
      )}
    </div>
  );
}

function DropZone({ onFiles, uploading, info }) {
  const [dragging, setDragging] = useState(false);
  const [description, setDescription] = useState('');
  const inputRef = useRef(null);

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    onFiles(Array.from(e.dataTransfer.files), description);
    setDescription('');
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
        dragging ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-white'
      }`}
    >
      <p className="text-lg font-medium">
        {uploading ? 'Uploading…' : 'Drop files here'}
      </p>
      <p className="mt-1 text-sm text-slate-500">
        or{' '}
        <button
          type="button"
          className="text-blue-600 underline"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          choose from your computer
        </button>
      </p>
      {info && (
        <p className="mt-2 text-xs text-slate-400">
          {info.allowed}. Up to {formatBytes(info.maxFileBytes)} each.
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files), description);
          setDescription('');
          // Reset so picking the same file twice in a row still fires onChange.
          e.target.value = '';
        }}
      />

      <input
        className="input-field mx-auto mt-4 max-w-sm"
        placeholder="Optional note about these files"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
    </div>
  );
}

function PreviewModal({ file, onClose }) {
  const url = fileContentUrl(file.id);
  const isImage = file.mime_type.startsWith('image/');

  return (
    <Modal title={file.original_name} onClose={onClose} wide>
      <div className="max-h-[65vh] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
        {isImage ? (
          <img src={url} alt={file.original_name} className="mx-auto max-h-[60vh]" />
        ) : (
          // Sandboxed: uploaded documents render with no script or same-origin
          // access, so nothing in a file can act on the app.
          <iframe
            src={url}
            title={file.original_name}
            sandbox=""
            className="h-[60vh] w-full rounded bg-white"
          />
        )}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-slate-500">
          {formatBytes(file.size_bytes)} · {file.mime_type}
        </span>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={onClose}>Close</button>
          <a className="btn-primary" href={fileContentUrl(file.id, { download: true })}>Download</a>
        </div>
      </div>
    </Modal>
  );
}

function RenameModal({ file, onClose, onSaved, onError }) {
  const [description, setDescription] = useState(file.description || '');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.files.update(file.id, { description });
      await onSaved();
    } catch (err) {
      onError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit note" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-500">{file.original_name}</p>
        <Field label="Note" hint="What this file is, so you can find it later">
          <textarea
            className="input-field"
            rows="3"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            autoFocus
          />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
