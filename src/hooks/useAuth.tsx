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
  hasRestaurant: boolean;
  hasMess: boolean;
  hasBoth: boolean;
  activeMode: "restaurant" | "mess";
  switchMode: (mode: "restaurant" | "mess") => void;

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
  hasRestaurant: false,
  hasMess: false,
  hasBoth: false,
  activeMode: "restaurant",
  switchMode: () => {},
  isAdmin: false,
  isImpersonating: false,
  impersonatedRestaurantId: null,
  startImpersonating: () => {},
  stopImpersonating: () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Business type & Dual Mode
  const [rawRestData, setRawRestData] = useState<any | null>(null);
  const [rawMessData, setRawMessData] = useState<any | null>(null);
  const [hasRestaurant, setHasRestaurant] = useState(false);
  const [hasMess, setHasMess] = useState(false);
  const [activeMode, setActiveModeState] = useState<"restaurant" | "mess">(() => {
    const saved = localStorage.getItem("kada_active_mode");
    return saved === "mess" ? "mess" : "restaurant";
  });
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

  const switchMode = (mode: "restaurant" | "mess") => {
    setActiveModeState(mode);
    setBusinessType(mode);
    localStorage.setItem("kada_active_mode", mode);
  };

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
        setHasRestaurant(false);
        setHasMess(false);
        setRawRestData(null);
        setRawMessData(null);
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
    let unsubMess = () => {};

    user.getIdTokenResult().then((token) => {
      const userIsAdmin = isAdminEmail(user.email) || token.claims.platformAdmin === true || !!token.claims.adminRole;
      setIsAdmin(userIsAdmin);

      if (token.claims.staff === true && token.claims.restaurantId && token.claims.staffDocId) {
        // --- TEAM MEMBER FLOW ---
        const rId = token.claims.restaurantId as string;
        const sId = token.claims.staffDocId as string;
        
        setIsTeamMember(true);
        setIsStaffOutlet(true); 
        setHasRestaurant(true);
        setHasMess(false);
        setActiveModeState("restaurant");
        setBusinessType("restaurant");
        
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
        const restRef = doc(db, 'restaurants', targetId);
        const messRef = doc(db, 'mess_kitchens', targetId);

        let restSnapData: any = null;
        let messSnapData: any = null;
        let restChecked = false;
        let messChecked = false;

        const syncProfileState = () => {
          const hasR = !!(restSnapData && (restSnapData.name || restSnapData.email || restSnapData.createdAt));
          const hasM = !!(messSnapData && (messSnapData.name || messSnapData.email || messSnapData.createdAt || messSnapData.area));

          setHasRestaurant(hasR);
          setHasMess(hasM);

          const savedMode = localStorage.getItem("kada_active_mode");
          let currentMode: "restaurant" | "mess" = "restaurant";
          if (hasR && hasM) {
            currentMode = (savedMode === "mess" || savedMode === "restaurant") ? savedMode : "restaurant";
          } else if (hasM && !hasR) {
            currentMode = "mess";
          } else {
            currentMode = "restaurant";
          }

          setActiveModeState(currentMode);
          setBusinessType(currentMode);

          if (restChecked && messChecked) {
            if (!hasR && !hasM && userIsAdmin && !impersonateId) {
              // Admin without personal shop, auto-impersonate first restaurant
              getDocs(query(collection(db, "restaurants"), limit(1))).then((querySnap) => {
                if (!querySnap.empty) {
                  const firstDoc = querySnap.docs[0];
                  const firstData = firstDoc.data();
                  const firstId = firstDoc.id;
                  sessionStorage.setItem("kada_impersonate_id", firstId);
                  localStorage.setItem("kada_impersonate_id", firstId);
                  setIsImpersonating(true);
                  setImpersonatedRestaurantId(firstId);
                  setRawRestData(firstData);
                  setHasRestaurant(true);
                }
                setLoading(false);
              }).catch(() => setLoading(false));
            } else {
              setLoading(false);
            }
          }
        };

        unsubRest = onSnapshot(restRef, (snap) => {
          restChecked = true;
          if (snap.exists()) {
            restSnapData = snap.data();
            setRawRestData(snap.data());
          } else {
            restSnapData = null;
            setRawRestData(null);
          }
          syncProfileState();
        }, () => {
          restChecked = true;
          syncProfileState();
        });

        unsubMess = onSnapshot(messRef, (snap) => {
          messChecked = true;
          if (snap.exists()) {
            messSnapData = snap.data();
            setRawMessData(snap.data());
          } else {
            messSnapData = null;
            setRawMessData(null);
          }
          syncProfileState();
        }, () => {
          messChecked = true;
          syncProfileState();
        });
      }
    });

    return () => {
      unsubStaff();
      unsubRest();
      unsubMess();
    };
  }, [user]);

  // Synchronize active context (primaryOutletData, restaurantId, billingAccountId) whenever activeMode or data changes
  const effectiveTargetId = isImpersonating && impersonatedRestaurantId ? impersonatedRestaurantId : user?.uid;

  useEffect(() => {
    if (!effectiveTargetId || isTeamMember) return;

    if (activeMode === "mess" && rawMessData) {
      setMessData(rawMessData);
      setIsStaffOutlet(false);
      setPrimaryOutletId(effectiveTargetId);
      setBillingAccountId(effectiveTargetId);
      setRestaurantIdState(effectiveTargetId);
      setPrimaryOutletData({
        id: effectiveTargetId,
        name: rawMessData?.name || "Mess Kitchen",
        isActive: true,
        isOutlet: false,
        district: rawMessData?.area,
      });
    } else if (rawRestData && rawRestData.name) {
      const outlet = rawRestData?.isOutlet === true;
      const parentId = typeof rawRestData?.parentId === 'string' ? rawRestData.parentId.trim() : '';
      
      setIsStaffOutlet(outlet);
      const primaryData = {
        id: effectiveTargetId,
        name: rawRestData?.name || 'Main Branch',
        isActive: rawRestData?.isActive !== false,
        isOutlet: outlet,
        parentId: parentId || undefined,
        district: rawRestData?.district,
      };
      setPrimaryOutletData(primaryData);
      
      if (outlet && parentId) {
        setPrimaryOutletId(effectiveTargetId);
        setRestaurantIdState(effectiveTargetId);
        setBillingAccountId(parentId);
      } else {
        setPrimaryOutletId(effectiveTargetId);
        setBillingAccountId(effectiveTargetId);
        setRestaurantIdState((prev) => {
          if (prev) return prev;
          const saved = localStorage.getItem(`kada_active_outlet_${effectiveTargetId}`);
          return saved || effectiveTargetId;
        });
      }
    } else {
      setPrimaryOutletId(effectiveTargetId);
      setBillingAccountId(effectiveTargetId);
      setRestaurantIdState((prev) => prev || effectiveTargetId);
    }
  }, [activeMode, rawMessData, rawRestData, effectiveTargetId, isTeamMember]);

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
      isMess: activeMode === "mess",
      messData,
      hasRestaurant,
      hasMess,
      hasBoth: hasRestaurant && hasMess,
      activeMode,
      switchMode,
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
