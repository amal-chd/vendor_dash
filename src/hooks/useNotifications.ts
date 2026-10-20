import { useEffect } from 'react';
import { getToken, onMessage, isSupported, getMessaging } from 'firebase/messaging';
import app, { db, functions } from '@/lib/firebase';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export const useNotifications = () => {
  const { user, restaurantId } = useAuth();

  useEffect(() => {
    if (!user || !restaurantId) return;

    let unsubscribe: (() => void) | undefined;
    let active = true;

    const setupNotifications = async () => {
      try {
        const supported = await isSupported();
        if (!supported || !active) return;

        const messaging = getMessaging(app);

        const permission = await Notification.requestPermission();
        if (permission === 'granted' && active) {
          const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
          if (!vapidKey) return; // Skip silently if key not configured

          const token = await getToken(messaging, { vapidKey });

          if (token) {
            // Subscribe the token to the restaurant's topic via Cloud Function
            try {
              const subscribeFn = httpsCallable(functions, 'subscribeDeviceToTopic');
              await subscribeFn({ token, topic: `restaurant_${restaurantId}` });

              // Also store it for reference
              await updateDoc(doc(db, 'restaurants', restaurantId), {
                fcmTokens: arrayUnion(token)
              });
            } catch (err) {
              console.error("Failed to subscribe device to topic:", err);
            }
          }
        }

        if (active) {
          unsubscribe = onMessage(messaging, (payload) => {
            try {
              const audio = new Audio('/ping.mp3');
              audio.volume = 0.5;
              audio.play().catch(() => {}); // ignore autoplay errors
            } catch (e) {
              // Ignore audio play errors
            }

            toast.info(payload.notification?.title || 'New Notification', {
              description: payload.notification?.body,
            });
          });
        }
      } catch {
        // Notifications are best-effort — don't surface errors to the user
      }
    };

    setupNotifications();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [user, restaurantId]);
};
