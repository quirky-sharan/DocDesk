import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import PatientsPage from './pages/PatientsPage';
import AppointmentsPage from './pages/AppointmentsPage';
import BillingPage from './pages/BillingPage';
import MedicationsPage from './pages/MedicationsPage';
import Sidebar from './components/Sidebar';
import ProtectedRoute from './components/ProtectedRoute';

function AppLayout({ children }) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<Navigate to="/patients" replace />} />
        <Route
          path="/patients"
          element={<AppLayout><PatientsPage /></AppLayout>}
        />
        <Route
          path="/appointments"
          element={<AppLayout><AppointmentsPage /></AppLayout>}
        />
        <Route
          path="/billing"
          element={<AppLayout><BillingPage /></AppLayout>}
        />
        <Route
          path="/medications"
          element={<AppLayout><MedicationsPage /></AppLayout>}
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
