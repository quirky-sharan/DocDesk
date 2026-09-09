import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const InventoryPage = () => {
  const [inventory, setInventory] = useState([]);
  const [medicines, setMedicines] = useState([]);
  const [formData, setFormData] = useState({ medicine_id: '', quantity: '', min_stock_level: 10 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [invRes, medRes] = await Promise.all([
        fetch(`${API_URL}/inventory`),
        fetch(`${API_URL}/medicines`)
      ]);
      setInventory(await invRes.json());
      setMedicines(await medRes.json());
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await fetch(`${API_URL}/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      setFormData({ medicine_id: '', quantity: '', min_stock_level: 10 });
      fetchData();
    } catch (error) {
      console.error('Error updating inventory:', error);
    }
  };

  if (loading) return <div className="text-center p-10 text-slate-500">Loading inventory...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Inventory Management</h1>
          <p className="text-slate-500 mt-1">Track medicine stock levels</p>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4 text-slate-700">Add / Update Stock</h2>
        <form onSubmit={handleSubmit} className="flex gap-4 items-end">
          <div className="flex-[2]">
            <label className="block text-sm font-medium text-slate-600 mb-1">Medicine</label>
            <select required className="input-field bg-white" value={formData.medicine_id} onChange={e => setFormData({...formData, medicine_id: e.target.value})}>
              <option value="">Select Medicine</option>
              {medicines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-600 mb-1">Quantity (+)</label>
            <input type="number" required className="input-field" value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-600 mb-1">Min Stock</label>
            <input type="number" required className="input-field" value={formData.min_stock_level} onChange={e => setFormData({...formData, min_stock_level: e.target.value})} />
          </div>
          <button type="submit" className="btn-primary h-[42px]">Update</button>
        </form>
      </div>

      <div className="card overflow-hidden !p-0">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr>
              <th className="table-header">Medicine</th>
              <th className="table-header">Current Stock</th>
              <th className="table-header">Min Level</th>
              <th className="table-header">Status</th>
              <th className="table-header text-right">Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {inventory.map(item => {
              const isLow = item.quantity < item.min_stock_level;
              return (
                <tr key={item.id} className={`hover:bg-slate-50 transition-colors ${isLow ? 'bg-red-50/30' : ''}`}>
                  <td className="table-cell font-medium text-slate-800">{item.medicine_name}</td>
                  <td className="table-cell">
                    <span className={`font-bold text-lg ${isLow ? 'text-red-600' : 'text-slate-700'}`}>
                      {item.quantity}
                    </span>
                  </td>
                  <td className="table-cell text-slate-500">{item.min_stock_level}</td>
                  <td className="table-cell">
                    {isLow ? (
                      <span className="bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">Low Stock</span>
                    ) : (
                      <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">In Stock</span>
                    )}
                  </td>
                  <td className="table-cell text-right text-slate-400 text-sm">
                    {new Date(item.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
            {inventory.length === 0 && (
              <tr><td colSpan="5" className="table-cell text-center text-slate-400 py-8">Inventory is empty.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default InventoryPage;
