// Upscroll service worker: the app opens instantly and offline.
// Page: network first with a short timeout, falling back to the cached copy. Fonts: cache first, kept separately.
const SHELL_CACHE = "upscroll-shell-v2";
const FONT_CACHE = "upscroll-fonts-v1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  const keep = new Set([SHELL_CACHE, FONT_CACHE]);
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const cacheable = (res) => res && res.status === 200 && (res.type === "basic" || res.type === "cors");

function networkFirst(e, req) {
  const network = fetch(req).then((res) => {
    if (cacheable(res)) {
      const copy = res.clone();
      e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.put(req, copy)));
    }
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, 2500));
  const cached = () => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("./index.html"));
  return Promise.race([network, timeout.then(cached)])
    .then((res) => res || network)
    .catch(() => cached());
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(networkFirst(e, req));
  } else if (url.hostname.endsWith("gstatic.com") || url.hostname.endsWith("googleapis.com")) {
    e.respondWith(caches.open(FONT_CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (cacheable(res)) e.waitUntil(c.put(req, res.clone()));
      return res;
    }))));
  }
});
