import { useState } from 'react';
import Navbar from '../components/Navbar';
import {
  useGetMedications,
  useCreateMedication,
  useUpdateMedication,
  useDeleteMedication,
} from '../queries/useMedications';

const EMPTY = {
  name: '', dosage_form: '', unit: '',
  stock_quantity: '', price_per_unit: '', description: '',
};

export default function MedicationsPage() {
  const [search, setSearch] = useState('');
  const [modal, setModal]   = useState(null);
  const [form, setForm]     = useState(EMPTY);

  const { data: meds = [], isLoading } = useGetMedications(search);
  const create = useCreateMedication();
  const update = useUpdateMedication();
  const remove = useDeleteMedication();

  function openAdd()   { setForm(EMPTY); setModal('add'); }
  function openEdit(m) { setForm(m);     setModal(m); }
  function closeModal(){ setModal(null); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (modal === 'add') await create.mutateAsync(form);
    else await update.mutateAsync({ ...form, id: modal.id });
    closeModal();
  }

  return (
    <div>
      <Navbar title="Medications" />

      <div className="flex items-center justify-between mb-4">
        <input
          type="text"
          placeholder="Search medications…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={openAdd}
          className="bg-blue-700 text-white px-4 py-2 rounded-lg hover:bg-blue-800"
        >
          + Add Medication
        </button>
      </div>

      {isLoading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="overflow-x-auto bg-white rounded-xl shadow">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-gray-600 uppercase text-xs">
              <tr>
                {['ID','Name','Form','Unit','Stock','Price/Unit','Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {meds.map(m => (
                <tr key={m.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3">{m.id}</td>
                  <td className="px-4 py-3 font-medium">{m.name}</td>
                  <td className="px-4 py-3">{m.dosage_form || '—'}</td>
                  <td className="px-4 py-3">{m.unit || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={Number(m.stock_quantity) < 10 ? 'text-red-500 font-semibold' : ''}>
                      {m.stock_quantity}
                    </span>
                  </td>
                  <td className="px-4 py-3">₹{Number(m.price_per_unit).toFixed(2)}</td>
                  <td className="px-4 py-3 space-x-2">
                    <button onClick={() => openEdit(m)} className="text-blue-600 hover:underline">Edit</button>
                    <button onClick={() => remove.mutate(m.id)} className="text-red-500 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
              {!meds.length && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No medications found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">{modal === 'add' ? 'Add Medication' : 'Edit Medication'}</h2>
            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
              {[
                ['name','Name',true], ['dosage_form','Dosage Form'],
                ['unit','Unit'], ['stock_quantity','Stock Qty',false,'number'],
                ['price_per_unit','Price / Unit (₹)',false,'number'],
              ].map(([key, label, req, type]) => (
                <div key={key}>
                  <label className="text-xs text-gray-600 mb-1 block">{label}{req && ' *'}</label>
                  <input
                    required={!!req} type={type || 'text'}
                    value={form[key] || ''}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              ))}
              <div className="col-span-2">
                <label className="text-xs text-gray-600 mb-1 block">Description</label>
                <textarea rows={2} value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div className="col-span-2 flex justify-end gap-2 mt-2">
                <button type="button" onClick={closeModal} className="px-4 py-2 text-sm rounded-lg border">Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm rounded-lg bg-blue-700 text-white hover:bg-blue-800">
                  {modal === 'add' ? 'Create' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
