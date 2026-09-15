// The UI kit, gathered in one import. Each piece lives in components/ui/.
import { useSettings } from '../lib/settings';
import ExportMenu from './ui/ExportMenu';

export { default as Button } from './ui/Button';
export { default as Badge } from './ui/Badge';
export { default as Avatar } from './ui/Avatar';
export { Card, CardHeader } from './ui/Card';
export { default as PageHeader } from './ui/PageHeader';
export { Field, SearchInput, Select } from './ui/Field';
export { default as SegmentedControl } from './ui/SegmentedControl';
export { default as Popover, MenuItem } from './ui/Popover';
export { default as Tooltip } from './ui/Tooltip';
export { default as Modal } from './ui/Modal';
export { default as ConfirmButton } from './ui/ConfirmButton';
export { default as Table, Pagination } from './ui/Table';
export { default as Empty } from './ui/Empty';
export { Notice, ErrorNote } from './ui/Notice';
export { useToast } from './ui/Toast';
export { default as Spinner } from './ui/Spinner';
export { formatBytes } from '../lib/format';
export { ExportMenu };

/** An amount of money in the shop's currency. */
export function Money({ value, className }) {
  const { money } = useSettings();
  return <span className={`tabular ${className || ''}`}>{money(value)}</span>;
}

/** Kept for older call sites: the export control is now a single menu. */
export function ExportButtons({ table, params }) {
  return <ExportMenu table={table} params={params} />;
}
