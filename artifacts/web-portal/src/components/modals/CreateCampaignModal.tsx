import { useState } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import {
  createCampaign,
  listDistricts,
  listValueChains,
  listDistributionSites,
  listWarehouses,
  KEYS,
} from "@/lib/db";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onClose: () => void;
}
const EMPTY = {
  name: "",
  season: "",
  districtId: "",
  valueChainId: "",
  distributionSiteId: "",
  sourceWarehouseId: "",
  totalFarmers: "0",
  startDate: "",
  endDate: "",
  notes: "",
};

export function CreateCampaignModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const createMutation = useMutation({ mutationFn: createCampaign });
  const [form, setForm] = useState(EMPTY);
  const set = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const { data: districts = [] } = useQuery({
    queryKey: KEYS.districts(),
    queryFn: listDistricts,
  });
  const { data: valueChains = [] } = useQuery({
    queryKey: KEYS.valueChains(),
    queryFn: listValueChains,
  });
  const { data: sites = [] } = useQuery({
    queryKey: KEYS.distributionSites(),
    queryFn: listDistributionSites,
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: KEYS.warehouses(),
    queryFn: listWarehouses,
  });
  const siteList = (Array.isArray(sites) ? sites : []).filter(
    (s: any) =>
      !form.districtId || Number(s.districtId) === Number(form.districtId),
  );
  const reset = () => setForm(EMPTY);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.endDate < form.startDate) {
      toast({
        title: "Invalid dates",
        description: "End date cannot be before start date.",
        variant: "destructive",
      });
      return;
    }
    try {
      await createMutation.mutateAsync({
        ...form,
        districtId: Number(form.districtId),
        valueChainId: Number(form.valueChainId),
        distributionSiteId: Number(form.distributionSiteId),
        sourceWarehouseId: Number(form.sourceWarehouseId),
        totalFarmers: Number(form.totalFarmers),
      });
      await qc.invalidateQueries({ queryKey: KEYS.campaigns() });
      toast({
        title: "Campaign created",
        description: `“${form.name}” created as Draft.`,
      });
      reset();
      onClose();
    } catch (err: any) {
      toast({
        title: "Failed to create campaign",
        description: err.message,
        variant: "destructive",
      });
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create Campaign</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Season *</Label>
              <Input
                value={form.season}
                onChange={(e) => set("season", e.target.value)}
                placeholder="2026 Rainy Season"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>District *</Label>
              <Select
                value={form.districtId}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    districtId: v,
                    distributionSiteId: "",
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {(districts as any[]).map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Value Chain *</Label>
              <Select
                value={form.valueChainId}
                onValueChange={(v) => set("valueChainId", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {(valueChains as any[])
                    .filter((v) => v.isActive !== 0)
                    .map((v) => (
                      <SelectItem key={v.id} value={String(v.id)}>
                        {v.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Delivery Site *</Label>
              <Select
                value={form.distributionSiteId}
                onValueChange={(v) => set("distributionSiteId", v)}
                disabled={!form.districtId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {siteList
                    .filter((s: any) => s.isActive !== 0)
                    .map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Source Warehouse *</Label>
              <Select
                value={form.sourceWarehouseId}
                onValueChange={(v) => set("sourceWarehouseId", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {(warehouses as any[])
                    .filter((w) => w.isActive !== 0)
                    .map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>
                        {w.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Start *</Label>
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) => set("startDate", e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>End *</Label>
              <Input
                type="date"
                min={form.startDate}
                value={form.endDate}
                onChange={(e) => set("endDate", e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Target Farmers</Label>
              <Input
                type="number"
                min="0"
                value={form.totalFarmers}
                onChange={(e) => set("totalFarmers", e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-green-700 text-white"
              disabled={
                createMutation.isPending ||
                !form.districtId ||
                !form.valueChainId ||
                !form.distributionSiteId ||
                !form.sourceWarehouseId
              }
            >
              {createMutation.isPending ? "Creating…" : "Create Campaign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
