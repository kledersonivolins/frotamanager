// Service worker: permite instalar o app e abre a tela mesmo com rede ruim.
// Dados (Supabase, mapa, endereços) sempre vêm da rede.
const CACHE = 'corridas-v1';
const ARQUIVOS = ['./', './index.html', './manifest.json', './icons/icon-192x192.png', './icons/icon-512x512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((chaves) =>
    Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Rede primeiro; cache só como reserva para os arquivos do próprio app.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copia));
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html'))),
  );
});
