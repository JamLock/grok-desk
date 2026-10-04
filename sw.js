/* Grok Desk static shell. Snapshot only — no trading keys. */
const BASE = new URL("./", self.location).pathname;
const CACHE = "grok-desk-shell-v1";
const SHELL = [
  "",
  "index.html",
  "app.html",
  "dashboard.html",
  "data.json",
  "manifest.webmanifest",
  "app/icons/icon-192.png",
  "app/icons/icon-512.png",
  "app/icons/apple-touch-icon.png",
  "app/icons/icon.svg"
].map(function (p) { return BASE + p; });

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (event) {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/api/") !== -1) return;
  const path = url.pathname;
  if (SHELL.indexOf(path) === -1 && path.indexOf(BASE + "app/") !== 0) return;
  event.respondWith(caches.match(event.request).then(function (cached) {
    const net = fetch(event.request).then(function (res) {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(event.request, copy); });
      }
      return res;
    }).catch(function () { return cached; });
    return cached || net;
  }));
});
