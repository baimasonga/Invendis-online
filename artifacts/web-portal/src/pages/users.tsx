import { useListUsers } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus, UserCog } from "lucide-react";

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

function Avatar({ name }: { name: string }) {
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const colors = ["bg-purple-100 text-purple-800", "bg-blue-100 text-blue-800", "bg-teal-100 text-teal-800", "bg-amber-100 text-amber-800", "bg-green-100 text-green-800"];
  const color = colors[name.charCodeAt(0) % colors.length];
  return (
    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold shrink-0 ${color}`}>
      {initials}
    </span>
  );
}

export default function Users() {
  const { data: users, isLoading } = useListUsers();

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">User Management</h1>
          <p className="text-sm text-muted-foreground">Manage system access and role assignments.</p>
        </div>
        <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white">
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add User
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">User</TableHead>
                <TableHead className="hidden md:table-cell">Username</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden lg:table-cell">District</TableHead>
                <TableHead className="pr-4">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><div className="flex items-center gap-2"><Skeleton className="h-7 w-7 rounded-full" /><Skeleton className="h-4 w-28" /></div></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-28 rounded-full" /></TableCell>
                      <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="pr-4"><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                    </TableRow>
                  ))
                : users && (users as any[]).length > 0
                ? (users as any[]).map((user: any) => (
                    <TableRow key={user.id} className="hover:bg-muted/40">
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-2">
                          <Avatar name={user.fullName ?? user.username ?? "U"} />
                          <span className="font-medium text-sm">{user.fullName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell font-mono text-xs text-muted-foreground">{user.username}</TableCell>
                      <TableCell><RoleBadge role={user.role} /></TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{user.districtName ?? "All districts"}</TableCell>
                      <TableCell className="pr-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${user.isActive ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
                          {user.isActive ? "Active" : "Inactive"}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                : (
                    <TableRow>
                      <TableCell colSpan={5} className="h-32 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <UserCog className="h-8 w-8 opacity-30" />
                          <span className="text-sm">No users found</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
