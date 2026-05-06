import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listInputItems, getStockBalance, KEYS } from "@/lib/db";
import { usePermissions } from "@/hooks/use-permissions";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowDownToLine, Box, PackageCheck, Pencil, Printer } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ReceiveStockModal } from "@/components/modals/ReceiveStockModal";
import { EditInputItemModal } from "@/components/modals/EditInputItemModal";
import { BarcodeLabelModal } from "@/components/modals/BarcodeLabelModal";

const CATEGORY_STYLES: Record<string, string> = {
  seed:       "bg-green-100  text-green-800  dark:bg-green-900/30   dark:text-green-400",
  fertilizer: "bg-amber-100  text-amber-800  dark:bg-amber-900/30   dark:text-amber-400",
  chemical:   "bg-purple-100 text-purple-800 dark:bg-purple-900/30  dark:text-purple-400",
  tool:       "bg-blue-100   text-blue-800   dark:bg-blue-900/30    dark:text-blue-400",
  equipment:  "bg-slate-100  text-slate-700  dark:bg-slate-800      dark:text-slate-300",
};

function CategoryBadge({ category }: { category?: string }) {
  const key = (category ?? "").toLowerCase();
  const cls = CATEGORY_STYLES[key] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {category ?? "—"}
    </span>
  );
}

function StockBar({ available, total }: { available: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((available / total) * 100)) : 0;
  const color = pct > 50 ? "bg-emerald-500" : pct > 20 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2 justify-end">
      <div className="w-14 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-medium tabular-nums w-12 text-right">{available?.toLocaleString()}</span>
    </div>
  );
}

export default function Inventory() {
  const can = usePermissions();
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [editItem, setEditItem]       = useState<any>(null);
  const [labelItem, setLabelItem]     = useState<any>(null);

  const { data: inputItems, isLoading: loadingItems } = useQuery({
    queryKey: KEYS.inventory(),
    queryFn: listInputItems,
  });
  const { data: stockBalances, isLoading: loadingStock } = useQuery({
    queryKey: KEYS.stockBalance(),
    queryFn: getStockBalance,
  });

  const stockList: any[] = stockBalances ?? [];
  const itemList: any[] = inputItems ?? [];

  const totalAvailable = stockList.reduce((s, r) => s + (r.available ?? 0), 0);
  const totalDelivered  = stockList.reduce((s, r) => s + (r.delivered ?? 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inventory"
        subtitle="Input catalogue and warehouse stock levels."
        actions={can.manageInventory ? (
          <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white" onClick={() => setReceiveOpen(true)}>
            <ArrowDownToLine className="h-3.5 w-3.5 mr-1.5" />
            Receive Stock
          </Button>
        ) : undefined}
      />

      {!loadingStock && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Available Units</p>
              <p className="text-2xl font-bold">{totalAvailable.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Delivered</p>
              <p className="text-2xl font-bold">{totalDelivered.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card className="hidden sm:block">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Catalogue Items</p>
              <p className="text-2xl font-bold">{itemList.length}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="stock">
        <TabsList className="h-8">
          <TabsTrigger value="stock"     className="text-xs">Stock Balances</TabsTrigger>
          <TabsTrigger value="catalogue" className="text-xs">Input Catalogue</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="mt-3">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">Warehouse</TableHead>
                    <TableHead>Input Item</TableHead>
                    <TableHead className="hidden md:table-cell">Category</TableHead>
                    <TableHead className="text-right pr-4">Available</TableHead>
                    <TableHead className="text-right hidden lg:table-cell">Reserved</TableHead>
                    <TableHead className="text-right hidden lg:table-cell pr-4">Delivered</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingStock
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4"><Skeleton className="h-4 w-36" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                          <TableCell className="pr-4"><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                          <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                          <TableCell className="hidden lg:table-cell pr-4"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                        </TableRow>
                      ))
                    : stockList.length > 0
                    ? stockList.map((stock: any, i: number) => {
                        const rowTotal = (stock.available ?? 0) + (stock.delivered ?? 0) + (stock.reserved ?? 0);
                        return (
                          <TableRow key={i} className="hover:bg-muted/40">
                            <TableCell className="pl-4 font-medium text-sm">{stock.warehouseName ?? "—"}</TableCell>
                            <TableCell className="text-sm">{stock.itemName ?? "—"}</TableCell>
                            <TableCell className="hidden md:table-cell">
                              <CategoryBadge category={stock.category} />
                            </TableCell>
                            <TableCell className="pr-4 text-right">
                              <StockBar available={stock.available ?? 0} total={rowTotal} />
                            </TableCell>
                            <TableCell className="hidden lg:table-cell text-right text-sm text-muted-foreground">{stock.reserved ?? 0}</TableCell>
                            <TableCell className="hidden lg:table-cell pr-4 text-right text-sm text-muted-foreground">{stock.delivered ?? 0}</TableCell>
                          </TableRow>
                        );
                      })
                    : (
                        <TableRow>
                          <TableCell colSpan={6} className="h-32 text-center">
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                              <Box className="h-8 w-8 opacity-30" />
                              <span className="text-sm">No stock yet</span>
                              {can.manageInventory && (
                                <Button size="sm" variant="outline" onClick={() => setReceiveOpen(true)}>
                                  <ArrowDownToLine className="h-3.5 w-3.5 mr-1.5" /> Receive first stock
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
        </TabsContent>

        <TabsContent value="catalogue" className="mt-3">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4 w-[120px]">Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="hidden md:table-cell">Unit</TableHead>
                    <TableHead className="hidden lg:table-cell">Barcode</TableHead>
                    {can.manageInventory && <TableHead className="pr-4 text-right w-[120px]" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingItems
                    ? Array.from({ length: 6 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4"><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                          <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-16" /></TableCell>
                          <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-32" /></TableCell>
                          {can.manageInventory && <TableCell className="pr-4" />}
                        </TableRow>
                      ))
                    : itemList.length > 0
                    ? itemList.map((item: any) => (
                        <TableRow key={item.id} className="hover:bg-muted/40">
                          <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{item.itemCode ?? item.code ?? "—"}</TableCell>
                          <TableCell className="font-medium text-sm">{item.name}</TableCell>
                          <TableCell><CategoryBadge category={item.category} /></TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{item.unit ?? item.unitOfMeasure ?? "—"}</TableCell>
                          <TableCell className="hidden lg:table-cell">
                            {item.barcode ? (
                              <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{item.barcode}</span>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">not set</span>
                            )}
                          </TableCell>
                          {can.manageInventory && (
                            <TableCell className="pr-4 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm" variant="ghost"
                                  className="h-7 px-2 text-muted-foreground hover:text-foreground"
                                  title="Print barcode label"
                                  onClick={() => setLabelItem(item)}
                                >
                                  <Printer className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm" variant="ghost"
                                  className="h-7 px-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                                  onClick={() => setEditItem(item)}
                                >
                                  <Pencil className="h-3 w-3 mr-1" /> Edit
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))
                    : (
                        <TableRow>
                          <TableCell colSpan={can.manageInventory ? 6 : 5} className="h-32 text-center">
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                              <PackageCheck className="h-8 w-8 opacity-30" />
                              <span className="text-sm">No input items found</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {can.manageInventory && (
        <>
          <ReceiveStockModal open={receiveOpen} onClose={() => setReceiveOpen(false)} />
          <EditInputItemModal open={!!editItem} item={editItem} onClose={() => setEditItem(null)} />
          {labelItem && (
            <BarcodeLabelModal
              open={!!labelItem}
              onClose={() => setLabelItem(null)}
              item={{
                name: labelItem.name,
                itemCode: labelItem.itemCode ?? labelItem.code ?? "",
                barcode: labelItem.barcode ?? "",
                category: labelItem.category,
                unit: labelItem.unit ?? labelItem.unitOfMeasure,
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
