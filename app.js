// app.js — Tucker's Camp Lite
// Step 4: Harvest Log + Home Live Data
// Version: lite-1.1.0

import { auth, db, storage } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  verifyBeforeUpdateEmail,
  updatePassword,
  sendPasswordResetEmail,
  reauthenticateWithCredential,
  EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  deleteField
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ============================================================
// APP VERSION
// ============================================================
const APP_VERSION = "lite-2.16.0";



// ============================================================
// TOAST & MODAL SYSTEM — defined early so all code can use them
// ============================================================
window.showToast = function (msg, type = "info", duration = 3000) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = "toast" + (type === "success" ? " toast-success" : type === "error" ? " toast-error" : "");
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.3s";
    setTimeout(() => el.remove(), 320);
  }, duration);
};

// Alias for internal use before window assignment propagates
const showToast = window.showToast;

window.appConfirm = function (title, message, onConfirm, onCancel) {
  const modal    = document.getElementById("app-modal");
  const mTitle   = document.getElementById("modal-title");
  const mBody    = document.getElementById("modal-body");
  const mInput   = document.getElementById("modal-input");
  const mActions = document.getElementById("modal-actions");
  if (!modal) return;
  mTitle.textContent = title;
  mBody.textContent  = message;
  mInput.classList.add("hidden");
  mActions.innerHTML = "";
  modal.classList.remove("hidden");

  const cancelBtn = document.createElement("button");
  cancelBtn.className   = "btn btn-secondary btn-sm";
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick     = () => { modal.classList.add("hidden"); if (onCancel) onCancel(); };


  const confirmBtn = document.createElement("button");
  confirmBtn.className   = "btn btn-primary btn-sm";
  confirmBtn.textContent = "Confirm";
  confirmBtn.onclick     = () => { modal.classList.add("hidden"); if (onConfirm) onConfirm(); };

  mActions.appendChild(cancelBtn);
  mActions.appendChild(confirmBtn);
};

const appConfirm = window.appConfirm;

window.appPrompt = function (title, placeholder, onSubmit, onCancel) {
  const modal    = document.getElementById("app-modal");
  const mTitle   = document.getElementById("modal-title");
  const mBody    = document.getElementById("modal-body");
  const mInput   = document.getElementById("modal-input");
  const mActions = document.getElementById("modal-actions");
  if (!modal) return;
  mTitle.textContent = title;
  mBody.textContent  = "";
  mInput.value       = "";
  mInput.placeholder = placeholder || "";
  mInput.classList.remove("hidden");
  mActions.innerHTML = "";
  modal.classList.remove("hidden");
  setTimeout(() => mInput.focus(), 50);

  const cancelBtn = document.createElement("button");
  cancelBtn.className   = "btn btn-secondary btn-sm";
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick     = () => { modal.classList.add("hidden"); if (onCancel) onCancel(); };


  const submitBtn = document.createElement("button");
  submitBtn.className   = "btn btn-primary btn-sm";
  submitBtn.textContent = "OK";
  submitBtn.onclick     = () => {
    const val = mInput.value.trim();
    modal.classList.add("hidden");
    if (onSubmit) onSubmit(val);
  };

  mInput.onkeydown = (e) => { if (e.key === "Enter") submitBtn.click(); };
  mActions.appendChild(cancelBtn);
  mActions.appendChild(submitBtn);
};

const appPrompt = window.appPrompt;


// ============================================================
// SAFE HTML HELPERS
// Every piece of user-entered text (names, comments, notes, captions,
// bulletins…) must be run through esc() before it goes into innerHTML.
// ============================================================
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// Validate a stored avatar/hex color before dropping it into a style attribute.
function safeColor(c) {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(c || "")) ? String(c) : "#556B2F";
}

// Best-effort delete of an uploaded image from Storage when its record is
// removed. Never throws — an already-gone file or a non-Storage URL is fine.
async function deleteStoredImage(url) {
  if (!url || typeof url !== "string" || !url.includes("firebasestorage")) return;
  try { await deleteObject(ref(storage, url)); }
  catch (err) { if (err?.code !== "storage/object-not-found") console.warn("Storage cleanup:", err?.code || err); }
}


// ============================================================
// STATE
// ============================================================
let currentUser   = null;   // Firebase auth user
let userProfile   = null;   // Firestore user doc
let currentScreen = "screen-home";
let pendingSW     = null;   // Waiting service worker

// Avatar color options
const AVATAR_COLORS = [
  "#8B4513", // saddle brown
  "#2E8B57", // sea green
  "#556B2F", // dark olive
  "#8B6914", // dark gold
  "#4682B4", // steel blue
  "#8B3A3A", // dark red
  "#6B4C8B", // muted purple
  "#3A6B4C", // forest teal
  "#7B5B3A", // warm brown
  "#4C4C8B"  // slate blue
];

// ============================================================
// INIT
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  registerServiceWorker();
  buildAvatarSwatches();

  const verEl = document.getElementById("app-version");
  if (verEl) verEl.textContent = APP_VERSION.replace(/^lite-/, "v");

  onAuthStateChanged(auth, async (fbUser) => {
    if (signupInProgress) return;   // doSignup drives the flow itself
    if (fbUser) {
      currentUser = fbUser;
      maybeAutoUpdate();            // pull the latest version on the way in
      await loadUserProfile(fbUser.uid);
    } else {
      currentUser = null;
      userProfile = null;
      showLoginScreen();
      openAutoUpdateWindow(0);      // at the door — safe to refresh silently
      maybeAutoUpdate();
    }
  });

  // Flush any calls that were queued before module finished loading
  if (typeof window._moduleReady === 'function') window._moduleReady();
});

// ============================================================
// SERVICE WORKER
// ============================================================
// Auto-refresh window: while this is open (login screen, and the first ~30s
// after signing in) a new version is applied silently. Outside it — i.e. mid-
// session — we show the update banner instead of yanking the page.
let autoUpdateOK       = true;
let autoUpdateReloading = false;
let _autoUpdateGrace   = null;

function openAutoUpdateWindow(ms) {
  autoUpdateOK = true;
  clearTimeout(_autoUpdateGrace);
  if (ms) _autoUpdateGrace = setTimeout(() => { autoUpdateOK = false; }, ms);
}

function handleReadyWorker(worker) {
  if (!worker) return;
  if (autoUpdateOK && !autoUpdateReloading) {
    autoUpdateReloading = true;
    worker.postMessage({ type: "SKIP_WAITING" });   // → controllerchange → reload
  } else {
    pendingSW = worker;
    document.getElementById("update-banner")?.classList.remove("hidden");
  }
}

// Silently check for and apply a pending update. Safe to call often.
function maybeAutoUpdate() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.getRegistration().then(reg => {
    if (!reg) return;
    if (reg.waiting) { handleReadyWorker(reg.waiting); return; }
    reg.update()
      .then(() => setTimeout(() => { if (reg.waiting) handleReadyWorker(reg.waiting); }, 1500))
      .catch(() => {});
  }).catch(() => {});
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.register("/sw.js").then((reg) => {
    reg.update();

    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          handleReadyWorker(reg.waiting || newWorker);
        }
      });
    });
  });

  // When a new SW takes control, reload to run the new version
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}

window.checkForUpdate = async function () {
  if (!("serviceWorker" in navigator)) { window.location.reload(); return; }
  try {
    showToast("Checking for updates…");
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) { window.location.reload(); return; }
    await reg.update();
    if (reg.waiting) {
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
      return;
    }
    setTimeout(() => showToast("You have the latest version.", "success"), 800);
  } catch(err) { window.location.reload(); }
};

window.applyUpdate = function () {
  document.getElementById("update-banner")?.classList.add("hidden");
  if (pendingSW) {
    pendingSW.postMessage({ type: "SKIP_WAITING" });
  } else {
    navigator.serviceWorker.getRegistration().then(reg => {
      if (reg?.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      else window.forceUpdate();
    });
  }
};

window.forceUpdate = async function () {
  showToast("Clearing cache and reloading…");
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    window.location.reload(true);
  } catch(err) { window.location.reload(true); }
};

// ============================================================
// AUTH — SIGN IN / CREATE ACCOUNT / RESET
// ============================================================
let signupInProgress = false;

window.showLoginPane = function (pane) {
  ["signin", "signup", "forgot"].forEach(p => {
    document.getElementById("pane-" + p)?.classList.toggle("hidden", p !== pane);
  });
  document.getElementById("seg-signin")?.classList.toggle("active", pane === "signin");
  document.getElementById("seg-signup")?.classList.toggle("active", pane === "signup");
  if (pane === "signup") refreshSignupAvailability();
};

// hashed camp code + open flag — a public-readable config doc
async function loadSignupConfig() {
  try {
    const snap = await getDoc(doc(db, "config", "signup"));
    return snap.exists() ? snap.data() : null;
  } catch (_) { return null; }
}
async function refreshSignupAvailability() {
  const cfg  = await loadSignupConfig();
  const open = !!(cfg && cfg.open && cfg.codeHash);
  document.getElementById("signup-closed")?.classList.toggle("hidden", open);
  document.getElementById("signup-fields")?.classList.toggle("hidden", !open);
}
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function normalizeCode(c) { return (c || "").trim().toLowerCase().replace(/\s+/g, ""); }

window.doLogin = async function () {
  const email    = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  if (!email || !password) { showToast("Enter your email and password.", "error"); return; }
  const btn = document.getElementById("signin-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Signing in…"; }
  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged handles the rest
  } catch (err) {
    console.error("Login error:", err.code);
    showToast(friendlyAuthError(err.code), "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Sign In"; }
  }
};

window.doForgotPassword = async function () {
  const email = document.getElementById("forgot-email").value.trim();
  if (!email) { showToast("Enter your email.", "error"); return; }
  const btn = document.getElementById("forgot-btn");
  if (btn) btn.disabled = true;
  try {
    await sendPasswordResetEmail(auth, email);
    showToast("If that email has an account, a reset link is on its way.", "success");
    showLoginPane("signin");
  } catch (err) {
    console.error("Reset error:", err.code);
    showToast(friendlyAuthError(err.code), "error");
  } finally {
    if (btn) btn.disabled = false;
  }
};

window.doSignup = async function () {
  const code   = document.getElementById("signup-code").value;
  const name   = document.getElementById("signup-name").value.trim();
  const email  = document.getElementById("signup-email").value.trim();
  const pass   = document.getElementById("signup-password").value;
  const swatch = document.querySelector("#signup-swatches .avatar-swatch.selected");
  const color  = swatch ? swatch.dataset.color : AVATAR_COLORS[0];
  const btn    = document.getElementById("signup-btn");

  if (!code)            { showToast("Enter the camp code.", "error"); return; }
  if (name.length < 2)  { showToast("Enter your name.", "error"); return; }
  if (!email)           { showToast("Enter your email.", "error"); return; }
  if (pass.length < 8)  { showToast("Password needs at least 8 characters.", "error"); return; }

  if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
  try {
    const cfg = await loadSignupConfig();
    if (!cfg || !cfg.open || !cfg.codeHash) {
      showToast("Sign-ups are closed right now.", "error");
      refreshSignupAvailability();
      return;
    }
    if (await sha256Hex(normalizeCode(code)) !== cfg.codeHash) {
      showToast("That camp code isn't right.", "error");
      return;
    }

    signupInProgress = true;
    if (btn) btn.textContent = "Creating account…";
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const uid  = cred.user.uid;
    const finalInitials = initials(name);
    await setDoc(doc(db, "users", uid), {
      displayName: name,
      initials:    finalInitials,
      color,
      role:        "user",
      email,
      createdAt:   serverTimestamp(),
      updatedAt:   serverTimestamp()
    });
    currentUser = cred.user;
    userProfile = { uid, displayName: name, initials: finalInitials, color, role: "user" };
    signupInProgress = false;
    showToast("Welcome to Tucker's Camp!", "success");
    enterApp();
  } catch (err) {
    signupInProgress = false;
    console.error("Signup error:", err.code || err);
    showToast(friendlyAuthError(err.code), "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Create Account"; }
  }
};

window.doLogout = function () {
  appConfirm("Sign Out", "Sign out of Tucker's Camp?", async () => {
    closeDrawer();
    try { await signOut(auth); } catch (_) {}
    // onAuthStateChanged calls showLoginScreen
  });
};

function friendlyAuthError(code) {
  switch (code) {
    case "auth/invalid-email":            return "That email address doesn't look right.";
    case "auth/user-not-found":           return "No account found with that email.";
    case "auth/wrong-password":           return "Wrong password. Try again.";
    case "auth/invalid-credential":       return "Email or password is incorrect.";
    case "auth/email-already-in-use":     return "There's already an account with that email — try signing in.";
    case "auth/weak-password":            return "That password is too weak — use at least 8 characters.";
    case "auth/missing-password":         return "Enter a password.";
    case "auth/too-many-requests":        return "Too many attempts. Please wait a moment.";
    case "auth/network-request-failed":   return "Network error. Check your connection.";
    default:                              return "Something went wrong. Please try again.";
  }
}

// ============================================================
// USER PROFILE
// ============================================================
async function loadUserProfile(uid) {
  try {
    const ref  = doc(db, "users", uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      // New user — show name setup
      showNameSetupModal();
      return;
    }

    const data = snap.data();
    if (!data.displayName) {
      showNameSetupModal();
      return;
    }

    userProfile = {
      uid,
      displayName: data.displayName,
      initials:    data.initials    || initials(data.displayName),
      color:       data.color       || AVATAR_COLORS[0],
      role:        data.role        || "user"
    };

    // Keep the member's email on file (for admin password resets) — backfill it
    // and pick up any change made via verifyBeforeUpdateEmail.
    const authEmail = auth.currentUser?.email;
    if (authEmail && data.email !== authEmail) {
      setDoc(ref, { email: authEmail }, { merge: true }).catch(() => {});
    }

    enterApp();
  } catch (err) {
    console.error("Profile load error:", err);
    showToast("Could not load your profile. Check your connection.", "error");
  }
}

function initials(name) {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ============================================================
// NAME SETUP
// ============================================================
function buildAvatarSwatches() {
  document.querySelectorAll(".avatar-swatches").forEach(container => {
    container.innerHTML = "";
    AVATAR_COLORS.forEach((color, i) => {
      const el = document.createElement("div");
      el.className  = "avatar-swatch" + (i === 0 ? " selected" : "");
      el.style.background = color;
      el.dataset.color = color;
      el.onclick = () => {
        container.querySelectorAll(".avatar-swatch").forEach(s => s.classList.remove("selected"));
        el.classList.add("selected");
      };
      container.appendChild(el);
    });
  });
}

function showNameSetupModal() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("name-setup-modal").classList.remove("hidden");
}

window.saveNameSetup = async function () {
  const name     = document.getElementById("setup-name").value.trim();
  const inits    = document.getElementById("setup-initials").value.trim().toUpperCase();
  const selected = document.querySelector("#avatar-swatches .avatar-swatch.selected");
  const color    = selected ? selected.dataset.color : AVATAR_COLORS[0];

  if (!name) {
    showToast("Please enter a display name.", "error");
    return;
  }

  const finalInitials = inits || initials(name);

  try {
    const uid = currentUser.uid;
    await setDoc(doc(db, "users", uid), {
      displayName:  name,
      initials:     finalInitials,
      color:        color,
      role:         "user",
      email:        auth.currentUser?.email || null,
      createdAt:    serverTimestamp(),
      updatedAt:    serverTimestamp()
    }, { merge: true });

    userProfile = { uid, displayName: name, initials: finalInitials, color, role: "user" };
    document.getElementById("name-setup-modal").classList.add("hidden");
    enterApp();
  } catch (err) {
    console.error("Save name error:", err);
    showToast("Could not save your profile. Try again.", "error");
  }
};

// ============================================================
// ENTER / LEAVE APP
// ============================================================
function showLoginScreen() {
  document.getElementById("app").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("name-setup-modal").classList.add("hidden");
  ["login-email", "login-password", "signup-code", "signup-name",
   "signup-email", "signup-password", "forgot-email"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  showLoginPane("signin");
}

function enterApp() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("name-setup-modal").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");

  // keep auto-refresh on for ~30s after entry, then fall back to the banner
  openAutoUpdateWindow(30000);

  // Update drawer user name
  document.getElementById("drawer-user-name").textContent =
    userProfile?.displayName || "Member";

  // Show admin panel button for admins only
  const adminBtn = document.getElementById("drawer-admin-btn");
  if (adminBtn) adminBtn.style.display = userProfile?.role === "admin" ? "flex" : "none";

  // Navigate home
  showScreen("screen-home");
  setActiveNavBtn("nav-home");

  // Build home screen
  renderHomeScreen();

  // Init kill counter
  updateKillCounter();
}

// ============================================================
// NAVIGATION
// ============================================================
window.showScreen = function (screenId) {
  // Clean up listeners when leaving screens
  if (currentScreen !== screenId) {
    if (currentScreen === "screen-harvest"  && harvestListUnsub) { harvestListUnsub(); harvestListUnsub = null; }
    if (currentScreen === "screen-trailcam" && trailCamUnsub)    { trailCamUnsub();   trailCamUnsub   = null; }
    if (currentScreen === "screen-feed"     && feedUnsub)        { feedUnsub();       feedUnsub       = null; }
    if (currentScreen === "screen-contests") teardownContestListeners();
  }

  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const target = document.getElementById(screenId);
  if (target) {
    target.classList.add("active");
    target.scrollTop = 0;
  }
  currentScreen = screenId;

  // FAB visibility
  const fabScreens = ["screen-harvest", "screen-trailcam", "screen-feed", "screen-calendar"];
  const fab = document.getElementById("fab-btn");
  if (fab) fab.classList.toggle("hidden", !fabScreens.includes(screenId));

  document.getElementById("main-content").scrollTop = 0;
};

window.goHome = function () {
  showScreen("screen-home");
  setActiveNavBtn("nav-home");
};

window.goMap = function () {
  showScreen("screen-map");
  setActiveNavBtn("nav-map");
  renderMapScreen();
};

window.goTo = function (screenId) {
  closeDrawer();
  showScreen(screenId);

  // Render screens on demand
  switch (screenId) {
    case "screen-settings": renderSettingsScreen(); break;
    case "screen-updates":  renderUpdatesScreen();  break;
    case "screen-bylaws":   renderBylawsScreen();   break;
    case "screen-contests": renderContestsScreen(); break;
    case "screen-mykills":  renderTrophyRoom();     break;
    case "screen-master-trophy": renderMasterTrophyRoom(); break;
    case "screen-admin":    renderAdminScreen();    break;
  }
};

window.closeDrawerAndGoHome = function () {
  closeDrawer();
  goHome();
};

function setActiveNavBtn(id) {
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  const btn = document.getElementById(id);
  if (btn) btn.classList.add("active");
}

// ============================================================
// DRAWER
// ============================================================
window.openDrawer = function () {
  document.getElementById("drawer").classList.add("open");
  document.getElementById("drawer-overlay").classList.add("open");
};

window.closeDrawer = function () {
  document.getElementById("drawer").classList.remove("open");
  document.getElementById("drawer-overlay").classList.remove("open");
};

// ============================================================
// FAB — placeholder until feature screens are built
// ============================================================
window.fabAction = function () {
  switch (currentScreen) {
    case "screen-harvest":  openAddHarvest();  break;
    case "screen-trailcam": openAddTrailCam(); break;
    case "screen-feed":     openAddPost();     break;
    case "screen-calendar": openAddVisit(); break;
  }
};

// Stubs — filled in as steps complete
// openAddTrailCam defined in Trail Cam module below
function openAddPost()     { openFeedCompose(); }
function openAddVisit()    { openAddCalendarVisit(); }

// ============================================================
// NOTIFICATIONS
// ============================================================
window.openNotifications = function () {
  showScreen("screen-notifications");
  document.getElementById("notifications-content").innerHTML = `
    <div style="padding:32px 16px;text-align:center;color:var(--text-muted)">
      <div style="font-size:36px;margin-bottom:12px">🔔</div>
      <div>Coming soon — stay tuned.</div>
    </div>
  `;
};

// ============================================================
// HOME SCREEN
// ============================================================
function renderHomeScreen() {
  document.getElementById("home-hero-wrap").innerHTML = `<div id="home-calendar-wrap"></div>`;
  initHomeCalendar();

  renderCheckinButton();
  loadHomeBulletins();

  document.getElementById("home-grid-wrap").innerHTML = `
    <div class="fade-divider" style="margin:16px 16px;"></div>
    <div class="section-header" style="padding-top:0">
      <div class="section-title">✦ Quick Actions</div>
    </div>
    <div class="action-stack">
      ${actionBtn("🦌", "Log Harvest",   "openAddHarvest()")}
      ${actionBtn("💬", "Message Camp",  "openFeedCompose()")}
      ${actionBtn("📷", "Trail Cam",     "goTrailCam()")}
      ${actionBtn("🏆", "Trophy Room",   "goTo('screen-mykills')")}
    </div>
  `;

  document.getElementById("home-harvests-wrap").innerHTML = `
    <div class="fade-divider" style="margin:16px 16px;"></div>
    <div class="harvests-panel">
      <div class="harvests-header">
        <div class="section-title" style="font-size:15px">🦌 Recent Harvests</div>
        <button class="btn-action btn-sm" onclick="goHarvest()">View All</button>
      </div>
      <div id="recent-harvests-list">
        <div style="padding:14px 16px;color:var(--text-dim);font-size:13px;font-style:italic">
          No recent harvests yet. Be the first to log one!
        </div>
      </div>
    </div>
    <div style="height:8px"></div>
  `;
}

function actionBtn(icon, label, action) {
  return `<button class="action-btn" onclick="${action}">
    <span class="action-icon">${icon}</span>
    <span class="action-label">${label}</span>
    <span class="action-chevron">›</span>
  </button>`;
}

// ── Home screen mini calendar — the front page now leads with "what's
// happening", not a static photo. Same red-dot grid as the full Calendar
// screen; tapping a day opens the same day sheet either way. ────────────
async function initHomeCalendar() {
  const el = document.getElementById("home-calendar-wrap");
  if (!el) return;
  el.innerHTML = `<div class="home-cal-card" style="padding:30px;text-align:center">
    <div class="spinner" style="margin:0 auto"></div></div>`;
  await loadCalendarMonth(calCurrentYear, calCurrentMonth);
  renderHomeCalendarCard(el);
}

function renderHomeCalendarCard(el) {
  if (!el) return;
  const year = calCurrentYear, month = calCurrentMonth;
  const moon = moonPhase(new Date());
  el.innerHTML = `
    <div class="home-cal-card">
      <div class="home-cal-head">
        <button class="cal-nav-btn" onclick="calPrevMonth()">‹</button>
        <div class="home-cal-title">
          <span class="home-cal-month">${CAL_MONTHS[month]}</span>
          <span class="home-cal-year">${year}</span>
        </div>
        <button class="cal-nav-btn" onclick="calNextMonth()">›</button>
      </div>
      <div class="home-cal-chips">
        <span class="weather-pill" id="weather-strip">⏳ Loading weather…</span>
        <span class="weather-pill" title="${esc(moon.name)}">${moon.icon} ${esc(moon.name)}</span>
      </div>
      <div class="dow-row">${CAL_DAYS.map(d => `<div>${d[0]}</div>`).join("")}</div>
      <div class="home-cal-grid">${monthGridCellsHTML(year, month, "sm")}</div>
      <button class="home-cal-link" onclick="goCalendar()">Open full calendar →</button>
    </div>`;
  fetchWeather();
}

// ============================================================
// HOME BULLETINS — load from Firestore, post button for all users
// ============================================================
async function loadHomeBulletins() {
  const wrap = document.getElementById("home-bulletins-wrap");
  if (!wrap) return;

  try {
    const q    = query(collection(db, "bulletins"), orderBy("createdAt", "desc"), limit(5));
    const snap = await getDocs(q);

    // Sort: pinned first
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

    const canPost = userProfile;

    wrap.innerHTML = `
      <div class="fade-divider" style="margin:14px 16px;"></div>
      <div class="bulletins-panel">
        <div class="bulletins-header">
          <div class="section-title" style="font-size:15px">📢 Bulletins</div>
          <div style="display:flex;gap:6px">
            ${canPost ? `<button class="btn-action btn-sm" onclick="openPostBulletin()">+ Post</button>` : ""}
          </div>
        </div>
        <div class="bulletins-body">
          ${docs.length === 0
            ? `<div class="bulletin-item" style="color:var(--text-dim);font-style:italic">No bulletins yet.</div>`
            : docs.slice(0, 3).map(b => `
                <div class="bulletin-item">
                  ${b.pinned ? `<span style="color:var(--gold);font-size:11px;margin-right:4px">📌</span>` : ""}
                  <span style="color:var(--text-warm)">${esc(b.text)}</span>
                  <div style="font-size:11px;color:var(--text-dim);margin-top:3px">
                    ${esc(b.authorName || "Admin")} · ${formatDate(b.createdAt)}
                  </div>
                </div>`).join("")}
        </div>
      </div>`;
  } catch(err) {
    console.error(err);
    const wrap2 = document.getElementById("home-bulletins-wrap");
    if (wrap2) wrap2.innerHTML = "";
  }
}

window.openPostBulletin = function () {
  const ov = document.createElement("div");
  ov.className = "modal-overlay"; ov.id = "bulletin-post-overlay";
  ov.innerHTML = `
    <div class="modal-box" style="max-width:360px">
      <div class="modal-title">📢 Post Bulletin</div>
      <div class="input-group" style="margin-bottom:16px">
        <label>Bulletin Text</label>
        <textarea id="bulletin-text" placeholder="Write your bulletin…" style="min-height:100px"></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('bulletin-post-overlay').remove()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="submitBulletin()">Post</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
};

// ============================================================
// WEATHER (Open-Meteo — Wausaukee/Crivitz WI)
// ============================================================
async function fetchWeather() {
  const lat = 45.3799, lon = -88.0343; // Wausaukee WI
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/Chicago`;
    const res  = await fetch(url);
    const data = await res.json();
    const cur  = data.current;
    const temp = Math.round(cur.temperature_2m);
    const wind = Math.round(cur.wind_speed_10m);
    const dir  = windDir(cur.wind_direction_10m);

    document.getElementById("weather-strip").innerHTML =
      `🌡️ ${temp}°F &nbsp;|&nbsp; 💨 ${wind} mph ${dir}`;
  } catch {
    const el = document.getElementById("weather-strip");
    if (el) el.textContent = "Weather unavailable";
  }
}

function windDir(deg) {
  const dirs = ["N","NE","E","SE","S","SW","W","NW"];
  return dirs[Math.round(deg / 45) % 8];
}

// ============================================================
// MAP SCREEN — Camp map image
// ============================================================
function renderMapScreen() {
  const el = document.getElementById("map-content");
  if (!el) return;
  el.innerHTML = `
    <div style="padding:16px">
      <div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;
                  letter-spacing:0.5px;margin-bottom:10px">Camp Map</div>
      <button onclick="openMapFull()"
        style="display:block;width:100%;padding:0;border:1px solid var(--card-border);
               border-radius:var(--radius-lg);overflow:hidden;background:var(--forest-card);
               cursor:pointer">
        <img src="Images/cabinmap.jpg" alt="Tucker's Camp map"
          style="width:100%;display:block" />
      </button>
      <div style="font-size:12px;color:var(--text-dim);text-align:center;margin-top:8px">
        Tap the map to open it full screen
      </div>
    </div>
  `;
}

window.openMapFull = function () {
  if (document.getElementById("map-lightbox")) return;
  const lb = document.createElement("div");
  lb.id = "map-lightbox";
  lb.style.cssText = "position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,0.97);" +
                     "display:flex;flex-direction:column;overflow:hidden";
  const btnStyle = "background:rgba(255,255,255,0.1);border:1px solid var(--card-border);" +
                   "color:var(--text-warm);width:36px;height:36px;border-radius:50%;" +
                   "font-size:20px;line-height:1;cursor:pointer;font-family:var(--font-sans);flex-shrink:0";
  lb.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;
                padding:12px 16px;flex-shrink:0;position:relative;z-index:2">
      <div style="font-family:var(--font-serif);font-size:16px;color:var(--gold)">Camp Map</div>
      <div style="display:flex;gap:8px">
        <button onclick="mapZoom(-1)" style="${btnStyle}">−</button>
        <button onclick="mapZoom(1)" style="${btnStyle}">+</button>
        <button onclick="document.getElementById('map-lightbox').remove()" style="${btnStyle};font-size:18px">✕</button>
      </div>
    </div>
    <div id="map-vp" style="flex:1;position:relative;overflow:hidden;
                            touch-action:none;cursor:grab;background:#000">
      <img id="map-img" src="Images/cabinmap.jpg" alt="Tucker's Camp map" draggable="false"
        style="position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform;
               user-select:none;-webkit-user-drag:none" />
    </div>
    <div style="flex-shrink:0;text-align:center;padding:8px;font-size:11px;color:var(--text-dim)">
      Drag to move in any direction · pinch, scroll or ± to zoom
    </div>`;
  document.body.appendChild(lb);
  initMapPanZoom();
};

// Free pan + zoom for the full-screen map (drag in any direction, pinch/wheel/± to zoom).
function initMapPanZoom() {
  const vp  = document.getElementById("map-vp");
  const img = document.getElementById("map-img");
  if (!vp || !img) return;

  let natW = 1, natH = 1, scale = 1, minScale = 1, x = 0, y = 0;
  const pts = new Map();
  let base = null;

  const alive = () => document.body.contains(vp);

  const clamp = () => {
    const w = natW * scale, h = natH * scale;
    const vw = vp.clientWidth, vh = vp.clientHeight;
    x = w <= vw ? (vw - w) / 2 : Math.max(vw - w, Math.min(0, x));
    y = h <= vh ? (vh - h) / 2 : Math.max(vh - h, Math.min(0, y));
  };
  const render = () => { clamp(); img.style.transform = `translate(${x}px,${y}px) scale(${scale})`; };

  const fit = () => {
    if (!alive()) { window.removeEventListener("resize", fit); return; }
    const vw = vp.clientWidth, vh = vp.clientHeight;
    minScale = Math.min(vw / natW, vh / natH) || 1;
    scale = minScale; x = 0; y = 0; render();
  };

  const ready = () => {
    natW = img.naturalWidth || 1200;
    natH = img.naturalHeight || 900;
    img.style.width = natW + "px";
    img.style.height = natH + "px";
    fit();
  };
  if (img.complete && img.naturalWidth) ready(); else img.onload = ready;

  const zoomAt = (clientX, clientY, factor) => {
    const ns = Math.max(minScale, Math.min(minScale * 10, scale * factor));
    const r = vp.getBoundingClientRect();
    const px = clientX - r.left, py = clientY - r.top;
    const k = ns / scale;
    x = px - (px - x) * k;
    y = py - (py - y) * k;
    scale = ns;
    render();
  };

  window.mapZoom = (dir) => {
    const r = vp.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, dir > 0 ? 1.5 : 1 / 1.5);
  };

  const snapshot = () => ({ x, y, scale, pts: [...pts.values()].map(p => ({ x: p.x, y: p.y })) });

  vp.addEventListener("pointerdown", (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    base = snapshot();
    vp.style.cursor = "grabbing";
    try { vp.setPointerCapture(e.pointerId); } catch (_) {}
  });

  vp.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId) || !base) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const cur = [...pts.values()];

    if (cur.length === 1 && base.pts.length >= 1) {
      x = base.x + (cur[0].x - base.pts[0].x);
      y = base.y + (cur[0].y - base.pts[0].y);
      render();
    } else if (cur.length === 2 && base.pts.length === 2) {
      const bd = Math.hypot(base.pts[0].x - base.pts[1].x, base.pts[0].y - base.pts[1].y) || 1;
      const cd = Math.hypot(cur[0].x - cur[1].x, cur[0].y - cur[1].y);
      const ns = Math.max(minScale, Math.min(minScale * 10, base.scale * (cd / bd)));
      const r = vp.getBoundingClientRect();
      const mx = (base.pts[0].x + base.pts[1].x) / 2 - r.left;
      const my = (base.pts[0].y + base.pts[1].y) / 2 - r.top;
      const k = ns / base.scale;
      x = mx - (mx - base.x) * k;
      y = my - (my - base.y) * k;
      scale = ns;
      render();
    }
  });

  const endPointer = (e) => {
    pts.delete(e.pointerId);
    base = pts.size ? snapshot() : null;
    if (!pts.size) vp.style.cursor = "grab";
  };
  vp.addEventListener("pointerup", endPointer);
  vp.addEventListener("pointercancel", endPointer);

  vp.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });

  vp.addEventListener("dblclick", (e) => {
    zoomAt(e.clientX, e.clientY, scale > minScale * 1.4 ? minScale / scale : 2.5);
  });

  window.addEventListener("resize", fit);
}

// ============================================================
// SETTINGS SCREEN — Basic (full build Step 10)
// ============================================================

// ============================================================
// SETTINGS SCREEN — Full rebuild
// ============================================================
function renderSettingsScreen() {
  if (!userProfile) return;
  const el = document.getElementById("settings-content");
  if (!el) return;

  const sections = [
    { id:"profile",       icon:"👤", title:"Profile",            sub:"Name, initials, avatar" },
    { id:"security",      icon:"🔒", title:"Account & Security", sub:"Email, password, sign out" },
    { id:"notifications", icon:"🔔", title:"Notifications",      sub:"What alerts you get" },
    { id:"app",           icon:"📱", title:"App",                sub:"Version, updates, cache" }
  ];

  el.innerHTML = `
    <div style="padding:16px;display:flex;flex-direction:column;gap:10px">

      <!-- Avatar card -->
      <div class="card card-highlight" style="display:flex;align-items:center;gap:14px;padding:16px">
        <div class="avatar" style="background:${safeColor(userProfile.color)};width:52px;height:52px;font-size:18px">
          ${esc(userProfile.initials)}
        </div>
        <div>
          <div style="font-weight:700;font-size:16px">${esc(userProfile.displayName)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;text-transform:uppercase;letter-spacing:0.5px">
            ${esc(userProfile.role || "member")}
          </div>
        </div>
      </div>

      ${sections.map(s => `
        <div>
          <button class="tc-row-header" id="settings-toggle-${s.id}"
            onclick="toggleSettingsSection('${s.id}')" style="margin-bottom:0">
            <span style="font-size:20px">${s.icon}</span>
            <div style="flex:1;text-align:left">
              <div style="font-size:14px;font-weight:600;color:var(--text-warm)">${s.title}</div>
              <div style="font-size:12px;color:var(--text-muted)">${s.sub}</div>
            </div>
            <span id="settings-arrow-${s.id}" style="color:var(--gold);font-size:18px;transition:transform 0.2s">›</span>
          </button>
          <div id="settings-content-${s.id}" class="hidden"
            style="background:rgba(14,10,4,0.92);border:1px solid var(--gold-dim);
                   border-top:none;border-bottom-left-radius:var(--radius-lg);
                   border-bottom-right-radius:var(--radius-lg);padding:16px;margin-bottom:2px">
            <div id="settings-inner-${s.id}"></div>
          </div>
        </div>`).join("")}

      <button class="btn btn-danger btn-full" onclick="doLogout()" style="margin-top:6px">
        Sign Out
      </button>
    </div>
  `;
}

window.toggleSettingsSection = function (id) {
  const panel  = document.getElementById("settings-content-" + id);
  const arrow  = document.getElementById("settings-arrow-"  + id);
  const header = document.getElementById("settings-toggle-" + id);
  if (!panel) return;
  const opening = panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !opening);
  if (arrow)  arrow.style.transform = opening ? "rotate(90deg)" : "";
  if (header) header.classList.toggle("expanded", opening);
  if (opening) renderSettingsSection(id);
};

function renderSettingsSection(id) {
  const inner = document.getElementById("settings-inner-" + id);
  if (!inner) return;

  switch(id) {
    case "profile":
      inner.innerHTML = `
        <div class="input-group" style="margin-bottom:12px">
          <label>Display Name</label>
          <input type="text" id="s-name" value="${esc(userProfile.displayName)}" maxlength="32" />
        </div>
        <div class="input-group" style="margin-bottom:12px">
          <label>Initials</label>
          <input type="text" id="s-initials" value="${esc(userProfile.initials)}" maxlength="2" />
        </div>
        <div class="input-group" style="margin-bottom:16px">
          <label>Avatar Color</label>
          <div class="avatar-swatches" id="s-swatches"></div>
        </div>
        <button class="btn btn-primary btn-full" onclick="saveProfileSettings()">Save Profile</button>
      `;
      const sw = document.getElementById("s-swatches");
      AVATAR_COLORS.forEach(color => {
        const el2 = document.createElement("div");
        el2.className = "avatar-swatch" + (color === userProfile.color ? " selected" : "");
        el2.style.background = color;
        el2.dataset.color = color;
        el2.onclick = () => {
          sw.querySelectorAll(".avatar-swatch").forEach(s => s.classList.remove("selected"));
          el2.classList.add("selected");
        };
        sw.appendChild(el2);
      });
      break;

    case "security":
      inner.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:10px">
          <button class="btn btn-secondary btn-full" onclick="openChangeEmail()">
            ✉️ Change Email
          </button>
          <button class="btn btn-secondary btn-full" onclick="openChangePassword()">
            🔑 Change Password
          </button>
          <button class="btn btn-secondary btn-full" onclick="sendResetEmail()">
            📧 Send Password Reset Email
          </button>
          <div class="fade-divider-plain"></div>
          <button class="btn btn-danger btn-full" onclick="doLogout()">
            Sign Out
          </button>
        </div>
      `;
      break;

    case "notifications":
      const prefs = userProfile.notifPrefs || {};
      inner.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px">
          ${[
            ["notif_feed",     "New feed posts",        prefs.feed     !== false],
            ["notif_bulletin", "New bulletins",          prefs.bulletin !== false],
            ["notif_trailcam", "New trail cam uploads",  prefs.trailcam === true],
            ["notif_harvest",  "New harvests logged",    prefs.harvest  === true]
          ].map(([id, label, checked]) => `
            <div style="display:flex;align-items:center;justify-content:space-between;
                        padding:8px 0;border-bottom:1px solid rgba(196,169,106,0.08)">
              <span style="font-size:14px;color:var(--text-warm)">${label}</span>
              <label style="position:relative;width:44px;height:24px;cursor:pointer">
                <input type="checkbox" id="${id}" ${checked ? "checked" : ""}
                  onchange="saveNotifPrefs()"
                  style="opacity:0;width:0;height:0;position:absolute" />
                <span id="${id}-track"
                  style="position:absolute;inset:0;border-radius:12px;transition:background 0.2s;
                         background:${checked ? "var(--orange)" : "rgba(255,255,255,0.15)"}"></span>
                <span id="${id}-thumb"
                  style="position:absolute;top:3px;left:${checked ? "23px" : "3px"};
                         width:18px;height:18px;background:#fff;border-radius:50%;
                         transition:left 0.2s"></span>
              </label>
            </div>`).join("")}
        </div>
      `;
      // Wire toggle visuals
      ["notif_feed","notif_bulletin","notif_trailcam","notif_harvest"].forEach(id => {
        const cb = document.getElementById(id);
        if (!cb) return;
        cb.addEventListener("change", () => {
          const track = document.getElementById(id + "-track");
          const thumb = document.getElementById(id + "-thumb");
          if (track) track.style.background = cb.checked ? "var(--orange)" : "rgba(255,255,255,0.15)";
          if (thumb) thumb.style.left = cb.checked ? "23px" : "3px";
        });
      });
      break;

    case "app":
      inner.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="font-size:13px;color:var(--text-muted);text-align:center;padding:4px 0">
            Version ${APP_VERSION}
          </div>
          <button class="btn btn-secondary btn-full" onclick="checkForUpdate()">
            ⟳ Check for Update
          </button>
          <button class="btn btn-secondary btn-full" onclick="clearAppCache()">
            🗑 Clear Cache & Reload
          </button>
        </div>
      `;
      break;
  }
}

window.saveProfileSettings = async function () {
  if (!userProfile) return;
  const name   = document.getElementById("s-name")?.value.trim();
  const inits  = document.getElementById("s-initials")?.value.trim().toUpperCase();
  const sel    = document.querySelector("#s-swatches .avatar-swatch.selected");
  const color  = sel?.dataset.color || userProfile.color;
  if (!name) { showToast("Name cannot be empty.", "error"); return; }
  try {
    await setDoc(doc(db, "users", userProfile.uid), {
      displayName: name, initials: inits || initials(name), color, updatedAt: serverTimestamp()
    }, { merge: true });
    userProfile.displayName = name;
    userProfile.initials    = inits || initials(name);
    userProfile.color       = color;
    document.getElementById("drawer-user-name").textContent = name;
    showToast("Profile saved!", "success");
    renderSettingsScreen();
  } catch(err) { console.error(err); showToast("Could not save.", "error"); }
};

window.saveNotifPrefs = async function () {
  if (!userProfile) return;
  try {
    const prefs = {
      feed:     document.getElementById("notif_feed")?.checked     || false,
      bulletin: document.getElementById("notif_bulletin")?.checked || false,
      trailcam: document.getElementById("notif_trailcam")?.checked || false,
      harvest:  document.getElementById("notif_harvest")?.checked  || false
};
    await setDoc(doc(db, "users", userProfile.uid), { notifPrefs: prefs }, { merge: true });
    userProfile.notifPrefs = prefs;
    showToast("Notification preferences saved.", "success");
  } catch(err) { console.error(err); showToast("Could not save.", "error"); }
};

window.openChangeEmail = function () {
  const ov = document.createElement("div");
  ov.className = "modal-overlay"; ov.id = "change-email-overlay";
  ov.innerHTML = `
    <div class="modal-box" style="max-width:340px">
      <div class="modal-title">✉️ Change Email</div>
      <div style="font-size:12px;color:var(--text-muted);line-height:1.5;margin-bottom:12px">
        We'll send a confirmation link to the new address. The change takes effect
        once you click it.
      </div>
      <div class="input-group" style="margin-bottom:12px">
        <label>New Email</label>
        <input type="email" id="ce-email" placeholder="new@email.com" />
      </div>
      <div class="input-group" style="margin-bottom:16px">
        <label>Current Password (to confirm)</label>
        <input type="password" id="ce-pass" placeholder="••••••••" />
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('change-email-overlay').remove()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="doChangeEmail()">Update Email</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
};

window.doChangeEmail = async function () {
  const newEmail = document.getElementById("ce-email")?.value.trim();
  const pass     = document.getElementById("ce-pass")?.value;
  if (!newEmail || !pass) { showToast("Fill in all fields.", "error"); return; }
  try {
    const cred = EmailAuthProvider.credential(auth.currentUser.email, pass);
    await reauthenticateWithCredential(auth.currentUser, cred);
    await verifyBeforeUpdateEmail(auth.currentUser, newEmail);
    document.getElementById("change-email-overlay")?.remove();
    showToast("Check your new inbox for a confirmation link.", "success");
  } catch(err) {
    console.error(err);
    const wrong = err.code === "auth/wrong-password" || err.code === "auth/invalid-credential";
    showToast(
      wrong ? "Wrong password."
      : err.code === "auth/invalid-email" ? "That email address doesn't look right."
      : "Could not update email.",
      "error"
    );
  }
};

window.openChangePassword = function () {
  const ov = document.createElement("div");
  ov.className = "modal-overlay"; ov.id = "change-pass-overlay";
  ov.innerHTML = `
    <div class="modal-box" style="max-width:340px">
      <div class="modal-title">🔑 Change Password</div>
      <div class="input-group" style="margin-bottom:12px">
        <label>Current Password</label>
        <input type="password" id="cp-current" placeholder="••••••••" />
      </div>
      <div class="input-group" style="margin-bottom:12px">
        <label>New Password</label>
        <input type="password" id="cp-new" placeholder="••••••••" />
      </div>
      <div class="input-group" style="margin-bottom:16px">
        <label>Confirm New Password</label>
        <input type="password" id="cp-confirm" placeholder="••••••••" />
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('change-pass-overlay').remove()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="doChangePassword()">Update Password</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
};

window.doChangePassword = async function () {
  const current = document.getElementById("cp-current")?.value;
  const newPass  = document.getElementById("cp-new")?.value;
  const confirm  = document.getElementById("cp-confirm")?.value;
  if (!current || !newPass || !confirm) { showToast("Fill in all fields.", "error"); return; }
  if (newPass !== confirm) { showToast("New passwords don't match.", "error"); return; }
  if (newPass.length < 8)  { showToast("Password needs at least 8 characters.", "error"); return; }
  try {
    const cred = EmailAuthProvider.credential(auth.currentUser.email, current);
    await reauthenticateWithCredential(auth.currentUser, cred);
    await updatePassword(auth.currentUser, newPass);
    document.getElementById("change-pass-overlay")?.remove();
    showToast("Password updated!", "success");
  } catch(err) {
    console.error(err);
    showToast(
      (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential")
        ? "Wrong current password." : "Could not update password.",
      "error"
    );
  }
};

window.sendResetEmail = async function () {
  try {
    await sendPasswordResetEmail(auth, auth.currentUser.email);
    showToast("Password reset email sent!", "success");
  } catch(err) { console.error(err); showToast("Could not send reset email.", "error"); }
};

window.clearAppCache = function () {
  appConfirm("Clear Cache", "This will clear all cached data and reload the app fresh. Continue?", async () => {
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) await reg.unregister();
      }
      const keys = await caches.keys();
      for (const key of keys) await caches.delete(key);
      window.location.reload(true);
    } catch(err) { console.error(err); window.location.reload(true); }
  });
};

// ============================================================
// APP UPDATES SCREEN
// ============================================================
function renderUpdatesScreen() {
  const el = document.getElementById("updates-content");
  if (!el) return;
  const changelog = [
    { version: "lite-2.16.0", date: "Sep 2026", notes: [
      "The front page now leads with the cabin calendar instead of a photo — weather and moon phase are right there with it",
      "Calendar days now show a plain red dot on anything going on, instead of a fill and a number",
      "Quick Actions are now full-width buttons — Log Harvest, Message Camp, Trail Cam, Trophy Room",
      "Fixed a security gap: a member could edit or delete another member's feed post or comment — locked down to the author or an admin",
      "Deleting your own harvest, photo, or post file now works correctly no matter who deletes it"
    ]},
    { version: "lite-2.15.2", date: "Aug 2026", notes: [
      "The app now opens on a weak signal — it shows the last data it saw instead of a blank screen",
      "Trail cam photo tags are gone — a comment or reaction is enough",
      "Deleting a harvest, photo or post now also removes its image file",
      "Change Email now sends a confirmation link to the new address",
      "Shrank the cabin map so it loads faster on camp service"
    ]},
    { version: "lite-2.15.1", date: "Aug 2026", notes: [
      "The app now updates itself when you sign in — no more tapping Check for Update",
      "Guest keys are gone — everyone uses their own account now",
      "New members create an account right on the sign-in screen with the camp code (ask an admin for it)",
      "Added a Forgot password link",
      "Admins set and open/close the camp code under Admin → Sign-ups",
      "Tightened database security — you can only edit your own harvests, posts and photos"
    ]},
    { version: "lite-2.14.4", date: "Aug 2026", notes: [
      "Home-screen app icon reworked — the emblem now fills the icon on a forest-green background, no white ring or box",
      "To pick it up: delete the app from your home screen, clear the site from your browser's site data, then add it again"
    ]},
    { version: "lite-2.14.1", date: "Aug 2026", notes: [
      "The Tucker's Camp logo now shows on the sign-in screen and in the header"
    ]},
    { version: "lite-2.14.0", date: "Aug 2026", notes: [
      "Calendar days now fill like a gauge — the busier a day is, the taller the fill, with the headcount in the corner",
      "A packed weekend reads at a glance instead of cramming in names and icons",
      "Open a day and people are grouped by what they're there for, so a crowd stays easy to read"
    ]},
    { version: "lite-2.13.1", date: "Aug 2026", notes: [
      "You can now set how many days you're staying — a multi-day trip fills the whole span on the calendar with a gold bar",
      "Fixed the 'Remove visit' confirmation opening behind the day view"
    ]},
    { version: "lite-2.13.0", date: "Aug 2026", notes: [
      "Reworked the calendar day view: weekday, moon phase, and a 'today / in 3 days' label up top",
      "When you add yourself to a day you can mark why — Hunting, Scouting, Work day, Family, or Just visiting — and morning / evening / all day / overnight",
      "Those show as icons on the month grid, and days you're on are outlined in gold",
      "The day view also lists any harvests logged on that date"
    ]},
    { version: "lite-2.12.1", date: "Aug 2026", notes: [
      "Fixed contest entry: logging a buck no longer puts you on the Big Buck board on its own — you still have to press Enter first"
    ]},
    { version: "lite-2.12.0", date: "Aug 2026", notes: [
      "Contests now read your Harvest Log — press Enter to join and your best deer or turkey of the year is ranked automatically",
      "No more entering an animal twice; update the harvest and your standing updates with it",
      "Added a weapon field (Firearm / Archery) to deer harvests — firearm bucks go to Big Buck, archery bucks to Bow Buck"
    ]},
    { version: "lite-2.11.0", date: "Aug 2026", notes: [
      "Added Spring Turkey and Fall Turkey contests",
      "Turkey entries are scored by the NWTF formula — weight + 2× beard + 10× spurs — and the app does the math",
      "Contests are now grouped Deer / Turkey, with turkey in its own bronze colour"
    ]},
    { version: "lite-2.10.1", date: "Aug 2026", notes: [
      "Renamed the rank tiers: Gold, Double Gold, Triple Gold, Diamond, Royal Description, Unknown Element",
      "Added a top tier — Elementa Infinitum 🌟 at 1000 points",
      "The two trophy screens are now My Trophy Room and Cabin Trophy Room"
    ]},
    { version: "lite-2.10.0", date: "Aug 2026", notes: [
      "Renamed My Kills to My Trophy Room",
      "My Trophy Room now shows a stat card per category — camp ranking, by-year charts, and award badges",
      "Added the Cabin Trophy Room: the champion and runner-up in every category",
      "Contest wins and biggest-of-the-year now appear as badges on your stat cards",
      "The harvest form links straight to My Trophy Room; a confirmation appears after logging",
      "Header counter now reads 🏆 with your trophy count"
    ]},
    { version: "lite-2.9.3", date: "Aug 2026", notes: [
      "Fixed the 😊 React button on harvests — it wasn't opening the emoji picker",
      "Photo uploads can no longer hang if an image fails to read",
      "Failed admin actions now say so instead of quietly doing nothing",
      "Deleting a harvest only removes its own feed post, not all of them"
    ]},
    { version: "lite-2.9.2", date: "Aug 2026", notes: [
      "Fixed broken photos everywhere — harvest, trail cam, feed and contest pictures now display",
      "Added a Bow Buck contest alongside Big Buck and Big Doe",
      "Admins can close a contest season and mark the winner (and reopen it)",
      "App version now shown next to the title in the header"
    ]},
    { version: "lite-2.9.1", date: "Aug 2026", notes: [
      "Full-screen camp map now pans freely in every direction, with pinch / scroll / ± zoom",
      "Quick Access tiles are all the same size"
    ]},
    { version: "lite-2.9.0", date: "Aug 2026", notes: [
      "Big Buck & Big Doe contests — enter a photo and a measurement, board auto-ranks",
      "Contest leader gets the 🏆; edit or remove your own entry any time",
      "Calendar day pop-up shows the date you tapped and its button just says Log"
    ]},
    { version: "lite-2.8.1", date: "Aug 2026", notes: [
      "Camp map added to the Map tab — tap to open full screen",
      "Calendar days now have a subtle fill; removed the color legend",
      "Cabin Calendar tile shows today's date instead of a fixed calendar icon",
      "My Kills now loads reliably and has friendlier empty / offline messages",
      "All member-entered text is now safely displayed (names, notes, comments)",
      "Reacting or commenting no longer makes the feed jump or collapse"
    ]},
    { version: "lite-2.8.0", date: "May 2026", notes: [
      "Cabin Calendar — full month grid view with visit logging",
      "Tap any day to see who visited and log your own visit with notes",
      "Member avatar dots on visited days show who's been at the cabin",
      "This Month's Visits list below calendar — with delete option",
      "Month navigation — browse any past or future month",
      "Feed increased to 20 posts before Load More",
      "Harvest photo reactions moved behind 😊 React button — cleaner scroll",
      "Compare to Trail Cam back button now returns to Harvest Log directly",
      "Removed developer placeholder text from all screens"
    ]},
    { version: "lite-2.5.0", date: "May 2026", notes: [
      "Update system overhaul — service worker now updates immediately on every deploy",
      "Fixed persistent caching issue that prevented app updates from reaching users",
      "Force Update option in Settings clears all caches and reloads fresh",
      "Check for Update button now actively triggers SW update and reports status",
      "Checkout button — Left the Cabin with cabin clean-up reminder popup",
      "Feed auto-archives posts past 50th to keep things fast",
      "Redundant Compare to Trail Cam button removed from harvest log",
      "Harvest Compare view fully restored with filters and favorites",
      "Kill tier demotion on harvest delete — points and tier rewind correctly"
    ]},
    { version: "lite-2.3.0", date: "May 2026", notes: [
      "Species-specific harvest fields — deer buck/doe selector, turkey sex/spurs/beard, bear color phase, waterfowl/small game quantity and sub-species",
      "Harvest photo button changed to red for visibility",
      "Compare to TrailCam Picture button appears only when photo is open",
      "Feed reactions hidden from scroll view — only visible when expanded",
      "Feed increased to 15 posts before Load More",
      "Blue auto-notifications in feed — no comment section, visually distinct",
      "Tier flair and kill count shown next to member names in feed",
      "Trail cam upload restored for member accounts",
      "Bulletins open to all signed-in users",
      "Kill counter rewind on harvest delete"
    ]},
    { version: "lite-2.1.0", date: "May 2026", notes: [
      "Full Settings rebuild — profile, security, notifications, app",
      "Change email and password from app",
      "Admin panel with user management, content moderation, guest keys, app stats",
      "Admin action log — every destructive action recorded with reason and content snapshot",
      "All users equal — bulletins open to everyone",
      "Update button on login screen and hamburger menu",
      "Clear cache button in settings"
    ]},
    { version: "lite-2.0.0", date: "May 2026", notes: [
      "Social Feed with auto-events and manual posts",
      "Check-in button — announces arrival at the cabin",
      "Kill counter in header with 6-tier star progression",
      "My Kills page with rank card, progress bar, tier ladder, history",
      "Tier promotion popups with messages",
      "Auto feed posts for harvests, trail cam uploads, tier changes, check-ins"
    ]},
    { version: "lite-1.9.0", date: "May 2026", notes: [
      "Harvest log rebuilt — collapsible rows matching trail cam structure",
      "Inline harvest detail — no separate screen",
      "Harvest photo show/hide toggle button",
      "Bulletins View All fixed"
    ]},
    { version: "lite-1.8.0", date: "May 2026", notes: [
      "Trail cam filter — multi-select animal filter modal",
      "Trail cam collapsible rows — all collapsed by default",
      "Animal tagging system with 14 species",
      "Swamp Gas 🤢 added to animal list",
      "Photo previews with ✕ remove buttons before upload",
      "Harvest comparison view with 4 filter buttons + favorites"
    ]},
    { version: "lite-1.7.0", date: "May 2026", notes: [
      "Trail cam rebuilt — Netflix-style collapsible rows by upload batch",
      "Multi-photo upload with progress counter",
      "Animal tagging in lightbox",
      "Upload batch grouping with avatar header"
    ]},
    { version: "lite-1.0.0", date: "May 2026", notes: [
      "Initial release — shell, auth, guest key login",
      "Lodge design system — wood texture, gold accents, blaze orange buttons",
      "Harvest log, trail cam, cabin calendar placeholders",
      "PWA install and update support"
    ]}
  ];

  el.innerHTML = `
    <div style="padding:16px;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div style="font-size:13px;color:var(--text-muted)">Current: <span style="color:var(--gold)">${APP_VERSION}</span></div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-secondary btn-sm" onclick="forceUpdate()" style="font-size:11px">Force Reload</button>
          <button class="btn btn-primary btn-sm" onclick="checkForUpdate()">⟳ Check for Update</button>
        </div>
      </div>
      ${changelog.map((v, i) => `
        <div>
          <button class="tc-row-header ${i===0?"expanded":""}" id="cl-toggle-${i}"
            onclick="toggleChangelog(${i})" style="margin-bottom:0">
            <div style="flex:1;text-align:left">
              <div style="font-size:14px;font-weight:600;color:${i===0?"var(--gold)":"var(--text-warm)"}">
                ${v.version} ${i===0?"":''}
              </div>
              <div style="font-size:12px;color:var(--text-muted)">${v.date}</div>
            </div>
            <span id="cl-arrow-${i}" style="color:var(--gold);font-size:18px;transition:transform 0.2s;
                  ${i===0?"transform:rotate(90deg)":""}">›</span>
          </button>
          <div id="cl-content-${i}"
            class="${i===0?"":"hidden"}"
            style="background:rgba(14,10,4,0.92);border:1px solid var(--gold-dim);
                   border-top:none;border-bottom-left-radius:var(--radius-lg);
                   border-bottom-right-radius:var(--radius-lg);padding:14px;margin-bottom:2px">
            <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:7px">
              ${v.notes.map(n => `
                <li style="display:flex;gap:8px;font-size:13px;color:var(--text-muted);line-height:1.4">
                  <span style="color:var(--orange);flex-shrink:0">•</span>${n}
                </li>`).join("")}
            </ul>
          </div>
        </div>`).join("")}
    </div>
  `;
}

window.toggleChangelog = function (i) {
  const panel  = document.getElementById("cl-content-" + i);
  const arrow  = document.getElementById("cl-arrow-"   + i);
  const header = document.getElementById("cl-toggle-"  + i);
  if (!panel) return;
  const opening = panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !opening);
  if (arrow)  arrow.style.transform = opening ? "rotate(90deg)" : "";
  if (header) header.classList.toggle("expanded", opening);
};

// ============================================================
// BY-LAWS & CONTESTS — Updated
// ============================================================
function renderBylawsScreen() {
  const el = document.getElementById("bylaws-content");
  if (!el) return;
  el.innerHTML = `
    <div style="padding:16px">
      <div class="card">
        <div style="color:var(--text-muted);font-size:13px;line-height:1.6;font-style:italic">
          By-Laws text will be added here. Contact an admin to submit the official club articles.
        </div>
      </div>
    </div>`;
}

// ============================================================
// CONTESTS — Deer (Big Buck / Big Doe / Bow Buck) + Turkey (Spring / Fall)
// You press one "Enter" button to join. Standings are read straight from the
// Harvest Log — your best qualifying animal of the year is ranked automatically.
// Buck contests rank by gross/B&C score; Big Doe by weight; turkeys by the NWTF
// formula (weight + 2×beard + 10×spurs). Spring/fall split by the harvest month.
// ============================================================
function turkeySeason(h) {
  const d = h.harvestDate?.toDate ? h.harvestDate.toDate() : new Date(h.harvestDate || 0);
  const m = d.getMonth() + 1;               // 1–12
  if (m >= 3 && m <= 6) return "spring";
  if (m >= 8 || m === 1) return "fall";
  return null;                              // Feb / Jul — no turkey season
}
function nwtfFromHarvest(h) {
  return nwtfScore({ weight: h.weight, beard: h.beardLength, spurL: h.spurLeft, spurR: h.spurRight });
}

const CONTESTS = {
  buck: {
    label: "Big Buck", short: "Buck", icon: "🦌", group: "deer", unit: '"', scoring: "single", noun: "buck",
    seasonNote: "Firearm bucks. Ranked by gross / B&C score.", needField: "a gross / B&C score",
    metric: h => Number(h.rackScore) || 0,
    pick:   h => h.species === "deer" && h.deerType === "buck" && h.weapon !== "archery" && Number(h.rackScore) > 0,
    eligible: h => h.species === "deer" && h.deerType === "buck" && h.weapon !== "archery"
  },
  doe: {
    label: "Big Doe", short: "Doe", icon: "🦌", group: "deer", unit: ' lbs', scoring: "single", noun: "doe",
    seasonNote: "Ranked by hanging weight.", needField: "its weight",
    metric: h => Number(h.weight) || 0,
    pick:   h => h.species === "deer" && h.deerType === "doe" && Number(h.weight) > 0,
    eligible: h => h.species === "deer" && h.deerType === "doe"
  },
  bowbuck: {
    label: "Bow Buck", short: "Bow", icon: "🏹", group: "deer", unit: '"', scoring: "single", noun: "buck",
    seasonNote: "Archery bucks. Ranked by gross / B&C score.", needField: "a gross / B&C score",
    metric: h => Number(h.rackScore) || 0,
    pick:   h => h.species === "deer" && h.deerType === "buck" && h.weapon === "archery" && Number(h.rackScore) > 0,
    eligible: h => h.species === "deer" && h.deerType === "buck" && h.weapon === "archery"
  },
  springturkey: {
    label: "Spring Turkey", short: "Spring", icon: "🦃", group: "turkey", unit: "", scoring: "turkey", noun: "turkey",
    seasonNote: "Spring birds. NWTF score — beard and spurs push it up.", needField: "its weight",
    metric: nwtfFromHarvest,
    pick:   h => h.species === "turkey" && turkeySeason(h) === "spring" && Number(h.weight) > 0,
    eligible: h => h.species === "turkey" && turkeySeason(h) === "spring"
  },
  fallturkey: {
    label: "Fall Turkey", short: "Fall", icon: "🦃", group: "turkey", unit: "", scoring: "turkey", noun: "turkey",
    seasonNote: "Fall birds, either sex. A hen just scores her weight.", needField: "its weight",
    metric: nwtfFromHarvest,
    pick:   h => h.species === "turkey" && turkeySeason(h) === "fall" && Number(h.weight) > 0,
    eligible: h => h.species === "turkey" && turkeySeason(h) === "fall"
  }
};
const CONTEST_GROUPS = {
  deer:   { label: "Deer",   icon: "🦌", tabs: ["buck", "doe", "bowbuck"],
            accent: "linear-gradient(135deg,var(--orange),var(--orange-bright))" },
  turkey: { label: "Turkey", icon: "🦃", tabs: ["springturkey", "fallturkey"],
            accent: "linear-gradient(135deg,#8a6d3b,#b28a44)" }
};

// NWTF wild-turkey score: weight(lb) + 2×beard + 10×(spurL + spurR)
function nwtfScore(o) {
  const w = Number(o.weight) || 0, b = Number(o.beard) || 0;
  const s = (Number(o.spurL) || 0) + (Number(o.spurR) || 0);
  return Math.round((w + 2 * b + 10 * s) * 100) / 100;
}
// How a contest value reads on the board / feed / trophy rooms
function contestValueStr(contestId, v) {
  const c = CONTESTS[contestId];
  const n = Number(v) || 0;
  return c && c.scoring === "turkey" ? n.toFixed(1) + " NWTF" : n + (c ? c.unit : "");
}
function contestGroupOf(id) { return (CONTESTS[id] && CONTESTS[id].group) || "deer"; }
function contestAccent() { return CONTEST_GROUPS[contestGroupOf(contestTab)].accent; }

// A member's best qualifying harvest for a contest in a given year → {harvest, score}
// or null. `loose` also returns a scoreless eligible harvest (e.g. a buck with no
// B&C score yet) so the board can prompt the owner to fill it in.
function contestBest(harvests, contestId, uid, year, loose) {
  const c = CONTESTS[contestId];
  if (!c) return null;
  let best = null;
  harvests.forEach(h => {
    if (h.uid !== uid) return;
    const hy = (h.harvestDate?.toDate ? h.harvestDate.toDate() : new Date(h.harvestDate || 0)).getFullYear();
    if (hy !== year) return;
    if (loose ? !c.eligible(h) : !c.pick(h)) return;
    const score = c.pick(h) ? c.metric(h) : null;
    if (!best || (score != null && (best.score == null || score > best.score))) best = { harvest: h, score };
  });
  return best;
}

// { "<contest>_<year>": [ {uid,name,initials,color,score|null,harvest} ... ] }
function computeContestStandings(cache) {
  const out = {};
  const seen = {};
  (cache.contestEntries || []).forEach(e => {
    if (!e.contest || !e.uid) return;
    // Only genuine "Enter" opt-ins count. Ignore leftover docs from the old
    // manual-entry system (they have a `measure`/`photoURL` but no `joinedAt`).
    const isOptIn = e.joinedAt != null || e.id === `${e.contest}_${e.year}_${e.uid}`;
    if (!isOptIn) return;
    const yr  = Number(e.year) || contestYear();
    const key = e.contest + "_" + yr;
    (seen[key] = seen[key] || new Set());
    if (seen[key].has(e.uid)) return;
    seen[key].add(e.uid);
    const m = cache.members[e.uid] || {};
    const best = contestBest(cache.harvests, e.contest, e.uid, yr, false)
             || contestBest(cache.harvests, e.contest, e.uid, yr, true);
    (out[key] = out[key] || []).push({
      uid:      e.uid,
      name:     m.name || e.memberName || "Member",
      initials: m.initials || e.initials || "?",
      color:    m.color || e.color || "#556B2F",
      score:    best && best.score != null ? best.score : null,
      harvest:  best ? best.harvest : null
    });
  });
  Object.values(out).forEach(list => list.sort((a, b) => {
    if ((a.score == null) !== (b.score == null)) return a.score == null ? 1 : -1;
    return (b.score || 0) - (a.score || 0);
  }));
  return out;
}

let contestTab      = "buck";
let contestExpanded = new Set();   // standings row uids that are open
let contestData     = null;        // last loadTrophyData() result

function contestYear() { return new Date().getFullYear(); }
function contestMetaId() { return contestTab + "_" + contestYear(); }
function contestEntryId(uid) { return contestTab + "_" + contestYear() + "_" + uid; }

function renderContestsScreen() {
  const el = document.getElementById("contests-content");
  if (!el) return;
  const group = contestGroupOf(contestTab);
  const groupBtn = (gid, g) => `
    <button onclick="switchContestGroup('${gid}')"
      style="flex:1;padding:8px 4px;border-radius:var(--radius-md);font-size:13px;font-weight:700;
             font-family:var(--font-sans);cursor:pointer;border:1px solid var(--card-border);
             ${group === gid ? `background:${g.accent};border-color:transparent;color:#fff`
                             : "background:rgba(255,255,255,0.05);color:var(--text-muted)"}">
      ${g.icon} ${g.label}</button>`;
  const c = CONTESTS[contestTab];
  el.innerHTML = `
    <div style="padding:12px 16px 8px;display:flex;gap:8px">
      ${Object.entries(CONTEST_GROUPS).map(([gid, g]) => groupBtn(gid, g)).join("")}
    </div>
    <div style="padding:0 16px 6px;display:flex;gap:6px">
      ${CONTEST_GROUPS[group].tabs.map(id => {
        const t = CONTESTS[id];
        return `<button onclick="switchContestTab('${id}')"
          style="flex:1;padding:6px 4px;border-radius:20px;font-size:12px;font-weight:600;
                 font-family:var(--font-sans);cursor:pointer;
                 ${contestTab === id ? `background:${CONTEST_GROUPS[group].accent};border:1px solid transparent;color:#fff`
                                     : "background:rgba(255,255,255,0.06);border:1px solid var(--card-border);color:var(--text-muted)"}">
          ${t.icon} ${t.short}</button>`;
      }).join("")}
    </div>
    <div style="padding:2px 16px 0;font-size:12px;color:var(--text-muted)">
      ${contestYear()} season${c.seasonNote ? ` · ${esc(c.seasonNote)}` : ""}
    </div>
    <div class="fade-divider-plain"></div>
    <div id="contest-board" style="padding:8px 16px 90px">
      <div style="text-align:center;padding:32px 0;color:var(--text-muted)">
        <div class="spinner" style="margin:0 auto 12px"></div>Loading…
      </div>
    </div>`;
  loadContestBoard();
}

window.switchContestGroup = function (gid) {
  if (!CONTEST_GROUPS[gid]) return;
  if (contestGroupOf(contestTab) === gid) return;
  switchContestTab(CONTEST_GROUPS[gid].tabs[0]);
};

window.switchContestTab = function (id) {
  if (!CONTESTS[id]) return;
  contestTab = id;
  contestExpanded.clear();
  renderContestsScreen();
};

// kept as a no-op so showScreen()'s cleanup call stays valid
function teardownContestListeners() {}

async function loadContestBoard() {
  const board = document.getElementById("contest-board");
  if (!board) return;
  try {
    contestData = await loadTrophyData(false);
    renderContestBoard();
  } catch (err) {
    console.error(err);
    if (board) board.innerHTML = `<div style="color:var(--danger);padding:16px;font-size:13px">Couldn't load the contest right now.</div>`;
  }
}

window.refreshContests = async function () {
  try { contestData = await loadTrophyData(true); } catch (_) {}
  renderContestBoard();
};

function renderContestBoard() {
  const board = document.getElementById("contest-board");
  if (!board || !contestData) return;
  const c        = CONTESTS[contestTab];
  const yr       = contestYear();
  const key      = contestTab + "_" + yr;
  const meta     = contestData.contestMeta[key] || null;
  const isClosed = !!meta?.closed;
  const isAdmin  = userProfile && userProfile.role === "admin";
  const uid      = userProfile && userProfile.uid;
  const isTurkey = c.scoring === "turkey";
  const accent   = contestAccent();

  const standings = computeContestStandings(contestData)[key] || [];
  const mine      = uid ? standings.find(s => s.uid === uid) : null;
  const entered   = !!mine;
  const scored    = standings.filter(s => s.score != null);

  // The member entered but their eligible animal is missing its measurement
  const looseBest = (uid && entered && !mine.score)
    ? contestBest(contestData.harvests, contestTab, uid, yr, true) : null;
  const needsData = !!(looseBest && looseBest.harvest);

  const refreshBtn = `<button onclick="refreshContests()" title="Refresh"
    style="background:rgba(255,255,255,0.06);border:1px solid var(--card-border);border-radius:8px;
           width:30px;height:30px;color:var(--text-muted);cursor:pointer;font-size:14px;flex-shrink:0">↻</button>`;

  // Closed-season winner banner
  const banner = (isClosed && meta)
    ? `<div style="background:${isTurkey ? "linear-gradient(135deg,rgba(138,109,59,0.22),rgba(178,138,68,0.12))" : "linear-gradient(135deg,rgba(196,169,106,0.18),rgba(212,98,42,0.12))"};
                   border:1px solid ${isTurkey ? "#8a6d3b" : "var(--gold-dim)"};border-radius:var(--radius-lg);
                   padding:14px;margin-bottom:14px;text-align:center">
         <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">
           ${yr} ${esc(c.label)} — Season Closed
         </div>
         <div style="font-size:34px;margin:6px 0 2px">🏆</div>
         <div style="font-size:16px;font-weight:700;color:var(--gold)">${esc(meta.winnerName || "—")}</div>
         ${meta.winnerMeasure != null
           ? `<div style="font-size:13px;color:var(--text-warm)">${esc(contestValueStr(contestTab, meta.winnerMeasure))}</div>` : ""}
       </div>`
    : "";

  const standingsRows = standings.map((s, i) => {
    const isExp  = contestExpanded.has(s.uid);
    const rank   = i + 1;
    const medal  = s.score == null ? "·" : rank === 1 ? "🏆" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
    const val    = s.score != null ? contestValueStr(contestTab, s.score)
                                   : `<span style="color:var(--text-dim)">waiting on a harvest</span>`;
    const h      = s.harvest;
    const detail = h ? [
      isTurkey ? `${Number(h.weight) || 0} lb · ${Number(h.beardLength) || 0}" beard · ${Number(h.spurLeft) || 0}"/${Number(h.spurRight) || 0}" spurs`
               : contestTab === "doe" ? `${Number(h.weight) || 0} lb`
               : `${Number(h.rackScore) || 0}" B&C${h.antlerPoints ? ` · ${h.antlerPoints}-pt` : ""}${h.weight ? ` · ${h.weight} lb` : ""}`,
      formatDate(h.harvestDate)
    ].filter(Boolean).join(" · ") : "";
    return `
      <div style="margin-bottom:${isExp ? "0" : "10px"}">
        <button class="harvest-row-header ${isExp ? "expanded" : ""}" onclick="toggleContestEntry('${s.uid}')"
          ${!h ? "style=\"opacity:0.6\"" : ""}>
          <div style="width:34px;text-align:center;font-size:${rank <= 3 && s.score != null ? "18px" : "13px"};
                      font-weight:700;color:var(--gold);flex-shrink:0">${medal}</div>
          <div class="avatar" style="background:${safeColor(s.color)};width:32px;height:32px;font-size:11px;flex-shrink:0">${esc(s.initials)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:600;color:var(--text-warm);overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(s.name)}</div>
            <div style="font-size:12px;color:var(--gold)">${val}</div>
          </div>
          ${h ? `<span style="color:var(--gold);font-size:18px;flex-shrink:0;transition:transform 0.2s;${isExp ? "transform:rotate(90deg)" : ""}">›</span>` : ""}
        </button>
        ${isExp && h ? `
          <div class="harvest-detail-panel">
            ${h.photoURL ? `<img src="${esc(h.photoURL)}"
              style="width:100%;border-radius:var(--radius-md);border:1px solid var(--card-border);margin-bottom:10px;display:block" />` : ""}
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${esc(detail)}</div>
            <button class="btn btn-secondary btn-sm btn-full" onclick="goHarvest()">View in the Harvest Log</button>
          </div>` : ""}
      </div>`;
  }).join("");

  // Bottom action area
  let action = "";
  if (!userProfile) {
    action = "";
  } else if (isClosed) {
    action = isAdmin
      ? `<button class="btn btn-secondary btn-full btn-sm" onclick="reopenContest()" style="margin-top:12px">Reopen ${yr} season</button>` : "";
  } else if (!entered) {
    action = `<button class="btn btn-full" onclick="joinContest()"
        style="margin-top:14px;background:${accent};border:none;color:#fff;font-weight:700">
        ${c.icon} Enter ${esc(c.label)}</button>`;
  } else {
    if (needsData) {
      action = `<div style="background:rgba(212,98,42,0.12);border:1px solid rgba(212,98,42,0.4);border-radius:var(--radius-lg);
                    padding:12px 14px;margin-top:14px">
          <div style="font-size:13px;color:var(--text-warm);margin-bottom:8px">You're entered, but your ${c.noun} needs ${c.needField} added before it counts.</div>
          <button class="btn btn-secondary btn-sm btn-full" onclick="openEditHarvest('${looseBest.harvest.id}')">Edit my ${c.noun}</button>
        </div>`;
    } else if (!mine.score) {
      action = `<div style="background:rgba(196,169,106,0.1);border:1px solid var(--gold-dim);border-radius:var(--radius-lg);
                    padding:12px 14px;margin-top:14px">
          <div style="font-size:13px;color:var(--text-warm);margin-bottom:8px">You're in the ${esc(c.label)}. Log your ${c.noun} in the Harvest Log and your standing updates automatically.</div>
          <button class="btn btn-secondary btn-sm btn-full" onclick="openAddHarvest()">Log a harvest</button>
        </div>`;
    }
    action += `<button class="btn btn-ghost btn-sm btn-full" onclick="leaveContest()" style="margin-top:8px;color:var(--text-dim);font-size:12px">Leave contest</button>`;
  }

  const adminClose = (isAdmin && !isClosed && scored.length)
    ? `<button class="btn btn-secondary btn-full btn-sm" onclick="closeContest()" style="margin-top:10px">🏁 End ${yr} season & crown the winner</button>` : "";

  const header = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="font-size:12px;color:var(--text-muted)">${standings.length} ${standings.length === 1 ? "entrant" : "entrants"}${scored.length < standings.length ? ` · ${scored.length} scored` : ""}</div>
      ${refreshBtn}
    </div>`;

  if (standings.length === 0) {
    board.innerHTML = `${banner}${header}
      <div style="text-align:center;padding:36px 0 8px;color:var(--text-muted)">
        <div style="font-size:44px;margin-bottom:10px">🏆</div>
        <div style="font-size:14px">${isClosed ? "This season is closed." : "No one's entered yet."}</div>
        ${!isClosed ? `<div style="font-size:12px;color:var(--text-dim);margin-top:4px">Press Enter, then log your ${c.noun} — the board reads your Harvest Log.</div>` : ""}
      </div>
      ${action}${adminClose}`;
    return;
  }

  board.innerHTML = banner + header + standingsRows + action + adminClose;
}

window.closeContest = function () {
  if (!userProfile || userProfile.role !== "admin") return;
  const c   = CONTESTS[contestTab];
  const key = contestMetaId();
  const standings = (contestData ? computeContestStandings(contestData)[key] : null) || [];
  const scored = standings.filter(s => s.score != null);
  const winner = scored[0];
  if (!winner) { showToast("Nobody has a scored harvest yet.", "error"); return; }
  const snapshot = scored.slice(0, 3).map(s => ({ uid: s.uid, name: s.name, score: s.score }));
  appConfirm(
    "End the Season",
    `Close the ${contestYear()} ${c.label} contest? ${winner.name} takes it with ${contestValueStr(contestTab, winner.score)}. No new entries after this — you can reopen it later.`,
    async () => {
      try {
        await setDoc(doc(db, "contestMeta", key), {
          contest:        contestTab,
          year:           contestYear(),
          closed:         true,
          closedAt:       serverTimestamp(),
          closedByUid:    userProfile.uid,
          closedByName:   userProfile.displayName,
          winnerUid:      winner.uid || null,
          winnerName:     winner.name || null,
          winnerMeasure:  Number(winner.score) || 0,
          winnerPhotoURL: winner.harvest?.photoURL || null,
          standings:      snapshot
        }, { merge: true });
        await postAutoFeedEvent("contest", {
          winnerName:   winner.name || "A member",
          contestLabel: c.label,
          year:         contestYear(),
          measure:      contestValueStr(contestTab, winner.score)
        });
        trophyCache = null;
        showToast(`${c.label} season closed — 🏆 ${winner.name}`, "success");
        refreshContests();
      } catch (err) { console.error(err); showToast("Could not close the season.", "error"); }
    }
  );
};

window.reopenContest = function () {
  if (!userProfile || userProfile.role !== "admin") return;
  appConfirm("Reopen Season", `Reopen the ${contestYear()} ${CONTESTS[contestTab].label} contest for entries?`, async () => {
    try {
      await setDoc(doc(db, "contestMeta", contestMetaId()), { closed: false }, { merge: true });
      trophyCache = null;
      showToast("Season reopened.", "success");
      refreshContests();
    } catch (err) { console.error(err); showToast("Could not reopen.", "error"); }
  });
};

window.toggleContestEntry = function (id) {
  if (contestExpanded.has(id)) contestExpanded.delete(id);
  else contestExpanded.add(id);
  renderContestBoard();
};

// Join a contest for the year — one opt-in doc, deterministic id so it's
// idempotent. Standings come from the Harvest Log, not from here.
window.joinContest = async function () {
  if (!userProfile) { showToast("Sign in to enter.", "error"); return; }
  const c   = CONTESTS[contestTab];
  const key = contestMetaId();
  if (contestData?.contestMeta?.[key]?.closed) { showToast("This season is closed.", "error"); return; }
  try {
    await setDoc(doc(db, "contestEntries", contestEntryId(userProfile.uid)), {
      contest:    contestTab,
      year:       contestYear(),
      uid:        userProfile.uid,
      memberName: userProfile.displayName,
      initials:   userProfile.initials,
      color:      userProfile.color,
      joinedAt:   serverTimestamp()
    });
    trophyCache = null;
    showToast(`You're in the ${c.label}. 🏆`, "success");
    await refreshContests();
  } catch (err) { console.error(err); showToast("Couldn't enter right now.", "error"); }
};

window.leaveContest = function () {
  if (!userProfile) return;
  const c = CONTESTS[contestTab];
  appConfirm(
    "Leave contest",
    `Leave the ${contestYear()} ${c.label}? Your harvest stays in the log — it just won't be ranked here.`,
    async () => {
      try {
        const uid = userProfile.uid;
        const ids = new Set([contestEntryId(uid)]);
        (contestData?.contestEntries || []).forEach(e => {
          if (e.uid === uid && e.contest === contestTab && Number(e.year) === contestYear()) ids.add(e.id);
        });
        await Promise.all([...ids].map(id => deleteDoc(doc(db, "contestEntries", id)).catch(() => {})));
        contestExpanded.delete(uid);
        trophyCache = null;
        showToast("You've left the contest.", "success");
        await refreshContests();
      } catch (err) { console.error(err); showToast("Couldn't leave right now.", "error"); }
    }
  );
};

// ============================================================
// ADMIN LOG UTILITY
// ============================================================
async function writeAdminLog(action, target, contentSnapshot, reason, photoUrl) {
  try {
    await addDoc(collection(db, "adminLog"), {
      action,
      adminUid:      userProfile.uid,
      adminName:     userProfile.displayName,
      targetUid:     target?.uid    || null,
      targetName:    target?.name   || null,
      contentSnapshot: contentSnapshot || null,
      photoUrl:      photoUrl || null,
      reason,
      timestamp:     serverTimestamp()
    });
  } catch(err) { console.error("Admin log error:", err); }
}

// ── Prompt for reason before any destructive admin action ────
function requireReason(title, description, onConfirm, hasPhoto, contentSnapshot, target) {
  const ov = document.createElement("div");
  ov.className = "modal-overlay"; ov.id = "admin-reason-overlay";
  ov.innerHTML = `
    <div class="modal-box" style="max-width:360px">
      <div class="modal-title" style="color:var(--danger)">⚠️ ${esc(title)}</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:14px;line-height:1.5">${esc(description)}</div>
      <div class="input-group" style="margin-bottom:${hasPhoto ? "12px" : "16px"}">
        <label>Reason (required)</label>
        <textarea id="admin-reason-input" placeholder="Why are you taking this action?"
          style="min-height:70px"></textarea>
      </div>
      ${hasPhoto ? `
        <div style="margin-bottom:16px">
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">Photo attached — what should happen to it?</div>
          <div style="display:flex;gap:8px">
            <label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;
                          background:rgba(255,255,255,0.05);border:1px solid var(--card-border);
                          border-radius:var(--radius-md);cursor:pointer">
              <input type="radio" name="photo-action" value="keep" checked /> 
              <span style="font-size:13px;color:var(--text-warm)">Keep in log</span>
            </label>
            <label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;
                          background:rgba(255,255,255,0.05);border:1px solid var(--card-border);
                          border-radius:var(--radius-md);cursor:pointer">
              <input type="radio" name="photo-action" value="delete" />
              <span style="font-size:13px;color:var(--text-warm)">Delete too</span>
            </label>
          </div>
        </div>` : ""}
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('admin-reason-overlay').remove()">Cancel</button>
        <button class="btn btn-danger btn-sm" onclick="submitAdminAction()">Confirm</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  window._pendingAdminAction = { onConfirm, hasPhoto, contentSnapshot, target };
}

window.submitAdminAction = async function () {
  const reason = document.getElementById("admin-reason-input")?.value.trim();
  if (!reason) { showToast("A reason is required.", "error"); return; }
  const photoAction = document.querySelector('input[name="photo-action"]:checked')?.value || "keep";
  const { onConfirm, hasPhoto } = window._pendingAdminAction || {};
  document.getElementById("admin-reason-overlay")?.remove();
  window._pendingAdminAction = null;
  if (!onConfirm) return;
  try {
    await onConfirm(reason, hasPhoto && photoAction === "keep");
  } catch (err) {
    console.error("Admin action failed:", err);
    showToast("That action didn't go through. Try again.", "error");
  }
};

// ============================================================
// ADMIN PANEL
// ============================================================
async function renderAdminScreen() {
  const el = document.getElementById("admin-content");
  if (!el) return;
  if (userProfile?.role !== "admin") {
    el.innerHTML = `<div style="padding:32px;text-align:center;color:var(--danger)">Access denied.</div>`;
    return;
  }

  el.innerHTML = `<div style="padding:16px;display:flex;flex-direction:column;gap:10px">
    ${[
      { id:"users",      icon:"👥", title:"User Management",    sub:"Roles, passwords, accounts" },
      { id:"content",    icon:"🛡",  title:"Content Moderation", sub:"Delete posts, harvests, photos" },
      { id:"bulletins",  icon:"📢", title:"Bulletins",          sub:"Post, edit, pin, delete" },
      { id:"signups",    icon:"🎟️", title:"Sign-ups",           sub:"Camp code, open / close" },
      { id:"stats",      icon:"📊", title:"App Stats",          sub:"Users, posts, harvests" },
      { id:"log",        icon:"📋", title:"Admin Log",          sub:"All admin actions" }
    ].map(s => `
      <div>
        <button class="tc-row-header" id="admin-toggle-${s.id}"
          onclick="toggleAdminSection('${s.id}')" style="margin-bottom:0">
          <span style="font-size:20px">${s.icon}</span>
          <div style="flex:1;text-align:left">
            <div style="font-size:14px;font-weight:600;color:var(--text-warm)">${s.title}</div>
            <div style="font-size:12px;color:var(--text-muted)">${s.sub}</div>
          </div>
          <span id="admin-arrow-${s.id}" style="color:var(--gold);font-size:18px;transition:transform 0.2s">›</span>
        </button>
        <div id="admin-content-${s.id}" class="hidden"
          style="background:rgba(14,10,4,0.92);border:1px solid var(--gold-dim);
                 border-top:none;border-bottom-left-radius:var(--radius-lg);
                 border-bottom-right-radius:var(--radius-lg);padding:16px;margin-bottom:2px">
          <div id="admin-inner-${s.id}">
            <div style="text-align:center;padding:16px"><div class="spinner" style="margin:0 auto"></div></div>
          </div>
        </div>
      </div>`).join("")}
  </div>`;
}

window.toggleAdminSection = async function (id) {
  const panel  = document.getElementById("admin-content-" + id);
  const arrow  = document.getElementById("admin-arrow-"   + id);
  const header = document.getElementById("admin-toggle-"  + id);
  if (!panel) return;
  const opening = panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !opening);
  if (arrow)  arrow.style.transform = opening ? "rotate(90deg)" : "";
  if (header) header.classList.toggle("expanded", opening);
  if (opening) await loadAdminSection(id);
};

async function loadAdminSection(id) {
  const inner = document.getElementById("admin-inner-" + id);
  if (!inner) return;
  try {
    switch(id) {
      case "users":     await renderAdminUsers(inner);     break;
      case "content":   await renderAdminContent(inner);   break;
      case "bulletins": await renderAdminBulletins(inner); break;
      case "signups":   await renderAdminSignups(inner);   break;
      case "stats":     await renderAdminStats(inner);     break;
      case "log":       await renderAdminLog(inner);       break;
    }
  } catch(err) {
    console.error(err);
    inner.innerHTML = `<div style="color:var(--danger);font-size:13px">Could not load section.</div>`;
  }
}

// ── User Management ──────────────────────────────────────────
async function renderAdminUsers(inner) {
  const snap = await getDocs(collection(db, "users"));
  const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  _adminDocCache = {};
  users.forEach(u => { _adminDocCache[u.id] = u; });
  inner.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px">
      ${users.map(u => `
        <div style="background:rgba(255,255,255,0.04);border:1px solid var(--card-border);
                    border-radius:var(--radius-md);padding:12px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <div class="avatar" style="background:${safeColor(u.color)};width:34px;height:34px;font-size:12px">
              ${esc(u.initials||"?")}
            </div>
            <div style="flex:1">
              <div style="font-size:14px;font-weight:600">${esc(u.displayName||"Unknown")}</div>
              <div style="font-size:11px;color:var(--text-muted)">${esc(u.role||"user")} · ${esc(u.id.slice(0,8))}…</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <select id="role-${u.id}"
              style="flex:1;background:rgba(255,255,255,0.06);border:1px solid var(--card-border);
                     border-radius:var(--radius-sm);color:var(--text-warm);padding:6px 8px;font-size:12px">
              <option value="user"  ${u.role!=="admin"?"selected":""}>Member</option>
              <option value="admin" ${u.role==="admin"?"selected":""}>Admin</option>
            </select>
            <button class="btn btn-secondary btn-sm" onclick="adminChangeRole('${u.id}')">
              Save Role
            </button>
            <button class="btn btn-secondary btn-sm" onclick="adminResetPassword('${u.id}')">
              📧 Reset PW
            </button>
          </div>
        </div>`).join("")}
    </div>`;
}

window.adminChangeRole = function (uid, name) {
  name = name || (_adminDocCache[uid] || {}).displayName || "User";
  const newRole = document.getElementById("role-" + uid)?.value;
  requireReason(
    "Change User Role",
    `Change ${name}'s role to "${newRole}"?`,
    async (reason) => {
      await updateDoc(doc(db, "users", uid), { role: newRole });
      await writeAdminLog("role_change", { uid, name }, `Role changed to: ${newRole}`, reason, null);
      showToast(`${name}'s role updated to ${newRole}.`, "success");
      loadAdminSection("users");
    }, false, null, { uid, name }
  );
};

window.adminResetPassword = function (uid, name) {
  name = name || (_adminDocCache[uid] || {}).displayName || "User";
  requireReason(
    "Reset Password",
    `Send a password reset email to ${name}?`,
    async (reason) => {
      // Get their email from their user doc (saved at sign-up / login).
      const snap = await getDoc(doc(db, "users", uid));
      const email = snap.data()?.email || null;
      if (!email) {
        showToast("No email on file for this member yet — they need to open the app once so it can be recorded.", "error");
        return;
      }
      await sendPasswordResetEmail(auth, email);
      await writeAdminLog("password_reset", { uid, name }, `Reset email sent`, reason, null);
      showToast(`Password reset email sent to ${name}.`, "success");
    }, false, null, { uid, name }
  );
};

// ── Content Moderation ───────────────────────────────────────
async function renderAdminContent(inner) {
  inner.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">
        To delete specific content, navigate to it in the app and use the delete button.
        All admin deletions are logged automatically.
      </div>
      <button class="btn btn-secondary btn-full" onclick="adminViewAllPosts()">
        📋 View All Feed Posts
      </button>
      <button class="btn btn-secondary btn-full" onclick="adminViewAllHarvests()">
        🦌 View All Harvests
      </button>
      <button class="btn btn-secondary btn-full" onclick="adminViewAllTrailCam()">
        📷 View All Trail Cam Photos
      </button>
    </div>`;
}

window.adminViewAllPosts = async function () {
  const snap = await getDocs(query(collection(db, "feed"), orderBy("createdAt","desc"), limit(30)));
  _adminDocCache = {};
  snap.docs.forEach(d => { _adminDocCache[d.id] = { id: d.id, ...d.data() }; });
  const ov = document.createElement("div");
  ov.className = "modal-overlay"; ov.id = "admin-posts-overlay";
  ov.innerHTML = `
    <div class="modal-box" style="max-width:400px;max-height:85vh;overflow-y:auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="modal-title" style="margin:0">All Feed Posts</div>
        <button onclick="document.getElementById('admin-posts-overlay').remove()"
          style="background:none;border:none;color:var(--text-muted);font-size:20px;cursor:pointer">✕</button>
      </div>
      ${snap.docs.map(d => {
        const p = d.data();
        return `<div style="border:1px solid var(--card-border);border-radius:var(--radius-md);
                            padding:10px;margin-bottom:8px">
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:5px">
            ${esc(p.memberName||"Auto")} · ${formatDate(p.createdAt)}
          </div>
          <div style="font-size:13px;color:var(--text-warm);margin-bottom:8px">
            ${esc(p.text||"[auto event]")}
          </div>
          <button class="btn btn-danger btn-sm" onclick="adminDeleteFeedPost('${d.id}')">
            🗑 Delete
          </button>
        </div>`;
      }).join("")}
    </div>`;
  document.body.appendChild(ov);
};

window.adminDeleteFeedPost = function (id, text, memberName, photoUrl) {
  if (text === undefined) {
    const c = _adminDocCache[id] || {};
    text = c.text || ""; memberName = c.memberName || "Unknown"; photoUrl = c.photoURL || "";
  }
  const hasPhoto = !!photoUrl;
  requireReason(
    "Delete Feed Post",
    `Delete this post by ${memberName}?`,
    async (reason, keepPhoto) => {
      await deleteDoc(doc(db, "feed", id));
      if (!keepPhoto) await deleteStoredImage(photoUrl);
      await writeAdminLog(
        "delete_feed_post",
        { uid: null, name: memberName },
        `Post text: "${text}"`,
        reason,
        keepPhoto ? photoUrl : null
      );
      document.getElementById("admin-posts-overlay")?.remove();
      showToast("Post deleted and logged.", "success");
    }, hasPhoto, text, { name: memberName }
  );
};

window.adminDeleteHarvest = function (id, data) {
  data = data || _adminDocCache[id] || {};
  const hasPhoto = !!data?.photoURL;
  const snapshot = `${data?.species||""} by ${data?.memberName||""} on ${formatDate(data?.harvestDate)}`;
  requireReason(
    "Delete Harvest",
    `Delete this harvest entry by ${data?.memberName}?`,
    async (reason, keepPhoto) => {
      await deleteDoc(doc(db, "harvests", id));
      if (!keepPhoto) await deleteStoredImage(data?.photoURL);
      trophyCache = null;
      if (data?.uid) {
        try {
          const userRef  = doc(db, "users", data.uid);
          const userSnap = await getDoc(userRef);
          const userData = userSnap.data() || {};
          const pts      = computeKillPoints(data);
          await updateDoc(userRef, {
            killPoints: Math.max(0, (userData.killPoints || 0) - pts),
            totalKills: Math.max(0, (userData.totalKills || 0) - 1)
          });
        } catch (e) { console.error("Kill point adjustment failed:", e); }
      }
      await writeAdminLog(
        "delete_harvest",
        { uid: data?.uid, name: data?.memberName },
        snapshot,
        reason,
        keepPhoto ? data.photoURL : null
      );
      showToast("Harvest deleted and logged.", "success");
      if (lastHarvestSnap) renderHarvestList(lastHarvestSnap, "all");
    }, hasPhoto, snapshot, { uid: data?.uid, name: data?.memberName }
  );
};

window.adminDeleteTcPhoto = function (id, data) {
  data = data || _adminDocCache[id] || {};
  const hasPhoto = !!data?.photoURL;
  requireReason(
    "Delete Trail Cam Photo",
    `Delete this photo by ${data?.uploaderName}?`,
    async (reason, keepPhoto) => {
      await deleteDoc(doc(db, "trailcam", id));
      if (!keepPhoto) await deleteStoredImage(data?.photoURL);
      await writeAdminLog(
        "delete_trailcam",
        { uid: data?.uid, name: data?.uploaderName },
        `Caption: "${data?.caption||"none"}" uploaded ${formatDate(data?.capturedAt)}`,
        reason,
        keepPhoto ? data.photoURL : null
      );
      closeTcLightbox();
      showToast("Photo deleted and logged.", "success");
    }, hasPhoto, data?.caption, { uid: data?.uid, name: data?.uploaderName }
  );
};

async function renderAdminBulletins(inner) {
  const snap = await getDocs(query(collection(db, "bulletins"), orderBy("createdAt","desc")));
  _adminDocCache = {};
  snap.docs.forEach(d => { _adminDocCache[d.id] = { id: d.id, ...d.data() }; });
  inner.innerHTML = `
    <div style="margin-bottom:12px">
      <button class="btn btn-primary btn-full" onclick="adminPostBulletin()">
        📢 Post New Bulletin
      </button>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${snap.empty ? `<div style="color:var(--text-muted);font-size:13px;font-style:italic">No bulletins yet.</div>` :
        snap.docs.map(d => {
          const b = d.data();
          return `<div style="border:1px solid var(--card-border);border-radius:var(--radius-md);padding:10px">
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">
              ${b.pinned ? "📌 PINNED · " : ""}${esc(b.authorName||"Admin")} · ${formatDate(b.createdAt)}
            </div>
            <div style="font-size:13px;color:var(--text-warm);margin-bottom:8px">${esc(b.text||"")}</div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-secondary btn-sm" onclick="adminTogglePin('${d.id}',${!!b.pinned})">
                ${b.pinned ? "📌 Unpin" : "📌 Pin"}
              </button>
              <button class="btn btn-danger btn-sm" onclick="adminDeleteBulletin('${d.id}')">
                🗑 Delete
              </button>
            </div>
          </div>`;
        }).join("")}
    </div>`;
}

window.adminPostBulletin = function () {
  const ov = document.createElement("div");
  ov.className = "modal-overlay"; ov.id = "bulletin-post-overlay";
  ov.innerHTML = `
    <div class="modal-box" style="max-width:360px">
      <div class="modal-title">📢 Post Bulletin</div>
      <div class="input-group" style="margin-bottom:12px">
        <label>Bulletin Text</label>
        <textarea id="bulletin-text" placeholder="Write your bulletin…" style="min-height:100px"></textarea>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:13px;color:var(--text-muted);cursor:pointer">
        <input type="checkbox" id="bulletin-pin" />
        Pin to top of home screen
      </label>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('bulletin-post-overlay').remove()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="submitBulletin()">Post</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
};

window.submitBulletin = async function () {
  const text   = document.getElementById("bulletin-text")?.value.trim();
  const pinned = document.getElementById("bulletin-pin")?.checked || false;
  if (!text) { showToast("Write something first.", "error"); return; }
  try {
    await addDoc(collection(db, "bulletins"), {
      text, pinned,
      authorName: userProfile.displayName,
      authorUid:  userProfile.uid,
      createdAt:  serverTimestamp()
    });
    document.getElementById("bulletin-post-overlay")?.remove();
    showToast("Bulletin posted!", "success");
    loadAdminSection("bulletins");
    renderHomeScreen();
  } catch(err) { console.error(err); showToast("Could not post bulletin.", "error"); }
};

window.adminTogglePin = async function (id, isPinned) {
  try {
    await updateDoc(doc(db, "bulletins", id), { pinned: !isPinned });
    showToast(isPinned ? "Bulletin unpinned." : "Bulletin pinned!", "success");
    loadAdminSection("bulletins");
    renderHomeScreen();
  } catch (err) { console.error(err); showToast("Could not update the bulletin.", "error"); }
};

window.adminDeleteBulletin = function (id, text) {
  if (text === undefined) text = (_adminDocCache[id] || {}).text || "";
  requireReason(
    "Delete Bulletin",
    `Delete this bulletin?`,
    async (reason) => {
      await deleteDoc(doc(db, "bulletins", id));
      await writeAdminLog("delete_bulletin", { uid: null, name: "System" }, `Bulletin: "${text}"`, reason, null);
      showToast("Bulletin deleted and logged.", "success");
      loadAdminSection("bulletins");
      renderHomeScreen();
    }, false, text, null
  );
};

async function renderAdminSignups(inner) {
  let cfg = null;
  try {
    const snap = await getDoc(doc(db, "config", "signup"));
    cfg = snap.exists() ? snap.data() : null;
  } catch (_) {}
  const hasCode = !!(cfg && cfg.codeHash);
  const open    = !!(cfg && cfg.open && cfg.codeHash);

  inner.innerHTML = `
    <div style="font-size:13px;color:var(--text-muted);line-height:1.5;margin-bottom:14px">
      New members create their own account on the sign-in screen using the camp
      code. Change it or close sign-ups if the code gets out.
    </div>
    <div style="background:rgba(255,255,255,0.04);border:1px solid var(--card-border);
                border-radius:var(--radius-md);padding:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:13px;color:var(--text-warm)">Sign-ups</span>
        <span style="font-size:12px;font-weight:700;letter-spacing:0.5px;
                     color:${open ? "var(--gold)" : "var(--danger)"}">
          ${open ? "OPEN" : "CLOSED"}
        </span>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
        ${hasCode
          ? (cfg.updatedByName ? `Code last set by ${esc(cfg.updatedByName)}.` : "A camp code is set.")
          : "No camp code set yet — set one to allow sign-ups."}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" onclick="adminSetCampCode()">
          ${hasCode ? "Change code" : "Set code"}
        </button>
        ${hasCode ? `<button class="btn btn-secondary btn-sm" onclick="adminToggleSignups(${open})">
          ${open ? "Close sign-ups" : "Open sign-ups"}
        </button>` : ""}
      </div>
    </div>`;
}

window.adminSetCampCode = function () {
  const ov = document.createElement("div");
  ov.className = "modal-overlay"; ov.id = "campcode-overlay";
  ov.innerHTML = `
    <div class="modal-box" style="max-width:340px">
      <div class="modal-title">🎟️ Camp code</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;line-height:1.5">
        Members type this when creating an account. Not case-sensitive, spaces
        ignored. Setting a new code opens sign-ups.
      </div>
      <div class="input-group" style="margin-bottom:16px">
        <label>New code</label>
        <input type="text" id="campcode-input" placeholder="e.g. BuckSeason26" autocapitalize="none" autocomplete="off" />
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('campcode-overlay').remove()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="submitCampCode()">Save</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
};

window.submitCampCode = async function () {
  const norm = normalizeCode(document.getElementById("campcode-input")?.value || "");
  if (norm.length < 4) { showToast("Use at least 4 characters.", "error"); return; }
  try {
    const codeHash = await sha256Hex(norm);
    await setDoc(doc(db, "config", "signup"), {
      codeHash,
      open:          true,
      updatedAt:     serverTimestamp(),
      updatedByName: userProfile.displayName
    }, { merge: true });
    await writeAdminLog("set_camp_code", null, "Camp code changed; sign-ups open", "Camp code rotation", null);
    document.getElementById("campcode-overlay")?.remove();
    showToast("Camp code set. Sign-ups are open.", "success");
    loadAdminSection("signups");
  } catch (err) { console.error(err); showToast("Could not save the code.", "error"); }
};

window.adminToggleSignups = function (isOpen) {
  const next = !isOpen;
  appConfirm(
    next ? "Open sign-ups" : "Close sign-ups",
    next ? "Anyone with the camp code can create an account."
         : "No new accounts can be created until you reopen sign-ups.",
    async () => {
      try {
        await setDoc(doc(db, "config", "signup"), { open: next }, { merge: true });
        await writeAdminLog(next ? "open_signups" : "close_signups", null,
          next ? "Sign-ups opened" : "Sign-ups closed", "Admin toggle", null);
        showToast(next ? "Sign-ups opened." : "Sign-ups closed.", "success");
        loadAdminSection("signups");
      } catch (err) { console.error(err); showToast("Could not update.", "error"); }
    }
  );
};

async function renderAdminStats(inner) {
  const [users, harvests, trailcam, feed, bulletins] = await Promise.all([
    getDocs(collection(db, "users")),
    getDocs(collection(db, "harvests")),
    getDocs(collection(db, "trailcam")),
    getDocs(collection(db, "feed")),
    getDocs(collection(db, "bulletins"))
  ]);
  inner.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${[
        ["👥", "Members",    users.size],
        ["🦌", "Harvests",   harvests.size],
        ["📷", "Trail Cam",  trailcam.size],
        ["💬", "Feed Posts", feed.size],
        ["📢", "Bulletins",  bulletins.size],
      ].map(([icon, label, count]) => `
        <div style="background:rgba(255,255,255,0.04);border:1px solid var(--card-border);
                    border-radius:var(--radius-md);padding:14px;text-align:center">
          <div style="font-size:28px;margin-bottom:4px">${icon}</div>
          <div style="font-size:22px;font-weight:700;color:var(--gold)">${count}</div>
          <div style="font-size:11px;color:var(--text-muted)">${label}</div>
        </div>`).join("")}
    </div>`;
}

async function renderAdminLog(inner) {
  const snap = await getDocs(query(collection(db, "adminLog"), orderBy("timestamp","desc"), limit(50)));
  if (snap.empty) {
    inner.innerHTML = `<div style="color:var(--text-muted);font-size:13px;font-style:italic">No admin actions logged yet.</div>`;
    return;
  }
  const ACTION_LABELS = {
    delete_feed_post:   "🗑 Deleted Feed Post",
    delete_harvest:     "🗑 Deleted Harvest",
    delete_trailcam:    "🗑 Deleted Trail Cam Photo",
    delete_bulletin:    "🗑 Deleted Bulletin",
    delete_comment:     "🗑 Deleted Comment",
    role_change:        "👤 Changed User Role",
    password_reset:     "🔑 Password Reset Sent",
    deactivate_guest_key:"🔑 Deactivated Guest Key"
  };
  inner.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px">
      ${snap.docs.map((d,i) => {
        const log = d.data();
        const label = ACTION_LABELS[log.action] || esc(log.action);
        return `
          <div>
            <button class="tc-row-header" id="log-toggle-${i}"
              onclick="toggleLogEntry(${i})" style="margin-bottom:0">
              <div style="flex:1;text-align:left;min-width:0">
                <div style="font-size:13px;font-weight:600;color:var(--text-warm)">${label}</div>
                <div style="font-size:11px;color:var(--text-muted)">
                  ${esc(log.adminName)} · ${formatDate(log.timestamp)}
                </div>
              </div>
              <span id="log-arrow-${i}" style="color:var(--gold);font-size:18px;transition:transform 0.2s">›</span>
            </button>
            <div id="log-content-${i}" class="hidden"
              style="background:rgba(14,10,4,0.92);border:1px solid var(--gold-dim);
                     border-top:none;border-bottom-left-radius:var(--radius-lg);
                     border-bottom-right-radius:var(--radius-lg);padding:12px;margin-bottom:4px">
              <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text-muted)">
                ${log.targetName ? `<div><span style="color:var(--text-dim)">Target:</span> ${esc(log.targetName)}</div>` : ""}
                ${log.contentSnapshot ? `<div><span style="color:var(--text-dim)">Content:</span> ${esc(log.contentSnapshot)}</div>` : ""}
                <div><span style="color:var(--text-dim)">Reason:</span> <span style="color:var(--text-warm)">${esc(log.reason)}</span></div>
                ${log.photoUrl ? `
                  <div>
                    <div style="color:var(--text-dim);margin-bottom:4px">Preserved Photo:</div>
                    <img src="${esc(log.photoUrl || "")}" style="width:100%;border-radius:var(--radius-sm);max-height:160px;object-fit:cover" />
                  </div>` : ""}
              </div>
            </div>
          </div>`;
      }).join("")}
    </div>`;
}

window.toggleLogEntry = function (i) {
  const panel  = document.getElementById("log-content-" + i);
  const arrow  = document.getElementById("log-arrow-"   + i);
  const header = document.getElementById("log-toggle-"  + i);
  if (!panel) return;
  const opening = panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !opening);
  if (arrow)  arrow.style.transform = opening ? "rotate(90deg)" : "";
  if (header) header.classList.toggle("expanded", opening);
};

// Cache of docs shown in admin "view all" modals, so delete buttons can pass
// just an id instead of trying to embed JSON in an onclick attribute.
let _adminDocCache = {};

async function renderAdminViewAllHarvests() {
  const snap = await getDocs(query(collection(db, "harvests"), orderBy("harvestDate","desc"), limit(50)));
  _adminDocCache = {};
  snap.docs.forEach(d => { _adminDocCache[d.id] = { id: d.id, ...d.data() }; });
  const ov = document.createElement("div");
  ov.className = "modal-overlay"; ov.id = "admin-harvests-overlay";
  ov.innerHTML = `
    <div class="modal-box" style="max-width:400px;max-height:85vh;overflow-y:auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="modal-title" style="margin:0">All Harvests</div>
        <button onclick="document.getElementById('admin-harvests-overlay').remove()"
          style="background:none;border:none;color:var(--text-muted);font-size:20px;cursor:pointer">✕</button>
      </div>
      ${snap.docs.map(d => {
        const h = d.data();
        const sp = speciesInfo(h.species);
        return `<div style="border:1px solid var(--card-border);border-radius:var(--radius-md);
                            padding:10px;margin-bottom:8px">
          <div style="font-size:13px;color:var(--text-warm);margin-bottom:6px">
            ${sp.icon} ${sp.label} · ${esc(h.memberName)} · ${formatDate(h.harvestDate)}
          </div>
          <button class="btn btn-danger btn-sm"
            onclick="adminDeleteHarvest('${d.id}')">
            🗑 Delete
          </button>
        </div>`;
      }).join("")}
    </div>`;
  document.body.appendChild(ov);
}
window.adminViewAllHarvests = renderAdminViewAllHarvests;
window.adminViewAllTrailCam = async function () {
  const snap = await getDocs(query(collection(db, "trailcam"), orderBy("createdAt","desc"), limit(50)));
  _adminDocCache = {};
  snap.docs.forEach(d => { _adminDocCache[d.id] = { id: d.id, ...d.data() }; });
  const ov = document.createElement("div");
  ov.className = "modal-overlay"; ov.id = "admin-tc-overlay";
  ov.innerHTML = `
    <div class="modal-box" style="max-width:400px;max-height:85vh;overflow-y:auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="modal-title" style="margin:0">All Trail Cam Photos</div>
        <button onclick="document.getElementById('admin-tc-overlay').remove()"
          style="background:none;border:none;color:var(--text-muted);font-size:20px;cursor:pointer">✕</button>
      </div>
      ${snap.docs.map(d => {
        const tc = d.data();
        return `<div style="border:1px solid var(--card-border);border-radius:var(--radius-md);
                            overflow:hidden;margin-bottom:8px">
          <img src="${esc(tc.photoURL || "")}" style="width:100%;height:120px;object-fit:cover;display:block" />
          <div style="padding:8px 10px;display:flex;align-items:center;justify-content:space-between">
            <div style="font-size:12px;color:var(--text-muted)">${esc(tc.uploaderName)} · ${formatDate(tc.capturedAt)}</div>
            <button class="btn btn-danger btn-sm"
              onclick="adminDeleteTcPhoto('${d.id}')">
              🗑
            </button>
          </div>
        </div>`;
      }).join("")}
    </div>`;
  document.body.appendChild(ov);
};


// ============================================================
// HARVEST LOG — Collapsible rows, inline detail (Step 4 v2)
// ============================================================

const SPECIES = [
  { id: "deer",      label: "Deer",      icon: "🦌" },
  { id: "turkey",    label: "Turkey",    icon: "🦃" },
  { id: "waterfowl", label: "Waterfowl", icon: "🦆" },
  { id: "smallgame", label: "Small Game",icon: "🐇" },
  { id: "bear",      label: "Bear",      icon: "🐻" },
  { id: "other",     label: "Other",     icon: "🎯" }
];

const REACTIONS_LIST = ["👍","🔥","😮","🎯","💪","🏆"];

let harvestListUnsub  = null;
let harvestDetailData = null;
let harvestPhotoFile  = null;
let editingHarvestId  = null;
let expandedHarvests  = new Set();
let harvestPhotosShown = new Set();  // harvest ids whose photo is toggled open
let lastHarvestSnap   = null;

function speciesInfo(id) {
  return SPECIES.find(s => s.id === id) || { label: "Other", icon: "🎯" };
}

function formatDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" });
}

// ── Inject styles ────────────────────────────────────────────
(function injectHarvestStyles() {
  if (document.getElementById("harvest-styles")) return;
  const style = document.createElement("style");
  style.id = "harvest-styles";
  style.textContent = `
    .harvest-row-header {
      display:flex;align-items:center;gap:10px;padding:12px 14px;
      background:var(--forest-card);border:1px solid var(--card-border);
      border-radius:var(--radius-lg);cursor:pointer;transition:border-color 0.2s,background 0.2s;
      width:100%;text-align:left;font-family:var(--font-sans);margin-bottom:8px;
    }
    .harvest-row-header:hover { border-color:var(--gold-dim); }
    .harvest-row-header.expanded {
      border-color:var(--gold-dim);border-bottom-left-radius:0;
      border-bottom-right-radius:0;margin-bottom:0;
    }
    .harvest-detail-panel {
      background:rgba(14,10,4,0.92);border:1px solid var(--gold-dim);
      border-top:none;border-bottom-left-radius:var(--radius-lg);
      border-bottom-right-radius:var(--radius-lg);
      padding:14px;margin-bottom:10px;
    }
    .harvest-filter-btn {
      flex-shrink:0;background:rgba(255,255,255,0.06);border:1px solid var(--card-border);
      color:var(--text-muted);border-radius:20px;padding:6px 13px;font-size:12px;
      font-weight:600;cursor:pointer;transition:all 0.2s;font-family:var(--font-sans);
    }
    .harvest-filter-btn.active {
      background:linear-gradient(135deg,var(--orange),var(--orange-bright));
      border-color:transparent;color:#fff;
    }
    .harvest-filter-btn:hover:not(.active) { border-color:var(--gold-dim);color:var(--gold); }
  `;
  document.head.appendChild(style);
})();

// ── Navigate ─────────────────────────────────────────────────
window.goHarvest = function () {
  showScreen("screen-harvest");
  renderHarvestScreen();
};

// ── Main Screen ──────────────────────────────────────────────
window.renderHarvestScreen = function () {
  const content = document.getElementById("harvest-content");
  content.innerHTML = `
    <div style="padding:8px 16px 4px;display:flex;gap:6px;overflow-x:auto;
                scrollbar-width:none;-webkit-overflow-scrolling:touch;padding-bottom:8px">
      <button class="harvest-filter-btn active" data-species="all"
        onclick="filterHarvests(\'all\')">All</button>
      ${SPECIES.map(s =>
        `<button class="harvest-filter-btn" data-species="${s.id}"
          onclick="filterHarvests(\'${s.id}\')">${s.icon} ${s.label}</button>`
      ).join("")}
    </div>
    <div class="fade-divider-plain"></div>
    <div id="harvest-list-wrap" style="padding:0 16px 80px">
      <div style="text-align:center;padding:32px 0;color:var(--text-muted)">
        <div class="spinner" style="margin:0 auto 12px"></div>
        Loading…
      </div>
    </div>
  `;
  loadHarvestList("all");
};

function loadHarvestList(speciesFilter) {
  if (harvestListUnsub) { harvestListUnsub(); harvestListUnsub = null; }
  const wrap = document.getElementById("harvest-list-wrap");
  if (!wrap) return;

  const q = query(collection(db, "harvests"), orderBy("harvestDate", "desc"));

  harvestListUnsub = onSnapshot(q, (snap) => {
    lastHarvestSnap = snap;
    // Skip the rebuild for our own optimistic writes (reactions/comments already
    // update in place); wait for the confirmed server snapshot.
    if (snap.metadata.hasPendingWrites) return;
    const scroller = document.getElementById("main-content");
    const keepScroll = scroller ? scroller.scrollTop : 0;
    const activeFilter = document.querySelector(".harvest-filter-btn.active")?.dataset?.species || speciesFilter;
    renderHarvestList(snap, activeFilter);
    if (scroller) scroller.scrollTop = keepScroll;
    refreshHomeHarvests(snap.docs.slice(0, 3));
  }, err => {
    console.error(err);
    if (wrap) wrap.innerHTML = `<div style="color:var(--danger);padding:16px">Could not load harvests.</div>`;
  });
}

function renderHarvestList(snap, speciesFilter) {
  const wrap = document.getElementById("harvest-list-wrap");
  if (!wrap) return;

  let docs = snap.docs;
  if (speciesFilter && speciesFilter !== "all") {
    docs = docs.filter(d => d.data().species === speciesFilter);
  }

  if (docs.length === 0) {
    wrap.innerHTML = `
      <div style="text-align:center;padding:48px 0;color:var(--text-muted)">
        <div style="font-size:48px;margin-bottom:12px">🦌</div>
        <div>No harvests logged yet.</div>
        <div style="font-size:12px;margin-top:6px">Tap + to log the first one!</div>
      </div>`;
    return;
  }

  wrap.innerHTML = docs.map(d => {
    const h  = { id: d.id, ...d.data() };
    const sp = speciesInfo(h.species);
    const dateStr = formatDate(h.harvestDate);
    const weight  = h.weight    ? ` · ${h.weight} lbs`  : "";
    const score   = h.rackScore ? ` · ${h.rackScore}" B&C` : "";
    const isExp   = expandedHarvests.has(h.id);

    return `
      <div style="margin-bottom:${isExp ? "0" : "10px"}">
        <button class="harvest-row-header ${isExp ? "expanded" : ""}"
          onclick="toggleHarvestRow(\'${h.id}\')">
          <div class="avatar" style="background:${safeColor(h.uploaderColor)};
               width:34px;height:34px;font-size:12px;flex-shrink:0">
            ${esc(h.uploaderInitials || h.memberName?.slice(0,2).toUpperCase() || "??")}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:600;color:var(--text-warm)">
              ${sp.icon} ${sp.label}
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
              ${esc(h.memberName || "Unknown")} · ${dateStr}${weight}${score}
            </div>
          </div>
          <span style="color:var(--gold);font-size:18px;flex-shrink:0;transition:transform 0.2s;
                       ${isExp ? "transform:rotate(90deg)" : ""}">›</span>
        </button>
        ${isExp ? `<div class="harvest-detail-panel" id="hd-${h.id}">
          ${renderHarvestDetailInline(h)}
        </div>` : ""}
      </div>
    `;
  }).join("");
}

window.toggleHarvestRow = function (id) {
  if (expandedHarvests.has(id)) {
    expandedHarvests.delete(id);
  } else {
    expandedHarvests.add(id);
    // Load fresh data for detail
    getDoc(doc(db, "harvests", id)).then(snap => {
      if (!snap.exists()) return;
      harvestDetailData = { id, ...snap.data() };
      const panel = document.getElementById("hd-" + id);
      if (panel) panel.innerHTML = renderHarvestDetailInline(harvestDetailData);
    });
  }
  if (lastHarvestSnap) {
    const filterBtn = document.querySelector(".harvest-filter-btn.active");
    const species   = filterBtn?.dataset?.species || "all";
    renderHarvestList(lastHarvestSnap, species);
  }
};

function renderHarvestDetailInline(h) {
  const id        = h.id;
  const sp        = speciesInfo(h.species);
  const dateStr   = formatDate(h.harvestDate);
  const isOwner   = userProfile && (userProfile.uid === h.uid || userProfile.role === "admin");
  const reactions = h.reactions || {};

  return `
    <div style="display:flex;flex-direction:column;gap:12px">

      <!-- Stats -->
      ${(h.weight || h.rackScore || h.notes) ? `
        <div style="display:grid;grid-template-columns:${h.weight && h.rackScore ? "1fr 1fr" : "1fr"};gap:8px">
          ${h.weight    ? detailStat("⚖️ Weight",    h.weight + " lbs") : ""}
          ${h.rackScore ? detailStat("🏆 B&C Score", h.rackScore + '"') : ""}
        </div>
        ${h.notes ? `<div style="font-size:13px;color:var(--text-muted);line-height:1.5;white-space:pre-wrap;word-break:break-word">${esc(h.notes)}</div>` : ""}
      ` : ""}

      <!-- Photo — red button, compare appears when photo is open -->
      ${h.photoURL ? (() => { const shown = harvestPhotosShown.has(id); return `
        <div>
          <button onclick="toggleHarvestPhoto(\'${id}\')" id="hphoto-toggle-${id}"
            style="width:100%;padding:10px;border:none;border-radius:var(--radius-md);
                   background:linear-gradient(135deg,#a01020,#c01830);color:#fff;
                   font-size:13px;font-weight:600;cursor:pointer;margin-bottom:8px;
                   font-family:var(--font-sans);transition:filter 0.2s">
            ${shown ? "📷 Hide Photo" : "📷 Show Photo"}
          </button>
          <img id="hphoto-${id}" src="${esc(h.photoURL || "")}"
            style="display:${shown ? "block" : "none"};width:100%;border-radius:var(--radius-md);
                   border:1px solid var(--card-border);margin-bottom:8px" />
          <button id="hphoto-compare-${id}" onclick="openHarvestCompare(\'${id}\')"
            style="display:${shown ? "block" : "none"};width:100%;padding:9px;border:1px solid var(--card-border);
                   border-radius:var(--radius-md);background:rgba(255,255,255,0.06);
                   color:var(--text-warm);font-size:13px;font-weight:600;cursor:pointer;
                   font-family:var(--font-sans);transition:all 0.2s">
            Compare to TrailCam Picture
          </button>
        </div>`; })() : ""}

      <!-- Reactions compact -->
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap">
        <div style="display:flex;flex-wrap:wrap;gap:4px;flex:1" id="reactions-display-${id}">
          ${renderReactionBadges(reactions, id, "harvests")}
        </div>
        ${userProfile ? `
          <button onclick="toggleHarvestReactPicker(\'${id}\')"
            style="background:rgba(255,255,255,0.06);border:1px solid var(--card-border);
                   border-radius:20px;padding:4px 10px;font-size:13px;cursor:pointer;
                   color:var(--text-muted);font-family:var(--font-sans)">😊 React</button>` : ""}
      </div>
      <div id="harvest-react-picker-${id}" class="hidden"
        style="display:flex;flex-wrap:wrap;gap:5px;padding:2px 0 8px">
        ${userProfile ? REACTIONS_LIST.map(e => `
          <button onclick="addHarvestReaction(\'${id}\',\'${e}\');toggleHarvestReactPicker(\'${id}\')"
            style="background:rgba(255,255,255,0.06);border:1px solid var(--card-border);
                   border-radius:20px;padding:5px 10px;font-size:15px;cursor:pointer;
                   font-family:var(--font-sans)">${e}</button>`).join("") : ""}
      </div>

      <!-- Comments -->
      <div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;
                    letter-spacing:0.5px;text-transform:uppercase">Comments</div>
        <div id="harvest-comments-${id}">
          ${renderComments(h.comments || [], id, "harvests")}
        </div>
        ${userProfile ? `
          <div style="display:flex;gap:8px;margin-top:10px">
            <input type="text" id="hcomment-${id}" placeholder="Add a comment…"
              style="flex:1"
              onkeydown="if(event.key===\'Enter\')submitHarvestComment(\'${id}\')" />
            <button class="btn btn-primary btn-sm"
              onclick="submitHarvestComment(\'${id}\')">Post</button>
          </div>` : ""}
      </div>

      <!-- Actions -->
      ${isOwner ? `
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" onclick="openEditHarvest(\'${id}\')">✏️ Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteHarvest(\'${id}\')">🗑 Delete</button>
        </div>` : ""}
    </div>
  `;
}

function detailStat(label, value) {
  return `<div style="background:rgba(255,255,255,0.04);border:1px solid var(--card-border);
                       border-radius:var(--radius-md);padding:8px 10px">
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">${label}</div>
    <div style="font-size:14px;font-weight:600;color:var(--text-warm)">${value}</div>
  </div>`;
}

// ── Reaction picker toggle ───────────────────────────────────
window.toggleHarvestReactPicker = function (id) {
  document.getElementById("harvest-react-picker-" + id)?.classList.toggle("hidden");
};

// ── Photo toggle ─────────────────────────────────────────────
window.toggleHarvestPhoto = function (id) {
  const img     = document.getElementById("hphoto-" + id);
  const btn     = document.getElementById("hphoto-toggle-" + id);
  const compare = document.getElementById("hphoto-compare-" + id);
  if (!img) return;
  const isHidden = img.style.display === "none";
  img.style.display = isHidden ? "block" : "none";
  if (btn)     btn.textContent  = isHidden ? "📷 Hide Photo" : "📷 Show Photo";
  if (compare) compare.style.display = isHidden ? "block" : "none";
  if (isHidden) harvestPhotosShown.add(id);
  else harvestPhotosShown.delete(id);
};

// ── Filter ───────────────────────────────────────────────────
window.filterHarvests = function (species) {
  document.querySelectorAll(".harvest-filter-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.species === species);
  });
  if (lastHarvestSnap) renderHarvestList(lastHarvestSnap, species);
};

// ── Home strip ───────────────────────────────────────────────
function refreshHomeHarvests(docs) {
  const wrap = document.getElementById("recent-harvests-list");
  if (!wrap) return;
  if (!docs || docs.length === 0) {
    wrap.innerHTML = `<div style="padding:14px 16px;color:var(--text-dim);font-size:13px;
                                  font-style:italic">No recent harvests yet.</div>`;
    return;
  }
  wrap.innerHTML = docs.map(d => {
    const h   = d.data ? d.data() : d;
    const id  = d.id || h.id;
    const sp  = speciesInfo(h.species);
    const dateStr = formatDate(h.harvestDate);
    return `
      <button onclick="goHarvest()"
        style="display:flex;align-items:center;gap:12px;width:100%;padding:12px 16px;
               border:none;background:none;cursor:pointer;text-align:left;
               color:var(--text-warm);font-family:var(--font-sans);transition:background 0.2s;"
        onmouseover="this.style.background=\'rgba(196,169,106,0.05)\'"
        onmouseout="this.style.background=\'none\'">
        <span style="font-size:24px">${sp.icon}</span>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:600">${sp.label}</div>
          <div style="font-size:12px;color:var(--text-muted)">${esc(h.memberName || "Unknown")} · ${dateStr}</div>
        </div>
        <span style="color:var(--text-dim)">›</span>
      </button>
      <div class="fade-divider-plain" style="margin:0 16px"></div>`;
  }).join("");
}

// ── Reactions ────────────────────────────────────────────────
window.addHarvestReaction = async function (id, emoji) {
  await addReaction(id, "harvests", emoji);
  const snap = await getDoc(doc(db, "harvests", id));
  const el   = document.getElementById("reactions-display-" + id);
  if (el) el.innerHTML = renderReactionBadges(snap.data()?.reactions || {}, id, "harvests");
};

// ── Comments ─────────────────────────────────────────────────
window.submitHarvestComment = async function (id) {
  if (!userProfile) return;
  const input = document.getElementById("hcomment-" + id);
  const text  = input?.value.trim();
  if (!text) return;
  try {
    const ref2     = doc(db, "harvests", id);
    const snap     = await getDoc(ref2);
    const comments = snap.data()?.comments || [];
    comments.push({
      uid: userProfile.uid, name: userProfile.displayName,
      initials: userProfile.initials, color: userProfile.color,
      text, createdAt: Date.now()
    });
    await updateDoc(ref2, { comments });
    if (input) input.value = "";
    const fresh = await getDoc(ref2);
    const wrap  = document.getElementById("harvest-comments-" + id);
    if (wrap) wrap.innerHTML = renderComments(fresh.data()?.comments || [], id, "harvests");
    showToast("Comment posted!", "success");
  } catch(err) { console.error(err); showToast("Could not post comment.", "error"); }
};

// Re-render a comment thread after it changes. Feed threads bundle the
// comment list with the "add a comment" input in one wrapper; harvest/trail
// cam threads keep the input as a separate sibling.
function refreshCommentsUI(docId, collName, comments) {
  const wrap = document.getElementById(
    collName === "feed" ? "feed-comments-" + docId
      : collName === "harvests" ? "harvest-comments-" + docId
      : "tc-lb-comments"
  );
  if (!wrap) return;
  if (collName === "feed") {
    wrap.innerHTML = `
      <div class="fade-divider-plain" style="margin:0 0 10px"></div>
      ${renderComments(comments, docId, "feed")}
      <div style="display:flex;gap:8px;margin-top:10px">
        <input type="text" id="feed-comment-input-${docId}"
          placeholder="Add a comment…" style="flex:1"
          onkeydown="if(event.key==='Enter')submitFeedComment('${docId}')" />
        <button class="btn btn-primary btn-sm" onclick="submitFeedComment('${docId}')">Post</button>
      </div>`;
  } else {
    wrap.innerHTML = renderComments(comments, docId, collName);
  }
}

// A comment can only be touched by whoever wrote it, or an admin — re-verified
// here (not just at the button level) since these are plain global functions.
function canTouchComment(comment) {
  return !!userProfile && !!comment && (comment.uid === userProfile.uid || userProfile.role === "admin");
}

window.deleteComment = async function (docId, collName, index) {
  appConfirm("Delete Comment", "Remove this comment?", async () => {
    try {
      const ref2     = doc(db, collName, docId);
      const snap     = await getDoc(ref2);
      const comments = snap.data()?.comments || [];
      if (!canTouchComment(comments[index])) { showToast("You can only delete your own comments.", "error"); return; }
      comments.splice(index, 1);
      await updateDoc(ref2, { comments });
      refreshCommentsUI(docId, collName, comments);
    } catch(err) { console.error(err); showToast("Could not delete comment.", "error"); }
  });
};

window.editComment = async function (docId, collName, index) {
  const ref2   = doc(db, collName, docId);
  const snap   = await getDoc(ref2);
  const comments0 = snap.data()?.comments || [];
  if (!canTouchComment(comments0[index])) { showToast("You can only edit your own comments.", "error"); return; }
  const current = comments0[index]?.text || "";
  appPrompt("Edit Comment", current, async (newText) => {
    if (!newText) return;
    try {
      const fresh    = await getDoc(ref2);
      const comments = fresh.data()?.comments || [];
      if (!canTouchComment(comments[index])) { showToast("You can only edit your own comments.", "error"); return; }
      comments[index].text = newText;
      await updateDoc(ref2, { comments });
      refreshCommentsUI(docId, collName, comments);
    } catch(err) { console.error(err); showToast("Could not edit comment.", "error"); }
  });
};

// ── Reactions shared ─────────────────────────────────────────
function renderReactionBadges(reactions, docId, collName) {
  if (!reactions || Object.keys(reactions).length === 0)
    return `<span style="color:var(--text-dim);font-size:13px">No reactions yet</span>`;
  return Object.entries(reactions).map(([emoji, users]) => {
    if (!REACTIONS_LIST.includes(emoji)) return "";   // ignore unexpected keys
    const count      = Object.keys(users || {}).length;
    if (count === 0) return "";
    const hasReacted = userProfile && users[userProfile.uid];
    return `<button onclick="addReaction(\'${docId}\',\'${collName}\',\'${emoji}\')"
      style="display:inline-flex;align-items:center;gap:5px;padding:5px 11px;
             background:${hasReacted ? "rgba(196,169,106,0.15)" : "rgba(255,255,255,0.06)"};
             border:1px solid ${hasReacted ? "var(--gold-dim)" : "var(--card-border)"};
             border-radius:20px;font-size:14px;cursor:pointer;color:var(--text-warm);
             font-family:var(--font-sans)">
      ${emoji} <span style="font-size:12px">${count}</span>
    </button>`;
  }).join("");
}

function renderComments(comments, docId, collName) {
  if (!comments || comments.length === 0)
    return `<div style="color:var(--text-dim);font-size:13px;font-style:italic">No comments yet.</div>`;
  return comments.map((c, i) => {
    const isAuthor = userProfile && (userProfile.uid === c.uid || userProfile.role === "admin");
    return `
      <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(196,169,106,0.07)">
        <div class="avatar" style="background:${safeColor(c.color)};width:30px;height:30px;
             font-size:11px;flex-shrink:0">${esc(c.initials || "?")}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
            <span style="font-size:13px;font-weight:600">${esc(c.name || "Member")}</span>
            <span style="font-size:11px;color:var(--text-dim)">${c.createdAt ? formatDate({ toDate:()=>new Date(c.createdAt) }) : ""}</span>
          </div>
          <div style="font-size:13px;color:var(--text-muted);line-height:1.4;white-space:pre-wrap;word-break:break-word">${esc(c.text)}</div>
          ${isAuthor ? `
            <div style="display:flex;gap:8px;margin-top:5px">
              <button class="btn btn-ghost btn-sm" style="font-size:11px;padding:3px 8px"
                onclick="editComment(\'${docId}\',\'${collName}\',${i})">Edit</button>
              <button class="btn btn-ghost btn-sm" style="font-size:11px;padding:3px 8px;color:var(--danger)"
                onclick="deleteComment(\'${docId}\',\'${collName}\',${i})">Delete</button>
            </div>` : ""}
        </div>
      </div>`;
  }).join("");
}

// ── Shared addReaction ────────────────────────────────────────
window.addReaction = async function (docId, collName, emoji) {
  if (!userProfile) { showToast("Sign in to react.", "error"); return; }
  try {
    const ref2      = doc(db, collName, docId);
    const snap      = await getDoc(ref2);
    const reactions = snap.data()?.reactions || {};
    const existingTypes  = Object.keys(reactions).filter(e => Object.keys(reactions[e] || {}).length > 0);
    const alreadyHasThis = reactions[emoji] && reactions[emoji][userProfile.uid];
    if (!alreadyHasThis && !existingTypes.includes(emoji) && existingTypes.length >= 2) {
      showToast("Max 2 reaction types per post.", "error"); return;
    }
    const reactionPath = `reactions.${emoji}.${userProfile.uid}`;
    if (alreadyHasThis) {
      await updateDoc(ref2, { [reactionPath]: deleteField() });
    } else {
      await updateDoc(ref2, { [reactionPath]: true });
    }
  } catch(err) { console.error(err); showToast("Could not save reaction.", "error"); }
};

// ── Add Harvest ───────────────────────────────────────────────
window.openAddHarvest = function () {
  if (!userProfile) { showToast("Sign in to add a harvest.", "error"); return; }
  editingHarvestId  = null;
  harvestDetailData = null;
  showHarvestForm(null);
};

window.openEditHarvest = async function (id) {
  editingHarvestId = id;
  const snap = await getDoc(doc(db, "harvests", id));
  harvestDetailData = { id, ...snap.data() };
  showHarvestForm(snap.data());
};

function showHarvestForm(data) {
  const today   = new Date().toISOString().split("T")[0];
  const d       = data || {};
  const dateVal = d.harvestDate
    ? (d.harvestDate.toDate ? d.harvestDate.toDate().toISOString().split("T")[0] : d.harvestDate)
    : today;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "harvest-form-overlay";
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:380px;max-height:90vh;overflow-y:auto">
      <div class="modal-title">${editingHarvestId ? "Edit Harvest" : "Log Harvest"}</div>
      <button type="button" onclick="closeHarvestForm();goTo('screen-mykills')"
        style="background:none;border:none;color:var(--gold);font-size:12px;cursor:pointer;
               padding:0;margin:0 0 12px;font-family:var(--font-sans)">🏆 View My Trophy Room →</button>

      <div class="input-group" style="margin-bottom:12px">
        <label>Species</label>
        <select id="hf-species" onchange="updateHarvestFields()">
          ${SPECIES.map(s => `<option value="${s.id}" ${d.species===s.id?"selected":""}>${s.icon} ${s.label}</option>`).join("")}
        </select>
      </div>

      <!-- Dynamic fields injected here -->
      <div id="hf-dynamic-fields"></div>

      <div class="input-group" style="margin-bottom:12px">
        <label>Date</label>
        <input type="date" id="hf-date" value="${dateVal}" />
      </div>
      <div class="input-group" style="margin-bottom:12px">
        <label>Notes</label>
        <textarea id="hf-notes" placeholder="Any details…">${esc(d.notes||"")}</textarea>
      </div>
      <div class="input-group" style="margin-bottom:16px">
        <label>Photo (optional)</label>
        <div style="display:flex;align-items:center;gap:10px">
          <button class="btn btn-primary btn-sm" type="button"
            onclick="document.getElementById(\'hf-photo\').click()">📷 Choose Photo</button>
          <span id="hf-photo-name" style="font-size:12px;color:var(--text-muted)">No file chosen</span>
        </div>
        <input type="file" id="hf-photo" accept="image/*" style="display:none"
          onchange="document.getElementById(\'hf-photo-name\').textContent=this.files[0]?.name||'No file chosen'" />
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" onclick="closeHarvestForm()">Cancel</button>
        <button class="btn btn-primary btn-sm" id="hf-submit-btn" onclick="saveHarvest()">
          ${editingHarvestId ? "Save Changes" : "Log It"}
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Populate dynamic fields based on saved species
  updateHarvestFields(d);
}

window.updateHarvestFields = function (existingData) {
  const species = document.getElementById("hf-species")?.value;
  const d       = existingData || {};
  const wrap    = document.getElementById("hf-dynamic-fields");
  if (!wrap) return;

  switch(species) {
    case "deer":
      wrap.innerHTML = `
        <div class="input-group" style="margin-bottom:12px">
          <label>Deer Type</label>
          <div style="display:flex;gap:8px">
            <label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;
                          background:rgba(255,255,255,0.05);border:1px solid var(--card-border);
                          border-radius:var(--radius-md);cursor:pointer">
              <input type="radio" name="deer-type" value="buck" ${d.deerType!=="doe"?"checked":""} onchange="updateDeerFields()" />
              <span>🦌 Buck</span>
            </label>
            <label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;
                          background:rgba(255,255,255,0.05);border:1px solid var(--card-border);
                          border-radius:var(--radius-md);cursor:pointer">
              <input type="radio" name="deer-type" value="doe" ${d.deerType==="doe"?"checked":""} onchange="updateDeerFields()" />
              <span>🦌 Doe</span>
            </label>
          </div>
        </div>
        <div class="input-group" style="margin-bottom:12px">
          <label>Weapon</label>
          <div style="display:flex;gap:8px">
            <label style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 12px;
                          background:rgba(255,255,255,0.05);border:1px solid var(--card-border);
                          border-radius:var(--radius-md);cursor:pointer;font-size:13px">
              <input type="radio" name="deer-weapon" value="firearm" ${d.weapon!=="archery"?"checked":""} />
              <span>🔫 Firearm</span>
            </label>
            <label style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 12px;
                          background:rgba(255,255,255,0.05);border:1px solid var(--card-border);
                          border-radius:var(--radius-md);cursor:pointer;font-size:13px">
              <input type="radio" name="deer-weapon" value="archery" ${d.weapon==="archery"?"checked":""} />
              <span>🏹 Archery</span>
            </label>
          </div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:4px">Firearm = gun or muzzleloader · Archery = bow or crossbow</div>
        </div>
        <div id="deer-buck-fields" style="${d.deerType==="doe"?"display:none":""}">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
            <div class="input-group">
              <label>Antler Points</label>
              <input type="number" id="hf-points" placeholder="8" value="${d.antlerPoints||""}" min="0" step="1" />
            </div>
            <div class="input-group">
              <label>Inside Spread (in)</label>
              <input type="number" id="hf-spread" placeholder='16"' value="${d.insideSpread||""}" min="0" step="0.25" />
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
            <div class="input-group">
              <label>Hanging Weight (lbs)*</label>
              <input type="number" id="hf-weight" placeholder="140" value="${d.weight||""}" min="0" step="0.1" />
            </div>
            <div class="input-group">
              <label>B&C Score (opt)</label>
              <input type="number" id="hf-score" placeholder='130"' value="${d.rackScore||""}" min="0" step="0.125" />
            </div>
          </div>
        </div>
        <div id="deer-doe-fields" style="${d.deerType==="doe"?"":"display:none"}">
          <div class="input-group" style="margin-bottom:12px">
            <label>Hanging Weight (lbs)</label>
            <input type="number" id="hf-weight" placeholder="90" value="${d.weight||""}" min="0" step="0.1" />
          </div>
        </div>`;
      break;

    case "turkey":
      wrap.innerHTML = `
        <div class="input-group" style="margin-bottom:12px">
          <label>Turkey Type</label>
          <div style="display:flex;gap:8px">
            ${["Tom","Jake","Hen"].map(t => `
              <label style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;
                            padding:9px 6px;background:rgba(255,255,255,0.05);
                            border:1px solid var(--card-border);border-radius:var(--radius-md);cursor:pointer;font-size:13px">
                <input type="radio" name="turkey-sex" value="${t.toLowerCase()}" ${(d.turkeySex||"tom")===t.toLowerCase()?"checked":""} />
                ${t}
              </label>`).join("")}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
          <div class="input-group">
            <label>Weight (lbs)</label>
            <input type="number" id="hf-weight" placeholder="20" value="${d.weight||""}" min="0" step="0.1" />
          </div>
          <div class="input-group">
            <label>Beard Length (in)</label>
            <input type="number" id="hf-beard" placeholder='9"' value="${d.beardLength||""}" min="0" step="0.25" />
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
          <div class="input-group">
            <label>Left Spur (in)</label>
            <input type="number" id="hf-spur-l" placeholder='1.5"' value="${d.spurLeft||""}" min="0" step="0.0625" />
          </div>
          <div class="input-group">
            <label>Right Spur (in)</label>
            <input type="number" id="hf-spur-r" placeholder='1.5"' value="${d.spurRight||""}" min="0" step="0.0625" />
          </div>
        </div>`;
      break;

    case "bear":
      wrap.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
          <div class="input-group">
            <label>Weight (lbs)</label>
            <input type="number" id="hf-weight" placeholder="200" value="${d.weight||""}" min="0" step="1" />
          </div>
          <div class="input-group">
            <label>Color Phase</label>
            <select id="hf-bear-color">
              ${["Black","Brown","Cinnamon","Blonde"].map(c =>
                `<option value="${c.toLowerCase()}" ${d.bearColor===c.toLowerCase()?"selected":""}>${c}</option>`
              ).join("")}
            </select>
          </div>
        </div>`;
      break;

    case "waterfowl":
      wrap.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
          <div class="input-group">
            <label>Sub-species</label>
            <select id="hf-waterfowl-type">
              ${["Duck","Goose","Teal","Diver","Merganser","Other"].map(t =>
                `<option value="${t.toLowerCase()}" ${d.waterfowlType===t.toLowerCase()?"selected":""}>${t}</option>`
              ).join("")}
            </select>
          </div>
          <div class="input-group">
            <label># Harvested</label>
            <input type="number" id="hf-quantity" placeholder="1" value="${d.quantity||1}" min="1" step="1" />
          </div>
        </div>`;
      break;

    case "smallgame":
      wrap.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
          <div class="input-group">
            <label>Sub-species</label>
            <select id="hf-smallgame-type">
              ${["Grouse","Pheasant","Rabbit","Squirrel","Woodcock","Other"].map(t =>
                `<option value="${t.toLowerCase()}" ${d.smallgameType===t.toLowerCase()?"selected":""}>${t}</option>`
              ).join("")}
            </select>
          </div>
          <div class="input-group">
            <label># Harvested</label>
            <input type="number" id="hf-quantity" placeholder="1" value="${d.quantity||1}" min="1" step="1" />
          </div>
        </div>`;
      break;

    default: // coyote, wolf, fox, other predators
      wrap.innerHTML = `
        <div class="input-group" style="margin-bottom:12px">
          <label>Weight (lbs, optional)</label>
          <input type="number" id="hf-weight" placeholder="30" value="${d.weight||""}" min="0" step="0.1" />
        </div>`;
      break;
  }
};

window.updateDeerFields = function () {
  const isDoe = document.querySelector('input[name="deer-type"]:checked')?.value === "doe";
  const buckFields = document.getElementById("deer-buck-fields");
  const doeFields  = document.getElementById("deer-doe-fields");
  if (buckFields) buckFields.style.display = isDoe ? "none" : "";
  if (doeFields)  doeFields.style.display  = isDoe ? "" : "none";
};

window.closeHarvestForm = function () {
  document.getElementById("harvest-form-overlay")?.remove();
};

window.saveHarvest = async function () {
  const species    = document.getElementById("hf-species")?.value;
  const dateVal    = document.getElementById("hf-date")?.value;
  const weight     = parseFloat(document.getElementById("hf-weight")?.value) || null;
  const rackScore  = parseFloat(document.getElementById("hf-score")?.value)  || null;
  const notes      = document.getElementById("hf-notes")?.value.trim() || "";
  const file       = document.getElementById("hf-photo")?.files?.[0] || null;
  const btn        = document.getElementById("hf-submit-btn");

  if (!species || !dateVal) { showToast("Species and date are required.", "error"); return; }
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

  try {
    let photoURL = editingHarvestId ? (harvestDetailData?.photoURL || null) : null;
    if (file) {
      if (btn) btn.textContent = "Compressing…";
      const compressed = await compressImage(file);
      if (btn) btn.textContent = "Uploading photo…";
      const storageRef = ref(storage, `harvests/${dateVal}/${userProfile.uid}_${Date.now()}.jpg`);
      await uploadBytes(storageRef, compressed, { contentType:"image/jpeg" });
      photoURL = await getDownloadURL(storageRef);
    }
    if (btn) btn.textContent = "Saving…";

    // Collect species-specific fields
    const deerType      = document.querySelector('input[name="deer-type"]:checked')?.value || null;
    const turkeySex     = document.querySelector('input[name="turkey-sex"]:checked')?.value || null;
    const antlerPoints  = parseFloat(document.getElementById("hf-points")?.value)    || null;
    const insideSpread  = parseFloat(document.getElementById("hf-spread")?.value)    || null;
    const rackScore     = parseFloat(document.getElementById("hf-score")?.value)     || null;
    const beardLength   = parseFloat(document.getElementById("hf-beard")?.value)     || null;
    const spurLeft      = parseFloat(document.getElementById("hf-spur-l")?.value)    || null;
    const spurRight     = parseFloat(document.getElementById("hf-spur-r")?.value)    || null;
    const bearColor     = document.getElementById("hf-bear-color")?.value            || null;
    const waterfowlType = document.getElementById("hf-waterfowl-type")?.value        || null;
    const smallgameType = document.getElementById("hf-smallgame-type")?.value        || null;
    const quantity      = parseInt(document.getElementById("hf-quantity")?.value)    || 1;
    const weapon        = document.querySelector('input[name="deer-weapon"]:checked')?.value || (species === "deer" ? "firearm" : null);

    // Editing (including an admin editing someone else's harvest) must keep the
    // ORIGINAL owner's identity — never reassign the trophy to whoever clicked Save.
    const owner = editingHarvestId && harvestDetailData ? harvestDetailData : userProfile;

    const payload = {
      species, notes, weight, photoURL, weapon,
      deerType, turkeySex, antlerPoints, insideSpread, rackScore,
      beardLength, spurLeft, spurRight, bearColor,
      waterfowlType, smallgameType, quantity,
      harvestDate:      Timestamp.fromDate(new Date(dateVal + "T12:00:00")),
      memberName:       owner.memberName ?? owner.displayName,
      uid:              owner.uid,
      uploaderColor:    owner.uploaderColor ?? owner.color,
      uploaderInitials: owner.uploaderInitials ?? owner.initials,
      updatedAt:        serverTimestamp()
    };

    trophyCache = null;   // stats need a recompute next time the Trophy Room opens

    if (editingHarvestId) {
      await updateDoc(doc(db, "harvests", editingHarvestId), payload);
      closeHarvestForm();
      showToast("Harvest updated!", "success");
      expandedHarvests.add(editingHarvestId);
    } else {
      payload.createdAt = serverTimestamp();
      payload.reactions = {};
      payload.comments  = [];
      const newDoc = await addDoc(collection(db, "harvests"), payload);
      closeHarvestForm();
      expandedHarvests.add(newDoc.id);
      trophyAddedPrompt();
      // Record kill points + post to feed
      await recordKill(payload);
      await postAutoFeedEvent("harvest", {
        memberName:   userProfile.displayName,
        speciesIcon:  speciesInfo(payload.species).icon,
        speciesLabel: speciesInfo(payload.species).label,
        uid:          userProfile.uid,
        harvestId:    newDoc.id
      });
    }
  } catch(err) {
    console.error(err);
    showToast("Could not save: " + err.message, "error");
    if (btn) { btn.disabled = false; btn.textContent = editingHarvestId ? "Save Changes" : "Log It"; }
  }
};

// Shown right after a new harvest is logged — the trophy landed, here's where it lives.
function trophyAddedPrompt() {
  document.getElementById("trophy-added-overlay")?.remove();
  const ov = document.createElement("div");
  ov.className = "modal-overlay"; ov.id = "trophy-added-overlay";
  ov.innerHTML = `
    <div class="modal-box" style="max-width:300px;text-align:center">
      <div style="font-size:42px;margin-bottom:8px">🏆</div>
      <div style="font-family:var(--font-serif);font-size:19px;color:var(--gold);margin-bottom:4px">Trophy added</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:18px">It's on the board and in your stats.</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn btn-primary btn-full btn-sm"
          onclick="document.getElementById('trophy-added-overlay').remove();goTo('screen-mykills')">
          See it in My Trophy Room
        </button>
        <button class="btn btn-secondary btn-full btn-sm"
          onclick="document.getElementById('trophy-added-overlay').remove()">Done</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
}

window.deleteHarvest = function (id) {
  appConfirm("Delete Harvest", "Permanently delete this harvest? This will also remove the feed notification and adjust your kill points.", async () => {
    try {
      trophyCache = null;
      // Get harvest data before deleting
      const snap = await getDoc(doc(db, "harvests", id));
      const hData = snap.data();

      // Delete harvest + its photo
      await deleteDoc(doc(db, "harvests", id));
      await deleteStoredImage(hData?.photoURL);
      expandedHarvests.delete(id);

      // Subtract kill points from the HARVEST'S OWNER — not whoever clicked delete
      // (an admin can delete another member's harvest; don't touch the admin's own stats).
      if (hData?.uid) {
        const userRef  = doc(db, "users", hData.uid);
        const userSnap = await getDoc(userRef);
        const userData = userSnap.data() || {};
        let pts = computeKillPoints(hData);
        const newPts   = Math.max(0, (userData.killPoints  || 0) - pts);
        const newKills = Math.max(0, (userData.totalKills  || 0) - 1);
        await updateDoc(userRef, { killPoints: newPts, totalKills: newKills });
        if (hData.uid === userProfile?.uid) updateKillCounter();
      }

      // Delete the ONE auto feed post tied to this harvest (older posts written
      // before harvestId existed simply stay — better than nuking them all).
      try {
        const feedSnap = await getDocs(query(collection(db, "feed"),
          where("type", "==", "harvest"),
          where("data.harvestId", "==", id),
          limit(5)));
        await Promise.all(feedSnap.docs.map(d => deleteDoc(doc(db, "feed", d.id))));
      } catch (e) { console.error("Feed cleanup:", e); }

      showToast("Harvest deleted.", "success");
    } catch(err) { console.error(err); showToast("Could not delete.", "error"); }
  });
};

function computeKillPoints(hData) {
  const sp = hData.species;
  if (sp === "deer") return hData.deerType === "buck" ? KILL_POINTS.deer_buck : KILL_POINTS.deer_doe;
  if (sp === "turkey") return (hData.turkeySex === "tom") ? KILL_POINTS.turkey_tom : KILL_POINTS.turkey_jake;
  if (sp === "bear")      return KILL_POINTS.bear;
  if (sp === "waterfowl") return KILL_POINTS.waterfowl * (hData.quantity || 1);
  if (sp === "smallgame") return KILL_POINTS.smallgame * (hData.quantity || 1);
  if (sp === "coyote")    return KILL_POINTS.coyote;
  if (sp === "wolf")      return KILL_POINTS.wolf;
  if (sp === "fox")       return KILL_POINTS.fox;
  return KILL_POINTS.other || 2;
}

// ============================================================
// IMAGE COMPRESSION — resize before upload for fast seamless uploads
// ============================================================
function compressImage(file, maxWidth = 1600, maxHeight = 1600, quality = 0.82) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    // If anything goes wrong reading/decoding, fall back to the original file
    // so an upload can never hang forever on a stuck promise.
    reader.onerror = () => resolve(file);
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => resolve(file);
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = img;

        // Scale down if needed
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width  = Math.round(width  * ratio);
          height = Math.round(height * ratio);
        }

        canvas.width  = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => resolve(blob || file),
          "image/jpeg",
          quality
        );
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}



// ── Render Harvest List ──────────────────────────────────────

// ============================================================
// TRAIL CAM — Collapsible album rows + lightbox
// ============================================================

let trailCamUnsub  = null;
let trailCamDetail = null;
let tcExpandedRows  = new Set();

// ── Navigate ─────────────────────────────────────────────────
window.goTrailCam = function () {
  showScreen("screen-trailcam");
  renderTrailCamScreen();
};

// ── Inject styles once ───────────────────────────────────────
(function injectTcStyles() {
  if (document.getElementById("tc-styles")) return;
  const style = document.createElement("style");
  style.id = "tc-styles";
  style.textContent = `
    .tc-row-header { display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--forest-card);border:1px solid var(--card-border);border-radius:var(--radius-lg);cursor:pointer;transition:border-color 0.2s,background 0.2s;width:100%;text-align:left;font-family:var(--font-sans);margin-bottom:8px; }
    .tc-row-header:hover { border-color:var(--gold-dim); }
    .tc-row-header.expanded { border-color:var(--gold-dim);border-bottom-left-radius:0;border-bottom-right-radius:0;margin-bottom:0; }
    .tc-carousel { display:flex;gap:10px;padding:10px 12px 12px;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none;background:rgba(14,10,4,0.9);border:1px solid var(--gold-dim);border-top:none;border-bottom-left-radius:var(--radius-lg);border-bottom-right-radius:var(--radius-lg);margin-bottom:10px; }
    .tc-card { flex:0 0 150px;scroll-snap-align:start;cursor:pointer;border-radius:var(--radius-md);overflow:hidden;border:1px solid var(--card-border);background:var(--forest-card);transition:transform 0.2s,border-color 0.2s; }
    .tc-card:hover { transform:scale(1.03);border-color:var(--gold-dim); }
  `;
  document.head.appendChild(style);
})();

// ── Main Screen ──────────────────────────────────────────────
window.renderTrailCamScreen = function () {
  const content = document.getElementById("trailcam-content");
  content.innerHTML = `
    <div style="padding:14px 16px 4px"></div>
    <div id="trailcam-feed" style="padding:0 16px 80px">
      <div style="text-align:center;padding:40px;color:var(--text-muted)">
        <div class="spinner" style="margin:0 auto 12px"></div>Loading photos…
      </div>
    </div>
  `;
  loadTrailCamFeed();
};

// ── Load Feed ────────────────────────────────────────────────
function loadTrailCamFeed() {
  if (trailCamUnsub) { trailCamUnsub(); trailCamUnsub = null; }
  const feed = document.getElementById("trailcam-feed");
  if (!feed) return;
  const q = query(collection(db, "trailcam"), orderBy("createdAt", "desc"));
  trailCamUnsub = onSnapshot(q, (snap) => {
    window._tcLastSnap = snap;
    renderTcFeed(snap);
  }, err => {
    console.error(err);
    const f = document.getElementById("trailcam-feed");
    if (f) f.innerHTML = `<div style="color:var(--danger);padding:16px;font-size:13px">Could not load trail cam photos.</div>`;
  });
}

function renderTcFeed(snap) {
  const feed = document.getElementById("trailcam-feed");
  if (!feed || !snap) return;
  const docs = snap.docs;
  if (docs.length === 0) {
    feed.innerHTML = `<div style="text-align:center;padding:60px 24px;color:var(--text-muted)"><div style="font-size:48px;margin-bottom:14px">📷</div><div>No photos yet — tap + to upload</div></div>`;
    return;
  }
  const grouped = {}; const order = [];
  docs.forEach(d => {
    const data = d.data();
    const created = data.createdAt?.toDate ? data.createdAt.toDate() : new Date();
    const key = data.albumId || data.batchId || (data.uid + "_" + created.toDateString());
    if (!grouped[key]) {
      const albumLabel = data.albumName
        ? (data.albumName + " (" + (data.dateLabel || created.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})) + ")")
        : (data.batchLabel || (data.uploaderName + " · " + created.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})));
      grouped[key] = { ts:created.getTime(), label:albumLabel, uploader:data.uploaderName||"Unknown", initials:data.uploaderInitials||"?", color:data.uploaderColor||"#556B2F", photos:[] };
      order.push(key);
    }
    grouped[key].photos.push({ id:d.id, ...data });
  });
  const sortedKeys = [...new Set(order)].sort((a,b) => grouped[b].ts - grouped[a].ts);
  feed.innerHTML = sortedKeys.map(key => {
    const group = grouped[key];
    const isExp = tcExpandedRows.has(key);
    return `<div style="margin-bottom:${isExp?"0":"10px"}">
      <button class="tc-row-header ${isExp?"expanded":""}" onclick="toggleTcRow('${key}')">
        <div class="avatar" style="background:${safeColor(group.color)};width:34px;height:34px;font-size:12px;flex-shrink:0">${esc(group.initials)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:600;color:var(--text-warm);overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(group.label)}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap">
            <span style="font-size:11px;color:var(--text-dim)">${group.photos.length} photo${group.photos.length!==1?"s":""}</span>
          </div>
        </div>
        <span style="color:var(--gold);font-size:18px;flex-shrink:0;transition:transform 0.2s;${isExp?"transform:rotate(90deg)":""}">›</span>
      </button>
      ${isExp ? `<div class="tc-carousel">${group.photos.map(tc=>tcCard(tc)).join("")}</div>` : ""}
    </div>`;
  }).join("");
}

window.toggleTcRow = function (key) {
  if (tcExpandedRows.has(key)) tcExpandedRows.delete(key);
  else tcExpandedRows.add(key);
  renderTcFeed(window._tcLastSnap);
};

function tcCard(tc) {
  return `<div class="tc-card" onclick="openTcLightbox('${tc.id}')">
    <img src="${esc(tc.photoURL || "")}" style="width:150px;height:180px;object-fit:cover;display:block" />
    <div style="padding:7px 9px">
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:2px">
        <div class="avatar" style="background:${safeColor(tc.uploaderColor)};width:20px;height:20px;font-size:9px;flex-shrink:0">${esc(tc.uploaderInitials||"?")}</div>
        <div style="font-size:11px;font-weight:600;color:var(--text-warm);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;flex:1">${esc(tc.uploaderName||"Unknown")}</div>
      </div>
      ${tc.caption?`<div style="font-size:10px;color:var(--text-muted);margin-top:2px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(tc.caption)}</div>`:""}
    </div>
  </div>`;
}

// ── Lightbox ─────────────────────────────────────────────────
window.openTcLightbox = async function (id) {
  const lb = document.createElement("div");
  lb.id = "tc-lightbox";
  lb.style.cssText = "position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,0.97);display:flex;flex-direction:column;animation:fadeIn 0.2s ease;";
  lb.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--gold-dim);background:rgba(8,10,4,0.98);flex-shrink:0">
      <div style="font-family:var(--font-serif);font-size:16px;color:var(--gold)">Trail Cam</div>
      <button onclick="closeTcLightbox()" style="background:rgba(255,255,255,0.1);border:1px solid var(--card-border);color:var(--text-warm);width:34px;height:34px;border-radius:50%;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:var(--font-sans)">✕</button>
    </div>
    <div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch" id="tc-lb-body">
      <div style="display:flex;align-items:center;justify-content:center;height:300px"><div class="spinner"></div></div>
    </div>`;
  document.body.appendChild(lb);
  try {
    const snap = await getDoc(doc(db, "trailcam", id));
    if (!snap.exists()) { closeTcLightbox(); showToast("Photo not found.","error"); return; }
    trailCamDetail = { id, ...snap.data() };
    renderTcLightboxBody(trailCamDetail);
  } catch(err) { console.error(err); closeTcLightbox(); showToast("Could not load photo.","error"); }
};

function renderTcLightboxBody(tc) {
  const id = tc.id;
  const dateStr = formatDate(tc.capturedAt);
  const isOwner = userProfile && (userProfile.uid===tc.uid || userProfile.role==="admin");
  const reactions = tc.reactions||{};
  const body = document.getElementById("tc-lb-body");
  if (!body) return;
  body.innerHTML = `
    <img src="${esc(tc.photoURL || "")}" style="width:100%;display:block;max-height:55vh;object-fit:contain;background:#000" />
    <div style="padding:14px 16px;background:rgba(8,10,4,0.98)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div class="avatar" style="background:${safeColor(tc.uploaderColor)};width:34px;height:34px;font-size:12px">${esc(tc.uploaderInitials||"?")}</div>
        <div><div style="font-weight:600;font-size:14px">${esc(tc.uploaderName||"Unknown")}</div><div style="font-size:12px;color:var(--text-muted)">${dateStr}</div></div>
      </div>
      ${tc.caption?`<div style="font-size:14px;color:var(--text-muted);line-height:1.5;margin-bottom:12px;white-space:pre-wrap;word-break:break-word">${esc(tc.caption)}</div>`:""}
      <div class="fade-divider-plain" style="margin:0 0 12px"></div>
      <div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px" id="tc-lb-reactions">${renderReactionBadges(reactions,id,"trailcam")}</div>
      ${userProfile?`<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">${REACTIONS_LIST.map(e=>`<button onclick="addTcReaction('${id}','${e}')" style="background:rgba(255,255,255,0.07);border:1px solid var(--card-border);border-radius:20px;padding:5px 10px;font-size:15px;cursor:pointer;transition:all 0.2s;font-family:var(--font-sans)">${e}</button>`).join("")}</div>`:""}
      <div class="fade-divider-plain" style="margin:0 0 12px"></div>
      <div id="tc-lb-comments">${renderComments(tc.comments||[],id,"trailcam")}</div>
      ${userProfile?`<div style="display:flex;gap:8px;margin-top:12px"><input type="text" id="tc-lb-comment-input" placeholder="Add a comment…" style="flex:1" onkeydown="if(event.key==='Enter')submitTcComment('${id}')" /><button class="btn btn-primary btn-sm" onclick="submitTcComment('${id}')">Post</button></div>`:""}
      ${isOwner?`<div style="margin-top:14px"><button class="btn btn-danger btn-full btn-sm" onclick="deleteTcPhoto('${id}')">🗑 Delete Photo</button></div>`:""}
      <div style="height:32px"></div>
    </div>`;
}

// ── Lightbox helpers ─────────────────────────────────────────
window.closeTcLightbox = function () {
  document.getElementById("tc-lightbox")?.remove();
  trailCamDetail = null;
};

window.addTcReaction = async function (id, emoji) {
  await addReaction(id, "trailcam", emoji);
  const snap = await getDoc(doc(db, "trailcam", id));
  const el   = document.getElementById("tc-lb-reactions");
  if (el) el.innerHTML = renderReactionBadges(snap.data()?.reactions || {}, id, "trailcam");
};

window.submitTcComment = async function (id) {
  if (!userProfile) return;
  const input = document.getElementById("tc-lb-comment-input");
  const text  = input?.value.trim();
  if (!text) return;
  try {
    const ref2     = doc(db, "trailcam", id);
    const snap     = await getDoc(ref2);
    const comments = snap.data()?.comments || [];
    comments.push({
      uid: userProfile.uid, name: userProfile.displayName,
      initials: userProfile.initials, color: userProfile.color,
      text, createdAt: Date.now()
    });
    await updateDoc(ref2, { comments });
    if (input) input.value = "";
    const fresh = await getDoc(ref2);
    const wrap  = document.getElementById("tc-lb-comments");
    if (wrap) wrap.innerHTML = renderComments(fresh.data()?.comments || [], id, "trailcam");
    showToast("Comment posted!", "success");
  } catch (err) { console.error(err); showToast("Could not post comment.", "error"); }
};

window.deleteTcPhoto = function (id) {
  appConfirm("Delete Photo", "Permanently delete this trail cam photo?", async () => {
    try {
      const photoURL = (trailCamDetail && trailCamDetail.id === id ? trailCamDetail.photoURL : null)
        || (await getDoc(doc(db, "trailcam", id))).data()?.photoURL;
      await deleteDoc(doc(db, "trailcam", id));
      await deleteStoredImage(photoURL);
      closeTcLightbox();
      showToast("Photo deleted.", "success");
    } catch (err) { console.error(err); showToast("Could not delete.", "error"); }
  });
};


// ── Checkout functions ───────────────────────────────────────
window.doCheckout = function () {
  const ov1 = document.createElement("div");
  ov1.className = "modal-overlay"; ov1.id = "checkout-confirm-overlay";
  ov1.innerHTML = `
    <div class="modal-box" style="max-width:320px;text-align:center">
      <div style="font-size:36px;margin-bottom:10px">🚪</div>
      <div style="font-family:var(--font-serif);font-size:18px;color:var(--gold);margin-bottom:8px">Leave the Cabin?</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:20px;line-height:1.5">Are you sure you want to leave?</div>
      <div style="display:flex;gap:10px">
        <button onclick="window.goodChoice()"
          style="flex:1;padding:12px;border:1px solid var(--card-border);border-radius:var(--radius-md);
                 background:rgba(255,255,255,0.06);color:var(--text-warm);font-size:14px;
                 font-weight:600;cursor:pointer;font-family:var(--font-sans)">No</button>
        <button onclick="window.confirmCheckout()"
          style="flex:1;padding:12px;border:none;border-radius:var(--radius-md);
                 background:linear-gradient(135deg,var(--orange),var(--orange-bright));
                 color:#fff;font-size:14px;font-weight:600;cursor:pointer;
                 font-family:var(--font-sans);box-shadow:0 3px 10px rgba(212,98,42,0.4)">Yes</button>
      </div>
    </div>`;
  document.body.appendChild(ov1);
};

window.goodChoice = function () {
  document.getElementById("checkout-confirm-overlay")?.remove();
  const ov = document.createElement("div");
  ov.className = "modal-overlay"; ov.id = "good-choice-overlay";
  ov.innerHTML = `
    <div class="modal-box" style="max-width:280px;text-align:center">
      <div style="font-size:42px;margin-bottom:10px">🏕️</div>
      <div style="font-family:var(--font-serif);font-size:20px;color:var(--gold);margin-bottom:12px">Good choice.</div>
      <button onclick="document.getElementById('good-choice-overlay').remove()"
        style="padding:11px 32px;border:none;border-radius:var(--radius-md);
               background:linear-gradient(135deg,var(--orange),var(--orange-bright));
               color:#fff;font-size:14px;font-weight:700;cursor:pointer;
               font-family:var(--font-sans)">OK</button>
    </div>`;
  document.body.appendChild(ov);
};

window.confirmCheckout = function () {
  document.getElementById("checkout-confirm-overlay")?.remove();
  const ov2 = document.createElement("div");
  ov2.className = "modal-overlay"; ov2.id = "checkout-reminder-overlay";
  ov2.innerHTML = `
    <div class="modal-box" style="max-width:320px;text-align:center">
      <div style="font-size:36px;margin-bottom:10px">🧹</div>
      <div style="font-family:var(--font-serif);font-size:18px;color:var(--gold);margin-bottom:10px">Before You Go</div>
      <ul style="font-size:12px;color:var(--text-muted);text-align:left;padding-left:18px;margin-bottom:20px;line-height:1.8">
        <li>Dishes washed and put away</li>
        <li>Trash taken out</li>
        <li>Lights and heat turned off</li>
        <li>Doors and windows locked</li>
        <li>Leave it better than you found it</li>
      </ul>
      <button onclick="window.finishCheckout()"
        style="width:100%;padding:13px;border:none;border-radius:var(--radius-md);
               background:linear-gradient(135deg,var(--orange),var(--orange-bright));
               color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:var(--font-sans)">
        Got It — Safe Travels 🤙
      </button>
    </div>`;
  document.body.appendChild(ov2);
};

window.finishCheckout = async function () {
  document.getElementById("checkout-reminder-overlay")?.remove();
  try {
    await updateDoc(doc(db, "users", userProfile.uid), { isCheckedIn: false });
    await postAutoFeedEvent("checkout", {
      memberName: userProfile.displayName,
      uid: userProfile.uid,
      initials: userProfile.initials,
      color: userProfile.color
    });
    showToast("Safe travels! 🤙", "success");
    renderCheckinButton();
  } catch(err) { console.error(err); showToast("Could not check out.", "error"); }
};


// Compare state
let _cmpHarvestPhoto = null;
let _cmpAllDocs      = [];
let _cmpUsers        = {};
let _cmpSelectedUser = null;
let _cmpSelectedPhoto = null;

window.openHarvestCompare = async function (harvestId) {
  showScreen("screen-harvest-compare");
  const el = document.getElementById("harvest-compare-content");
  if (!el) return;

  el.innerHTML = `<div style="padding:32px;text-align:center">
    <div class="spinner" style="margin:0 auto 12px"></div>
    <div style="color:var(--text-muted)">Loading…</div>
  </div>`;

  // Reset state
  _cmpSelectedUser  = null;
  _cmpSelectedPhoto = null;
  _cmpHarvestPhoto  = null;

  try {
    // Get harvest photo
    let hData = null;
    if (lastHarvestSnap) {
      const hd = lastHarvestSnap.docs.find(d => d.id === harvestId);
      if (hd) hData = hd.data();
    }
    if (!hData) {
      const hs = await getDoc(doc(db, "harvests", harvestId));
      if (hs.exists()) hData = hs.data();
    }
    _cmpHarvestPhoto = hData?.photoURL || null;

    // Load all trail cam docs
    const snap = await getDocs(query(collection(db, "trailcam"), orderBy("capturedAt","desc")));
    _cmpAllDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Build user list from docs
    _cmpUsers = {};
    _cmpAllDocs.forEach(d => {
      if (d.uid && !_cmpUsers[d.uid]) {
        _cmpUsers[d.uid] = { uid: d.uid, name: d.uploaderName || "Unknown", color: d.uploaderColor || "#556B2F", initials: d.uploaderInitials || "?" };
      }
    });

    renderCompareScreen(el);
  } catch(err) {
    console.error(err);
    el.innerHTML = `<div style="padding:32px;text-align:center;color:var(--danger)">Could not load. Try again.</div>`;
  }
};

function renderCompareScreen(el) {
  const userList = Object.values(_cmpUsers);

  el.innerHTML = `
    <div style="padding:16px;display:flex;flex-direction:column;gap:14px;padding-bottom:80px">

      <!-- Harvest photo -->
      <div>
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;
                    letter-spacing:0.5px;margin-bottom:8px">Your Harvest Photo</div>
        ${_cmpHarvestPhoto
          ? `<img src="${esc(_cmpHarvestPhoto)}"
               style="width:100%;max-height:220px;object-fit:cover;
                      border-radius:var(--radius-lg);border:2px solid var(--gold-dim)" />`
          : `<div style="height:80px;display:flex;align-items:center;justify-content:center;
                          color:var(--text-dim);font-size:13px;border:1px dashed var(--card-border);
                          border-radius:var(--radius-lg)">No harvest photo on file</div>`}
      </div>

      <!-- Selected trail cam photo appears here -->
      <div id="cmp-selected-wrap" style="display:none">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;
                    letter-spacing:0.5px;margin-bottom:8px">Trail Cam Comparison</div>
        <img id="cmp-selected-img" src=""
          style="width:100%;max-height:220px;object-fit:cover;
                 border-radius:var(--radius-lg);border:2px solid var(--orange)" />
        <div id="cmp-selected-info"
          style="font-size:12px;color:var(--text-muted);margin-top:6px;text-align:center"></div>
      </div>

      <div class="fade-divider-plain"></div>

      <!-- Step 1: Pick a user -->
      <div>
        <button class="tc-row-header" id="cmp-user-toggle" onclick="toggleCmpSection('user')"
          style="margin-bottom:0">
          <div style="flex:1;text-align:left">
            <div style="font-size:14px;font-weight:600;color:var(--text-warm)">
              Step 1 — Choose a Member's Camera
            </div>
            <div id="cmp-user-sub" style="font-size:12px;color:var(--text-muted)">
              ${_cmpSelectedUser ? esc(_cmpUsers[_cmpSelectedUser]?.name) : "Tap to select"}
            </div>
          </div>
          <span id="cmp-user-arrow" style="color:var(--gold);font-size:18px;transition:transform 0.2s">›</span>
        </button>
        <div id="cmp-user-panel" class="hidden"
          style="background:rgba(14,10,4,0.92);border:1px solid var(--gold-dim);
                 border-top:none;border-bottom-left-radius:var(--radius-lg);
                 border-bottom-right-radius:var(--radius-lg);padding:12px">
          <div style="display:flex;flex-direction:column;gap:8px">
            ${userList.length === 0
              ? `<div style="color:var(--text-muted);font-size:13px;font-style:italic">No trail cam photos uploaded yet.</div>`
              : userList.map(u => `
                  <button onclick="selectCmpUser('${u.uid}')"
                    style="display:flex;align-items:center;gap:12px;padding:10px 12px;
                           background:${_cmpSelectedUser===u.uid ? "rgba(212,98,42,0.2)" : "rgba(255,255,255,0.04)"};
                           border:1px solid ${_cmpSelectedUser===u.uid ? "var(--orange)" : "var(--card-border)"};
                           border-radius:var(--radius-md);cursor:pointer;width:100%;text-align:left">
                    <div class="avatar" style="background:${safeColor(u.color)};width:32px;height:32px;font-size:11px;flex-shrink:0">
                      ${esc(u.initials)}
                    </div>
                    <span style="font-size:14px;color:var(--text-warm);font-weight:600">${esc(u.name)}</span>
                    ${_cmpSelectedUser===u.uid ? `<span style="margin-left:auto;color:var(--orange);font-size:16px">✓</span>` : ""}
                  </button>`).join("")}
          </div>
        </div>
      </div>

      <!-- Step 2: Pick a photo (Netflix carousel by batch) -->
      <div id="cmp-photos-section" style="${_cmpSelectedUser ? "" : "opacity:0.4;pointer-events:none"}">
        <button class="tc-row-header" id="cmp-photo-toggle" onclick="toggleCmpSection('photo')"
          style="margin-bottom:0">
          <div style="flex:1;text-align:left">
            <div style="font-size:14px;font-weight:600;color:var(--text-warm)">
              Step 2 — Browse Photos
            </div>
            <div style="font-size:12px;color:var(--text-muted)">
              ${_cmpSelectedUser ? "Tap to browse" : "Select a member first"}
            </div>
          </div>
          <span id="cmp-photo-arrow" style="color:var(--gold);font-size:18px;transition:transform 0.2s">›</span>
        </button>
        <div id="cmp-photo-panel" class="hidden"
          style="background:rgba(14,10,4,0.92);border:1px solid var(--gold-dim);
                 border-top:none;border-bottom-left-radius:var(--radius-lg);
                 border-bottom-right-radius:var(--radius-lg);padding:14px">
          <div id="cmp-photo-inner">
            <div style="color:var(--text-muted);font-size:13px;font-style:italic">Select a member first.</div>
          </div>
        </div>
      </div>

    </div>
  `;
}

window.toggleCmpSection = function(section) {
  const panel = document.getElementById("cmp-" + section + "-panel");
  const arrow = document.getElementById("cmp-" + section + "-arrow");
  const header = document.getElementById("cmp-" + section + "-toggle");
  if (!panel) return;
  const opening = panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !opening);
  if (arrow)  arrow.style.transform = opening ? "rotate(90deg)" : "";
  if (header) header.classList.toggle("expanded", opening);
};

window.selectCmpUser = function(uid) {
  _cmpSelectedUser = uid;
  // Close user panel, open photo panel, re-render
  const el = document.getElementById("harvest-compare-content");
  if (!el) return;
  renderCompareScreen(el);
  // Auto-open photos section
  setTimeout(() => {
    const panel = document.getElementById("cmp-photo-panel");
    const arrow = document.getElementById("cmp-photo-arrow");
    if (panel) panel.classList.remove("hidden");
    if (arrow) arrow.style.transform = "rotate(90deg)";
    renderCmpPhotoCarousel();
  }, 50);
};

function renderCmpPhotoCarousel() {
  const inner = document.getElementById("cmp-photo-inner");
  if (!inner || !_cmpSelectedUser) return;

  const userDocs = _cmpAllDocs.filter(d => d.uid === _cmpSelectedUser);

  if (userDocs.length === 0) {
    inner.innerHTML = `<div style="color:var(--text-muted);font-size:13px;font-style:italic">No photos from this member.</div>`;
    return;
  }

  // Group by album
  const albums = {};
  userDocs.forEach(d => {
    const key   = d.albumId   || d.batchId || "unorganized";
    const label = d.albumName || d.batchLabel || formatDate(d.capturedAt) || "Unorganized";
    if (!albums[key]) albums[key] = { label, docs: [] };
    albums[key].docs.push(d);
  });

  inner.innerHTML = Object.entries(albums).map(([albumId, album]) => `
    <div style="margin-bottom:20px">
      <!-- Album header -->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:14px">📂</span>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--gold)">${esc(album.label)}</div>
          <div style="font-size:11px;color:var(--text-muted)">${album.docs.length} photo${album.docs.length!==1?"s":""}</div>
        </div>
      </div>
      <!-- Horizontal carousel -->
      <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:8px;
                  scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;
                  scrollbar-width:none;-ms-overflow-style:none">
        ${album.docs.map(tc => {
          const isSelected = _cmpSelectedPhoto === tc.id;
          return `
            <div onclick="selectCmpPhoto('${tc.id}')"
              style="flex-shrink:0;width:120px;scroll-snap-align:start;cursor:pointer;
                     border-radius:var(--radius-md);overflow:hidden;position:relative;
                     border:2px solid ${isSelected ? "var(--orange)" : "var(--card-border)"};
                     transition:border-color 0.15s">
              <img src="${esc(tc.photoURL || "")}"
                style="width:120px;height:120px;object-fit:cover;display:block" />
              ${isSelected ? `<div style="position:absolute;top:4px;right:4px;
                background:var(--orange);border-radius:50%;width:22px;height:22px;
                display:flex;align-items:center;justify-content:center;
                font-size:12px;color:#fff;font-weight:700;
                box-shadow:0 2px 6px rgba(0,0,0,0.4)">✓</div>` : ""}
              <div style="position:absolute;bottom:0;left:0;right:0;height:36px;
                background:linear-gradient(transparent,rgba(0,0,0,0.6));
                font-size:10px;color:rgba(255,255,255,0.7);
                display:flex;align-items:flex-end;padding:4px 5px">
                ${formatDate(tc.capturedAt)}
              </div>
            </div>`;
        }).join("")}
      </div>
    </div>`).join("");
}

window.selectCmpPhoto = function(id) {
  _cmpSelectedPhoto = id;
  const tc = _cmpAllDocs.find(d => d.id === id) || {};

  // Show the selected photo
  const wrap = document.getElementById("cmp-selected-wrap");
  const img  = document.getElementById("cmp-selected-img");
  const info = document.getElementById("cmp-selected-info");
  if (wrap) wrap.style.display = "block";
  if (img)  img.src = tc.photoURL || "";
  if (info) info.textContent = (tc.uploaderName || "Unknown") + " · " + formatDate(tc.capturedAt);

  // Scroll to top to show comparison
  const el = document.getElementById("harvest-compare-content");
  if (el) el.closest(".screen")?.scrollTo({ top: 0, behavior: "smooth" });

  // Re-render carousel to show checkmark
  renderCmpPhotoCarousel();
};


async function archiveOldFeedPosts() {
  // Only admins run housekeeping, so we don't have every member's client
  // scanning the whole feed collection and racing to archive the same posts.
  if (userProfile?.role !== "admin") return;
  try {
    const allSnap = await getDocs(query(collection(db, "feed"), orderBy("createdAt", "desc")));
    if (allSnap.size <= 50) return;
    const toArchive = allSnap.docs.slice(50);
    for (const d of toArchive) {
      const data = d.data();
      await addDoc(collection(db, "feedArchive"), { ...data, archivedAt: serverTimestamp() });
      await deleteDoc(doc(db, "feed", d.id));
    }
  } catch(err) { console.error("Archive error:", err); }
}


// ============================================================
// TRAIL CAM UPLOAD — Album System
// ============================================================

window.openAddTrailCam = async function () {
  if (!userProfile) { showToast("Sign in to upload photos.", "error"); return; }

  let albums = [];
  try {
    // Filter by owner only, sort newest-first in JS (no composite index needed).
    const snap = await getDocs(query(
      collection(db, "trailcamAlbums"),
      where("uid", "==", userProfile.uid)
    ));
    albums = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : 0;
        const tb = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : 0;
        return tb - ta;
      });
  } catch(err) { console.error(err); albums = []; }

  window._tcSelectedFiles = [];
  window._tcAlbumId       = null;
  window._tcAlbumName     = null;
  window._tcAlbums        = albums;

  const today = new Date().toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" });

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "tc-upload-overlay";
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:380px;max-height:92vh;overflow-y:auto">
      <div class="modal-title">📷 Upload Trail Cam Photos</div>

      <div style="margin-bottom:16px">
        <div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;
                    letter-spacing:0.5px;margin-bottom:10px">Step 1 — Choose Album</div>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <button id="tc-btn-existing" onclick="tcAlbumMode('existing')"
            style="flex:1;padding:12px 8px;border-radius:var(--radius-md);
                   border:2px solid var(--card-border);background:rgba(255,255,255,0.04);
                   color:var(--text-warm);font-size:13px;font-weight:600;cursor:pointer;
                   font-family:var(--font-sans);transition:all 0.2s">
            📂 Add to Existing
          </button>
          <button id="tc-btn-new" onclick="tcAlbumMode('new')"
            style="flex:1;padding:12px 8px;border-radius:var(--radius-md);
                   border:2px solid var(--card-border);background:rgba(255,255,255,0.04);
                   color:var(--text-warm);font-size:13px;font-weight:600;cursor:pointer;
                   font-family:var(--font-sans);transition:all 0.2s">
            ➕ New Album
          </button>
        </div>

        <div id="tc-album-existing" style="display:none;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto">
          ${albums.length === 0
            ? '<div style="color:var(--text-dim);font-size:13px;font-style:italic;padding:8px">No albums yet — create your first one.</div>'
            : albums.map(a => `
                <button onclick="tcSelectAlbum('${a.id}')"
                  id="tc-album-btn-${a.id}"
                  style="display:flex;align-items:center;justify-content:space-between;
                         padding:10px 12px;border-radius:var(--radius-md);border:2px solid var(--card-border);
                         background:rgba(255,255,255,0.04);color:var(--text-warm);font-size:13px;
                         cursor:pointer;text-align:left;font-family:var(--font-sans);width:100%">
                  <div>
                    <div style="font-weight:600">${esc(a.name)}</div>
                    <div style="font-size:11px;color:var(--text-muted)">${esc(a.dateLabel||"")} · ${a.photoCount||0} photos</div>
                  </div>
                  <span id="tc-album-check-${a.id}" style="display:none;color:var(--orange);font-size:18px">✓</span>
                </button>`).join("")}
        </div>

        <div id="tc-album-new" style="display:none">
          <div class="input-group">
            <label>Album Name</label>
            <input type="text" id="tc-album-name-input"
              placeholder="e.g. North Stand, Food Plot Cam…" maxlength="48" />
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
            Date (${today}) will be added automatically
          </div>
        </div>

        <div id="tc-album-selected-label"
          style="display:none;margin-top:8px;font-size:13px;color:var(--orange);font-weight:600;text-align:center"></div>
      </div>

      <div class="fade-divider-plain" style="margin:0 0 14px"></div>

      <div style="margin-bottom:12px">
        <div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;
                    letter-spacing:0.5px;margin-bottom:10px">Step 2 — Choose Photos</div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <button class="btn btn-primary btn-sm" type="button"
            onclick="document.getElementById('tc-files-input').click()">📷 Choose Photos</button>
          <span id="tc-files-name" style="font-size:12px;color:var(--text-muted)">No files chosen</span>
        </div>
        <input type="file" id="tc-files-input" accept="image/*" multiple style="display:none"
          onchange="tcHandleFileSelect(this)" />
        <div id="tc-preview-wrap" style="display:flex;flex-wrap:wrap;gap:8px"></div>
      </div>

      <div class="input-group" style="margin-bottom:16px">
        <label>Date Captured</label>
        <input type="date" id="tc-date-input" value="${new Date().toISOString().split("T")[0]}" />
      </div>

      <div id="tc-upload-progress" class="hidden"
        style="font-size:13px;color:var(--text-muted);margin-bottom:12px;text-align:center"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" onclick="closeTcUpload()">Cancel</button>
        <button class="btn btn-primary btn-sm" id="tc-upload-btn" onclick="saveTcPhotos()">Upload</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
};

window.tcAlbumMode = function(mode) {
  const existingPanel = document.getElementById("tc-album-existing");
  const newPanel      = document.getElementById("tc-album-new");
  const btnE          = document.getElementById("tc-btn-existing");
  const btnN          = document.getElementById("tc-btn-new");
  const label         = document.getElementById("tc-album-selected-label");
  const activeStyle   = { border: "var(--orange)", bg: "rgba(212,98,42,0.15)" };
  const inactiveStyle = { border: "var(--card-border)", bg: "rgba(255,255,255,0.04)" };

  if (mode === "existing") {
    if (existingPanel) existingPanel.style.display = "flex";
    if (newPanel)      newPanel.style.display = "none";
    if (btnE) { btnE.style.borderColor = activeStyle.border; btnE.style.background = activeStyle.bg; }
    if (btnN) { btnN.style.borderColor = inactiveStyle.border; btnN.style.background = inactiveStyle.bg; }
    window._tcAlbumId = null; window._tcAlbumName = null;
    if (label) label.style.display = "none";
  } else {
    if (existingPanel) existingPanel.style.display = "none";
    if (newPanel)      newPanel.style.display = "block";
    if (btnN) { btnN.style.borderColor = activeStyle.border; btnN.style.background = activeStyle.bg; }
    if (btnE) { btnE.style.borderColor = inactiveStyle.border; btnE.style.background = inactiveStyle.bg; }
    window._tcAlbumId = "new"; window._tcAlbumName = null;
    if (label) label.style.display = "none";
  }
};

window.tcSelectAlbum = function(id, name, dateLabel) {
  if (name === undefined) {
    const a = (window._tcAlbums || []).find(x => x.id === id) || {};
    name = a.name || ""; dateLabel = a.dateLabel || "";
  }
  window._tcAlbumId   = id;
  window._tcAlbumName = name;
  document.querySelectorAll("[id^='tc-album-btn-']").forEach(b => {
    b.style.borderColor = "var(--card-border)"; b.style.background = "rgba(255,255,255,0.04)";
  });
  document.querySelectorAll("[id^='tc-album-check-']").forEach(c => c.style.display = "none");
  const btn = document.getElementById("tc-album-btn-" + id);
  const chk = document.getElementById("tc-album-check-" + id);
  if (btn) { btn.style.borderColor = "var(--orange)"; btn.style.background = "rgba(212,98,42,0.15)"; }
  if (chk) chk.style.display = "inline";
  const label = document.getElementById("tc-album-selected-label");
  if (label) { label.style.display = "block"; label.textContent = "📂 " + name + (dateLabel ? " (" + dateLabel + ")" : ""); }
};

window.tcHandleFileSelect = function(input) {
  const files   = Array.from(input.files || []);
  const nameEl  = document.getElementById("tc-files-name");
  const preview = document.getElementById("tc-preview-wrap");
  if (nameEl) nameEl.textContent = files.length > 1
    ? files.length + " photos selected"
    : (files[0]?.name || "No files chosen");
  window._tcSelectedFiles = files;
  if (!preview) return;
  preview.innerHTML = "";
  files.forEach((file, i) => {
    const url  = URL.createObjectURL(file);
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:relative;width:72px;height:72px;flex-shrink:0";
    wrap.innerHTML = `
      <img src="${url}" style="width:72px;height:72px;object-fit:cover;border-radius:var(--radius-sm);border:1px solid var(--card-border)" />
      <button onclick="tcRemoveFile(${i})"
        style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;
               background:var(--orange);border:none;color:#fff;font-size:12px;cursor:pointer;
               display:flex;align-items:center;justify-content:center;font-weight:700">✕</button>`;
    preview.appendChild(wrap);
  });
};

window.tcRemoveFile = function(index) {
  if (!window._tcSelectedFiles) return;
  window._tcSelectedFiles.splice(index, 1);
  const nameEl  = document.getElementById("tc-files-name");
  const preview = document.getElementById("tc-preview-wrap");
  const c = window._tcSelectedFiles.length;
  if (nameEl) nameEl.textContent = c === 0 ? "No files chosen" : c === 1
    ? window._tcSelectedFiles[0].name : c + " photos selected";
  if (preview) {
    preview.innerHTML = "";
    window._tcSelectedFiles.forEach((file, i) => {
      const url  = URL.createObjectURL(file);
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:relative;width:72px;height:72px;flex-shrink:0";
      wrap.innerHTML = `
        <img src="${url}" style="width:72px;height:72px;object-fit:cover;border-radius:var(--radius-sm);border:1px solid var(--card-border)" />
        <button onclick="tcRemoveFile(${i})"
          style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;
                 background:var(--orange);border:none;color:#fff;font-size:12px;cursor:pointer;
                 display:flex;align-items:center;justify-content:center;font-weight:700">✕</button>`;
      preview.appendChild(wrap);
    });
  }
};

window.closeTcUpload = function () {
  window._tcSelectedFiles = [];
  window._tcAlbumId       = null;
  window._tcAlbumName     = null;
  document.getElementById("tc-upload-overlay")?.remove();
};

window.saveTcPhotos = async function () {
  const files   = window._tcSelectedFiles || [];
  const dateVal = document.getElementById("tc-date-input")?.value;
  const progress = document.getElementById("tc-upload-progress");
  const btn      = document.getElementById("tc-upload-btn");

  if (!files.length) { showToast("Please select at least one photo.", "error"); return; }
  if (!dateVal)      { showToast("Please set the capture date.", "error"); return; }

  // Validate album selection
  let albumId   = window._tcAlbumId;
  let albumName = window._tcAlbumName;

  if (!albumId) { showToast("Please choose or create an album first.", "error"); return; }

  if (albumId === "new") {
    const nameInput = document.getElementById("tc-album-name-input")?.value.trim();
    if (!nameInput) { showToast("Please enter an album name.", "error"); return; }
    albumName = nameInput;
  }

  if (btn) { btn.disabled = true; btn.textContent = "Uploading…"; }
  if (progress) progress.classList.remove("hidden");

  const dateObj   = new Date(dateVal + "T12:00:00");
  const dateLabel = dateObj.toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" });

  // Create new album if needed
  if (albumId === "new") {
    try {
      const albumRef = await addDoc(collection(db, "trailcamAlbums"), {
        name:       albumName,
        dateLabel,
        uid:        userProfile.uid,
        ownerName:  userProfile.displayName,
        photoCount: 0,
        createdAt:  serverTimestamp(),
        updatedAt:  serverTimestamp()
      });
      albumId = albumRef.id;
    } catch(err) {
      console.error(err);
      showToast("Could not create album.", "error");
      if (btn) { btn.disabled = false; btn.textContent = "Upload"; }
      return;
    }
  }

  let uploaded = 0;
  const errors = [];

  for (const file of files) {
    try {
      if (progress) progress.textContent = "Uploading " + (uploaded+1) + " of " + files.length + "…";
      const compressed = await compressImage(file, 1200, 1200, 0.78);
      const path       = "trailcam/" + dateVal + "/" + userProfile.uid + "_" + Date.now() + "_" + Math.random().toString(36).slice(2) + ".jpg";
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, compressed, { contentType: "image/jpeg" });
      const photoURL = await getDownloadURL(storageRef);

      await addDoc(collection(db, "trailcam"), {
        photoURL,
        albumId,
        albumName,
        dateLabel,
        capturedAt:       Timestamp.fromDate(dateObj),
        uid:              userProfile.uid,
        uploaderName:     userProfile.displayName,
        uploaderInitials: userProfile.initials,
        uploaderColor:    userProfile.color,
        createdAt:        serverTimestamp(),
        reactions:        {},
        comments:         []
      });
      uploaded++;
    } catch(err) {
      console.error("Upload error:", err);
      errors.push(file.name);
    }
  }

  // Update album photo count + date
  if (uploaded > 0) {
    try {
      const albumSnap = await getDocs(query(
        collection(db, "trailcam"), where("albumId", "==", albumId)
      ));
      await updateDoc(doc(db, "trailcamAlbums", albumId), {
        photoCount: albumSnap.size,
        updatedAt:  serverTimestamp()
      });
    } catch(err) { console.error(err); }
  }

  closeTcUpload();

  if (errors.length) {
    showToast(uploaded + " uploaded, " + errors.length + " failed.", "error");
  } else {
    showToast(uploaded + " photo" + (uploaded !== 1 ? "s" : "") + " uploaded to " + albumName + "! 📷", "success");
    if (uploaded > 0) {
      await postAutoFeedEvent("trailcam", {
        memberName: userProfile.displayName,
        uid:        userProfile.uid,
        count:      uploaded
      });
    }
  }
};


// ============================================================
// CABIN CALENDAR
// ============================================================
let calCurrentYear  = new Date().getFullYear();
let calCurrentMonth = new Date().getMonth(); // 0-indexed
let calVisitDocs    = {};  // { "YYYY-MM-DD": [visits starting that day] }  — feeds the month list
let calVisitList    = [];  // flat list of every loaded visit — feeds multi-day grid coverage
let calUnsub        = null;

const CAL_MAX_SPAN = 21;  // longest stay you can log, in days

// local YYYY-MM-DD (matches the grid's dateStr, unlike toISOString which is UTC)
function calDayKey(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function visitStartDate(v) {
  const s = v.visitDate?.toDate ? v.visitDate.toDate() : new Date(v.visitDate || 0);
  return new Date(s.getFullYear(), s.getMonth(), s.getDate());
}
function visitSpan(v) { return Math.min(CAL_MAX_SPAN, Math.max(1, Number(v.spanDays) || 1)); }
// which day of the stay does `dateStr` fall on? 0-based, or -1 if outside the range
function visitDayOffset(v, dateStr) {
  const diff = Math.round((new Date(dateStr + "T00:00:00") - visitStartDate(v)) / 86400000);
  return (diff >= 0 && diff < visitSpan(v)) ? diff : -1;
}
function visitsOnDay(dateStr) { return calVisitList.filter(v => visitDayOffset(v, dateStr) >= 0); }
// "Sep 4" or "Sep 4 – 8" / "Sep 30 – Oct 3"
function visitRangeLabel(v) {
  const s = visitStartDate(v), span = visitSpan(v);
  const e = new Date(s); e.setDate(e.getDate() + span - 1);
  const fmt = dd => dd.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (span === 1) return fmt(s);
  return s.getMonth() === e.getMonth() ? `${fmt(s)} – ${e.getDate()}` : `${fmt(s)} – ${fmt(e)}`;
}

// Why someone's at camp — drives the icon on the calendar grid
const VISIT_PURPOSES = {
  hunting:  { label: "Hunting",       icon: "🎯", color: "#d4622a" },
  scouting: { label: "Scouting",      icon: "👀", color: "#6b8f3b" },
  work:     { label: "Work day",      icon: "🔨", color: "#b28a44" },
  family:   { label: "Family",        icon: "🏡", color: "#9b7bb0" },
  visiting: { label: "Just visiting", icon: "👋", color: "#5a8fa8" }
};
const DAY_PARTS = {
  morning:   { label: "Morning",   icon: "🌅" },
  evening:   { label: "Evening",   icon: "🌆" },
  allday:    { label: "All day",   icon: "☀️" },
  overnight: { label: "Overnight", icon: "🌙" }
};
function visitPurpose(v)  { return VISIT_PURPOSES[v && v.purpose] || null; }
function visitDayPart(v)  { return DAY_PARTS[v && v.dayPart] || null; }

// Approximate moon phase for a date — hunters read the moon, so show it.
function moonPhase(date) {
  const SYNODIC = 29.530588853;
  const knownNew = Date.UTC(2000, 0, 6, 18, 14) / 86400000;   // 2000-01-06 new moon
  const now = date.getTime() / 86400000;
  const frac = (((now - knownNew) % SYNODIC) + SYNODIC) % SYNODIC / SYNODIC;
  const table = [
    { name: "New moon",        icon: "🌑" },
    { name: "Waxing crescent", icon: "🌒" },
    { name: "First quarter",   icon: "🌓" },
    { name: "Waxing gibbous",  icon: "🌔" },
    { name: "Full moon",       icon: "🌕" },
    { name: "Waning gibbous",  icon: "🌖" },
    { name: "Last quarter",    icon: "🌗" },
    { name: "Waning crescent", icon: "🌘" }
  ];
  return table[Math.round(frac * 8) % 8];
}

// "Today" / "Tomorrow" / "In 5 days" / "3 weeks ago"
function relativeDayLabel(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0)  return "Today";
  if (diff === 1)  return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const ad = Math.abs(diff);
  if (ad <= 13)  return diff > 0 ? `In ${diff} days` : `${ad} days ago`;
  const wk = Math.round(ad / 7);
  return diff > 0 ? `In ${wk} week${wk !== 1 ? "s" : ""}` : `${wk} week${wk !== 1 ? "s" : ""} ago`;
}

// chip picker inside the day popup — single-select within a group
window.calPickChip = function (btn, group) {
  const wrap = btn.parentElement;
  wrap.querySelectorAll("button[data-" + group + "]").forEach(b => {
    const on = b === btn && !b.classList.contains("cal-chip-on");
    b.classList.toggle("cal-chip-on", on);
    b.style.background   = on ? "var(--gold)" : "rgba(255,255,255,0.05)";
    b.style.color        = on ? "#241206" : "var(--text-warm)";
    b.style.borderColor  = on ? "transparent" : "var(--card-border)";
    b.style.fontWeight   = on ? "700" : "500";
  });
};

// day-count stepper inside the day popup
window.calBumpSpan = function (delta) {
  const inp  = document.getElementById("cal-visit-span");
  const hint = document.getElementById("cal-span-hint");
  const ov   = document.getElementById("cal-day-overlay");
  if (!inp) return;
  const n = Math.min(CAL_MAX_SPAN, Math.max(1, (Number(inp.value) || 1) + delta));
  inp.value = n;
  if (!hint) return;
  if (n === 1) { hint.textContent = "Just this day"; return; }
  const s = new Date((ov?.dataset.date || "") + "T00:00:00");
  const e = new Date(s); e.setDate(e.getDate() + n - 1);
  const f = dd => dd.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  hint.textContent = `${n} days · ${f(s)} – ${s.getMonth() === e.getMonth() ? e.getDate() : f(e)}`;
};

window.goCalendar = function () {
  showScreen("screen-calendar");
  renderCalendarScreen();
};

window.renderCalendarScreen = async function () {
  const el = document.getElementById("calendar-content");
  if (!el) return;

  el.innerHTML = `<div style="padding:32px;text-align:center">
    <div class="spinner" style="margin:0 auto"></div>
  </div>`;

  // Load visits for current month
  await loadCalendarMonth(calCurrentYear, calCurrentMonth);
  renderCalendarGrid(el);
};

async function loadCalendarMonth(year, month) {
  if (calUnsub) { calUnsub(); calUnsub = null; }

  // widen the window back a few weeks so a multi-day stay that began in the
  // previous month still shows on this month's opening days
  const start = new Date(year, month, 1 - CAL_MAX_SPAN);
  const end   = new Date(year, month + 1, 0, 23, 59, 59);

  try {
    const snap = await getDocs(query(
      collection(db, "visits"),
      where("visitDate", ">=", Timestamp.fromDate(start)),
      where("visitDate", "<=", Timestamp.fromDate(end))
    ));

    calVisitDocs = {};
    calVisitList = [];
    snap.docs.forEach(d => {
      const data = { id: d.id, ...d.data() };
      calVisitList.push(data);
      const s = data.visitDate?.toDate ? data.visitDate.toDate() : new Date(data.visitDate);
      if (s.getFullYear() === year && s.getMonth() === month) {
        const key = calDayKey(s);
        (calVisitDocs[key] = calVisitDocs[key] || []).push(data);
      }
    });
  } catch(err) {
    console.error(err);
    calVisitDocs = {};
    calVisitList = [];
  }
}

const CAL_MONTHS = ["January","February","March","April","May","June",
                    "July","August","September","October","November","December"];
const CAL_DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// A day cell reads instinctively: your days get a gold ring, any day with
// activity gets a plain red dot — nothing fancier to parse at a glance.
function monthDayCell(dateStr, d, isToday, size) {
  const dayVisits = visitsOnDay(dateStr);
  const hasActivity = dayVisits.length > 0;
  const mineHere  = userProfile && dayVisits.some(v => v.uid === userProfile.uid);
  const border    = mineHere ? "var(--gold)" : isToday ? "var(--gold-dim)" : "rgba(237,226,200,0.10)";
  const baseBg    = isToday ? "rgba(196,169,106,0.10)" : "rgba(237,226,200,0.06)";
  const dotSize   = size === "sm" ? 5 : 6;
  return `
    <div onclick="openCalendarDay('${dateStr}')"
      style="position:relative;aspect-ratio:1;border-radius:var(--radius-md);cursor:pointer;
             background:${baseBg};border:1px solid ${border};min-height:${size === "sm" ? 32 : 44}px;
             display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px"
      onmouseover="this.style.borderColor='var(--gold)'"
      onmouseout="this.style.borderColor='${border}'">
      <div style="font-size:${size === "sm" ? 12 : 13}px;font-weight:${isToday ? "700" : "400"};
                  color:${isToday ? "var(--gold)" : "var(--text-warm)"}">${d}</div>
      <div style="width:${dotSize}px;height:${dotSize}px;border-radius:50%;
                  background:${hasActivity ? "#ef4444" : "transparent"};
                  box-shadow:${hasActivity ? "0 0 5px rgba(239,68,68,0.8)" : "none"}"></div>
    </div>`;
}

function monthGridCellsHTML(year, month, size) {
  const today = new Date();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  let cells = "";
  for (let i = firstDay - 1; i >= 0; i--) {
    cells += `<div style="aspect-ratio:1;padding:4px;opacity:0.25">
      <div style="font-size:12px;color:var(--text-dim);text-align:right">${prevDays - i}</div>
    </div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = year + "-" + String(month+1).padStart(2,"0") + "-" + String(d).padStart(2,"0");
    const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    cells += monthDayCell(dateStr, d, isToday, size);
  }
  const totalCells = firstDay + daysInMonth;
  const remaining  = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let i = 1; i <= remaining; i++) {
    cells += `<div style="aspect-ratio:1;padding:4px;opacity:0.25">
      <div style="font-size:12px;color:var(--text-dim);text-align:right">${i}</div>
    </div>`;
  }
  return cells;
}

// Re-render every calendar surface that's currently on screen (home mini
// calendar and/or the full Calendar screen share the same month state).
async function refreshAllCalendarViews() {
  await loadCalendarMonth(calCurrentYear, calCurrentMonth);
  const full = document.getElementById("calendar-content");
  if (full) renderCalendarGrid(full);
  const home = document.getElementById("home-calendar-wrap");
  if (home) renderHomeCalendarCard(home);
}

function renderCalendarGrid(el) {
  const MONTHS = CAL_MONTHS, DAYS = CAL_DAYS;
  const year  = calCurrentYear;
  const month = calCurrentMonth;
  const cells = monthGridCellsHTML(year, month, "lg");

  el.innerHTML = `
    <div style="padding:0 0 80px">

      <!-- Month navigation -->
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:16px 16px 12px;border-bottom:1px solid var(--gold-dim)">
        <button onclick="calPrevMonth()"
          style="background:rgba(255,255,255,0.06);border:1px solid var(--card-border);
                 border-radius:var(--radius-md);padding:8px 14px;color:var(--text-warm);
                 font-size:16px;cursor:pointer;font-family:var(--font-sans)">‹</button>
        <div style="text-align:center">
          <div style="font-family:var(--font-serif);font-size:18px;color:var(--gold)">
            ${MONTHS[month]}
          </div>
          <div style="font-size:12px;color:var(--text-muted)">${year}</div>
        </div>
        <button onclick="calNextMonth()"
          style="background:rgba(255,255,255,0.06);border:1px solid var(--card-border);
                 border-radius:var(--radius-md);padding:8px 14px;color:var(--text-warm);
                 font-size:16px;cursor:pointer;font-family:var(--font-sans)">›</button>
      </div>

      <!-- Day headers -->
      <div style="display:grid;grid-template-columns:repeat(7,1fr);
                  padding:8px 12px 4px;gap:2px">
        ${DAYS.map(d => `
          <div style="text-align:center;font-size:11px;color:var(--text-muted);
                      font-weight:600;letter-spacing:0.5px;text-transform:uppercase">
            ${d}
          </div>`).join("")}
      </div>

      <!-- Calendar grid -->
      <div style="display:grid;grid-template-columns:repeat(7,1fr);
                  padding:4px 12px;gap:4px">
        ${cells}
      </div>

      <div style="height:16px"></div>

      <!-- Upcoming / recent visits -->
      <div style="padding:0 16px">
        <div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;
                    letter-spacing:0.5px;margin-bottom:10px">
          This Month's Visits
        </div>
        ${Object.keys(calVisitDocs).length === 0
          ? `<div style="color:var(--text-dim);font-size:13px;font-style:italic;padding:8px 0">
               No visits logged this month yet.
             </div>`
          : Object.entries(calVisitDocs)
              .sort((a,b) => b[0].localeCompare(a[0]))
              .map(([dateStr, visits]) => {
                const d = new Date(dateStr + "T12:00:00");
                const label = d.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" });
                return `
                  <div style="background:var(--forest-card);border:1px solid var(--card-border);
                              border-radius:var(--radius-md);padding:12px;margin-bottom:8px">
                    <div style="font-size:13px;font-weight:600;color:var(--gold);margin-bottom:8px">
                      ${label}
                    </div>
                    ${visits.map(v => {
                      const p = visitPurpose(v), dp = visitDayPart(v);
                      const spanTag = visitSpan(v) > 1 ? `📅 ${visitRangeLabel(v)}` : "";
                      const tags = [p ? `${p.icon} ${p.label}` : "", dp ? `${dp.icon} ${dp.label}` : "", spanTag].filter(Boolean).join("  ·  ");
                      return `
                      <div style="display:flex;align-items:center;gap:10px;padding:4px 0">
                        <div class="avatar" style="background:${safeColor(v.visitorColor)};
                             width:28px;height:28px;font-size:10px;flex-shrink:0">
                          ${esc(v.visitorInitials||"?")}
                        </div>
                        <div style="flex:1;min-width:0">
                          <div style="font-size:13px;color:var(--text-warm)">${esc(v.visitorName||"Unknown")}</div>
                          ${tags ? `<div style="font-size:11px;color:var(--text-muted)">${tags}</div>` : ""}
                          ${v.notes && v.notes !== "Checked in via app" ? `<div style="font-size:11px;color:var(--text-muted);white-space:pre-wrap;word-break:break-word">${esc(v.notes)}</div>` : ""}
                        </div>
                        ${(userProfile?.uid === v.uid || userProfile?.role === "admin") ? `
                          <button onclick="deleteCalendarVisit('${v.id}')"
                            style="background:none;border:none;color:var(--text-dim);
                                   font-size:14px;cursor:pointer">🗑</button>` : ""}
                      </div>`;}).join("")}
                  </div>`;
              }).join("")}
      </div>
    </div>
  `;
}

window.calPrevMonth = async function () {
  calCurrentMonth--;
  if (calCurrentMonth < 0) { calCurrentMonth = 11; calCurrentYear--; }
  await refreshAllCalendarViews();
};

window.calNextMonth = async function () {
  calCurrentMonth++;
  if (calCurrentMonth > 11) { calCurrentMonth = 0; calCurrentYear++; }
  await refreshAllCalendarViews();
};

window.openCalendarDay = function (dateStr) {
  const visits = visitsOnDay(dateStr);
  const d      = new Date(dateStr + "T12:00:00");
  const uid    = userProfile && userProfile.uid;
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const monthAb = d.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  const rel     = relativeDayLabel(dateStr);
  const moon    = moonPhase(d);
  const isPast  = new Date(dateStr + "T23:59:59") < new Date();
  const isWeekend = d.getDay() === 0 || d.getDay() === 6;

  const uniqueUids = [...new Set(visits.map(v => v.uid))];
  const myVisits   = visits.filter(v => v.uid === uid);
  const planLine   = uniqueUids.length === 0 ? ""
    : isPast
      ? `${uniqueUids.length} ${uniqueUids.length === 1 ? "member was" : "members were"} at camp`
      : `${uniqueUids.length} ${uniqueUids.length === 1 ? "member is" : "members are"} planning to be there`;

  const visitCard = v => {
    const dp = visitDayPart(v);
    const mine = v.uid === uid;
    const canDel = mine || (userProfile && userProfile.role === "admin");
    const span = visitSpan(v);
    const off  = visitDayOffset(v, dateStr);   // 0-based day of the stay
    const bits = [
      dp ? `${dp.icon} ${dp.label}` : "",
      span > 1 ? `📅 ${esc(visitRangeLabel(v))} · day ${off + 1} of ${span}` : "",
      v.isCheckin ? "📍 checked in" : ""
    ].filter(Boolean).join("  ·  ");
    return `
      <div style="display:flex;align-items:flex-start;gap:9px;padding:8px 9px;border-radius:var(--radius-md);
                  background:${mine ? "rgba(196,169,106,0.10)" : "rgba(255,255,255,0.03)"};
                  border:1px solid ${mine ? "var(--gold-dim)" : "var(--card-border)"};margin-bottom:6px">
        <div class="avatar" style="background:${safeColor(v.visitorColor)};width:28px;height:28px;font-size:10px;flex-shrink:0">
          ${esc((v.visitorInitials || "?"))}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;color:var(--text-warm);font-weight:600">${esc(v.visitorName || "Unknown")}${mine ? " (you)" : ""}</div>
          ${bits ? `<div style="font-size:11px;color:var(--text-muted);margin-top:1px">${bits}</div>` : ""}
          ${v.notes && v.notes !== "Checked in via app"
            ? `<div style="font-size:12px;color:var(--text-muted);white-space:pre-wrap;word-break:break-word;margin-top:4px">${esc(v.notes)}</div>` : ""}
        </div>
        ${canDel ? `<button onclick="deleteCalendarVisit('${v.id}')"
          style="background:none;border:none;color:var(--text-dim);font-size:14px;cursor:pointer;flex-shrink:0">🗑</button>` : ""}
      </div>`;
  };

  // group the roster by purpose so a crowded day stays scannable
  function rosterHTML() {
    const buckets = {};
    visits.forEach(v => {
      const k = (v.purpose && VISIT_PURPOSES[v.purpose]) ? v.purpose : "_none";
      (buckets[k] = buckets[k] || []).push(v);
    });
    const keys = [...Object.keys(VISIT_PURPOSES).filter(k => buckets[k]),
                  ...(buckets._none ? ["_none"] : [])];
    return keys.map(k => {
      const m = VISIT_PURPOSES[k];
      const list = buckets[k];
      const head = m
        ? `<span style="font-size:11px;background:${m.color}22;border:1px solid ${m.color}55;color:var(--text-warm);border-radius:20px;padding:2px 9px">${m.icon} ${m.label}</span>`
        : `<span style="font-size:11px;color:var(--text-muted)">Heading up — no plan set</span>`;
      return `<div style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:6px">
          ${head}<span style="font-size:11px;color:var(--text-dim);font-variant-numeric:tabular-nums">${list.length}</span>
        </div>
        ${list.map(visitCard).join("")}
      </div>`;
    }).join("");
  }

  const chipRow = (group, map) => `
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      ${Object.entries(map).map(([k, m]) => `
        <button type="button" data-${group}="${k}" onclick="calPickChip(this,'${group}')"
          class="cal-chip"
          style="font-size:12px;font-family:var(--font-sans);border-radius:20px;padding:6px 11px;cursor:pointer;
                 background:rgba(255,255,255,0.05);border:1px solid var(--card-border);color:var(--text-warm);font-weight:500">
          ${m.icon} ${m.label}</button>`).join("")}
    </div>`;

  const ov = document.createElement("div");
  ov.className = "modal-overlay"; ov.id = "cal-day-overlay";
  ov.dataset.date = dateStr;
  ov.innerHTML = `
    <div class="modal-box" style="max-width:380px;max-height:88vh;overflow-y:auto;padding:0">

      <!-- Header band -->
      <div style="position:relative;padding:16px 18px;
                  background:linear-gradient(135deg,rgba(196,169,106,0.22),rgba(212,98,42,0.14));
                  border-bottom:1px solid var(--gold-dim)">
        <button onclick="document.getElementById('cal-day-overlay').remove()"
          style="position:absolute;top:12px;right:12px;background:rgba(0,0,0,0.25);border:none;
                 color:var(--text-warm);font-size:15px;cursor:pointer;width:26px;height:26px;border-radius:50%">✕</button>
        <div style="display:flex;align-items:center;gap:14px">
          <div style="text-align:center;background:rgba(14,10,4,0.55);border:1px solid var(--gold-dim);
                      border-radius:var(--radius-md);padding:6px 12px;flex-shrink:0">
            <div style="font-size:10px;letter-spacing:1px;color:var(--gold)">${monthAb}</div>
            <div style="font-size:24px;font-weight:700;color:var(--text-warm);line-height:1.1">${d.getDate()}</div>
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-family:var(--font-serif);font-size:18px;color:var(--gold)">${weekday}</div>
            <div style="font-size:12px;color:var(--text-warm);margin-top:2px">
              ${esc(rel)}${isWeekend ? " · weekend" : ""}
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px" title="${esc(moon.name)}">
              ${moon.icon} ${esc(moon.name)}
            </div>
          </div>
        </div>
        ${planLine ? `<div style="margin-top:12px;font-size:12px;color:var(--text-warm);
                      background:rgba(14,10,4,0.4);border-radius:20px;padding:5px 12px;display:inline-block">
                      👥 ${esc(planLine)}</div>` : ""}
      </div>

      <div style="padding:16px 18px">

        ${myVisits.length ? `<div style="font-size:12px;color:var(--gold);margin-bottom:10px">✓ You're on for this day</div>` : ""}

        ${visits.length === 0
          ? `<div style="text-align:center;padding:14px 0 18px;color:var(--text-muted)">
               <div style="font-size:30px;margin-bottom:6px">🪵</div>
               <div style="font-size:13px">Nobody's down for this day yet.</div>
               ${userProfile ? `<div style="font-size:12px;color:var(--text-dim);margin-top:2px">Be the first — add yourself below.</div>` : ""}
             </div>`
          : `<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">
               ${isPast ? "Who was there" : "Who's coming"}
             </div>${rosterHTML()}`}

        <div id="cal-day-context" style="margin-top:6px"></div>

        ${userProfile ? `
          <div style="margin-top:16px;border-top:1px solid var(--gold-dim);padding-top:14px">
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">
              ${myVisits.length ? "Log another" : "Add yourself to this day"}
            </div>
            <div style="font-size:12px;color:var(--text-dim);margin-bottom:6px">What for?</div>
            ${chipRow("purpose", VISIT_PURPOSES)}
            <div style="font-size:12px;color:var(--text-dim);margin:12px 0 6px">When?</div>
            ${chipRow("daypart", DAY_PARTS)}
            <div style="display:flex;align-items:center;gap:10px;margin-top:12px">
              <span style="font-size:12px;color:var(--text-dim);flex:1">How many days at camp?</span>
              <button type="button" onclick="calBumpSpan(-1)"
                style="width:30px;height:30px;border-radius:8px;border:1px solid var(--card-border);
                       background:rgba(255,255,255,0.05);color:var(--text-warm);font-size:16px;cursor:pointer">−</button>
              <input type="number" id="cal-visit-span" value="1" min="1" max="${CAL_MAX_SPAN}" readonly
                style="width:44px;text-align:center;padding:6px 0;font-size:14px" />
              <button type="button" onclick="calBumpSpan(1)"
                style="width:30px;height:30px;border-radius:8px;border:1px solid var(--card-border);
                       background:rgba(255,255,255,0.05);color:var(--text-warm);font-size:16px;cursor:pointer">+</button>
            </div>
            <div id="cal-span-hint" style="font-size:11px;color:var(--text-dim);margin-top:4px">Just this day</div>
            <input type="text" id="cal-visit-notes" placeholder="Notes (optional) — stand, camp, plans…"
              maxlength="140" style="width:100%;margin-top:12px" />
            <button class="btn btn-primary btn-full" style="margin-top:10px" onclick="saveCalendarVisit('${dateStr}')">
              ${isPast ? "Log this day" : "I'm in for this day"}
            </button>
          </div>` : ""}
      </div>
    </div>`;
  document.body.appendChild(ov);
  fillCalDayContext(dateStr, d);
};

// "On this day" — harvests logged on this date, pulled from the trophy data layer
async function fillCalDayContext(dateStr, dateObj) {
  const slot = document.getElementById("cal-day-context");
  if (!slot) return;
  let harvests = [];
  try {
    const cache = await loadTrophyData(false);
    harvests = (cache.harvests || []).filter(h => {
      const hd = h.harvestDate?.toDate ? h.harvestDate.toDate() : new Date(h.harvestDate || 0);
      return hd.getFullYear() === dateObj.getFullYear()
          && hd.getMonth()    === dateObj.getMonth()
          && hd.getDate()     === dateObj.getDate();
    });
  } catch (_) { return; }
  if (!document.getElementById("cal-day-context")) return;
  if (!harvests.length) { slot.innerHTML = ""; return; }
  slot.innerHTML = `
    <div style="margin-top:14px;background:var(--forest-card);border:1px solid var(--card-border);
                border-radius:var(--radius-md);padding:12px">
      <div style="font-size:11px;color:var(--gold);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">
        🦌 On this day
      </div>
      ${harvests.map(h => {
        const sp = speciesInfo(h.species);
        const who = trophyCache?.members?.[h.uid]?.name || "A member";
        const what = h.deerType === "buck" ? "buck" : h.deerType === "doe" ? "doe" : (sp.label || "harvest");
        const detail = Number(h.rackScore) ? ` · ${h.rackScore}" B&C`
                     : Number(h.weight)    ? ` · ${h.weight} lbs` : "";
        return `<div style="font-size:12px;color:var(--text-warm);padding:3px 0">
          ${sp.icon} ${esc(who)} — ${esc(what)}${detail}
        </div>`;
      }).join("")}
    </div>`;
}

window.openAddCalendarVisit = function () {
  const today = new Date().toISOString().split("T")[0];
  openCalendarDay(today);
};

window.saveCalendarVisit = async function (dateStr) {
  if (!userProfile) return;
  const notes    = document.getElementById("cal-visit-notes")?.value.trim() || "";
  const purpose  = document.querySelector('#cal-day-overlay button.cal-chip-on[data-purpose]')?.dataset.purpose || null;
  const dayPart  = document.querySelector('#cal-day-overlay button.cal-chip-on[data-daypart]')?.dataset.daypart || null;
  const spanDays = Math.min(CAL_MAX_SPAN, Math.max(1, Number(document.getElementById("cal-visit-span")?.value) || 1));
  try {
    await addDoc(collection(db, "visits"), {
      visitDate:        Timestamp.fromDate(new Date(dateStr + "T12:00:00")),
      uid:              userProfile.uid,
      visitorName:      userProfile.displayName,
      visitorInitials:  userProfile.initials,
      visitorColor:     userProfile.color,
      notes,
      purpose,
      dayPart,
      spanDays,
      createdAt:        serverTimestamp()
    });
    document.getElementById("cal-day-overlay")?.remove();
    showToast(
      spanDays > 1
        ? `You're on the calendar for ${spanDays} days.`
        : purpose ? `${VISIT_PURPOSES[purpose].icon} You're on the calendar!` : "You're on the calendar!",
      "success"
    );
    await refreshAllCalendarViews();
  } catch(err) {
    console.error(err);
    showToast("Could not save visit.", "error");
  }
};

window.deleteCalendarVisit = function (id) {
  const reopenDate = document.getElementById("cal-day-overlay")?.dataset.date || null;
  appConfirm("Remove Visit", "Remove this visit from the calendar?", async () => {
    try {
      await deleteDoc(doc(db, "visits", id));
      showToast("Visit removed.", "success");
      await refreshAllCalendarViews();
      const still = document.getElementById("cal-day-overlay");
      if (still && reopenDate) { still.remove(); openCalendarDay(reopenDate); }
    } catch(err) { console.error(err); showToast("Could not remove.", "error"); }
  });
};


// ============================================================
// KILL COUNTER & TIER SYSTEM
// ============================================================

const KILL_TIERS = [
  { tier:1, name:"Gold",              icon:"⭐",       pts:1,    msg:"You're on the board. Welcome to the harvest log." },
  { tier:2, name:"Double Gold",       icon:"⭐⭐",     pts:25,   msg:"You're getting out there. The woods are starting to notice." },
  { tier:3, name:"Triple Gold",       icon:"⭐⭐⭐",   pts:75,   msg:"That's a real body count. You know what you're doing out there." },
  { tier:4, name:"Diamond",           icon:"💎",       pts:150,  msg:"Straight up lethal. Most hunters never see numbers like this." },
  { tier:5, name:"Royal Description", icon:"👑",       pts:300,  msg:"You are the apex predator at Tucker's Camp. Full stop." },
  { tier:6, name:"Unknown Element",   icon:"☢️",      pts:600,  msg:"At this point you're a biological threat to the local wildlife population." },
  { tier:7, name:"Elementa Infinitum",icon:"🌟",       pts:1000, msg:"Beyond measurement. The apex has no ceiling." }
];

const KILL_POINTS = {
  deer_buck:      10,
  deer_doe:       5,
  turkey_tom:     10,
  turkey_jake:    5,
  turkey_hen:     5,
  bear:           15,
  waterfowl:      2,
  smallgame:      1,
  coyote:         3,
  wolf:           3,
  fox:            3,
  other:          2
};

function getTierForPoints(pts) {
  let current = null;
  for (const t of KILL_TIERS) {
    if (pts >= t.pts) current = t;
  }
  return current;
}

function getNextTier(pts) {
  return KILL_TIERS.find(t => pts < t.pts) || null;
}

async function updateKillCounter() {
  if (!userProfile) return;
  try {
    const snap = await getDoc(doc(db, "users", userProfile.uid));
    const data = snap.data() || {};
    const kills = data.totalKills || 0;
    const pts   = data.killPoints || 0;
    const tier  = getTierForPoints(pts);

    // Update header badge
    const badge = document.getElementById("kill-counter-badge");
    if (badge) {
      badge.textContent = `${tier ? tier.icon + " " : "🏆 "}${kills}`;
    }
  } catch(err) { console.error("Kill counter error:", err); }
}

async function recordKill(harvestData) {
  if (!userProfile) return;
  try {
    const ref2  = doc(db, "users", userProfile.uid);
    const snap  = await getDoc(ref2);
    const data  = snap.data() || {};
    const prevPts  = data.killPoints  || 0;
    const prevKills = data.totalKills || 0;

    // Calculate points for this harvest
    let pts = 0;
    const sp = harvestData.species;
    if (sp === "deer") {
      pts = harvestData.deerType === "buck" ? KILL_POINTS.deer_buck : KILL_POINTS.deer_doe;
    } else if (sp === "turkey") {
      const sex = harvestData.turkeySex || "tom";
      pts = sex === "tom" ? KILL_POINTS.turkey_tom : KILL_POINTS.turkey_jake;
    } else if (sp === "bear")      pts = KILL_POINTS.bear;
    else if (sp === "waterfowl")   pts = KILL_POINTS.waterfowl * (harvestData.quantity || 1);
    else if (sp === "smallgame")   pts = KILL_POINTS.smallgame * (harvestData.quantity || 1);
    else if (sp === "coyote")      pts = KILL_POINTS.coyote;
    else if (sp === "wolf")        pts = KILL_POINTS.wolf;
    else if (sp === "fox")         pts = KILL_POINTS.fox;
    else                            pts = KILL_POINTS.other;

    const newPts   = prevPts  + pts;
    const newKills = prevKills + 1;

    await updateDoc(ref2, {
      killPoints:  newPts,
      totalKills:  newKills,
      updatedAt:   serverTimestamp()
    });

    // Store on userProfile for immediate use in feed flair
    userProfile.killPoints = newPts;
    userProfile.totalKills = newKills;

    // Check tier progression
    const prevTier = getTierForPoints(prevPts);
    const newTier  = getTierForPoints(newPts);

    if (newTier && (!prevTier || newTier.tier > prevTier.tier)) {
      showTierPopup(newTier, newPts);
      // Post to feed
      await postAutoFeedEvent("tier", {
        memberName: userProfile.displayName,
        tierName:   newTier.name,
        tierIcon:   newTier.icon,
        uid:        userProfile.uid,
        color:      userProfile.color,
        initials:   userProfile.initials
      });
    }

    updateKillCounter();
  } catch(err) { console.error("Record kill error:", err); }
}

function showTierPopup(tier, currentPts) {
  const next = getNextTier(currentPts);
  const ov   = document.createElement("div");
  ov.className = "modal-overlay";
  ov.id = "tier-popup";
  ov.innerHTML = `
    <div class="modal-box" style="max-width:340px;text-align:center">
      <div style="font-size:52px;margin-bottom:8px">${tier.icon}</div>
      <div style="font-family:var(--font-serif);font-size:22px;color:var(--gold);margin-bottom:8px">
        ${tier.name}
      </div>
      <div style="font-size:14px;color:var(--text-muted);line-height:1.5;margin-bottom:16px">
        ${tier.msg}
      </div>
      ${next ? `
        <div style="background:rgba(255,255,255,0.04);border:1px solid var(--card-border);
                    border-radius:var(--radius-md);padding:10px 14px;margin-bottom:16px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px">Next Rank</div>
          <div style="font-size:15px;color:var(--text-warm)">${next.icon} ${next.name} — ${next.pts} pts</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:3px">${next.pts - currentPts} pts away</div>
        </div>` : `
        <div style="font-size:13px;color:var(--gold);margin-bottom:16px">
          Elementa Infinitum. There is no rank above this.
        </div>`}
      <button class="btn btn-primary btn-full" onclick="document.getElementById('tier-popup').remove()">
        Let's Go 🎯
      </button>
    </div>
  `;
  document.body.appendChild(ov);
}

// ============================================================
// HOME SCREEN — CHECK-IN BUTTON
// ============================================================
const CHECKIN_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

window.renderCheckinButton = async function () {
  const wrap = document.getElementById("home-checkin-wrap");
  if (!wrap) return;
  if (!userProfile) { wrap.innerHTML = ""; return; }

  try {
    const snap     = await getDoc(doc(db, "users", userProfile.uid));
    const userData = snap.data() || {};
    const lastCheckin = userData.lastCheckin?.toDate?.() || null;
    const now      = Date.now();
    const elapsed  = lastCheckin ? now - lastCheckin.getTime() : Infinity;
    const onCooldown = elapsed < CHECKIN_COOLDOWN_MS;

    if (onCooldown) {
      const remaining = CHECKIN_COOLDOWN_MS - elapsed;
      const hrs = Math.floor(remaining / 3600000);
      const mins = Math.floor((remaining % 3600000) / 60000);
      const isCheckedIn = userData.isCheckedIn === true;
      wrap.innerHTML = `
        <div style="padding:0 16px;margin-bottom:14px;display:flex;flex-direction:column;gap:8px">
          <button class="btn btn-full" disabled
            style="background:rgba(180,30,30,0.2);border:1px solid rgba(180,30,30,0.3);
                   color:rgba(255,255,255,0.35);border-radius:var(--radius-lg);
                   padding:14px;font-size:15px;font-weight:600;cursor:not-allowed">
            📍 Checked In — ${hrs}h ${mins}m ago
          </button>
          ${isCheckedIn ? `
            <button onclick="doCheckout()"
              style="width:100%;background:linear-gradient(135deg,var(--orange),var(--orange-bright));
                     border:none;border-radius:var(--radius-lg);padding:12px;color:#fff;
                     font-size:14px;font-weight:700;cursor:pointer;font-family:var(--font-sans);
                     box-shadow:0 4px 14px rgba(212,98,42,0.4)">
              🚪 Left the Cabin
            </button>` : ""}
        </div>`;
    } else {
      wrap.innerHTML = `
        <div style="padding:0 16px;margin-bottom:14px">
          <button onclick="doCheckin()"
            style="width:100%;background:linear-gradient(135deg,#c0182a,#e02030);
                   border:none;border-radius:var(--radius-lg);padding:14px;
                   color:#fff;font-size:15px;font-weight:700;cursor:pointer;
                   box-shadow:0 4px 16px rgba(192,24,42,0.4);
                   transition:all 0.2s;font-family:var(--font-sans);letter-spacing:0.3px"
            onmouseover="this.style.filter='brightness(1.1)'"
            onmouseout="this.style.filter='brightness(1)'">
            📍 Check In to the Cabin
          </button>
        </div>`;
    }
  } catch(err) {
    console.error(err);
    wrap.innerHTML = "";
  }
};

window.doCheckin = async function () {
  if (!userProfile) return;
  try {
    const now = serverTimestamp();
    const today = new Date().toISOString().split("T")[0];

    // Save last checkin to user doc
    await updateDoc(doc(db, "users", userProfile.uid), {
      lastCheckin: now,
      isCheckedIn: true
    });

    // Log cabin visit to calendar (schema must match the Cabin Calendar reader)
    await addDoc(collection(db, "visits"), {
      visitDate:        Timestamp.fromDate(new Date(today + "T12:00:00")),
      uid:              userProfile.uid,
      visitorName:      userProfile.displayName,
      visitorInitials:  userProfile.initials,
      visitorColor:     userProfile.color,
      notes:            "Checked in via app",
      createdAt:        now,
      isCheckin:        true
    });

    // Post to feed
    await postAutoFeedEvent("checkin", {
      memberName: userProfile.displayName,
      uid:        userProfile.uid,
      color:      userProfile.color,
      initials:   userProfile.initials
    });

    showToast("🏕️ You're checked in! Everyone knows you made it.", "success");
    renderCheckinButton();
  } catch(err) {
    console.error(err);
    showToast("Could not check in. Try again.", "error");
  }
};

// ============================================================
// SOCIAL FEED — Full Implementation (Step 8)
// ============================================================

let feedUnsub = null;
let feedExpandedComments = new Set();  // post ids whose comment thread is open

const AUTO_FEED_TYPES = {
  checkin:  (d) => `🏕️ <strong>${esc(d.memberName)}</strong> has entered the cabin!`,
  checkout: (d) => `🚪 <strong>${esc(d.memberName)}</strong> has left the cabin.`,
  harvest:  (d) => `🦌 <strong>${esc(d.memberName)}</strong> just logged a ${esc(d.speciesIcon)} ${esc(d.speciesLabel)} harvest!`,
  trailcam: (d) => `📷 <strong>${esc(d.memberName)}</strong> uploaded ${Number(d.count) || 0} trail cam photo${d.count!==1?"s":""}!`,
  trending: (d) => `🔥 A trail cam photo is trending — check it out!`,
  tier:     (d) => `🎉 Congrats to <strong>${esc(d.memberName)}</strong> for reaching ${esc(d.tierIcon)} <strong>${esc(d.tierName)}</strong> rank!`,
  contest:  (d) => `🏆 <strong>${esc(d.winnerName)}</strong> won the ${Number(d.year) || ""} ${esc(d.contestLabel)} contest with ${esc(d.measure)}!`
};

async function postAutoFeedEvent(type, data) {
  try {
    await addDoc(collection(db, "feed"), {
      type,
      data,
      isAuto:     true,
      uid:        (data && data.uid) || userProfile?.uid || null,   // who triggered it
      createdAt:  serverTimestamp(),
      reactions:  {},
      comments:   []
    });
  } catch(err) { console.error("Auto feed post error:", err); }
}

window.goFeed = function () {
  showScreen("screen-feed");
  renderFeedScreen();
};

window.renderFeedScreen = function () {
  const content = document.getElementById("feed-content");
  content.innerHTML = `
    <!-- Compose bar -->
    ${userProfile ? `
      <div style="padding:12px 16px;border-bottom:1px solid var(--gold-dim)">
        <div style="display:flex;gap:10px;align-items:center">
          <div class="avatar" style="background:${safeColor(userProfile.color)};
               width:36px;height:36px;font-size:13px;flex-shrink:0">
            ${esc(userProfile.initials)}
          </div>
          <button onclick="openFeedCompose()"
            style="flex:1;background:rgba(255,255,255,0.06);border:1px solid var(--card-border);
                   border-radius:var(--radius-xl);padding:10px 16px;color:var(--text-muted);
                   font-size:14px;cursor:pointer;text-align:left;font-family:var(--font-sans);
                   transition:border-color 0.2s"
            onmouseover="this.style.borderColor='var(--gold-dim)'"
            onmouseout="this.style.borderColor='var(--card-border)'">
            What's on your mind?
          </button>
        </div>
      </div>` : ""}
    <div id="feed-list" style="padding:12px 16px 80px">
      <div style="text-align:center;padding:40px;color:var(--text-muted)">
        <div class="spinner" style="margin:0 auto 12px"></div>
        Loading feed…
      </div>
    </div>
  `;
  loadFeed();
};

let feedPageSize = 20;
let feedLastDoc  = null;
let feedAllLoaded = false;

function loadFeed() {
  if (feedUnsub) { feedUnsub(); feedUnsub = null; }
  feedLastDoc   = null;
  feedAllLoaded = false;
  feedPageSize  = 20;
  feedExpandedComments.clear();
  const list = document.getElementById("feed-list");
  if (!list) return;

  const q = query(collection(db, "feed"), orderBy("createdAt", "desc"), limit(feedPageSize));

  feedUnsub = onSnapshot(q, (snap) => {
    feedLastDoc = snap.docs[snap.docs.length - 1] || null;
    feedAllLoaded = snap.docs.length < feedPageSize;

    // A local optimistic write (our own reaction/comment/post) fires this
    // handler immediately; the targeted DOM updaters already handled it, so
    // skip the full rebuild to avoid a flicker / scroll jump.
    if (snap.metadata.hasPendingWrites) return;

    const scroller = document.getElementById("main-content");
    const keepScroll = scroller ? scroller.scrollTop : 0;

    if (snap.empty) {
      list.innerHTML = `
        <div style="text-align:center;padding:48px 0;color:var(--text-muted)">
          <div style="font-size:48px;margin-bottom:12px">💬</div>
          <div>Nothing in the feed yet.</div>
          <div style="font-size:12px;margin-top:6px">Be the first to post!</div>
        </div>`;
      return;
    }

    const cards = snap.docs.map(d => feedPostCard({ id: d.id, ...d.data() })).join("");
    list.innerHTML = cards + (!feedAllLoaded ? `
      <div style="text-align:center;padding:16px">
        <button class="btn btn-secondary btn-sm" onclick="loadMoreFeed()">Load More</button>
      </div>` : "");
    if (scroller) scroller.scrollTop = keepScroll;

    // Housekeeping: trim the feed at most once per session, and only from the
    // real server snapshot (not local optimistic writes from reactions/comments).
    if (!window._feedArchiveRan && !snap.metadata.hasPendingWrites) {
      window._feedArchiveRan = true;
      archiveOldFeedPosts();
    }
  }, err => {
    console.error(err);
    if (list) list.innerHTML = `<div style="color:var(--danger);padding:16px">Could not load feed.</div>`;
  });
}

window.loadMoreFeed = async function () {
  if (!feedLastDoc || feedAllLoaded) return;
  try {
    const { getDocs: gd, startAfter } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const q    = query(collection(db, "feed"), orderBy("createdAt","desc"), startAfter(feedLastDoc), limit(feedPageSize));
    const snap = await getDocs(q);
    feedLastDoc   = snap.docs[snap.docs.length - 1] || feedLastDoc;
    feedAllLoaded = snap.docs.length < feedPageSize;
    const list = document.getElementById("feed-list");
    if (!list) return;
    const loadMoreBtn = list.querySelector("div[style*='text-align:center']");
    if (loadMoreBtn) loadMoreBtn.remove();
    const newCards = snap.docs.map(d => feedPostCard({ id: d.id, ...d.data() })).join("");
    list.insertAdjacentHTML("beforeend", newCards);
    if (!feedAllLoaded) {
      list.insertAdjacentHTML("beforeend", `
        <div style="text-align:center;padding:16px">
          <button class="btn btn-secondary btn-sm" onclick="loadMoreFeed()">Load More</button>
        </div>`);
    }
  } catch(err) { console.error(err); showToast("Could not load more.", "error"); }
};

function feedPostCard(post) {
  const isAuto    = post.isAuto;
  const data      = post.data || {};
  const reactions = post.reactions || {};
  const comments  = post.comments  || [];
  const dateStr   = formatDate(post.createdAt);
  const isOwner   = userProfile && (userProfile.uid === (post.uid || data.uid) || userProfile.role === "admin");

  // Auto-notification posts — blue, thin, no comments
  if (isAuto) {
    const tmpl = AUTO_FEED_TYPES[post.type];
    const body = tmpl ? tmpl(data) : "New activity at Tucker's Camp";
    let linkBtn = "";
    if (post.type === "harvest")  linkBtn = `<button class="btn btn-sm" onclick="goHarvest()" style="background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);color:#fff;border-radius:var(--radius-sm);padding:5px 12px;font-size:11px;cursor:pointer;margin-top:8px">View Harvest Log</button>`;
    if (post.type === "trailcam") linkBtn = `<button class="btn btn-sm" onclick="goTrailCam()" style="background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);color:#fff;border-radius:var(--radius-sm);padding:5px 12px;font-size:11px;cursor:pointer;margin-top:8px">View Trail Cam</button>`;
    if (post.type === "tier")     linkBtn = "";

    return `
      <div style="background:rgba(30,80,160,0.25);border:1px solid rgba(80,140,255,0.35);
                  border-radius:var(--radius-lg);padding:10px 14px;margin-bottom:10px;
                  backdrop-filter:blur(4px)">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:28px;height:28px;border-radius:50%;background:rgba(80,140,255,0.2);
                      border:1px solid rgba(80,140,255,0.4);display:flex;align-items:center;
                      justify-content:center;font-size:14px;flex-shrink:0">🏕️</div>
          <div style="flex:1">
            <div style="font-size:13px;color:#a0c4ff;line-height:1.4">${body}</div>
            <div style="font-size:10px;color:rgba(160,196,255,0.6);margin-top:2px">${dateStr}</div>
          </div>
          ${isOwner ? `<button onclick="deleteFeedPost('${post.id}')"
            style="background:none;border:none;color:rgba(160,196,255,0.4);font-size:14px;cursor:pointer">🗑</button>` : ""}
        </div>
        ${linkBtn}
      </div>`;
  }

  // Regular user posts
  // Get tier info for flair
  const posterPts  = post.killPoints || 0;
  const posterTier = getTierForPoints(posterPts);
  const tierFlair  = posterTier ? `<span style="font-size:12px;margin-left:4px" title="${posterTier.name}">${posterTier.icon}</span>` : "";
  const killCount  = post.totalKills ? `<span style="font-size:10px;color:var(--text-dim);margin-left:4px">${post.totalKills} kills</span>` : "";

  const commentCount = comments.length;

  return `
    <div style="background:var(--forest-card);border:1px solid var(--card-border);
                border-radius:var(--radius-lg);padding:14px;margin-bottom:12px;
                box-shadow:0 4px 16px rgba(0,0,0,0.3)">

      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div class="avatar" style="background:${safeColor(post.color)};
             width:36px;height:36px;font-size:13px;flex-shrink:0">
          ${esc(post.initials || "?")}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:2px">
            <span style="font-size:13px;font-weight:600;color:var(--text-warm)">${esc(post.memberName || "Member")}</span>
            ${tierFlair}${killCount}
          </div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:1px">${dateStr}</div>
        </div>
        ${isOwner ? `
          <button onclick="deleteFeedPost('${post.id}')"
            style="background:none;border:none;color:var(--text-dim);font-size:16px;
                   cursor:pointer;padding:4px;border-radius:var(--radius-sm)">🗑</button>` : ""}
      </div>

      <div style="font-size:14px;color:var(--text-warm);line-height:1.55;margin-bottom:10px;white-space:pre-wrap;word-break:break-word">
        ${esc(post.text || "")}
      </div>
      ${post.photoURL ? `<img src="${esc(post.photoURL)}"
        style="width:100%;border-radius:var(--radius-md);margin-bottom:10px;
               border:1px solid var(--card-border);display:block" />` : ""}

      <!-- Bottom action bar: compact reaction counts + React + Comments buttons -->
      <div style="display:flex;align-items:center;gap:6px;margin-top:6px;margin-bottom:4px">
        <div style="display:flex;flex-wrap:wrap;gap:4px;flex:1;min-width:0"
          id="feed-reactions-${post.id}">
          ${renderReactionBadges(reactions, post.id, "feed")}
        </div>
        ${userProfile ? `
          <button onclick="toggleFeedReactPicker('${post.id}')"
            style="background:rgba(255,255,255,0.06);border:1px solid var(--card-border);
                   border-radius:20px;padding:4px 10px;font-size:13px;cursor:pointer;
                   color:var(--text-muted);font-family:var(--font-sans);flex-shrink:0;
                   white-space:nowrap">😊 React</button>` : ""}
        <button onclick="toggleFeedComments('${post.id}')"
          style="background:rgba(255,255,255,0.06);border:1px solid var(--card-border);
                 border-radius:20px;padding:4px 10px;font-size:13px;cursor:pointer;
                 color:var(--text-muted);font-family:var(--font-sans);flex-shrink:0;
                 white-space:nowrap">
          💬${commentCount ? " " + commentCount : ""}
        </button>
      </div>
      <!-- Emoji picker — hidden until React tapped -->
      <div id="feed-react-picker-${post.id}" class="hidden"
        style="display:flex;flex-wrap:wrap;gap:5px;padding:6px 0">
        ${userProfile ? REACTIONS_LIST.map(e => `
          <button onclick="addFeedReaction('${post.id}','${e}');toggleFeedReactPicker('${post.id}')"
            style="background:rgba(255,255,255,0.06);border:1px solid var(--card-border);
                   border-radius:20px;padding:5px 10px;font-size:15px;cursor:pointer;
                   font-family:var(--font-sans)">${e}</button>`).join("") : ""}
      </div>

      <div id="feed-comments-${post.id}" class="${feedExpandedComments.has(post.id) ? "" : "hidden"}">
        <div class="fade-divider-plain" style="margin:0 0 10px"></div>
        ${renderComments(comments, post.id, "feed")}
        ${userProfile ? `
          <div style="display:flex;gap:8px;margin-top:10px">
            <input type="text" id="feed-comment-input-${post.id}"
              placeholder="Add a comment…" style="flex:1"
              onkeydown="if(event.key==='Enter')submitFeedComment('${post.id}')" />
            <button class="btn btn-primary btn-sm"
              onclick="submitFeedComment('${post.id}')">Post</button>
          </div>` : ""}
      </div>
    </div>
  `;
}

window.toggleFeedReactPicker = function (id) {
  const picker = document.getElementById("feed-react-picker-" + id);
  if (!picker) return;
  picker.classList.toggle("hidden");
};

window.toggleFeedComments = function (id) {
  const el = document.getElementById("feed-comments-" + id);
  if (!el) return;
  const nowHidden = el.classList.toggle("hidden");
  if (nowHidden) feedExpandedComments.delete(id);
  else feedExpandedComments.add(id);
};

window.addFeedReaction = async function (id, emoji) {
  await addReaction(id, "feed", emoji);
  const snap = await getDoc(doc(db, "feed", id));
  const el   = document.getElementById("feed-reactions-" + id);
  if (el) el.innerHTML = renderReactionBadges(snap.data()?.reactions || {}, id, "feed");
};

window.submitFeedComment = async function (id) {
  if (!userProfile) return;
  const input = document.getElementById("feed-comment-input-" + id);
  const text  = input?.value.trim();
  if (!text) return;
  try {
    const ref2     = doc(db, "feed", id);
    const snap     = await getDoc(ref2);
    const comments = snap.data()?.comments || [];
    comments.push({
      uid: userProfile.uid, name: userProfile.displayName,
      initials: userProfile.initials, color: userProfile.color,
      text, createdAt: Date.now()
    });
    await updateDoc(ref2, { comments });
    if (input) input.value = "";
    const fresh = await getDoc(ref2);
    const wrap  = document.getElementById("feed-comments-" + id);
    if (wrap) {
      const newcomments = fresh.data()?.comments || [];
      wrap.innerHTML = `
        <div class="fade-divider-plain" style="margin:0 0 10px"></div>
        ${renderComments(newcomments, id, "feed")}
        <div style="display:flex;gap:8px;margin-top:10px">
          <input type="text" id="feed-comment-input-${id}"
            placeholder="Add a comment…" style="flex:1"
            onkeydown="if(event.key==='Enter')submitFeedComment('${id}')" />
          <button class="btn btn-primary btn-sm" onclick="submitFeedComment('${id}')">Post</button>
        </div>`;
    }
    showToast("Comment posted!", "success");
  } catch(err) { console.error(err); showToast("Could not post comment.", "error"); }
};

window.deleteFeedPost = function (id) {
  appConfirm("Delete Post", "Permanently delete this post?", async () => {
    try {
      const photoURL = (await getDoc(doc(db, "feed", id))).data()?.photoURL;
      await deleteDoc(doc(db, "feed", id));
      await deleteStoredImage(photoURL);
      showToast("Post deleted.", "success");
    } catch(err) { console.error(err); showToast("Could not delete.", "error"); }
  });
};

// ── Compose ───────────────────────────────────────────────────
window.openFeedCompose = function () {
  if (!userProfile) { showToast("Sign in to post.", "error"); return; }
  const ov = document.createElement("div");
  ov.className = "modal-overlay"; ov.id = "feed-compose-overlay";
  ov.innerHTML = `
    <div class="modal-box" style="max-width:380px">
      <div class="modal-title">New Post</div>
      <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:12px">
        <div class="avatar" style="background:${safeColor(userProfile.color)};
             width:36px;height:36px;font-size:13px;flex-shrink:0">${esc(userProfile.initials)}</div>
        <textarea id="feed-compose-text" placeholder="What's on your mind?"
          style="flex:1;min-height:100px;resize:none"></textarea>
      </div>
      <div class="input-group" style="margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:10px">
          <button class="btn btn-secondary btn-sm" type="button"
            onclick="document.getElementById('feed-photo-input').click()">
            📷 Add Photo
          </button>
          <span id="feed-photo-name" style="font-size:12px;color:var(--text-muted)">Optional</span>
        </div>
        <input type="file" id="feed-photo-input" accept="image/*" style="display:none"
          onchange="document.getElementById('feed-photo-name').textContent=this.files[0]?.name||'Optional'" />
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('feed-compose-overlay').remove()">Cancel</button>
        <button class="btn btn-primary btn-sm" id="feed-post-btn" onclick="submitFeedPost()">Post</button>
      </div>
    </div>
  `;
  document.body.appendChild(ov);
  setTimeout(() => document.getElementById("feed-compose-text")?.focus(), 100);
};

window.submitFeedPost = async function () {
  const text  = document.getElementById("feed-compose-text")?.value.trim();
  const file  = document.getElementById("feed-photo-input")?.files?.[0] || null;
  const btn   = document.getElementById("feed-post-btn");

  if (!text) { showToast("Write something first.", "error"); return; }
  if (btn) { btn.disabled = true; btn.textContent = "Posting…"; }

  try {
    let photoURL = null;
    if (file) {
      if (btn) btn.textContent = "Uploading photo…";
      const compressed = await compressImage(file);
      const storageRef = ref(storage, `feed/${userProfile.uid}_${Date.now()}.jpg`);
      await uploadBytes(storageRef, compressed, { contentType: "image/jpeg" });
      photoURL = await getDownloadURL(storageRef);
    }

    await addDoc(collection(db, "feed"), {
      text,
      photoURL,
      isAuto:      false,
      uid:         userProfile.uid,
      memberName:  userProfile.displayName,
      initials:    userProfile.initials,
      color:       userProfile.color,
      killPoints:  userProfile.killPoints || 0,
      totalKills:  userProfile.totalKills || 0,
      createdAt:   serverTimestamp(),
      reactions:   {},
      comments:    []
    });

    document.getElementById("feed-compose-overlay")?.remove();
    showToast("Posted! 💬", "success");
  } catch(err) {
    console.error(err);
    showToast("Could not post: " + err.message, "error");
    if (btn) { btn.disabled = false; btn.textContent = "Post"; }
  }
};

// ============================================================
// TROPHY ROOM  (was "My Kills")
// A stats drop-off: every harvest is a trophy, the room accumulates the
// numbers. "My Trophy Room" (personal stat feed) + "Cabin Trophy Room" (camp hall of fame).
// ============================================================

let trophyExpanded = new Set();   // harvest-log row ids that are open
let trophyEntries  = [];          // the current member's harvest docs, newest first

// ---- shared data layer (feeds both screens, cached per session) ----
let trophyCache = null;           // { at, harvests, contestEntries, contestMeta, members }
const TROPHY_TTL = 5 * 60 * 1000;

async function loadTrophyData(force) {
  if (!force && trophyCache && Date.now() - trophyCache.at < TROPHY_TTL) return trophyCache;
  const [hSnap, ceSnap, cmSnap, uSnap] = await Promise.all([
    getDocs(collection(db, "harvests")),
    getDocs(collection(db, "contestEntries")),
    getDocs(collection(db, "contestMeta")),
    getDocs(collection(db, "users"))
  ]);
  const members = {};
  uSnap.docs.forEach(d => {
    const u = d.data();
    if (u.displayName) {
      members[d.id] = { uid: d.id, name: u.displayName, initials: u.initials || "?", color: u.color || "#556B2F" };
    }
  });
  const contestMeta = {};
  cmSnap.docs.forEach(d => { contestMeta[d.id] = d.data(); });
  trophyCache = {
    at: Date.now(),
    harvests:       hSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(h => h.uid && h.harvestDate),
    contestEntries: ceSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    contestMeta,
    members
  };
  return trophyCache;
}

function harvestYear(h) {
  const d = h.harvestDate?.toDate ? h.harvestDate.toDate() : new Date(h.harvestDate || 0);
  return d.getFullYear();
}
function harvestMillis(h) {
  return h.harvestDate?.toMillis ? h.harvestDate.toMillis() : new Date(h.harvestDate || 0).getTime();
}
function isBuck(h) { return h.species === "deer" && h.deerType === "buck"; }
function isDoe(h)  { return h.species === "deer" && h.deerType === "doe"; }

function longestStreak(years) {
  const s = [...new Set(years)].filter(y => y > 1990).sort((a, b) => a - b);
  if (!s.length) return 0;
  let best = 1, cur = 1;
  for (let i = 1; i < s.length; i++) {
    if (s[i] === s[i - 1] + 1) { cur++; best = Math.max(best, cur); }
    else cur = 1;
  }
  return best;
}
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function emptyMemberStats(uid) {
  return { uid, harvests: 0, bucks: 0, does: 0, points: 0, heaviest: 0, bestRack: 0,
           longestBeard: 0, longestSpur: 0, byYear: {}, bucksByYear: {}, years: new Set(), first: null };
}

function computeTrophyStats(cache) {
  const { harvests, contestEntries, contestMeta, members } = cache;
  const per = {};
  Object.keys(members).forEach(uid => { per[uid] = emptyMemberStats(uid); });
  const ensure = uid => per[uid] || (per[uid] = emptyMemberStats(uid));

  const yearBuckLeader = {};   // year -> {uid, value}
  const yhc = {};              // year -> uid -> harvest count

  harvests.forEach(h => {
    const m = ensure(h.uid);
    const y = harvestYear(h);
    m.harvests += 1;
    m.points   += computeKillPoints(h);
    if (isBuck(h)) { m.bucks++; m.bucksByYear[y] = (m.bucksByYear[y] || 0) + 1; }
    if (isDoe(h))  { m.does++; }
    const w = Number(h.weight) || 0;
    if (w > m.heaviest) m.heaviest = w;
    if (isBuck(h)) { const r = Number(h.rackScore) || 0; if (r > m.bestRack) m.bestRack = r; }
    const bl = Number(h.beardLength) || 0;
    if (bl > m.longestBeard) m.longestBeard = bl;
    const spur = Math.max(Number(h.spurLeft) || 0, Number(h.spurRight) || 0);
    if (spur > m.longestSpur) m.longestSpur = spur;
    m.byYear[y] = (m.byYear[y] || 0) + 1;
    m.years.add(y);
    if (m.first === null || y < m.first) m.first = y;

    if (isBuck(h) && Number(h.rackScore) > 0) {
      if (!yearBuckLeader[y] || Number(h.rackScore) > yearBuckLeader[y].value)
        yearBuckLeader[y] = { uid: h.uid, value: Number(h.rackScore) };
    }
    (yhc[y] = yhc[y] || {});
    yhc[y][h.uid] = (yhc[y][h.uid] || 0) + 1;
  });

  const yearHarvestLeader = {};
  Object.entries(yhc).forEach(([y, counts]) => {
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top) yearHarvestLeader[y] = { uid: top[0], value: top[1] };
  });

  const ids = Object.keys(per);
  const rank = valueFn => ids
    .map(uid => ({ uid, value: valueFn(per[uid]) }))
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value);

  const rankings = {
    harvests:   rank(m => m.harvests),
    bucks:      rank(m => m.bucks),
    does:       rank(m => m.does),
    points:     rank(m => m.points),
    heaviest:   rank(m => m.heaviest),
    bestRack:   rank(m => m.bestRack),
    beard:      rank(m => m.longestBeard),
    spur:       rank(m => m.longestSpur),
    bestSeason: rank(m => Math.max(0, ...Object.values(m.byYear))),
    streak:     rank(m => longestStreak([...m.years]))
  };

  // all-time biggest single bucks (for the "since YYYY" standing)
  const allBucks = harvests
    .filter(h => isBuck(h) && Number(h.rackScore) > 0)
    .map(h => ({ uid: h.uid, value: Number(h.rackScore), year: harvestYear(h) }))
    .sort((a, b) => b.value - a.value);
  const firstYear = harvests.reduce((min, h) => Math.min(min, harvestYear(h)), new Date().getFullYear());

  // contest placements — closed seasons give hard Won/Runner-up/3rd badges;
  // open seasons give a soft "Leading" badge to whoever's on top with a score.
  const placements = {};
  const standings = computeContestStandings(cache);
  Object.entries(standings).forEach(([key, list]) => {
    const us = key.lastIndexOf("_");
    const contest = key.slice(0, us);
    const year = Number(key.slice(us + 1));
    const c = CONTESTS[contest];
    if (!c) return;
    const scored = list.filter(s => s.score != null);
    if (!scored.length) return;
    if (contestMeta[key]?.closed) {
      scored.slice(0, 3).forEach((s, i) => {
        (placements[s.uid] = placements[s.uid] || []).push({
          contest, year, place: i + 1,
          measure: contestValueStr(contest, s.score),
          label: c.label || contest
        });
      });
    } else {
      const lead = scored[0];
      (placements[lead.uid] = placements[lead.uid] || []).push({
        contest, year, place: 1, open: true,
        measure: contestValueStr(contest, lead.score),
        label: c.label || contest
      });
    }
  });

  return { per, rankings, yearBuckLeader, yearHarvestLeader, allBucks, firstYear, placements };
}

// ---- small render helpers ----
function trophyContextLine(rank, unit, members) {
  if (!rank) return "";
  if (rank.pos === 1) return "nobody at camp has more";
  const ahead = rank.ahead;
  if (ahead.length === 1) {
    const a = ahead[0];
    return `only ${esc(members[a.uid]?.name || "someone")} is ahead (${a.value}${unit})`;
  }
  const top = ahead[0];
  return `${ahead.length} ahead — ${esc(members[top.uid]?.name || "?")} leads with ${top.value}${unit}`;
}

function trophyYearBars(byYearObj) {
  const years = Object.keys(byYearObj).map(Number).filter(y => y > 1990).sort((a, b) => a - b);
  if (years.length < 2) return "";
  const max = Math.max(...years.map(y => byYearObj[y]));
  return `<div style="display:flex;align-items:flex-end;gap:5px;height:40px;margin:6px 0 8px">
    ${years.map(y => {
      const v = byYearObj[y], best = v === max;
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px" title="${y}: ${v}">
        <div style="width:100%;height:${Math.max(10, Math.round(v / max * 100))}%;
             background:${best ? "var(--gold)" : "rgba(196,169,106,0.3)"};border-radius:3px 3px 0 0"></div>
        <span style="font-size:10px;color:var(--text-dim)">'${String(y).slice(2)}</span>
      </div>`;
    }).join("")}
  </div>`;
}

// One contest placement → a trophy-room badge {icon,text,strong}
function contestPlacementBadge(p) {
  if (p.open) return {
    icon: "🔥",
    text: `Leading the ${p.year} ${p.label} (${p.measure})`,
    strong: false
  };
  return {
    icon: p.place === 1 ? "🏆" : p.place === 2 ? "🥈" : "🥉",
    text: (p.place === 1 ? "Won " : p.place === 2 ? "Runner-up, " : "3rd, ") + p.label + " " + p.year
          + (p.place === 1 ? "" : " (" + p.measure + ")"),
    strong: p.place === 1
  };
}

function trophyBadges(list) {
  if (!list || !list.length) return "";
  return `<div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">
    ${list.map(b => `
      <div style="display:flex;align-items:center;gap:8px;font-size:12px">
        <span style="font-size:13px;flex-shrink:0">${b.icon}</span>
        <span style="color:${b.strong ? "var(--gold)" : "var(--text-muted)"};line-height:1.35">${esc(b.text)}</span>
      </div>`).join("")}
  </div>`;
}

function trophyStatCard(c) {
  const dim = !c.hasData;
  const chip = c.rank
    ? `<span style="font-size:11.5px;font-weight:600;color:#241206;background:var(--gold);
         border-radius:6px;padding:2px 8px;flex-shrink:0">${c.rank.pos === 1 ? "#1 at camp" : "#" + c.rank.pos + " at camp"}</span>`
    : "";
  const gap = (c.chart || c.context || (c.badges && c.badges.length)) ? "10px" : "0";
  return `
    <div style="background:var(--forest-card);border:1px solid var(--card-border);
                border-radius:14px;padding:14px;margin-bottom:12px;${dim ? "opacity:0.5" : ""}">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        ${chip}
        <span style="font-size:11px;color:var(--text-muted);letter-spacing:0.7px;text-transform:uppercase;
                     overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(c.title)}</span>
        ${c.trophy ? `<span style="margin-left:auto;font-size:15px;flex-shrink:0">🏆</span>` : ""}
      </div>
      <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:${gap}">
        <span style="font-size:28px;font-weight:600;color:var(--text-warm);line-height:1">${esc(c.value)}</span>
        <span style="font-size:12px;color:var(--text-muted)">${esc(c.sub || "")}</span>
      </div>
      ${c.chart || ""}
      ${c.context ? `<div style="font-size:11px;color:var(--text-dim)">${c.context}</div>` : ""}
      ${trophyBadges(c.badges)}
    </div>`;
}

function pointsReferenceHTML(pts) {
  return `
    <div style="margin-bottom:14px">
      <div style="font-size:11px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Tier ladder</div>
      ${KILL_TIERS.map(t => `
        <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(196,169,106,0.07)">
          <span style="font-size:16px;min-width:32px">${t.icon}</span>
          <div style="flex:1"><div style="font-size:13px;font-weight:600;color:${pts >= t.pts ? "var(--gold)" : "var(--text-warm)"}">${t.name}</div></div>
          <div style="font-size:12px;color:var(--text-muted)">${t.pts} pts</div>
          ${pts >= t.pts ? `<span style="font-size:11px;color:var(--success)">✓</span>` : ""}
        </div>`).join("")}
    </div>
    <div>
      <div style="font-size:11px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Points per kill</div>
      ${[["🦌 Buck deer", 10], ["🦌 Doe deer", 5], ["🦃 Turkey tom", 10], ["🦃 Jake / hen", 5],
         ["🐻 Bear", 15], ["🦆 Waterfowl", "2/bird"], ["🐿️ Small game", "1/animal"], ["🎯 Other", 2]
        ].map(([label, p]) => `
        <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(196,169,106,0.07)">
          <span style="font-size:13px;color:var(--text-muted)">${label}</span>
          <span style="font-size:13px;color:var(--gold);font-weight:600">${p}</span>
        </div>`).join("")}
    </div>`;
}

window.renderTrophyRoom = async function () {
  const content = document.getElementById("mykills-content");
  if (!content) return;
  if (!userProfile) {
    content.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text-muted)">Sign in to see your Trophy Room.</div>`;
    return;
  }
  content.innerHTML = `<div style="padding:44px;text-align:center"><div class="spinner" style="margin:0 auto"></div></div>`;

  try {
    const cache = await loadTrophyData(false);
    const stats = computeTrophyStats(cache);
    const M     = cache.members;
    const uid   = userProfile.uid;
    const me    = stats.per[uid] || emptyMemberStats(uid);

    trophyEntries = cache.harvests
      .filter(h => h.uid === uid)
      .sort((a, b) => harvestMillis(b) - harvestMillis(a));

    const rankOf = list => {
      const i = list.findIndex(r => r.uid === uid);
      return i < 0 ? null : { pos: i + 1, total: list.length, ahead: list.slice(0, i) };
    };
    const cards = [];

    // Rank & points
    const pts = me.points || 0;
    const tier = getTierForPoints(pts), nextTier = getNextTier(pts);
    const ptsRank = rankOf(stats.rankings.points);
    cards.push({
      _rank: ptsRank ? ptsRank.pos : 90, hasData: pts > 0, title: "Rank & points",
      rank: ptsRank, trophy: !!(ptsRank && ptsRank.pos === 1),
      value: tier ? tier.icon + " " + tier.name : "No rank yet",
      sub: pts + " kill points",
      chart: nextTier ? `<div style="margin:4px 0 8px">
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-dim);margin-bottom:4px">
          <span>next: ${nextTier.icon} ${esc(nextTier.name)}</span><span>${pts} / ${nextTier.pts}</span>
        </div>
        <div style="background:rgba(255,255,255,0.08);border-radius:8px;height:6px;overflow:hidden">
          <div style="height:100%;width:${Math.min(100, Math.round(pts / nextTier.pts * 100))}%;
               background:linear-gradient(135deg,var(--orange),var(--orange-bright))"></div>
        </div></div>` : (pts > 0 ? `<div style="font-size:11px;color:var(--gold);margin-bottom:6px">Top of the ladder.</div>` : ""),
      context: trophyContextLine(ptsRank, " pts", M), badges: []
    });

    // Total harvests
    const hRank = rankOf(stats.rankings.harvests);
    cards.push({
      _rank: hRank ? hRank.pos : 90, hasData: me.harvests > 0, title: "Trophies logged",
      rank: hRank, trophy: !!(hRank && hRank.pos === 1),
      value: String(me.harvests), sub: "all-time",
      chart: trophyYearBars(me.byYear), context: trophyContextLine(hRank, "", M),
      badges: Object.entries(stats.yearHarvestLeader)
        .filter(([, l]) => l.uid === uid).sort((a, b) => b[0] - a[0]).slice(0, 3)
        .map(([y]) => ({ icon: "★", text: `Most harvests at camp in ${y}`, strong: false }))
    });

    // Bucks
    const bRank = rankOf(stats.rankings.bucks);
    cards.push({
      _rank: bRank ? bRank.pos : 90, hasData: me.bucks > 0, title: "Bucks harvested",
      rank: bRank, trophy: !!(bRank && bRank.pos === 1),
      value: String(me.bucks), sub: me.bucks === 1 ? "buck" : "bucks",
      chart: trophyYearBars(me.bucksByYear), context: trophyContextLine(bRank, "", M), badges: []
    });

    // Buck size / best rack
    const rRank = rankOf(stats.rankings.bestRack);
    const rackBadges = [];
    (stats.placements[uid] || []).filter(p => p.contest === "buck" || p.contest === "bowbuck")
      .forEach(p => rackBadges.push(contestPlacementBadge(p)));
    Object.entries(stats.yearBuckLeader)
      .filter(([, lead]) => lead.uid === uid)
      .sort((a, b) => b[0] - a[0]).slice(0, 3)
      .forEach(([y]) => rackBadges.push({ icon: "★", text: `Biggest buck at camp in ${y}`, strong: false }));
    if (me.bestRack > 0) {
      const pos = stats.allBucks.findIndex(x => x.uid === uid && x.value === me.bestRack);
      if (pos === 0) rackBadges.push({ icon: "👑", text: "Biggest buck at camp — ever", strong: true });
      else if (pos > 0 && pos < 5) rackBadges.push({ icon: "★", text: `${ordinal(pos + 1)}-biggest at camp since ${stats.firstYear}`, strong: false });
    }
    cards.push({
      _rank: rRank ? rRank.pos : 90, hasData: me.bestRack > 0, title: "Buck size",
      rank: rRank, trophy: !!(rRank && rRank.pos === 1),
      value: me.bestRack ? me.bestRack + '"' : "—",
      sub: me.bestRack ? "your best rack, B&C" : "no scored bucks yet",
      chart: "", context: trophyContextLine(rRank, '"', M), badges: rackBadges
    });

    // Heaviest animal
    const wRank = rankOf(stats.rankings.heaviest);
    cards.push({
      _rank: wRank ? wRank.pos : 90, hasData: me.heaviest > 0, title: "Heaviest animal",
      rank: wRank, trophy: !!(wRank && wRank.pos === 1),
      value: me.heaviest ? me.heaviest + " lbs" : "—", sub: "field weight",
      chart: "", context: trophyContextLine(wRank, " lbs", M), badges: []
    });

    // Does
    const dRank = rankOf(stats.rankings.does);
    cards.push({
      _rank: dRank ? dRank.pos : 90, hasData: me.does > 0, title: "Does harvested",
      rank: dRank, trophy: !!(dRank && dRank.pos === 1),
      value: String(me.does), sub: me.does === 1 ? "doe" : "does",
      chart: "", context: trophyContextLine(dRank, "", M), badges: []
    });

    // Turkey badges (spring + fall contest placements)
    const turkeyBadges = (stats.placements[uid] || [])
      .filter(p => p.contest === "springturkey" || p.contest === "fallturkey")
      .map(contestPlacementBadge);

    // Longest beard — surface if there's beard data anywhere, or the member
    // has a turkey contest placement (a weight-only hen won't have beard data)
    if (stats.rankings.beard.length || me.longestBeard || turkeyBadges.length) {
      const beardRank = rankOf(stats.rankings.beard);
      cards.push({
        _rank: beardRank ? beardRank.pos : 65, hasData: me.longestBeard > 0 || turkeyBadges.length > 0,
        title: "Turkey", rank: beardRank, trophy: !!(beardRank && beardRank.pos === 1),
        value: me.longestBeard ? me.longestBeard + '" beard' : (turkeyBadges.length ? "🦃" : "—"),
        sub: me.longestBeard ? "your longest" : "",
        chart: "", context: trophyContextLine(beardRank, '"', M), badges: turkeyBadges
      });
    }
    if (stats.rankings.spur.length || me.longestSpur) {
      const spurRank = rankOf(stats.rankings.spur);
      cards.push({
        _rank: spurRank ? spurRank.pos : 90, hasData: me.longestSpur > 0, title: "Longest spurs",
        rank: spurRank, trophy: !!(spurRank && spurRank.pos === 1),
        value: me.longestSpur ? me.longestSpur + '"' : "—", sub: "turkey",
        chart: "", context: trophyContextLine(spurRank, '"', M), badges: []
      });
    }

    // Best season
    const yrVals = Object.values(me.byYear);
    const bestSeasonCount = yrVals.length ? Math.max(...yrVals) : 0;
    const bestSeasonYear  = Object.entries(me.byYear).sort((a, b) => b[1] - a[1])[0]?.[0];
    cards.push({
      _rank: 70, hasData: bestSeasonCount > 0, title: "Best season",
      rank: rankOf(stats.rankings.bestSeason), trophy: false,
      value: String(bestSeasonCount),
      sub: bestSeasonYear ? `trophies in ${bestSeasonYear}` : "no seasons yet",
      chart: "", context: "", badges: []
    });

    // Seasons running
    const streak = longestStreak([...me.years]);
    if (streak >= 2) {
      cards.push({
        _rank: 75, hasData: true, title: "Seasons running",
        rank: rankOf(stats.rankings.streak), trophy: false,
        value: String(streak), sub: "years in a row with a filled tag",
        chart: "", context: "", badges: []
      });
    }

    // Records held summary (goes first)
    const records = [];
    if (stats.rankings.harvests[0]?.uid === uid) records.push("most trophies");
    if (stats.rankings.bucks[0]?.uid === uid)    records.push("most bucks");
    if (stats.allBucks[0]?.uid === uid)          records.push("biggest buck");
    if (stats.rankings.heaviest[0]?.uid === uid) records.push("heaviest animal");
    if (stats.rankings.points[0]?.uid === uid)   records.push("most points");
    if (stats.rankings.beard[0]?.uid === uid)    records.push("longest beard");
    if (records.length) {
      cards.push({
        _rank: -1, hasData: true, title: "Camp records held", rank: null, trophy: true,
        value: String(records.length), sub: records.length === 1 ? "record" : "records",
        chart: "", context: `<span style="color:var(--gold)">${esc(records.join(" · "))}</span>`, badges: []
      });
    }

    cards.sort((a, b) => (b.hasData - a.hasData) || (a._rank - b._rank));

    // Hero line
    const highlights = [];
    if (records.length) highlights.push(records.length + (records.length === 1 ? " camp record" : " camp records"));
    if (bRank && bRank.pos <= 3) highlights.push("#" + bRank.pos + " for bucks");
    if (tier) highlights.push(tier.name);
    const heroLine = highlights.length ? highlights.join(" · ")
      : (me.harvests ? me.harvests + " trophies logged" : "empty room — go fill a tag");

    content.innerHTML = `
      <div style="padding:14px 16px 90px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
          <div class="avatar" style="background:${safeColor(userProfile.color)};width:44px;height:44px;font-size:15px;flex-shrink:0">${esc(userProfile.initials)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:16px;font-weight:600;color:var(--text-warm);overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(userProfile.displayName)}</div>
            <div style="font-size:12px;color:var(--gold);overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(heroLine)}</div>
          </div>
          <button onclick="refreshTrophyRoom()" title="Refresh"
            style="background:rgba(255,255,255,0.06);border:1px solid var(--card-border);border-radius:8px;
                   width:32px;height:32px;color:var(--text-muted);cursor:pointer;flex-shrink:0;font-size:15px">↻</button>
        </div>

        <div style="display:flex;gap:8px;margin-bottom:16px">
          <button class="btn btn-secondary btn-sm" style="flex:1" onclick="goHarvest()">🦌 Harvest log</button>
          <button class="btn btn-secondary btn-sm" style="flex:1" onclick="goMasterTrophyRoom()">🏅 Cabin Trophy Room</button>
        </div>

        ${me.harvests ? cards.map(trophyStatCard).join("") : `
          <div style="text-align:center;padding:36px 8px;color:var(--text-muted)">
            <div style="font-size:44px;margin-bottom:10px">🏆</div>
            <div style="font-size:14px">No trophies yet.</div>
            <div style="font-size:12px;color:var(--text-dim);margin-top:4px">Log a harvest and the numbers start stacking up here.</div>
          </div>`}

        ${trophyEntries.length ? `
          <div style="margin-top:6px">
            <button class="tc-row-header" id="troom-log-toggle" onclick="toggleTrophySection('troom-log')" style="margin-bottom:0">
              <span style="font-size:16px">🦌</span>
              <div style="flex:1;text-align:left">
                <div style="font-size:14px;font-weight:600;color:var(--text-warm)">Your harvest log</div>
                <div style="font-size:12px;color:var(--text-muted)">${trophyEntries.length} ${trophyEntries.length === 1 ? "entry" : "entries"}</div>
              </div>
              <span id="troom-log-arrow" style="color:var(--gold);font-size:18px;transition:transform 0.2s">›</span>
            </button>
            <div id="troom-log-content" class="hidden" style="padding-top:8px">
              ${trophyEntries.map(renderTrophyEntry).join("")}
            </div>
          </div>` : ""}

        <div style="margin-top:8px">
          <button class="tc-row-header" id="troom-pts-toggle" onclick="toggleTrophySection('troom-pts')" style="margin-bottom:0">
            <span style="font-size:16px">📈</span>
            <div style="flex:1;text-align:left">
              <div style="font-size:14px;font-weight:600;color:var(--text-warm)">How points work</div>
              <div style="font-size:12px;color:var(--text-muted)">Tiers and point values</div>
            </div>
            <span id="troom-pts-arrow" style="color:var(--gold);font-size:18px;transition:transform 0.2s">›</span>
          </button>
          <div id="troom-pts-content" class="hidden"
            style="background:rgba(14,10,4,0.92);border:1px solid var(--gold-dim);border-top:none;
                   border-bottom-left-radius:var(--radius-lg);border-bottom-right-radius:var(--radius-lg);padding:14px">
            ${pointsReferenceHTML(pts)}
          </div>
        </div>
      </div>`;
  } catch (err) {
    console.error(err);
    content.innerHTML = `
      <div style="padding:40px 24px;text-align:center;color:var(--text-muted)">
        <div style="font-size:36px;margin-bottom:10px">📡</div>
        <div style="font-size:14px;margin-bottom:4px">Couldn't load your Trophy Room right now.</div>
        <div style="font-size:12px;color:var(--text-dim);margin-bottom:16px">Check your connection and try again.</div>
        <button class="btn btn-secondary btn-sm" onclick="renderTrophyRoom()">Retry</button>
      </div>`;
  }
};
window.renderMyKillsScreen = window.renderTrophyRoom;   // legacy alias (stub list + goTo)

window.refreshTrophyRoom = async function () {
  try { await loadTrophyData(true); } catch (_) {}
  renderTrophyRoom();
};

// ---- Cabin Trophy Room — camp hall of fame ----
window.goMasterTrophyRoom = function () {
  showScreen("screen-master-trophy");
  renderMasterTrophyRoom();
};

window.renderMasterTrophyRoom = async function () {
  const el = document.getElementById("master-trophy-content");
  if (!el) return;
  el.innerHTML = `<div style="padding:44px;text-align:center"><div class="spinner" style="margin:0 auto"></div></div>`;
  try {
    const cache = await loadTrophyData(false);
    const stats = computeTrophyStats(cache);
    const M  = cache.members;
    const nm = uid => esc(M[uid]?.name || "—");

    const row = (label, list, unit, fmt) => {
      const f = fmt || (v => v + unit);
      const first = list[0], second = list[1];
      return `<div style="background:var(--forest-card);border:1px solid var(--card-border);
                   border-radius:12px;padding:12px 14px;margin-bottom:10px">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.7px;margin-bottom:8px">${esc(label)}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:${second ? "5px" : "0"}">
          <span style="font-size:15px">🏆</span>
          <span style="flex:1;font-size:14px;font-weight:600;color:var(--gold);overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${first ? nm(first.uid) : "—"}</span>
          <span style="font-size:13px;color:var(--text-warm);flex-shrink:0">${first ? esc(f(first.value)) : ""}</span>
        </div>
        ${second ? `<div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:15px">🥈</span>
          <span style="flex:1;font-size:13px;color:var(--text-muted);overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${nm(second.uid)}</span>
          <span style="font-size:12px;color:var(--text-dim);flex-shrink:0">${esc(f(second.value))}</span>
        </div>` : ""}
      </div>`;
    };

    const cats = [
      ["Most trophies",       stats.rankings.harvests,   ""],
      ["Most bucks",          stats.rankings.bucks,      ""],
      ["Most kill points",    stats.rankings.points,     " pts"],
      ["Biggest buck",        stats.rankings.bestRack,   '"'],
      ["Heaviest animal",     stats.rankings.heaviest,   " lbs"],
      ["Most does",           stats.rankings.does,       ""],
      ["Longest beard",       stats.rankings.beard,      '"'],
      ["Longest spurs",       stats.rankings.spur,       '"'],
      ["Best single season",  stats.rankings.bestSeason, ""]
    ].filter(([, list]) => list.length);

    const contestRows = [];
    const allStandings = computeContestStandings(cache);
    Object.entries(cache.contestMeta).forEach(([key, meta]) => {
      if (!meta.closed) return;
      const us = key.lastIndexOf("_");
      const contest = key.slice(0, us), year = key.slice(us + 1);
      const c = CONTESTS[contest];
      const entries = (allStandings[key] || [])
        .filter(s => s.score != null)
        .map(s => ({ uid: s.uid, value: s.score }));
      if (entries.length) contestRows.push(row(`${c?.label || contest} · ${year}`, entries, "", v => contestValueStr(contest, v)));
    });

    el.innerHTML = `
      <div style="padding:14px 16px 90px">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px;line-height:1.5">
          The champion and the runner-up in every category. Updates as members log harvests.
        </div>
        ${cats.length ? cats.map(([l, list, u]) => row(l, list, u)).join("")
          : `<div style="color:var(--text-dim);font-size:13px;font-style:italic;padding:20px 0;text-align:center">No harvests logged at camp yet.</div>`}
        ${contestRows.length ? `<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.7px;margin:18px 0 8px">Contest champions</div>${contestRows.join("")}` : ""}
        <button class="btn btn-secondary btn-sm btn-full" style="margin-top:10px" onclick="goTo('screen-mykills')">← My Trophy Room</button>
      </div>`;
  } catch (err) {
    console.error(err);
    el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-muted)">
      <div style="font-size:14px;margin-bottom:12px">Couldn't load the Cabin Trophy Room.</div>
      <button class="btn btn-secondary btn-sm" onclick="renderMasterTrophyRoom()">Retry</button></div>`;
  }
};

function renderTrophyEntry(h) {
  const sp      = speciesInfo(h.species);
  const dateStr = formatDate(h.harvestDate);
  const isExp   = trophyExpanded.has(h.id);

  // Build stat pills based on species
  const stats = [];
  if (h.weight)      stats.push(h.weight + " lbs");
  if (h.deerType)    stats.push(h.deerType === "buck" ? "Buck" : "Doe");
  if (h.antlerPoints) stats.push(h.antlerPoints + "-pt");
  if (h.insideSpread) stats.push(h.insideSpread + '" spread');
  if (h.rackScore)   stats.push(h.rackScore + '" B&C');
  if (h.turkeySex)   stats.push(h.turkeySex.charAt(0).toUpperCase() + h.turkeySex.slice(1));
  if (h.beardLength) stats.push(h.beardLength + '" beard');
  if (h.spurLeft)    stats.push("Spurs " + h.spurLeft + '"/' + (h.spurRight||"?") + '"');
  if (h.bearColor)   stats.push(h.bearColor.charAt(0).toUpperCase() + h.bearColor.slice(1) + " phase");
  if (h.quantity && h.quantity > 1) stats.push("×" + h.quantity);

  return `
    <div style="margin-bottom:${isExp?"2":"8"}px">
      <button class="tc-row-header ${isExp?"expanded":""}"
        onclick="toggleTrophyEntry('${h.id}')" style="margin-bottom:0">
        <span style="font-size:28px;flex-shrink:0">${sp.icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:600;color:var(--text-warm)">${sp.label}</div>
          <div style="font-size:11px;color:var(--text-muted)">${dateStr}</div>
        </div>
        <span style="color:var(--gold);font-size:18px;flex-shrink:0;
                     transition:transform 0.2s;${isExp?"transform:rotate(90deg)":""}">›</span>
      </button>
      ${isExp ? `
        <div style="background:rgba(14,10,4,0.92);border:1px solid var(--gold-dim);
                    border-top:none;border-bottom-left-radius:var(--radius-lg);
                    border-bottom-right-radius:var(--radius-lg);padding:14px;margin-bottom:8px">
          ${stats.length > 0 ? `
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
              ${stats.map(s => `
                <span style="background:rgba(196,169,106,0.12);border:1px solid var(--gold-dim);
                             border-radius:20px;padding:4px 10px;font-size:12px;color:var(--gold)">
                  ${esc(s)}
                </span>`).join("")}
            </div>` : ""}
          ${h.notes ? `<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;
                                   line-height:1.5;font-style:italic;white-space:pre-wrap;word-break:break-word">"${esc(h.notes)}"</div>` : ""}
          ${h.photoURL ? `
            <img src="${esc(h.photoURL)}"
              style="width:100%;border-radius:var(--radius-md);margin-bottom:12px;
                     border:1px solid var(--card-border);display:block;
                     max-height:200px;object-fit:cover" />` : ""}
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary btn-sm" style="flex:1" onclick="goHarvest()">
              View in Harvest Log
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteHarvest('${h.id}')">
              🗑
            </button>
          </div>
        </div>` : ""}
    </div>`;
}

window.toggleTrophySection = function (key) {
  const el     = document.getElementById(key + "-content");
  const arrow  = document.getElementById(key + "-arrow");
  const header = document.getElementById(key + "-toggle");
  if (!el) return;
  const opening = el.classList.contains("hidden");
  el.classList.toggle("hidden", !opening);
  if (arrow)  arrow.style.transform = opening ? "rotate(90deg)" : "";
  if (header) header.classList.toggle("expanded", opening);
};

window.toggleTrophyEntry = function (id) {
  if (trophyExpanded.has(id)) trophyExpanded.delete(id);
  else trophyExpanded.add(id);
  const list = document.getElementById("troom-log-content");
  if (list) list.innerHTML = trophyEntries.map(renderTrophyEntry).join("");
};

// Service worker is registered in registerServiceWorker() (called on DOMContentLoaded),
// which also wires up update detection. No second registration needed here.

