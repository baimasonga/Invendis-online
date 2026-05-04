import { useListInputItems, useGetStockBalance } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

export default function Inventory() {
  const { data: inputItems, isLoading: isLoadingItems } = useListInputItems();
  const { data: stockBalances, isLoading: isLoadingStock } = useGetStockBalance();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
        <p className="text-muted-foreground">Manage input catalogue and warehouse stock.</p>
      </div>

      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">Stock Balances</TabsTrigger>
          <TabsTrigger value="catalogue">Input Catalogue</TabsTrigger>
        </TabsList>
        
        <TabsContent value="stock" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Warehouse Stock</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Warehouse</TableHead>
                      <TableHead>Input Item</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead className="text-right">Reserved</TableHead>
                      <TableHead className="text-right">Delivered</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingStock ? (
                      <TableRow><TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                    ) : stockBalances && stockBalances.length > 0 ? (
                      stockBalances.map((stock, i) => (
                        <TableRow key={i}>
                          <TableCell>{stock.warehouseName}</TableCell>
                          <TableCell>{stock.inputItemName}</TableCell>
                          <TableCell className="text-right font-medium">{stock.available}</TableCell>
                          <TableCell className="text-right">{stock.reserved}</TableCell>
                          <TableCell className="text-right">{stock.delivered}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                          No stock balances found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="catalogue" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Input Items</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Value Chain</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingItems ? (
                      <TableRow><TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                    ) : inputItems && inputItems.length > 0 ? (
                      inputItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.code}</TableCell>
                          <TableCell>{item.name}</TableCell>
                          <TableCell>{item.category}</TableCell>
                          <TableCell>{item.unitOfMeasure}</TableCell>
                          <TableCell>{item.valueChainName || '-'}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                          No input items found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
