/* 통신이 안 되는 곳에서도 앱이 열리도록 화면 파일을 폰에 보관한다.
 * 파일을 고쳐 올릴 때마다 VERSION 을 바꾸면 폰이 새 파일을 받는다. 구글 시트 주소(다른 사이트)는 건드리지 않는다. */
const VERSION = "rm-2026-10-30-1";
const SHELL = ["./", "index.html", "app.js", "config.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "catalogs.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
/* 먼저 새로 받아 보고, 안 되면 보관본을 쓴다 */
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
