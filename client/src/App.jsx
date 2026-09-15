import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import DashboardPage from './pages/DashboardPage';
import InventoryPage from './pages/InventoryPage';
import SalesPage from './pages/SalesPage';
import ContactsPage from './pages/ContactsPage';
import PurchaseOrdersPage from './pages/PurchaseOrdersPage';
import MessagesPage from './pages/MessagesPage';

export default function App() {
  return (
    <div className="flex min-h-screen bg-slate-50 font-sans text-slate-800">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6 sm:p-8">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/sales" element={<SalesPage />} />
          <Route path="/orders" element={<PurchaseOrdersPage />} />
          <Route path="/customers" element={<ContactsPage kind="customers" />} />
          <Route path="/suppliers" element={<ContactsPage kind="suppliers" />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
