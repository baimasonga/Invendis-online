import { useState } from "react";
import { useListFarmers } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";

export default function Farmers() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  
  const { data: farmersData, isLoading } = useListFarmers({ page, limit: 20 });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Farmer Registry</h1>
          <p className="text-muted-foreground">Manage and verify registered farmers.</p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Register Farmer
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center space-x-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search by name, ID, or phone..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Value Chain</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : farmersData?.data && farmersData.data.length > 0 ? (
                  farmersData.data.map((farmer) => (
                    <TableRow key={farmer.id}>
                      <TableCell className="font-medium">{farmer.farmerCode}</TableCell>
                      <TableCell>{farmer.firstName} {farmer.lastName}</TableCell>
                      <TableCell>{farmer.districtName}, {farmer.chiefdomName}</TableCell>
                      <TableCell>{farmer.valueChainName}</TableCell>
                      <TableCell>
                        <Badge variant={farmer.status === 'approved' ? 'default' : farmer.status === 'rejected' ? 'destructive' : 'secondary'}>
                          {farmer.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/farmers/${farmer.id}`} className="text-primary hover:underline text-sm font-medium">
                          View
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No farmers found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
