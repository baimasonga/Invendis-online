import { useParams, Link } from "wouter";
import { useGetCampaign, getGetCampaignQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Calendar, MapPin, Users, Package } from "lucide-react";

export default function CampaignDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0");
  
  const { data: campaign, isLoading } = useGetCampaign(id, { 
    query: { enabled: !!id, queryKey: getGetCampaignQueryKey(id) } 
  });

  if (isLoading) {
    return <div className="p-8 space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-[400px] w-full" /></div>;
  }

  if (!campaign) {
    return <div className="p-8 text-center">Campaign not found</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/campaigns">
          <Button variant="outline" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{campaign.name}</h1>
          <p className="text-muted-foreground">{campaign.campaignCode}</p>
        </div>
        <div className="ml-auto flex gap-2">
          {campaign.status === 'Draft' && <Button variant="outline">Submit</Button>}
          {campaign.status === 'Submitted' && <Button>Approve</Button>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Campaign Details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground flex items-center gap-1"><MapPin className="w-4 h-4"/> District</span>
                <p className="font-medium">{campaign.districtName}</p>
              </div>
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground">Value Chain</span>
                <p className="font-medium">{campaign.valueChainName}</p>
              </div>
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground flex items-center gap-1"><Calendar className="w-4 h-4"/> Timeline</span>
                <p className="font-medium">{new Date(campaign.startDate).toLocaleDateString()} to {new Date(campaign.endDate).toLocaleDateString()}</p>
              </div>
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground">Distribution Site</span>
                <p className="font-medium">{campaign.distributionSite || 'N/A'}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center border-b pb-2">
                <span className="text-muted-foreground">Status</span>
                <Badge>{campaign.status}</Badge>
              </div>
              <div className="flex justify-between items-center border-b pb-2">
                <span className="text-muted-foreground flex items-center gap-1"><Users className="w-4 h-4"/> Target Farmers</span>
                <span className="font-medium">{campaign.totalFarmers || 0}</span>
              </div>
              <div className="flex justify-between items-center pb-2">
                <span className="text-muted-foreground flex items-center gap-1"><Package className="w-4 h-4"/> Delivered</span>
                <span className="font-medium text-primary">{campaign.deliveredCount || 0}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
