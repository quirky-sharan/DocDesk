import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const BillsPage = () => {
  const [bills, setBills] = useState([]);
  const [patients, setPatients] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [medicines, setMedicines] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Bill Creation State
  const [patientId, setPatientId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [selectedItems, setSelectedItems] = useState([]);
  const [selectedMedicineId, setSelectedMedicineId] = useState('');
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [viewBillId, setViewBillId] = useState(null);
  const [viewBillData, setViewBillData] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [billsRes, patRes, docRes, medRes] = await Promise.all([
        fetch(`${API_URL}/bills`),
        fetch(`${API_URL}/patients`),
        fetch(`${API_URL}/doctors`),
        fetch(`${API_URL}/medicines`)
      ]);
      setBills(await billsRes.json());
      setPatients(await patRes.json());
      setDoctors(await docRes.json());
      setMedicines(await medRes.json());
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = () => {
    if (!selectedMedicineId || !selectedQuantity) return;
    const med = medicines.find(m => m.id.toString() === selectedMedicineId);
    if (!med) return;

    setSelectedItems([
      ...selectedItems, 
      { medicine_id: med.id, name: med.name, quantity: selectedQuantity, unit_price: med.price }
    ]);
    setSelectedMedicineId('');
    setSelectedQuantity(1);
  };

  const handleRemoveItem = (index) => {
    const newItems = [...selectedItems];
    newItems.splice(index, 1);
    setSelectedItems(newItems);
  };

  const calculateTotal = () => {
    return selectedItems.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!patientId || selectedItems.length === 0) {
      alert('Please select a patient and add at least one item.');
      return;
    }
    try {
      const payload = {
        patient_id: patientId,
        doctor_id: doctorId || null,
        total_amount: calculateTotal(),
        status: 'unpaid',
        items: selectedItems
      };
      
      await fetch(`${API_URL}/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      
      setPatientId('');
      setDoctorId('');
      setSelectedItems([]);
      fetchData();
    } catch (error) {
      console.error('Error creating bill:', error);
    }
  };

  const handleViewBill = async (id) => {
    try {
      const res = await fetch(`${API_URL}/bills/${id}`);
      setViewBillData(await res.json());
      setViewBillId(id);
    } catch (error) {
      console.error('Error fetching bill details:', error);
    }
  };

  if (loading) return <div className="text-center p-10 text-slate-500">Loading bills...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Billing & Invoices</h1>
          <p className="text-slate-500 mt-1">Generate bills and track payments</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Create Bill Section */}
        <div className="xl:col-span-1 card">
          <h2 className="text-lg font-semibold mb-4 text-slate-700 border-b pb-2">Generate New Bill</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Patient</label>
              <select className="input-field bg-white" value={patientId} onChange={e => setPatientId(e.target.value)}>
                <option value="">Select Patient</option>
                {patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Doctor (Optional)</label>
              <select className="input-field bg-white" value={doctorId} onChange={e => setDoctorId(e.target.value)}>
                <option value="">Select Doctor</option>
                {doctors.map(d => <option key={d.id} value={d.id}>Dr. {d.name}</option>)}
              </select>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
              <h3 className="font-semibold text-sm text-slate-700">Add Items</h3>
              <div className="flex gap-2">
                <select className="input-field bg-white flex-[2] text-sm" value={selectedMedicineId} onChange={e => setSelectedMedicineId(e.target.value)}>
                  <option value="">Medicine...</option>
                  {medicines.map(m => <option key={m.id} value={m.id}>{m.name} - ${m.price}</option>)}
                </select>
                <input type="number" min="1" className="input-field flex-1 text-sm" value={selectedQuantity} onChange={e => setSelectedQuantity(e.target.value)} />
                <button type="button" onClick={handleAddItem} className="btn-secondary text-sm !px-3 font-bold">+</button>
              </div>

              {selectedItems.length > 0 && (
                <div className="mt-3">
                  <ul className="text-sm space-y-2">
                    {selectedItems.map((item, idx) => (
                      <li key={idx} className="flex justify-between items-center bg-white p-2 rounded border border-slate-100 shadow-sm">
                        <span>{item.quantity}x {item.name}</span>
                        <div className="flex items-center gap-3">
                          <span className="font-medium">${(item.quantity * item.unit_price).toFixed(2)}</span>
                          <button onClick={() => handleRemoveItem(idx)} className="text-red-500 hover:text-red-700 font-bold">&times;</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 pt-3 border-t border-slate-200 flex justify-between items-center">
                    <span className="font-bold text-slate-700">Total:</span>
                    <span className="text-lg font-bold text-teal-600">${calculateTotal().toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>
            
            <button onClick={handleSubmit} className="btn-primary w-full mt-4">Generate Bill</button>
          </div>
        </div>

        {/* List Bills Section */}
        <div className="xl:col-span-2 card overflow-hidden !p-0 flex flex-col">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr>
                <th className="table-header">Bill ID</th>
                <th className="table-header">Date</th>
                <th className="table-header">Patient</th>
                <th className="table-header">Amount</th>
                <th className="table-header">Status</th>
                <th className="table-header text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bills.map(b => (
                <tr key={b.id} className="hover:bg-slate-50/80">
                  <td className="table-cell font-mono font-medium text-slate-500">#{b.id}</td>
                  <td className="table-cell">{new Date(b.created_at).toLocaleDateString()}</td>
                  <td className="table-cell font-medium text-slate-800">{b.patient_name}</td>
                  <td className="table-cell font-bold text-teal-600">${Number(b.total_amount).toFixed(2)}</td>
                  <td className="table-cell">
                    <span className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider ${
                      b.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {b.status}
                    </span>
                  </td>
                  <td className="table-cell text-right">
                    <button onClick={() => handleViewBill(b.id)} className="btn-edit">View Details</button>
                  </td>
                </tr>
              ))}
              {bills.length === 0 && (
                <tr><td colSpan="6" className="table-cell text-center text-slate-400 py-10">No bills generated yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bill Details Modal/Overlay */}
      {viewBillId && viewBillData && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-xl font-bold text-slate-800">Invoice #{viewBillData.id}</h2>
              <button onClick={() => setViewBillId(null)} className="text-slate-400 hover:text-slate-600">&times;</button>
            </div>
            <div className="p-6 overflow-y-auto">
              <div className="flex justify-between mb-6 text-sm">
                <div>
                  <p className="text-slate-500">Billed To:</p>
                  <p className="font-bold text-slate-800 text-lg">{viewBillData.patient_name}</p>
                </div>
                <div className="text-right">
                  <p className="text-slate-500">Date:</p>
                  <p className="font-medium text-slate-800">{new Date(viewBillData.created_at).toLocaleDateString()}</p>
                </div>
              </div>
              
              <table className="w-full text-sm mb-6 border-t border-slate-200">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 text-left">
                    <th className="py-2 font-medium">Item</th>
                    <th className="py-2 font-medium text-center">Qty</th>
                    <th className="py-2 font-medium text-right">Price</th>
                    <th className="py-2 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {viewBillData.items.map((item, idx) => (
                    <tr key={idx} className="border-b border-slate-100">
                      <td className="py-3 font-medium text-slate-700">{item.medicine_name}</td>
                      <td className="py-3 text-center">{item.quantity}</td>
                      <td className="py-3 text-right">${Number(item.unit_price).toFixed(2)}</td>
                      <td className="py-3 text-right font-medium">${(item.quantity * item.unit_price).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              <div className="flex justify-end pt-4">
                <div className="text-right">
                  <p className="text-sm text-slate-500 mb-1">Total Amount Due</p>
                  <p className="text-3xl font-bold text-teal-600">${Number(viewBillData.total_amount).toFixed(2)}</p>
                </div>
              </div>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button onClick={() => setViewBillId(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillsPage;
