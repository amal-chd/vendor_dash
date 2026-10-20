import { useState, useEffect } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  ROLE_LABELS,
  ROLE_PERMISSIONS as STATIC_ROLE_PERMISSIONS,
  WORKSPACE_ACCESS as STATIC_WORKSPACE_ACCESS,
  WORKSPACE_LABELS,
  type Role,
  type Permission,
  type Workspace,
} from "@/lib/rbac";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Shield, Save, Users, AlertCircle, LayoutDashboard, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const ALL_PERMISSIONS: Permission[] = [
  "view", "create", "edit", "delete", "approve", "refund", "suspend",
  "export", "view_financial", "view_pii", "manage_admins",
];

const ALL_WORKSPACES: Workspace[] = [
  "dashboard",
  "orders",
  "customers",
  "vendors",
  "delivery",
  "markets",
  "finance",
  "stay",
  "support",
  "quality",
  "growth",
  "analytics",
  "settings",
];

export default function AdminRolesPage() {
  const [rolePermissions, setRolePermissions] = useState<Record<Role, Permission[]>>(STATIC_ROLE_PERMISSIONS);
  const [workspaceAccess, setWorkspaceAccess] = useState<Record<Role, Workspace[]>>(STATIC_WORKSPACE_ACCESS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedRole, setSelectedRole] = useState<Role>("ops_manager");

  const editableRoles = (Object.keys(ROLE_LABELS) as Role[]).filter(
    r => r !== "super_admin" && r !== "platform_admin"
  );

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const snap = await getDoc(doc(db, "config", "admin_rbac"));
        if (snap.exists()) {
          const data = snap.data();
          if (data.rolePermissions) setRolePermissions(data.rolePermissions);
          if (data.workspaceAccess) setWorkspaceAccess(data.workspaceAccess);
        }
      } catch (err) {
        console.error("Failed to load RBAC config", err);
        toast.error("Failed to load roles configuration");
      } finally {
        setLoading(false);
      }
    };
    loadConfig();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, "config", "admin_rbac"), {
        rolePermissions,
        workspaceAccess,
        updatedAt: new Date().toISOString(),
      });
      toast.success("Roles updated successfully");
    } catch (err) {
      console.error("Failed to save RBAC config", err);
      toast.error("Failed to save roles configuration");
    } finally {
      setSaving(false);
    }
  };

  const togglePermission = (perm: Permission) => {
    setRolePermissions(prev => {
      const current = prev[selectedRole] ?? [];
      const updated = current.includes(perm)
        ? current.filter(p => p !== perm)
        : [...current, perm];
      return { ...prev, [selectedRole]: updated };
    });
  };

  const toggleWorkspace = (ws: Workspace) => {
    setWorkspaceAccess(prev => {
      const current = prev[selectedRole] ?? [];
      const updated = current.includes(ws)
        ? current.filter(w => w !== ws)
        : [...current, ws];
      return { ...prev, [selectedRole]: updated };
    });
  };

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Roles & Permissions</h2>
          <p className="text-muted-foreground">Manage dynamic access control for admin roles.</p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          <Save className="h-4 w-4" />
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Dynamic RBAC</AlertTitle>
        <AlertDescription>
          These settings override the static platform defaults. Super Admin and Platform Admin roles always have full access and cannot be edited here. Ensure changes align with your backend Firestore rules.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Roles Sidebar */}
        <Card className="col-span-1 border-muted">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Roles
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[600px]">
              <div className="flex flex-col p-2 gap-1">
                {editableRoles.map(r => (
                  <button
                    key={r}
                    onClick={() => setSelectedRole(r)}
                    className={cn(
                      "text-left px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                      selectedRole === r
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted text-foreground"
                    )}
                  >
                    {ROLE_LABELS[r]}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Permissions & Workspaces Edit */}
        <div className="col-span-1 md:col-span-3 space-y-6">
          <Card className="border-muted">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <LayoutDashboard className="h-5 w-5 text-primary" />
                Workspaces for {ROLE_LABELS[selectedRole]}
              </CardTitle>
              <CardDescription>
                Which sections of the platform this role can access.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {ALL_WORKSPACES.map(ws => (
                  <label
                    key={ws}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer",
                      workspaceAccess[selectedRole]?.includes(ws)
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    )}
                  >
                    <Checkbox
                      checked={workspaceAccess[selectedRole]?.includes(ws)}
                      onCheckedChange={() => toggleWorkspace(ws)}
                    />
                    <span className="text-sm font-medium">{WORKSPACE_LABELS[ws]}</span>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-muted">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Capabilities for {ROLE_LABELS[selectedRole]}
              </CardTitle>
              <CardDescription>
                Specific actions this role can perform across accessible workspaces.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {ALL_PERMISSIONS.map(perm => (
                  <label
                    key={perm}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer",
                      rolePermissions[selectedRole]?.includes(perm)
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    )}
                  >
                    <Checkbox
                      checked={rolePermissions[selectedRole]?.includes(perm)}
                      onCheckedChange={() => togglePermission(perm)}
                    />
                    <span className="text-sm font-medium font-mono">{perm}</span>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
