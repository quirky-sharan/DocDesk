import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  updateProfile,
} from 'firebase/auth';
import { auth, googleProvider, startAnalytics } from '../lib/firebase';

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
  'auth/weak-password': 'Pick a password of at least 6 characters.',
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
  const code = error.code || '';
  if (MESSAGES[code]) return MESSAGES[code];
  if (import.meta.env.DEV && code) console.warn('[auth] unmapped error', code, error.message);
  return 'That did not work. Try again in a moment.';
}

/** A first name to greet someone by, from whatever the account happens to have. */
export function displayNameFor(user) {
  if (!user) return '';
  if (user.displayName) return user.displayName;
  const [handle] = (user.email || '').split('@');
  if (!handle) return 'there';
  return handle.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // `ready` is false only until Firebase has restored (or ruled out) a saved
  // session. The app shows nothing until then, so a signed-in person never
  // sees the landing page flash before their dashboard.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stop = onAuthStateChanged(
      auth,
      (next) => {
        setUser(next);
        setReady(true);
      },
      () => setReady(true)
    );

    // Picks up a Google sign-in that had to leave the page (pop-up blocked).
    getRedirectResult(auth).catch(() => {});
    startAnalytics();

    return stop;
  }, []);

  const signUp = useCallback(async (email, password, name) => {
    const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const trimmed = (name || '').trim();
    if (trimmed) {
      await updateProfile(credential.user, { displayName: trimmed });
      // updateProfile does not re-fire the auth listener, so publish it here or
      // the new account is greeted by its email address until the next reload.
      setUser({ ...credential.user, displayName: trimmed });
    }
    return credential.user;
  }, []);

  const signIn = useCallback(
    (email, password) => signInWithEmailAndPassword(auth, email.trim(), password),
    []
  );

  const signInWithGoogle = useCallback(async () => {
    try {
      return await signInWithPopup(auth, googleProvider);
    } catch (error) {
      // Some browsers (and every in-app webview) refuse pop-ups outright. Going
      // the long way round still gets there.
      if (error?.code === 'auth/popup-blocked' || error?.code === 'auth/operation-not-supported-in-this-environment') {
        await signInWithRedirect(auth, googleProvider);
        return null;
      }
      throw error;
    }
  }, []);

  const signOut = useCallback(() => firebaseSignOut(auth), []);

  const resetPassword = useCallback((email) => sendPasswordResetEmail(auth, email.trim()), []);

  const value = useMemo(
    () => ({ user, ready, signUp, signIn, signInWithGoogle, signOut, resetPassword }),
    [user, ready, signUp, signIn, signInWithGoogle, signOut, resetPassword]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
