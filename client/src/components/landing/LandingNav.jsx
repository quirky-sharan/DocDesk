import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, X } from 'lucide-react';
import { gsap, reduced, ScrollTrigger, useGsap } from '../../lib/gsap';
import Wordmark from './Wordmark';

const LINKS = [
  { label: 'What it does', href: '#does' },
  { label: 'The database', href: '#database' },
  { label: 'The assistant', href: '#assistant' },
];

/**
 * Fixed navigation. Transparent over the hero, then a hairline and glass once
 * anything has scrolled under it. The menu on small screens is a full sheet
 * with the links staggering in - the same movement as the hero headline, so
 * the page has one idea of how things arrive.
 */
export default function LandingNav({ onJump }) {
  const [open, setOpen] = useState(false);
  const bar = useRef(null);
  const sheet = useRef(null);

  // The glass is a class, not a tween: the values involved are CSS variables
  // and a backdrop-filter, none of which GSAP can interpolate. ScrollTrigger
  // flips the class and the stylesheet does the 0.3s crossfade.
  const scope = useGsap(() => {
    const element = bar.current;
    if (!element) return;
    ScrollTrigger.create({
      start: 24,
      end: 'max',
      onToggle: (self) => element.classList.toggle('lp-nav-solid', self.isActive),
    });
  }, []);

  // The sheet locks the page behind it, and Escape closes it.
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !sheet.current || reduced()) return undefined;
    const context = gsap.context(() => {
      gsap.from('[data-sheet-item]', { yPercent: 120, opacity: 0, duration: 0.7, stagger: 0.05, ease: 'expo.out' });
    }, sheet);
    return () => context.revert();
  }, [open]);

  function jump(event, href) {
    event.preventDefault();
    setOpen(false);
    onJump?.(href);
  }

  return (
    <div ref={scope}>
      <header ref={bar} className="lp-nav">
        <div className="lp-shell flex h-[72px] items-center justify-between gap-6">
          <Link to="/" className="flex items-center" aria-label="DocDesk home">
            <Wordmark />
          </Link>

          <nav className="hidden items-center gap-9 md:flex" aria-label="Sections">
            {LINKS.map((link) => (
              <a key={link.href} href={link.href} onClick={(e) => jump(e, link.href)} className="lp-link text-[14px] text-ink-2 hover:text-ink">
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2 sm:gap-4">
            <Link to="/signin" className="lp-link hidden text-[14px] sm:inline-block">
              Sign in
            </Link>
            <Link to="/signin?mode=create" className="lp-cta lp-cta-solid h-10 px-5 text-[14px]">
              Get started
              <ArrowUpRight size={15} strokeWidth={2} className="lp-arrow" />
            </Link>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="-mr-2 flex h-10 w-10 items-center justify-center md:hidden"
              aria-label="Open menu"
              aria-expanded={open}
            >
              <span className="flex w-5 flex-col gap-[5px]">
                <span className="h-px w-full bg-current" />
                <span className="h-px w-full bg-current" />
              </span>
            </button>
          </div>
        </div>
      </header>

      {open && (
        <div ref={sheet} className="fixed inset-0 z-[60] md:hidden" style={{ background: 'rgb(var(--c-canvas))' }} role="dialog" aria-modal="true" aria-label="Menu">
          <div className="lp-shell flex h-[72px] items-center justify-between">
            <Wordmark />
            <button type="button" onClick={() => setOpen(false)} className="-mr-2 flex h-10 w-10 items-center justify-center" aria-label="Close menu">
              <X size={20} strokeWidth={1.6} />
            </button>
          </div>
          <div className="lp-shell mt-8 flex flex-col">
            {LINKS.map((link, i) => (
              <span key={link.href} className="lp-mask border-t border-[var(--line)] py-4">
                <a data-sheet-item href={link.href} onClick={(e) => jump(e, link.href)} className="flex items-baseline gap-4 text-[30px] font-semibold tracking-[-0.035em]">
                  <span className="lp-eyebrow">{String(i + 1).padStart(2, '0')}</span>
                  {link.label}
                </a>
              </span>
            ))}
            <span className="lp-mask border-y border-[var(--line)] py-4">
              <Link data-sheet-item to="/signin" className="flex items-baseline gap-4 text-[30px] font-semibold tracking-[-0.035em]">
                <span className="lp-eyebrow">04</span>
                Sign in
              </Link>
            </span>
            <Link to="/signin?mode=create" className="lp-cta lp-cta-solid mt-10 w-full">
              Get started
              <ArrowUpRight size={16} strokeWidth={2} className="lp-arrow" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
