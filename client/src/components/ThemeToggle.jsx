import { useTheme } from '../hooks/useTheme';

const ICONS = {
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  dark: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  system: (
    <>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
};

const LABELS = {
  light: 'Light',
  dark: 'Dark',
  system: 'Match system',
};

/** Cycles system → light → dark. The title says what a click will do next. */
export default function ThemeToggle() {
  const { mode, cycle } = useTheme();
  const next = mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'system';

  return (
    <button
      type="button"
      onClick={cycle}
      className="btn-ghost px-2"
      title={`Theme: ${LABELS[mode]}. Click for ${LABELS[next].toLowerCase()}.`}
      aria-label={`Theme: ${LABELS[mode]}. Click to switch to ${LABELS[next].toLowerCase()}.`}
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {ICONS[mode]}
      </svg>
    </button>
  );
}
