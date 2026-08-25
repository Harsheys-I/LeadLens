let storageUserId = null;

/** Scope IndexedDB + local/session keys to the logged-in user. Call after auth. */
export function setStorageUserId(userId){
  storageUserId = userId != null && userId !== "" ? String(userId) : null;
}

export function getStorageUserId(){
  return storageUserId;
}

/** Build a namespaced key: leadlens.u{id}.{suffix} or legacy leadlens.{suffix}. */
export function storageKey(suffix){
  return storageUserId ? `leadlens.u${storageUserId}.${suffix}` : `leadlens.${suffix}`;
}

function dbName(){
  return storageUserId ? `leadlens-audit-u${storageUserId}` : "leadlens-audit";
}

const STORE = "jobs";

function openDb(){
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName(), 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, {keyPath: "id"});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact(mode, action){
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      try { db.close(); } catch { /* already closing */ }
      fn(value);
    };
    const tx = db.transaction(STORE, mode);
    let result;
    const request = action(tx.objectStore(STORE));
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => finish(reject, request.error);
    tx.oncomplete = () => finish(resolve, result);
    tx.onabort = () => finish(reject, tx.error || new Error("IndexedDB transaction aborted"));
    tx.onerror = () => finish(reject, tx.error || request.error);
  });
}

export const putJob = job => transact("readwrite", store => store.put(job));
export const getJob = id => transact("readonly", store => store.get(id));
export const deleteJob = id => transact("readwrite", store => store.delete(id));
export const clearJobs = () => transact("readwrite", store => store.clear());
export async function getJobs(){
  const jobs = await transact("readonly", store => store.getAll());
  return jobs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export function loadSettings(defaults){
  try { return {...defaults, ...JSON.parse(localStorage.getItem(storageKey("settings")) || "{}")}; }
  catch { return {...defaults}; }
}
export function saveSettings(settings){ localStorage.setItem(storageKey("settings"), JSON.stringify(settings)); }
export function getApiKey(){ return sessionStorage.getItem(storageKey("openaiKey")) || localStorage.getItem(storageKey("openaiKey")) || ""; }
export function apiKeyIsRemembered(){ return Boolean(localStorage.getItem(storageKey("openaiKey"))); }
export function saveApiKey(key, remember){
  const keyName = storageKey("openaiKey");
  sessionStorage.setItem(keyName, key);
  if (remember) localStorage.setItem(keyName, key); else localStorage.removeItem(keyName);
}
export function forgetApiKey(){
  const keyName = storageKey("openaiKey");
  sessionStorage.removeItem(keyName);
  localStorage.removeItem(keyName);
}
