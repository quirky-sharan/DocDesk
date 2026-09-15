import { useCallback, useRef, useState } from 'react';
import { ChevronDown, Download, FileJson, FileSpreadsheet, FileText, Sheet } from 'lucide-react';
import Popover, { MenuItem } from './Popover';
import { exportUrl } from '../../api/client';

const FORMATS = [
  { format: 'xlsx', label: 'Excel workbook', hint: '.xlsx', icon: FileSpreadsheet },
  { format: 'csv', label: 'CSV spreadsheet', hint: '.csv', icon: Sheet },
  { format: 'pdf', label: 'PDF document', hint: '.pdf', icon: FileText },
  { format: 'json', label: 'JSON data', hint: '.json', icon: FileJson },
];

/** One "Export" button with the formats behind it, instead of four buttons in a row. */
export default function ExportMenu({ table, params, label = 'Export' }) {
  const anchor = useRef(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button ref={anchor} type="button" className="btn-secondary" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        <Download size={15} strokeWidth={2} />
        {label}
        <ChevronDown size={14} strokeWidth={2.2} className="-mr-1 text-ink-3" />
      </button>
      <Popover anchorRef={anchor} open={open} onClose={close} className="w-60 p-1.5" role="menu" label="Export formats">
        <p className="px-2.5 pb-1 pt-1.5 text-[11.5px] font-medium text-ink-3">Download what you're looking at</p>
        {FORMATS.map(({ format, label: name, hint, icon }) => (
          <MenuItem key={format} as="a" href={exportUrl(table, format, params)} icon={icon} hint={hint} onClick={close} download>
            {name}
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}
