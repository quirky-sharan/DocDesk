import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const PatientsPage = () => {
  const [patients, setPatients] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [formData, setFormData] = useState({ name: '', age: '', species: '', phone: '', doctor_id: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [patientsRes, doctorsRes] = await Promise.all([
        fetch(`${API_URL}/patients`),
        fetch(`${API_URL}/doctors`)
      ]);
      const patientsData = await patientsRes.json();
      const doctorsData = await doctorsRes.json();
      setPatients(patientsData);
      setDoctors(doctorsData);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...formData, doctor_id: formData.doctor_id || null };
      await fetch(`${API_URL}/patients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setFormData({ name: '', age: '', species: '', phone: '', doctor_id: '' });
      fetchData();
    } catch (error) {
      console.error('Error creating patient:', error);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this patient?')) return;
    try {
      await fetch(`${API_URL}/patients/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (error) {
      console.error('Error deleting patient:', error);
    }
  };

  if (loading) return <div className="text-center p-10 text-slate-500">Loading patients...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Patients</h1>
          <p className="text-slate-500 mt-1">Manage patient records</p>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4 text-slate-700">Add New Patient</h2>
        <form onSubmit={handleSubmit} className="grid grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Name</label>
            <input type="text" required className="input-field" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Age</label>
            <input type="number" className="input-field" value={formData.age} onChange={e => setFormData({...formData, age: e.target.value})} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Species (if vet)</label>
            <input type="text" className="input-field" value={formData.species} onChange={e => setFormData({...formData, species: e.target.value})} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Phone</label>
            <input type="text" className="input-field" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Assigned Doctor</label>
            <select className="input-field bg-white" value={formData.doctor_id} onChange={e => setFormData({...formData, doctor_id: e.target.value})}>
              <option value="">-- None --</option>
              {doctors.map(d => <option key={d.id} value={d.id}>Dr. {d.name}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-primary h-[42px]">Add Patient</button>
        </form>
      </div>

      <div className="card overflow-hidden !p-0">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr>
              <th className="table-header">Name</th>
              <th className="table-header">Age</th>
              <th className="table-header">Species</th>
              <th className="table-header">Phone</th>
              <th className="table-header">Doctor</th>
              <th className="table-header text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {patients.map(p => (
              <tr key={p.id} className="hover:bg-slate-50/80 group">
                <td className="table-cell font-medium text-slate-800">{p.name}</td>
                <td className="table-cell">{p.age || '-'}</td>
                <td className="table-cell">{p.species || '-'}</td>
                <td className="table-cell">{p.phone || '-'}</td>
                <td className="table-cell">
                  {p.doctor_name ? (
                    <span className="text-slate-600 font-medium">Dr. {p.doctor_name}</span>
                  ) : (
                    <span className="text-slate-400 italic">Unassigned</span>
                  )}
                </td>
                <td className="table-cell text-right">
                  <button onClick={() => handleDelete(p.id)} className="btn-danger opacity-0 group-hover:opacity-100 transition-opacity">Delete</button>
                </td>
              </tr>
            ))}
            {patients.length === 0 && (
              <tr><td colSpan="6" className="table-cell text-center text-slate-400 py-8">No patients found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PatientsPage;
