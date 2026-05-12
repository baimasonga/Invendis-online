import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listUsers, activateUser, deactivateUser, updateUserRole, deleteUser, KEYS } from "@/lib/db";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, UserCog, UserCheck, UserX, Lock, Search, Pencil, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/hooks/use-toast";
import { InviteUserModal } from "@/components/modals/InviteUserModal";
import { EditUserModal } from "@/components/modals/EditUserModal";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const ROLES = [
  "Admin",
  "ProjectManager",
  "DistrictCoordinator",
  "WarehouseManager",
  "FieldOfficer",
  "Viewer",
];

const ROLE_STYLES: Record<string, string> = {
  admin:               "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  projectmanager:      "bg-blue-100   text-blue-800   dark:bg-blue-900/30   dark:text-blue-400",
  districtcoordinator: "bg-teal-100   text-teal-800   dark:bg-teal-900/30   dark:text-teal-400",
  warehousemanager:    "bg-amber-100  text-amber-800  dark:bg-amber-900/30  dark:text-amber-400",
  fieldofficer:        "bg-green-100  text-green-800  dark:bg-green-900/30  dark:text-green-400",
  viewer:              "bg-slate-100  text-slate-600  dark:bg-slate-800     dark:text-slate-300",
};

function RoleBadge({ role }: { role: string }) {
  const cls = ROLE_STYLES[role?.toLowerCase().replace(/\s+/g, "")] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {role}
    </span>
  );
}

function UserAvatar({ name }: { name: string }) {
  const initials = name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();
  const colors = ["bg-purple-100 text-purple-800", "bg-blue-100 text-blue-800", "bg-teal-100 text-teal-800", "bg-amber-100 text-amber-800", "bg-green-100 text-green-800"];
  const color = colors[name.charCodeAt(0) % colors.length];
  return (
    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold shrink-0 ${color}`}>
      {initials}
    </span>
  );
}

export default function Users() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const can = usePermissions();
  const { user: me } = useAuth();

  const [inviteOpen, setInviteOpen]       = useState(false);
  const [editUser, setEditUser]           = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget]   = useState<any | null>(null);
  const [loadingId, setLoadingId]         = useState<string | null>(null);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [search, setSearch]               = useState("");

  const { data: users, isLoading } = useQuery({
    queryKey: KEYS.users(),
    queryFn: listUsers,
  });

  const filteredUsers = useMemo(() => {
    const raw = (users as any[] | undefined) ?? [];
    if (!search.trim()) return raw;
    const q = search.toLowerCase();
    return raw.filter((u: any) =>
      (u.fullName ?? "").toLowerCase().includes(q) ||
      (u.email ?? "").toLowerCase().includes(q) ||
      (u.role ?? "").toLowerCase().includes(q)
    );
  }, [users, search]);

  const activateMutation   = useMutation({ mutationFn: (id: string) => activateUser(id) });
  const deactivateMutation = useMutation({ mutationFn: (id: string) => deactivateUser(id) });
  const roleMutation       = useMutation({ mutationFn: ({ id, role }: { id: string; role: string }) => updateUserRole(id, role) });
  const deleteMutation     = useMutation({ mutationFn: (id: string) => deleteUser(id) });

  async function handleToggle(id: string, currentlyActive: boolean) {
    setLoadingId(id);
    try {
      if (currentlyActive) {
        await deactivateMutation.mutateAsync(id);
        toast({ title: "User deactivated" });
      } else {
        await activateMutation.mutateAsync(id);
        toast({ title: "User activated" });
      }
      await qc.invalidateQueries({ queryKey: KEYS.users() });
    } catch (err: any) {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    } finally { setLoadingId(null); }
  }

  async function handleRoleChange(id: string, newRole: string) {
    try {
      await roleMutation.mutateAsync({ id, role: newRole });
      await qc.invalidateQueries({ queryKey: KEYS.users() });
      toast({ title: "Role updated", description: `Role changed to ${newRole}.` });
    } catch (err: any) {
      toast({ title: "Failed to update role", description: err.message, variant: "destructive" });
    } finally { setEditingRoleId(null); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      await qc.invalidateQueries({ queryKey: KEYS.users() });
      toast({ title: "User deleted" });
      setDeleteTarget(null);
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    }
  }

  if (!can.manageUsers) {
    return (
      <div className="space-y-5">
        <PageHeader title="User Management" subtitle="Manage system access and role assignments." />
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 p-4 text-sm text-amber-800 dark:text-amber-300">
          <Lock className="h-4 w-4 shrink-0" />
          <span>Only administrators can manage users and role assignments.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="User Management"
        subtitle="Manage system access and role assignments."
        actions={
          <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white" onClick={() => setInviteOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add User
          </Button>
        }
      />

      <div className="relative max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          className="pl-8 h-8 text-sm"
          placeholder="Search by name, email or role…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">User</TableHead>
                <TableHead className="hidden md:table-cell">Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><div className="flex items-center gap-2"><Skeleton className="h-7 w-7 rounded-full" /><Skeleton className="h-4 w-28" /></div></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-28 rounded-full" /></TableCell>
                      <TableCell className="hidden sm:table-cell"><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell className="pr-4"><Skeleton className="h-7 w-20 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                : filteredUsers.length > 0
                ? filteredUsers.map((user: any) => {
                    const busy    = loadingId === user.id;
                    const isSelf  = user.id === me?.id;
                    const displayName = user.fullName ?? user.email ?? "User";
                    return (
                      <TableRow key={user.id} className="hover:bg-muted/40">
                        <TableCell className="pl-4">
                          <div className="flex items-center gap-2">
                            <UserAvatar name={displayName} />
                            <div>
                              <p className="font-medium text-sm">{user.fullName ?? "—"}</p>
                              {isSelf && <p className="text-[10px] text-muted-foreground">(you)</p>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{user.email ?? "—"}</TableCell>
                        <TableCell>
                          {editingRoleId === user.id ? (
                            <Select
                              defaultValue={user.role}
                              onValueChange={(v) => handleRoleChange(user.id, v)}
                              onOpenChange={(open) => { if (!open) setEditingRoleId(null); }}
                            >
                              <SelectTrigger className="h-7 text-xs w-44">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ROLES.map(r => <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          ) : (
                            <button
                              className="text-left"
                              title="Click to change role"
                              onClick={() => !isSelf && setEditingRoleId(user.id)}
                            >
                              <RoleBadge role={user.role} />
                            </button>
                          )}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${user.isActive ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
                            {user.isActive ? "Active" : "Inactive"}
                          </span>
                        </TableCell>
                        <TableCell className="pr-4">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 w-7 p-0"
                              title="Edit user"
                              onClick={() => setEditUser(user)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            {!isSelf && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className={`h-7 px-2 text-xs ${user.isActive ? "hover:bg-red-50 hover:text-red-700 hover:border-red-200" : "hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200"}`}
                                  disabled={busy}
                                  onClick={() => handleToggle(user.id, user.isActive)}
                                >
                                  {user.isActive
                                    ? <><UserX className="h-3 w-3 mr-1" />Deactivate</>
                                    : <><UserCheck className="h-3 w-3 mr-1" />Activate</>
                                  }
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 w-7 p-0 hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                                  title="Delete user"
                                  onClick={() => setDeleteTarget(user)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                : (
                    <TableRow>
                      <TableCell colSpan={5} className="h-32 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <UserCog className="h-8 w-8 opacity-30" />
                          <span className="text-sm">{search ? "No users match your search" : "No users found"}</span>
                          {!search && (
                            <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)}>
                              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add first user
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <InviteUserModal open={inviteOpen} onClose={() => setInviteOpen(false)} />

      <EditUserModal
        open={editUser !== null}
        user={editUser}
        onClose={() => setEditUser(null)}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.fullName ?? deleteTarget?.email}</strong> and revoke their access. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete user"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
