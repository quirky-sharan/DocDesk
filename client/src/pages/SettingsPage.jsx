import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, ErrorNote, Field } from '../components/ui';

const HINTS = {
  business_name: 'Shown at the top of every receipt',
  business_address: 'Printed under the name on receipts',
  currency_symbol: 'Left blank, amounts show as plain numbers',
  default_tax_rate: 'Pre-filled on new sales — you can still change it per sale',
  receipt_footer: 'A thank-you note, return policy, or opening hours',
};

const MULTILINE = ['business_address', 'receipt_footer'];

export default function SettingsPage() {
  const [fields, setFields] = useState([]);
  const [values, setValues] = useState({});
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.settings
      .get()
      .then((data) => {
        setFields(data.fields);
        setValues(data.values);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const result = await api.settings.update(values);
      setValues(result.values);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">Loading…</p>;

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" subtitle="Your business details, used on receipts." />

      <ErrorNote error={error} onDismiss={() => setError(null)} />
      {saved && (
        <div className="mb-4 rounded-lg border border-success bg-success-soft p-4 text-sm text-success">
          Saved. New receipts will use these details.
        </div>
      )}

      <form onSubmit={submit} className="card space-y-4">
        {fields.map((field) => (
          <Field key={field.key} label={field.label} hint={HINTS[field.key]}>
            {MULTILINE.includes(field.key) ? (
              <textarea
                className="input-field"
                rows="2"
                value={values[field.key] ?? ''}
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
              />
            ) : (
              <input
                className="input-field"
                type={field.key === 'default_tax_rate' ? 'number' : 'text'}
                step={field.key === 'default_tax_rate' ? '0.01' : undefined}
                min={field.key === 'default_tax_rate' ? '0' : undefined}
                max={field.key === 'default_tax_rate' ? '100' : undefined}
                value={values[field.key] ?? ''}
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
              />
            )}
          </Field>
        ))}

        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
