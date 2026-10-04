"use strict";
/* =============================================================================
   TonerTrack Pro — application logic (Cloud edition)
   Same features as before, but the data layer is now Firebase:
     - Firebase Authentication gates access (email + password)
     - Cloud Firestore stores toners/printers/transactions and syncs them in
       real time to every signed-in device — that's what makes this
       "access from anywhere" instead of one browser's localStorage.
   See README.md for the one-time Firebase project setup this needs.
   ============================================================================= */

/* =============================================================================
   1. FIREBASE SETUP — paste your project's config here (see README.md)
   ============================================================================= */
const firebaseConfig = {
  apiKey: "AIzaSyA9OgeJTA0WxNNJRQW8w1vRZPEpnepzLGU",
  authDomain: "tonnertrackprocloud.firebaseapp.com",
  projectId: "tonnertrackprocloud",
  storageBucket: "tonnertrackprocloud.firebasestorage.app",
  messagingSenderId: "727973630035",
  appId: "1:727973630035:web:342380a48a5c8aa31336a6",
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Offline cache: lets the app keep working (read-only, from last sync) if the
// connection drops, then syncs automatically once it's back. Safe to ignore
// failures here — it just means this particular tab/browser won't cache.
try {
  db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    console.warn("Offline persistence not enabled:", err.code);
  });
} catch (err) {