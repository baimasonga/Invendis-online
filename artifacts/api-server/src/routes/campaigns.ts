import { Router } from "express";
import type { Request, Response } from "express";
import { supa, snakeToCamel } from "../lib/supabase.js";
import { requireAnyAuth, requireRoleIfJwt } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { sendSms } from "../lib/sms.js";
import {
  canEditCampaign,
  positiveInteger,
  validateCampaignInput,
} from "../lib/campaign-rules.js";

const router = Router();
const CAMPAIGN_MANAGERS = ["Admin", "ProjectManager"] as const;
const ALLOCATION_MANAGERS = [
  "Admin",
  "ProjectManager",
  "DistrictCoordinator",
] as const;

const roleKey = (req: Request) =>
  (req.user?.role ?? req.supabaseUser?.role ?? "")
    .toLowerCase()
    .replace(/[\s_-]/g, "");
const profileActorId = (req: Request) => req.supabaseUser?.id ?? null;
const parseId = (raw: unknown) => positiveInteger(raw);
const fail = (res: Response, status: number, message: string) =>
  res.status(status).json({ error: message });

async function assertCampaignReferences(
  input: Record<string, any>,
): Promise<string | null> {
  const districtId = Number(input.districtId);
  const [
    { data: district },
    { data: chain },
    { data: site },
    { data: warehouse },
  ] = await Promise.all([
    supa.from("districts").select("id").eq("id", districtId).maybeSingle(),
    supa
      .from("value_chains")
      .select("id,is_active")
      .eq("id", Number(input.valueChainId))
      .maybeSingle(),
    supa
      .from("distribution_sites")
      .select("id,district_id,is_active,latitude,longitude")
      .eq("id", Number(input.distributionSiteId))
      .maybeSingle(),
    supa
      .from("warehouses")
      .select("id,is_active")
      .eq("id", Number(input.sourceWarehouseId))
      .maybeSingle(),
  ]);
  if (!district) return "Selected district does not exist.";
  if (!chain || Number((chain as any).is_active) !== 1)
    return "Selected value chain is unavailable.";
  if (!site || Number((site as any).is_active) !== 1)
    return "Selected distribution site is unavailable.";
  if (Number((site as any).district_id) !== districtId)
    return "Distribution site must belong to the campaign district.";
  if ((site as any).latitude == null || (site as any).longitude == null)
    return "Distribution site requires GPS coordinates.";
  if (!warehouse || Number((warehouse as any).is_active) !== 1)
    return "Selected source warehouse is unavailable.";
  return null;
}

async function campaignReadiness(campaignId: number): Promise<string[]> {
  const [{ data: campaign }, { data: items }, { data: allocations }] =
    await Promise.all([
      supa.from("campaigns").select("*").eq("id", campaignId).maybeSingle(),
      supa
        .from("campaign_items")
        .select("input_item_id,quantity_per_farmer")
        .eq("campaign_id", campaignId),
      supa
        .from("allocations")
        .select("farmer_id,status")
        .eq("campaign_id", campaignId)
        .neq("status", "Cancelled"),
    ]);
  if (!campaign) return ["Campaign not found."];
  const c = campaign as any;
  const errors = validateCampaignInput({
    name: c.name,
    season: c.season,
    districtId: c.district_id,
    valueChainId: c.value_chain_id,
    distributionSiteId: c.distribution_site_id,
    sourceWarehouseId: c.source_warehouse_id,
    startDate: c.start_date,
    endDate: c.end_date,
    totalFarmers: c.total_farmers,
  });
  if (!errors.length) {
    const referenceError = await assertCampaignReferences({
      districtId: c.district_id,
      valueChainId: c.value_chain_id,
      distributionSiteId: c.distribution_site_id,
      sourceWarehouseId: c.source_warehouse_id,
    });
    if (referenceError) errors.push(referenceError);
  }
  if (!(items ?? []).length)
    errors.push("Add at least one input item before submitting.");
  if (!(allocations ?? []).length)
    errors.push("Allocate at least one approved farmer before submitting.");
  if (
    (items ?? []).some(
      (item: any) =>
        !Number.isFinite(Number(item.quantity_per_farmer)) ||
        Number(item.quantity_per_farmer) <= 0,
    )
  ) {
    errors.push("Every campaign item requires a positive quantity per farmer.");
  }
  const farmerIds = (allocations ?? []).map((row: any) =>
    Number(row.farmer_id),
  );
  if (farmerIds.length) {
    const { data: farmers } = await supa
      .from("farmers")
      .select("id,status,district_id,value_chain_id")
      .in("id", farmerIds);
    const farmerMap = new Map(
      (farmers ?? []).map((farmer: any) => [Number(farmer.id), farmer]),
    );
    for (const allocation of allocations ?? []) {
      const farmer = farmerMap.get(
        Number((allocation as any).farmer_id),
      ) as any;
      if (!farmer || String(farmer.status).toLowerCase() !== "approved") {
        errors.push("All allocated farmers must be approved.");
        break;
      }
      if (Number(farmer.district_id) !== Number(c.district_id)) {
        errors.push(
          "Every allocated farmer must belong to the campaign district.",
        );
        break;
      }
      if (
        farmer.value_chain_id != null &&
        Number(farmer.value_chain_id) !== Number(c.value_chain_id)
      ) {
        errors.push(
          "Every allocated farmer must match the campaign value chain.",
        );
        break;
      }
    }
  }
  return [...new Set(errors)];
}

async function refreshCampaignCounts(campaignId: number): Promise<void> {
  const [{ count: allocated }, { count: delivered }] = await Promise.all([
    supa
      .from("allocations")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .neq("status", "Cancelled"),
    supa
      .from("allocations")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "Delivered"),
  ]);
  await supa
    .from("campaigns")
    .update({
      allocated_farmers: allocated ?? 0,
      delivered_count: delivered ?? 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);
}

async function sendAllocationNotification(
  farmerId: number,
  campaignId: number,
  log: { warn: (obj: object, msg: string) => void },
): Promise<void> {
  try {
    const [{ data: farmer }, { data: campaign }, { data: cItems }] =
      await Promise.all([
        supa
          .from("farmers")
          .select("first_name,last_name,farmer_group,phone,community_id")
          .eq("id", farmerId)
          .single(),
        supa.from("campaigns").select("name").eq("id", campaignId).single(),
        supa
          .from("campaign_items")
          .select("quantity_per_farmer,input_item_id")
          .eq("campaign_id", campaignId),
      ]);
    const f = farmer as any;
    if (!f?.phone) return;
    const farmerName =
      f.farmer_group ||
      `${f.first_name ?? ""} ${f.last_name ?? ""}`.trim() ||
      "Beneficiary";
    let communityName = "";
    if (f.community_id) {
      const { data: community } = await supa
        .from("communities")
        .select("name")
        .eq("id", f.community_id)
        .maybeSingle();
      communityName = (community as any)?.name ?? "";
    }
    const itemIds = (cItems ?? []).map((item: any) => item.input_item_id);
    const { data: inputItems } = itemIds.length
      ? await supa.from("input_items").select("id,name,unit").in("id", itemIds)
      : { data: [] as any[] };
    const inputMap = Object.fromEntries(
      (inputItems ?? []).map((item: any) => [item.id, item]),
    );
    const itemsText =
      (cItems ?? [])
        .map((item: any) => {
          const input = inputMap[item.input_item_id];
          return input
            ? `${input.name} x${item.quantity_per_farmer}${input.unit ? ` ${input.unit}` : ""}`
            : null;
        })
        .filter(Boolean)
        .join(", ") || "inputs";
    const communityPart = communityName ? ` in ${communityName}` : "";
    await sendSms(
      f.phone,
      `Dear ${farmerName}, a delivery is coming to your community${communityPart} for ${(campaign as any)?.name ?? "an upcoming campaign"}. You will receive: ${itemsText}. Please be available. — AVDP PoD`,
    );
  } catch (err: any) {
    log.warn({ err: err.message }, "Allocation announcement SMS failed");
  }
}

async function enrichCampaigns(rows: any[]): Promise<any[]> {
  const ids = (key: string) => [
    ...new Set(rows.map((row) => row[key]).filter(Boolean)),
  ];
  const [
    { data: districts },
    { data: chains },
    { data: sites },
    { data: warehouses },
  ] = await Promise.all([
    ids("district_id").length
      ? supa.from("districts").select("id,name").in("id", ids("district_id"))
      : Promise.resolve({ data: [] }),
    ids("value_chain_id").length
      ? supa
          .from("value_chains")
          .select("id,name")
          .in("id", ids("value_chain_id"))
      : Promise.resolve({ data: [] }),
    ids("distribution_site_id").length
      ? supa
          .from("distribution_sites")
          .select("id,name")
          .in("id", ids("distribution_site_id"))
      : Promise.resolve({ data: [] }),
    ids("source_warehouse_id").length
      ? supa
          .from("warehouses")
          .select("id,name,code")
          .in("id", ids("source_warehouse_id"))
      : Promise.resolve({ data: [] }),
  ]);
  const map = (values: any[] | null) =>
    Object.fromEntries((values ?? []).map((value) => [value.id, value]));
  const districtMap = map(districts),
    chainMap = map(chains),
    siteMap = map(sites),
    warehouseMap = map(warehouses);
  return rows.map((row) =>
    snakeToCamel({
      ...row,
      district_name: districtMap[row.district_id]?.name ?? null,
      value_chain_name: chainMap[row.value_chain_id]?.name ?? null,
      distribution_site_name: siteMap[row.distribution_site_id]?.name ?? null,
      source_warehouse_name:
        warehouseMap[row.source_warehouse_id]?.name ?? null,
      source_warehouse_code:
        warehouseMap[row.source_warehouse_id]?.code ?? null,
    }),
  );
}

router.get("/api/campaigns", requireAnyAuth, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 20));
  let q = supa
    .from("campaigns")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (req.query.status)
    q = q.eq("status", String(req.query.status)) as typeof q;
  const requestedDistrict = parseId(req.query.districtId);
  const districtScope =
    roleKey(req) === "districtcoordinator"
      ? (req.user?.districtId ?? req.supabaseUser?.districtId ?? null)
      : requestedDistrict;
  if (roleKey(req) === "districtcoordinator" && !districtScope) {
    res.json({ data: [], total: 0, page, limit });
    return;
  }
  if (districtScope) q = q.eq("district_id", districtScope) as typeof q;
  const { data, count, error } = await q;
  if (error) {
    fail(res, 500, error.message);
    return;
  }
  res.json({
    data: await enrichCampaigns(data ?? []),
    total: count ?? 0,
    page,
    limit,
  });
});

router.get("/api/campaigns/stats", requireAnyAuth, async (req, res) => {
  let q = supa
    .from("campaigns")
    .select("status,total_farmers,allocated_farmers,delivered_count");
  if (roleKey(req) === "districtcoordinator") {
    const districtId = req.user?.districtId ?? req.supabaseUser?.districtId;
    if (!districtId) {
      res.json({
        total: 0,
        active: 0,
        draft: 0,
        completed: 0,
        totalFarmers: 0,
        allocatedFarmers: 0,
        deliveredCount: 0,
      });
      return;
    }
    q = q.eq("district_id", districtId) as typeof q;
  }
  const { data, error } = await q;
  if (error) {
    fail(res, 500, error.message);
    return;
  }
  const rows = data ?? [];
  res.json({
    total: rows.length,
    active: rows.filter((row: any) =>
      ["Approved", "Active"].includes(row.status),
    ).length,
    draft: rows.filter((row: any) => ["Draft", "Rejected"].includes(row.status))
      .length,
    completed: rows.filter((row: any) => row.status === "Completed").length,
    totalFarmers: rows.reduce(
      (sum: number, row: any) => sum + Number(row.total_farmers ?? 0),
      0,
    ),
    allocatedFarmers: rows.reduce(
      (sum: number, row: any) => sum + Number(row.allocated_farmers ?? 0),
      0,
    ),
    deliveredCount: rows.reduce(
      (sum: number, row: any) => sum + Number(row.delivered_count ?? 0),
      0,
    ),
  });
});

router.get("/api/campaigns/:id", requireAnyAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    fail(res, 400, "Invalid campaign id.");
    return;
  }
  const { data: campaign, error } = await supa
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !campaign) {
    fail(res, 404, "Campaign not found.");
    return;
  }
  if (
    roleKey(req) === "districtcoordinator" &&
    Number((campaign as any).district_id) !==
      Number(req.user?.districtId ?? req.supabaseUser?.districtId)
  ) {
    fail(res, 403, "You may only view campaigns in your district.");
    return;
  }
  const { data: items, error: itemError } = await supa
    .from("campaign_items")
    .select("*")
    .eq("campaign_id", id)
    .order("id");
  if (itemError) {
    fail(res, 500, itemError.message);
    return;
  }
  const itemIds = (items ?? []).map((item: any) => item.input_item_id);
  const { data: inputs } = itemIds.length
    ? await supa
        .from("input_items")
        .select("id,name,unit,item_code")
        .in("id", itemIds)
    : { data: [] };
  const inputMap = Object.fromEntries(
    (inputs ?? []).map((input: any) => [input.id, input]),
  );
  const [enriched] = await enrichCampaigns([campaign]);
  res.json({
    ...enriched,
    campaignItems: (items ?? []).map((item: any) =>
      snakeToCamel({
        ...item,
        input_item_name: inputMap[item.input_item_id]?.name ?? null,
        item_code: inputMap[item.input_item_id]?.item_code ?? null,
        unit: inputMap[item.input_item_id]?.unit ?? item.unit ?? null,
      }),
    ),
  });
});

router.post(
  "/api/campaigns",
  requireAnyAuth,
  requireRoleIfJwt(...CAMPAIGN_MANAGERS),
  async (req, res) => {
    const errors = validateCampaignInput(req.body ?? {});
    if (errors.length) {
      res
        .status(422)
        .json({ error: "Campaign is incomplete.", details: errors });
      return;
    }
    const referenceError = await assertCampaignReferences(req.body);
    if (referenceError) {
      fail(res, 422, referenceError);
      return;
    }
    const actorId = profileActorId(req);
    const insert = {
      name: String(req.body.name).trim(),
      season: String(req.body.season).trim(),
      district_id: Number(req.body.districtId),
      value_chain_id: Number(req.body.valueChainId),
      distribution_site_id: Number(req.body.distributionSiteId),
      source_warehouse_id: Number(req.body.sourceWarehouseId),
      start_date: new Date(req.body.startDate).toISOString(),
      end_date: new Date(req.body.endDate).toISOString(),
      total_farmers: Number(req.body.totalFarmers ?? 0),
      notes: req.body.notes ?? req.body.description ?? null,
      status: "Draft",
      ...(actorId ? { created_by: actorId } : {}),
    };
    const { data, error } = await supa
      .from("campaigns")
      .insert(insert)
      .select()
      .single();
    if (error) {
      fail(res, 409, error.message);
      return;
    }
    await logAudit(
      req,
      "CREATE",
      "Campaigns",
      `Created campaign: ${(data as any).name}`,
      "campaign",
      (data as any).id,
    );
    res.status(201).json((await enrichCampaigns([data]))[0]);
  },
);

router.put(
  "/api/campaigns/:id",
  requireAnyAuth,
  requireRoleIfJwt(...CAMPAIGN_MANAGERS),
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      fail(res, 400, "Invalid campaign id.");
      return;
    }
    const errors = validateCampaignInput(req.body ?? {});
    if (errors.length) {
      res
        .status(422)
        .json({ error: "Campaign is incomplete.", details: errors });
      return;
    }
    const referenceError = await assertCampaignReferences(req.body);
    if (referenceError) {
      fail(res, 422, referenceError);
      return;
    }
    const { data: current } = await supa
      .from("campaigns")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (!current) {
      fail(res, 404, "Campaign not found.");
      return;
    }
    if (!canEditCampaign((current as any).status)) {
      fail(res, 409, "Only Draft or Rejected campaigns can be edited.");
      return;
    }
    const { data, error } = await supa
      .from("campaigns")
      .update({
        name: String(req.body.name).trim(),
        season: String(req.body.season).trim(),
        district_id: Number(req.body.districtId),
        value_chain_id: Number(req.body.valueChainId),
        distribution_site_id: Number(req.body.distributionSiteId),
        source_warehouse_id: Number(req.body.sourceWarehouseId),
        start_date: new Date(req.body.startDate).toISOString(),
        end_date: new Date(req.body.endDate).toISOString(),
        total_farmers: Number(req.body.totalFarmers ?? 0),
        notes: req.body.notes ?? req.body.description ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .in("status", ["Draft", "Rejected"])
      .select()
      .maybeSingle();
    if (error) {
      fail(res, 409, error.message);
      return;
    }
    if (!data) {
      fail(
        res,
        409,
        "Campaign changed while it was being edited. Refresh and try again.",
      );
      return;
    }
    await logAudit(
      req,
      "UPDATE",
      "Campaigns",
      `Updated campaign ID ${id}`,
      "campaign",
      id,
    );
    res.json((await enrichCampaigns([data]))[0]);
  },
);

async function transition(
  req: Request,
  res: Response,
  targetStatus: string,
): Promise<void> {
  const id = parseId(req.params.id);
  if (!id) {
    fail(res, 400, "Invalid campaign id.");
    return;
  }
  if (["Submitted", "Approved"].includes(targetStatus)) {
    const errors = await campaignReadiness(id);
    if (errors.length) {
      res
        .status(422)
        .json({ error: "Campaign is not ready.", details: errors });
      return;
    }
  }
  const { data, error } = await supa.rpc("transition_campaign_atomic", {
    p_campaign_id: id,
    p_target_status: targetStatus,
    p_actor: profileActorId(req),
    p_reason:
      typeof req.body?.reason === "string"
        ? req.body.reason.trim() || null
        : null,
  });
  if (error) {
    const status = /does not exist|not found/i.test(error.message)
      ? 404
      : /cannot|requires|must|insufficient|mismatch/i.test(error.message)
        ? 409
        : 500;
    fail(res, status, error.message);
    return;
  }
  await logAudit(
    req,
    targetStatus.toUpperCase(),
    "Campaigns",
    `${targetStatus} campaign ID ${id}`,
    "campaign",
    id,
  );
  res.json(snakeToCamel(data));
}

router.post(
  "/api/campaigns/:id/submit",
  requireAnyAuth,
  requireRoleIfJwt(...CAMPAIGN_MANAGERS),
  (req, res) => void transition(req, res, "Submitted"),
);
router.post(
  "/api/campaigns/:id/approve",
  requireAnyAuth,
  requireRoleIfJwt(...CAMPAIGN_MANAGERS),
  (req, res) => void transition(req, res, "Approved"),
);
router.post(
  "/api/campaigns/:id/reject",
  requireAnyAuth,
  requireRoleIfJwt(...CAMPAIGN_MANAGERS),
  (req, res) => void transition(req, res, "Rejected"),
);
router.post(
  "/api/campaigns/:id/cancel",
  requireAnyAuth,
  requireRoleIfJwt(...CAMPAIGN_MANAGERS),
  (req, res) => void transition(req, res, "Cancelled"),
);
router.post(
  "/api/campaigns/:id/complete",
  requireAnyAuth,
  requireRoleIfJwt(...CAMPAIGN_MANAGERS),
  (req, res) => void transition(req, res, "Completed"),
);

router.delete(
  "/api/campaigns/:id",
  requireAnyAuth,
  requireRoleIfJwt(...CAMPAIGN_MANAGERS),
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      fail(res, 400, "Invalid campaign id.");
      return;
    }
    const [{ data: campaign }, { count: allocations }, { count: dispatches }] =
      await Promise.all([
        supa
          .from("campaigns")
          .select("status,campaign_code")
          .eq("id", id)
          .maybeSingle(),
        supa
          .from("allocations")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", id),
        supa
          .from("dispatches")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", id),
      ]);
    if (!campaign) {
      fail(res, 404, "Campaign not found.");
      return;
    }
    if (!canEditCampaign((campaign as any).status)) {
      fail(res, 409, "Only Draft or Rejected campaigns can be deleted.");
      return;
    }
    if ((allocations ?? 0) > 0 || (dispatches ?? 0) > 0) {
      fail(
        res,
        409,
        "Remove allocations and dispatches before deleting this campaign.",
      );
      return;
    }
    const { error } = await supa.from("campaigns").delete().eq("id", id);
    if (error) {
      fail(res, 409, error.message);
      return;
    }
    await logAudit(
      req,
      "DELETE",
      "Campaigns",
      `Deleted campaign ${(campaign as any).campaign_code}`,
      "campaign",
      id,
    );
    res.status(204).end();
  },
);

router.post(
  "/api/campaigns/:id/items",
  requireAnyAuth,
  requireRoleIfJwt(...CAMPAIGN_MANAGERS),
  async (req, res) => {
    const campaignId = parseId(req.params.id),
      inputItemId = parseId(req.body?.inputItemId);
    const quantity = Number(req.body?.quantityPerFarmer);
    if (
      !campaignId ||
      !inputItemId ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      fail(res, 422, "Item and a positive quantity per farmer are required.");
      return;
    }
    const [{ data: campaign }, { data: input }] = await Promise.all([
      supa
        .from("campaigns")
        .select("status")
        .eq("id", campaignId)
        .maybeSingle(),
      supa
        .from("input_items")
        .select("id,unit,is_active")
        .eq("id", inputItemId)
        .maybeSingle(),
    ]);
    if (!campaign) {
      fail(res, 404, "Campaign not found.");
      return;
    }
    if (!canEditCampaign((campaign as any).status)) {
      fail(res, 409, "Campaign items can only change while Draft or Rejected.");
      return;
    }
    if (!input || Number((input as any).is_active) !== 1) {
      fail(res, 422, "Input item is unavailable.");
      return;
    }
    const { data, error } = await supa
      .from("campaign_items")
      .insert({
        campaign_id: campaignId,
        input_item_id: inputItemId,
        quantity_per_farmer: quantity,
        unit: (input as any).unit ?? null,
      })
      .select()
      .single();
    if (error) {
      fail(res, /duplicate/i.test(error.message) ? 409 : 500, error.message);
      return;
    }
    await logAudit(
      req,
      "CREATE",
      "CampaignItems",
      `Added item ${inputItemId} to campaign ${campaignId}`,
      "campaign",
      campaignId,
    );
    res.status(201).json(snakeToCamel(data));
  },
);

router.put(
  "/api/campaigns/:id/items/:itemId",
  requireAnyAuth,
  requireRoleIfJwt(...CAMPAIGN_MANAGERS),
  async (req, res) => {
    const campaignId = parseId(req.params.id),
      itemId = parseId(req.params.itemId);
    const quantity = Number(req.body?.quantityPerFarmer);
    if (!campaignId || !itemId || !Number.isFinite(quantity) || quantity <= 0) {
      fail(res, 422, "A positive quantity per farmer is required.");
      return;
    }
    const { data: campaign } = await supa
      .from("campaigns")
      .select("status")
      .eq("id", campaignId)
      .maybeSingle();
    if (!campaign) {
      fail(res, 404, "Campaign not found.");
      return;
    }
    if (!canEditCampaign((campaign as any).status)) {
      fail(res, 409, "Campaign items can only change while Draft or Rejected.");
      return;
    }
    const { data, error } = await supa
      .from("campaign_items")
      .update({ quantity_per_farmer: quantity })
      .eq("id", itemId)
      .eq("campaign_id", campaignId)
      .select()
      .maybeSingle();
    if (error) {
      fail(res, 500, error.message);
      return;
    }
    if (!data) {
      fail(res, 404, "Campaign item not found.");
      return;
    }
    await logAudit(
      req,
      "UPDATE",
      "CampaignItems",
      `Updated item ${itemId} on campaign ${campaignId}`,
      "campaign",
      campaignId,
    );
    res.json(snakeToCamel(data));
  },
);

router.delete(
  "/api/campaigns/:id/items/:itemId",
  requireAnyAuth,
  requireRoleIfJwt(...CAMPAIGN_MANAGERS),
  async (req, res) => {
    const campaignId = parseId(req.params.id),
      itemId = parseId(req.params.itemId);
    if (!campaignId || !itemId) {
      fail(res, 400, "Invalid campaign item.");
      return;
    }
    const { data: campaign } = await supa
      .from("campaigns")
      .select("status")
      .eq("id", campaignId)
      .maybeSingle();
    if (!campaign) {
      fail(res, 404, "Campaign not found.");
      return;
    }
    if (!canEditCampaign((campaign as any).status)) {
      fail(res, 409, "Campaign items can only change while Draft or Rejected.");
      return;
    }
    const { error } = await supa
      .from("campaign_items")
      .delete()
      .eq("id", itemId)
      .eq("campaign_id", campaignId);
    if (error) {
      fail(res, 409, error.message);
      return;
    }
    await logAudit(
      req,
      "DELETE",
      "CampaignItems",
      `Removed item ${itemId} from campaign ${campaignId}`,
      "campaign",
      campaignId,
    );
    res.status(204).end();
  },
);

async function assertAllocationEligibility(
  req: Request,
  campaignId: number,
  farmerId: number,
): Promise<{ campaign: any; farmer: any } | string> {
  const [{ data: campaign }, { data: farmer }] = await Promise.all([
    supa
      .from("campaigns")
      .select("id,status,district_id,value_chain_id,total_farmers")
      .eq("id", campaignId)
      .maybeSingle(),
    supa
      .from("farmers")
      .select("id,status,district_id,value_chain_id")
      .eq("id", farmerId)
      .maybeSingle(),
  ]);
  if (!campaign) return "Campaign not found.";
  if (!canEditCampaign((campaign as any).status))
    return "Farmers can only be allocated while the campaign is Draft or Rejected.";
  if (!farmer || String((farmer as any).status).toLowerCase() !== "approved")
    return "Only approved farmers can be allocated.";
  if (
    Number((farmer as any).district_id) !==
    Number((campaign as any).district_id)
  )
    return "Farmer must belong to the campaign district.";
  if (
    (farmer as any).value_chain_id != null &&
    Number((farmer as any).value_chain_id) !==
      Number((campaign as any).value_chain_id)
  )
    return "Farmer must match the campaign value chain.";
  if (Number((campaign as any).total_farmers) > 0) {
    const [{ count }, { data: existing }] = await Promise.all([
      supa
        .from("allocations")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .neq("status", "Cancelled"),
      supa
        .from("allocations")
        .select("id")
        .eq("campaign_id", campaignId)
        .eq("farmer_id", farmerId)
        .maybeSingle(),
    ]);
    if (!existing && (count ?? 0) >= Number((campaign as any).total_farmers))
      return "Campaign farmer target has already been reached.";
  }
  if (
    roleKey(req) === "districtcoordinator" &&
    Number((campaign as any).district_id) !==
      Number(req.user?.districtId ?? req.supabaseUser?.districtId)
  )
    return "You may only manage allocations in your district.";
  return { campaign, farmer };
}

router.get("/api/allocations", requireAnyAuth, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1),
    limit = Math.min(500, Math.max(1, Number(req.query.limit) || 20));
  let campaignIds: number[] | null = req.query.campaignId
    ? [Number(req.query.campaignId)]
    : null;
  if (roleKey(req) === "districtcoordinator") {
    const districtId = req.user?.districtId ?? req.supabaseUser?.districtId;
    if (!districtId) {
      res.json({ data: [], total: 0, page, limit });
      return;
    }
    const { data: scoped } = await supa
      .from("campaigns")
      .select("id")
      .eq("district_id", districtId);
    const allowed = new Set((scoped ?? []).map((row: any) => Number(row.id)));
    campaignIds = campaignIds
      ? campaignIds.filter((id) => allowed.has(id))
      : [...allowed];
    if (!campaignIds.length) {
      res.json({ data: [], total: 0, page, limit });
      return;
    }
  }
  let q = supa
    .from("allocations")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (campaignIds) q = q.in("campaign_id", campaignIds) as typeof q;
  const { data, count, error } = await q;
  if (error) {
    fail(res, 500, error.message);
    return;
  }
  const rows = data ?? [],
    farmerIds = [...new Set(rows.map((row: any) => row.farmer_id))],
    cIds = [...new Set(rows.map((row: any) => row.campaign_id))];
  const [{ data: farmers }, { data: campaigns }, { data: campaignItems }] =
    await Promise.all([
      farmerIds.length
        ? supa
            .from("farmers")
            .select(
              "id,first_name,last_name,farmer_group,farmer_code,beneficiary_type,group_size,district_id",
            )
            .in("id", farmerIds)
        : Promise.resolve({ data: [] }),
      cIds.length
        ? supa
            .from("campaigns")
            .select("id,name,campaign_code,status")
            .in("id", cIds)
        : Promise.resolve({ data: [] }),
      cIds.length
        ? supa
            .from("campaign_items")
            .select("campaign_id,input_item_id,quantity_per_farmer")
            .in("campaign_id", cIds)
        : Promise.resolve({ data: [] }),
    ]);
  const inputIds = [
    ...new Set((campaignItems ?? []).map((row: any) => row.input_item_id)),
  ];
  const { data: inputs } = inputIds.length
    ? await supa
        .from("input_items")
        .select("id,name,item_code,unit")
        .in("id", inputIds)
    : { data: [] };
  const map = (values: any[] | null) =>
    Object.fromEntries((values ?? []).map((value) => [value.id, value]));
  const farmerMap = map(farmers),
    campaignMap = map(campaigns),
    inputMap = map(inputs);
  const districtIds = [
    ...new Set(
      (farmers ?? []).map((farmer: any) => farmer.district_id).filter(Boolean),
    ),
  ];
  const { data: districts } = districtIds.length
    ? await supa.from("districts").select("id,name").in("id", districtIds)
    : { data: [] };
  const districtMap = map(districts),
    itemsByCampaign: Record<number, any[]> = {};
  for (const row of campaignItems ?? []) {
    const input = inputMap[(row as any).input_item_id];
    if (!input) continue;
    (itemsByCampaign[(row as any).campaign_id] ??= []).push({
      name: input.name,
      itemCode: input.item_code,
      unit: input.unit,
      quantityPerFarmer: (row as any).quantity_per_farmer,
    });
  }
  res.json({
    data: rows.map((row: any) => {
      const farmer = farmerMap[row.farmer_id],
        campaign = campaignMap[row.campaign_id];
      return snakeToCamel({
        ...row,
        farmer_name:
          farmer?.farmer_group ||
          `${farmer?.first_name ?? ""} ${farmer?.last_name ?? ""}`.trim() ||
          null,
        farmer_code: farmer?.farmer_code ?? null,
        beneficiary_type: farmer?.beneficiary_type ?? null,
        group_size: farmer?.group_size ?? null,
        district_name: districtMap[farmer?.district_id]?.name ?? null,
        campaign_name: campaign?.name ?? null,
        campaign_code: campaign?.campaign_code ?? null,
        campaign_status: campaign?.status ?? null,
        campaign_items: itemsByCampaign[row.campaign_id] ?? [],
      });
    }),
    total: count ?? 0,
    page,
    limit,
  });
});

router.post(
  "/api/allocations",
  requireAnyAuth,
  requireRoleIfJwt(...ALLOCATION_MANAGERS),
  async (req, res) => {
    const campaignId = parseId(req.body?.campaignId),
      farmerId = parseId(req.body?.farmerId);
    if (!campaignId || !farmerId) {
      fail(res, 422, "Campaign and farmer are required.");
      return;
    }
    const eligible = await assertAllocationEligibility(
      req,
      campaignId,
      farmerId,
    );
    if (typeof eligible === "string") {
      fail(res, 422, eligible);
      return;
    }
    const actorId = profileActorId(req);
    const { data, error } = await supa
      .from("allocations")
      .insert({
        campaign_id: campaignId,
        farmer_id: farmerId,
        notes: req.body.notes ?? null,
        ...(actorId ? { allocated_by: actorId } : {}),
      })
      .select()
      .single();
    if (error) {
      fail(
        res,
        /duplicate/i.test(error.message) ? 409 : 500,
        /duplicate/i.test(error.message)
          ? "Farmer is already allocated to this campaign."
          : error.message,
      );
      return;
    }
    await refreshCampaignCounts(campaignId);
    await logAudit(
      req,
      "CREATE",
      "Allocations",
      `Allocated farmer ${farmerId} to campaign ${campaignId}`,
      "allocation",
      (data as any).id,
    );
    void sendAllocationNotification(farmerId, campaignId, req.log);
    res.status(201).json(snakeToCamel(data));
  },
);

router.post(
  "/api/allocations/bulk",
  requireAnyAuth,
  requireRoleIfJwt(...ALLOCATION_MANAGERS),
  async (req, res) => {
    const campaignId = parseId(req.body?.campaignId);
    const farmerIds: number[] = [
      ...new Set<number>(
        Array.isArray(req.body?.farmerIds)
          ? req.body.farmerIds.map(Number)
          : [],
      ),
    ];
    if (
      !campaignId ||
      !farmerIds.length ||
      farmerIds.some((id) => !positiveInteger(id))
    ) {
      fail(res, 422, "Campaign and valid farmer IDs are required.");
      return;
    }
    for (const farmerId of farmerIds) {
      const eligible = await assertAllocationEligibility(
        req,
        campaignId,
        farmerId,
      );
      if (typeof eligible === "string") {
        fail(res, 422, `Farmer ${farmerId}: ${eligible}`);
        return;
      }
    }
    const [{ data: campaign }, { count: activeCount }, { data: existingRows }] =
      await Promise.all([
        supa
          .from("campaigns")
          .select("total_farmers")
          .eq("id", campaignId)
          .single(),
        supa
          .from("allocations")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaignId)
          .neq("status", "Cancelled"),
        supa
          .from("allocations")
          .select("farmer_id")
          .eq("campaign_id", campaignId)
          .in("farmer_id", farmerIds)
          .neq("status", "Cancelled"),
      ]);
    const target = Number((campaign as any)?.total_farmers ?? 0);
    const newCount = farmerIds.length - (existingRows?.length ?? 0);
    if (target > 0 && (activeCount ?? 0) + newCount > target) {
      fail(
        res,
        422,
        `This allocation would exceed the campaign target of ${target} farmers.`,
      );
      return;
    }
    const actorId = profileActorId(req);
    const { data, error } = await supa
      .from("allocations")
      .upsert(
        farmerIds.map((farmerId) => ({
          campaign_id: campaignId,
          farmer_id: farmerId,
          ...(actorId ? { allocated_by: actorId } : {}),
        })),
        { onConflict: "campaign_id,farmer_id", ignoreDuplicates: true },
      )
      .select();
    if (error) {
      fail(res, 500, error.message);
      return;
    }
    await refreshCampaignCounts(campaignId);
    await logAudit(
      req,
      "BULK_ALLOCATE",
      "Allocations",
      `Allocated ${data?.length ?? 0} farmers to campaign ${campaignId}`,
      "campaign",
      campaignId,
    );
    for (const row of data ?? [])
      void sendAllocationNotification(
        Number((row as any).farmer_id),
        campaignId,
        req.log,
      );
    res.status(201).json(snakeToCamel(data ?? []));
  },
);

router.patch(
  "/api/allocations/:id",
  requireAnyAuth,
  requireRoleIfJwt(...ALLOCATION_MANAGERS),
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      fail(res, 400, "Invalid allocation id.");
      return;
    }
    if (req.body?.status !== undefined) {
      fail(
        res,
        422,
        "Allocation delivery status is controlled by verified PoD and cannot be edited manually.",
      );
      return;
    }
    const { data: allocation } = await supa
      .from("allocations")
      .select("campaign_id")
      .eq("id", id)
      .maybeSingle();
    if (!allocation) {
      fail(res, 404, "Allocation not found.");
      return;
    }
    const { data: campaign } = await supa
      .from("campaigns")
      .select("status,district_id")
      .eq("id", (allocation as any).campaign_id)
      .maybeSingle();
    if (!campaign || !canEditCampaign((campaign as any).status)) {
      fail(
        res,
        409,
        "Allocation notes can only change while the campaign is Draft or Rejected.",
      );
      return;
    }
    if (
      roleKey(req) === "districtcoordinator" &&
      Number((campaign as any).district_id) !==
        Number(req.user?.districtId ?? req.supabaseUser?.districtId)
    ) {
      fail(res, 403, "You may only manage allocations in your district.");
      return;
    }
    const { data, error } = await supa
      .from("allocations")
      .update({
        notes: req.body?.notes ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) {
      fail(res, 500, error.message);
      return;
    }
    await logAudit(
      req,
      "UPDATE",
      "Allocations",
      `Updated allocation ${id}`,
      "allocation",
      id,
    );
    res.json(snakeToCamel(data));
  },
);

router.delete(
  "/api/allocations/:id",
  requireAnyAuth,
  requireRoleIfJwt(...ALLOCATION_MANAGERS),
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      fail(res, 400, "Invalid allocation id.");
      return;
    }
    const { data: allocation } = await supa
      .from("allocations")
      .select("campaign_id,status")
      .eq("id", id)
      .maybeSingle();
    if (!allocation) {
      fail(res, 404, "Allocation not found.");
      return;
    }
    if ((allocation as any).status === "Delivered") {
      fail(res, 409, "A delivered allocation cannot be removed.");
      return;
    }
    const { data: campaign } = await supa
      .from("campaigns")
      .select("status,district_id")
      .eq("id", (allocation as any).campaign_id)
      .maybeSingle();
    if (!campaign || !canEditCampaign((campaign as any).status)) {
      fail(
        res,
        409,
        "Farmers can only be removed while the campaign is Draft or Rejected.",
      );
      return;
    }
    if (
      roleKey(req) === "districtcoordinator" &&
      Number((campaign as any).district_id) !==
        Number(req.user?.districtId ?? req.supabaseUser?.districtId)
    ) {
      fail(res, 403, "You may only manage allocations in your district.");
      return;
    }
    const { error } = await supa.from("allocations").delete().eq("id", id);
    if (error) {
      fail(res, 409, error.message);
      return;
    }
    await refreshCampaignCounts((allocation as any).campaign_id);
    await logAudit(
      req,
      "DELETE",
      "Allocations",
      `Removed allocation ${id}`,
      "allocation",
      id,
    );
    res.status(204).end();
  },
);

export default router;
