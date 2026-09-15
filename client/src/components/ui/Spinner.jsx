/** The eight-spoke activity indicator. Inherits colour from the text around it. */
export default function Spinner({ size = 16, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`animate-spin ${className}`}
      style={{ animationDuration: '0.9s', animationTimingFunction: 'steps(8)' }}
      aria-hidden="true"
    >
      {Array.from({ length: 8 }, (_, i) => (
        <rect
          key={i}
          x="11"
          y="2.5"
          width="2"
          height="5.5"
          rx="1"
          fill="currentColor"
          opacity={0.25 + (i / 8) * 0.75}
          transform={`rotate(${i * 45} 12 12)`}
        />
      ))}
    </svg>
  );
}
