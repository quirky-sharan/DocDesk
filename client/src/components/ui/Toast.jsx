import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Info, TriangleAlert } from 'lucide-react';

const ToastContext = createContext(null);

const TONE = {
  success: { icon: Check, ring: '#30d158' },
  error: { icon: TriangleAlert, ring: '#ff453a' },
  info: { icon: Info, ring: '#0a84ff' },
};

let counter = 0;

/**
 * Confirmations appear in a black capsule at the top of the window that grows
 * out of a dot and shrinks back when done - the Dynamic Island, more or less.
 * Short, one at a time on top, and never needed to finish a task.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (toast) => {
      const id = ++counter;
      setToasts((list) => [...list.slice(-2), { id, tone: 'info', ...toast }]);
      timers.current.set(id, setTimeout(() => dismiss(id), toast.duration ?? 3800));
      return id;
    },
    [dismiss]
  );

  const api = useMemo(
    () => ({
      show,
      dismiss,
      success: (title, options = {}) => show({ ...options, title, tone: 'success' }),
      error: (title, options = {}) => show({ ...options, title, tone: 'error', duration: options.duration ?? 6000 }),
      info: (title, options = {}) => show({ ...options, title, tone: 'info' }),
    }),
    [show, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3" aria-live="polite" role="status">
          <AnimatePresence initial={false}>
            {toasts.map((toast) => (
              <Island key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
            ))}
          </AnimatePresence>
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

function Island({ toast, onDismiss }) {
  const tone = TONE[toast.tone] || TONE.info;
  const Icon = tone.icon;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.4, y: -18, filter: 'blur(6px)' }}
      animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, scale: 0.6, y: -14, filter: 'blur(6px)', transition: { duration: 0.22 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 26, mass: 0.8 }}
      className="pointer-events-auto flex max-w-[min(92vw,460px)] items-center gap-3 rounded-full py-2 pl-2 pr-4 text-white"
      style={{
        background: '#000',
        boxShadow: '0 0 0 1px rgb(255 255 255 / 0.08), 0 12px 32px -8px rgb(0 0 0 / 0.45)',
      }}
      onClick={onDismiss}
    >
      <motion.span
        initial={{ scale: 0, rotate: -45 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 520, damping: 18, delay: 0.08 }}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full"
        style={{ background: tone.ring }}
      >
        <Icon size={15} strokeWidth={2.8} color="#fff" />
      </motion.span>
      <motion.div
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.35, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        className="min-w-0 leading-tight"
      >
        <p className="truncate text-[13.5px] font-semibold tracking-[-0.01em]">{toast.title}</p>
        {toast.description && <p className="truncate text-[12.5px] text-white/65">{toast.description}</p>}
      </motion.div>
    </motion.div>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
