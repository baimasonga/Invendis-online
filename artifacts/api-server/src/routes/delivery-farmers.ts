import { Router } from "express";
import { requireAnyAuth } from "../lib/auth.js";
import { canReadDispatch } from "../lib/dispatch-auth.js";
import { snakeToCamel, supa } from "../lib/supabase.js";

const router = Router();

async function authorizedDeliveryDispatch(req: import("express").Request, dispatchId: number) {
  if (!Number.isInteger(dispatchId) || dispatchId <= 0) return null;
  const { data } = await supa.from("dispatches").select("id,campaign_id,field_officer_id,status").eq("id", dispatchId).maybeSingle();
  if (!data || !(await canReadDispatch(req, data as any))) return null;
  return ["In Transit", "Arrived"].includes(String((data as any).status)) ? data : null;
}

router.get("/api/dispatch/:dispatchId/farmers", requireAnyAuth, async (req, res) => {
  const dispatch = await authorizedDeliveryDispatch(req, Number(req.params.dispatchId));
  if (!dispatch) { res.status(404).json({ error: "Active assigned dispatch not found" }); return; }
  const search = String(req.query.search ?? "").trim().toLowerCase();
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
  const { data: allocations, error: allocationError } = await supa.from("allocations").select("farmer_id").eq("campaign_id", (dispatch as any).campaign_id).in("status", ["Approved", "Pending"]);
  if (allocationError) { res.status(500).json({ error: "Unable to load campaign beneficiaries" }); return; }
  const farmerIds = [...new Set((allocations ?? []).map((row: any) => Number(row.farmer_id)).filter(Number.isInteger))];
  if (!farmerIds.length) { res.json({ data: [], total: 0 }); return; }
  const { data: farmers, error } = await supa.from("farmers").select("*").in("id", farmerIds).eq("status", "approved").order("created_at", { ascending: false });
  if (error) { res.status(500).json({ error: "Unable to load campaign beneficiaries" }); return; }
  const matches = (farmers ?? []).filter((farmer: any) => !search || [farmer.farmer_code, farmer.first_name, farmer.last_name, farmer.farmer_group, farmer.phone].some((value) => String(value ?? "").toLowerCase().includes(search)));
  res.json({ data: snakeToCamel(matches.slice(0, limit)), total: matches.length });
});

router.get("/api/dispatch/:dispatchId/farmers/barcode/:token", requireAnyAuth, async (req, res) => {
  const dispatch = await authorizedDeliveryDispatch(req, Number(req.params.dispatchId));
  if (!dispatch) { res.status(404).json({ error: "Active assigned dispatch not found" }); return; }
  const { data: farmer } = await supa.from("farmers").select("*").eq("barcode_token", req.params.token).eq("status", "approved").maybeSingle();
  if (!farmer) { res.status(404).json({ error: "Farmer not found for this barcode" }); return; }
  const { data: allocation } = await supa.from("allocations").select("id").eq("campaign_id", (dispatch as any).campaign_id).eq("farmer_id", (farmer as any).id).in("status", ["Approved", "Pending"]).maybeSingle();
  if (!allocation) { res.status(404).json({ error: "Farmer is not allocated to this dispatch campaign" }); return; }
  res.json(snakeToCamel(farmer));
});

export default router;
