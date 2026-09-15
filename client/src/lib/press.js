// A soft ripple from wherever a button is pressed. Installed once, delegated at
// the document, so every button in the app gets it - including ones rendered
// with plain class names - without each component wiring it up.

const SELECTOR = '.btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-danger-solid, .btn-edit, .btn-danger, [data-ripple]';

export function installPressEffects() {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  function onPointerDown(event) {
    if (event.button !== 0 || reduced?.matches) return;
    const target = event.target.closest?.(SELECTOR);
    if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') return;

    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2.4;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left}px`;
    ripple.style.top = `${event.clientY - rect.top}px`;
    ripple.setAttribute('aria-hidden', 'true');
    target.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
    // Belt and braces: if the button unmounts mid-animation the span goes with
    // it, and if animationend never fires (tab hidden) it is still cleaned up.
    setTimeout(() => ripple.remove(), 1200);
  }

  document.addEventListener('pointerdown', onPointerDown, { passive: true });
  return () => document.removeEventListener('pointerdown', onPointerDown);
}
