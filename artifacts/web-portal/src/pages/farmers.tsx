import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listFarmers, approveFarmer, rejectFarmer, deleteFarmer, listDistricts, KEYS } from "@/lib/db";
import { usePermissions } from "@/hooks/use-permissions";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, Plus, ChevronLeft, ChevronRight, Users, CheckCircle2, XCircle, Pencil, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { RegisterFarmerModal } from "@/components/modals/RegisterFarmerModal";
import { EditFarmerModal } from "@/components/modals/EditFarmerModal";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader } from "@/components/PageHeader";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function Avatar({ name }: { name: string }) {
  const initials = name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-xs font-semibold shrink-0">
      {initials}
    </span>
  );
}

const STATUS_CHIPS = [
  { label: "All",      value: "" },
  { label: "Pending",  value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
];

export default function Farmers() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const can = usePermissions();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [districtFilter, setDistrictFilter] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [editFarmer, setEditFarmer] = useState<any>(null);
  const [rejectTarget, setRejectTarget] = useState<{ id: number; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);

  const limit = 20;
  const districtId = districtFilter && districtFilter !== "all" ? parseInt(districtFilter) : undefined;

  const { data: farmersData, isLoading } = useQuery({
    queryKey: KEYS.farmers(page, search, statusFilter || undefined, districtId),
    queryFn: () => listFarmers(page, limit, search || undefined, statusFilter || undefined, districtId),
  });

  const { data: districts } = useQuery({
    queryKey: KEYS.districts(),
    queryFn: listDistricts,
  });

  const total = farmersData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const approveMutation = useMutation({ mutationFn: (id: number) => approveFarmer(id) });
  const rejectMutation  = useMutation({ mutationFn: (id: number) => rejectFarmer(id) });
  const deleteMutation  = useMutation({ mutationFn: (id: number) => deleteFarmer(id) });

  async function handleApprove(id: number) {
    setLoadingId(id);
    try {
      await approveMutation.mutateAsync(id);
      await qc.invalidateQueries({ queryKey: KEYS.farmers() });
      await qc.invalidateQueries({ queryKey: KEYS.alertCounts() });
      toast({ title: "Farmer approved" });
    } catch (err: any) {
      toast({ title: "Failed to approve", description: err.message, variant: "destructive" });
    } finally { setLoadingId(null); }
  }

  async function handleRejectConfirm() {
    if (!rejectTarget) return;
    setLoadingId(rejectTarget.id);
    try {
      await rejectMutation.mutateAsync(rejectTarget.id);
      await qc.invalidateQueries({ queryKey: KEYS.farmers() });
      await qc.invalidateQueries({ queryKey: KEYS.alertCounts() });
      toast({ title: "Farmer rejected" });
    } catch (err: any) {
      toast({ title: "Failed to reject", description: err.message, variant: "destructive" });
    } finally { setLoadingId(null); setRejectTarget(null); }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setLoadingId(deleteTarget.id);
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      await qc.invalidateQueries({ queryKey: KEYS.farmers() });
      await qc.invalidateQueries({ queryKey: KEYS.alertCounts() });
      toast({ title: "Farmer deleted" });
    } catch (err: any) {
      toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
    } finally { setLoadingId(null); setDeleteTarget(null); }
  }

  function resetFilters() {
    setSearch(""); setStatusFilter(""); setDistrictFilter(""); setPage(1);
  }

  const hasFilters = !!(search || statusFilter || districtFilter);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Farmer Registry"
        subtitle="Manage and verify registered farmers."
        actions={can.registerFarmer ? (
          <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white" onClick={() => setRegisterOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Register Farmer
          </Button>
        ) : undefined}
      />

      <Card>
        <CardHeader className="pb-3 pt-4 px-4 space-y-3">
          {/* Row 1: search + district + count */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search farmers…"
                className="pl-8 h-8 text-sm"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <Select value={districtFilter || "all"} onValueChange={(v) => { setDistrictFilter(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="h-8 text-sm w-[160px]">
                <SelectValue placeholder="All Districts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Districts</SelectItem>
                {(districts ?? []).map((d: any) => (
                  <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={resetFilters}>
                Clear filters
              </Button>
            )}
            {!isLoading && (
              <span className="text-xs text-muted-foreground ml-auto">{total.toLocaleString()} farmers</span>
            )}
          </div>

          {/* Row 2: status chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {STATUS_CHIPS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => { setStatusFilter(value); setPage(1); }}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  statusFilter === value
                    ? "bg-green-700 text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-t">
                <TableHead className="pl-4 w-[120px]">Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Location</TableHead>
                <TableHead className="hidden lg:table-cell">Value Chain</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><div className="flex items-center gap-2"><Skeleton className="h-7 w-7 rounded-full" /><Skeleton className="h-4 w-28" /></div></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell className="pr-4"><Skeleton className="h-7 w-24 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                : farmersData?.data && farmersData.data.length > 0
                ? farmersData.data.map((farmer) => (
                    <TableRow key={farmer.id} className="hover:bg-muted/40">
                      <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{farmer.farmerCode}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar name={`${farmer.firstName} ${farmer.lastName}`} />
                          <span className="font-medium text-sm">{farmer.firstName} {farmer.lastName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {farmer.districtName}{farmer.chiefdomName ? `, ${farmer.chiefdomName}` : ""}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm">{farmer.valueChainName ?? "—"}</TableCell>
                      <TableCell><StatusBadge status={farmer.status} /></TableCell>
                      <TableCell className="pr-4">
                        <div className="flex items-center gap-1 justify-end">
                          {can.approveFarmer && farmer.status === "pending" && (
                            <>
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 px-2 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50"
                                disabled={loadingId === farmer.id}
                                onClick={() => handleApprove(farmer.id)}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                              </Button>
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 px-2 text-red-600 hover:text-red-800 hover:bg-red-50"
                                disabled={loadingId === farmer.id}
                                onClick={() => setRejectTarget({ id: farmer.id, name: `${farmer.firstName} ${farmer.lastName}` })}
                              >
                                <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                              </Button>
                            </>
                          )}
                          {can.editFarmer && (
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 px-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                              onClick={() => setEditFarmer(farmer)}
                            >
                              <Pencil className="h-3 w-3 mr-1" /> Edit
                            </Button>
                          )}
                          {can.editFarmer && (
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 px-2 text-red-600 hover:text-red-800 hover:bg-red-50"
                              disabled={loadingId === farmer.id}
                              onClick={() => setDeleteTarget({ id: farmer.id, name: `${farmer.firstName} ${farmer.lastName}` })}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                          <Link href={`/farmers/${farmer.id}`}>
                            <span className="text-xs font-medium text-green-700 hover:text-green-900 hover:underline cursor-pointer ml-1">View</span>
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                : (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <Users className="h-8 w-8 opacity-30" />
                          <span className="text-sm">{hasFilters ? "No farmers match your filters" : "No farmers found"}</span>
                          {hasFilters && (
                            <Button size="sm" variant="outline" onClick={resetFilters}>Clear filters</Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
            </TableBody>
          </Table>

          {total > limit && (
            <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
              <span>Page {page} of {totalPages}</span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {can.registerFarmer && (
        <RegisterFarmerModal open={registerOpen} onClose={() => setRegisterOpen(false)} />
      )}
      {can.editFarmer && (
        <EditFarmerModal open={!!editFarmer} farmer={editFarmer} onClose={() => setEditFarmer(null)} />
      )}

      <AlertDialog open={!!rejectTarget} onOpenChange={(v) => { if (!v) setRejectTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Farmer?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark <strong>{rejectTarget?.name}</strong> as rejected. You can reverse this later by editing the farmer record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={handleRejectConfirm}>
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Farmer?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong> and all associated records. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={handleDeleteConfirm}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
