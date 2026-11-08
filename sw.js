// Service worker: เก็บไฟล์หน้าแอปไว้ให้เปิดเร็วและเปิดได้แม้สัญญาณช้า (ข้อมูลยังต้องใช้อินเทอร์เน็ต)
const VERSION = 'yc-v4';
const ASSETS = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest',
  'assets/logo.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('script.google.com') || url.hostname.endsWith('googleusercontent.com')) return; // ไม่แตะ API
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !fonts) return;
  if (fonts) {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  // ไฟล์ของแอป: ลองเน็ตก่อนเพื่อให้ได้เวอร์ชันล่าสุด ถ้าไม่ได้ค่อยใช้ที่เก็บไว้
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return r;
  }).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
});
