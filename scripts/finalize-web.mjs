// Post-processes the Expo web export (dist/) into a polished, installable PWA
// for mobile Safari. Runs after `expo export --platform web`.
//   • proper mobile viewport (no Safari pinch-zoom jank)
//   • theme color + apple-mobile-web-app meta (fullscreen Add-to-Home-Screen)
//   • system font stack + momentum scrolling
//   • a branded splash overlay so there's no white flash while the JS loads
//   • web manifest + service worker + icons

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dist = join(process.cwd(), "dist");
const indexPath = join(dist, "index.html");
let html = readFileSync(indexPath, "utf8");

// 1) Mobile viewport — lock zoom so Safari doesn't jump on input focus.
html = html.replace(
  /<meta name="viewport"[^>]*\/>/,
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />',
);

// 2) <head> additions: PWA + Safari meta, system fonts, momentum scroll, splash CSS.
const headInject = `
    <meta name="theme-color" content="#1570EF" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="XportACar Inspector" />
    <meta name="mobile-web-app-capable" content="yes" />
    <link rel="manifest" href="/manifest.json" />
    <link rel="apple-touch-icon" href="/icon-192.png" />
    <style id="xpc-web-polish">
      #root, body, input, textarea, button, select {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }
      * { -webkit-overflow-scrolling: touch; }
      html, body { overscroll-behavior: none; }
      #app-splash {
        position: fixed; inset: 0; z-index: 99999;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        background: linear-gradient(135deg, #1570EF, #175CD3);
        transition: opacity .35s ease;
      }
      #app-splash .xpc-brand { color: #fff; font-size: 26px; font-weight: 800; letter-spacing: .3px; }
      #app-splash .xpc-sub { color: rgba(255,255,255,.82); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; margin-top: 8px; }
      #app-splash .xpc-spin { margin-top: 24px; width: 30px; height: 30px; border-radius: 50%; border: 3px solid rgba(255,255,255,.3); border-top-color: #fff; animation: xpc-spin .8s linear infinite; }
      @keyframes xpc-spin { to { transform: rotate(360deg); } }
    </style>
`;
html = html.replace("</head>", `${headInject}  </head>`);

// 3) Splash overlay + mount observer + service-worker registration (after #root).
const bodyInject = `
    <div id="app-splash" aria-hidden="true">
      <div class="xpc-brand">Xport<span style="color:#84CAFF">A</span>Car</div>
      <div class="xpc-sub">Inspector Portal</div>
      <div class="xpc-spin"></div>
    </div>
    <script>
      (function () {
        var root = document.getElementById('root');
        function hide() {
          var s = document.getElementById('app-splash');
          if (!s) return;
          s.style.opacity = '0';
          setTimeout(function () { if (s && s.parentNode) s.parentNode.removeChild(s); }, 400);
        }
        if (root) {
          var o = new MutationObserver(function () {
            if (root.childElementCount > 0) { o.disconnect(); hide(); }
          });
          o.observe(root, { childList: true });
        }
        setTimeout(hide, 8000); // safety fallback
        if ('serviceWorker' in navigator) {
          window.addEventListener('load', function () {
            navigator.serviceWorker.register('/sw.js').catch(function () {});
          });
        }
      })();
    </script>
`;
html = html.replace('<div id="root"></div>', `<div id="root"></div>${bodyInject}`);

writeFileSync(indexPath, html);

// 4) Web manifest — standalone install, brand blue.
const manifest = {
  name: "XportACar Inspector",
  short_name: "Inspector",
  description: "XportACar vehicle inspection portal",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#1570EF",
  theme_color: "#1570EF",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ],
};
writeFileSync(join(dist, "manifest.json"), JSON.stringify(manifest, null, 2));

// 5) Service worker — network-first (always fresh online, cache fallback offline)
// so redeploys never serve a stale bundle.
const sw = `const CACHE = 'xpc-inspector-v1';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200 && req.url.indexOf(self.location.origin) === 0) {
        var clone = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, clone); });
      }
      return res;
    }).catch(function () { return caches.match(req); })
  );
});
`;
writeFileSync(join(dist, "sw.js"), sw);

// 6) Icons — reuse the app icon (browsers scale to 192/512).
const iconSrc = join(process.cwd(), "assets", "icon.png");
if (existsSync(iconSrc)) {
  copyFileSync(iconSrc, join(dist, "icon-192.png"));
  copyFileSync(iconSrc, join(dist, "icon-512.png"));
} else {
  console.warn("! assets/icon.png not found — manifest icons may 404");
}

console.log("✓ finalize-web: patched index.html + wrote manifest.json, sw.js, icons");
