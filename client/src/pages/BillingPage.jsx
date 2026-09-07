import { useState } from 'react';
import Navbar from '../components/Navbar';
import { useGetBills, useCreateBill, useUpdateBill, useDeleteBill } from '../queries/useBilling';
import { useApi } from '../queries/apiClient';

const STATUS_COLORS = {
  pending:   'bg-yellow-100 text-yellow-700',
  paid:      'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
};

const EMPTY = {
  patient_id: '', appointment_id: '', subtotal: '', tax: '0',
  discount: '0', total: '', payment_status: 'pending', payment_method: '',
};

export default function BillingPage() {
  const [modal, setModal]  = useState(null);
  const [form, setForm]    = useState(EMPTY);

  const { data: bills = [], isLoading } = useGetBills();
  const create = useCreateBill();
  const update = useUpdateBill();
  const remove = useDeleteBill();
  const api    = useApi();

  function openAdd()   { setForm(EMPTY); setModal('add'); }
  function openEdit(b) { setForm(b);     setModal(b); }
  function closeModal(){ setModal(null); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (modal === 'add') await create.mutateAsync(form);
    else await update.mutateAsync({ ...form, id: modal.id });
    closeModal();
  }

  async function downloadPdf(id) {
    const res = await api.get(`/billing/${id}/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a   = document.createElement('a');
    a.href = url;
    a.download = `receipt-${id}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <Navbar title="Billing" />

      <div className="flex justify-end mb-4">
        <button
          onClick={openAdd}
          className="bg-blue-700 text-white px-4 py-2 rounded-lg hover:bg-blue-800"
        >
          + New Bill
        </button>
      </div>

      {isLoading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="overflow-x-auto bg-white rounded-xl shadow">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-gray-600 uppercase text-xs">
              <tr>
                {['ID','Pet','Owner','Total','Status','Method','Date','Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bills.map(b => (
                <tr key={b.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3">{b.id}</td>
                  <td className="px-4 py-3 font-medium">{b.pet_name}</td>
                  <td className="px-4 py-3">{b.owner_name}</td>
                  <td className="px-4 py-3">₹{Number(b.total).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[b.payment_status] || ''}`}>
                      {b.payment_status}
                    </span>
                  </td>
                  <td className="px-4 py-3">{b.payment_method || '—'}</td>
                  <td className="px-4 py-3">{new Date(b.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 space-x-2">
                    <button onClick={() => openEdit(b)} className="text-blue-600 hover:underline">Edit</button>
                    <button onClick={() => downloadPdf(b.id)} className="text-green-600 hover:underline">PDF</button>
                    <button onClick={() => remove.mutate(b.id)} className="text-red-500 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
              {!bills.length && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400">No bills found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">{modal === 'add' ? 'New Bill' : 'Edit Bill'}</h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              {[
                ['patient_id','Patient ID',true,'number'],
                ['appointment_id','Appointment ID (optional)',false,'number'],
                ['subtotal','Subtotal (₹)',true,'number'],
                ['tax','Tax (₹)',false,'number'],
                ['discount','Discount (₹)',false,'number'],
                ['total','Total (₹)',true,'number'],
                ['payment_method','Payment Method'],
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
                <label className="text-xs text-gray-600 mb-1 block">Payment Status</label>
                <select value={form.payment_status} onChange={e => setForm(f => ({ ...f, payment_status: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
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
