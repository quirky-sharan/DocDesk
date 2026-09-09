import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const DoctorsPage = () => {
  const [doctors, setDoctors] = useState([]);
  const [formData, setFormData] = useState({ name: '', specialization: '', phone: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDoctors();
  }, []);

  const fetchDoctors = async () => {
    try {
      const res = await fetch(`${API_URL}/doctors`);
      const data = await res.json();
      setDoctors(data);
    } catch (error) {
      console.error('Error fetching doctors:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await fetch(`${API_URL}/doctors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      setFormData({ name: '', specialization: '', phone: '' });
      fetchDoctors();
    } catch (error) {
      console.error('Error creating doctor:', error);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this doctor?')) return;
    try {
      await fetch(`${API_URL}/doctors/${id}`, { method: 'DELETE' });
      fetchDoctors();
    } catch (error) {
      console.error('Error deleting doctor:', error);
    }
  };

  if (loading) return <div className="text-center p-10 text-slate-500">Loading doctors...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Doctors Directory</h1>
          <p className="text-slate-500 mt-1">Manage clinic medical staff</p>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4 text-slate-700">Add New Doctor</h2>
        <form onSubmit={handleSubmit} className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-600 mb-1">Name</label>
            <input
              type="text"
              required
              className="input-field"
              placeholder="Dr. John Doe"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-600 mb-1">Specialization</label>
            <input
              type="text"
              required
              className="input-field"
              placeholder="Cardiologist"
              value={formData.specialization}
              onChange={(e) => setFormData({ ...formData, specialization: e.target.value })}
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-600 mb-1">Phone</label>
            <input
              type="text"
              className="input-field"
              placeholder="555-0123"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />
          </div>
          <button type="submit" className="btn-primary h-[42px]">Add Doctor</button>
        </form>
      </div>

      <div className="card overflow-hidden !p-0">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr>
              <th className="table-header">ID</th>
              <th className="table-header">Name</th>
              <th className="table-header">Specialization</th>
              <th className="table-header">Phone</th>
              <th className="table-header text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {doctors.map((doc) => (
              <tr key={doc.id} className="hover:bg-slate-50/80 transition-colors group">
                <td className="table-cell font-mono text-slate-500">#{doc.id}</td>
                <td className="table-cell font-medium text-slate-800">{doc.name}</td>
                <td className="table-cell">
                  <span className="bg-teal-50 text-teal-700 px-2.5 py-1 rounded-full text-xs font-medium border border-teal-100">
                    {doc.specialization}
                  </span>
                </td>
                <td className="table-cell">{doc.phone || 'N/A'}</td>
                <td className="table-cell text-right space-x-2">
                  <button onClick={() => handleDelete(doc.id)} className="btn-danger opacity-0 group-hover:opacity-100 transition-opacity">Delete</button>
                </td>
              </tr>
            ))}
            {doctors.length === 0 && (
              <tr>
                <td colSpan="5" className="table-cell text-center text-slate-400 py-8">No doctors found. Add one above.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DoctorsPage;
