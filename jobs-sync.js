/**
 * Shared History sync: IndexedDB <-> MySQL audit_jobs (full job JSON).
 */
import {JobsApi} from './api-client.js?v=5.1.0';
import {putJob, getJob, getJobs, deleteJob, clearJobs} from './db.js?v=5.1.0';
import {getUser, hasPermission} from './auth.js?v=5.1.0';

const pushTimers = new Map();
const PUSH_DEBOUNCE_MS = 2000;

function canSync(){
  try {
    return hasPermission('telecaller.history');
  } catch {
    return false;
  }
}

function stampOwner(job){
  if (!job || typeof job !== 'object') return job;
  const user = getUser();
  if (!user) return job;
  if (!job.ownerUserId) job.ownerUserId = user.id;
  if (!job.ownerName) job.ownerName = user.display_name || user.username || '';
  return job;
}

async function pushNow(job){
  if (!canSync() || !job?.id) return;
  stampOwner(job);
  try {
    await JobsApi.upsert(job);
  } catch {
    /* offline / forbidden — local copy remains */
  }
}

export function scheduleJobPush(job){
  if (!canSync() || !job?.id) return;
  stampOwner(job);
  const prior = pushTimers.get(job.id);
  if (prior) clearTimeout(prior);
  if (job.status === 'running' || job.status === 'reviewing') {
    pushTimers.set(job.id, setTimeout(() => {
      pushTimers.delete(job.id);
      pushNow(job);
    }, PUSH_DEBOUNCE_MS));
    return;
  }
  pushTimers.delete(job.id);
  pushNow(job);
}

export async function persistJob(job){
  stampOwner(job);
  await putJob(job);
  scheduleJobPush(job);
  return job;
}

export async function removeJobSynced(jobId){
  const prior = pushTimers.get(jobId);
  if (prior) {
    clearTimeout(prior);
    pushTimers.delete(jobId);
  }
  await deleteJob(jobId);
  if (!canSync()) return;
  try {
    await JobsApi.remove(jobId);
  } catch {
    /* ignore */
  }
}

export async function clearJobsSynced(){
  for (const timer of pushTimers.values()) clearTimeout(timer);
  pushTimers.clear();
  await clearJobs();
  if (!canSync()) return;
  try {
    await JobsApi.clear();
  } catch {
    /* ignore */
  }
}

/**
 * Pull shared jobs: for each remote job newer/missing locally, fetch full payload into IDB.
 * @returns {number} count of jobs written/updated locally
 */
export async function pullJobsFromServer(){
  if (!canSync()) return 0;
  let listed;
  try {
    listed = await JobsApi.list();
  } catch {
    return 0;
  }
  const remote = listed.jobs || [];
  if (!remote.length) return 0;
  const localJobs = await getJobs();
  const localById = new Map(localJobs.map(j => [j.id, j]));
  let written = 0;
  for (const meta of remote) {
    const id = meta.job_id;
    if (!id) continue;
    const local = localById.get(id);
    const remoteUpdated = String(meta.client_updated_at || '');
    const localUpdated = String(local?.updatedAt || '');
    if (local && localUpdated && remoteUpdated && strcmpIso(remoteUpdated, localUpdated) <= 0) {
      continue;
    }
    try {
      const data = await JobsApi.get(id);
      const job = data.job;
      if (!job || !job.id) continue;
      if (!job.ownerName && meta.owner_name) job.ownerName = meta.owner_name;
      if (!job.ownerUserId && meta.owner_user_id) job.ownerUserId = meta.owner_user_id;
      await putJob(job);
      written++;
    } catch {
      /* skip one bad row */
    }
  }
  return written;
}

function strcmpIso(a, b){
  return String(a).localeCompare(String(b));
}

export {getJob, getJobs};
