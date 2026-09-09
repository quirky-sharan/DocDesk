import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const AppointmentsPage = () => {
  const [appointments, setAppointments] = useState([]);
  const [patients, setPatients] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [formData, setFormData] = useState({ patient_id: '', doctor_id: '', appointment_date: '', status: 'scheduled', notes: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [apptRes, patRes, docRes] = await Promise.all([
        fetch(`${API_URL}/appointments`),
        fetch(`${API_URL}/patients`),
        fetch(`${API_URL}/doctors`)
      ]);
      setAppointments(await apptRes.json());
      setPatients(await patRes.json());
      setDoctors(await docRes.json());
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await fetch(`${API_URL}/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      setFormData({ ...formData, patient_id: '', appointment_date: '', notes: '' });
      fetchData();
    } catch (error) {
      console.error('Error creating appointment:', error);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this appointment?')) return;
    try {
      await fetch(`${API_URL}/appointments/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (error) {
      console.error('Error deleting appointment:', error);
    }
  };
  
  const handleStatusChange = async (id, newStatus, appt) => {
    try {
      await fetch(`${API_URL}/appointments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...appt, status: newStatus }),
      });
      fetchData();
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  if (loading) return <div className="text-center p-10 text-slate-500">Loading appointments...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Appointments</h1>
          <p className="text-slate-500 mt-1">Schedule and manage visits</p>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4 text-slate-700">Schedule Appointment</h2>
        <form onSubmit={handleSubmit} className="grid grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Patient</label>
            <select required className="input-field bg-white" value={formData.patient_id} onChange={e => setFormData({...formData, patient_id: e.target.value})}>
              <option value="">Select Patient</option>
              {patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Doctor</label>
            <select required className="input-field bg-white" value={formData.doctor_id} onChange={e => setFormData({...formData, doctor_id: e.target.value})}>
              <option value="">Select Doctor</option>
              {doctors.map(d => <option key={d.id} value={d.id}>Dr. {d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Date & Time</label>
            <input type="datetime-local" required className="input-field" value={formData.appointment_date} onChange={e => setFormData({...formData, appointment_date: e.target.value})} />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-600 mb-1">Notes</label>
            <input type="text" className="input-field" placeholder="Reason for visit..." value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} />
          </div>
          <button type="submit" className="btn-primary h-[42px]">Schedule</button>
        </form>
      </div>

      <div className="card overflow-hidden !p-0">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr>
              <th className="table-header">Date & Time</th>
              <th className="table-header">Patient</th>
              <th className="table-header">Doctor</th>
              <th className="table-header">Status</th>
              <th className="table-header text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {appointments.map(a => (
              <tr key={a.id} className="hover:bg-slate-50/80 group">
                <td className="table-cell font-medium text-slate-800">
                  {new Date(a.appointment_date).toLocaleString()}
                </td>
                <td className="table-cell">{a.patient_name}</td>
                <td className="table-cell">Dr. {a.doctor_name}</td>
                <td className="table-cell">
                  <select 
                    className={`text-xs font-semibold rounded-full px-3 py-1 border outline-none appearance-none cursor-pointer ${
                      a.status === 'scheduled' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                      a.status === 'completed' ? 'bg-green-50 text-green-700 border-green-200' :
                      'bg-red-50 text-red-700 border-red-200'
                    }`}
                    value={a.status}
                    onChange={(e) => handleStatusChange(a.id, e.target.value, a)}
                  >
                    <option value="scheduled">Scheduled</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </td>
                <td className="table-cell text-right">
                  <button onClick={() => handleDelete(a.id)} className="btn-danger opacity-0 group-hover:opacity-100 transition-opacity">Delete</button>
                </td>
              </tr>
            ))}
            {appointments.length === 0 && (
              <tr><td colSpan="5" className="table-cell text-center text-slate-400 py-8">No appointments found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AppointmentsPage;
