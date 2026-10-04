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
  apiKey: "AIzaSyCjvHrTQUipmjPyv24eHGnQe1PHCzy6bgI",
  authDomain: "tonertrack-pro.firebaseapp.com",
  projectId: "tonertrack-pro",
  storageBucket: "tonertrack-pro.firebasestorage.app",
  messagingSenderId: "167191224144",
  appId: "1:167191224144:web:9fb1414da4015533665655",
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
  console.warn("Offline persistence not supported:", err);
}

const tonersCol = db.collection("toners");
const printersCol = db.collection("printers");
const txCol = db.collection("transactions");

/* =============================================================================
   Seed / sample data (used only to populate a brand-new, empty workspace)
   ============================================================================= */
function buildSeedData() {
  const now = new Date();
  const d1 = new Date(now); d1.setDate(d1.getDate() - 1); d1.setHours(14, 30, 0, 0);
  const d2 = new Date(now); d2.setDate(d2.getDate() - 1); d2.setHours(10, 15, 0, 0);

  return {
    toners: [
      { id: "T101", model: "HP 58A", brand: "HP", color: "Black", partNo: "CF258A", qty: 7, minStock: 3, location: "Shelf A-1" },
      { id: "T102", model: "HP 58X High Yield", brand: "HP", color: "Black", partNo: "CF258X", qty: 2, minStock: 3, location: "Shelf A-1" },
      { id: "T103", model: "HP 414A Black", brand: "HP", color: "Black", partNo: "W2020A", qty: 5, minStock: 2, location: "Shelf A-2" },
      { id: "T104", model: "HP 414A Cyan", brand: "HP", color: "Cyan", partNo: "W2021A", qty: 1, minStock: 2, location: "Shelf A-2" },
      { id: "T105", model: "HP 414A Magenta", brand: "HP", color: "Magenta", partNo: "W2023A", qty: 4, minStock: 2, location: "Shelf A-2" },
      { id: "T106", model: "HP 414A Yellow", brand: "HP", color: "Yellow", partNo: "W2022A", qty: 0, minStock: 2, location: "Shelf A-2" },
      { id: "T107", model: "Brother TN-760", brand: "Brother", color: "Black", partNo: "TN760", qty: 8, minStock: 4, location: "Shelf B-1" },
      { id: "T108", model: "Brother DR-730 Drum", brand: "Brother", color: "Drum / Waste", partNo: "DR730", qty: 2, minStock: 1, location: "Shelf B-2" },
      { id: "T109", model: "Canon 057", brand: "Canon", color: "Black", partNo: "3009C001", qty: 4, minStock: 2, location: "Shelf C-1" },
    ],
    printers: [
      { id: "P1", name: "Executive Suite MFP", model: "HP LaserJet Pro M428fdw", dept: "Executive", ip: "192.168.1.110" },
      { id: "P2", name: "Marketing Color LaserJet", model: "HP Color LaserJet Pro M479fdw", dept: "Marketing", ip: "192.168.1.115" },
      { id: "P3", name: "Accounts Office Printer", model: "Brother MFC-L2710DW", dept: "Finance", ip: "192.168.1.122" },
      { id: "P4", name: "Human Resources MFP", model: "Canon imageCLASS MF445dw", dept: "HR", ip: "192.168.1.130" },
    ],
    transactions: [
      { id: "seed-tx-1", date: d1.toISOString(), type: "Issued", tonerId: "T106", tonerLabel: "HP 414A Yellow (Yellow)", qty: 1, dest: "Marketing Color LaserJet", person: "IT Team" },
      { id: "seed-tx-2", date: d2.toISOString(), type: "Restocked", tonerId: "T101", tonerLabel: "HP 58A (Black)", qty: 5, dest: "Shelf A-1", person: "Admin" },
    ],
  };
}

/* =============================================================================
   In-memory cache — kept in sync by Firestore's onSnapshot listeners below.
   Every render* function reads from this; nothing writes to it directly
   except the snapshot callbacks (all user actions instead write to
   Firestore, which then flows back here automatically).
   ============================================================================= */
let STATE = { toners: [], printers: [], transactions: [] };
let unsubscribers = [];

function stopListening() {
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
}

async function seedIfEmpty() {
  const existing = await tonersCol.limit(1).get();
  if (!existing.empty) return; // workspace already has data — never overwrite it
  const seed = buildSeedData();
  const batch = db.batch();
  seed.toners.forEach((t) => { const { id, ...rest } = t; batch.set(tonersCol.doc(id), rest); });
  seed.printers.forEach((p) => { const { id, ...rest } = p; batch.set(printersCol.doc(id), rest); });
  seed.transactions.forEach((tx) => { const { id, ...rest } = tx; batch.set(txCol.doc(id), rest); });
  await batch.commit();
}

function startListening() {
  unsubscribers.push(
    tonersCol.onSnapshot((snap) => {
      STATE.toners = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderAll();
    }, (err) => toastMsg(`Sync error (toners): ${err.message}`, "error"))
  );
  unsubscribers.push(
    printersCol.onSnapshot((snap) => {
      STATE.printers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderAll();
    }, (err) => toastMsg(`Sync error (printers): ${err.message}`, "error"))
  );
  unsubscribers.push(
    txCol.orderBy("date", "desc").onSnapshot((snap) => {
      STATE.transactions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderAll();
    }, (err) => toastMsg(`Sync error (audit log): ${err.message}`, "error"))
  );
}

/* =============================================================================
   Auth gate
   ============================================================================= */
let authMode = "signin"; // "signin" | "signup"

const authGateEl = document.getElementById("authGate");
const authForm = document.getElementById("authForm");
const authError = document.getElementById("authError");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authToggleMode = document.getElementById("authToggleMode");
const authToggleText = document.getElementById("authToggleText");
const authSubtitle = document.getElementById("authSubtitle");

function setAuthMode(mode) {
  authMode = mode;
  authError.classList.add("hidden");
  if (mode === "signin") {
    authSubmitBtn.textContent = "Sign In";
    authSubtitle.textContent = "Sign in to access your team's shared inventory.";
    authToggleText.textContent = "New to this workspace?";
    authToggleMode.textContent = "Create an account";
  } else {
    authSubmitBtn.textContent = "Create Account";
    authSubtitle.textContent = "Create an account to start (or join) your team's shared inventory.";
    authToggleText.textContent = "Already have an account?";
    authToggleMode.textContent = "Sign in instead";
  }
}

authToggleMode.addEventListener("click", () => setAuthMode(authMode === "signin" ? "signup" : "signin"));

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  authError.classList.add("hidden");
  authSubmitBtn.disabled = true;
  const originalLabel = authSubmitBtn.textContent;
  authSubmitBtn.textContent = "Please wait…";
  try {
    if (authMode === "signin") {
      await auth.signInWithEmailAndPassword(email, password);
    } else {
      await auth.createUserWithEmailAndPassword(email, password);
    }
    // onAuthStateChanged (below) takes it from here.
  } catch (err) {
    authError.textContent = friendlyAuthError(err);
    authError.classList.remove("hidden");
  } finally {
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = originalLabel;
  }
});

function friendlyAuthError(err) {
  const map = {
    "auth/invalid-email": "That doesn't look like a valid email address.",
    "auth/user-not-found": "No account with that email. Try 'Create an account' instead.",
    "auth/wrong-password": "Incorrect password.",
    "auth/email-already-in-use": "An account already exists for that email — try signing in instead.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/network-request-failed": "Network error — check your connection and try again.",
  };
  return map[err.code] || err.message || "Something went wrong. Please try again.";
}

document.getElementById("btnSignOut").addEventListener("click", () => auth.signOut());

auth.onAuthStateChanged(async (user) => {
  stopListening();
  if (user) {
    authGateEl.classList.add("hidden");
    document.getElementById("authUserLabel").textContent = user.email;
    try {
      await seedIfEmpty();
    } catch (err) {
      console.error("Seeding failed:", err);
    }
    startListening();
  } else {
    authGateEl.classList.remove("hidden");
    document.getElementById("authUserLabel").textContent = "";
    STATE = { toners: [], printers: [], transactions: [] };
  }
});

/* =============================================================================
   Small helpers
   ============================================================================= */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function findToner(id) { return STATE.toners.find((t) => t.id === id) || null; }
function findPrinter(id) { return STATE.printers.find((p) => p.id === id) || null; }

function isLow(t) { return t.qty <= t.minStock; }
function isOut(t) { return t.qty <= 0; }

const COLOR_BADGE = {
  "Black": "bg-slate-900 text-white",
  "Cyan": "bg-sky-600 text-white",
  "Magenta": "bg-pink-600 text-white",
  "Yellow": "bg-amber-400 text-slate-950 font-bold",
  "Drum / Waste": "bg-purple-700 text-white",
};
const COLOR_HEX = {
  "Black": "#0f172a",
  "Cyan": "#0284c7",
  "Magenta": "#db2777",
  "Yellow": "#fbbf24",
  "Drum / Waste": "#7e22ce",
};

function toastMsg(message, kind = "info") {
  const container = document.getElementById("toastContainer");
  const colors = {
    info: "bg-slate-900 text-white",
    success: "bg-emerald-600 text-white",
    error: "bg-rose-600 text-white",
  };
  const el = document.createElement("div");
  el.className = `pointer-events-auto rounded-lg shadow-lg px-3.5 py-2.5 text-xs font-medium transition-all duration-200 ${colors[kind] || colors.info}`;
  el.style.opacity = "0";
  el.style.transform = "translateY(-6px)";
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";
  });
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(-6px)";
    setTimeout(() => el.remove(), 250);
  }, 3200);
}

function toggleEmptyState(msgEl, isEmpty) {
  if (!msgEl) return;
  const wrapper = msgEl.previousElementSibling;
  msgEl.classList.toggle("hidden", !isEmpty);
  if (wrapper) wrapper.classList.toggle("hidden", isEmpty);
}

function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* =============================================================================
   Tabs
   ============================================================================= */
const TAB_ACTIVE = ["text-sky-700", "bg-sky-100", "font-semibold"];
const TAB_INACTIVE = ["text-slate-600", "hover:text-slate-900", "hover:bg-slate-100"];

function activateTab(name) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    const active = btn.dataset.tab === name;
    btn.classList.remove(...TAB_ACTIVE, ...TAB_INACTIVE);
    btn.classList.add(...(active ? TAB_ACTIVE : TAB_INACTIVE));
  });
  document.querySelectorAll(".tab-content").forEach((section) => {
    const active = section.id === `view-${name}`;
    section.classList.toggle("hidden", !active);
    section.classList.toggle("block", active);
  });
  if (name === "analytics") renderAnalytics();
}

document.getElementById("mainTabNav").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  activateTab(btn.dataset.tab);
});

/* =============================================================================
   KPIs / header badges
   ============================================================================= */
function renderKpis() {
  const totalPieces = STATE.toners.reduce((s, t) => s + t.qty, 0);
  const totalModels = STATE.toners.length;
  const lowStockItems = STATE.toners.filter(isLow);
  const distinctDepts = new Set(STATE.printers.map((p) => (p.dept || "").trim()).filter(Boolean)).size;

  document.getElementById("kpiTotalPieces").textContent = totalPieces;
  document.getElementById("kpiTotalModels").textContent = totalModels;
  document.getElementById("kpiLowStock").textContent = lowStockItems.length;
  document.getElementById("kpiPrinters").textContent = STATE.printers.length;
  document.getElementById("kpiLocations").textContent = distinctDepts;
  document.getElementById("lowStockCountText").textContent = `${lowStockItems.length} low`;
  document.getElementById("tabCountPrinters").textContent = STATE.printers.length;
  document.getElementById("tabCountReorders").textContent = lowStockItems.length;
}

/* =============================================================================
   Inventory tab
   ============================================================================= */
function renderInventoryRow(t) {
  const badgeClass = COLOR_BADGE[t.color] || "bg-slate-900 text-white";
  const rowLow = isLow(t) ? " bg-amber-50/50" : "";
  let qtyBadgeClass = "bg-slate-100 text-slate-800";
  if (isOut(t)) qtyBadgeClass = "bg-rose-100 text-rose-800";
  else if (isLow(t)) qtyBadgeClass = "bg-amber-100 text-amber-800";

  return `
    <tr class="hover:bg-slate-50 border-b border-slate-100 transition${rowLow}">
      <td class="py-3 px-3 sm:px-4">
        <div class="flex items-center space-x-2">
          <span class="px-1.5 py-0.5 rounded text-2xs uppercase font-bold ${badgeClass}">${esc(t.color)}</span>
          <span class="font-bold text-slate-900">${esc(t.model)}</span>
        </div>
      </td>
      <td class="py-3 px-3 sm:px-4 text-xs font-mono">
        <span class="font-bold text-slate-800">${esc(t.brand)}</span> ${esc(t.partNo)}
      </td>
      <td class="py-3 px-3 sm:px-4 text-center">
        <span class="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-extrabold ${qtyBadgeClass}">${t.qty}</span>
      </td>
      <td class="py-3 px-3 sm:px-4 text-center text-xs font-semibold text-slate-500">${t.minStock}</td>
      <td class="py-3 px-3 sm:px-4 text-xs text-slate-600">${esc(t.location)}</td>
      <td class="py-3 px-3 sm:px-4 text-right space-x-1 whitespace-nowrap no-print">
        <button type="button" data-action="quick-adjust" data-id="${t.id}" data-diff="1" title="Add 1" class="px-2 py-1 bg-slate-100 hover:bg-sky-100 hover:text-sky-700 text-slate-700 rounded text-xs font-bold border border-slate-200">+1</button>
        <button type="button" data-action="quick-adjust" data-id="${t.id}" data-diff="-1" title="Deduct 1" class="px-2 py-1 bg-slate-100 hover:bg-amber-100 hover:text-amber-700 text-slate-700 rounded text-xs font-bold border border-slate-200">-1</button>
        <button type="button" data-action="delete-toner" data-id="${t.id}" title="Delete" class="px-1.5 py-1 text-slate-400 hover:text-rose-600 rounded text-xs">✕</button>
      </td>
    </tr>`;
}

function filteredToners() {
  const kw = (document.getElementById("inventorySearch").value || "").trim().toLowerCase();
  const brand = document.getElementById("filterBrand").value;
  const color = document.getElementById("filterColor").value;
  return STATE.toners.filter((t) => {
    if (brand !== "ALL" && t.brand !== brand) return false;
    if (color !== "ALL" && t.color !== color) return false;
    if (kw && !`${t.model} ${t.partNo} ${t.brand}`.toLowerCase().includes(kw)) return false;
    return true;
  });
}

function renderInventory() {
  const rows = filteredToners();
  document.getElementById("inventoryTableBody").innerHTML = rows.map(renderInventoryRow).join("");
  toggleEmptyState(document.getElementById("noInventoryMessage"), rows.length === 0);
}

document.getElementById("inventorySearch").addEventListener("input", renderInventory);
document.getElementById("filterBrand").addEventListener("change", renderInventory);
document.getElementById("filterColor").addEventListener("change", renderInventory);

/* =============================================================================
   Printers tab
   ============================================================================= */
function renderPrinterCard(p) {
  return `
    <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between space-y-3">
      <div class="space-y-1.5">
        <div class="flex items-start justify-between">
          <h4 class="font-bold text-slate-900 text-sm">${esc(p.name)}</h4>
          <button class="text-slate-400 hover:text-rose-600 p-1 text-xs" data-action="delete-printer" data-id="${p.id}" type="button">✕</button>
        </div>
        <p class="text-xs text-slate-500">${esc(p.model)}</p>
        <div class="text-xs space-y-0.5 text-slate-600 pt-1">
          <p><span class="text-slate-400">Dept:</span> <span class="font-medium text-slate-700">${esc(p.dept)}</span></p>
          <p><span class="text-slate-400">IP:</span> <span class="font-mono text-slate-700">${esc(p.ip)}</span></p>
        </div>
      </div>
      <button class="w-full py-1.5 px-3 bg-slate-50 hover:bg-sky-50 text-sky-700 border border-slate-200 rounded-lg text-xs font-semibold transition" data-action="quick-issue-printer" data-dept="${encodeURIComponent(p.name)}" type="button">
        Dispatch Cartridge Here
      </button>
    </div>`;
}

function renderPrinters() {
  const grid = document.getElementById("printerGrid");
  grid.innerHTML = STATE.printers.map(renderPrinterCard).join("");
  toggleEmptyState(document.getElementById("noPrintersMessage"), STATE.printers.length === 0);
}

document.getElementById("printerSearch")?.addEventListener("input", () => {
  const kw = document.getElementById("printerSearch").value.trim().toLowerCase();
  document.querySelectorAll("#printerGrid > div").forEach((card) => {
    card.style.display = card.textContent.toLowerCase().includes(kw) ? "" : "none";
  });
});

/* =============================================================================
   Reorders tab
   ============================================================================= */
function renderReorders() {
  const lowItems = STATE.toners.filter(isLow);
  const tbody = document.getElementById("reorderTableBody");
  tbody.innerHTML = lowItems.map((t) => {
    const suggested = Math.max(1, t.minStock * 2 - t.qty);
    return `
      <tr class="hover:bg-slate-50 border-b border-slate-100">
        <td class="py-2.5 px-3 font-semibold text-slate-800">${esc(t.model)} (${esc(t.color)})<span class="block text-2xs font-mono text-slate-400">${esc(t.partNo)}</span></td>
        <td class="py-2.5 px-3 text-xs text-slate-600">${esc(t.brand)}</td>
        <td class="py-2.5 px-3 text-center font-bold text-rose-600">${t.qty}</td>
        <td class="py-2.5 px-3 text-center text-xs text-slate-500">${t.minStock}</td>
        <td class="py-2.5 px-3 text-center font-bold text-sky-700 bg-sky-50/50">${suggested} units</td>
        <td class="py-2.5 px-3 text-right no-print">
          <button class="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded text-xs font-semibold" data-action="quick-restock-reorder" data-id="${t.id}" data-qty="${suggested}" type="button">+ Restock</button>
        </td>
      </tr>`;
  }).join("");
  toggleEmptyState(document.getElementById("reorderEmptyNotice"), lowItems.length === 0);
}

function reorderSummaryText() {
  const lowItems = STATE.toners.filter(isLow);
  if (lowItems.length === 0) return "All toner stock levels are healthy. No reorder needed.";
  const lines = ["Purchase Requisition Sheet", `Generated: ${new Date().toLocaleString()}`, ""];
  lowItems.forEach((t) => {
    const suggested = Math.max(1, t.minStock * 2 - t.qty);
    lines.push(`- ${t.model} (${t.color}) [${t.brand} ${t.partNo}] — on hand: ${t.qty}, min: ${t.minStock}, order: ${suggested} units`);
  });
  return lines.join("\n");
}

/* =============================================================================
   Transactions (Audit Log) — writes go to Firestore; onSnapshot re-renders
   ============================================================================= */
async function logTransaction(type, toner, qty, dest, person) {
  await txCol.add({
    date: new Date().toISOString(),
    type,
    tonerId: toner.id,
    tonerLabel: `${toner.model} (${toner.color})`,
    qty,
    dest,
    person: person || "—",
  });
}

function renderTransactions() {
  const rows = STATE.transactions;
  const tbody = document.getElementById("transactionTableBody");
  tbody.innerHTML = rows.map((tx) => {
    const badge = tx.type === "Issued"
      ? '<span class="px-1.5 py-0.5 rounded text-2xs font-semibold bg-amber-100 text-amber-800">Issued</span>'
      : '<span class="px-1.5 py-0.5 rounded text-2xs font-semibold bg-emerald-100 text-emerald-800">Restocked</span>';
    return `
      <tr class="hover:bg-slate-50 border-b border-slate-100 text-xs">
        <td class="py-2.5 px-3 text-slate-500 font-mono text-2xs">${esc(new Date(tx.date).toLocaleString())}</td>
        <td class="py-2.5 px-3">${badge}</td>
        <td class="py-2.5 px-3 font-medium text-slate-800">${esc(tx.tonerLabel)}</td>
        <td class="py-2.5 px-3 text-center font-mono font-bold">${tx.qty}</td>
        <td class="py-2.5 px-3 text-slate-600">${esc(tx.dest)}</td>
        <td class="py-2.5 px-3 text-slate-600">${esc(tx.person)}</td>
      </tr>`;
  }).join("");
  toggleEmptyState(document.getElementById("noHistoryMessage"), rows.length === 0);
}

/* =============================================================================
   Analytics tab (Chart.js)
   ============================================================================= */
let brandChartInstance = null;
let colorChartInstance = null;

function renderAnalytics() {
  if (typeof Chart === "undefined") return; // CDN failed to load — fail quietly

  const byBrand = {};
  const byColor = {};
  STATE.toners.forEach((t) => {
    byBrand[t.brand] = (byBrand[t.brand] || 0) + t.qty;
    byColor[t.color] = (byColor[t.color] || 0) + t.qty;
  });

  const brandCtx = document.getElementById("brandChart");
  if (brandChartInstance) brandChartInstance.destroy();
  brandChartInstance = new Chart(brandCtx, {
    type: "bar",
    data: {
      labels: Object.keys(byBrand),
      datasets: [{
        label: "Units in stock",
        data: Object.values(byBrand),
        backgroundColor: "#0284c7",
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });

  const colorCtx = document.getElementById("colorChart");
  if (colorChartInstance) colorChartInstance.destroy();
  const colorLabels = Object.keys(byColor);
  colorChartInstance = new Chart(colorCtx, {
    type: "doughnut",
    data: {
      labels: colorLabels,
      datasets: [{
        data: colorLabels.map((c) => byColor[c]),
        backgroundColor: colorLabels.map((c) => COLOR_HEX[c] || "#94a3b8"),
        borderWidth: 2,
        borderColor: "#ffffff",
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } } },
    },
  });
}

/* =============================================================================
   Render everything (called from the Firestore snapshot listeners)
   ============================================================================= */
function renderAll() {
  renderKpis();
  renderInventory();
  renderPrinters();
  renderReorders();
  renderTransactions();
  if (document.getElementById("view-analytics") && !document.getElementById("view-analytics").classList.contains("hidden")) {
    renderAnalytics();
  }
}

/* =============================================================================
   Modals
   ============================================================================= */
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (id === "modalPrinter") document.getElementById("printerForm").reset();
  el.classList.add("active");
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove("active");
}

/* ---- Toner add/edit modal ---- */
function openAddTonerModal() {
  document.getElementById("tonerForm").reset();
  document.getElementById("tonerId").value = "";
  document.getElementById("modalTonerTitle").textContent = "Add Toner Cartridge";
  document.getElementById("tonerQuantity").disabled = false;
  document.getElementById("tonerQuantity").value = 0;
  document.getElementById("tonerMinStock").value = 2;
  openModal("modalToner");
}

document.getElementById("tonerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("tonerId").value;
  const fields = {
    model: document.getElementById("tonerModel").value.trim(),
    brand: document.getElementById("tonerBrand").value,
    color: document.getElementById("tonerColor").value,
    partNo: document.getElementById("tonerPartNo").value.trim(),
    qty: parseInt(document.getElementById("tonerQuantity").value, 10) || 0,
    minStock: parseInt(document.getElementById("tonerMinStock").value, 10) || 0,
    location: document.getElementById("tonerLocation").value.trim(),
  };
  if (!fields.model) { toastMsg("Model name is required.", "error"); return; }

  try {
    if (id) {
      await tonersCol.doc(id).update(fields);
      toastMsg(`Updated '${fields.model}'.`, "success");
    } else {
      await tonersCol.add(fields);
      toastMsg(`Added '${fields.model}'.`, "success");
    }
    closeModal("modalToner");
  } catch (err) {
    toastMsg(`Could not save: ${err.message}`, "error");
  }
});

/* ---- Restock modal ---- */
function populateTonerSelect(selectEl) {
  selectEl.innerHTML = STATE.toners
    .map((t) => `<option value="${t.id}">${esc(t.model)} (${esc(t.color)}) — ${t.qty} on hand</option>`)
    .join("");
}

function openRestockModal(presetTonerId) {
  populateTonerSelect(document.getElementById("restockTonerSelect"));
  if (presetTonerId) document.getElementById("restockTonerSelect").value = presetTonerId;
  document.getElementById("restockQuantity").value = 1;
  document.getElementById("restockTechnician").value = "";
  openModal("modalRestock");
}

document.getElementById("restockForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("restockTonerSelect").value;
  const qty = parseInt(document.getElementById("restockQuantity").value, 10);
  const tech = document.getElementById("restockTechnician").value.trim() || "Admin";
  const t = findToner(id);
  if (!t || !qty || qty <= 0) { toastMsg("Choose a toner and a positive quantity.", "error"); return; }
  try {
    await tonersCol.doc(id).update({ qty: t.qty + qty });
    await logTransaction("Restocked", t, qty, t.location, tech);
    closeModal("modalRestock");
    toastMsg(`Restocked ${qty} × ${t.model}.`, "success");
  } catch (err) {
    toastMsg(`Could not restock: ${err.message}`, "error");
  }
});

/* ---- Issue modal ---- */
function openIssueModal(presetDept) {
  populateTonerSelect(document.getElementById("issueTonerSelect"));
  document.getElementById("issueQuantity").value = 1;
  document.getElementById("issueDepartment").value = presetDept || "";
  document.getElementById("issueTechnician").value = "";
  openModal("modalIssue");
}

document.getElementById("issueForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("issueTonerSelect").value;
  const qty = parseInt(document.getElementById("issueQuantity").value, 10);
  const dept = document.getElementById("issueDepartment").value.trim();
  const tech = document.getElementById("issueTechnician").value.trim() || "—";
  const t = findToner(id);
  if (!t || !qty || qty <= 0) { toastMsg("Choose a toner and a positive quantity.", "error"); return; }
  if (!dept) { toastMsg("Destination department/printer is required.", "error"); return; }
  if (t.qty < qty) { toastMsg(`Not enough stock — only ${t.qty} on hand.`, "error"); return; }
  try {
    await tonersCol.doc(id).update({ qty: t.qty - qty });
    await logTransaction("Issued", t, qty, dept, tech);
    closeModal("modalIssue");
    toastMsg(`Issued ${qty} × ${t.model} to ${dept}.`, "success");
    if (t.qty - qty <= t.minStock) {
      setTimeout(() => toastMsg(`Low stock: '${t.model}' is at ${t.qty - qty} (min ${t.minStock}).`, "error"), 800);
    }
  } catch (err) {
    toastMsg(`Could not issue: ${err.message}`, "error");
  }
});

/* ---- Printer modal ---- */
document.getElementById("printerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fields = {
    name: document.getElementById("printerName").value.trim(),
    model: document.getElementById("printerModel").value.trim(),
    ip: document.getElementById("printerIp").value.trim(),
    dept: document.getElementById("printerDept").value.trim(),
  };
  if (!fields.name || !fields.model || !fields.dept) {
    toastMsg("Printer name, model, and department are required.", "error");
    return;
  }
  try {
    await printersCol.add(fields);
    closeModal("modalPrinter");
    toastMsg(`Added printer '${fields.name}'.`, "success");
  } catch (err) {
    toastMsg(`Could not save: ${err.message}`, "error");
  }
});

/* =============================================================================
   AES-256 backup encryption (Web Crypto API — PBKDF2 + AES-GCM)
   Unchanged from the local edition — still useful for offline archive copies.
   ============================================================================= */
async function deriveKey(passphrase, saltBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function b64ToBuf(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function encryptBackup(plaintext, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return JSON.stringify({
    tonerTrackEncrypted: true,
    salt: bufToB64(salt),
    iv: bufToB64(iv),
    cipher: bufToB64(cipherBuf),
  });
}

async function decryptBackup(payload, passphrase) {
  const salt = new Uint8Array(b64ToBuf(payload.salt));
  const iv = new Uint8Array(b64ToBuf(payload.iv));
  const key = await deriveKey(passphrase, salt);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, b64ToBuf(payload.cipher));
  return new TextDecoder().decode(plainBuf);
}

/* =============================================================================
   Backup / restore / sample data / clear — now operate on Firestore, so a
   restore replaces the SHARED workspace data for every signed-in device.
   ============================================================================= */
/* Column headers for each sheet, and their mapping back to internal field
   names on restore. Using readable headers means the file is genuinely
   useful opened directly in Excel — and because restore re-reads these same
   headers, you can hand-edit the sheet (fix a quantity, add a new row for a
   toner that doesn't exist yet) and re-upload it as a bulk update. */
const TONER_FIELD_MAP = {
  "ID": "id", "Model": "model", "Brand": "brand", "Color": "color",
  "OEM Part #": "partNo", "Qty On Hand": "qty", "Min Threshold": "minStock", "Location": "location",
};
const PRINTER_FIELD_MAP = {
  "ID": "id", "Name": "name", "Model": "model", "Department": "dept", "IP Address": "ip",
};
const TX_FIELD_MAP = {
  "ID": "id", "Date": "date", "Type": "type", "Toner ID": "tonerId",
  "Toner": "tonerLabel", "Quantity": "qty", "Destination": "dest", "Person": "person",
};

function buildWorkbook() {
  const wb = XLSX.utils.book_new();

  const tonerRows = STATE.toners.map((t) => ({
    "ID": t.id, "Model": t.model, "Brand": t.brand, "Color": t.color,
    "OEM Part #": t.partNo, "Qty On Hand": t.qty, "Min Threshold": t.minStock, "Location": t.location,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tonerRows), "Toners");

  const printerRows = STATE.printers.map((p) => ({
    "ID": p.id, "Name": p.name, "Model": p.model, "Department": p.dept, "IP Address": p.ip,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(printerRows), "Printers");

  const txRows = STATE.transactions.map((tx) => ({
    "ID": tx.id, "Date": tx.date, "Type": tx.type, "Toner ID": tx.tonerId,
    "Toner": tx.tonerLabel, "Quantity": tx.qty, "Destination": tx.dest, "Person": tx.person,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txRows), "Transactions");

  return wb;
}

async function exportBackupExcel() {
  if (typeof XLSX === "undefined") {
    toastMsg("Excel library failed to load — check your internet connection and try again.", "error");
    return;
  }
  const wb = buildWorkbook();
  const passphrase = document.getElementById("backupPassphrase").value;

  try {
    if (passphrase) {
      const wbBase64 = XLSX.write(wb, { bookType: "xlsx", type: "base64" });
      const encrypted = await encryptBackup(wbBase64, passphrase);
      downloadBlob(`tonertrack_backup_${todayStr()}.enc`, encrypted, "application/json");
      toastMsg("Encrypted backup downloaded (.enc).", "success");
    } else {
      const wbArray = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      downloadBlob(
        `tonertrack_backup_${todayStr()}.xlsx`,
        wbArray,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      toastMsg("Backup downloaded (.xlsx).", "success");
    }
  } catch (err) {
    console.error(err);
    toastMsg(`Could not build backup file: ${err.message}`, "error");
  }
}

/* Replace every document in all three collections with a new set. Used by
   restore-from-backup, reset-to-sample-data, and clear-all-data. Deletes and
   writes are batched (Firestore batches cap at 500 ops — plenty here). */
async function replaceAllData({ toners = [], printers = [], transactions = [] }) {
  const [tonerSnap, printerSnap, txSnap] = await Promise.all([
    tonersCol.get(), printersCol.get(), txCol.get(),
  ]);

  const batch = db.batch();
  tonerSnap.docs.forEach((d) => batch.delete(d.ref));
  printerSnap.docs.forEach((d) => batch.delete(d.ref));
  txSnap.docs.forEach((d) => batch.delete(d.ref));

  toners.forEach((t) => {
    const { id, ...rest } = t;
    const ref = id ? tonersCol.doc(id) : tonersCol.doc();
    batch.set(ref, rest);
  });
  printers.forEach((p) => {
    const { id, ...rest } = p;
    const ref = id ? printersCol.doc(id) : printersCol.doc();
    batch.set(ref, rest);
  });
  transactions.forEach((tx) => {
    const { id, ...rest } = tx;
    const ref = id ? txCol.doc(id) : txCol.doc();
    batch.set(ref, rest);
  });

  await batch.commit();
}

function toISODateSafe(v) {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number" && typeof XLSX !== "undefined" && XLSX.SSF) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d, d.H, d.M, Math.floor(d.S || 0))).toISOString();
  }
  return v ? String(v) : new Date().toISOString();
}

function sheetToObjects(wb, sheetName, fieldMap) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  return rows.map((row) => {
    const obj = {};
    Object.entries(fieldMap).forEach(([header, field]) => { obj[field] = row[header]; });
    return obj;
  });
}

function workbookToPayload(wb) {
  const toners = sheetToObjects(wb, "Toners", TONER_FIELD_MAP).map((o) => ({
    id: o.id ? String(o.id) : undefined,
    model: String(o.model || "").trim(),
    brand: String(o.brand || "").trim(),
    color: String(o.color || "").trim(),
    partNo: String(o.partNo || "").trim(),
    qty: parseInt(o.qty, 10) || 0,
    minStock: parseInt(o.minStock, 10) || 0,
    location: String(o.location || "").trim(),
  })).filter((t) => t.model); // skip any fully-blank trailing rows

  const printers = sheetToObjects(wb, "Printers", PRINTER_FIELD_MAP).map((o) => ({
    id: o.id ? String(o.id) : undefined,
    name: String(o.name || "").trim(),
    model: String(o.model || "").trim(),
    dept: String(o.dept || "").trim(),
    ip: String(o.ip || "").trim(),
  })).filter((p) => p.name);

  const transactions = sheetToObjects(wb, "Transactions", TX_FIELD_MAP).map((o) => ({
    id: o.id ? String(o.id) : undefined,
    date: toISODateSafe(o.date),
    type: String(o.type || "").trim() || "Restocked",
    tonerId: o.tonerId ? String(o.tonerId) : "",
    tonerLabel: String(o.tonerLabel || "").trim(),
    qty: parseInt(o.qty, 10) || 0,
    dest: String(o.dest || "").trim(),
    person: String(o.person || "").trim() || "—",
  })).filter((tx) => tx.tonerLabel);

  return { toners, printers, transactions };
}

async function handleRestoreFile(file) {
  if (typeof XLSX === "undefined") {
    toastMsg("Excel library failed to load — check your internet connection and try again.", "error");
    return;
  }

  const isEncrypted = file.name.toLowerCase().endsWith(".enc");
  let workbook;

  try {
    if (isEncrypted) {
      const text = await file.text();
      let wrapper;
      try {
        wrapper = JSON.parse(text);
      } catch (err) {
        toastMsg("That .enc file is corrupted or not a TonerTrack Pro backup.", "error");
        return;
      }
      if (!wrapper || !wrapper.tonerTrackEncrypted) {
        toastMsg("That doesn't look like an encrypted TonerTrack Pro backup.", "error");
        return;
      }
      const passphrase = document.getElementById("backupPassphrase").value || window.prompt("Enter the passphrase for this encrypted backup:");
      if (!passphrase) { toastMsg("Restore cancelled — passphrase required.", "error"); return; }
      let wbBase64;
      try {
        wbBase64 = await decryptBackup(wrapper, passphrase);
      } catch (err) {
        toastMsg("Could not decrypt — wrong passphrase or corrupted file.", "error");
        return;
      }
      workbook = XLSX.read(wbBase64, { type: "base64", cellDates: true });
    } else {
      const arrayBuf = await file.arrayBuffer();
      workbook = XLSX.read(arrayBuf, { type: "array", cellDates: true });
    }
  } catch (err) {
    toastMsg(`Could not read that file: ${err.message}`, "error");
    return;
  }

  if (!workbook.SheetNames.includes("Toners")) {
    toastMsg("That workbook doesn't have a 'Toners' sheet — is this a TonerTrack Pro backup?", "error");
    return;
  }

  const payload = workbookToPayload(workbook);

  const ok = window.confirm(
    `Restore this backup? It contains ${payload.toners.length} toner(s), ` +
    `${payload.printers.length} printer(s), and ${payload.transactions.length} transaction(s). ` +
    `This replaces the SHARED workspace data for everyone with access — not just this browser.`
  );
  if (!ok) return;

  try {
    await replaceAllData(payload);
    toastMsg("Backup restored.", "success");
  } catch (err) {
    toastMsg(`Restore failed: ${err.message}`, "error");
  }
}

document.getElementById("importBackupInput").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (file) handleRestoreFile(file);
});

async function restoreSampleData() {
  const ok = window.confirm("Reset to sample data? This replaces the SHARED workspace data for everyone with access.");
  if (!ok) return;
  try {
    await replaceAllData(buildSeedData());
    toastMsg("Sample data restored.", "success");
  } catch (err) {
    toastMsg(`Reset failed: ${err.message}`, "error");
  }
}

async function executeClearData() {
  try {
    await replaceAllData({ toners: [], printers: [], transactions: [] });
    closeModal("modalClearConfirm");
    toastMsg("All data cleared.", "success");
  } catch (err) {
    toastMsg(`Clear failed: ${err.message}`, "error");
  }
}

/* =============================================================================
   CSV exports
   ============================================================================= */
function toCsv(headers, rows) {
  const esc1 = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc1).join(","), ...rows.map((r) => r.map(esc1).join(","))].join("\r\n");
}

function exportInventoryCsv() {
  const headers = ["ID", "Model", "Brand", "Color", "OEM Part #", "Qty On Hand", "Min Threshold", "Location"];
  const rows = STATE.toners.map((t) => [t.id, t.model, t.brand, t.color, t.partNo, t.qty, t.minStock, t.location]);
  const csv = toCsv(headers, rows);
  try {
    downloadBlob(`inventory_${todayStr()}.csv`, csv, "text/csv;charset=utf-8;");
    toastMsg(`Exported ${rows.length} item(s).`, "success");
  } catch (err) {
    showExportFallback("Inventory CSV", csv);
  }
}

function exportHistoryCsv() {
  const headers = ["Date", "Type", "Toner", "Quantity", "Destination", "Person"];
  const rows = STATE.transactions.map((tx) => [new Date(tx.date).toLocaleString(), tx.type, tx.tonerLabel, tx.qty, tx.dest, tx.person]);
  const csv = toCsv(headers, rows);
  try {
    downloadBlob(`audit_log_${todayStr()}.csv`, csv, "text/csv;charset=utf-8;");
    toastMsg(`Exported ${rows.length} record(s).`, "success");
  } catch (err) {
    showExportFallback("Audit Log CSV", csv);
  }
}

/* ---- Fallback modal for when a blob download can't run (e.g. sandboxed preview) ---- */
function showExportFallback(title, content) {
  document.getElementById("exportFallbackTitle").textContent = title;
  document.getElementById("exportFallbackTextarea").value = content;
  openModal("modalExportFallback");
}

document.getElementById("modalExportFallback")?.addEventListener("click", (e) => {
  if (e.target.closest('[data-action="copy-fallback-content"]')) {
    const ta = document.getElementById("exportFallbackTextarea");
    ta.select();
    navigator.clipboard?.writeText(ta.value).then(
      () => toastMsg("Copied to clipboard.", "success"),
      () => toastMsg("Could not copy — select the text manually.", "error")
    );
  }
});

/* =============================================================================
   Copy reorder summary / print
   ============================================================================= */
function copyReorderSummary() {
  const text = reorderSummaryText();
  navigator.clipboard?.writeText(text).then(
    () => toastMsg("Reorder summary copied to clipboard.", "success"),
    () => showExportFallback("Reorder Summary", text)
  );
}

/* =============================================================================
   ZIP download & clean HTML export
   ============================================================================= */
function currentPageHtml() {
  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll("script[data-bard-client-injected]").forEach((s) => s.remove());
  return "<!DOCTYPE html>\n" + clone.outerHTML;
}

function downloadCleanHtml() {
  downloadBlob("index.html", currentPageHtml(), "text/html;charset=utf-8;");
  toastMsg("Downloaded a clean copy of index.html.", "success");
}

let zipBlob = null;

async function prepareZip() {
  const btn = document.getElementById("btnDownloadZip");
  if (typeof JSZip === "undefined") {
    btn.textContent = "ZIP unavailable";
    return;
  }
  try {
    const zip = new JSZip();
    zip.file("index.html", currentPageHtml());
    zipBlob = await zip.generateAsync({ type: "blob" });
    btn.disabled = false;
    btn.textContent = "⬇ Download ZIP";
  } catch (err) {
    console.error("ZIP preparation failed:", err);
    btn.textContent = "ZIP unavailable";
  }
}

function downloadZip() {
  if (!zipBlob) { toastMsg("ZIP is still being prepared, try again in a moment.", "error"); return; }
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `TonerTrackPro_${todayStr()}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* =============================================================================
   Global click delegation — every data-action lands here
   ============================================================================= */
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;

  switch (action) {
    case "open-modal":
      openModal(el.dataset.target);
      break;
    case "close-modal":
      closeModal(el.dataset.target);
      break;
    case "open-add-toner":
      openAddTonerModal();
      break;
    case "delete-toner": {
      const t = findToner(el.dataset.id);
      if (t && window.confirm(`Delete '${t.model}'? This can't be undone.`)) {
        tonersCol.doc(t.id).delete()
          .then(() => toastMsg(`Deleted '${t.model}'.`, "success"))
          .catch((err) => toastMsg(`Could not delete: ${err.message}`, "error"));
      }
      break;
    }
    case "quick-adjust": {
      const t = findToner(el.dataset.id);
      const diff = parseInt(el.dataset.diff, 10) || 0;
      if (!t) break;
      if (t.qty + diff < 0) { toastMsg("Already at zero.", "error"); break; }
      tonersCol.doc(t.id).update({ qty: t.qty + diff })
        .then(() => logTransaction(diff > 0 ? "Restocked" : "Issued", t, Math.abs(diff), diff > 0 ? t.location : "Quick adjust", "Quick adjust"))
        .catch((err) => toastMsg(`Could not update: ${err.message}`, "error"));
      break;
    }
    case "open-restock":
      openRestockModal();
      break;
    case "quick-restock-reorder": {
      const t = findToner(el.dataset.id);
      const qty = parseInt(el.dataset.qty, 10) || 0;
      if (!t || qty <= 0) break;
      tonersCol.doc(t.id).update({ qty: t.qty + qty })
        .then(() => logTransaction("Restocked", t, qty, t.location, "Reorder system"))
        .then(() => toastMsg(`Restocked ${qty} × ${t.model}.`, "success"))
        .catch((err) => toastMsg(`Could not restock: ${err.message}`, "error"));
      break;
    }
    case "open-issue":
      openIssueModal();
      break;
    case "quick-issue-printer":
      openIssueModal(decodeURIComponent(el.dataset.dept || ""));
      break;
    case "delete-printer": {
      const p = findPrinter(el.dataset.id);
      if (p && window.confirm(`Remove printer '${p.name}'?`)) {
        printersCol.doc(p.id).delete()
          .then(() => toastMsg(`Removed '${p.name}'.`, "success"))
          .catch((err) => toastMsg(`Could not delete: ${err.message}`, "error"));
      }
      break;
    }
    case "export-inventory-csv":
      exportInventoryCsv();
      break;
    case "export-history-csv":
      exportHistoryCsv();
      break;
    case "export-backup-excel":
      exportBackupExcel();
      break;
    case "restore-sample-data":
      restoreSampleData();
      break;
    case "execute-clear-data":
      executeClearData();
      break;
    case "window-print":
      window.print();
      break;
    case "copy-reorder-summary":
      copyReorderSummary();
      break;
    case "copy-fallback-content":
      // handled by the dedicated listener on modalExportFallback above
      break;
    case "download-zip":
      downloadZip();
      break;
    case "download-clean-html":
      downloadCleanHtml();
      break;
    default:
      break;
  }
});

/* =============================================================================
   Modal backdrop click-to-close (click outside the panel)
   ============================================================================= */
document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.classList.remove("active");
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  document.querySelectorAll(".modal-backdrop.active").forEach((m) => m.classList.remove("active"));
});

/* =============================================================================
   Init
   ============================================================================= */
setAuthMode("signin");
renderAll();
prepareZip();
