import { useState } from "react";
import { useListFarmers } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus, ChevronLeft, ChevronRight, Users } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";

const STATUS_STYLES: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  pending:  "bg-amber-100  text-amber-800  dark:bg-amber-900/30  dark:text-amber-400",
  rejected: "bg-red-100    text-red-800    dark:bg-red-900/30    dark:text-red-400",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status?.toLowerCase()] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${cls}`}>
      {status}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-xs font-semibold shrink-0">
      {initials}
    </span>
  );
}

export default function Farmers() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const limit = 20;
  const { data: farmersData, isLoading } = useListFarmers({ page, limit });
  const total = farmersData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Farmer Registry</h1>
          <p className="text-sm text-muted-foreground">Manage and verify registered farmers.</p>
        </div>
        <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white">
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Register Farmer
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search farmers…"
                className="pl-8 h-8 text-sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {!isLoading && (
              <span className="text-xs text-muted-foreground">{total.toLocaleString()} farmers</span>
            )}
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
                <TableHead className="pr-4 text-right w-[70px]"></TableHead>
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
                      <TableCell><Skeleton className="h-5 w-18 rounded-full" /></TableCell>
                      <TableCell className="pr-4" />
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
                      <TableCell className="pr-4 text-right">
                        <Link href={`/farmers/${farmer.id}`}>
                          <span className="text-xs font-medium text-green-700 hover:text-green-900 hover:underline cursor-pointer">View</span>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))
                : (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <Users className="h-8 w-8 opacity-30" />
                          <span className="text-sm">No farmers found</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
            </TableBody>
          </Table>

          {/* Pagination */}
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
    </div>
  );
}
