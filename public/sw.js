// Service worker: shows reminder notifications and opens the app when one is tapped.
// No caching yet, so the app always loads fresh.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  // iOS requires every push to show a notification, so always show one.
  event.waitUntil(self.registration.showNotification(data.title || 'Work Tracker', {
    body: data.body || '',
    tag: data.tag || undefined,
    icon: '/icon-180.png',
    badge: '/icon-180.png',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => w.url.startsWith(self.location.origin));
    if (open) {
      await open.focus();
      return open.navigate ? open.navigate(url) : undefined;
    }
    return self.clients.openWindow(url);
  })());
});
