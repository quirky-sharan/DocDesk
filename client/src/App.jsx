import { Suspense, lazy, useState } from 'react';
import { Clock, LogOut, RefreshCw } from 'lucide-react';
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
import { ReceptionistProvider, useReceptionist } from './receptionist/ReceptionistProvider';
import ReceptionistPanel, { ReceptionistLauncher } from './receptionist/ReceptionistPanel';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { Mark } from './components/landing/Wordmark';
import Button from './components/ui/Button';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import { cn } from './lib/cn';
import { EASE_OUT } from './lib/motion';

// The landing page and sign-in ship with the app because they are what an
// anonymous visitor lands on - making either of them a second round trip would
// show a blank page first. Everything behind sign-in loads when it is opened.
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const InventoryPage = lazy(() => import('./pages/InventoryPage'));
const SalesPage = lazy(() => import('./pages/SalesPage'));
const ContactsPage = lazy(() => import('./pages/ContactsPage'));
const PurchaseOrdersPage = lazy(() => import('./pages/PurchaseOrdersPage'));
const MessagesPage = lazy(() => import('./pages/MessagesPage'));
const FilesPage = lazy(() => import('./pages/FilesPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const DatabasePage = lazy(() => import('./pages/DatabasePage'));
const AppointmentsPage = lazy(() => import('./pages/AppointmentsPage'));
const AiPage = lazy(() => import('./pages/AiPage'));
const KnowledgePage = lazy(() => import('./pages/KnowledgePage'));

function PageLoading() {
  return (
    <div className="pt-2" aria-busy="true" aria-label="Loading">
      <div className="skeleton mb-3 h-4 w-28 rounded-full" />
      <div className="skeleton mb-8 h-10 w-64 rounded-2xl" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-[120px] rounded-[22px]" />)}
      </div>
      <div className="skeleton mt-6 h-[360px] rounded-[24px]" />
    </div>
  );
}

/**
 * Shown for the fraction of a second Firebase needs to say whether there is a
 * saved session. Deliberately almost nothing: a signed-in person must not see
 * the landing page flash past on the way to their dashboard.
 */
function Booting() {
  return (
    <div className="grid min-h-[100svh] place-items-center" aria-busy="true" aria-label="Loading DocDesk">
      <Mark size={26} className="animate-pulse text-ink-3" />
    </div>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <Routes>
          <Route path="/signin" element={<AuthPage />} />
          <Route path="*" element={<Gate />} />
        </Routes>
      </AuthProvider>
    </MotionConfig>
  );
}

/**
 * Decides which of the two apps is running: the public one (a landing page) or
 * the private one (the front desk). Everything the product needs - settings,
 * the receptionist, the spotlight, the shell - is mounted only on the private
 * side, so a visitor who never signs in never triggers an API call.
 */
function Gate() {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) return <Booting />;

  // Signed in, but not let in. Having an account is not what grants access -
  // anybody can create one - so nothing of the shop's mounts until an owner
  // has said yes. (The server refuses every request from this account anyway;
  // this is what the person sees instead of a page full of errors.)
  if (user && user.status !== 'active') return <Waiting />;

  if (!user) {
    // The landing page is the front door; every other address remembers where
    // it was headed and asks for a sign-in first.
    return location.pathname === '/' ? (
      <LandingPage />
    ) : (
      <Navigate to="/signin" state={{ from: location }} replace />
    );
  }

  return (
    <SettingsProvider>
      <ToastProvider>
        <SmoothScrollProvider>
          <ReceptionistProvider>
            <SpotlightProvider>
              <ShellProvider>
                <Shell />
              </ShellProvider>
            </SpotlightProvider>
          </ReceptionistProvider>
        </SmoothScrollProvider>
      </ToastProvider>
    </SettingsProvider>
  );
}

/** Shown to an account that exists but has not been let in yet. */
function Waiting() {
  const { user, refresh, signOut } = useAuth();
  const [checking, setChecking] = useState(false);
  const turnedOff = user.status === 'disabled';

  async function check() {
    setChecking(true);
    try {
      await refresh();
    } catch {
      // Still waiting, or offline: either way this screen is still the right one.
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="grid min-h-[100svh] place-items-center px-6">
      <div className="w-full max-w-[26rem] text-center">
        <span className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-full" style={{ background: 'var(--wash-strong)' }}>
          <Clock size={24} className="text-ink-2" />
        </span>
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.03em]">
          {turnedOff ? 'This account is switched off' : 'Waiting to be let in'}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
          {turnedOff
            ? 'The owner has turned this account off. Ask them to switch it back on.'
            : <>You are signed in as <span className="font-medium text-ink">{user.email || 'this account'}</span>, and the owner of this DocDesk has to let you in before you can see anything. Ask them to open <span className="font-medium text-ink">Settings → Team</span> and approve you.</>}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          {!turnedOff && <Button icon={RefreshCw} loading={checking} onClick={check}>Check again</Button>}
          <Button variant="secondary" icon={LogOut} onClick={() => signOut()}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}

function Shell() {
  const { can } = useAuth();
  const { open } = useReceptionist();
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
          {/* On wide screens the page makes room for the receptionist instead of
              hiding under it, so you can watch it work on the list. */}
          <div className={cn('mx-auto max-w-[1360px] px-4 pb-32 pt-2 transition-[margin] duration-500 ease-out-expo sm:px-8', open && 'xl:mr-[460px]')}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE_OUT }}
            >
              <Suspense fallback={<PageLoading />}>
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/inventory" element={<InventoryPage />} />
                  <Route path="/appointments" element={<AppointmentsPage />} />
                  <Route path="/sales" element={<SalesPage />} />
                  <Route path="/orders" element={<PurchaseOrdersPage />} />
                  <Route path="/customers" element={<ContactsPage kind="customers" />} />
                  <Route path="/suppliers" element={<ContactsPage kind="suppliers" />} />
                  <Route path="/files" element={<FilesPage />} />
                  <Route path="/reports" element={<ReportsPage />} />
                  <Route path="/messages" element={<MessagesPage />} />
                  {/* The database console is a manager's; for anyone else the
                      address simply goes home. The server enforces it either way. */}
                  <Route path="/database" element={can('manager') ? <DatabasePage /> : <Navigate to="/" replace />} />
                  <Route path="/ai" element={<AiPage />} />
                  <Route path="/knowledge" element={<KnowledgePage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </motion.div>
          </div>
        </div>
      </main>
      <ReceptionistLauncher />
      <ReceptionistPanel />
    </div>
  );
}
