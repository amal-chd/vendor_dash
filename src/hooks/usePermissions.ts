import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "./useAuth";
import {
  ROLE_PERMISSIONS as STATIC_ROLE_PERMISSIONS,
  WORKSPACE_ACCESS as STATIC_WORKSPACE_ACCESS,
  isValidRole,
  type Permission,
  type Role,
  type Workspace,
} from "@/lib/rbac";

/**
 * SECURITY NOTE: VITE_ADMIN_EMAILS is baked into the JS bundle at build time
 * and is visible to anyone inspecting the app. This list is used ONLY as a
 * client-side UI convenience to show admin features. Actual authorization MUST
 * be enforced server-side via Firebase Custom Claims (`platformAdmin`,
 * `adminRole`) set by Cloud Functions, and via Firestore security rules.
 *
 * The fallback emails below are bootstrap admins — if VITE_ADMIN_EMAILS is not
 * set these are used instead.
 */
const fallbackAdmins = ["thekada@gmail.com", "thekadaapp@gmail.com"];
const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
if (ADMIN_EMAILS.length === 0) ADMIN_EMAILS.push(...fallbackAdmins);

/**
 * The current admin's role + capability checks (spec §35). Bootstrap admins
 * (VITE_ADMIN_EMAILS or a platformAdmin claim) resolve to Super Admin so the
 * existing owners keep full access; everyone else gets the role in their
 * `adminRole` custom claim (set server-side by setAdminRole).
 */
export function usePermissions() {
  const { user } = useAuth();
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [dynamicRoles, setDynamicRoles] = useState<Record<Role, Permission[]>>(STATIC_ROLE_PERMISSIONS);
  const [dynamicWorkspaces, setDynamicWorkspaces] = useState<Record<Role, Workspace[]>>(STATIC_WORKSPACE_ACCESS);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "config", "admin_rbac"), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.rolePermissions) {
          setDynamicRoles(data.rolePermissions);
        }
        if (data.workspaceAccess) {
          setDynamicWorkspaces(data.workspaceAccess);
        }
      } else {
        setDynamicRoles(STATIC_ROLE_PERMISSIONS);
        setDynamicWorkspaces(STATIC_WORKSPACE_ACCESS);
      }
    }, (err) => {
      console.error("Error fetching dynamic RBAC config:", err);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let active = true;
    if (!user) {
      setRole(null);
      setLoading(false);
      return;
    }
    user
      .getIdTokenResult()
      .then((t) => {
        if (!active) return;
        const email = (user.email || "").toLowerCase();
        
        if (ADMIN_EMAILS.includes(email)) {
          setRole("super_admin");
        } else if (isValidRole(t.claims.adminRole)) {
          setRole(t.claims.adminRole as Role);
        } else if (t.claims.platformAdmin === true) {
          setRole("platform_admin");
        } else {
          setRole(null);
        }
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setRole(null);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [user]);

  return {
    role,
    loading,
    isSuperAdmin: role === "super_admin",
    can: (perm: Permission) => (role ? (dynamicRoles[role] ?? []).includes(perm) : false),
    permissions: role ? (dynamicRoles[role] ?? []) : [],
    canAccessWorkspace: (ws: Workspace) => {
      if (!role) return false;
      if (role === "super_admin" || role === "platform_admin") return true;
      return (dynamicWorkspaces[role] ?? []).includes(ws);
    },
  };
}
