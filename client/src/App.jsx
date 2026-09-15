import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { MotionConfig, motion } from 'motion/react';
import Sidebar from './components/shell/Sidebar';
import TopBar from './components/shell/TopBar';
import AppBackdrop from './components/shell/AppBackdrop';
import { ShellProvider, useShell } from './components/shell/ShellProvider';
import { SmoothScrollProvider, useSmoothScroll } from './components/shell/SmoothScroll';
import { SpotlightProvider } from './components/spotlight/SpotlightProvider';
import { ToastProvider } from './components/ui/Toast';
import { SettingsProvider } from './lib/settings';
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
import DatabasePage from './pages/DatabasePage';
import { cn } from './lib/cn';
import { EASE_OUT } from './lib/motion';

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <SettingsProvider>
        <ToastProvider>
          <SmoothScrollProvider>
            <AssistantProvider>
              <SpotlightProvider>
                <ShellProvider>
                  <Shell />
                </ShellProvider>
              </SpotlightProvider>
            </AssistantProvider>
          </SmoothScrollProvider>
        </ToastProvider>
      </SettingsProvider>
    </MotionConfig>
  );
}

function Shell() {
  const { open } = useAssistant();
  const { collapsed } = useShell();
  const { scrollerRef, contentRef } = useSmoothScroll();
  const location = useLocation();

  return (
    <div className="relative h-screen overflow-hidden">
      <AppBackdrop />
      <Sidebar />
      <main
        ref={scrollerRef}
        className={cn(
          'relative z-10 h-screen overflow-y-auto overflow-x-hidden transition-[padding-left] duration-500 ease-out-expo',
          collapsed ? 'lg:pl-[88px]' : 'lg:pl-[268px]'
        )}
      >
        <div ref={contentRef}>
          <TopBar />
          {/* On wide screens the page makes room for the assistant instead of
              hiding under it, so you can watch it work on the list. */}
          <div className={cn('mx-auto max-w-[1360px] px-4 pb-32 pt-2 transition-[margin] duration-500 ease-out-expo sm:px-8', open && 'xl:mr-[460px]')}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE_OUT }}
            >
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
                <Route path="/database" element={<DatabasePage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </motion.div>
          </div>
        </div>
      </main>
      <AssistantLauncher />
      <AssistantPanel />
    </div>
  );
}
