import { Router } from "express";
import { supa, snakeToCamel, camelToSnake } from "../lib/supabase.js";
import { requireAuth, requireRoles } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { randomBytes } from "crypto";

const router = Router();

function generateFarmerCode() {
  return "FRM-" + Date.now().toString(36).toUpperCase() + randomBytes(2).toString("hex").toUpperCase();
}
function generateBarcode() {
  return "BC" + String(Date.now()).slice(-8).padStart(8, "0");
}

router.get("/api/farmers", requireAuth, async (req, res) => {
  const { page = "1", limit = "20", search, status, districtId, valueChainId, beneficiaryType } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  let q = supa.from("farmers").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + Number(limit) - 1);
  if (search) q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,farmer_code.ilike.%${search}%,farmer_group.ilike.%${search}%`) as typeof q;
  if (status) q = q.eq("status", status) as typeof q;
  if (districtId) q = q.eq("district_id", Number(districtId)) as typeof q;
  if (valueChainId) q = q.eq("value_chain_id", Number(valueChainId)) as typeof q;
  if (beneficiaryType && (beneficiaryType === "individual" || beneficiaryType === "group")) q = q.eq("beneficiary_type", beneficiaryType) as typeof q;
  const { data, count, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ data: snakeToCamel(data ?? []), total: count ?? 0, page: Number(page), limit: Number(limit) });
});

router.post("/api/farmers", requireAuth, requireRoles("Admin", "ProjectManager", "DistrictCoordinator"), async (req, res) => {
  const farmerCode = generateFarmerCode();
  const barcodeToken = generateBarcode();
  const body = camelToSnake(req.body);
  const { data, error } = await supa.from("farmers").insert({ ...body, farmer_code: farmerCode, barcode_token: barcodeToken, registered_by: req.user!.userId }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "CREATE", "Farmers", `Registered farmer: ${(data as any).first_name} ${(data as any).last_name}`, "farmer", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});

router.get("/api/farmers/stats", requireAuth, async (_req, res) => {
  const { data } = await supa.from("farmers").select("status,gender");
  const rows = data ?? [];
  const stats = {
    total: rows.length,
    approved: rows.filter((r: any) => r.status === "approved").length,
    pending: rows.filter((r: any) => r.status === "pending").length,
    rejected: rows.filter((r: any) => r.status === "rejected").length,
    male: rows.filter((r: any) => r.gender === "Male").length,
    female: rows.filter((r: any) => r.gender === "Female").length,
  };
  res.json(stats);
});

router.get("/api/farmers/check-duplicate", requireAuth, async (req, res) => {
  const { phone, nationalId } = req.query as Record<string, string>;
  if (!phone?.trim() && !nationalId?.trim()) { res.json({ matches: [] }); return; }
  let q = supa.from("farmers").select("id, first_name, last_name, farmer_group, farmer_code, beneficiary_type, phone, national_id");
  const orParts: string[] = [];
  if (phone?.trim())      orParts.push(`phone.eq.${phone.trim()}`);
  if (nationalId?.trim()) orParts.push(`national_id.eq.${nationalId.trim()}`);
  q = (orParts.length === 1 ? q.or(orParts[0]) : q.or(orParts.join(","))) as typeof q;
  const { data, error } = await (q as any).limit(5);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ matches: snakeToCamel(data ?? []) });
});

router.get("/api/farmers/barcode/:token", requireAuth, async (req, res) => {
  const { data: rows, error } = await supa.from("farmers").select("*").eq("barcode_token", req.params.token).limit(1);
  if (error || !rows?.length) { res.status(404).json({ error: "Farmer not found for this barcode" }); return; }
  res.json(snakeToCamel(rows[0]));
});

router.get("/api/farmers/:id", requireAuth, async (req, res) => {
  const { data: rows, error } = await supa.from("farmers").select("*").eq("id", Number(req.params.id)).limit(1);
  if (error || !rows?.length) { res.status(404).json({ error: "Not found" }); return; }
  res.json(snakeToCamel(rows[0]));
});

router.put("/api/farmers/:id", requireAuth, requireRoles("Admin", "ProjectManager", "DistrictCoordinator"), async (req, res) => {
  const body = camelToSnake(req.body);
  const { data, error } = await supa.from("farmers").update({ ...body, updated_at: new Date().toISOString() }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "UPDATE", "Farmers", `Updated farmer ID ${req.params.id}`, "farmer", (data as any).id);
  res.json(snakeToCamel(data));
});

router.post("/api/farmers/:id/approve", requireAuth, requireRoles("Admin", "ProjectManager"), async (req, res) => {
  const { data, error } = await supa.from("farmers").update({ status: "approved", approved_by: req.user!.userId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "APPROVE", "Farmers", `Approved farmer ID ${req.params.id}`, "farmer", (data as any).id);
  res.json(snakeToCamel(data));
});

router.post("/api/farmers/:id/reject", requireAuth, requireRoles("Admin", "ProjectManager"), async (req, res) => {
  const { reason } = req.body;
  const { data, error } = await supa.from("farmers").update({ status: "rejected", rejection_reason: reason, updated_at: new Date().toISOString() }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "REJECT", "Farmers", `Rejected farmer ID ${req.params.id}: ${reason}`, "farmer", (data as any).id);
  res.json(snakeToCamel(data));
});

router.post("/api/farmers/bulk-import", requireAuth, requireRoles("Admin", "ProjectManager", "DistrictCoordinator"), async (req, res) => {
  const { rows, districtId, valueChainId } = req.body as {
    rows: Array<{
      firstName?: string; lastName?: string; gender?: string; phone?: string;
      beneficiaryType?: string; farmerGroup?: string; groupSize?: number;
    }>;
    districtId?: number;
    valueChainId?: number;
  };

  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "No rows provided" });
    return;
  }

  const createdBy = req.user?.userId;
  const created: any[] = [];
  const duplicates: Array<{ row: number; name: string; phone: string; matchedFarmerCode: string }> = [];
  let skipped = 0;

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    const firstName = String(row.firstName || "").trim();
    const lastName  = String(row.lastName  || "").trim();
    const farmerGroup = String(row.farmerGroup || "").trim() || null;
    const beneficiaryType = row.beneficiaryType === "group" ? "group" : "individual";
    const phone = String(row.phone || "").trim() || null;

    if (!firstName && !farmerGroup) { skipped++; continue; }

    if (phone) {
      const { data: existing, error: dupErr } = await supa
        .from("farmers")
        .select("farmer_code")
        .eq("phone", phone)
        .limit(1);

      if (dupErr) { skipped++; continue; }

      if (existing && existing.length > 0) {
        const displayName = farmerGroup || `${firstName} ${lastName}`.trim() || "—";
        duplicates.push({
          row: rowIdx + 1,
          name: displayName,
          phone,
          matchedFarmerCode: (existing[0] as any).farmer_code,
        });
        continue;
      }
    }

    const farmerCode   = generateFarmerCode();
    const barcodeToken = generateBarcode();

    const { data, error } = await supa.from("farmers").insert({
      first_name:       firstName || null,
      last_name:        String(row.lastName || "").trim() || null,
      gender:           row.gender || null,
      phone:            phone,
      district_id:      districtId ?? null,
      value_chain_id:   valueChainId ?? null,
      beneficiary_type: beneficiaryType,
      group_size:       row.groupSize ? Number(row.groupSize) : null,
      farmer_group:     farmerGroup,
      farmer_code:      farmerCode,
      barcode_token:    barcodeToken,
      status:           "pending",
      registered_by:    createdBy ?? null,
    }).select("id, farmer_code, barcode_token, first_name, last_name, farmer_group").single();

    if (error) { skipped++; continue; }

    created.push({
      id:           (data as any).id,
      farmerCode:   (data as any).farmer_code,
      barcodeToken: (data as any).barcode_token,
      name: farmerGroup || `${(data as any).first_name ?? ""} ${(data as any).last_name ?? ""}`.trim(),
    });
  }

  await logAudit(req, "BULK_IMPORT", "Farmers", `Bulk imported ${created.length} farmers (${skipped} skipped, ${duplicates.length} duplicates)`, "farmer", 0);
  res.status(201).json({ created: created.length, skipped, duplicates, farmers: created });
});

export default router;
