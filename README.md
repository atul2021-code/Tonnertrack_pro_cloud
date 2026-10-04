# 🖨️ TonerTrack Pro — Toner & Printer Fleet Inventory (Cloud Edition)

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live%20Deployment-brightgreen)](https://atul2021-code.github.io/toner_inventory/)
[![Backend: Firebase](https://img.shields.io/badge/Backend-Firebase-orange.svg)](https://firebase.google.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A toner cartridge and printer fleet management system hosted on GitHub Pages,
with data stored in **Cloud Firestore** and gated by **Firebase
Authentication** — so your inventory is no longer tied to one browser on one
computer. Sign in from any device, anywhere, and see the same live data,
updated in real time as your team uses it.

---

## 🌐 Live Application
👉 **[https://atul2021-code.github.io/toner_inventory/](https://atul2021-code.github.io/toner_inventory/)**

*(You'll need to complete the one-time Firebase setup below before this
works — see "Setup" section.)*

---

## ☁️ What changed from the local-storage version

| | Local edition | Cloud edition (this one) |
|---|---|---|
| Where data lives | This browser's `localStorage` only | Cloud Firestore — synced to every device |
| Access from another device? | No | Yes, after signing in |
| Multiple people see the same inventory? | No | Yes, live, in real time |
| Works offline? | Yes, always | Yes, with automatic sync once back online |
| Requires an account? | No | Yes (email + password) |
| Setup required | None | One free Firebase project (~10 minutes, see below) |

Everything else — the inventory table, printer fleet, reorder sheet, audit
log, analytics charts, CSV export, encrypted Excel backup, ZIP/clean-HTML
export — works exactly as before.

---

## 🔑 About the Firebase config in `app.js`

You'll paste a `firebaseConfig` object (apiKey, projectId, etc.) near the
top of `app.js`. **This is expected to be public** — unlike a traditional
API key, Firebase's client config is designed to be visible in your
website's source code; it just tells the browser *which* Firebase project
to talk to. It is not a secret and doesn't need to be hidden.

What actually protects your data is:
1. **Firebase Authentication** — only someone who can sign in gets past the gate.
2. **Firestore Security Rules** (below) — the database itself refuses any
   read/write from a request that isn't signed in, regardless of what the
   client-side code tries to do.

---

## 🚀 Setup (one-time, ~10 minutes)

### 1. Create a Firebase project
Go to [console.firebase.google.com](https://console.firebase.google.com) →
**Add project** → give it a name → you can disable Google Analytics for
this project, it isn't needed → **Create project**.

### 2. Enable Authentication
In the left sidebar: **Build → Authentication → Get started**. Under
**Sign-in method**, enable **Email/Password**.

### 3. Enable Firestore
In the left sidebar: **Build → Firestore Database → Create database**.
Choose **Start in production mode** (not test mode), pick a location close
to you, and click **Enable**.

### 4. Set the security rules
Still in Firestore, go to the **Rules** tab and replace the contents with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Click **Publish**. This means: anyone signed in can read and write the
shared inventory; nobody else can touch it at all.

> **Optional, tighter rule:** if you want to restrict access to only your
> company's email domain (so random sign-ups can't get in even if someone
> finds the link), use this instead:
> ```
> allow read, write: if request.auth != null
>   && request.auth.token.email.matches('.*@yourcompany[.]com$');
> ```
> Replace `yourcompany.com` with your real domain.

### 5. Get your web app config
In the left sidebar, click the gear icon → **Project settings** → scroll to
**Your apps** → click the **</>** (web) icon → register an app (any
nickname) → you don't need Firebase Hosting, you're using GitHub Pages →
copy the `firebaseConfig` object it shows you.

### 6. Paste the config into `app.js`
Open `app.js`, find this block near the top, and replace the placeholder
values with your real ones from step 5:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
```

### 7. Push to GitHub
Commit and push `index.html` and `app.js` to your repo's `main` branch (see
deployment steps below). GitHub Pages redeploys automatically.

### 8. Create your first account
Open the live site, click **Create an account** on the sign-in screen, and
sign up with your email. The very first time *any* account signs in to a
brand-new (empty) Firebase project, the app automatically seeds it with the
same sample toners/printers you saw before — after that it's untouched by
auto-seeding, so your real data is always safe.

Share the same sign-in with your team (or have each person create their
own account) — everyone who's signed in sees and edits the same shared
inventory, live.

---

## ⚡ Key Capabilities

- **Consumables Inventory:** Real-time stock counts with color badges for CMYK (Cyan, Magenta, Yellow, Black) and Drum units.
- **Stock Steppers:** 1-click +1 and -1 stock adjustments right inside table rows.
- **Threshold Alerts:** Automatic alerts when any cartridge level reaches or drops below its minimum threshold.
- **Fleet Mapping:** Associate toner models with departmental printers and network IP addresses.
- **Purchase Order Requisition:** 1-click generation and clipboard copying of purchase requisition orders based on threshold triggers.
- **Audit Logging:** Full transaction history tracking who took or restocked which cartridge, when, and for which printer.
- **Data Portability:** Excel (.xlsx) backup & restore — one workbook with Toners/Printers/Transactions sheets, with optional AES-256 encryption — plus instant CSV export of all inventory items and audit records. Because restore reads the same column headers it writes, you can hand-edit the spreadsheet (fix a quantity, add new rows) and re-upload it as a bulk update.
- **Cross-device sync:** Every signed-in device sees the same inventory update live, no refresh needed.

---

## 🚀 Deploying to GitHub Pages

1. Upload `index.html`, `app.js`, `README.md`, and `LICENSE` to your `main` branch (with your real Firebase config already pasted into `app.js`).
2. Go to **Settings → Pages** in your GitHub repository.
3. Under **Branch**, select `main` and folder `/ (root)`.
4. Click **Save**. Within about a minute your site will be live.

---

## 🔒 Security notes

- Firebase config values are safe to commit — see "About the Firebase
  config" above.
- The default security rule allows **any signed-in user** full read/write
  access to the shared inventory. That's appropriate for a small trusted
  team; if you want to restrict it further, see the optional email-domain
  rule in step 4.
- Self-signup is enabled by default (anyone with the link can create an
  account and get full access). To lock this down, either use the
  email-domain rule above, or create accounts manually for your team via
  **Firebase Console → Authentication → Add user** and simply don't
  publicize the "Create an account" option.
- Backups are now Excel (.xlsx) files instead of JSON, with the same
  optional AES-256 encryption (producing a `.enc` file instead) — useful
  for an offline archive copy, independent of Firestore. An encrypted
  backup is not a readable spreadsheet until restored with the correct
  passphrase.

---

## 📄 License
This project is open-source under the [MIT License](LICENSE).
