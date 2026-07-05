// Service Worker - 直播答题 PWA 离线支持
const CACHE_NAME = "quiz-pwa-v3";
const CACHE_URLS = [
  "./",
  "./index.html",
  "./settings.html",
  "./css/styles.css",
  "./js/storage.js",
  "./js/app.js",
  "./js/settings.js",
  "./DouyinLiveWS.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// 安装：预缓存核心资源
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(CACHE_URLS).catch((err) => {
        console.warn("[SW] 部分资源缓存失败:", err);
      })
    )
  );
  self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// 请求拦截：统一 network-first（保证更新即时生效），离线回退缓存
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // WebSocket 不走缓存
  if (req.url.startsWith("ws://") || req.url.startsWith("wss://")) return;

  event.respondWith(
    fetch(req)
      .then((resp) => {
        // 缓存成功的同源响应，供离线使用
        if (resp.ok && new URL(req.url).origin === self.location.origin) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return resp;
      })
      .catch(() =>
        caches.match(req).then((c) => c || caches.match("./index.html"))
      )
  );
});
