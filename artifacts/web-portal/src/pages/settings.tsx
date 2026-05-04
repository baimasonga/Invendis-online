import { useListDistricts, useListValueChains, useListWarehouses } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function Settings() {
  const { data: districts, isLoading: loadingDistricts } = useListDistricts();
  const { data: valueChains, isLoading: loadingVC } = useListValueChains();
  const { data: warehouses, isLoading: loadingWh } = useListWarehouses();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Master Data Settings</h1>
        <p className="text-muted-foreground">Configure baseline system data and locations.</p>
      </div>

      <Tabs defaultValue="districts">
        <TabsList>
          <TabsTrigger value="districts">Districts</TabsTrigger>
          <TabsTrigger value="value-chains">Value Chains</TabsTrigger>
          <TabsTrigger value="warehouses">Warehouses</TabsTrigger>
        </TabsList>
        
        <TabsContent value="districts" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Districts</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingDistricts ? (
                      <TableRow><TableCell colSpan={2}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                    ) : districts && districts.length > 0 ? (
                      districts.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-medium">{d.code}</TableCell>
                          <TableCell>{d.name}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow><TableCell colSpan={2} className="text-center h-24">No data</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="value-chains" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Value Chains</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingVC ? (
                      <TableRow><TableCell colSpan={3}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                    ) : valueChains && valueChains.length > 0 ? (
                      valueChains.map((vc) => (
                        <TableRow key={vc.id}>
                          <TableCell className="font-medium">{vc.name}</TableCell>
                          <TableCell>{vc.description || '-'}</TableCell>
                          <TableCell>
                            <Badge variant={vc.isActive ? 'default' : 'secondary'}>{vc.isActive ? 'Active' : 'Inactive'}</Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow><TableCell colSpan={3} className="text-center h-24">No data</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="warehouses" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Warehouses</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>District</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingWh ? (
                      <TableRow><TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                    ) : warehouses && warehouses.length > 0 ? (
                      warehouses.map((wh) => (
                        <TableRow key={wh.id}>
                          <TableCell className="font-medium">{wh.code}</TableCell>
                          <TableCell>{wh.name}</TableCell>
                          <TableCell>{wh.districtName}</TableCell>
                          <TableCell>{wh.address || '-'}</TableCell>
                          <TableCell>
                            <Badge variant={wh.isActive ? 'default' : 'secondary'}>{wh.isActive ? 'Active' : 'Inactive'}</Badge>
                          </TableCell>
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
