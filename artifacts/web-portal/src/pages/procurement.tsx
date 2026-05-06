import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listProcurementOrders, KEYS } from "@/lib/db";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus, ShoppingCart } from "lucide-react";
import { CreateProcurementOrderModal } from "@/components/modals/CreateProcurementOrderModal";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";

export default function Procurement() {
  const [createOpen, setCreateOpen] = useState(false);

  const { data: orders, isLoading } = useQuery({
    queryKey: KEYS.procurement(),
    queryFn: listProcurementOrders,
  });
  const orderList: any[] = Array.isArray(orders) ? orders : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Procurement"
        subtitle="Manage incoming stock orders from suppliers."
        actions={
          <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Create Order
          </Button>
        }
      />

      <Card>
        <CardHeader className="pb-0 pt-4 px-4">
          {!isLoading && <p className="text-xs text-muted-foreground">{orderList.length} orders</p>}
        </CardHeader>
        <CardContent className="p-0 mt-2">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-t">
                <TableHead className="pl-4 w-[130px]">Order Code</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="hidden md:table-cell">Warehouse</TableHead>
                <TableHead className="hidden lg:table-cell">Order Date</TableHead>
                <TableHead className="hidden lg:table-cell">Expected</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                    </TableRow>
                  ))
                : orderList.length > 0
                ? orderList.map((o: any) => (
                    <TableRow key={o.id} className="hover:bg-muted/40">
                      <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{o.orderCode}</TableCell>
                      <TableCell className="text-sm font-medium">{o.supplierName ?? "—"}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{o.warehouseName ?? "—"}</TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                        {o.orderDate ? new Date(o.orderDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                        {o.expectedDelivery ? new Date(o.expectedDelivery).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                      </TableCell>
                      <TableCell><StatusBadge status={o.status} /></TableCell>
                    </TableRow>
                  ))
                : (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <ShoppingCart className="h-8 w-8 opacity-30" />
                          <span className="text-sm">No procurement orders yet</span>
                          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                            <Plus className="h-3.5 w-3.5 mr-1.5" /> Create first order
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CreateProcurementOrderModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
