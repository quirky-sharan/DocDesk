import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BookOpen, CircleHelp, Lock, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2,
} from 'lucide-react';
import { api } from '../api/client';
import {
  Badge, Button, Card, CardHeader, ConfirmButton, Empty, ErrorNote, Field,
  Modal, PageHeader, SearchInput, Spinner, useToast,
} from '../components/ui';
import { formatRelative } from '../lib/format';
import { cn } from '../lib/cn';
import { EASE_OUT } from '../lib/motion';
import brand from '@shared/brand.json';

/**
 * What the receptionist is allowed to say about the business.
 *
 * Two halves that matter. What is written down, and what somebody asked that
 * nothing here answered - because that second list is the whole improvement
 * loop. A question that came back "I'm not sure" is not a failure to hide; it
 * is a three-sentence note away from being answered forever.
 *
 * Generated notes are read-only on purpose. Editing one would appear to work
 * until the next rebuild overwrote it, which is worse than refusing: the change
 * would seem to stick and then quietly vanish.
 */

export default function KnowledgePage() {
  const [data, setData] = useState(null);
  const [gaps, setGaps] = useState([]);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [testing, setTesting] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [rebuilding, setRebuilding] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [list, gapList] = await Promise.all([api.knowledge.list(), api.knowledge.gaps(10)]);
      setData(list);
      setGaps(gapList.items || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rebuild = async () => {
    setRebuilding(true);
    try {
      await api.knowledge.rebuild();
      await load();
      toast.success('Rebuilt from your hours, services and settings');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRebuilding(false);
    }
  };

  const remove = async (document) => {
    try {
      await api.knowledge.remove(document.id);
      await load();
      toast.success(`"${document.title}" removed`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const test = async (event) => {
    event.preventDefault();
    if (!testing.trim()) return;
    try {
      setTestResult(await api.knowledge.search(testing.trim()));
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (!data && !error) return <div className="grid h-64 place-items-center"><Spinner /></div>;

  const written = data?.items?.filter((d) => !d.is_generated) || [];
  const generated = data?.items?.filter((d) => d.is_generated) || [];

  return (
    <>
      <PageHeader
        eyebrow={brand.receptionist}
        title="Knowledge"
        subtitle="What it may tell people about the business — and nothing beyond it."
        icon={BookOpen}
      >
        <Button variant="secondary" icon={RefreshCw} loading={rebuilding} onClick={rebuild}>Rebuild</Button>
        <Button icon={Plus} onClick={() => setEditing({ title: '', body: '' })}>Add a note</Button>
      </PageHeader>

      <ErrorNote error={error} onDismiss={() => setError(null)} />

      {gaps.length > 0 && (
        <Card className="mb-6 p-5">
          <CardHeader
            className="mb-4"
            icon={CircleHelp}
            title="Asked, and nobody could answer"
            subtitle="Each of these came back “I'm not sure”. A couple of sentences fixes one for good."
          />
          <div className="space-y-2">
            {gaps.map((gap) => (
              <div key={gap.question} className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-2" style={{ background: 'var(--wash)' }}>
                <p className="min-w-0 flex-1 truncate text-[13.5px]">{gap.question}</p>
                {gap.times > 1 && <Badge tone="amber">{gap.times}×</Badge>}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setEditing({ title: gap.question.replace(/^\w/, (c) => c.toUpperCase()), body: '' })}
                >
                  Answer this
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="mb-6 p-5">
        <CardHeader
          className="mb-4"
          icon={Search}
          title="Try a question"
          subtitle="Exactly what the receptionist would find, and whether that is enough for it to answer."
        />
        <form onSubmit={test} className="flex flex-wrap items-center gap-2">
          <SearchInput value={testing} onChange={setTesting} placeholder="e.g. do you do home visits" />
          <Button type="submit" variant="secondary">Look it up</Button>
        </form>

        <AnimatePresence>
          {testResult && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
              className="overflow-hidden"
            >
              <div className="mt-4">
                {testResult.supported ? (
                  <>
                    <Badge tone="green" icon><Sparkles size={12} aria-hidden="true" /> It would answer</Badge>
                    <div className="mt-3 space-y-2">
                      {testResult.chunks.slice(0, 2).map((chunk) => (
                        <p key={chunk.chunk_id} className="rounded-xl px-3 py-2 text-[13px] leading-relaxed" style={{ background: 'var(--wash)' }}>
                          <span className="font-medium">{chunk.title}: </span>{chunk.content}
                        </p>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <Badge tone="amber">It would say it is not sure</Badge>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
                      {testResult.reason}. It would offer to take a message rather than guess.
                    </p>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      <section className="mb-6">
        <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.01em]">Written by you</h2>
        {!written.length ? (
          <Empty
            icon={BookOpen}
            compact
            title="Nothing written yet"
            message="Add what customers ask about: parking, payment, policies, anything the hours and service list do not already cover."
            action={<Button icon={Plus} onClick={() => setEditing({ title: '', body: '' })}>Add a note</Button>}
          />
        ) : (
          <div className="space-y-2.5">
            {written.map((document) => (
              <DocumentRow key={document.id} document={document} onEdit={() => setEditing(document)} onRemove={() => remove(document)} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-[15px] font-semibold tracking-[-0.01em]">Kept up to date for you</h2>
        <p className="mb-3 text-[13px] text-ink-2">
          Built from your opening hours, services and business details. Change those and these follow.
        </p>
        <div className="space-y-2.5">
          {generated.map((document) => (
            <DocumentRow key={document.id} document={document} readOnly />
          ))}
        </div>
      </section>

      {editing && (
        <EditModal
          document={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}

function DocumentRow({ document, onEdit, onRemove, readOnly }) {
  return (
    <div className="card flex flex-wrap items-center gap-4 p-4">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-[14.5px] font-semibold">
          {readOnly && <Lock size={13} className="shrink-0 text-ink-3" aria-hidden="true" />}
          {document.title}
        </p>
        <p className="text-[12.5px] text-ink-3">
          {document.chunks} {document.chunks === 1 ? 'passage' : 'passages'}
          {document.updated_at ? ` · updated ${formatRelative(document.updated_at)}` : ''}
        </p>
      </div>
      {!readOnly && (
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="secondary" icon={Pencil} onClick={onEdit}>Edit</Button>
          <ConfirmButton
            icon={Trash2}
            className="btn-danger btn-sm"
            title={`Remove "${document.title}"?`}
            message="The receptionist will stop using it."
            confirmLabel="Remove"
            onConfirm={onRemove}
          />
        </div>
      )}
    </div>
  );
}

function EditModal({ document, onClose, onSaved }) {
  const [title, setTitle] = useState(document.title || '');
  const [body, setBody] = useState(document.body || '');
  const [loading, setLoading] = useState(Boolean(document.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const toast = useToast();

  useEffect(() => {
    if (!document.id) return;
    api.knowledge
      .get(document.id)
      .then((full) => { setTitle(full.title); setBody(full.body); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [document.id]);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (document.id) await api.knowledge.update(document.id, { title, body });
      else await api.knowledge.create({ title, body });
      toast.success(document.id ? 'Saved' : 'Added');
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={document.id ? 'Edit a note' : 'Add a note'}
      subtitle="Write it the way you would say it out loud"
      icon={document.id ? Pencil : Plus}
      onClose={onClose}
      size="lg"
    >
      {loading ? (
        <div className="grid h-40 place-items-center"><Spinner /></div>
      ) : (
        <form onSubmit={save} className="space-y-4">
          <ErrorNote error={error} onDismiss={() => setError(null)} />
          <Field label="What it is about">
            <input className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required placeholder="Parking" />
          </Field>
          <Field
            label="What to say"
            hint="Leave a blank line between separate facts — each one is looked up on its own."
          >
            <textarea
              className="input-field"
              rows="9"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              placeholder={'There is free parking behind the building, with space for about six cars.\n\nThe entrance is on the left, past the pharmacy.'}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={saving}>{document.id ? 'Save' : 'Add it'}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
