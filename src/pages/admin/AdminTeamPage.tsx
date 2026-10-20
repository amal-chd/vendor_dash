import { confirmDialog } from "@/components/admin/core/asyncDialogs";
import { useMemo, useState } from "react";
import { Shield, Info, UserCog, Users, Clock, RefreshCw } from "lucide-react";
import { ColumnDef } from "@tanstack/react-table";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { adminAction } from "@/lib/admin-ops";
import { toast } from "sonner";
import { Role, ROLE_LABELS, ROLE_PERMISSIONS, WORKSPACE_ACCESS, WORKSPACE_LABELS } from "@/lib/rbac";

interface Member {
  id: string;
  email?: string;
  role?: string;
  active?: boolean;
  googleWorkspace?: string;
  updatedAt?: any;
}

export default function AdminTeamPage() {
  const { rows, loading } = useLiveCollection<Member>("admin_team");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("ops_manager");
  const [createGoogle, setCreateGoogle] = useState(false);
  const [updatingRoleFor, setUpdatingRoleFor] = useState<string | null>(null);

  const activeMembers = rows.filter((r) => r.active !== false);
  const totalActive = activeMembers.length;

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    activeMembers.forEach(m => {
      if (m.role) {
        counts[m.role] = (counts[m.role] || 0) + 1;
      }
    });
    return counts;
  }, [activeMembers]);

  const recentCount = useMemo(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return activeMembers.filter(m => {
      if (!m.updatedAt) return false;
      const d = m.updatedAt.toDate ? m.updatedAt.toDate() : new Date(m.updatedAt);
      return d >= sevenDaysAgo;
    }).length;
  }, [activeMembers]);

  const columns: ColumnDef<Member>[] = useMemo(
    () => [
      { accessorKey: "email", header: "Email" },
      { 
        accessorKey: "role", 
        header: "Role", 
        cell: ({ row }) => {
          const roleKey = row.original.role as Role;
          const currentEmail = row.original.email || row.original.id;
          const isUpdating = updatingRoleFor === row.original.id;

          const handleRoleChange = async (newRole: string) => {
            if (
              !(await confirmDialog({
                title: `Change ${currentEmail}'s role to ${ROLE_LABELS[newRole as Role] || newRole}?`,
                description: "Their access changes the next time their session refreshes.",
                confirmLabel: "Change role",
              }))
            )
              return;
            try {
              setUpdatingRoleFor(row.original.id);
              await adminAction("grantAdmin", { email: currentEmail, role: newRole as Role });
              toast.success("Role updated successfully.");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed to update role");
            } finally {
              setUpdatingRoleFor(null);
            }
          };

          const perms = ROLE_PERMISSIONS[roleKey] || [];
          const workspaces = WORKSPACE_ACCESS[roleKey] || [];

          return (
            <div className="flex items-center gap-2">
              <Select 
                value={roleKey} 
                onValueChange={handleRoleChange} 
                disabled={isUpdating}
              >
                <SelectTrigger className="w-[180px] h-8">
                  {isUpdating ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {perms.length > 0 && (
                <HoverCard>
                  <HoverCardTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-pointer" />
                  </HoverCardTrigger>
                  <HoverCardContent className="w-80 z-50">
                    <div className="space-y-3">
                      <div>
                        <h4 className="text-sm font-semibold mb-1">Permissions</h4>
                        <div className="flex flex-wrap gap-1">
                          {perms.map(p => <Badge key={p} variant="secondary" className="text-xs">{p}</Badge>)}
                        </div>
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold mb-1">Workspace Access</h4>
                        <div className="flex flex-wrap gap-1">
                          {workspaces.map(w => <Badge key={w} variant="secondary" className="text-xs">{WORKSPACE_LABELS[w]}</Badge>)}
                        </div>
                      </div>
                    </div>
                  </HoverCardContent>
                </HoverCard>
              )}
            </div>
          );
        } 
      },
      { 
        accessorKey: "googleWorkspace", 
        header: "Google Workspace", 
        cell: ({ row }) => {
          const status = row.original.googleWorkspace;
          if (!status || status === "none") return <span className="text-muted-foreground text-sm">—</span>;
          if (status === "pending") return <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-transparent dark:bg-amber-500/15 dark:hover:bg-amber-500/10 dark:text-amber-300">Pending Setup</Badge>;
          if (status === "active") return <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-transparent dark:bg-emerald-500/15 dark:hover:bg-emerald-500/10 dark:text-emerald-300">Active</Badge>;
          return <Badge variant="outline">{status}</Badge>;
        }
      },
      { 
        accessorKey: "active", 
        header: "Status", 
        cell: ({ row }) => {
          const isActive = row.original.active !== false;
          return (
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <span className="capitalize text-sm font-medium">{isActive ? 'Active' : 'Revoked'}</span>
            </div>
          );
        }
      },
      {
        id: "lastUpdated",
        header: "Last Updated",
        cell: ({ row }) => {
          if (!row.original.updatedAt) return <span className="text-muted-foreground text-sm">—</span>;
          const d = row.original.updatedAt.toDate ? row.original.updatedAt.toDate() : new Date(row.original.updatedAt);
          // Relative time formatter
          const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
          const daysDifference = Math.round((d.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
          return <span className="text-sm text-muted-foreground">{daysDifference === 0 ? "Today" : rtf.format(daysDifference, "day")}</span>;
        }
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          row.original.active !== false ? (
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
              onClick={async () => {
                if (
                  !(await confirmDialog({
                    title: `Revoke admin access for ${row.original.email || row.original.id}?`,
                    description: "They are signed out of the admin console and lose every admin permission.",
                    confirmLabel: "Revoke access",
                    destructive: true,
                  }))
                )
                  return;
                try {
                  const data = await adminAction("revokeAdmin", { uid: row.original.id });
                  toast.success(
                    (data as { claimsPending?: boolean }).claimsPending
                      ? "Marked inactive. Deploy functions to strip login claims."
                      : "Access revoked — user must refresh token",
                  );
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Revoke failed");
                }
              }}
            >
              Revoke
            </Button>
          ) : null,
      },
    ],
    [updatingRoleFor]
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Admin team"
        description="Manage platform access, assign RBAC roles, and provision Google Workspace accounts (@thekada.in) for team members."
        icon={Shield}
      />
      
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Active Members</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? "—" : totalActive}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recently Added / Updated</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? "—" : recentCount}</div>
            <p className="text-xs text-muted-foreground">In the last 7 days</p>
          </CardContent>
        </Card>

        <Card className="md:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Role Distribution</CardTitle>
            <UserCog className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2 mt-2">
              {loading ? <span className="text-sm text-muted-foreground">Loading...</span> : 
                Object.entries(roleCounts).map(([roleKey, count]) => (
                  <Badge key={roleKey} variant="secondary">
                    {ROLE_LABELS[roleKey as Role] || roleKey}: {count}
                  </Badge>
                ))
              }
              {!loading && Object.keys(roleCounts).length === 0 && (
                 <span className="text-sm text-muted-foreground">No roles assigned</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-primary/20 shadow-sm">
        <CardHeader className="bg-primary/5 border-b pb-4">
          <CardTitle className="text-lg">Invite New Member</CardTitle>
          <CardDescription>Grant specific role-based permissions and optionally request Google Workspace account provisioning.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid gap-6 md:grid-cols-12">
            <div className="md:col-span-5 space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input id="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ops@thekada.com" />
            </div>
            <div className="md:col-span-4 space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select value={role} onValueChange={(val) => setRole(val as Role)}>
                <SelectTrigger id="role">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-3 flex items-end">
              <Button
                className="w-full"
                onClick={async () => {
                  const trimmed = email.trim();
                  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
                    toast.error("Enter a valid email address.");
                    return;
                  }
                  try {
                    const data = await adminAction("grantAdmin", { email: trimmed, role, createGoogleAccount: createGoogle });
                    toast.success(
                      (data as { claimsPending?: boolean }).claimsPending
                        ? "Listed on the team. Deploy adminPlatformAction to grant login claims."
                        : "Granted — they must sign out and back in",
                    );
                    setEmail("");
                    setCreateGoogle(false);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed");
                  }
                }}
              >
                Grant Access
              </Button>
            </div>
          </div>
          <div className="flex items-center space-x-2 pt-6">
            <Checkbox id="google-ws" checked={createGoogle} onCheckedChange={(v) => setCreateGoogle(!!v)} />
            <label
              htmlFor="google-ws"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
            >
              Provision Google Workspace Account (@thekada.in)
            </label>
          </div>
        </CardContent>
      </Card>
      
      <div className="rounded-md border bg-card">
        <DataTable columns={columns} data={rows} searchPlaceholder="Search team…" />
      </div>
    </div>
  );
}
