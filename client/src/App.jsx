import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import { AssistantProvider, useAssistant } from './assistant/AssistantProvider';
import AssistantPanel, { AssistantLauncher } from './assistant/AssistantPanel';
import DashboardPage from './pages/DashboardPage';
import InventoryPage from './pages/InventoryPage';
import SalesPage from './pages/SalesPage';
import ContactsPage from './pages/ContactsPage';
import PurchaseOrdersPage from './pages/PurchaseOrdersPage';
import MessagesPage from './pages/MessagesPage';
import FilesPage from './pages/FilesPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <AssistantProvider>
      <Shell />
    </AssistantProvider>
  );
}

function Shell() {
  const { open } = useAssistant();
  return (
      <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          {/* On wide screens the page makes room for the assistant instead of
              hiding under it, so you can watch it work on the list. */}
          <main className={`flex-1 overflow-y-auto px-6 pb-24 pt-7 transition-[margin] duration-200 sm:px-10 sm:pt-9 ${open ? 'xl:mr-[440px]' : ''}`}>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/sales" element={<SalesPage />} />
              <Route path="/orders" element={<PurchaseOrdersPage />} />
              <Route path="/customers" element={<ContactsPage kind="customers" />} />
              <Route path="/suppliers" element={<ContactsPage kind="suppliers" />} />
              <Route path="/files" element={<FilesPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/messages" element={<MessagesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
        <AssistantLauncher />
        <AssistantPanel />
      </div>
  );
}
