import { useState } from "react";
import { useGetFarmerBeneficiaryReport, useGetStockMovementReport, useGetDistributionReport } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

export default function Reports() {
  const { data: benReport, isLoading: isLoadingBen } = useGetFarmerBeneficiaryReport();
  const { data: stockReport, isLoading: isLoadingStock } = useGetStockMovementReport();
  const { data: distReport, isLoading: isLoadingDist } = useGetDistributionReport();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports & Analytics</h1>
        <p className="text-muted-foreground">View comprehensive data across operations.</p>
      </div>

      <Tabs defaultValue="beneficiary">
        <TabsList>
          <TabsTrigger value="beneficiary">Farmer Beneficiaries</TabsTrigger>
          <TabsTrigger value="stock">Stock Movement</TabsTrigger>
          <TabsTrigger value="distribution">Distribution</TabsTrigger>
        </TabsList>
        
        <TabsContent value="beneficiary" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Beneficiaries</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold">{benReport?.totalBeneficiaries || 0}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Female</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold">{benReport?.female || 0}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Male</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold">{benReport?.male || 0}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Youth</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold">{benReport?.youth || 0}</div></CardContent>
            </Card>
          </div>
          
          <Card>
            <CardHeader><CardTitle>Beneficiary List</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Farmer Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Gender</TableHead>
                      <TableHead>District</TableHead>
                      <TableHead>Value Chain</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingBen ? (
                      <TableRow><TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                    ) : benReport?.rows && benReport.rows.length > 0 ? (
                      benReport.rows.map((row, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{row.farmerCode}</TableCell>
                          <TableCell>{row.name}</TableCell>
                          <TableCell>{row.gender}</TableCell>
                          <TableCell>{row.district}</TableCell>
                          <TableCell>{row.valueChain}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow><TableCell colSpan={5} className="text-center h-24">No data</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stock" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Stock Movement</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Warehouse</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingStock ? (
                      <TableRow><TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                    ) : stockReport?.rows && stockReport.rows.length > 0 ? (
                      stockReport.rows.map((row, i) => (
                        <TableRow key={i}>
                          <TableCell>{new Date(row.date).toLocaleDateString()}</TableCell>
                          <TableCell>{row.transactionType}</TableCell>
                          <TableCell>{row.inputItem}</TableCell>
                          <TableCell>{row.warehouse}</TableCell>
                          <TableCell className="text-right">{row.quantity}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow><TableCell colSpan={5} className="text-center h-24">No data</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="distribution" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Distribution Status</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>District</TableHead>
                      <TableHead className="text-right">Allocated</TableHead>
                      <TableHead className="text-right">Delivered</TableHead>
                      <TableHead className="text-right">Pending</TableHead>
                      <TableHead className="text-right">Completion %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingDist ? (
                      <TableRow><TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                    ) : distReport?.rows && distReport.rows.length > 0 ? (
                      distReport.rows.map((row, i) => (
                        <TableRow key={i}>
                          <TableCell>{row.district}</TableCell>
                          <TableCell className="text-right">{row.allocated}</TableCell>
                          <TableCell className="text-right">{row.delivered}</TableCell>
                          <TableCell className="text-right">{row.pending}</TableCell>
                          <TableCell className="text-right">{row.completionRate.toFixed(1)}%</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow><TableCell colSpan={5} className="text-center h-24">No data</TableCell></TableRow>
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
