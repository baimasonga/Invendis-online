import { supabase } from "./supabase";

// ── helpers ──────────────────────────────────────────────────────────────────
function cc<T = any>(obj: any): T {
  if (Array.isArray(obj)) return obj.map(cc) as any;
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
        cc(v),
      ])
    ) as T;
  }
  return obj;
}

async function uid(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

export async function logAudit(
  action: string, module: string, description: string,
  entityType?: string, entityId?: number
) {
  const userId = await uid();
  const { data: { session } } = await supabase.auth.getSession();
  await supabase.from("audit_logs").insert({
    user_id: userId,
    username: session?.user?.email ?? null,
    action, module, description,
    entity_type: entityType ?? null,
    entity_id: entityId ?? null,
  });
}

async function throwOnError<T>(promise: Promise<{ data: T | null; error: any; count?: number | null }>): Promise<{ data: T; count?: number | null }> {
  const { data, error, count } = await promise;
  if (error) throw new Error(error.message);
  return { data: data as T, count };
}

// ── QUERY KEYS ───────────────────────────────────────────────────────────────
export const KEYS = {
  dashboard:     () => ["dashboard"],
  farmers:       (page?: number, search?: string) => ["farmers", page, search],
  farmer:        (id: number) => ["farmer", id],
  campaigns:     (page?: number) => ["campaigns", page],
  campaign:      (id: number) => ["campaign", id],
  allocations:   (page?: number, cId?: number) => ["allocations", page, cId],
  inventory:     () => ["inventory"],
  stockBalance:  () => ["stock-balance"],
  procurement:   () => ["procurement"],
  vehicles:      () => ["vehicles"],
  drivers:       () => ["drivers"],
  dispatches:    (page?: number) => ["dispatches", page],
  dispatch:      (id: number) => ["dispatch", id],
  pod:           (page?: number, dId?: number) => ["pod", page, dId],
  podStats:      () => ["pod-stats"],
  reconciliations: () => ["reconciliations"],
  reports:       (type: string) => ["reports", type],
  auditLogs:     (page?: number) => ["audit-logs", page],
  users:         () => ["users"],
  districts:     () => ["districts"],
  chiefdoms:     (districtId?: number) => ["chiefdoms", districtId],
  valueChains:   () => ["value-chains"],
  warehouses:    () => ["warehouses"],
};

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
export async function getDashboardData() {
  const [
    { count: totalFarmers },
    { count: pendingFarmers },
    { count: activeCampaigns },
    { count: totalDispatches },
    { count: totalAllocations },
    { count: pendingPod },
    recentActivity,
    farmersByStatus,
  ] = await Promise.all([
    supabase.from("farmers").select("*", { count: "exact", head: true }),
    supabase.from("farmers").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("campaigns").select("*", { count: "exact", head: true }).in("status", ["Active", "Approved"]),
    supabase.from("dispatches").select("*", { count: "exact", head: true }),
    supabase.from("allocations").select("*", { count: "exact", head: true }),
    supabase.from("pod").select("*", { count: "exact", head: true }).eq("status", "Pending"),
    supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(10),
    supabase.from("farmers").select("status").limit(1000),
  ]);

  const statusMap: Record<string, number> = {};
  for (const r of (farmersByStatus.data ?? [])) {
    statusMap[r.status] = (statusMap[r.status] ?? 0) + 1;
  }
  const farmerStatusChart = Object.entries(statusMap).map(([name, value]) => ({ name, value }));

  return {
    summary: {
      totalFarmers: totalFarmers ?? 0,
      pendingFarmers: pendingFarmers ?? 0,
      activeCampaigns: activeCampaigns ?? 0,
      totalDispatches: totalDispatches ?? 0,
      totalAllocations: totalAllocations ?? 0,
      pendingPod: pendingPod ?? 0,
    },
    charts: { farmerStatusChart },
    recentActivity: cc(recentActivity.data ?? []),
  };
}

// ── FARMERS ───────────────────────────────────────────────────────────────────
export async function listFarmers(page = 1, limit = 20, search?: string, status?: string) {
  let q = supabase
    .from("farmers")
    .select("*, districts(name), chiefdoms(name), value_chains(name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (search) q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,farmer_code.ilike.%${search}%`);
  if (status) q = q.eq("status", status);
  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return {
    data: (data ?? []).map((r: any) => ({
      ...cc(r),
      districtName: r.districts?.name ?? null,
      chiefdomName: r.chiefdoms?.name ?? null,
      valueChainName: r.value_chains?.name ?? null,
      districts: undefined, chiefdoms: undefined, value_chains: undefined,
    })),
    total: count ?? 0,
  };
}

export async function getFarmer(id: number) {
  const { data, error } = await supabase
    .from("farmers")
    .select("*, districts(name), chiefdoms(name), sections(name), value_chains(name)")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return {
    ...cc(data),
    districtName: (data as any).districts?.name ?? null,
    chiefdomName: (data as any).chiefdoms?.name ?? null,
    sectionName: (data as any).sections?.name ?? null,
    valueChainName: (data as any).value_chains?.name ?? null,
    districts: undefined, chiefdoms: undefined, sections: undefined, value_chains: undefined,
  };
}

export async function createFarmer(payload: any) {
  const userId = await uid();
  const { data, error } = await supabase.from("farmers").insert({
    first_name: payload.firstName,
    last_name: payload.lastName,
    gender: payload.gender ?? "Male",
    phone: payload.phone ?? null,
    national_id: payload.nationalId ?? null,
    district_id: payload.districtId ?? null,
    chiefdom_id: payload.chiefdomId ?? null,
    value_chain_id: payload.valueChainId ?? null,
    farm_size: payload.farmSize ?? null,
    registered_by: userId,
  }).select().single();
  if (error) throw new Error(error.message);
  await logAudit("CREATE", "farmers", `Registered farmer ${(data as any).farmer_code}`, "farmer", (data as any).id);
  return cc(data);
}

export async function approveFarmer(id: number) {
  const userId = await uid();
  const { data, error } = await supabase.from("farmers")
    .update({ status: "approved", approved_by: userId, approved_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error) throw new Error(error.message);
  await logAudit("APPROVE", "farmers", `Approved farmer #${id}`, "farmer", id);
  return cc(data);
}

export async function rejectFarmer(id: number, reason = "Rejected by administrator") {
  const { data, error } = await supabase.from("farmers")
    .update({ status: "rejected", rejection_reason: reason })
    .eq("id", id).select().single();
  if (error) throw new Error(error.message);
  await logAudit("REJECT", "farmers", `Rejected farmer #${id}`, "farmer", id);
  return cc(data);
}

// ── CAMPAIGNS ─────────────────────────────────────────────────────────────────
export async function listCampaigns(page = 1, limit = 20) {
  const { data, error, count } = await supabase
    .from("campaigns")
    .select("*, districts(name), value_chains(name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (error) throw new Error(error.message);
  return {
    data: (data ?? []).map((r: any) => ({
      ...cc(r),
      districtName: r.districts?.name ?? null,
      valueChainName: r.value_chains?.name ?? null,
      districts: undefined, value_chains: undefined,
    })),
    total: count ?? 0,
  };
}

export async function getCampaign(id: number) {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*, districts(name), value_chains(name), campaign_items(*, input_items(name,unit))")
    .eq("id", id).single();
  if (error) throw new Error(error.message);
  return {
    ...cc(data),
    districtName: (data as any).districts?.name ?? null,
    valueChainName: (data as any).value_chains?.name ?? null,
    districts: undefined, value_chains: undefined,
  };
}

export async function createCampaign(payload: any) {
  const userId = await uid();
  const { data, error } = await supabase.from("campaigns").insert({
    name: payload.name,
    season: payload.season ?? null,
    district_id: payload.districtId ?? null,
    value_chain_id: payload.valueChainId ?? null,
    start_date: payload.startDate ? new Date(payload.startDate).toISOString() : null,
    end_date: payload.endDate ? new Date(payload.endDate).toISOString() : null,
    notes: payload.description ?? payload.notes ?? null,
    created_by: userId,
  }).select().single();
  if (error) throw new Error(error.message);
  await logAudit("CREATE", "campaigns", `Created campaign ${(data as any).campaign_code}`, "campaign", (data as any).id);
  return cc(data);
}

export async function submitCampaign(id: number) {
  const { data, error } = await supabase.from("campaigns")
    .update({ status: "Submitted" }).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return cc(data);
}

export async function approveCampaign(id: number) {
  const userId = await uid();
  const { data, error } = await supabase.from("campaigns")
    .update({ status: "Approved", approved_by: userId, approved_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return cc(data);
}

// ── ALLOCATIONS ───────────────────────────────────────────────────────────────
export async function listAllocations(page = 1, limit = 20, campaignId?: number) {
  let q = supabase
    .from("allocations")
    .select("*, farmers(first_name,last_name,farmer_code), campaigns(name,campaign_code)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (campaignId) q = q.eq("campaign_id", campaignId);
  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return {
    data: (data ?? []).map((r: any) => ({
      ...cc(r),
      farmerName: r.farmers ? `${r.farmers.first_name} ${r.farmers.last_name}` : null,
      farmerCode: r.farmers?.farmer_code ?? null,
      campaignName: r.campaigns?.name ?? null,
      farmers: undefined, campaigns: undefined,
    })),
    total: count ?? 0,
  };
}

export async function createAllocation(payload: any) {
  const userId = await uid();
  const { data, error } = await supabase.from("allocations").insert({
    campaign_id: payload.campaignId,
    farmer_id: payload.farmerId,
    notes: payload.notes ?? null,
    allocated_by: userId,
  }).select().single();
  if (error) throw new Error(error.message);
  return cc(data);
}

// ── INVENTORY ─────────────────────────────────────────────────────────────────
export async function listInputItems() {
  const { data, error } = await supabase
    .from("input_items").select("*").eq("is_active", 1).order("name");
  if (error) throw new Error(error.message);
  return cc(data ?? []);
}

export async function getStockBalance() {
  const { data, error } = await supabase
    .from("stock_balance")
    .select("*, warehouses(name,code), input_items(name,unit,category)")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    ...cc(r),
    warehouseName: r.warehouses?.name ?? null,
    warehouseCode: r.warehouses?.code ?? null,
    itemName: r.input_items?.name ?? null,
    unit: r.input_items?.unit ?? null,
    category: r.input_items?.category ?? null,
    warehouses: undefined, input_items: undefined,
  }));
}

export async function receiveStock(payload: any) {
  const userId = await uid();
  const { data: ledger, error } = await supabase.from("stock_ledger").insert({
    warehouse_id: payload.warehouseId,
    input_item_id: payload.inputItemId,
    txn_type: "RECEIVE",
    quantity: payload.quantity,
    reference: payload.reference ?? null,
    notes: payload.notes ?? null,
    created_by: userId,
  }).select().single();
  if (error) throw new Error(error.message);

  const { data: bal } = await supabase.from("stock_balance")
    .select("id, available")
    .eq("warehouse_id", payload.warehouseId)
    .eq("input_item_id", payload.inputItemId).single();

  if (bal) {
    await supabase.from("stock_balance")
      .update({ available: (bal as any).available + payload.quantity, updated_at: new Date().toISOString() })
      .eq("id", (bal as any).id);
  } else {
    await supabase.from("stock_balance").insert({
      warehouse_id: payload.warehouseId,
      input_item_id: payload.inputItemId,
      available: payload.quantity,
    });
  }
  await logAudit("RECEIVE", "inventory", `Received ${payload.quantity} units`, "stock", (ledger as any).id);
  return cc(ledger);
}

// ── PROCUREMENT ───────────────────────────────────────────────────────────────
export async function listProcurementOrders() {
  const { data, error } = await supabase
    .from("procurement_orders")
    .select("*, warehouses(name,code)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    ...cc(r),
    warehouseName: r.warehouses?.name ?? null,
    warehouses: undefined,
  }));
}

export async function createProcurementOrder(payload: any) {
  const userId = await uid();
  const { data, error } = await supabase.from("procurement_orders").insert({
    supplier_name: payload.supplierName,
    warehouse_id: payload.warehouseId,
    status: payload.status ?? "Draft",
    order_date: payload.orderDate ? new Date(payload.orderDate).toISOString() : null,
    expected_delivery: payload.expectedDelivery ? new Date(payload.expectedDelivery).toISOString() : null,
    notes: payload.notes ?? null,
    created_by: userId,
  }).select().single();
  if (error) throw new Error(error.message);
  await logAudit("CREATE", "procurement", `Created PO ${(data as any).order_code}`, "procurement", (data as any).id);
  return cc(data);
}

// ── VEHICLES ──────────────────────────────────────────────────────────────────
export async function listVehicles(page = 1, limit = 50) {
  const { data, error, count } = await supabase
    .from("vehicles").select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (error) throw new Error(error.message);
  return { data: cc(data ?? []), total: count ?? 0 };
}

export async function createVehicle(payload: any) {
  const { data, error } = await supabase.from("vehicles").insert({
    plate_number: payload.plateNumber,
    vehicle_type: payload.vehicleType,
    make: payload.make ?? null,
    model: payload.model ?? null,
    year: payload.year ? Number(payload.year) : null,
    capacity: payload.capacity ? Number(payload.capacity) : null,
    status: payload.status ?? "Active",
  }).select().single();
  if (error) throw new Error(error.message);
  return cc(data);
}

export async function listDrivers(page = 1, limit = 50) {
  const { data, error, count } = await supabase
    .from("drivers").select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (error) throw new Error(error.message);
  return { data: cc(data ?? []), total: count ?? 0 };
}

export async function createDriver(payload: any) {
  const { data, error } = await supabase.from("drivers").insert({
    full_name: payload.fullName,
    phone: payload.phone ?? null,
    license_number: payload.licenseNumber ?? null,
    license_expiry: payload.licenseExpiry ? new Date(payload.licenseExpiry).toISOString() : null,
    is_active: 1,
  }).select().single();
  if (error) throw new Error(error.message);
  return cc(data);
}

// ── DISPATCH ──────────────────────────────────────────────────────────────────
export async function listDispatches(page = 1, limit = 20) {
  const { data, error, count } = await supabase
    .from("dispatches")
    .select("*, campaigns(name), vehicles(plate_number), drivers(full_name), warehouses(name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (error) throw new Error(error.message);
  return {
    data: (data ?? []).map((r: any) => ({
      ...cc(r),
      campaignName: r.campaigns?.name ?? null,
      plateNumber: r.vehicles?.plate_number ?? null,
      driverName: r.drivers?.full_name ?? null,
      warehouseName: r.warehouses?.name ?? null,
      campaigns: undefined, vehicles: undefined, drivers: undefined, warehouses: undefined,
    })),
    total: count ?? 0,
  };
}

export async function getDispatch(id: number) {
  const { data, error } = await supabase
    .from("dispatches")
    .select("*, campaigns(name,campaign_code), vehicles(plate_number,vehicle_type), drivers(full_name,driver_code), warehouses(name,code), dispatch_items(*, input_items(name,unit))")
    .eq("id", id).single();
  if (error) throw new Error(error.message);
  const r = data as any;
  return {
    ...cc(r),
    campaignName: r.campaigns?.name ?? null,
    campaignCode: r.campaigns?.campaign_code ?? null,
    plateNumber: r.vehicles?.plate_number ?? null,
    vehicleType: r.vehicles?.vehicle_type ?? null,
    driverName: r.drivers?.full_name ?? null,
    driverCode: r.drivers?.driver_code ?? null,
    warehouseName: r.warehouses?.name ?? null,
    warehouseCode: r.warehouses?.code ?? null,
    items: (r.dispatch_items ?? []).map((di: any) => ({
      ...cc(di),
      itemName: di.input_items?.name ?? null,
      unit: di.input_items?.unit ?? null,
      input_items: undefined,
    })),
    campaigns: undefined, vehicles: undefined, drivers: undefined, warehouses: undefined, dispatch_items: undefined,
  };
}

export async function createDispatch(payload: any) {
  const userId = await uid();
  const { data, error } = await supabase.from("dispatches").insert({
    campaign_id: payload.campaignId,
    vehicle_id: payload.vehicleId,
    driver_id: payload.driverId,
    warehouse_id: payload.warehouseId,
    notes: payload.notes ?? null,
    created_by: userId,
  }).select().single();
  if (error) throw new Error(error.message);
  await logAudit("CREATE", "dispatch", `Created manifest ${(data as any).manifest_code}`, "dispatch", (data as any).id);
  return cc(data);
}

export async function approveDispatch(id: number) {
  const userId = await uid();
  const { data, error } = await supabase.from("dispatches")
    .update({ status: "Approved", approved_by: userId, approved_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error) throw new Error(error.message);
  await logAudit("APPROVE", "dispatch", `Approved dispatch #${id}`, "dispatch", id);
  return cc(data);
}

export async function dispatchManifest(id: number) {
  const { data, error } = await supabase.from("dispatches")
    .update({ status: "Dispatched", departed_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return cc(data);
}

export async function arriveDispatch(id: number) {
  const { data, error } = await supabase.from("dispatches")
    .update({ status: "Arrived", arrived_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return cc(data);
}

export async function addDispatchItem(payload: any) {
  const { data, error } = await supabase.from("dispatch_items").insert({
    dispatch_id: payload.dispatchId,
    input_item_id: payload.inputItemId,
    quantity_loaded: payload.quantityLoaded,
  }).select().single();
  if (error) throw new Error(error.message);
  return cc(data);
}

// ── GPS ───────────────────────────────────────────────────────────────────────
export async function listVehicleGpsStatus() {
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, vehicle_code, plate_number, vehicle_type, status, last_latitude, last_longitude, last_ping")
    .order("last_ping", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return cc(data ?? []);
}

export async function listGpsTrack(vehicleId?: number, limit = 50) {
  let q = supabase.from("gps_track").select("*").order("recorded_at", { ascending: false }).limit(limit);
  if (vehicleId) q = q.eq("vehicle_id", vehicleId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return cc(data ?? []);
}

// ── POD ───────────────────────────────────────────────────────────────────────
export async function listPod(page = 1, limit = 20, dispatchId?: number) {
  let q = supabase
    .from("pod")
    .select("*, farmers(first_name,last_name,farmer_code), campaigns(name,campaign_code)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (dispatchId) q = q.eq("dispatch_id", dispatchId);
  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return {
    data: (data ?? []).map((r: any) => ({
      ...cc(r),
      farmerName: r.farmers ? `${r.farmers.first_name} ${r.farmers.last_name}` : null,
      farmerCode: r.farmers?.farmer_code ?? null,
      campaignName: r.campaigns?.name ?? null,
      farmers: undefined, campaigns: undefined,
    })),
    total: count ?? 0,
  };
}

export async function getPodStats() {
  const [total, verified, pending, exception] = await Promise.all([
    supabase.from("pod").select("*", { count: "exact", head: true }),
    supabase.from("pod").select("*", { count: "exact", head: true }).eq("status", "Verified"),
    supabase.from("pod").select("*", { count: "exact", head: true }).eq("status", "Pending"),
    supabase.from("pod").select("*", { count: "exact", head: true }).eq("status", "Exception"),
  ]);
  return { total: total.count ?? 0, verified: verified.count ?? 0, pending: pending.count ?? 0, exception: exception.count ?? 0 };
}

export async function createPod(payload: any) {
  const userId = await uid();
  const { data, error } = await supabase.from("pod").insert({
    farmer_id: payload.farmerId,
    campaign_id: payload.campaignId ?? null,
    dispatch_id: payload.dispatchId ?? null,
    field_officer_id: userId,
    quantity_delivered: payload.quantityDelivered ? Number(payload.quantityDelivered) : null,
    notes: payload.notes ?? null,
    otp_status: payload.otpStatus ?? "Pending",
    face_status: payload.faceStatus ?? "Pending",
    photo_url: payload.photoUrl ?? null,
    farmer_latitude: payload.farmerLatitude ?? null,
    farmer_longitude: payload.farmerLongitude ?? null,
    status: payload.status ?? "Pending",
    submitted_at: new Date().toISOString(),
  }).select().single();
  if (error) throw new Error(error.message);
  await logAudit("CREATE", "pod", `Recorded delivery POD #${(data as any).id}`, "pod", (data as any).id);
  return cc(data);
}

async function getSupabaseAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function apiPost(path: string, body: unknown): Promise<any> {
  const token = await getSupabaseAccessToken();
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? json?.message ?? "Request failed");
  return json;
}

export async function sendOtp(farmerId: number): Promise<{ sent: boolean; maskedPhone: string; farmerName: string; devCode?: string }> {
  return apiPost("/api/pod/otp/send", { farmerId });
}

export async function verifyOtp(farmerId: number, code: string): Promise<{ verified: boolean }> {
  return apiPost("/api/pod/otp/verify", { farmerId, code });
}

// ── RECONCILIATION ────────────────────────────────────────────────────────────
export async function listReconciliations() {
  const { data, error } = await supabase
    .from("reconciliations")
    .select("*, dispatches(manifest_code), warehouses(name,code)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    ...cc(r),
    manifestCode: r.dispatches?.manifest_code ?? null,
    warehouseName: r.warehouses?.name ?? null,
    dispatches: undefined, warehouses: undefined,
  }));
}

export async function createReconciliation(payload: any) {
  const userId = await uid();
  const variance = (payload.loadedQuantity ?? 0) - (payload.deliveredQuantity ?? 0)
    - (payload.returnedQuantity ?? 0) - (payload.damagedQuantity ?? 0);
  const { data, error } = await supabase.from("reconciliations").insert({
    dispatch_id: payload.dispatchId,
    warehouse_id: payload.warehouseId,
    loaded_quantity: payload.loadedQuantity ?? 0,
    delivered_quantity: payload.deliveredQuantity ?? 0,
    returned_quantity: payload.returnedQuantity ?? 0,
    damaged_quantity: payload.damagedQuantity ?? 0,
    variance_quantity: variance,
    status: payload.status ?? "Draft",
    notes: payload.notes ?? null,
    created_by: userId,
  }).select().single();
  if (error) throw new Error(error.message);
  return cc(data);
}

export async function approveReconciliation(id: number) {
  const userId = await uid();
  const { data, error } = await supabase.from("reconciliations")
    .update({ status: "Approved", approved_by: userId, approved_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return cc(data);
}

export async function rejectReconciliation(id: number) {
  const { data, error } = await supabase.from("reconciliations")
    .update({ status: "Rejected" })
    .eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return cc(data);
}

// ── REPORTS ───────────────────────────────────────────────────────────────────
export async function getFarmerBeneficiaryReport() {
  const { data, error } = await supabase
    .from("farmers")
    .select("status, districts(name), value_chains(name), gender")
    .limit(500);
  if (error) throw new Error(error.message);

  const byDistrict: Record<string, any> = {};
  for (const f of (data ?? [])) {
    const d = (f as any).districts?.name ?? "Unknown";
    if (!byDistrict[d]) byDistrict[d] = { district: d, total: 0, approved: 0, pending: 0, female: 0 };
    byDistrict[d].total++;
    if ((f as any).status === "approved") byDistrict[d].approved++;
    if ((f as any).status === "pending") byDistrict[d].pending++;
    if ((f as any).gender === "Female") byDistrict[d].female++;
  }
  const rows = Object.values(byDistrict).sort((a, b) => b.total - a.total);
  const total = rows.reduce((s, r) => s + r.total, 0);
  const approved = rows.reduce((s, r) => s + r.approved, 0);
  const female = rows.reduce((s, r) => s + r.female, 0);
  return { rows, summary: { total, approved, female, pctApproved: total ? Math.round((approved / total) * 100) : 0 } };
}

export async function getStockMovementReport() {
  const { data, error } = await supabase
    .from("stock_ledger")
    .select("*, warehouses(name), input_items(name,unit)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    ...cc(r),
    warehouseName: r.warehouses?.name ?? null,
    itemName: r.input_items?.name ?? null,
    unit: r.input_items?.unit ?? null,
    warehouses: undefined, input_items: undefined,
  }));
}

export async function getDistributionReport() {
  const { data, error } = await supabase
    .from("dispatches")
    .select("*, campaigns(name), warehouses(name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    ...cc(r),
    campaignName: r.campaigns?.name ?? null,
    warehouseName: r.warehouses?.name ?? null,
    completionPct: r.total_packages > 0 ? Math.round((r.delivered_packages / r.total_packages) * 100) : 0,
    campaigns: undefined, warehouses: undefined,
  }));
}

// ── AUDIT LOGS ────────────────────────────────────────────────────────────────
export async function listAuditLogs(page = 1, limit = 30) {
  const { data, error, count } = await supabase
    .from("audit_logs").select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (error) throw new Error(error.message);
  return { data: cc(data ?? []), total: count ?? 0 };
}

// ── USERS (profiles) ──────────────────────────────────────────────────────────
export async function listUsers() {
  const { data, error } = await supabase
    .from("profiles").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return cc(data ?? []);
}

export async function activateUser(id: string) {
  const { data, error } = await supabase.from("profiles")
    .update({ is_active: true }).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return cc(data);
}

export async function deactivateUser(id: string) {
  const { data, error } = await supabase.from("profiles")
    .update({ is_active: false }).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return cc(data);
}

export async function createUser(payload: any) {
  const { data, error } = await supabase.auth.signUp({
    email: payload.email,
    password: payload.password,
    options: { data: { full_name: payload.fullName, role: payload.role } },
  });
  if (error) throw new Error(error.message);
  if (data.user) {
    await supabase.from("profiles").upsert({
      id: data.user.id, full_name: payload.fullName,
      email: payload.email, role: payload.role,
    });
  }
  return data;
}

export async function updateUserRole(id: string, role: string) {
  const { data, error } = await supabase.from("profiles")
    .update({ role }).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return cc(data);
}

// ── MASTER DATA ───────────────────────────────────────────────────────────────
export async function listDistricts() {
  const { data, error } = await supabase.from("districts").select("*").order("name");
  if (error) throw new Error(error.message);
  return cc(data ?? []);
}

export async function listChiefdoms(districtId?: number) {
  let q = supabase.from("chiefdoms").select("*").order("name");
  if (districtId) q = q.eq("district_id", districtId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return cc(data ?? []);
}

export async function listValueChains() {
  const { data, error } = await supabase.from("value_chains").select("*").order("name");
  if (error) throw new Error(error.message);
  return cc(data ?? []);
}

export async function listWarehouses() {
  const { data, error } = await supabase.from("warehouses").select("*, districts(name)").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    ...cc(r), districtName: r.districts?.name ?? null, districts: undefined,
  }));
}

export async function createWarehouse(payload: any) {
  const { data, error } = await supabase.from("warehouses").insert({
    name: payload.name, code: payload.code,
    district_id: payload.districtId ?? null,
    address: payload.address ?? null, is_active: 1,
  }).select().single();
  if (error) throw new Error(error.message);
  return cc(data);
}

export async function createValueChain(payload: any) {
  const { data, error } = await supabase.from("value_chains").insert({
    name: payload.name, description: payload.description ?? null, is_active: 1,
  }).select().single();
  if (error) throw new Error(error.message);
  return cc(data);
}
