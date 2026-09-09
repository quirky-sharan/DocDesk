import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const MedicinesPage = () => {
  const [medicines, setMedicines] = useState([]);
  const [formData, setFormData] = useState({ name: '', description: '', price: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMedicines();
  }, []);

  const fetchMedicines = async () => {
    try {
      const res = await fetch(`${API_URL}/medicines`);
      setMedicines(await res.json());
    } catch (error) {
      console.error('Error fetching medicines:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await fetch(`${API_URL}/medicines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      setFormData({ name: '', description: '', price: '' });
      fetchMedicines();
    } catch (error) {
      console.error('Error creating medicine:', error);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this medicine?')) return;
    try {
      await fetch(`${API_URL}/medicines/${id}`, { method: 'DELETE' });
      fetchMedicines();
    } catch (error) {
      console.error('Error deleting medicine:', error);
    }
  };

  if (loading) return <div className="text-center p-10 text-slate-500">Loading medicines...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Medicines Catalog</h1>
          <p className="text-slate-500 mt-1">Manage medicines and pricing</p>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4 text-slate-700">Add New Medicine</h2>
        <form onSubmit={handleSubmit} className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-600 mb-1">Name</label>
            <input type="text" required className="input-field" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
          </div>
          <div className="flex-[2]">
            <label className="block text-sm font-medium text-slate-600 mb-1">Description</label>
            <input type="text" className="input-field" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-600 mb-1">Price ($)</label>
            <input type="number" step="0.01" required className="input-field" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} />
          </div>
          <button type="submit" className="btn-primary h-[42px]">Add Medicine</button>
        </form>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {medicines.map(m => (
          <div key={m.id} className="card relative group hover:shadow-md transition-shadow border-t-4 border-t-teal-400">
            <div className="absolute top-4 right-4">
              <button onClick={() => handleDelete(m.id)} className="btn-danger opacity-0 group-hover:opacity-100 transition-opacity p-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg></button>
            </div>
            <h3 className="text-xl font-bold text-slate-800 pr-8 truncate">{m.name}</h3>
            <p className="text-2xl font-bold text-teal-600 mt-2">${Number(m.price).toFixed(2)}</p>
            <p className="text-slate-500 text-sm mt-3 line-clamp-2 min-h-[40px]">{m.description || 'No description available.'}</p>
          </div>
        ))}
        {medicines.length === 0 && (
          <div className="col-span-full text-center text-slate-400 py-10 card">No medicines found.</div>
        )}
      </div>
    </div>
  );
};

export default MedicinesPage;
