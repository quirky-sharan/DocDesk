import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, Loader2 } from 'lucide-react';
import { gsap, reduced } from '../lib/gsap';
import { readableAuthError, useAuth } from '../auth/AuthProvider';
import Scene3D from '../components/three/Scene3D';
import Wordmark from '../components/landing/Wordmark';
import GoogleMark from '../components/landing/GoogleMark';
import { useTheme } from '../hooks/useTheme';
import '../components/landing/landing.css';

/**
 * Sign in and create an account, on one screen.
 *
 * The two are the same form with one extra field, so they are one component
 * with a mode rather than two pages that drift apart. ?mode=create opens it on
 * the second tab, which is what every "Get started" on the landing page links
 * to.
 */
export default function AuthPage() {
  const { user, signIn, signUp, signInWithGoogle, resetPassword } = useAuth();
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();

  const mode = params.get('mode') === 'create' ? 'create' : 'signin';
  const creating = mode === 'create';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const emailField = useRef(null);

  // Where they were going before they were asked to sign in.
  const destination = location.state?.from?.pathname || '/';

  useEffect(() => {
    if (user) navigate(destination, { replace: true });
  }, [user, destination, navigate]);

  // Both effects are scoped to the same root, so they share one ref rather than
  // each making their own - a gsap.context with an unattached scope falls back
  // to searching the whole document.
  const root = useRef(null);

  useLayoutEffect(() => {
    if (reduced()) return undefined;
    const context = gsap.context(() => {
      gsap.from('[data-auth-item]', { y: 20, opacity: 0, duration: 0.9, stagger: 0.06, ease: 'expo.out', delay: 0.05 });
      gsap.from('[data-auth-aside]', { opacity: 0, duration: 1.4, ease: 'expo.out' });
    }, root);
    return () => context.revert();
  }, []);

  // Switching tabs re-runs the small entrance on the fields that changed, so
  // the extra name field arrives rather than appearing.
  useLayoutEffect(() => {
    if (reduced()) return undefined;
    const context = gsap.context(() => {
      gsap.from('[data-auth-fields] > *', { y: 12, opacity: 0, duration: 0.55, stagger: 0.05, ease: 'expo.out' });
    }, root);
    return () => context.revert();
  }, [mode]);

  function switchMode(next) {
    setError('');
    setNotice('');
    setParams(next === 'create' ? { mode: 'create' } : {}, { replace: true });
  }

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    setNotice('');

    if (!email.trim()) {
      setError('Enter the email address for the account.');
      emailField.current?.focus();
      return;
    }
    if (password.length < 6) {
      setError(creating ? 'Pick a password of at least 6 characters.' : 'Enter your password.');
      return;
    }

    setBusy('email');
    try {
      if (creating) await signUp(email, password, name);
      else await signIn(email, password);
      // The effect above navigates as soon as Firebase reports the new user.
    } catch (caught) {
      setError(readableAuthError(caught));
      setBusy('');
    }
  }

  async function onGoogle() {
    setError('');
    setNotice('');
    setBusy('google');
    try {
      await signInWithGoogle();
    } catch (caught) {
      setError(readableAuthError(caught));
    } finally {
      setBusy('');
    }
  }

  async function onReset() {
    setError('');
    setNotice('');
    if (!email.trim()) {
      setError('Enter your email address first, then ask for a reset link.');
      emailField.current?.focus();
      return;
    }
    setBusy('reset');
    try {
      await resetPassword(email);
      setNotice(`A link to set a new password is on its way to ${email.trim()}.`);
    } catch (caught) {
      setError(readableAuthError(caught));
    } finally {
      setBusy('');
    }
  }

  const working = Boolean(busy);

  return (
    <div ref={root} className="lp grid min-h-[100svh] lg:grid-cols-[1fr_1.05fr]">
      {/* --- the form ------------------------------------------------------ */}
      <div className="relative flex flex-col px-6 py-8 sm:px-12 lg:px-16">
        <div data-auth-item className="flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center" aria-label="DocDesk home">
            <Wordmark />
          </Link>
          <Link to="/" className="lp-link inline-flex items-center gap-2 text-[13px] text-ink-2">
            <ArrowLeft size={14} strokeWidth={2} />
            Back
          </Link>
        </div>

        <div className="flex flex-1 items-center py-12">
          <div className="w-full max-w-[26rem]">
            <p data-auth-item className="lp-eyebrow mb-6">{creating ? 'New account' : 'Welcome back'}</p>
            <h1 data-auth-item className="text-[clamp(2rem,4vw,2.75rem)] font-semibold leading-[1.02] tracking-[-0.035em]">
              {creating ? 'Set up your front desk.' : 'Open your front desk.'}
            </h1>
            <p data-auth-item className="mt-4 text-[15px] leading-relaxed text-ink-2">
              {creating
                ? 'One account for the whole shop. It takes about a minute and there is nothing to install.'
                : 'Sign in to pick up where the day left off.'}
            </p>

            {/* The two modes, as a segmented control. */}
            <div data-auth-item className="mt-9 grid grid-cols-2 gap-0 border-b border-[var(--line)]">
              {[
                ['signin', 'Sign in'],
                ['create', 'Create account'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => switchMode(value)}
                  className="relative -mb-px py-3 text-[14px] font-medium transition-colors duration-300"
                  style={{
                    color: mode === value ? 'rgb(var(--c-text))' : 'rgb(var(--c-text-3))',
                    borderBottom: `1px solid ${mode === value ? 'rgb(var(--c-text))' : 'transparent'}`,
                  }}
                  aria-pressed={mode === value}
                >
                  {label}
                </button>
              ))}
            </div>

            <form onSubmit={onSubmit} className="mt-8" noValidate>
              <div data-auth-fields className="space-y-4">
                {creating && (
                  <label className="block">
                    <span className="lp-eyebrow mb-2 block">Your name</span>
                    <input
                      className="input-field"
                      type="text"
                      value={name}
                      autoComplete="name"
                      placeholder="Priya Raman"
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                )}

                <label className="block">
                  <span className="lp-eyebrow mb-2 block">Email</span>
                  <input
                    ref={emailField}
                    className="input-field"
                    type="email"
                    value={email}
                    required
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck="false"
                    placeholder="you@yourshop.com"
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>

                <label className="block">
                  <span className="lp-eyebrow mb-2 flex items-center justify-between">
                    Password
                    {!creating && (
                      <button
                        type="button"
                        onClick={onReset}
                        className="lp-link normal-case tracking-normal text-ink-2"
                        style={{ fontSize: 12, letterSpacing: 0 }}
                      >
                        Forgotten it?
                      </button>
                    )}
                  </span>
                  <span className="relative block">
                    <input
                      className="input-field pr-11"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      required
                      minLength={6}
                      autoComplete={creating ? 'new-password' : 'current-password'}
                      placeholder={creating ? 'At least 6 characters' : 'Your password'}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-ink-3 transition-colors duration-300 hover:text-ink"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} strokeWidth={1.9} /> : <Eye size={16} strokeWidth={1.9} />}
                    </button>
                  </span>
                </label>
              </div>

              {error && (
                <p role="alert" className="mt-5 border-l-2 border-bad pl-3 text-[13.5px] leading-snug text-bad">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="mt-5 border-l-2 border-good pl-3 text-[13.5px] leading-snug text-good">
                  {notice}
                </p>
              )}

              <button type="submit" disabled={working} className="lp-cta lp-cta-solid mt-7 w-full disabled:opacity-60">
                {busy === 'email' && <Loader2 size={16} className="animate-spin" />}
                {creating ? 'Create account' : 'Sign in'}
              </button>

              <div className="my-6 flex items-center gap-4">
                <span className="lp-rule flex-1" />
                <span className="lp-eyebrow">or</span>
                <span className="lp-rule flex-1" />
              </div>

              <button type="button" onClick={onGoogle} disabled={working} className="lp-cta lp-cta-line w-full disabled:opacity-60">
                {busy === 'google' ? <Loader2 size={16} className="animate-spin" /> : <GoogleMark size={17} />}
                Continue with Google
              </button>
            </form>

            <p data-auth-item className="mt-8 text-[13px] leading-relaxed text-ink-3">
              {creating ? 'Already set up? ' : 'No account yet? '}
              <button type="button" onClick={() => switchMode(creating ? 'signin' : 'create')} className="lp-link text-ink">
                {creating ? 'Sign in instead' : 'Create one'}
              </button>
              .
            </p>
          </div>
        </div>

        <p data-auth-item className="lp-eyebrow">DocDesk · Your records stay in your own database</p>
      </div>

      {/* --- the aside ----------------------------------------------------- */}
      {/* Decorative and heavy, so it only exists on screens wide enough to
          deserve it - phones get the form at full width and nothing to wait for. */}
      <aside
        data-auth-aside
        className="relative hidden overflow-hidden border-l border-[var(--line)] lg:block"
        style={{ background: 'rgb(var(--c-sunken))' }}
        aria-hidden="true"
      >
        <div className="lp-backdrop">
          <div className="lp-glow" />
          <div className="grain absolute inset-[-50%]" />
        </div>

        <div className="absolute inset-0">
          <Scene3D
            load={() => import('../components/three/DeskScene3D')}
            fallback={null}
            height="100%"
            className="absolute inset-0"
            dark={isDark}
          />
        </div>

        <figure className="absolute inset-x-0 bottom-0 p-12">
          <blockquote className="max-w-[22ch] text-[clamp(1.5rem,2.4vw,2.25rem)] font-medium leading-[1.1] tracking-[-0.03em]">
            Every rule lives in the database, so it holds no matter what writes to it.
          </blockquote>
          <figcaption className="lp-eyebrow mt-6">PostgreSQL · 6 migrations · 21 checks</figcaption>
        </figure>
      </aside>
    </div>
  );
}
