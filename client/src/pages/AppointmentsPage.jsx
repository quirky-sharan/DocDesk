import { useState } from 'react';
import Navbar from '../components/Navbar';
import {
  useGetAppointments,
  useCreateAppointment,
  useUpdateAppointment,
  useDeleteAppointment,
} from '../queries/useAppointments';

const STATUS_COLORS = {
  scheduled:  'bg-blue-100 text-blue-700',
  completed:  'bg-green-100 text-green-700',
  cancelled:  'bg-red-100 text-red-600',
};

const EMPTY = {
  patient_id: '', doctor_id: '', appointment_date: '',
  appointment_time: '', reason: '', status: 'scheduled', notes: '',
};

export default function AppointmentsPage() {
  const [filters, setFilters]  = useState({});
  const [modal, setModal]      = useState(null);
  const [form, setForm]        = useState(EMPTY);

  const { data: appointments = [], isLoading } = useGetAppointments(filters);
  const create  = useCreateAppointment();
  const update  = useUpdateAppointment();
  const remove  = useDeleteAppointment();

  function openAdd()   { setForm(EMPTY); setModal('add'); }
  function openEdit(a) { setForm(a);     setModal(a); }
  function closeModal(){ setModal(null); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (modal === 'add') await create.mutateAsync(form);
    else await update.mutateAsync({ ...form, id: modal.id });
    closeModal();
  }

  return (
    <div>
      <Navbar title="Appointments" />

      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          <input
            type="date"
            onChange={e => setFilters(f => ({ ...f, date: e.target.value || undefined }))}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            onChange={e => setFilters(f => ({ ...f, status: e.target.value || undefined }))}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <button
          onClick={openAdd}
          className="bg-blue-700 text-white px-4 py-2 rounded-lg hover:bg-blue-800"
        >
          + New Appointment
        </button>
      </div>

      {isLoading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="overflow-x-auto bg-white rounded-xl shadow">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-gray-600 uppercase text-xs">
              <tr>
                {['ID','Pet','Owner','Date','Time','Doctor','Status','Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {appointments.map(a => (
                <tr key={a.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3">{a.id}</td>
                  <td className="px-4 py-3 font-medium">{a.pet_name}</td>
                  <td className="px-4 py-3">{a.owner_name}</td>
                  <td className="px-4 py-3">{a.appointment_date}</td>
                  <td className="px-4 py-3">{a.appointment_time}</td>
                  <td className="px-4 py-3">{a.doctor_name || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[a.status] || ''}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 space-x-2">
                    <button onClick={() => openEdit(a)} className="text-blue-600 hover:underline">Edit</button>
                    <button onClick={() => remove.mutate(a.id)} className="text-red-500 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
              {!appointments.length && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400">No appointments found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">{modal === 'add' ? 'New Appointment' : 'Edit Appointment'}</h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              {[
                ['patient_id','Patient ID',true,'number'],
                ['doctor_id','Doctor ID (optional)',false,'number'],
                ['appointment_date','Date',true,'date'],
                ['appointment_time','Time',true,'time'],
                ['reason','Reason'],
              ].map(([key, label, req, type]) => (
                <div key={key}>
                  <label className="text-xs text-gray-600 mb-1 block">{label}</label>
                  <input
                    required={!!req} type={type || 'text'}
                    value={form[key] || ''}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              ))}
              <div>
                <label className="text-xs text-gray-600 mb-1 block">Status</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="scheduled">Scheduled</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 mt-2">
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
