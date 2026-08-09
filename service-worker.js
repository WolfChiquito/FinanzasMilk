// Service Worker de "Cuentas Personales".
// Objetivo principal: permitir instalar la app en la pantalla de inicio
// (requisito de iOS para poder usar notificaciones) y dar una base mínima de
// funcionamiento offline. No cachea datos de Firebase/Firestore, solo el
// "cascarón" de la app (HTML, manifest e íconos).

const CACHE_VERSION = 'v1';
const CACHE_NAME = `cuentas-personales-shell-${CACHE_VERSION}`;

const APP_SHELL = [
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((err) => console.warn('SW: no se pudo pre-cachear todo el app shell', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('cuentas-personales-shell-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo manejamos peticiones GET del mismo origen (el cascarón de la app).
  // Todo lo demás (Firebase, Firestore, APIs externas, fuentes, CDNs) pasa
  // directo a la red sin pasar por el caché, para no interferir con los
  // datos en tiempo real de la app.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  // Para la navegación (abrir/recargar la app): red primero, así siempre se
  // obtiene la versión más reciente cuando hay internet; si no hay conexión,
  // cae al cascarón guardado en caché.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', resClone));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Para el resto de archivos estáticos del cascarón: caché primero (más
  // rápido), y de fondo se actualiza el caché si hay red.
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

// Si en el futuro se agrega un servidor de push real, este evento ya queda
// listo para recibirlo y mostrar la notificación desde el Service Worker
// (más confiable que mostrarla desde la pestaña, especialmente en segundo
// plano).
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch (e) {
    payload = { title: 'Cuentas Personales', body: event.data.text() };
  }
  const title = payload.title || 'Cuentas Personales';
  const options = {
    body: payload.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png'
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Al tocar una notificación, enfoca la pestaña de la app si ya está abierta,
// o abre una nueva si no lo está.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});
