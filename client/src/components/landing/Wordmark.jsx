/**
 * The DocDesk mark: a ledger page with two entries on it, drawn on a 24 grid
 * from three rectangles. Geometric on purpose - it holds up at 18px in the nav
 * and at 200px in the footer without a second version.
 */
export function Mark({ size = 20, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3.25" y="2.75" width="17.5" height="18.5" rx="3.25" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7.75 9.25h8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7.75 14.25h4.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Mark plus name, used in the nav and as the link back from the sign-in page. */
export default function Wordmark({ size = 19, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Mark size={size + 3} />
      <span
        style={{ fontSize: size, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1 }}
      >
        DocDesk
      </span>
    </span>
  );
}
