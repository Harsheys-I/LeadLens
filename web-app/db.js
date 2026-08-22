const DB_NAME = "leadlens-audit";
const STORE = "jobs";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export const putJob = job => transact("readwrite", store => store.put(job));
export const getJob = id => transact("readonly", store => store.get(id));
export const deleteJob = id => transact("readwrite", store => store.delete(id));
export const clearJobs = () => transact("readwrite", store => store.clear());
export async function getJobs() {
  const jobs = await transact("readonly", store => store.getAll());
  return jobs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

const SETTINGS_KEY = "leadlens.settings";
const LOCAL_API_KEY = "leadlens.openaiKey";
const SESSION_API_KEY = "leadlens.openaiKey";

export function loadSettings(defaults) {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; }
  catch { return { ...defaults }; }
}
export function saveSettings(settings) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
export function getApiKey() { return sessionStorage.getItem(SESSION_API_KEY) || localStorage.getItem(LOCAL_API_KEY) || ""; }
export function apiKeyIsRemembered() { return Boolean(localStorage.getItem(LOCAL_API_KEY)); }
export function saveApiKey(key, remember) {
  sessionStorage.setItem(SESSION_API_KEY, key);
  if (remember) localStorage.setItem(LOCAL_API_KEY, key); else localStorage.removeItem(LOCAL_API_KEY);
}
export function forgetApiKey() { sessionStorage.removeItem(SESSION_API_KEY); localStorage.removeItem(LOCAL_API_KEY); }
