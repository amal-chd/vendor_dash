import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { db } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { PLANS, Plan, Capability } from '@/constants/plans';

export function useSubscription() {
  const { user, restaurantId } = useAuth();
  const [subscription, setSubscription] = useState<{
    plan: Plan;
    status: string;
    endDate: string | null;
    daysLeft: number | null;
    isExpired: boolean;
    billingModel: 'commission' | 'subscription';
    cancelAtPeriodEnd: boolean;
  }>({
    plan: PLANS[0], // Default to Starter
    // Default to 'pending' rather than 'active'. Defaulting to 'active' meant
    // a Firestore read failure silently unlocked the dashboard for any user.
    status: 'pending',
    endDate: null,
    daysLeft: null,
    isExpired: false,
    billingModel: 'commission',
    cancelAtPeriodEnd: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !restaurantId) {
      setLoading(false);
      return;
    }

    // Outlet sub-accounts inherit subscription from the parent restaurant —
    // read the effective restaurant doc, never `user.uid` directly.
    const docRef = doc(db, "restaurants", restaurantId);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        // The web checkout (functions/src/subscriptionBilling.ts) writes the
        // plan id to `subscriptionPlan`; `subscriptionType` is the billing
        // PERIOD (monthly/yearly), so reading it alone left every paying
        // merchant labelled — and capability-gated — as Starter.
        let planId = PLANS.some(p => p.id === data.subscriptionPlan) ? data.subscriptionPlan : data.planTier;
        if (!planId) {
          if (data.subscriptionType && PLANS.some(p => p.id === data.subscriptionType)) {
            planId = data.subscriptionType;
          } else {
            planId = 'starter';
          }
        }
        const userPlan = PLANS.find(p => p.id === planId) || PLANS[0];
        // Status comes from Firestore; only mark active if the doc explicitly
        // says so. Treat anything else (missing, paused, expired, blocked)
        // conservatively.
        const status = data.subscriptionStatus || 'pending';
        const rawEndDate = data.subscriptionEndDate;
        let endDateStr: string | null = null;
        let daysLeft = null;
        let isExpired = false;

        if (rawEndDate) {
          let endDate: Date | null = null;
          if (typeof rawEndDate === 'object' && 'seconds' in rawEndDate) {
            endDate = new Date(rawEndDate.seconds * 1000);
          } else {
            endDate = new Date(rawEndDate);
          }

          if (endDate && !isNaN(endDate.getTime())) {
            endDateStr = endDate.toISOString();
            const diff = endDate.getTime() - new Date().getTime();
            daysLeft = Math.ceil(diff / (1000 * 60 * 60 * 24));
            if (daysLeft <= 0) isExpired = true;
          }
        }

        setSubscription({
          plan: userPlan,
          status,
          endDate: endDateStr,
          daysLeft,
          isExpired,
          billingModel: data.billingModel === 'subscription' ? 'subscription' : 'commission',
          cancelAtPeriodEnd: data.subscriptionCancelAtPeriodEnd === true,
        });
      }
      setLoading(false);
    }, (err) => {
      console.error('Error fetching subscription:', err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, restaurantId]);

  const hasCapability = (capability: Capability) => {
    return subscription.plan.capabilities.includes(capability);
  };

  return { ...subscription, hasCapability, loading };
}
