/**
 * Sales Graph module — Upload (Leads + Visits + Booked) + published Dashboard.
 */
import {APP_VERSION} from "./audit.js?v=6.1.1.stable";
import {requireAuth, logout, hasPermission, getUser, changePassword, updateProfile} from "./auth.js?v=6.1.1.stable";
import {SalesGraphApi} from "./api-client.js?v=6.1.1.stable";
import {mountNotifications} from "./notifications-ui.js?v=6.1.1.stable";
import {appUrl, homePath} from "./app-base.js?v=6.1.1.stable";
import {initTheme} from "./theme.js?v=6.1.1.stable";
import {setStorageUserId, storageKey} from "./db.js?v=6.1.1.stable";
import {parseSalesGraphSheet, buildSalesGraphPayload} from "./sales-graph-parse.js?v=6.1.1.stable";
import {renderSalesGraphDashboard, destroySalesGraphCharts} from "./sales-graph-dashboard.js?v=6.1.1.stable";

const $ = id => document.getElementById(id);
const ids = [
  "page-title", "toast", "mobile-menu", "sidebar-version", "sidebar-notes",
  "update-banner", "update-banner-text", "reload-app",
  "shell-user-label", "shell-logout", "shell-account",
  "sg-leads-drop", "sg-leads-input", "sg-visits-drop", "sg-visits-input",
  "sg-booked-drop", "sg-booked-input",
  "sg-file-list", "sg-validation", "sg-create-dashboard",
  "sg-preview-panel", "sg-preview-mount", "sg-upload-dashboard-btn",
  "sg-published-meta", "sg-refresh-dashboard", "sg-clear-dashboard",
  "sg-dashboard-empty", "sg-dashboard-mount",
];
const els = Object.fromEntries(ids.map(id => [id, $(id)]));
if (els["sidebar-version"]) els["sidebar-version"].textContent = `v${APP_VERSION}`;

const titles = {upload: "Upload", dashboard: "Dashboard"};
const RELEASE_NOTES = "v6.1.1.stable: Sales Graph global filters (Project, Source Name, Year, Month, Metrics).";

let leadsParsed = null;
let visitsParsed = null;
let bookedParsed = null;
let previewPayload = null;

function toast(message) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("show"), 3200);
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
  if (els["page-title"]) els["page-title"].textContent = titles[name] || titles.upload;
  document.querySelector(".shell")?.classList.remove("menu-open");
  if (name === "dashboard") refreshPublishedDashboard();
}

function wireDropZone(zone, input, onFiles) {
  if (!zone || !input) return;
  zone.classList.remove("drop-zone-disabled");
  zone.removeAttribute("aria-disabled");
  input.disabled = false;
  zone.tabIndex = 0;
  zone.onclick = () => input.click();
  zone.onkeydown = e => { if (["Enter", " "].includes(e.key)) input.click(); };
  for (const ev of ["dragenter", "dragover"]) {
    zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add("dragover"); });
  }
  for (const ev of ["dragleave", "drop"]) {
    zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove("dragover"); });
  }
  zone.addEventListener("drop", e => onFiles(e.dataTransfer?.files));
  input.onchange = () => onFiles(input.files);
}

function setValidation(messages, isError = false) {
  const box = els["sg-validation"];
  if (!box) return;
  if (!messages?.length) {
    box.classList.add("hidden");
    box.textContent = "";
    return;
  }
  box.classList.remove("hidden");
  box.classList.toggle("error", Boolean(isError));
  box.classList.toggle("warn", !isError);
  box.textContent = messages.join(" · ");
}

function renderFileList() {
  const list = els["sg-file-list"];
  if (!list) return;
  list.replaceChildren();
  const items = [];
  if (leadsParsed) {
    items.push(`Leads: ${leadsParsed.fileName || "workbook"}${leadsParsed.ok ? ` · ${leadsParsed.rows?.length || 0} rows` : " · error"}`);
  }
  if (visitsParsed) {
    items.push(`Visits: ${visitsParsed.fileName || "workbook"}${visitsParsed.ok ? ` · ${visitsParsed.rows?.length || 0} rows` : " · error"}`);
  }
  if (bookedParsed) {
    items.push(`Booked: ${bookedParsed.fileName || "workbook"}${bookedParsed.ok ? ` · ${bookedParsed.rows?.length || 0} rows` : " · error"}`);
  }
  if (!items.length) {
    list.classList.add("hidden");
    return;
  }
  list.classList.remove("hidden");
  for (const text of items) {
    const card = document.createElement("div");
    card.className = "file-card";
    card.textContent = text;
    list.append(card);
  }
}

function syncCreateState() {
  const ready = Boolean(leadsParsed?.ok && visitsParsed?.ok && bookedParsed?.ok);
  if (els["sg-create-dashboard"]) {
    els["sg-create-dashboard"].disabled = !ready || !hasPermission("sales_graph.upload");
  }
  const msgs = [];
  if (leadsParsed && !leadsParsed.ok) msgs.push(`Leads: ${leadsParsed.error}`);
  if (visitsParsed && !visitsParsed.ok) msgs.push(`Visits: ${visitsParsed.error}`);
  if (bookedParsed && !bookedParsed.ok) msgs.push(`Booked: ${bookedParsed.error}`);
  if (!leadsParsed) msgs.push("Leads Excel required");
  if (!visitsParsed) msgs.push("Visits Excel required");
  if (!bookedParsed) msgs.push("Booked Excel required");
  const hasError = Boolean(
    (leadsParsed && !leadsParsed.ok) ||
    (visitsParsed && !visitsParsed.ok) ||
    (bookedParsed && !bookedParsed.ok)
  );
  if (ready) setValidation(["Ready — Create Dashboard for a local preview."], false);
  else setValidation(msgs, hasError);
}

async function loadFile(kind, file) {
  if (!file) return;
  try {
    const buffer = await file.arrayBuffer();
    const parsed = parseSalesGraphSheet(buffer, {fileName: file.name, kind});
    if (kind === "leads") leadsParsed = parsed;
    else if (kind === "visits") visitsParsed = parsed;
    else bookedParsed = parsed;
    previewPayload = null;
    els["sg-preview-panel"]?.classList.add("hidden");
    if (els["sg-upload-dashboard-btn"]) els["sg-upload-dashboard-btn"].disabled = true;
  } catch (err) {
    const fail = {ok: false, error: err.message || "Could not read workbook.", fileName: file.name, rows: []};
    if (kind === "leads") leadsParsed = fail;
    else if (kind === "visits") visitsParsed = fail;
    else bookedParsed = fail;
  }
  renderFileList();
  syncCreateState();
}

function createPreview() {
  if (!hasPermission("sales_graph.upload") && !getUser()?.is_super) {
    toast("Upload not permitted for your role.");
    return;
  }
  if (!leadsParsed?.ok || !visitsParsed?.ok || !bookedParsed?.ok) return;
  try {
    previewPayload = buildSalesGraphPayload(leadsParsed, visitsParsed, bookedParsed, {title: "Sales Graph"});
  } catch (err) {
    setValidation([err.message || "Could not build dashboard"], true);
    toast(err.message || "Could not build dashboard");
    return;
  }
  els["sg-preview-panel"]?.classList.remove("hidden");
  renderSalesGraphDashboard(els["sg-preview-mount"], previewPayload, {preview: true});
  if (els["sg-upload-dashboard-btn"]) {
    const canPub = hasPermission("sales_graph.publish");
    els["sg-upload-dashboard-btn"].disabled = !canPub;
    els["sg-upload-dashboard-btn"].title = canPub ? "" : "Publish not permitted for your role.";
  }
  toast("Preview ready");
}

async function publishDashboard() {
  if (!hasPermission("sales_graph.publish") && !getUser()?.is_super) {
    toast("Publish not permitted for your role.");
    return;
  }
  if (!previewPayload) {
    toast("Create a dashboard preview first.");
    return;
  }
  const btn = els["sg-upload-dashboard-btn"];
  if (btn) btn.disabled = true;
  try {
    const res = await SalesGraphApi.publish(previewPayload, {title: previewPayload.title || "Sales Graph"});
    const cleared = Number(res?.cleared || 0);
    toast(cleared > 0 ? "Previous board cleared; Sales Graph published" : "Sales Graph published");
    if (hasPermission("sales_graph.dashboard")) {
      location.hash = "#dashboard";
      showView("dashboard");
    }
  } catch (err) {
    toast(err.message || "Publish failed");
  } finally {
    if (btn) btn.disabled = !hasPermission("sales_graph.publish");
  }
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
  if (metaEl) metaEl.textContent = "Loading…";
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
      if (metaEl) metaEl.textContent = "Published Leads, Visits & Booked from the latest upload.";
      return;
    }
    empty?.classList.add("hidden");
    if (metaEl) {
      const bits = [dash?.title || payload.title || "Sales Graph"];
      if (meta?.uploaded_by_name || dash?.uploaded_by_name) bits.push(`by ${meta?.uploaded_by_name || dash?.uploaded_by_name}`);
      if (dash?.updated_at || meta?.uploaded_at) bits.push(String(dash?.updated_at || meta?.uploaded_at));
      metaEl.textContent = bits.join(" · ");
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

// —— events ——
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
  document.getElementById("account-telecaller").value = user.telecaller_name || "— set by Admin only —";
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
  msg.textContent = "Saving…";
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

wireDropZone(els["sg-leads-drop"], els["sg-leads-input"], files => {
  if (files?.[0]) loadFile("leads", files[0]);
});
wireDropZone(els["sg-visits-drop"], els["sg-visits-input"], files => {
  if (files?.[0]) loadFile("visits", files[0]);
});
wireDropZone(els["sg-booked-drop"], els["sg-booked-input"], files => {
  if (files?.[0]) loadFile("booked", files[0]);
});

els["sg-create-dashboard"]?.addEventListener("click", createPreview);
els["sg-upload-dashboard-btn"]?.addEventListener("click", publishDashboard);
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
      // Delete every Cache Storage entry — not only leadlens-* — so a stuck SW
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
  if (!hasPermission("sales_graph.upload") && !user.is_super) {
    els["sg-create-dashboard"] && (els["sg-create-dashboard"].disabled = true);
  }

  const hashView = location.hash.slice(1);
  if (hashView === "dashboard" && (hasPermission("sales_graph.dashboard") || user.is_super)) showView("dashboard");
  else {
    const firstVisible = [...document.querySelectorAll(".nav-item[data-view]:not(.hidden)")][0];
    showView(firstVisible?.dataset.view || "upload");
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
    if (location.hash === "#upload" && (hasPermission("sales_graph.upload") || getUser()?.is_super)) {
      showView("upload");
    }
  });
  setInterval(checkForUpdate, 5 * 60 * 1000);
}

bootSalesGraph();
