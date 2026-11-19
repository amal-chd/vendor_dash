import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, onSnapshot, query, where, getDoc, getDocs, limit } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { ensureUserSession, heartbeatUserSession } from "@/lib/sessions";
import { isAdminEmail } from "@/lib/auth-flow";

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

  // Admin & Impersonation
  isAdmin: boolean;
  isImpersonating: boolean;
  impersonatedRestaurantId: string | null;
  startImpersonating: (id: string) => void;
  stopImpersonating: () => void;
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
  isAdmin: false,
  isImpersonating: false,
  impersonatedRestaurantId: null,
  startImpersonating: () => {},
  stopImpersonating: () => {},
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

  // Admin & Impersonation state
  const [isAdmin, setIsAdmin] = useState(false);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [impersonatedRestaurantId, setImpersonatedRestaurantId] = useState<string | null>(null);
  
  // Available outlets for switching
  const [outlets, setOutlets] = useState<OutletInfo[]>([]);
  const [primaryOutletData, setPrimaryOutletData] = useState<OutletInfo | null>(null);

  // Wrapper to save preference to localStorage
  const setRestaurantId = (id: string) => {
    setRestaurantIdState(id);
    const key = isImpersonating && impersonatedRestaurantId
      ? `kada_active_outlet_${impersonatedRestaurantId}`
      : (user ? `kada_active_outlet_${user.uid}` : null);
    if (key) {
      localStorage.setItem(key, id);
    }
  };

  const startImpersonating = (id: string) => {
    sessionStorage.setItem("kada_impersonate_id", id);
    localStorage.setItem("kada_impersonate_id", id);
    setIsImpersonating(true);
    setImpersonatedRestaurantId(id);
    window.location.reload();
  };

  const stopImpersonating = () => {
    sessionStorage.removeItem("kada_impersonate_id");
    localStorage.removeItem("kada_impersonate_id");
    setIsImpersonating(false);
    setImpersonatedRestaurantId(null);
    if (window.location.search.includes("impersonate")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    window.location.href = "/admin/vendors";
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
        setIsAdmin(false);
        setIsImpersonating(false);
        setImpersonatedRestaurantId(null);
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

  // 1. Detect if signed-in user is a staff outlet, team member, owner, or admin impersonator
  useEffect(() => {
    if (!user) return;
    
    let unsubStaff = () => {};
    let unsubRest = () => {};

    user.getIdTokenResult().then((token) => {
      const userIsAdmin = isAdminEmail(user.email) || token.claims.platformAdmin === true || !!token.claims.adminRole;
      setIsAdmin(userIsAdmin);

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
        // --- OWNER OR ADMIN IMPERSONATION FLOW ---
        setIsTeamMember(false);
        setTeamRole(null);
        
        // Check for admin impersonation
        let impersonateId: string | null = null;
        if (userIsAdmin) {
          const urlParam = new URLSearchParams(window.location.search).get("impersonate");
          const stored = sessionStorage.getItem("kada_impersonate_id") || localStorage.getItem("kada_impersonate_id");
          impersonateId = urlParam || stored;
          if (impersonateId) {
            sessionStorage.setItem("kada_impersonate_id", impersonateId);
            localStorage.setItem("kada_impersonate_id", impersonateId);
            setIsImpersonating(true);
            setImpersonatedRestaurantId(impersonateId);
          }
        }

        const targetId = impersonateId || user.uid;
        const ref = doc(db, 'restaurants', targetId);

        unsubRest = onSnapshot(ref, (snap) => {
          if (snap.exists() && snap.data()?.name) {
            const data = snap.data();
            const outlet = data?.isOutlet === true;
            const parentId = typeof data?.parentId === 'string' ? data.parentId.trim() : '';
            
            setBusinessType("restaurant");
            setMessData(null);
            setIsStaffOutlet(outlet);
            
            const primaryData = {
              id: targetId,
              name: data?.name || 'Main Branch',
              isActive: data?.isActive !== false,
              isOutlet: outlet,
              parentId: parentId || undefined,
              district: data?.district
            };
            setPrimaryOutletData(primaryData);
            
            if (outlet && parentId) {
              setPrimaryOutletId(targetId);
              setRestaurantIdState(targetId);
              setBillingAccountId(parentId);
            } else {
              setPrimaryOutletId(targetId);
              setBillingAccountId(targetId);
              setRestaurantIdState((prev) => {
                if (prev) return prev;
                const saved = localStorage.getItem(`kada_active_outlet_${targetId}`);
                return saved || targetId;
              });
            }
            setLoading(false);
          } else {
            // Check if this is a Mess Kitchen account
            getDoc(doc(db, "mess_kitchens", targetId)).then((messSnap) => {
              if (messSnap.exists()) {
                const mData = messSnap.data();
                setBusinessType("mess");
                setMessData(mData);
                setIsStaffOutlet(false);
                setPrimaryOutletId(targetId);
                setBillingAccountId(targetId);
                setRestaurantIdState(targetId);
                setPrimaryOutletData({
                  id: targetId,
                  name: mData?.name || "Mess Kitchen",
                  isActive: true,
                  isOutlet: false,
                  district: mData?.area,
                });
                setLoading(false);
              } else if (userIsAdmin && !impersonateId) {
                // If admin entered /dashboard without choosing a vendor, auto-impersonate the first available restaurant
                getDocs(query(collection(db, "restaurants"), limit(1))).then((querySnap) => {
                  if (!querySnap.empty) {
                    const firstDoc = querySnap.docs[0];
                    const firstData = firstDoc.data();
                    const firstId = firstDoc.id;
                    sessionStorage.setItem("kada_impersonate_id", firstId);
                    localStorage.setItem("kada_impersonate_id", firstId);
                    setIsImpersonating(true);
                    setImpersonatedRestaurantId(firstId);
                    setBusinessType("restaurant");
                    setPrimaryOutletId(firstId);
                    setBillingAccountId(firstData.parentId || firstId);
                    setRestaurantIdState(firstId);
                    setPrimaryOutletData({
                      id: firstId,
                      name: firstData.name || "Main Branch",
                      isActive: firstData.isActive !== false,
                      isOutlet: firstData.isOutlet === true,
                      district: firstData.district,
                    });
                  } else {
                    setBusinessType("restaurant");
                    setPrimaryOutletId(targetId);
                    setBillingAccountId(targetId);
                    setRestaurantIdState((prev) => prev || targetId);
                  }
                  setLoading(false);
                }).catch(() => {
                  setBusinessType("restaurant");
                  setPrimaryOutletId(targetId);
                  setBillingAccountId(targetId);
                  setRestaurantIdState((prev) => prev || targetId);
                  setLoading(false);
                });
              } else {
                // Fallback restaurant
                setBusinessType("restaurant");
                setPrimaryOutletId(targetId);
                setBillingAccountId(targetId);
                setRestaurantIdState((prev) => prev || targetId);
                setLoading(false);
              }
            }).catch(() => {
              setLoading(false);
            });
          }
        }, () => {
          // Fallback
          setPrimaryOutletId(targetId);
          setBillingAccountId(targetId);
          setRestaurantIdState((prev) => prev || targetId);
          setLoading(false);
        });
      }
    });

    return () => {
      unsubStaff();
      unsubRest();
    };
  }, [user]);

  // 2. If user is an Owner or Admin impersonating, fetch all child outlets
  useEffect(() => {
    const effectiveOwnerId = isImpersonating ? impersonatedRestaurantId : user?.uid;
    if (!user || isStaffOutlet || !primaryOutletData || !effectiveOwnerId) return;
    
    // Fetch all child outlets from the officially managed subcollection
    const q = query(collection(db, 'restaurants', effectiveOwnerId, 'outlets'));
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
            parentId: effectiveOwnerId,
            district: data.district
          } as OutletInfo;
        });
      setOutlets(children);
    }, (error) => {
      console.error("Failed to fetch outlets:", error);
    });
    return unsub;
  }, [user, isStaffOutlet, isImpersonating, impersonatedRestaurantId, primaryOutletData]);

  // Session heartbeat
  useEffect(() => {
    // Only send heartbeat if it's a valid single restaurant ID (not global) and NOT admin impersonating
    if (!user || !restaurantId || restaurantId === 'global' || isImpersonating) return;
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
  }, [user, restaurantId, isImpersonating]);

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
      activeRestaurantId: restaurantId === 'global' ? (primaryOutletId || (isImpersonating ? impersonatedRestaurantId : user?.uid) || null) : restaurantId,
      isStaffOutlet,
      isTeamMember,
      teamRole,
      outlets: allOutlets,
      setRestaurantId,
      primaryOutletId,
      billingAccountId,
      businessType,
      isMess: businessType === "mess",
      messData,
      isAdmin,
      isImpersonating,
      impersonatedRestaurantId,
      startImpersonating,
      stopImpersonating
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
