import { initializeApp, getApps } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  initializeAuth,
  indexedDBLocalPersistence,
} from 'firebase/auth';

/**
 * The one Firebase connection.
 *
 * The values below are the web app's public configuration, not secrets - a
 * Firebase web key identifies the project to Google and is meant to ship in the
 * browser bundle. What actually protects the data is the Firebase console's
 * authorised-domain list and, later, security rules. They can still be
 * overridden per environment with VITE_FIREBASE_* variables so a staging build
 * can point somewhere else without editing code.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyDP-hHBhQAx396wfwA9FfB8kshkK6xpIDs',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'dbms-91b7e.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'dbms-91b7e',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'dbms-91b7e.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '737064617998',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:737064617998:web:18ca7dcc4ebecdf53dd45f',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-533YR06JEK',
};

// Vite keeps modules alive across hot reloads; re-initialising would throw.
export const firebaseApp = getApps()[0] || initializeApp(firebaseConfig);

/**
 * initializeAuth rather than getAuth: it lets the persistence order be stated
 * explicitly and skips the parts of the SDK we never use. IndexedDB first so a
 * signed-in session survives a restart, localStorage behind it for private
 * windows where IndexedDB is blocked.
 */
export const auth = initializeAuth(firebaseApp, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
});

export const googleProvider = new GoogleAuthProvider();
// Always ask which account to use - people sharing a computer at a front desk
// must not be silently signed in as whoever used it last.
googleProvider.setCustomParameters({ prompt: 'select_account' });

/**
 * Analytics is optional and must never be able to break sign-in: it is loaded
 * lazily, only where the browser supports it, and every failure is swallowed.
 */
export function startAnalytics() {
  if (!firebaseConfig.measurementId) return;
  import('firebase/analytics')
    .then(({ getAnalytics, isSupported }) =>
      isSupported().then((ok) => {
        if (ok) getAnalytics(firebaseApp);
      })
    )
    .catch(() => {});
}

export { firebaseConfig };
