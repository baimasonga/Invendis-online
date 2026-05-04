import { useParams, Link } from "wouter";
import { useGetFarmer, getGetFarmerQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, User, MapPin, Sprout, Hash } from "lucide-react";

export default function FarmerDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0");
  
  const { data: farmer, isLoading } = useGetFarmer(id, { 
    query: { enabled: !!id, queryKey: getGetFarmerQueryKey(id) } 
  });

  if (isLoading) {
    return <div className="p-8 space-y-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-[400px] w-full" />
    </div>;
  }

  if (!farmer) {
    return <div className="p-8 text-center">Farmer not found</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/farmers">
          <Button variant="outline" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{farmer.firstName} {farmer.lastName}</h1>
          <p className="text-muted-foreground">Farmer Details</p>
        </div>
        <div className="ml-auto flex gap-2">
          {farmer.status === 'pending' && (
            <>
              <Button variant="destructive">Reject</Button>
              <Button>Approve</Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Personal Information</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground flex items-center gap-1"><Hash className="w-4 h-4"/> Farmer Code</span>
                <p className="font-medium">{farmer.farmerCode}</p>
              </div>
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground flex items-center gap-1"><User className="w-4 h-4"/> Gender</span>
                <p className="font-medium">{farmer.gender}</p>
              </div>
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground">Phone</span>
                <p className="font-medium">{farmer.phone || 'N/A'}</p>
              </div>
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground">National ID</span>
                <p className="font-medium">{farmer.nationalId || 'N/A'}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Agricultural Profile</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground flex items-center gap-1"><Sprout className="w-4 h-4"/> Value Chain</span>
                <p className="font-medium">{farmer.valueChainName}</p>
              </div>
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground">Farm Size (Ha)</span>
                <p className="font-medium">{farmer.farmSize || 'N/A'}</p>
              </div>
              <div className="col-span-2 space-y-1">
                <span className="text-sm text-muted-foreground flex items-center gap-1"><MapPin className="w-4 h-4"/> Location</span>
                <p className="font-medium">{farmer.districtName}, {farmer.chiefdomName}, {farmer.communityName}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center p-6 text-center space-y-4">
              <Badge className="text-lg px-4 py-1" variant={farmer.status === 'approved' ? 'default' : farmer.status === 'rejected' ? 'destructive' : 'secondary'}>
                {farmer.status.toUpperCase()}
              </Badge>
              {farmer.barcodeToken && (
                <div className="mt-4 p-4 border rounded-md bg-white">
                  <div className="text-xs text-muted-foreground mb-2">Farmer ID Barcode</div>
                  <img 
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${farmer.barcodeToken}`} 
                    alt="Farmer QR Code" 
                    className="mx-auto"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
