import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import DoctorsPage from './pages/DoctorsPage';
import PatientsPage from './pages/PatientsPage';
import AppointmentsPage from './pages/AppointmentsPage';
import MedicinesPage from './pages/MedicinesPage';
import InventoryPage from './pages/InventoryPage';
import BillsPage from './pages/BillsPage';

function App() {
  return (
    <Router>
      <div className="flex bg-slate-50 min-h-screen font-sans text-slate-800">
        <Sidebar />
        <main className="flex-1 flex flex-col p-8 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/appointments" replace />} />
            <Route path="/doctors" element={<DoctorsPage />} />
            <Route path="/patients" element={<PatientsPage />} />
            <Route path="/appointments" element={<AppointmentsPage />} />
            <Route path="/medicines" element={<MedicinesPage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/bills" element={<BillsPage />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
