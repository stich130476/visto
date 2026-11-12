// Visto! — service worker solo per le notifiche (nessuna cache, così gli aggiornamenti restano immediati)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch(_) { d = {title: 'Visto!', body: e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(d.title || 'Visto!', {
    body: d.body || '', icon: 'icona-192.png', badge: 'icona-192.png', tag: d.tag, data: {url: d.url || './'}
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({type: 'window', includeUncontrolled: true}).then(ws => {
    for (const w of ws) if ('focus' in w) return w.focus();
    return clients.openWindow(e.notification.data && e.notification.data.url || './');
  }));
});
