// LeadLens intentionally does not cache application code. Audit rules can change
// frequently, and GitHub Pages must always serve the latest deployed version.
self.addEventListener("install", event => {
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});
