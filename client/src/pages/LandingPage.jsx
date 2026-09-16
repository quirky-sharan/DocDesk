import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import Lenis from 'lenis';
import { ArrowDown, ArrowUpRight } from 'lucide-react';
import { gsap, playWhenVisible, reduced, ScrollTrigger, splitChars, splitWords, useGsap } from '../lib/gsap';
import Scene3D from '../components/three/Scene3D';
import LandingNav from '../components/landing/LandingNav';
import Footer from '../components/landing/Footer';
import SchemaGraphic from '../components/landing/SchemaGraphic';
import { useTheme } from '../hooks/useTheme';
import '../components/landing/landing.css';

/* ===========================================================================
   Content

   Everything claimed on this page is something the product does. There are no
   invented customers, logos or numbers - the figures in the band below are
   counts of the actual thing (screens in the sidebar, tabs in the database
   console, checks in the test suite), which is the only kind of number a
   product with no users yet can honestly put on a page.
=========================================================================== */

const MARQUEE = ['Inventory', 'Sales', 'Receipts', 'Customers', 'Suppliers', 'Reports', 'Backups', 'Audit trail'];

const FIGURES = [
  { value: 11, label: 'screens, one front desk', suffix: '' },
  { value: 21, label: 'rules the database tests on itself', suffix: '' },
  { value: 8, label: 'tabs in the database console', suffix: '' },
  { value: 0, label: 'spreadsheets left open', suffix: '' },
];

const CAPABILITIES = [
  {
    name: 'Stock that counts itself',
    detail:
      'Every change is a row in the ledger and a trigger keeps each balance in step, inside the same transaction. Stock cannot go negative because the database will not let it.',
  },
  {
    name: 'A till with a live receipt',
    detail:
      'Two panes: what is being bought on the left, the receipt writing itself on the right. Part payments and refunds go in as payments, and the sale works out its own status.',
  },
  {
    name: 'Customers who are remembered',
    detail:
      'Lifetime value, visits, what is owed and what they tend to buy - assembled from the sales themselves rather than typed in twice.',
  },
  {
    name: 'Reports for any period',
    detail:
      'Revenue, profit and margin against the period before, busy hours, a typical week, where the money goes - counted in your own timezone.',
  },
  {
    name: 'Orders that arrive in parts',
    detail:
      'Raise an order against a supplier, receive half of it today and the rest on Friday, and the stock ledger keeps up on its own.',
  },
  {
    name: 'A database you can open',
    detail:
      'Browse tables, trace a row to everything it touches, run SQL with a visual plan, read the audit trail, check integrity, take a backup.',
  },
];

const CARDS = [
  { title: 'Low-stock alerts', body: 'Raised by a trigger the moment stock crosses the reorder level - not by a job that might not run.' },
  { title: 'An audit trail', body: 'The before and after of every insert, update and delete, with who did it: you, the assistant, or the SQL console.' },
  { title: 'Nobody overwrites anybody', body: 'Each edit checks a row version, so two people saving the same record cannot silently lose one of the changes.' },
  { title: 'Backups that restore', body: 'One compressed file with every record, made daily, put back in a single transaction.' },
  { title: 'Search that forgives typos', body: 'Trigram indexes across products, customers, suppliers and sales. Ctrl+K from anywhere.' },
  { title: 'Paper when you need it', body: 'Receipts and reports print without the app around them, or come out as PDF.' },
];

/* ===========================================================================
   Small pieces
=========================================================================== */

/** A headline that arrives character by character from behind its own baseline. */
function Display({ children, className = '', delay = 0, trigger, ...rest }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const chars = splitChars(element);
    if (!chars.length) return undefined;
    if (reduced()) {
      gsap.set(chars, { yPercent: 0, opacity: 1 });
      return undefined;
    }
    const context = gsap.context(() => {
      const timeline = gsap.timeline({ paused: Boolean(trigger) });
      timeline.fromTo(
        chars,
        { yPercent: 118 },
        { yPercent: 0, duration: 1.15, delay, ease: 'expo.out', stagger: 0.016 }
      );
      if (trigger) playWhenVisible(element, timeline);
    }, ref);
    return () => context.revert();
  }, [delay, trigger]);

  return (
    <span ref={ref} className={className} {...rest}>
      {children}
    </span>
  );
}

/** Body copy that lifts in a word at a time. */
function Lede({ children, className = '', delay = 0, trigger, ...rest }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const words = splitWords(element);
    if (!words.length || reduced()) return undefined;
    const context = gsap.context(() => {
      const timeline = gsap.timeline({ paused: Boolean(trigger) });
      timeline.fromTo(
        words,
        { yPercent: 110 },
        { yPercent: 0, duration: 0.9, delay, ease: 'expo.out', stagger: 0.012 }
      );
      if (trigger) playWhenVisible(element, timeline, 'top 88%');
    }, ref);
    return () => context.revert();
  }, [delay, trigger]);

  return (
    <p ref={ref} className={className} {...rest}>
      {children}
    </p>
  );
}

/** A figure that counts up the first time it is seen, then stays put. */
function Figure({ value, label, index }) {
  const number = useRef(null);

  const scope = useGsap(() => {
    const element = number.current;
    if (!element) return;
    if (reduced()) {
      element.textContent = String(value);
      return;
    }
    const counter = { n: 0 };
    const timeline = gsap.timeline({ paused: true }).to(counter, {
      n: value,
      duration: 1.6,
      ease: 'expo.out',
      onUpdate: () => {
        element.textContent = String(Math.round(counter.n));
      },
    });
    playWhenVisible(element, timeline, 'top 90%');
  }, [value]);

  return (
    <div ref={scope} className="border-t border-[var(--line)] pt-5">
      <p className="lp-eyebrow mb-6">{String(index + 1).padStart(2, '0')}</p>
      <p ref={number} className="lp-num text-[clamp(3rem,7vw,6rem)] font-semibold leading-[0.85]">
        0
      </p>
      <p className="mt-4 max-w-[22ch] text-[14px] leading-snug text-ink-2">{label}</p>
    </div>
  );
}

/** Pulls a button gently towards the pointer, and lets go when it leaves. */
function useMagnetic() {
  const ref = useRef(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || reduced() || window.matchMedia('(pointer: coarse)').matches) return undefined;

    const quickX = gsap.quickTo(element, 'x', { duration: 0.5, ease: 'power3.out' });
    const quickY = gsap.quickTo(element, 'y', { duration: 0.5, ease: 'power3.out' });

    function onMove(event) {
      const rect = element.getBoundingClientRect();
      quickX((event.clientX - (rect.left + rect.width / 2)) * 0.28);
      quickY((event.clientY - (rect.top + rect.height / 2)) * 0.34);
    }
    function onLeave() {
      quickX(0);
      quickY(0);
    }

    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerleave', onLeave);
    return () => {
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerleave', onLeave);
      gsap.set(element, { x: 0, y: 0 });
    };
  }, []);

  return ref;
}

/** A flat stand-in for the 3D hero where WebGL is unavailable. */
function HeroFallback() {
  return (
    <div className="absolute inset-0 grid place-items-center p-8">
      <div className="w-full max-w-md border border-[var(--line)] bg-surface/60 p-8">
        <p className="lp-eyebrow mb-8">This week</p>
        <div className="flex h-40 items-end gap-2">
          {[34, 52, 41, 68, 55, 83, 62, 95, 71, 100, 78, 58].map((value, i) => (
            <span
              key={i}
              className="flex-1"
              style={{ height: `${value}%`, background: value === 100 ? 'rgb(var(--c-accent))' : 'rgb(var(--c-text) / 0.18)' }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ===========================================================================
   Sections
=========================================================================== */

function Hero({ dark, onJump }) {
  const cta = useMagnetic();

  const scope = useGsap(() => {
    if (reduced()) return;
    gsap.set(['[data-hero-fade]'], { opacity: 0, y: 18 });
    gsap.set('[data-hero-stage]', { opacity: 0, scale: 0.94 });
    gsap.set('[data-hero-rule]', { scaleX: 0 });

    const timeline = gsap.timeline({ defaults: { ease: 'expo.out' } });
    timeline
      .to('[data-hero-stage]', { opacity: 1, scale: 1, duration: 1.8 }, 0.1)
      .to('[data-hero-fade]', { opacity: 1, y: 0, duration: 1, stagger: 0.09 }, 0.75)
      .to('[data-hero-rule]', { scaleX: 1, duration: 1.4 }, 0.4);

    // The whole hero drifts up a little faster than the page scrolls past it.
    gsap.to('[data-hero-parallax]', {
      yPercent: -12,
      ease: 'none',
      scrollTrigger: { trigger: '[data-hero]', start: 'top top', end: 'bottom top', scrub: true },
    });
  }, []);

  return (
    <section ref={scope} className="relative min-h-[100svh] pt-[72px]">
      <div data-hero className="lp-shell relative grid min-h-[calc(100svh-72px)] grid-cols-1 items-center gap-8 pb-28 pt-8 lg:grid-cols-[1.08fr_0.92fr] lg:gap-0 lg:pb-24">
        <div data-hero-parallax className="relative z-10">
          <p data-hero-fade className="lp-eyebrow mb-8">DocDesk — for the shop, clinic and studio</p>

          <h1 className="lp-display">
            <span className="lp-mask">
              <Display delay={0.15}>The front desk</Display>
            </span>
            <span className="lp-mask">
              <Display delay={0.28}>that runs itself.</Display>
            </span>
          </h1>

          <Lede data-hero-fade className="lp-lede mt-8" delay={0.75}>
            Inventory, sales, receipts and customer records in one place, on a real database that keeps
            itself correct. Built for people who never wanted to think about software.
          </Lede>

          <div data-hero-fade className="mt-10 flex flex-wrap items-center gap-3">
            <Link ref={cta} to="/signin?mode=create" className="lp-cta lp-cta-solid">
              Create an account
              <ArrowUpRight size={16} strokeWidth={2} className="lp-arrow" />
            </Link>
            <button type="button" onClick={() => onJump('#does')} className="lp-cta lp-cta-line">
              See what it does
            </button>
          </div>

          <p data-hero-fade className="mt-8 text-[13px] text-ink-3">
            Free to set up · No card · Your data stays in your own database
          </p>
        </div>

        {/* The stage. On small screens it sits above the headline at a reduced
            height so the words are still the first thing read. */}
        <div
          data-hero-stage
          className="relative h-[38svh] w-full min-w-0 lg:h-[74vh]"
        >
          <Scene3D
            load={() => import('../components/three/DeskScene3D')}
            fallback={<HeroFallback />}
            height="100%"
            className="absolute inset-0"
            dark={dark}
          />
        </div>
      </div>

      <div className="lp-shell absolute inset-x-0 bottom-0 z-10 pb-6">
        <div data-hero-rule className="lp-rule mb-4" />
        <div data-hero-fade className="flex items-center justify-between gap-4">
          <button type="button" onClick={() => onJump('#does')} className="lp-eyebrow inline-flex items-center gap-2 hover:text-ink">
            <ArrowDown size={13} strokeWidth={2} />
            Scroll
          </button>
          <span className="lp-eyebrow hidden sm:inline">Postgres · React · Three.js</span>
          <span className="lp-eyebrow">001 / 009</span>
        </div>
      </div>
    </section>
  );
}

function Ticker() {
  const scope = useGsap(() => {
    const track = document.querySelector('[data-marquee]');
    if (!track || reduced()) return;
    // The list is rendered twice; moving exactly one copy's width and wrapping
    // gives a seam-free loop at any screen size.
    const distance = track.scrollWidth / 2;
    gsap.to(track, {
      x: -distance,
      duration: 26,
      ease: 'none',
      repeat: -1,
      modifiers: { x: (value) => `${gsap.utils.wrap(-distance, 0, parseFloat(value))}px` },
    });
  }, []);

  const items = [...MARQUEE, ...MARQUEE];

  return (
    <div ref={scope} className="overflow-hidden border-y border-[var(--line)] py-6">
      <div data-marquee className="lp-marquee" aria-hidden="true">
        {items.map((item, i) => (
          <span key={`${item}-${i}`} className="lp-marquee-item">
            {item}
            <span className="lp-marquee-dot" />
          </span>
        ))}
      </div>
      <span className="sr-only">DocDesk covers inventory, sales, receipts, customers, suppliers, reports, backups and an audit trail.</span>
    </div>
  );
}

function Figures() {
  return (
    <section className="lp-section">
      <div className="lp-shell grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4">
        {FIGURES.map((figure, i) => (
          <Figure key={figure.label} value={figure.value} label={figure.label} index={i} />
        ))}
      </div>
    </section>
  );
}

function Capabilities() {
  return (
    <section id="does" className="lp-section scroll-mt-20">
      <div className="lp-shell">
        <div className="mb-16 grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-end">
          <h2 className="lp-h2">
            <span className="lp-mask">
              <Display trigger>Six things a front</Display>
            </span>
            <span className="lp-mask">
              <Display trigger delay={0.06}>desk has to do.</Display>
            </span>
          </h2>
          <Lede trigger className="lp-lede lg:justify-self-end">
            Not six modules to configure. Six jobs that were already being done by hand, done by the
            software instead — and done the same way whether you click, type or ask.
          </Lede>
        </div>

        <div>
          {CAPABILITIES.map((item, i) => (
            <div key={item.name} className="lp-row">
              <span className="lp-eyebrow pt-2">{String(i + 1).padStart(2, '0')}</span>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-baseline lg:gap-10">
                <h3 className="lp-h3">{item.name}</h3>
                <p className="lp-row-detail text-[15px] leading-relaxed">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Database() {
  return (
    <section id="database" className="lp-section scroll-mt-20 border-t border-[var(--line)]">
      <div className="lp-shell grid gap-16 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <p className="lp-eyebrow mb-8">02 — Underneath</p>
          <h2 className="lp-h2">
            <span className="lp-mask">
              <Display trigger>The rules live</Display>
            </span>
            <span className="lp-mask">
              <Display trigger delay={0.06}>in the database.</Display>
            </span>
          </h2>
          <Lede trigger className="lp-lede mt-7">
            Not in the app, where a second way of writing to the data could route around them. Foreign
            keys, CHECK constraints and triggers hold whether the write came from a page, the
            assistant, or someone typing SQL.
          </Lede>

          <dl className="mt-10 space-y-0">
            {[
              ['Versioned migrations', 'Checksummed and applied in order on start.'],
              ['A stock ledger', 'Every movement recorded; balances kept by trigger.'],
              ['Payments drive status', 'Paid, part paid or unpaid is worked out, never typed.'],
              ['Reporting views', 'Counted in the business timezone, not the server one.'],
            ].map(([term, description]) => (
              <div key={term} className="border-t border-[var(--line)] py-4">
                <dt className="text-[15px] font-medium">{term}</dt>
                <dd className="mt-1 text-[14px] text-ink-2">{description}</dd>
              </div>
            ))}
          </dl>

          <Link to="/database" className="lp-link mt-8 inline-flex items-center gap-2 text-[15px]">
            Open the database console
            <ArrowUpRight size={15} strokeWidth={2} />
          </Link>
        </div>

        <div className="min-w-0 self-center text-ink">
          <SchemaGraphic />
          <p className="lp-eyebrow mt-6">Five of the tables · foreign keys drawn to scale</p>
        </div>
      </div>
    </section>
  );
}

/** The assistant section: one request, typed out, and the card it produces. */
function Assistant() {
  const typed = useRef(null);
  const sentence = 'Sell 3 sticky notes to Priya, paid by UPI';

  const scope = useGsap(() => {
    const element = typed.current;
    if (!element) return;
    if (reduced()) {
      element.textContent = sentence;
      gsap.set('[data-confirm]', { opacity: 1, y: 0 });
      return;
    }

    gsap.set('[data-confirm]', { opacity: 0, y: 16 });
    const state = { count: 0 };
    const timeline = gsap.timeline({ paused: true });
    timeline
      .to(state, {
        count: sentence.length,
        duration: 1.9,
        ease: 'none',
        onUpdate: () => {
          element.textContent = sentence.slice(0, Math.round(state.count));
        },
      })
      .to('[data-confirm]', { opacity: 1, y: 0, duration: 0.9, ease: 'expo.out' }, '+=0.25');
    playWhenVisible(document.querySelector('[data-assistant]'), timeline, 'top 65%');
  }, []);

  return (
    <section id="assistant" ref={scope} className="lp-section scroll-mt-20 border-t border-[var(--line)]">
      <div className="lp-shell" data-assistant>
        <p className="lp-eyebrow mb-10">03 — The assistant</p>
        <blockquote className="lp-quote max-w-[18ch]">
          <span className="lp-mask">
            <Display trigger>Say it in</Display>
          </span>
          <span className="lp-mask">
            <Display trigger delay={0.06}>a sentence.</Display>
          </span>
        </blockquote>

        <div className="mt-14 grid gap-10 lg:grid-cols-[1fr_1fr] lg:gap-16">
          <div>
            <div className="border border-[var(--line)] bg-surface/60 p-6">
              <p className="lp-eyebrow mb-4">You</p>
              <p className="min-h-[3.5rem] text-[19px] leading-snug tracking-[-0.02em]">
                <span ref={typed} />
                <span className="lp-caret" aria-hidden="true" />
              </p>
            </div>

            <div data-confirm className="mt-4 border border-[var(--line)] bg-surface p-6">
              <p className="lp-eyebrow mb-5">DocDesk — waiting for you to confirm</p>
              <dl className="space-y-2.5 text-[14px]">
                {[
                  ['Sale', '3 × Sticky notes, 5×3in'],
                  ['Customer', 'Priya Raman'],
                  ['Payment', 'UPI · ₹135.00'],
                  ['Stock after', '41 remaining'],
                ].map(([term, value]) => (
                  <div key={term} className="flex items-baseline justify-between gap-6 border-b border-[var(--line)] pb-2.5 last:border-0">
                    <dt className="text-ink-3">{term}</dt>
                    <dd className="text-right font-medium tabular">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-6 flex gap-2">
                <span className="lp-cta lp-cta-solid h-10 px-4 text-[13px]">Record the sale</span>
                <span className="lp-cta lp-cta-line h-10 px-4 text-[13px]">Cancel</span>
              </div>
            </div>
          </div>

          <div className="lg:pt-4">
            <Lede trigger className="lp-lede">
              The assistant can read the whole database and work the answer out, open the right page
              with the right filter already set, or draft a sale. What it will never do is change
              anything on its own.
            </Lede>
            <ul className="mt-10">
              {[
                'How are we doing today?',
                'What needs reordering?',
                'Show me unpaid sales',
                'Order everything that is running low',
                'Back up the database now',
              ].map((line) => (
                <li key={line} className="border-t border-[var(--line)] py-3.5 text-[15px] text-ink-2 last:border-b">
                  {line}
                </li>
              ))}
            </ul>
            <p className="mt-8 text-[13px] text-ink-3">
              Anything that adds, edits, deletes or orders shows a card with exactly what will happen,
              and waits.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Details() {
  const scope = useGsap(() => {
    if (reduced()) return;
    const timeline = gsap
      .timeline({ paused: true })
      .fromTo('[data-card]', { opacity: 0, y: 28 }, { opacity: 1, y: 0, duration: 1, stagger: 0.07, ease: 'expo.out' });
    playWhenVisible(document.querySelector('[data-cards]'), timeline, 'top 82%');
  }, []);

  return (
    <section ref={scope} className="lp-section border-t border-[var(--line)]">
      <div className="lp-shell">
        <h2 className="lp-h2 mb-14 max-w-[16ch]">
          <span className="lp-mask">
            <Display trigger>The quiet parts.</Display>
          </span>
        </h2>
        <div data-cards className="grid gap-px border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((card, i) => (
            <article data-card key={card.title} className="lp-card border-0">
              <p className="lp-card-index mb-10">{String(i + 1).padStart(2, '0')}</p>
              <h3 className="text-[17px] font-semibold tracking-[-0.02em]">{card.title}</h3>
              <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">{card.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closing() {
  const cta = useMagnetic();
  return (
    <section className="lp-section border-t border-[var(--line)]">
      <div className="lp-shell text-center">
        <p className="lp-eyebrow mb-10">Ready when you are</p>
        <h2 className="lp-display mx-auto max-w-[14ch]">
          <span className="lp-mask">
            <Display trigger>Put the</Display>
          </span>
          <span className="lp-mask">
            <Display trigger delay={0.06}>spreadsheet down.</Display>
          </span>
        </h2>
        <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
          <Link ref={cta} to="/signin?mode=create" className="lp-cta lp-cta-solid">
            Create an account
            <ArrowUpRight size={16} strokeWidth={2} className="lp-arrow" />
          </Link>
          <Link to="/signin" className="lp-cta lp-cta-line">
            I already have one
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ===========================================================================
   The page
=========================================================================== */

export default function LandingPage() {
  const { isDark } = useTheme();
  const lenis = useRef(null);
  const root = useRef(null);
  const cursor = useRef(null);
  const progress = useRef(null);

  // Lenis drives the page and GSAP drives Lenis, so scroll-linked animations
  // are computed on the same tick as the scroll position they depend on -
  // otherwise pinned and scrubbed sections lag half a frame behind.
  useLayoutEffect(() => {
    if (reduced()) return undefined;

    const instance = new Lenis({ lerp: 0.1, wheelMultiplier: 0.95, smoothWheel: true, autoRaf: false });
    lenis.current = instance;
    instance.on('scroll', ScrollTrigger.update);

    const tick = (time) => instance.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33);
      instance.destroy();
      lenis.current = null;
    };
  }, []);

  // The hairline at the very top, and the ring that follows the pointer.
  useLayoutEffect(() => {
    const context = gsap.context(() => {
      if (progress.current) {
        gsap.to(progress.current, {
          scaleX: 1,
          ease: 'none',
          scrollTrigger: { start: 0, end: 'max', scrub: 0.25 },
        });
      }
    }, root);
    return () => context.revert();
  }, []);

  useEffect(() => {
    const ring = cursor.current;
    if (!ring || reduced() || window.matchMedia('(pointer: coarse)').matches) return undefined;

    const quickX = gsap.quickTo(ring, 'x', { duration: 0.35, ease: 'power3.out' });
    const quickY = gsap.quickTo(ring, 'y', { duration: 0.35, ease: 'power3.out' });
    let shown = false;

    function onMove(event) {
      if (!shown) {
        shown = true;
        gsap.to(ring, { opacity: 1, duration: 0.3 });
      }
      quickX(event.clientX);
      quickY(event.clientY);
      // Swell over anything that can be clicked, so the ring says where it is.
      const interactive = event.target.closest?.('a, button, [data-magnetic], .lp-row');
      gsap.to(ring, { scale: interactive ? 1.9 : 1, duration: 0.3, ease: 'power3.out', overwrite: 'auto' });
    }
    function onLeave() {
      shown = false;
      gsap.to(ring, { opacity: 0, duration: 0.2 });
    }

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  // ScrollTrigger measures the page on mount, before web fonts have swapped and
  // before the 3D canvas has sized itself. A refresh once everything has
  // settled keeps every start/end honest.
  useEffect(() => {
    const id = setTimeout(() => ScrollTrigger.refresh(), 600);
    const onLoad = () => ScrollTrigger.refresh();
    window.addEventListener('load', onLoad);
    document.fonts?.ready.then(onLoad).catch(() => {});
    return () => {
      clearTimeout(id);
      window.removeEventListener('load', onLoad);
    };
  }, []);

  const jump = useCallback((target) => {
    const element = typeof target === 'string' ? document.querySelector(target) : target;
    if (lenis.current && element) lenis.current.scrollTo(element, { offset: -72, duration: 1.3 });
    else element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const toTop = useCallback(() => {
    if (lenis.current) lenis.current.scrollTo(0, { duration: 1.4 });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div ref={root} className="lp relative">
      <div className="lp-backdrop" aria-hidden="true">
        <div className="lp-glow" />
        <div className="grain absolute inset-[-50%]" />
      </div>
      <div ref={progress} className="lp-progress" aria-hidden="true" />
      <div ref={cursor} className="lp-cursor" aria-hidden="true" />

      <LandingNav onJump={jump} />

      <main className="relative z-10">
        <Hero dark={isDark} onJump={jump} />
        <Ticker />
        <Figures />
        <Capabilities />
        <Database />
        <Assistant />
        <Details />
        <Closing />
      </main>

      <Footer onTop={toTop} />
    </div>
  );
}
