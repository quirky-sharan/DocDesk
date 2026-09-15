import { useId } from 'react';

/**
 * The DocDesk mark: a glossy app tile with a receipt folding out of it. Drawn in
 * SVG so it stays crisp at any size and needs no image asset.
 */
export default function AppIcon({ size = 36, className = '' }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="DocDesk"
      style={{ filter: 'drop-shadow(0 4px 10px rgb(10 132 255 / 0.35))' }}
    >
      <defs>
        <linearGradient id={`${id}-tile`} x1="8" y1="4" x2="56" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3aa0ff" />
          <stop offset="0.55" stopColor="#0a6cff" />
          <stop offset="1" stopColor="#5e5ce6" />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="32" y1="2" x2="32" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-paper`} x1="22" y1="14" x2="42" y2="50" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dfe9ff" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="15" fill={`url(#${id}-tile)`} />
      <path d="M2 17C2 8.7 8.7 2 17 2h30c8.3 0 15 6.7 15 15v5C44 30 20 30 2 22z" fill={`url(#${id}-shine)`} />
      {/* receipt with a torn edge */}
      <path
        d="M21 14.5h22a2 2 0 0 1 2 2V48l-3.2-2.2L38.6 48l-3.3-2.2L32 48l-3.3-2.2L25.4 48l-3.2-2.2L19 48V16.5a2 2 0 0 1 2-2z"
        fill={`url(#${id}-paper)`}
      />
      <rect x="24.5" y="21" width="15" height="2.6" rx="1.3" fill="#0a6cff" opacity="0.85" />
      <rect x="24.5" y="27.5" width="10" height="2.2" rx="1.1" fill="#8aa6d6" />
      <rect x="24.5" y="33" width="12.5" height="2.2" rx="1.1" fill="#8aa6d6" />
      <rect x="24.5" y="38.5" width="7" height="2.2" rx="1.1" fill="#8aa6d6" />
      <rect x="2.5" y="2.5" width="59" height="59" rx="14.5" fill="none" stroke="#fff" strokeOpacity="0.25" />
    </svg>
  );
}
