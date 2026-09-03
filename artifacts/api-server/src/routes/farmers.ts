import { Router } from "express";
import { supa, snakeToCamel, camelToSnake } from "../lib/supabase.js";
import { requireAuth, requireAnyAuth, requireRoles } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { validateBody, FarmerCreateSchema } from "../lib/validate.js";
import { getPresignedViewUrl } from "../lib/aws.js";
import { randomBytes } from "crypto";

const router = Router();

function generateFarmerCode() {
  return "FRM-" + Date.now().toString(36).toUpperCase() + randomBytes(2).toString("hex").toUpperCase();
}
function generateBarcode() {
  return "BC" + String(Date.now()).slice(-8).padStart(8, "0");
}

router.get("/api/farmers", requireAnyAuth, async (req, res) => {
  const { page = "1", limit = "20", search, status, districtId, valueChainId } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  let q = supa.from("farmers").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + Number(limit) - 1);
  if (search) {
    const parts = search.trim().split(/\s+/);
    if (parts.length >= 2) {
      const first = parts[0];
      const last = parts.slice(1).join(" ");
      q = q.or(
        `and(first_name.ilike.%${first}%,last_name.ilike.%${last}%),` +
        `first_name.ilike.%${search}%,last_name.ilike.%${search}%,` +
        `farmer_code.ilike.%${search}%,farmer_group.ilike.%${search}%`
      ) as typeof q;
    } else {
      q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,farmer_code.ilike.%${search}%,farmer_group.ilike.%${search}%`) as typeof q;
    }
  }
  if (status) q = q.eq("status", status) as typeof q;
  if (districtId) q = q.eq("district_id", Number(districtId)) as typeof q;
  if (valueChainId) q = q.eq("value_chain_id", Number(valueChainId)) as typeof q;
  const { data, count, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ data: snakeToCamel(data ?? []), total: count ?? 0, page: Number(page), limit: Number(limit) });
});

router.post("/api/farmers", requireAuth, requireRoles("Admin", "ProjectManager", "DistrictCoordinator", "WarehouseManager"), validateBody(FarmerCreateSchema), async (req, res) => {
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

router.get("/api/farmers/barcode/:token", requireAnyAuth, async (req, res) => {
  const { data: rows, error } = await supa.from("farmers").select("*").eq("barcode_token", req.params.token).limit(1);
  if (error || !rows?.length) { res.status(404).json({ error: "Farmer not found for this barcode" }); return; }
  res.json(snakeToCamel(rows[0]));
});

router.get("/api/farmers/:id", requireAuth, async (req, res) => {
  const { data: rows, error } = await supa.from("farmers").select("*").eq("id", Number(req.params.id)).limit(1);
  if (error || !rows?.length) { res.status(404).json({ error: "Not found" }); return; }
  res.json(snakeToCamel(rows[0]));
});

router.put("/api/farmers/:id", requireAuth, requireRoles("Admin", "ProjectManager", "DistrictCoordinator", "WarehouseManager"), async (req, res) => {
  const body = camelToSnake(req.body);
  const { data, error } = await supa.from("farmers").update({ ...body, updated_at: new Date().toISOString() }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "UPDATE", "Farmers", `Updated farmer ID ${req.params.id}`, "farmer", (data as any).id);
  res.json(snakeToCamel(data));
});

router.post("/api/farmers/:id/approve", requireAuth, requireRoles("Admin", "ProjectManager", "DistrictCoordinator"), async (req, res) => {
  const { data, error } = await supa.from("farmers").update({ status: "approved", approved_by: req.user!.userId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "APPROVE", "Farmers", `Approved farmer ID ${req.params.id}`, "farmer", (data as any).id);
  res.json(snakeToCamel(data));
});

router.post("/api/farmers/:id/reject", requireAuth, requireRoles("Admin", "ProjectManager", "DistrictCoordinator"), async (req, res) => {
  const { reason } = req.body;
  const { data, error } = await supa.from("farmers").update({ status: "rejected", rejection_reason: reason, updated_at: new Date().toISOString() }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "REJECT", "Farmers", `Rejected farmer ID ${req.params.id}: ${reason}`, "farmer", (data as any).id);
  res.json(snakeToCamel(data));
});

router.delete("/api/farmers/:id", requireAuth, requireRoles("Admin", "ProjectManager"), async (req, res) => {
  const id = Number(req.params.id);
  const { error } = await supa.from("farmers").delete().eq("id", id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "DELETE", "Farmers", `Deleted farmer ID ${id}`, "farmer", id);
  res.json({ success: true });
});

// ── POST /api/farmers/bulk-check-duplicates ──────────────────────────────────────────────
// Checks a list of phone numbers and/or national IDs against existing farmers.
// Returns the farmers that already exist for any of the given phones/nationalIds.
// `phones` is kept as the original param for backward compatibility with the
// bulk-import flow; `nationalIds` is an additive, optional param.
router.post("/api/farmers/bulk-check-duplicates", requireAnyAuth, async (req, res) => {
  const { phones, nationalIds } = req.body as { phones?: string[]; nationalIds?: string[] };
  const cleanPhones = Array.isArray(phones) ? phones.map((p: string) => String(p).trim()).filter(Boolean) : [];
  const cleanNationalIds = Array.isArray(nationalIds) ? nationalIds.map((n: string) => String(n).trim()).filter(Boolean) : [];

  if (cleanPhones.length === 0 && cleanNationalIds.length === 0) {
    res.json({ duplicates: [] });
    return;
  }

  const selectCols = "id, phone, national_id, farmer_code, first_name, last_name, farmer_group";
  const matches = new Map<number, any>();

  if (cleanPhones.length > 0) {
    const { data, error } = await supa.from("farmers").select(selectCols).in("phone", cleanPhones);
    if (error) { res.status(500).json({ error: error.message }); return; }
    for (const f of (data ?? []) as any[]) matches.set(f.id, f);
  }
  if (cleanNationalIds.length > 0) {
    const { data, error } = await supa.from("farmers").select(selectCols).in("national_id", cleanNationalIds);
    if (error) { res.status(500).json({ error: error.message }); return; }
    for (const f of (data ?? []) as any[]) matches.set(f.id, f);
  }

  const duplicates = [...matches.values()].map((f: any) => ({
    id:          f.id,
    phone:       f.phone,
    nationalId:  f.national_id,
    farmerCode:  f.farmer_code,
    name:        f.farmer_group || `${f.first_name ?? ""} ${f.last_name ?? ""}`.trim(),
  }));
  res.json({ duplicates });
});

// ── POST /api/farmers/bulk-import ───────────────────────────────────────────────
// Accepts a list of farmer rows plus optional districtId / valueChainId.
// Skips rows whose phone already exists in the DB (or duplicated within the file).
// Returns { created, skipped, duplicates, farmers }.
router.post(
  "/api/farmers/bulk-import",
  requireAuth,
  requireRoles("Admin", "ProjectManager", "DistrictCoordinator", "WarehouseManager"),
  async (req, res) => {
    const { rows, districtId, valueChainId } = req.body as {
      rows: Array<{
        firstName?: string; lastName?: string; gender?: string; phone?: string;
        beneficiaryType?: string; farmerGroup?: string; groupSize?: number;
      }>;
      districtId?: number;
      valueChainId?: number;
    };

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "rows must be a non-empty array" });
      return;
    }

    // 1. Collect all non-empty phones to batch-check against DB
    const allPhones = rows.map(r => String(r.phone ?? "").trim()).filter(Boolean);
    let existingPhoneMap = new Map<string, { farmerCode: string; name: string }>();
    if (allPhones.length > 0) {
      const { data: existing } = await supa
        .from("farmers")
        .select("phone, farmer_code, first_name, last_name, farmer_group")
        .in("phone", allPhones);
      for (const f of (existing ?? []) as any[]) {
        if (f.phone) {
          existingPhoneMap.set(f.phone, {
            farmerCode: f.farmer_code,
            name:       f.farmer_group || `${f.first_name ?? ""} ${f.last_name ?? ""}`.trim(),
          });
        }
      }
    }

    // 2. Get next safe ID base (PG sequence may lag after seed imports)
    const { data: maxRow } = await supa.from("farmers").select("id").order("id", { ascending: false }).limit(1).maybeSingle();
    let nextId = ((maxRow as any)?.id ?? 0) + 1;

    // 3. Process rows — detect intra-file and DB duplicates
    const seenPhonesInBatch = new Map<string, number>(); // phone → first 1-based row number
    const toInsert: any[]   = [];
    const duplicates: Array<{ row: number; name: string; phone: string; matchedFarmerCode: string }> = [];

    rows.forEach((r, i) => {
      const rowNum       = i + 1;
      const phone        = String(r.phone ?? "").trim() || null;
      const benefType    = r.beneficiaryType === "group" ? "group" : "individual";
      const displayName  = benefType === "group"
        ? (r.farmerGroup || "Group")
        : `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || "Unknown";

      // Intra-file duplicate (same phone appeared earlier in this batch)
      if (phone && seenPhonesInBatch.has(phone)) {
        duplicates.push({
          row:               rowNum,
          name:              displayName,
          phone:             phone,
          matchedFarmerCode: `duplicate within import file (row ${seenPhonesInBatch.get(phone)})`,
        });
        return;
      }
      if (phone) seenPhonesInBatch.set(phone, rowNum);

      // DB duplicate
      if (phone && existingPhoneMap.has(phone)) {
        const match = existingPhoneMap.get(phone)!;
        duplicates.push({ row: rowNum, name: displayName, phone, matchedFarmerCode: match.farmerCode });
        return;
      }

      toInsert.push({
        id:               nextId++,
        first_name:       r.firstName    || null,
        last_name:        r.lastName     || null,
        gender:           r.gender       || null,
        phone:            phone,
        beneficiary_type: benefType,
        farmer_group:     r.farmerGroup  || null,
        group_size:       r.groupSize    ?? null,
        district_id:      districtId     ?? null,
        value_chain_id:   valueChainId   ?? null,
        status:           "pending",
        farmer_code:      generateFarmerCode(),
        barcode_token:    generateBarcode(),
        registered_by:    req.user!.userId,
        created_at:       new Date().toISOString(),
        updated_at:       new Date().toISOString(),
      });
    });

    if (toInsert.length === 0) {
      res.json({ created: 0, skipped: duplicates.length, duplicates, farmers: [] });
      return;
    }

    // 4. Batch insert in chunks of 100 to stay within PostgREST limits
    const CHUNK = 100;
    const inserted: any[] = [];
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const chunk = toInsert.slice(i, i + CHUNK);
      const { data, error } = await supa.from("farmers").insert(chunk).select("id, farmer_code, barcode_token, first_name, last_name, farmer_group, beneficiary_type");
      if (error) { res.status(500).json({ error: error.message }); return; }
      inserted.push(...(data ?? []));
    }

    await logAudit(req, "BULK_CREATE", "Farmers", `Bulk imported ${inserted.length} farmers`, "farmer", null as any);

    const farmers = inserted.map((f: any) => ({
      id:           f.id,
      farmerCode:   f.farmer_code,
      barcodeToken: f.barcode_token,
      name:         f.farmer_group || `${f.first_name ?? ""} ${f.last_name ?? ""}`.trim(),
    }));

    res.status(201).json({ created: inserted.length, skipped: duplicates.length, duplicates, farmers });
  }
);

// ── Public ID card endpoint ───────────────────────────────────────────────
// Returns ID-card-safe fields for a farmer given their barcode_token.
// Intentionally no auth: this powers the shareable mobile card view that field
// staff open by scanning the QR on a farmer's printed card. The token already
// gates the printed physical card, so the digital view is the same trust level.
router.get("/api/cards/:token", async (req, res) => {
  const token = req.params.token;
  if (!token || token.length < 4) { res.status(400).json({ error: "Invalid token" }); return; }

  const { data: rows, error } = await supa
    .from("farmers")
    .select("id, first_name, last_name, farmer_code, barcode_token, gender, phone, status, photo_url, district_id, chiefdom_id, value_chain_id")
    .eq("barcode_token", token)
    .limit(1);
  if (error) { res.status(500).json({ error: error.message }); return; }
  const farmer = rows?.[0] as any;
  if (!farmer) { res.status(404).json({ error: "Card not found" }); return; }

  const [districtRes, chiefdomRes, vcRes] = await Promise.all([
    farmer.district_id     ? supa.from("districts").select("name").eq("id", farmer.district_id).limit(1)         : Promise.resolve({ data: null }),
    farmer.chiefdom_id     ? supa.from("chiefdoms").select("name").eq("id", farmer.chiefdom_id).limit(1)         : Promise.resolve({ data: null }),
    farmer.value_chain_id  ? supa.from("value_chains").select("name").eq("id", farmer.value_chain_id).limit(1)   : Promise.resolve({ data: null }),
  ]);

  let photoUrl: string | null = null;
  if (farmer.photo_url) {
    try { photoUrl = await getPresignedViewUrl(farmer.photo_url); } catch { photoUrl = null; }
  }

  res.set("Cache-Control", "private, max-age=60");
  res.json({
    firstName:      farmer.first_name,
    lastName:       farmer.last_name,
    farmerCode:     farmer.farmer_code,
    barcodeToken:   farmer.barcode_token,
    gender:         farmer.gender,
    phone:          farmer.phone,
    status:         farmer.status,
    districtName:   (districtRes.data as any)?.[0]?.name ?? null,
    chiefdomName:   (chiefdomRes.data as any)?.[0]?.name ?? null,
    valueChainName: (vcRes.data as any)?.[0]?.name ?? null,
    photoUrl,
  });
});

export default router;
