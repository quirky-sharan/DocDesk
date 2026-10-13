import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  updateProfile,
} from 'firebase/auth';
import { auth, forgetStoredSignIn, googleProvider, startAnalytics } from '../lib/firebase';
import { ApiError, api, onSessionEnded, setCsrfToken } from '../api/client';

const AuthContext = createContext(null);

/**
 * Firebase error codes, said out loud.
 *
 * DocDesk is used by people who are not technical, so nothing here may ever
 * surface a raw code like `auth/invalid-credential`. Anything unmapped falls
 * back to a sentence that tells them what to do next rather than what broke.
 */
const MESSAGES = {
  'auth/invalid-email': 'That email address does not look right.',
  'auth/user-disabled': 'This account has been turned off. Get in touch to switch it back on.',
  'auth/user-not-found': 'No account with that email. Create one below - it takes a moment.',
  'auth/wrong-password': 'That password does not match. Try again, or reset it.',
  'auth/invalid-credential': 'That email and password do not match an account.',
  'auth/email-already-in-use': 'There is already an account with that email. Sign in instead.',
  'auth/weak-password': 'Pick a longer password - at least 8 characters.',
  'auth/missing-password': 'Enter your password.',
  'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
  'auth/network-request-failed': 'No connection. Check the internet and try again.',
  'auth/popup-closed-by-user': 'The Google window was closed before finishing.',
  'auth/cancelled-popup-request': 'The Google window was closed before finishing.',
  'auth/popup-blocked': 'The browser blocked the Google window. Allow pop-ups for this site, or use an email and password.',
  'auth/account-exists-with-different-credential':
    'That email is already set up with a password. Sign in with it instead.',
  'auth/unauthorized-domain': 'This address is not on the sign-in allow list in Firebase. Add it under Authentication → Settings → Authorised domains.',
  'auth/operation-not-allowed': 'That way of signing in is switched off for this project. Turn it on in Firebase → Authentication → Sign-in method.',
};

export function readableAuthError(error) {
  if (!error) return '';
  // The DocDesk server writes its refusals for people already.
  if (error instanceof ApiError) return error.message;
  const code = error.code || '';
  if (MESSAGES[code]) return MESSAGES[code];
  if (import.meta.env.DEV && code) console.warn('[auth] unmapped error', code, error.message);
  return error.message || 'That did not work. Try again in a moment.';
}

/** A first name to greet someone by, from whatever the account happens to have. */
export function displayNameFor(user) {
  if (!user) return '';
  if (user.displayName) return user.displayName;
  const [handle] = (user.email || '').split('@');
  if (!handle) return 'there';
  return handle.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Least to most; each may do everything the ones before it may. The server
// decides what is actually allowed - this only saves showing someone a door
// that will not open for them.
const ROLES = ['staff', 'manager', 'owner'];

/**
 * Trades a Firebase sign-in for a DocDesk session.
 *
 * Firebase has just confirmed who this is and holds a short-lived token saying
 * so. That token goes to the server once; the server checks Google's signature
 * on it and answers with an HttpOnly cookie. Then Firebase is signed out again
 * here - it has done its one job, and from this point there is no token in the
 * page for anything to steal.
 */
async function exchange(firebaseUser, { refresh = false } = {}) {
  try {
    return await api.auth.signIn(await firebaseUser.getIdToken(refresh));
  } finally {
    firebaseSignOut(auth).catch(() => {});
  }
}

// Asked once per page load, however many times React mounts the provider
// (twice, in development): two answers racing each other could otherwise
// leave a just-signed-in person looking signed out.
let opening = null;
function openingSession() {
  if (!opening) {
    opening = (async () => {
      // A Google sign-in that had to leave the page (pop-up blocked) lands back here.
      const returned = await getRedirectResult(auth).catch(() => null);
      if (returned?.user) return exchange(returned.user);
      return api.auth.session();
    })();
  }
  return opening;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // `ready` is false only until the server has said whether there is a session.
  // The app shows nothing until then, so a signed-in person never sees the
  // landing page flash before their dashboard.
  const [ready, setReady] = useState(false);
  // False only where sign-in has been switched off for a local installation.
  const [signInRequired, setSignInRequired] = useState(true);

  const adopt = useCallback((session) => {
    setCsrfToken(session?.csrfToken);
    setSignInRequired(session?.signInRequired !== false);
    setUser(session?.user || null);
    return session?.user || null;
  }, []);

  useEffect(() => {
    let current = true;
    openingSession()
      .then((session) => current && adopt(session))
      .catch(() => current && adopt(null))
      .finally(() => current && setReady(true));
    startAnalytics();

    // Any call can be the one that learns the session is over - expired, signed
    // out elsewhere, or the owner changed something. Signed out drops to the
    // front door; anything else re-reads who this is so the right screen shows.
    onSessionEnded((reason) => {
      if (reason === 'signed_out') adopt(null);
      else api.auth.session().then(adopt).catch(() => adopt(null));
    });

    return () => {
      current = false;
      onSessionEnded(null);
    };
  }, [adopt]);

  const signUp = useCallback(async (email, password, name) => {
    const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const trimmed = (name || '').trim();
    if (trimmed) await updateProfile(credential.user, { displayName: trimmed });
    // The token was minted before the name was set; a fresh one carries it.
    return adopt(await exchange(credential.user, { refresh: Boolean(trimmed) }));
  }, [adopt]);

  const signIn = useCallback(async (email, password) => {
    const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
    return adopt(await exchange(credential.user));
  }, [adopt]);

  const signInWithGoogle = useCallback(async () => {
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      return adopt(await exchange(credential.user));
    } catch (error) {
      // Some browsers (and every in-app webview) refuse pop-ups outright. Going
      // the long way round still gets there.
      if (error?.code === 'auth/popup-blocked' || error?.code === 'auth/operation-not-supported-in-this-environment') {
        await signInWithRedirect(auth, googleProvider);
        return null;
      }
      throw error;
    }
  }, [adopt]);

  const signOut = useCallback(async () => {
    // Ends the session on the server, which is what makes it a real sign-out:
    // a copy of the cookie is worth nothing afterwards.
    await api.auth.signOut().catch(() => {});
    firebaseSignOut(auth).catch(() => {});
    adopt(null);
  }, [adopt]);

  /** Asks the server again - how the waiting screen notices it has been let in. */
  const refresh = useCallback(() => api.auth.session().then(adopt), [adopt]);

  const resetPassword = useCallback((email) => sendPasswordResetEmail(auth, email.trim()), []);

  const can = useCallback(
    (minimum) => Boolean(user) && user.status === 'active' && ROLES.indexOf(user.role) >= ROLES.indexOf(minimum),
    [user]
  );

  const value = useMemo(
    () => ({ user, ready, signInRequired, can, signUp, signIn, signInWithGoogle, signOut, refresh, resetPassword }),
    [user, ready, signInRequired, can, signUp, signIn, signInWithGoogle, signOut, refresh, resetPassword]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
