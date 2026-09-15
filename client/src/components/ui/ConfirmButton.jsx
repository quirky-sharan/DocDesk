import { useCallback, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import Popover from './Popover';
import Button from './Button';
import { cn } from '../../lib/cn';

/**
 * A destructive action that asks first, in a small popover beside the button
 * rather than the browser's grey confirm box. Focus lands on Cancel, so a
 * reflexive Enter never deletes anything.
 */
export default function ConfirmButton({
  onConfirm,
  children,
  message,
  confirmLabel = 'Delete',
  className = 'btn-danger',
  icon: Icon,
  title,
  disabled,
}) {
  const anchor = useRef(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        disabled={disabled}
      >
        {Icon && <Icon size={15} strokeWidth={2} />}
        {children}
      </button>
      <Popover anchorRef={anchor} open={open} onClose={close} align="end" className="w-[290px] p-4" label="Confirm">
        <div className="flex gap-3" onClick={(e) => e.stopPropagation()}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--danger-soft)] text-bad">
            <TriangleAlert size={16} strokeWidth={2.2} />
          </span>
          <p className="pt-1 text-[13.5px] leading-snug text-ink">{message}</p>
        </div>
        <div className={cn('mt-4 flex justify-end gap-2')} onClick={(e) => e.stopPropagation()}>
          <Button variant="secondary" size="sm" onClick={close} data-autofocus autoFocus>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={confirm} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </Popover>
    </>
  );
}
