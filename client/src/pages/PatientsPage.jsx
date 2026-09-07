import { useState } from 'react';
import Navbar from '../components/Navbar';
import {
  useGetPatients,
  useCreatePatient,
  useUpdatePatient,
  useDeletePatient,
} from '../queries/usePatients';

const EMPTY = {
  owner_name: '', pet_name: '', species: '', breed: '',
  age: '', gender: '', phone: '', email: '', address: '', notes: '',
};

export default function PatientsPage() {
  const [search, setSearch]   = useState('');
  const [modal, setModal]     = useState(null);   // null | 'add' | patient object (edit)
  const [form, setForm]       = useState(EMPTY);

  const { data: patients = [], isLoading } = useGetPatients(search);
  const create  = useCreatePatient();
  const update  = useUpdatePatient();
  const remove  = useDeletePatient();

  function openAdd()  { setForm(EMPTY); setModal('add'); }
  function openEdit(p){ setForm(p);     setModal(p); }
  function closeModal(){ setModal(null); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (modal === 'add') await create.mutateAsync(form);
    else await update.mutateAsync({ ...form, id: modal.id });
    closeModal();
  }

  async function handleDelete(id) {
    if (!confirm('Delete this patient?')) return;
    await remove.mutateAsync(id);
  }

  return (
    <div>
      <Navbar title="Patients" />

      <div className="flex items-center justify-between mb-4">
        <input
          type="text"
          placeholder="Search by name or phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 w-72 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={openAdd}
          className="bg-blue-700 text-white px-4 py-2 rounded-lg hover:bg-blue-800"
        >
          + Add Patient
        </button>
      </div>

      {isLoading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="overflow-x-auto bg-white rounded-xl shadow">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-gray-600 uppercase text-xs">
              <tr>
                {['ID','Pet Name','Owner','Species','Phone','Email','Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {patients.map(p => (
                <tr key={p.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3">{p.id}</td>
                  <td className="px-4 py-3 font-medium">{p.pet_name}</td>
                  <td className="px-4 py-3">{p.owner_name}</td>
                  <td className="px-4 py-3">{p.species || '—'}</td>
                  <td className="px-4 py-3">{p.phone || '—'}</td>
                  <td className="px-4 py-3">{p.email || '—'}</td>
                  <td className="px-4 py-3 space-x-2">
                    <button onClick={() => openEdit(p)} className="text-blue-600 hover:underline">Edit</button>
                    <button onClick={() => handleDelete(p.id)} className="text-red-500 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
              {!patients.length && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No patients found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-4">{modal === 'add' ? 'Add Patient' : 'Edit Patient'}</h2>
            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
              {[
                ['owner_name','Owner Name',true],['pet_name','Pet Name',true],
                ['species','Species'],['breed','Breed'],
                ['age','Age (years)'],['gender','Gender'],
                ['phone','Phone'],['email','Email'],
              ].map(([key, label, req]) => (
                <div key={key}>
                  <label className="text-xs text-gray-600 mb-1 block">{label}{req && ' *'}</label>
                  <input
                    required={!!req}
                    value={form[key] || ''}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              ))}
              <div className="col-span-2">
                <label className="text-xs text-gray-600 mb-1 block">Address</label>
                <input value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-600 mb-1 block">Notes</label>
                <textarea rows={2} value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div className="col-span-2 flex justify-end gap-2 mt-2">
                <button type="button" onClick={closeModal} className="px-4 py-2 text-sm rounded-lg border">Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm rounded-lg bg-blue-700 text-white hover:bg-blue-800">
                  {modal === 'add' ? 'Create' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
