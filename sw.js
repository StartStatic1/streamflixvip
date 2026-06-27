// ⚡ Incrementa esta versão a cada deploy para forçar atualização
const CACHE_VERSION = 'v3';
const CACHE_NAME = `streamflixvip-${CACHE_VERSION}`;

// Apenas assets estáticos que raramente mudam
const STATIC_ASSETS = [
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  // Força ativação imediata sem esperar a aba fechar
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
  // Assume controle de todas as abas abertas imediatamente
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Ignora requisições externas (APIs, CDNs)
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  // ✅ NETWORK-FIRST para HTML: sempre busca versão mais nova
  if (
    event.request.headers.get('accept') &&
    event.request.headers.get('accept').includes('text/html')
  ) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          // Atualiza cache com versão nova
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request)) // Fallback offline
    );
    return;
  }

  // Cache-first para outros assets (ícones, fontes)
  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      });
      return cached || network;
    })
  );
});
