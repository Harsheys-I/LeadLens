/**
 * Sales Graph module — published Dashboard (data via ERP Sync / API).
 */
import {APP_VERSION} from "./audit.js?v=10.0.0.stable";
import {requireAuth, logout, hasPermission, getUser, changePassword, updateProfile} from "./auth.js?v=10.0.0.stable";
import {SalesGraphApi} from "./api-client.js?v=10.0.0.stable";
import {mountNotifications} from "./notifications-ui.js?v=10.0.0.stable";
import {appUrl, homePath} from "./app-base.js?v=10.0.0.stable";
import {initTheme} from "./theme.js?v=10.0.0.stable";
import {setStorageUserId, storageKey} from "./db.js?v=10.0.0.stable";
import {renderSalesGraphDashboard, destroySalesGraphCharts} from "./sales-graph-dashboard.js?v=10.0.0.stable";

const $ = id => document.getElementById(id);
const ids = [
  "page-title", "toast", "mobile-menu", "sidebar-version", "sidebar-notes",
  "update-banner", "update-banner-text", "reload-app",
  "shell-user-label", "shell-logout", "shell-account",
  "sg-published-meta", "sg-refresh-dashboard", "sg-clear-dashboard",
  "sg-dashboard-empty", "sg-dashboard-mount",
];
const els = Object.fromEntries(ids.map(id => [id, $(id)]));
if (els["sidebar-version"]) els["sidebar-version"].textContent = `v${APP_VERSION}`;

const titles = {dashboard: "Dashboard"};
const RELEASE_NOTES = "v10.0.0.stable: ERP Sync GHA-only — charts sync via GitHub Actions; manual Excel upload removed from the app.";

function toast(message) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("show"), 3200);
}

function formatPublishedWhen(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  if (match) return `${match[1]} ${match[2]}`;
  return raw.replace("T", " ").replace(/[+-]\d{2}:\d{2}$/, "").replace(/Z$/, "");
}

function canClearBoard() {
  const user = getUser();
  if (!user) return false;
  return Boolean(user.is_super || hasPermission("dashboards.view_all") || hasPermission("admin.users"));
}

function showView(name) {
  const btn = document.querySelector(`.nav-item[data-view="${name}"]:not(.hidden)`)
    || document.querySelector(`.nav-item[data-view="${name}"]`);
  if (btn?.dataset.perm && !hasPermission(btn.dataset.perm) && !getUser()?.is_super) {
    toast("You do not have permission for this screen.");
    return;
  }
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id === `view-${name}`));
  document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === name));
  if (els["page-title"]) els["page-title"].textContent = titles[name] || titles.dashboard;
  document.querySelector(".shell")?.classList.remove("menu-open");
  if (name === "dashboard") refreshPublishedDashboard();
}

async function refreshPublishedDashboard() {
  const mount = els["sg-dashboard-mount"];
  const empty = els["sg-dashboard-empty"];
  const metaEl = els["sg-published-meta"];
  if (!mount) return;
  if (!hasPermission("sales_graph.dashboard") && !getUser()?.is_super) {
    destroySalesGraphCharts();
    mount.replaceChildren();
    if (empty) {
      empty.classList.remove("hidden");
      empty.textContent = "Dashboard access is not enabled for your role.";
    }
    return;
  }
  if (metaEl) metaEl.textContent = "Loading...";
  try {
    const data = await SalesGraphApi.latest();
    const payload = data?.payload || null;
    const meta = data?.meta || null;
    const dash = data?.dashboard || null;
    if (!payload) {
      destroySalesGraphCharts();
      mount.replaceChildren();
      empty?.classList.remove("hidden");
      if (empty) empty.textContent = "No Sales Graph has been published yet.";
      if (metaEl) metaEl.textContent = "Published Leads, Visits & Booked from ERP Sync.";
      return;
    }
    empty?.classList.add("hidden");
    if (metaEl) {
      const bits = [dash?.title || payload.title || "Sales Graph"];
      if (meta?.uploaded_by_name || dash?.uploaded_by_name) bits.push(`by ${meta?.uploaded_by_name || dash?.uploaded_by_name}`);
      const when = formatPublishedWhen(dash?.updated_at || meta?.uploaded_at);
      if (when) bits.push(when);
      metaEl.textContent = bits.join(" | ");
    }
    renderSalesGraphDashboard(mount, payload, {meta: {...(meta || {}), uploaded_by_name: meta?.uploaded_by_name || dash?.uploaded_by_name}});
  } catch (err) {
    destroySalesGraphCharts();
    mount.replaceChildren();
    empty?.classList.remove("hidden");
    if (empty) empty.textContent = err.message || "Could not load published dashboard.";
    if (metaEl) metaEl.textContent = "Failed to load.";
  }
}

async function clearPublishedBoard() {
  if (!canClearBoard()) {
    toast("Clear not permitted for your role.");
    return;
  }
  if (!confirm("Clear the published Sales Graph board for everyone?")) return;
  try {
    await SalesGraphApi.removeAll();
    toast("Sales Graph board cleared");
    await refreshPublishedDashboard();
  } catch (err) {
    toast(err.message || "Clear failed");
  }
}

function readSidebarCollapsedPref() {
  try { return localStorage.getItem(storageKey("sidebarCollapsed")) === "1"; }
  catch { return false; }
}
function writeSidebarCollapsedPref(collapsed) {
  try { localStorage.setItem(storageKey("sidebarCollapsed"), collapsed ? "1" : "0"); }
  catch { /* ignore */ }
}
function applySidebarCollapsed(collapsed, {persist = true} = {}) {
  const shell = document.querySelector(".shell");
  if (!shell) return;
  shell.classList.toggle("sidebar-collapsed", Boolean(collapsed));
  const btn = els["mobile-menu"];
  if (btn) {
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    btn.setAttribute("aria-label", collapsed ? "Show left panel" : "Hide left panel");
    btn.title = collapsed ? "Show left panel" : "Hide left panel";
  }
  if (persist) writeSidebarCollapsedPref(Boolean(collapsed));
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}

function renderSidebarRelease(version = APP_VERSION, notes = "") {
  if (els["sidebar-version"]) els["sidebar-version"].textContent = `v${version}`;
  if (els["sidebar-notes"] && notes) els["sidebar-notes"].textContent = notes;
}

function normalizeVersion(v) {
  return String(v || "").trim().replace(/^v/i, "");
}

function pageShellVersion() {
  const meta = document.querySelector('meta[name="app-version"]');
  if (meta?.content) return normalizeVersion(meta.content);
  const mod = document.querySelector('script[type="module"][src*="sales-graph"]');
  const m = mod?.getAttribute("src")?.match(/[?&]v=([^&]+)/);
  return m ? normalizeVersion(decodeURIComponent(m[1])) : "";
}

function isNewerVersion(candidate, current) {
  const parse = v => {
    const m = normalizeVersion(v).match(/^(\d+)\.(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const a = parse(candidate);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function showUpdateBanner(latest) {
  if (!els["update-banner"]) return;
  els["update-banner"].classList.remove("hidden");
  const box = els["update-banner-text"];
  if (!box) return;
  box.replaceChildren();
  box.append(`GPP AI v${latest} is available (you are on v${APP_VERSION}). Hard-reload to update.`);
}

/**
 * Prompt only when version.json is strictly newer than the running build.
 * Suppress when remote already matches APP_VERSION or the page shell cache-bust
 * (avoids false positives when one lagged ESM import still exports an older APP_VERSION).
 */
async function checkForUpdate() {
  renderSidebarRelease(APP_VERSION, RELEASE_NOTES);
  try {
    const response = await fetch(`../version.json?t=${Date.now()}`, {cache: "no-store"});
    if (!response.ok) return;
    const data = await response.json();
    const latest = normalizeVersion(data.version);
    const notes = String(data.notes || "").trim();
    const appV = normalizeVersion(APP_VERSION);
    const shellV = pageShellVersion();
    const alreadyCurrent = Boolean(latest) && (latest === appV || (shellV && latest === shellV));
    const newer = Boolean(latest) && isNewerVersion(latest, appV) && !alreadyCurrent;
    if (newer || alreadyCurrent) renderSidebarRelease(APP_VERSION, notes || RELEASE_NOTES);
    if (newer) showUpdateBanner(latest);
    else els["update-banner"]?.classList.add("hidden");
  } catch { /* offline */ }
}

// ---- events ----
document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => showView(button.dataset.view));
});

els["mobile-menu"]?.addEventListener("click", () => {
  const shell = document.querySelector(".shell");
  if (!shell) return;
  const narrow = window.matchMedia("(max-width:850px)").matches;
  if (narrow) {
    shell.classList.toggle("menu-open");
    return;
  }
  applySidebarCollapsed(!shell.classList.contains("sidebar-collapsed"));
});

els["shell-logout"]?.addEventListener("click", async () => {
  await logout();
  setStorageUserId(null);
  location.href = homePath();
});

els["shell-account"]?.addEventListener("click", () => {
  const user = getUser();
  const modal = document.getElementById("account-modal");
  if (!user || !modal) return;
  document.getElementById("account-username").value = user.username || "";
  document.getElementById("account-display").value = user.display_name || "";
  document.getElementById("account-telecaller").value = user.telecaller_name || "- set by Admin only -";
  document.getElementById("account-pw-current").value = "";
  document.getElementById("account-pw-new").value = "";
  document.getElementById("account-pw-confirm").value = "";
  document.getElementById("account-message").textContent = "";
  modal.classList.remove("hidden");
});
document.getElementById("account-cancel")?.addEventListener("click", () => {
  document.getElementById("account-modal")?.classList.add("hidden");
});
document.getElementById("account-save")?.addEventListener("click", async () => {
  const msg = document.getElementById("account-message");
  if (!msg) return;
  msg.textContent = "Saving...";
  try {
    const user = await updateProfile({
      username: document.getElementById("account-username").value.trim(),
      display_name: document.getElementById("account-display").value.trim(),
    });
    const pwCur = document.getElementById("account-pw-current").value;
    const pwNew = document.getElementById("account-pw-new").value;
    if (pwCur || pwNew) {
      if (pwNew !== document.getElementById("account-pw-confirm").value) {
        msg.textContent = "New passwords do not match.";
        return;
      }
      await changePassword(pwCur, pwNew);
    }
    if (els["shell-user-label"]) els["shell-user-label"].textContent = user.display_name || user.username;
    msg.textContent = "Account updated.";
    toast("Account saved");
    setTimeout(() => document.getElementById("account-modal")?.classList.add("hidden"), 400);
  } catch (err) {
    msg.textContent = err.message || "Could not update account";
  }
});

els["sg-refresh-dashboard"]?.addEventListener("click", () => refreshPublishedDashboard());
els["sg-clear-dashboard"]?.addEventListener("click", clearPublishedBoard);
els["reload-app"]?.addEventListener("click", async () => {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(reg => reg.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      // Delete every Cache Storage entry â€” not only leadlens-* â€” so a stuck SW
      // or third-party cache cannot keep serving stale modules.
      await Promise.all(keys.map(key => caches.delete(key)));
    }
  } catch { /* continue */ }
  const url = new URL(location.href);
  // Prefer remote version.json so a stale in-memory APP_VERSION cannot stamp an
  // old ?v= onto the reload URL and re-pin the broken shell.
  let bust = String(Date.now());
  try {
    const response = await fetch(`../version.json?t=${Date.now()}`, {cache: "no-store"});
    if (response.ok) {
      const data = await response.json();
      const remote = normalizeVersion(data.version);
      if (remote) bust = remote;
    }
  } catch { /* use timestamp */ }
  url.searchParams.set("v", bust);
  url.searchParams.set("_", String(Date.now()));
  location.replace(url.toString());
});

async function bootSalesGraph() {
  initTheme();
  const user = await requireAuth({loginPath: homePath()});
  if (!user) return;
  if (!hasPermission("module.sales_graph") && !user.is_super) {
    location.href = homePath();
    return;
  }

  setStorageUserId(user.id);
  applySidebarCollapsed(readSidebarCollapsedPref(), {persist: false});
  if (els["shell-user-label"]) els["shell-user-label"].textContent = user.display_name || user.username;

  document.querySelectorAll(".nav-item[data-perm]").forEach(btn => {
    const perm = btn.dataset.perm;
    if (perm && !hasPermission(perm) && !user.is_super) btn.classList.add("hidden");
  });

  if (els["sg-clear-dashboard"]) {
    els["sg-clear-dashboard"].classList.toggle("hidden", !canClearBoard());
  }
  const hashView = location.hash.slice(1);
  if (hashView === "dashboard" && (hasPermission("sales_graph.dashboard") || user.is_super)) showView("dashboard");
  else {
    const firstVisible = [...document.querySelectorAll(".nav-item[data-view]:not(.hidden)")][0];
    showView(firstVisible?.dataset.view || "dashboard");
  }

  checkForUpdate();
  mountNotifications({
    variant: "chrome",
    onOpenAccessRequests: () => { location.href = appUrl("/admin/"); },
  });
  window.addEventListener("hashchange", () => {
    if (location.hash === "#dashboard" && (hasPermission("sales_graph.dashboard") || getUser()?.is_super)) {
      showView("dashboard");
    }
  });
  setInterval(checkForUpdate, 5 * 60 * 1000);
}

bootSalesGraph();
