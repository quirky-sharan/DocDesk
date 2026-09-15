/** Joins class names, skipping anything falsy. */
export function cn(...parts) {
  return parts.flat().filter(Boolean).join(' ');
}
