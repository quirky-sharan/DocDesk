import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp } from 'lucide-react';
import { gsap, playWhenVisible, reduced, useGsap } from '../../lib/gsap';
import { Mark } from './Wordmark';

/**
 * The footer is a real sitemap - every link goes to a page that exists. Anything
 * behind sign-in sends a signed-out visitor to the sign-in screen and then on to
 * where they were headed, so none of these are dead ends.
 */
const COLUMNS = [
  {
    title: 'The desk',
    links: [
      { label: 'Dashboard', to: '/' },
      { label: 'Inventory', to: '/inventory' },
      { label: 'Sales', to: '/sales' },
      { label: 'Incoming stock', to: '/orders' },
    ],
  },
  {
    title: 'Records',
    links: [
      { label: 'Customers', to: '/customers' },
      { label: 'Suppliers', to: '/suppliers' },
      { label: 'Files', to: '/files' },
      { label: 'Messages', to: '/messages' },
    ],
  },
  {
    title: 'Underneath',
    links: [
      { label: 'Reports', to: '/reports' },
      { label: 'Database console', to: '/database' },
      { label: 'Settings', to: '/settings' },
      { label: 'The assistant', href: '#assistant' },
    ],
  },
  {
    title: 'Start',
    links: [
      { label: 'Create an account', to: '/signin?mode=create' },
      { label: 'Sign in', to: '/signin' },
    ],
  },
];

/** The visitor's own clock, ticking. A small sign the page is alive. */
function LocalTime() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <span className="lp-eyebrow lp-num">
      {time} · {zone.replace('_', ' ')}
    </span>
  );
}

export default function Footer({ onTop }) {
  const scope = useGsap(() => {
    if (reduced()) return;

    // The name rises out of its own baseline as the page bottoms out.
    const wordmark = gsap
      .timeline({ paused: true })
      .fromTo('[data-wordmark]', { yPercent: 30, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 1.2, ease: 'expo.out' });
    playWhenVisible(document.querySelector('[data-wordmark]'), wordmark, 'top 95%');

    const columns = gsap
      .timeline({ paused: true })
      .fromTo('[data-foot-col]', { y: 22, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, stagger: 0.07, ease: 'expo.out' });
    playWhenVisible(document.querySelector('[data-foot-grid]'), columns, 'top 88%');
  }, []);

  return (
    <footer ref={scope} className="relative z-10 border-t border-[var(--line)]">
      <div className="lp-shell pb-10 pt-16 sm:pt-24">
        <div data-foot-grid className="grid gap-12 lg:grid-cols-[1.3fr_2.4fr]">
          <div data-foot-col className="max-w-sm">
            <span className="inline-flex items-center gap-2.5">
              <Mark size={22} />
              <span className="text-[19px] font-semibold tracking-[-0.03em]">DocDesk</span>
            </span>
            <p className="mt-5 text-[15px] leading-relaxed text-ink-2">
              A front desk that runs itself. Inventory, sales, receipts and customer records for small
              businesses currently getting by on a spreadsheet.
            </p>
            <p className="mt-6 inline-flex items-center gap-2.5 text-[13px] text-ink-2">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-good" />
              </span>
              Database connected · migrations current
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4">
            {COLUMNS.map((column) => (
              <div data-foot-col key={column.title}>
                <p className="lp-eyebrow mb-5">{column.title}</p>
                <ul className="space-y-1">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      {link.to ? (
                        <Link className="lp-foot-link" to={link.to}>
                          {link.label}
                        </Link>
                      ) : (
                        <a className="lp-foot-link" href={link.href}>
                          {link.label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-20 overflow-hidden">
          <span data-wordmark className="lp-wordmark">
            DocDesk
          </span>
        </div>

        <div className="mt-8 flex flex-col gap-4 border-t border-[var(--line)] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <span className="lp-eyebrow">© {new Date().getFullYear()} DocDesk · Version 1.0</span>
          <LocalTime />
          <button type="button" onClick={onTop} className="lp-link inline-flex items-center gap-2 self-start text-[13px] sm:self-auto">
            Back to top
            <ArrowUp size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
    </footer>
  );
}
