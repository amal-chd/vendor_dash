/**
 * Firebase Cloud Messaging Service Worker.
 *
 * This file MUST live at the web root (`/firebase-messaging-sw.js`) so the
 * browser can register it with the correct scope. It handles background push
 * notifications — i.e. messages that arrive when the app tab is not focused.
 *
 * Foreground messages are handled by the React app via `onMessage()` in the
 * notification service.
 */

 
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

// Mirror the Firebase config from lib/firebase.ts.
// Service workers cannot import ES modules, so we duplicate the config here.
firebase.initializeApp({
  projectId: "kada-restaurant-os-v1",
  appId: "1:434348622340:web:0f651dcfce5714c2aa2b51",
  storageBucket: "kada-restaurant-os-v1.firebasestorage.app",
  apiKey: "AIzaSyBYYVtgpvq_Esn7NpLftweuZ0AzsdfHqTk",
  authDomain: "kada-restaurant-os-v1.firebaseapp.com",
  messagingSenderId: "434348622340",
});

const messaging = firebase.messaging();

/**
 * Background message handler.
 *
 * Called when a push arrives and the app is not in the foreground. If the
 * payload includes a `notification` key, the browser shows it automatically
 * and this handler is NOT called. We use `data`-only messages so we can
 * control the notification appearance.
 */
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const data = payload.data || {};
  const notification = payload.notification || {};
  
  const title = notification.title || data.title || "KADA";
  const options = {
    body: notification.body || data.body || "",
    icon: notification.icon || data.icon || "/logo.png",
    badge: data.badge || "/logo.png",
    tag: data.tag || `kada-${Date.now()}`,
    data: {
      url: data.deepLink || data.url || "/",
      entityType: data.entityType,
      entityId: data.entityId,
    },
  };

  self.registration.showNotification(title, options);
});

/**
 * Handle notification click — open the deep link or focus the existing tab.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // If a KADA tab is already open, focus it and navigate.
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      // Otherwise open a new tab.
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
