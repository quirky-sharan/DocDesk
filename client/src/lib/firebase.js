import { initializeApp, getApps } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  getAuth,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
} from 'firebase/auth';
import defaults from '@shared/firebase.json';

/**
 * The one Firebase connection.
 *
 * The values in shared/firebase.json are the web app's public configuration,
 * not secrets - a Firebase web key identifies the project to Google and is
 * meant to ship in the browser bundle. They live in shared/ because the server
 * needs the same project id to check sign-ins against. They can still be
 * overridden per environment with VITE_FIREBASE_* variables so a staging build
 * can point somewhere else without editing code.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || defaults.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || defaults.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || defaults.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || defaults.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || defaults.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || defaults.appId,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || defaults.measurementId,
};

// Vite keeps modules alive across hot reloads; re-initialising would throw.
export const firebaseApp = getApps()[0] || initializeApp(firebaseConfig);

let authInstance;
try {
  authInstance = initializeAuth(firebaseApp, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    popupRedirectResolver: browserPopupRedirectResolver,
  });
} catch {
  authInstance = getAuth(firebaseApp);
}
export const auth = authInstance;

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

/**
 * Earlier versions kept the Firebase session in the browser's storage. Nothing
 * reads it any more, so what is still lying there from before is cleared out
 * rather than left as a token with nobody looking after it.
 */
export function forgetStoredSignIn() {
  try {
    indexedDB.deleteDatabase('firebaseLocalStorageDb');
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('firebase:authUser:')) localStorage.removeItem(key);
    }
  } catch {
    // Storage is blocked in this browser, which means there was nothing kept.
  }
}

export { firebaseConfig };
