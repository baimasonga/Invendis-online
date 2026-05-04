import { Router } from "express";
import { supa, snakeToCamel } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();

router.get("/api/dashboard/summary", requireAuth, async (_req, res) => {
  const [
    { data: farmers },
    { data: stock },
    { data: pod },
    { data: vehicles },
  ] = await Promise.all([
    supa.from("farmers").select("status"),
    supa.from("stock_balance").select("available,delivered"),
    supa.from("pod").select("status"),
    supa.from("vehicles").select("status"),
  ]);

  const farmerRows = farmers ?? [];
  const stockRows = stock ?? [];
  const podRows = pod ?? [];
  const vehicleRows = vehicles ?? [];

  res.json({
    totalFarmers: farmerRows.length,
    approvedFarmers: farmerRows.filter((r: any) => r.status === "approved").length,
    pendingFarmers: farmerRows.filter((r: any) => r.status === "pending").length,
    totalStock: stockRows.reduce((s: number, r: any) => s + (r.available ?? 0), 0),
    distributedInputs: stockRows.reduce((s: number, r: any) => s + (r.delivered ?? 0), 0),
    pendingPod: podRows.filter((r: any) => r.status === "Pending").length,
    exceptions: podRows.filter((r: any) => !["Verified", "Pending"].includes(r.status)).length,
    activeVehicles: vehicleRows.filter((r: any) => r.status === "InTransit").length,
  });
});

router.get("/api/dashboard/charts", requireAuth, async (_req, res) => {
  const [{ data: campaignsData }, { data: podData }] = await Promise.all([
    supa.from("campaigns").select("status"),
    supa.from("pod").select("status"),
  ]);

  const campaignsByStatus = Object.entries(
    (campaignsData ?? []).reduce((acc: Record<string, number>, r: any) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {})
  ).map(([status, count]) => ({ status, count }));

  const podByStatus = Object.entries(
    (podData ?? []).reduce((acc: Record<string, number>, r: any) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {})
  ).map(([status, count]) => ({ status, count }));

  res.json({ campaignsByStatus, podByStatus });
});

router.get("/api/dashboard/recent-activity", requireAuth, async (_req, res) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supa.from("audit_logs").select("id,action,module,description,username,created_at").gte("created_at", sevenDaysAgo).order("created_at", { ascending: false }).limit(20);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data ?? []));
});

export default router;
