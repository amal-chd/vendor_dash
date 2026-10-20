import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, onSnapshot, query, where, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { ensureUserSession, heartbeatUserSession } from "@/lib/sessions";

export interface OutletInfo {
  id: string;
  name: string;
  isActive: boolean;
  isOutlet: boolean;
  parentId?: string;
  district?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  /**
   * Effective restaurant id for the current session. 
   * For owners, this is either their own UID (primary outlet) or the UID of a selected sub-outlet.
   * Can also be 'global' for the global dashboard view.
   */
  restaurantId: string | null;
  /**
   * Safe ID to use for queries, resolving 'global' to primary outlet ID.
   */
  activeRestaurantId: string | null;
  /** True if the currently signed-in user is an outlet staff account (meaning they cannot switch outlets) */
  isStaffOutlet: boolean;
  /** True if the user is a team member logged in via their staff email login */
  isTeamMember: boolean;
  /** The assigned team role if isTeamMember is true (e.g. Kitchen, Manager) */
  teamRole: string | null;
  
  // Outlet management
  outlets: OutletInfo[];
  setRestaurantId: (id: string) => void;
  primaryOutletId: string | null;
  billingAccountId: string | null;

  // Business Type & Mess
  businessType: "restaurant" | "mess";
  isMess: boolean;
  messData: any | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  restaurantId: null,
  activeRestaurantId: null,
  isStaffOutlet: false,
  isTeamMember: false,
  teamRole: null,
  outlets: [],
  setRestaurantId: () => {},
  primaryOutletId: null,
  billingAccountId: null,
  businessType: "restaurant",
  isMess: false,
  messData: null,
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Business type
  const [businessType, setBusinessType] = useState<"restaurant" | "mess">("restaurant");
  const [messData, setMessData] = useState<any | null>(null);
  
  // Active selected context
  const [restaurantId, setRestaurantIdState] = useState<string | null>(null);
  
  // User's own restaurant details
  const [isStaffOutlet, setIsStaffOutlet] = useState(false);
  const [isTeamMember, setIsTeamMember] = useState(false);
  const [teamRole, setTeamRole] = useState<string | null>(null);
  const [primaryOutletId, setPrimaryOutletId] = useState<string | null>(null);
  const [billingAccountId, setBillingAccountId] = useState<string | null>(null);
  
  // Available outlets for switching
  const [outlets, setOutlets] = useState<OutletInfo[]>([]);
  const [primaryOutletData, setPrimaryOutletData] = useState<OutletInfo | null>(null);

  // Wrapper to save preference to localStorage
  const setRestaurantId = (id: string) => {
    setRestaurantIdState(id);
    if (user) {
      localStorage.setItem(`kada_active_outlet_${user.uid}`, id);
    }
  };

  useEffect(() => {
    let timeoutId: number;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      if (!user) {
        setRestaurantIdState(null);
        setIsStaffOutlet(false);
        setIsTeamMember(false);
        setTeamRole(null);
        setOutlets([]);
        setPrimaryOutletData(null);
        setPrimaryOutletId(null);
        setLoading(false);
      } else {
        // Fallback to clear loading state if onSnapshot hangs
        timeoutId = window.setTimeout(() => setLoading(false), 5000);
      }
    });
    return () => {
      unsubscribe();
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, []);

  // 1. Detect if signed-in user is a staff outlet, team member, or owner
  useEffect(() => {
    if (!user) return;
    
    let unsubStaff = () => {};
    let unsubRest = () => {};

    user.getIdTokenResult().then((token) => {
      if (token.claims.staff === true && token.claims.restaurantId && token.claims.staffDocId) {
        // --- TEAM MEMBER FLOW ---
        const rId = token.claims.restaurantId as string;
        const sId = token.claims.staffDocId as string;
        
        setIsTeamMember(true);
        // Team members can't switch outlets either, but they operate on the restaurant ID they were invited to
        setIsStaffOutlet(true); 
        
        setPrimaryOutletId(rId);
        setRestaurantIdState(rId);
        setBillingAccountId(rId);

        unsubStaff = onSnapshot(doc(db, "staff", sId), (snap) => {
          const data = snap.data();
          if (data) {
            setTeamRole(data.role || "Kitchen");
          } else {
            setTeamRole("Kitchen");
          }
          setLoading(false);
        }, () => {
          setLoading(false);
        });
      } else {
        // --- OWNER OR GENERIC OUTLET FLOW ---
        setIsTeamMember(false);
        setTeamRole(null);
        
        const ref = doc(db, 'restaurants', user.uid);
        unsubRest = onSnapshot(ref, (snap) => {
          if (snap.exists() && snap.data()?.name) {
            const data = snap.data();
            const outlet = data?.isOutlet === true;
            const parentId = typeof data?.parentId === 'string' ? data.parentId.trim() : '';
            
            setBusinessType("restaurant");
            setMessData(null);
            setIsStaffOutlet(outlet);
            
            const primaryData = {
              id: user.uid,
              name: data?.name || 'Main Branch',
              isActive: data?.isActive !== false,
              isOutlet: outlet,
              parentId: parentId || undefined,
              district: data?.district
            };
            setPrimaryOutletData(primaryData);
            
            if (outlet && parentId) {
              setPrimaryOutletId(user.uid);
              setRestaurantIdState(user.uid);
              setBillingAccountId(parentId);
            } else {
              setPrimaryOutletId(user.uid);
              setBillingAccountId(user.uid);
              setRestaurantIdState((prev) => {
                if (prev) return prev;
                const saved = localStorage.getItem(`kada_active_outlet_${user.uid}`);
                return saved || user.uid;
              });
            }
            setLoading(false);
          } else {
            // Check if this is a Mess Kitchen account
            getDoc(doc(db, "mess_kitchens", user.uid)).then((messSnap) => {
              if (messSnap.exists()) {
                const mData = messSnap.data();
                setBusinessType("mess");
                setMessData(mData);
                setIsStaffOutlet(false);
                setPrimaryOutletId(user.uid);
                setBillingAccountId(user.uid);
                setRestaurantIdState(user.uid);
                setPrimaryOutletData({
                  id: user.uid,
                  name: mData?.name || "Mess Kitchen",
                  isActive: true,
                  isOutlet: false,
                  district: mData?.area,
                });
                setLoading(false);
              } else {
                // Fallback restaurant
                setBusinessType("restaurant");
                setPrimaryOutletId(user.uid);
                setBillingAccountId(user.uid);
                setRestaurantIdState((prev) => prev || user.uid);
                setLoading(false);
              }
            }).catch(() => {
              setLoading(false);
            });
          }
        }, () => {
          // Fallback
          setPrimaryOutletId(user.uid);
          setBillingAccountId(user.uid);
          setRestaurantIdState((prev) => prev || user.uid);
          setLoading(false);
        });
      }
    });

    return () => {
      unsubStaff();
      unsubRest();
    };
  }, [user]);

  // 2. If user is an Owner, fetch all their child outlets
  useEffect(() => {
    if (!user || isStaffOutlet || !primaryOutletData) return;
    
    // Fetch all child outlets from the officially managed subcollection
    const q = query(collection(db, 'restaurants', user.uid, 'outlets'));
    const unsub = onSnapshot(q, (snap) => {
      const children = snap.docs
        .filter(d => !d.data().isDeleted)
        .map(d => {
          const data = d.data();
          return {
            id: d.id,
            name: data.name || 'Unnamed Outlet',
            isActive: data.isActive !== false,
            isOutlet: true,
            parentId: user.uid,
            district: data.district
          } as OutletInfo;
        });
      setOutlets(children);
    }, (error) => {
      console.error("Failed to fetch outlets:", error);
    });
    return unsub;
  }, [user, isStaffOutlet]);

  // Session heartbeat
  useEffect(() => {
    // Only send heartbeat if it's a valid single restaurant ID (not global)
    if (!user || !restaurantId || restaurantId === 'global') return;
    let alive = true;
    let t: number | undefined;

    (async () => {
      try {
        await ensureUserSession(restaurantId);
      } catch {
        // Session tracking is best-effort
      }
      if (!alive) return;
      t = window.setInterval(() => {
        heartbeatUserSession(restaurantId).catch(() => {});
      }, 60_000);
    })();

    return () => {
      alive = false;
      if (t) window.clearInterval(t);
    };
  }, [user, restaurantId]);

  // Construct final available outlets list and deduplicate by ID to prevent duplicate names/entries
  const rawOutlets = primaryOutletData ? [primaryOutletData, ...outlets] : outlets;
  const allOutlets = Array.from(new Map(rawOutlets.map(o => [o.id, o])).values());

  // Safety check: if saved restaurantId doesn't exist anymore and isn't 'global', revert to primary
  useEffect(() => {
    if (!loading && restaurantId && restaurantId !== 'global' && allOutlets.length > 0) {
      const exists = allOutlets.some(o => o.id === restaurantId);
      if (!exists && primaryOutletId) {
        setRestaurantId(primaryOutletId);
      }
    }
  }, [loading, restaurantId, allOutlets, primaryOutletId]);

  return (
    <AuthContext.Provider value={{ 
      user, 
      loading, 
      restaurantId, 
      activeRestaurantId: restaurantId === 'global' ? (primaryOutletId || user?.uid || null) : restaurantId,
      isStaffOutlet,
      isTeamMember,
      teamRole,
      outlets: allOutlets,
      setRestaurantId,
      primaryOutletId,
      billingAccountId,
      businessType,
      isMess: businessType === "mess",
      messData
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
