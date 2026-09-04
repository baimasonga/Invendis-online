import { supabase } from "./supabase";

// Resolve every API request through the configured backend origin. In the
// single-host Replit deployment VITE_API_URL is empty and relative /api paths
// continue to work; split deployments can provide an explicit API origin.
const API_ORIGIN = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_ORIGIN}${normalizedPath}`;
}

// ── helpers ──────────────────────────────────────────────────────────────

export function farmerDisplayName(farmer: any): string {
  if (!farmer) return "—";
  const group = farmer.farmer_group || farmer.farmerGroup || "";
  if (farmer.beneficiary_type === "group" || farmer.beneficiaryType === "group") {
    return group || "—";
  }
  const first = farmer.first_name ?? farmer.firstName ?? "";
  const last  = farmer.last_name  ?? farmer.lastName  ?? "";
  const name  = `${first} ${last}`.trim();
  return name || group || "—";
}

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

// Returns the Supabase session email
async function sessionEmail(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.email ?? null;
}

// Resolves the integer user ID from the users table by matching the session email.
// All integer FK columns (registered_by, approved_by, created_by, etc.) must use this.
let _intUidCache: { email: string; id: number } | null = null;
async function intUid(): Promise<number | null> {
  const email = await sessionEmail();
  if (!email) return null;
  if (_intUidCache?.email === email) return _intUidCache.id;
  // Portal-only accounts have no integer users row until the server provisions
  // one, so ask the API (which creates it on first use) before falling back to
  // a direct lookup.
  let id: number | null = null;
  try {
    const me = await apiGet("/api/users/me/integer-id");
    id = Number(me?.id) || null;
  } catch {
    const { data } = await supabase.from("users").select("id").eq("email", email).limit(1).maybeSingle();
    id = (data as any)?.id ?? null;
  }
  if (id == null) return null;
  _intUidCache = { email, id };
  return id;
}

export function logAudit(
  action: string, module: string, description: string,
  entityType?: string, entityId?: number
): void {
  // Fire-and-forget — never block the caller or throw. Browser sessions cannot
  // insert into audit_logs directly (INSERT is revoked for the authenticated
  // role), so the entry is recorded through the API.
  apiPost("/api/audit", { action, module, description, entityType, entityId })
    .catch(() => { /* audit failures are non-fatal */ });
}

async function throwOnError<T>(promise: Promise<{ data: T | null; error: any; count?: number | null }>): Promise<{ data: T; count?: number | null }> {
  const { data, error, count } = await promise;
  if (error) throw new Error(error.message);
  return { data: data as T, count };
}

// ── lookup helpers (replaces Supabase FK joins) ──────────────────────────────────────
async function lookupMap(table: string, ids: (number | string)[], cols: string): Promise<Record<string | number, any>> {
  if (!ids.length) return {};
  const { data } = await supabase.from(table).select(cols).in("id", ids);
  return Object.fromEntries((data ?? []).map((r: any) => [r.id, r]));
}

// ── QUERY KEYS ──────────────────────────────────────────────────────────────
// Trailing undefined parameters are dropped so that a bare factory call such as
// KEYS.farmers() yields ["farmers"] and partially matches every farmers query.
// TanStack treats an explicit undefined element as a value, so a padded key
// like ["farmers", undefined, …] would never match ["farmers", 1, "pending"].
function k(...parts: unknown[]): unknown[] {
  let end = parts.length;
  while (end > 1 && parts[end - 1] === undefined) end--;
  return parts.slice(0, end);
}

export const KEYS = {
  dashboard:     () => ["dashboard"],
  alertCounts:   () => ["alert-counts"],
  farmers:       (page?: number, search?: string, status?: string, districtId?: number, beneficiaryType?: string) => k("farmers", page, search, status, districtId, beneficiaryType),
  farmer:        (id: number) => ["farmer", id],
  campaigns:     (page?: number) => k("campaigns", page),
  campaign:      (id: number) => ["campaign", id],
  allocations:   (page?: number, cId?: number) => k("allocations", page, cId),
  // The input-item catalogue is shared by the inventory, settings, campaign and
  // manifest screens; they must all read and invalidate the same cache entry.
  inventory:     () => ["input-items"],
  stockBalance:  () => ["stock-balance"],
  procurement:   () => ["procurement"],
  vehicles:      () => ["vehicles"],
  gpsVehicles:   () => ["gps-vehicles"],
  drivers:       () => ["drivers"],
  dispatches:    (page?: number, fieldOfficerId?: number, status?: string, manifestCode?: string, showArchived?: boolean) => k("dispatches", page, fieldOfficerId, status, manifestCode, showArchived),
  dispatch:      (id: number) => ["dispatch", id],
  pod:           (page?: number, dId?: number, status?: string) => k("pod", page, dId, status),
  podStats:      () => ["pod-stats"],
  reconciliations: () => ["reconciliations"],
  reports:       (type: string, from?: string, to?: string) => k("reports", type, from, to),
  incidents:     (page?: number, status?: string) => k("incidents", page, status),
  auditLogs:          (page?: number, filters?: Record<string, any>) => k("audit-logs", page, filters),
  auditStats:         (days?: number) => k("audit-stats", days),
  auditSiem:          () => ["audit-siem-events"],
  consolidation:      (opts?: Record<string, any>) => ["consolidation-report", opts],
  meReport:           () => ["me-report"],
  allCampaigns:       () => ["all-campaigns"],
  users:         () => ["users"],
  fieldOfficers: () => ["field-officers"],
  districts:         () => ["districts"],
  chiefdoms:         (districtId?: number) => k("chiefdoms", districtId),
  valueChains:       () => ["value-chains"],
  warehouses:        () => ["warehouses"],
  distributionSites: () => ["distribution-sites"],
  inputItems:        () => ["input-items"],
  systemSettings:    () => ["system-settings"],
  farmerTypeCounts:  () => ["farmer-type-counts"],
};

// ── DASHBOARD ──────────────────────────────────────────────────────────────
function trendPct(now: number | null, prev: number | null): { pct: number; dir: "up" | "down" | "flat" } | null {
  const n = now ?? 0;
  const p = prev ?? 0;
  if (p === 0) return n > 0 ? { pct: 100, dir: "up" } : null;
  const raw = Math.round(((n - p) / p) * 100);
  return { pct: Math.abs(raw), dir: raw > 0 ? "up" : raw < 0 ? "down" : "flat" };
}

export async function getDashboardData() {
  const now      = Date.now();
  const d7       = new Date(now - 7  * 24 * 60 * 60 * 1000).toISOString();
  const d14      = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: totalFarmers },
    { count: pendingFarmers },
    { count: activeCampaigns },
    { count: totalDispatches },
    { count: totalAllocations },
    { count: pendingPod },
    { count: openIncidents },
    recentActivity,
    farmersByStatus,
    farmerExtData,
    campaignStatuses,
    stockLedger,
    podTrendRaw,
    // trend: this week vs prior week
    { count: farmersThisWeek },
    { count: farmersLastWeek },
    { count: podThisWeek },
    { count: podLastWeek },
    { count: dispatchesThisWeek },
    { count: dispatchesLastWeek },
    // campaign progress
    activeCampaignRows,
    // low-stock alerts
    lowStockRaw,
  ] = await Promise.all([
    supabase.from("farmers").select("*", { count: "exact", head: true }),
    supabase.from("farmers").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("campaigns").select("*", { count: "exact", head: true }).in("status", ["Active", "Approved"]),
    supabase.from("dispatches").select("*", { count: "exact", head: true }),
    supabase.from("allocations").select("*", { count: "exact", head: true }),
    supabase.from("pod").select("*", { count: "exact", head: true }).eq("status", "Pending"),
    supabase.from("incidents").select("*", { count: "exact", head: true }).neq("status", "Resolved"),
    supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(10),
    supabase.from("farmers").select("status").limit(1000),
    supabase.from("farmers").select("gender, beneficiary_type, district_id").limit(5000),
    supabase.from("campaigns").select("status").limit(500),
    supabase.from("stock_ledger").select("warehouse_id, quantity").limit(2000),
    supabase.from("pod").select("submitted_at, status").gte("submitted_at", d7).limit(500),
    // trends
    supabase.from("farmers").select("*", { count: "exact", head: true }).gte("created_at", d7),
    supabase.from("farmers").select("*", { count: "exact", head: true }).gte("created_at", d14).lt("created_at", d7),
    supabase.from("pod").select("*", { count: "exact", head: true }).gte("submitted_at", d7),
    supabase.from("pod").select("*", { count: "exact", head: true }).gte("submitted_at", d14).lt("submitted_at", d7),
    supabase.from("dispatches").select("*", { count: "exact", head: true }).gte("created_at", d7),
    supabase.from("dispatches").select("*", { count: "exact", head: true }).gte("created_at", d14).lt("created_at", d7),
    // active campaign progress
    supabase.from("campaigns")
      .select("id, name, allocated_farmers, delivered_count, target_beneficiaries, status")
      .in("status", ["Active", "Approved"])
      .order("created_at", { ascending: false })
      .limit(8),
    // low stock
    supabase.from("stock_balance")
      .select("id, warehouse_id, input_item_id, available")
      .lt("available", 50)
      .gte("available", 0)
      .order("available", { ascending: true })
      .limit(6),
  ]);

  const statusMap: Record<string, number> = {};
  for (const r of (farmersByStatus.data ?? [])) {
    statusMap[r.status] = (statusMap[r.status] ?? 0) + 1;
  }
  const farmerStatusChart = Object.entries(statusMap).map(([name, value]) => ({ name, value }));

  const campStatusMap: Record<string, number> = {};
  for (const c of (campaignStatuses.data ?? [])) {
    campStatusMap[c.status] = (campStatusMap[c.status] ?? 0) + 1;
  }
  const campaignCompletionChart = Object.entries(campStatusMap).map(([name, value]) => ({ name, value }));

  const whStockMap: Record<number, number> = {};
  for (const s of (stockLedger.data ?? [])) {
    whStockMap[s.warehouse_id] = (whStockMap[s.warehouse_id] ?? 0) + Number(s.quantity);
  }
  const whIds = Object.keys(whStockMap).map(Number).filter(Boolean);
  let warehouseStockChart: { name: string; stock: number }[] = [];
  if (whIds.length) {
    const { data: whs } = await supabase.from("warehouses").select("id,name").in("id", whIds);
    warehouseStockChart = (whs ?? []).map((w: any) => ({ name: w.name, stock: Math.max(0, whStockMap[w.id] ?? 0) }));
  }

  const podByDay: Record<string, { date: string; verified: number; pending: number }> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    podByDay[key] = { date: label, verified: 0, pending: 0 };
  }
  for (const p of (podTrendRaw.data ?? [])) {
    if (!p.submitted_at) continue;
    const key = p.submitted_at.slice(0, 10);
    if (!podByDay[key]) continue;
    if (p.status === "Verified") podByDay[key].verified++;
    else podByDay[key].pending++;
  }
  const podTrendChart = Object.values(podByDay);

  // Gender + beneficiary type + district breakdown from farmerExtData
  const farmerRows = farmerExtData.data ?? [];
  const femaleCount = farmerRows.filter((r: any) => r.gender === "Female").length;
  const femalePct   = farmerRows.length > 0 ? Math.round((femaleCount / farmerRows.length) * 100) : 0;
  const indivCount  = farmerRows.filter((r: any) => r.beneficiary_type === "individual").length;
  const groupCount  = farmerRows.filter((r: any) => r.beneficiary_type === "group").length;

  const districtCounts: Record<number, number> = {};
  for (const r of farmerRows) {
    if (r.district_id) districtCounts[r.district_id] = (districtCounts[r.district_id] ?? 0) + 1;
  }
  const districtIds = Object.keys(districtCounts).map(Number);
  let farmersByDistrictChart: { name: string; farmers: number }[] = [];
  if (districtIds.length) {
    const { data: dNames } = await supabase.from("districts").select("id,name").in("id", districtIds);
    farmersByDistrictChart = (dNames ?? [])
      .map((d: any) => ({ name: d.name, farmers: districtCounts[d.id] ?? 0 }))
      .sort((a: any, b: any) => b.farmers - a.farmers)
      .slice(0, 8);
  }

  // Campaign progress
  const campaignProgress = (activeCampaignRows.data ?? []).map((c: any) => {
    const target    = Math.max(Number(c.allocated_farmers) || 0, Number(c.target_beneficiaries) || 0, 1);
    const delivered = Number(c.delivered_count) || 0;
    return {
      id:              c.id,
      name:            c.name,
      status:          c.status,
      allocatedFarmers: Number(c.allocated_farmers) || 0,
      targetBeneficiaries: Number(c.target_beneficiaries) || 0,
      deliveredCount:  delivered,
      pct:             Math.min(100, Math.round((delivered / target) * 100)),
    };
  });

  // Stock alerts — resolve names
  const lowStockRows = lowStockRaw.data ?? [];
  let stockAlerts: { id: number; itemName: string; warehouseName: string; available: number }[] = [];
  if (lowStockRows.length) {
    const [whMap2, itemMap2] = await Promise.all([
      lookupMap("warehouses",   [...new Set(lowStockRows.map((r: any) => r.warehouse_id).filter(Boolean))],  "id,name"),
      lookupMap("input_items",  [...new Set(lowStockRows.map((r: any) => r.input_item_id).filter(Boolean))], "id,name,unit"),
    ]);
    stockAlerts = lowStockRows.map((r: any) => ({
      id:            r.id,
      itemName:      itemMap2[r.input_item_id]?.name  ?? "Unknown item",
      unit:          itemMap2[r.input_item_id]?.unit  ?? "",
      warehouseName: whMap2[r.warehouse_id]?.name    ?? "Unknown warehouse",
      available:     Number(r.available),
    }));
  }

  return {
    summary: {
      totalFarmers:     totalFarmers     ?? 0,
      pendingFarmers:   pendingFarmers   ?? 0,
      activeCampaigns:  activeCampaigns  ?? 0,
      totalDispatches:  totalDispatches  ?? 0,
      totalAllocations: totalAllocations ?? 0,
      pendingPod:       pendingPod       ?? 0,
      openIncidents:    openIncidents    ?? 0,
      femalePct,
      femaleCount,
      indivCount,
      groupCount,
    },
    trends: {
      farmers:   trendPct(farmersThisWeek,   farmersLastWeek),
      pod:       trendPct(podThisWeek,       podLastWeek),
      dispatches: trendPct(dispatchesThisWeek, dispatchesLastWeek),
    },
    campaignProgress,
    stockAlerts,
    charts: {
      farmerStatusChart,
      campaignCompletionChart,
      warehouseStockChart,
      podTrendChart,
      farmersByDistrictChart,
      beneficiaryTypeChart: [
        { name: "Individual", value: indivCount },
        { name: "Group",      value: groupCount },
      ],
    },
    recentActivity: cc(recentActivity.data ?? []),
  };
}

export async function checkFarmerDuplicate(
  phone?: string,
  nationalId?: string,
): Promise<{ duplicate: boolean; existingFarmer?: { id: number; name: string } }> {
  const cleanPhone      = phone?.trim();
  const cleanNationalId = nationalId?.trim();
  if (!cleanPhone && !cleanNationalId) return { duplicate: false };

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { duplicate: false };

  const resp = await fetch(apiUrl("/api/farmers/bulk-check-duplicates"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      phones:      cleanPhone      ? [cleanPhone]      : [],
      nationalIds: cleanNationalId ? [cleanNationalId] : [],
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as any).error ?? "Duplicate check failed");
  }
  const json = await resp.json();
  const matches = (json.duplicates ?? []) as Array<{ id: number; phone: string; nationalId: string; farmerCode: string; name: string }>;
  if (matches.length === 0) return { duplicate: false };
  const match = matches[0];
  return { duplicate: true, existingFarmer: { id: match.id, name: match.name || match.farmerCode || "Unknown" } };
}

// ── FARMERS ────────────────────────────────────────────────────────────────
export async function listFarmers(page = 1, limit = 20, search?: string, status?: string, districtId?: number, beneficiaryType?: string) {
  let q = supabase
    .from("farmers")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  // Commas, parentheses and quotes are PostgREST filter delimiters; a raw term
  // containing them makes the whole request fail with a 400.
  const term = (search ?? "").replace(/[,()"'\\]/g, " ").replace(/\s+/g, " ").trim();
  if (term) q = q.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,farmer_code.ilike.%${term}%,farmer_group.ilike.%${term}%`);
  if (status) q = q.eq("status", status);
  if (districtId) q = q.eq("district_id", districtId);
  if (beneficiaryType) q = q.eq("beneficiary_type", beneficiaryType);
  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const [districtMap, chiefdomMap, vcMap] = await Promise.all([
    lookupMap("districts", [...new Set(rows.map((r: any) => r.district_id).filter(Boolean))], "id,name"),
    lookupMap("chiefdoms", [...new Set(rows.map((r: any) => r.chiefdom_id).filter(Boolean))], "id,name"),
    lookupMap("value_chains", [...new Set(rows.map((r: any) => r.value_chain_id).filter(Boolean))], "id,name"),
  ]);
  return {
    data: rows.map((r: any) => ({
      ...cc(r),
      districtName: districtMap[r.district_id]?.name ?? null,
      chiefdomName: chiefdomMap[r.chiefdom_id]?.name ?? null,
      valueChainName: vcMap[r.value_chain_id]?.name ?? null,
    })),
    total: count ?? 0,
  };
}

export async function getFarmerTypeCounts(): Promise<{ individuals: number; groups: number }> {
  const [ind, grp] = await Promise.all([
    supabase.from("farmers").select("*", { count: "exact", head: true }).eq("beneficiary_type", "individual"),
    supabase.from("farmers").select("*", { count: "exact", head: true }).eq("beneficiary_type", "group"),
  ]);
  return { individuals: ind.count ?? 0, groups: grp.count ?? 0 };
}

export async function getFarmer(id: number) {
  const { data, error } = await supabase.from("farmers").select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  const r = data as any;
  const [districtMap, chiefdomMap, sectionMap, vcMap] = await Promise.all([
    lookupMap("districts", r.district_id ? [r.district_id] : [], "id,name"),
    lookupMap("chiefdoms", r.chiefdom_id ? [r.chiefdom_id] : [], "id,name"),
    lookupMap("sections", r.section_id ? [r.section_id] : [], "id,name"),
    lookupMap("value_chains", r.value_chain_id ? [r.value_chain_id] : [], "id,name"),
  ]);
  return {
    ...cc(r),
    districtName: districtMap[r.district_id]?.name ?? null,
    chiefdomName: chiefdomMap[r.chiefdom_id]?.name ?? null,
    sectionName: sectionMap[r.section_id]?.name ?? null,
    valueChainName: vcMap[r.value_chain_id]?.name ?? null,
  };
}

function generateFarmerCode() {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `FRM-${ts}${rnd}`;
}
function generateBarcode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `BC-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}
function generateVehicleCode() {
  return `VHL-${Date.now().toString(36).toUpperCase()}`;
}
function generateCampaignCode() {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `CMP-${ts}${rnd}`;
}
function generateOrderCode() {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `PO-${ts}${rnd}`;
}
function generatePodCode() {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `POD-${ts}${rnd}`;
}
export function generateSubmissionKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function createFarmer(payload: any) {
  const userId = await intUid();
  const farmerCode = generateFarmerCode();
  const barcodeToken = generateBarcode();
  const { data, error } = await supabase.from("farmers").insert({
    beneficiary_type: payload.beneficiaryType ?? "individual",
    first_name: payload.firstName,
    last_name: payload.lastName,
    gender: payload.beneficiaryType === "group" ? "N/A" : (payload.gender ?? "Male"),
    phone: payload.phone ?? null,
    national_id: payload.nationalId ?? null,
    district_id: payload.districtId ?? null,
    chiefdom_id: payload.chiefdomId ?? null,
    value_chain_id: payload.valueChainId ?? null,
    farm_size: payload.farmSize ?? null,
    farmer_group: payload.farmerGroup ?? null,
    group_size: payload.groupSize ?? null,
    cbo_name: payload.cboName ?? null,
    registered_by: userId,
    farmer_code: farmerCode,
    barcode_token: barcodeToken,
  }).select().single();
  if (error) throw new Error(error.message);
  await logAudit("CREATE", "farmers", `Registered farmer ${(data as any).farmer_code}`, "farmer", (data as any).id);
  return cc(data);
}

export async function updateFarmer(id: number, payload: any) {
  const { data, error } = await supabase.from("farmers").update({
    beneficiary_type: payload.beneficiaryType ?? "individual",
    first_name: payload.firstName,
    last_name: payload.lastName,
    gender: payload.beneficiaryType === "group" ? "N/A" : (payload.gender ?? null),
    phone: payload.phone ?? null,
    national_id: payload.nationalId ?? null,
    district_id: payload.districtId ?? null,
    chiefdom_id: payload.chiefdomId ?? null,
    value_chain_id: payload.valueChainId ?? null,
    farm_size: payload.farmSize ?? null,
    farmer_group: payload.farmerGroup ?? null,
    group_size: payload.groupSize ?? null,
    cbo_name: payload.cboName ?? null,
  }).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  await logAudit("UPDATE", "farmers", `Updated farmer #${id}`, "farmer", id);
  return cc(data);
}

export async function approveFarmer(id: number) {
  const userId = await intUid();
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

export async function deleteFarmer(id: number) {
  const { error } = await supabase.from("farmers").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await logAudit("DELETE", "farmers", `Deleted farmer #${id}`, "farmer", id);
}

// ── CAMPAIGNS ──────────────────────────────────────────────────────────────
export async function listCampaigns(page = 1, limit = 20) {
  const { data, error, count } = await supabase
    .from("campaigns")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const [districtMap, vcMap] = await Promise.all([
    lookupMap("districts", [...new Set(rows.map((r: any) => r.district_id).filter(Boolean))], "id,name"),
    lookupMap("value_chains", [...new Set(rows.map((r: any) => r.value_chain_id).filter(Boolean))], "id,name"),
  ]);
  return {
    data: rows.map((r: any) => ({
      ...cc(r),
      districtName: districtMap[r.district_id]?.name ?? null,
      valueChainName: vcMap[r.value_chain_id]?.name ?? null,
    })),
    total: count ?? 0,
  };
}

export async function getCampaign(id: number) {
  const { data, error } = await supabase.from("campaigns").select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  const r = data as any;
  const { data: items } = await supabase.from("campaign_items").select("*").eq("campaign_id", id);
  const itemIds = (items ?? []).map((i: any) => i.input_item_id).filter(Boolean);
  const [districtMap, vcMap, inputItemMap] = await Promise.all([
    lookupMap("districts", r.district_id ? [r.district_id] : [], "id,name"),
    lookupMap("value_chains", r.value_chain_id ? [r.value_chain_id] : [], "id,name"),
    lookupMap("input_items", itemIds, "id,name,unit"),
  ]);
  return {
    ...cc(r),
    districtName: districtMap[r.district_id]?.name ?? null,
    valueChainName: vcMap[r.value_chain_id]?.name ?? null,
    campaignItems: (items ?? []).map((i: any) => ({
      ...cc(i),
      inputItemName: inputItemMap[i.input_item_id]?.name ?? null,
      unit: inputItemMap[i.input_item_id]?.unit ?? null,
    })),
  };
}

export async function createCampaign(payload: any) {
  const userId = await intUid();
  const campaignCode = generateCampaignCode();
  const { data, error } = await supabase.from("campaigns").insert({
    campaign_code: campaignCode,
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

export async function updateCampaign(id: number, payload: any) {
  const { data, error } = await supabase.from("campaigns").update({
    name: payload.name,
    season: payload.season ?? null,
    district_id: payload.districtId ?? null,
    value_chain_id: payload.valueChainId ?? null,
    start_date: payload.startDate ? new Date(payload.startDate).toISOString() : null,
    end_date: payload.endDate ? new Date(payload.endDate).toISOString() : null,
    notes: payload.description ?? payload.notes ?? null,
    updated_at: new Date().toISOString(),
  }).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  await logAudit("UPDATE", "campaigns", `Updated campaign #${id}`, "campaign", id);
  return cc(data);
}

export async function addCampaignItem(campaignId: number, inputItemId: number) {
  const { data, error } = await supabase.from("campaign_items").insert({
    campaign_id: campaignId,
    input_item_id: inputItemId,
  }).select().single();
  if (error) throw new Error(error.message);
  await logAudit("CREATE", "campaign_items", `Added item to campaign #${campaignId}`, "campaign", campaignId);
  return cc(data);
}

export async function removeCampaignItem(itemId: number, campaignId: number) {
  const { error } = await supabase.from("campaign_items").delete().eq("id", itemId);
  if (error) throw new Error(error.message);
  await logAudit("DELETE", "campaign_items", `Removed item from campaign #${campaignId}`, "campaign", campaignId);
}

export async function deleteCampaign(id: number) {
  const { data: existing, error: fetchErr } = await supabase
    .from("campaigns").select("status,campaign_code").eq("id", id).single();
  if (fetchErr) throw new Error(fetchErr.message);
  if ((existing as any).status !== "Draft") {
    throw new Error("Only Draft campaigns can be deleted.");
  }
  await supabase.from("campaign_items").delete().eq("campaign_id", id);
  const { error } = await supabase.from("campaigns").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await logAudit("DELETE", "campaigns", `Deleted campaign ${(existing as any).campaign_code}`, "campaign", id);
}

export async function submitCampaign(id: number) {
  const { data, error } = await supabase.from("campaigns")
    .update({ status: "Submitted" }).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  await logAudit("SUBMIT", "campaigns", `Submitted campaign #${id}`, "campaign", id);
  return cc(data);
}

export async function approveCampaign(id: number) {
  const userId = await intUid();
  const { data, error } = await supabase.from("campaigns")
    .update({ status: "Approved", approved_by: userId, approved_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error) throw new Error(error.message);
  await logAudit("APPROVE", "campaigns", `Approved campaign #${id}`, "campaign", id);
  return cc(data);
}

// ── ALLOCATIONS ──────────────────────────────────────────────────────────────────
export async function listAllocations(page = 1, limit = 20, campaignId?: number) {
  let q = supabase
    .from("allocations")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (campaignId) q = q.eq("campaign_id", campaignId);
  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const campaignIds = [...new Set(rows.map((r: any) => r.campaign_id).filter(Boolean))];
  const farmerIds   = [...new Set(rows.map((r: any) => r.farmer_id).filter(Boolean))];

  // Fetch campaign_items for all campaigns in this page
  const { data: ciRows } = campaignIds.length
    ? await supabase.from("campaign_items").select("campaign_id,input_item_id").in("campaign_id", campaignIds)
    : { data: [] };
  const itemIds = [...new Set((ciRows ?? []).map((ci: any) => ci.input_item_id).filter(Boolean))];

  const [farmerMap, campaignMap, inputItemMap] = await Promise.all([
    lookupMap("farmers", farmerIds, "id,first_name,last_name,farmer_code,beneficiary_type,farmer_group,group_size,district_id"),
    lookupMap("campaigns", campaignIds, "id,name,campaign_code"),
    itemIds.length ? lookupMap("input_items", itemIds, "id,name,item_code,unit") : Promise.resolve({}),
  ]);
  const districtIds = [...new Set(Object.values(farmerMap).map((f: any) => f.district_id).filter(Boolean))];
  const districtMap = districtIds.length ? await lookupMap("districts", districtIds, "id,name") : {};

  // Build campaignId → [{name, itemCode, unit}] map
  const campaignItemsMap: Record<number, { name: string; itemCode: string; unit: string }[]> = {};
  for (const ci of (ciRows ?? []) as any[]) {
    const it = (inputItemMap as Record<string, any>)[ci.input_item_id];
    if (!it) continue;
    if (!campaignItemsMap[ci.campaign_id]) campaignItemsMap[ci.campaign_id] = [];
    campaignItemsMap[ci.campaign_id].push({
      name: it.name ?? it.Name ?? "",
      itemCode: it.item_code ?? it.itemCode ?? "",
      unit: it.unit ?? "",
    });
  }

  return {
    data: rows.map((r: any) => ({
      ...cc(r),
      farmerName: farmerDisplayName(farmerMap[r.farmer_id]) || null,
      farmerCode: farmerMap[r.farmer_id]?.farmer_code ?? null,
      beneficiaryType: farmerMap[r.farmer_id]?.beneficiary_type ?? null,
      groupSize: farmerMap[r.farmer_id]?.group_size ?? null,
      districtName: districtMap[farmerMap[r.farmer_id]?.district_id]?.name ?? null,
      campaignName: campaignMap[r.campaign_id]?.name ?? null,
      campaignItems: campaignItemsMap[r.campaign_id] ?? [],
    })),
    total: count ?? 0,
  };
}

export async function createAllocation(payload: any) {
  const userId = await intUid();
  const { data, error } = await supabase.from("allocations").insert({
    campaign_id: payload.campaignId,
    farmer_id: payload.farmerId,
    notes: payload.notes ?? null,
    allocated_by: userId,
  }).select().single();
  if (error) throw new Error(error.message);
  await logAudit("CREATE", "allocations", `Created allocation #${(data as any).id}`, "allocation", (data as any).id);
  return cc(data);
}

export async function removeAllocation(id: number) {
  const { error } = await supabase.from("allocations").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await logAudit("DELETE", "allocations", `Removed allocation #${id}`, "allocation", id);
}

export async function updateAllocation(id: number, payload: { notes?: string | null; status?: string }) {
  const update: Record<string, any> = {};
  if (payload.notes !== undefined) update.notes = payload.notes;
  if (payload.status !== undefined) update.status = payload.status;
  const { data, error } = await supabase.from("allocations").update(update).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  await logAudit("UPDATE", "allocations", `Updated allocation #${id}`, "allocation", id);
  return cc(data);
}

// ── INVENTORY ───────────────────────────────────────────────────────────────────
export async function getStockBalance() {
  const { data, error } = await supabase
    .from("stock_balance")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const [whMap, itemMap] = await Promise.all([
    lookupMap("warehouses", [...new Set(rows.map((r: any) => r.warehouse_id).filter(Boolean))], "id,name,code"),
    lookupMap("input_items", [...new Set(rows.map((r: any) => r.input_item_id).filter(Boolean))], "id,name,unit,category"),
  ]);
  return rows.map((r: any) => ({
    ...cc(r),
    warehouseName: whMap[r.warehouse_id]?.name ?? null,
    warehouseCode: whMap[r.warehouse_id]?.code ?? null,
    itemName: itemMap[r.input_item_id]?.name ?? null,
    unit: itemMap[r.input_item_id]?.unit ?? null,
    category: itemMap[r.input_item_id]?.category ?? null,
  }));
}

export async function receiveStock(payload: any) {
  if (!payload.quantity || payload.quantity <= 0) throw new Error("Quantity must be greater than zero");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  const response = await fetch(apiUrl("/api/inventory/receive-stock"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({ error: response.statusText }));
  if (!response.ok) throw new Error((result as any).error ?? "Failed to receive stock");
  return result;
}

export async function transferStock(payload: {
  fromWarehouseId: number;
  toWarehouseId: number;
  inputItemId: number;
  quantity: number;
  notes?: string;
}) {
  if (!payload.quantity || payload.quantity <= 0) throw new Error("Quantity must be greater than zero");
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not authenticated");
  const resp = await fetch(apiUrl("/api/inventory/transfer-stock"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as any).error ?? "Failed to transfer stock");
  }
  return resp.json();
}

// ── PROCUREMENT ─────────────────────────────────────────────────────────────────
export async function listProcurementOrders() {
  const { data, error } = await supabase
    .from("procurement_orders")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const whMap = await lookupMap("warehouses", [...new Set(rows.map((r: any) => r.warehouse_id).filter(Boolean))], "id,name,code");
  return rows.map((r: any) => ({
    ...cc(r),
    warehouseName: whMap[r.warehouse_id]?.name ?? null,
  }));
}

export async function createProcurementOrder(payload: any) {
  const userId = await intUid();
  const orderCode = generateOrderCode();
  const { data, error } = await supabase.from("procurement_orders").insert({
    order_code: orderCode,
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

export async function updateProcurementOrder(id: number, payload: any) {
  const { data, error } = await supabase.from("procurement_orders").update({
    supplier_name: payload.supplierName,
    warehouse_id: payload.warehouseId ? Number(payload.warehouseId) : null,
    order_date: payload.orderDate ? new Date(payload.orderDate).toISOString() : null,
    expected_delivery: payload.expectedDelivery ? new Date(payload.expectedDelivery).toISOString() : null,
    notes: payload.notes ?? null,
    status: payload.status,
  }).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  await logAudit("UPDATE", "procurement", `Updated PO #${id}`, "procurement", id);
  return cc(data);
}

export async function deleteProcurementOrder(id: number) {
  const { error } = await supabase.from("procurement_orders").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await logAudit("DELETE", "procurement", `Deleted PO #${id}`, "procurement", id);
}

// ── VEHICLES ──────────────────────────────────────────────────────────────────────
export async function listVehicles(page = 1, limit = 50) {
  const { data, error, count } = await supabase
    .from("vehicles").select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (error) throw new Error(error.message);
  return { data: cc(data ?? []), total: count ?? 0 };
}

export async function createVehicle(payload: any) {
  const vehicleCode = generateVehicleCode();
  const { data, error } = await supabase.from("vehicles").insert({
    vehicle_code: vehicleCode,
    plate_number: payload.plateNumber,
    vehicle_type: payload.vehicleType,
    make: payload.make ?? null,
    model: payload.model ?? null,
    year: payload.year ? Number(payload.year) : null,
    capacity: payload.capacity ? Number(payload.capacity) : null,
    status: payload.status ?? "Active",
  }).select().single();
  if (error) throw new Error(error.message);
  await logAudit("CREATE", "vehicles", `Created vehicle ${(data as any).vehicle_code}`, "vehicle", (data as any).id);
  return cc(data);
}

export async function updateVehicle(id: number, payload: any) {
  const { data, error } = await supabase.from("vehicles").update({
    plate_number: payload.plateNumber,
    vehicle_type: payload.vehicleType,
    make: payload.make ?? null,
    model: payload.model ?? null,
    year: payload.year ? Number(payload.year) : null,
    capacity: payload.capacity ? Number(payload.capacity) : null,
    status: payload.status ?? "Active",
  }).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  await logAudit("UPDATE", "vehicles", `Updated vehicle #${id}`, "vehicle", id);
  return cc(data);
}

export async function deleteVehicle(id: number) {
  const { error } = await supabase.from("vehicles").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await logAudit("DELETE", "vehicles", `Deleted vehicle #${id}`, "vehicle", id);
}

export async function listDrivers(page = 1, limit = 50) {
  const { data, error, count } = await supabase
    .from("drivers").select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (error) throw new Error(error.message);
  return { data: cc(data ?? []), total: count ?? 0 };
}

export async function updateDriver(id: number, payload: any) {
  const { data, error } = await supabase.from("drivers").update({
    full_name: payload.fullName,
    phone: payload.phone ?? null,
    is_active: payload.isActive ?? 1,
  }).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  await logAudit("UPDATE", "drivers", `Updated driver #${id}`, "driver", id);
  return cc(data);
}

export async function createDriver(payload: any) {
  const driver_code = `DRV-${Date.now().toString(36).toUpperCase()}`;
  const { data, error } = await supabase.from("drivers").insert({
    driver_code,
    full_name: payload.fullName,
    phone: payload.phone ?? null,
    is_active: 1,
  }).select().single();
  if (error) throw new Error(error.message);
  await logAudit("CREATE", "drivers", `Created driver ${(data as any).driver_code}`, "driver", (data as any).id);
  return cc(data);
}

export async function deleteDriver(id: number) {
  const { error } = await supabase.from("drivers").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await logAudit("DELETE", "drivers", `Deleted driver #${id}`, "driver", id);
}

// ── DISPATCH ──────────────────────────────────────────────────────────────────────
async function dispatchToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  return session.access_token;
}

export async function listDispatches(page = 1, limit = 20, fieldOfficerId?: number, status?: string, manifestCode?: string, showArchived = false) {
  const token = await dispatchToken();
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (fieldOfficerId) params.set("fieldOfficerId", String(fieldOfficerId));
  if (status && status !== "all") params.set("status", status);
  if (manifestCode && manifestCode.trim()) params.set("manifestCode", manifestCode.trim());
  if (showArchived) params.set("archived", "true");
  const resp = await fetch(apiUrl(`/api/dispatch?${params}`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Failed to list dispatches: ${resp.statusText}`);
  return resp.json();
}

export async function archiveDispatch(id: number): Promise<void> {
  const token = await dispatchToken();
  const resp = await fetch(apiUrl(`/api/dispatch/${id}/archive`), {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as any).error ?? "Failed to archive dispatch");
  }
}

export async function unarchiveDispatch(id: number): Promise<void> {
  const token = await dispatchToken();
  const resp = await fetch(apiUrl(`/api/dispatch/${id}/unarchive`), {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as any).error ?? "Failed to unarchive dispatch");
  }
}

export async function getDispatch(id: number) {
  const token = await dispatchToken();
  const resp = await fetch(apiUrl(`/api/dispatch/${id}`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Failed to get dispatch: ${resp.statusText}`);
  return resp.json();
}

export async function createDispatch(payload: any) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const resp = await fetch(apiUrl("/api/dispatch"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as any).error ?? "Failed to create dispatch");
  }
  return cc(await resp.json());
}

export async function importDispatch(payload: any) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const resp = await fetch(apiUrl("/api/dispatch/import"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    if (resp.status === 422 && (err as any).shortfalls) {
      const stockError: any = new Error("insufficient_stock");
      stockError.shortfalls = (err as any).shortfalls;
      throw stockError;
    }
    throw new Error((err as any).error ?? "Failed to import dispatch");
  }
  return resp.json();
}

export async function approveDispatch(id: number) {
  const token = await dispatchToken();
  const resp = await fetch(apiUrl(`/api/dispatch/${id}/approve`), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as any).error ?? "Failed to approve dispatch");
  }
  return resp.json();
}

export async function dispatchManifest(id: number) {
  const token = await dispatchToken();
  const resp = await fetch(apiUrl(`/api/dispatch/${id}/dispatch`), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as any).error ?? "Failed to dispatch manifest");
  }
  return resp.json();
}

export async function arriveDispatch(id: number) {
  const token = await dispatchToken();
  const resp = await fetch(apiUrl(`/api/dispatch/${id}/arrive`), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as any).error ?? "Failed to mark arrival");
  }
  return resp.json();
}

export async function deleteDispatch(id: number) {
  const { error } = await supabase.from("dispatches").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await logAudit("DELETE", "dispatch", `Deleted manifest #${id}`, "dispatch", id);
}

export async function listFieldOfficers() {
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, email, district_id")
    .eq("role", "FieldOfficer")
    .eq("is_active", true)
    .order("full_name");
  if (error) throw new Error(error.message);
  return cc(data ?? []);
}

export async function assignDispatchOfficer(id: number, fieldOfficerId: number | null) {
  const token = await dispatchToken();
  const resp = await fetch(apiUrl(`/api/dispatch/${id}/assign`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fieldOfficerId }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as any).error ?? "Failed to assign officer");
  }
  return cc(await resp.json());
}

export async function cancelDispatch(id: number, reason?: string) {
  const token = await dispatchToken();
  const resp = await fetch(apiUrl(`/api/dispatch/${id}/cancel`), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as any).error ?? "Failed to cancel dispatch");
  }
  return cc(await resp.json());
}

export async function removeDispatchItem(dispatchId: number, itemId: number) {
  const { error } = await supabase.from("dispatch_items").delete().eq("id", itemId).eq("dispatch_id", dispatchId);
  if (error) throw new Error(error.message);
  await logAudit("DELETE", "dispatch", `Removed item #${itemId} from manifest #${dispatchId}`, "dispatch", dispatchId);
}

export async function addDispatchItem(payload: any) {
  const token = await dispatchToken();
  const resp = await fetch(apiUrl(`/api/dispatch/${payload.dispatchId}/items`), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      inputItemId: payload.inputItemId,
      quantityLoaded: payload.quantityLoaded,
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as any).error ?? "Failed to add item");
  }
  return resp.json();
}

// ── GIS ──────────────────────────────────────────────────────────────────────────────
async function gisToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  return session.access_token;
}

export async function listGpsRoutes(params?: {
  vehicleId?: number;
  dispatchId?: number;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<any[]> {
  const token = await gisToken();
  const qs = new URLSearchParams();
  if (params?.vehicleId)  qs.set("vehicleId",  String(params.vehicleId));
  if (params?.dispatchId) qs.set("dispatchId", String(params.dispatchId));
  if (params?.from)       qs.set("from",       params.from);
  if (params?.to)         qs.set("to",         params.to);
  if (params?.limit)      qs.set("limit",      String(params.limit));
  const resp = await fetch(apiUrl(`/api/gis/routes?${qs}`), { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as any).error ?? "Failed to fetch GIS routes");
  }
  return resp.json();
}

export function buildGisExportUrl(format: "geojson" | "kml" | "gpx" | "csv", params?: {
  vehicleId?: number;
  from?: string;
  to?: string;
}): string {
  const qs = new URLSearchParams();
  if (params?.vehicleId) qs.set("vehicleId", String(params.vehicleId));
  if (params?.from)      qs.set("from",      params.from);
  if (params?.to)        qs.set("to",        params.to);
  return apiUrl(`/api/gis/export/${format}?${qs}`);
}

// ── GPS ──────────────────────────────────────────────────────────────────────────────
async function gpsToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  return session.access_token;
}

export async function listVehicleGpsStatus() {
  const token = await gpsToken();
  const resp = await fetch(apiUrl("/api/gps/vehicles"), { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`GPS vehicles fetch failed: ${resp.statusText}`);
  return resp.json();
}

export async function listGpsTrack(vehicleId?: number, limit = 50) {
  if (!vehicleId) return [];
  const token = await gpsToken();
  const resp = await fetch(apiUrl(`/api/gps/track/${vehicleId}?limit=${limit}`), { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`GPS track fetch failed: ${resp.statusText}`);
  return resp.json();
}

export async function listGpsVehicleHistory(vehicleId: number, limit = 20) {
  const token = await gpsToken();
  const resp = await fetch(apiUrl(`/api/gps/history/${vehicleId}?limit=${limit}`), { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`GPS history fetch failed: ${resp.statusText}`);
  return resp.json();
}

export async function listGpsTraceDevices(): Promise<{ configured: boolean; devices: any[]; vehicles: any[] }> {
  const token = await gpsToken();
  const resp = await fetch(apiUrl("/api/gpstrace/devices"), { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`GPS-Trace devices fetch failed: ${resp.statusText}`);
  return resp.json();
}

export async function syncGpsTrace(): Promise<{ synced: number; total: number; linked: number }> {
  const token = await gpsToken();
  const resp = await fetch(apiUrl("/api/gpstrace/sync"), { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`GPS-Trace sync failed: ${resp.statusText}`);
  return resp.json();
}

export async function linkGpsTraceDevice(vehicleId: number, deviceId: string, deviceName?: string) {
  const token = await gpsToken();
  const resp = await fetch(apiUrl("/api/gpstrace/link"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ vehicleId, deviceId, deviceName }),
  });
  if (!resp.ok) throw new Error(`Link failed: ${resp.statusText}`);
  return resp.json();
}

export async function unlinkGpsTraceDevice(vehicleId: number) {
  const token = await gpsToken();
  const resp = await fetch(apiUrl(`/api/gpstrace/unlink/${vehicleId}`), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Unlink failed: ${resp.statusText}`);
  return resp.json();
}

// ── POD ──────────────────────────────────────────────────────────────────────────────
export async function listPod(page = 1, limit = 20, dispatchId?: number, status?: string, faceStatus?: string) {
  let q = supabase
    .from("pod")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (dispatchId) q = q.eq("dispatch_id", dispatchId);
  if (status) q = q.eq("status", status);
  if (faceStatus) q = q.eq("face_status", faceStatus);
  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const [farmerMap, campaignMap, inputItemMap] = await Promise.all([
    lookupMap("farmers", [...new Set(rows.map((r: any) => r.farmer_id).filter(Boolean))], "id,first_name,last_name,farmer_code,beneficiary_type,farmer_group,group_size,photo_url"),
    lookupMap("campaigns", [...new Set(rows.map((r: any) => r.campaign_id).filter(Boolean))], "id,name,campaign_code"),
    lookupMap("input_items", [...new Set(rows.map((r: any) => r.input_item_id).filter(Boolean))], "id,name,category,unit"),
  ]);
  return {
    data: rows.map((r: any) => ({
      ...cc(r),
      farmerName: farmerDisplayName(farmerMap[r.farmer_id]) || null,
      farmerCode: farmerMap[r.farmer_id]?.farmer_code ?? null,
      beneficiaryType: farmerMap[r.farmer_id]?.beneficiary_type ?? null,
      groupSize: farmerMap[r.farmer_id]?.group_size ?? null,
      referencePhotoKey: farmerMap[r.farmer_id]?.photo_url ?? null,
      campaignName: campaignMap[r.campaign_id]?.name ?? null,
      inputItemName: inputItemMap[r.input_item_id]?.name ?? null,
      inputItemCategory: inputItemMap[r.input_item_id]?.category ?? null,
    })),
    total: count ?? 0,
  };
}

// Supabase caps a single request at 1000 rows, so exports and full-dispatch
// views must page through the data rather than request one oversized page.
const EXPORT_PAGE_SIZE = 1000;
async function fetchAllPages<T>(fetchPage: (page: number, limit: number) => Promise<{ data: T[]; total: number }>): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const { data, total } = await fetchPage(page, EXPORT_PAGE_SIZE);
    rows.push(...data);
    if (data.length < EXPORT_PAGE_SIZE || rows.length >= total) break;
  }
  return rows;
}

export function listAllPod(dispatchId?: number, status?: string, faceStatus?: string) {
  return fetchAllPages((page, limit) => listPod(page, limit, dispatchId, status, faceStatus));
}

export function listAllIncidents(status?: string) {
  return fetchAllPages((page, limit) => listIncidents(page, limit, status));
}

export function listAllAuditLogs(filters: AuditFilters = {}) {
  return fetchAllPages((page, limit) => listAuditLogs(page, limit, filters));
}

export async function getPodItems(podId: number) {
  const { data, error } = await supabase
    .from("pod_items")
    .select("id, input_item_id, quantity_delivered, input_items(name, unit, category)")
    .eq("pod_id", podId)
    .order("id");
  if (error) return [];
  return (data ?? []).map((pi: any) => ({
    id: pi.id,
    inputItemId: pi.input_item_id,
    quantityDelivered: Number(pi.quantity_delivered),
    inputItemName: pi.input_items?.name ?? null,
    unit: pi.input_items?.unit ?? null,
    category: pi.input_items?.category ?? null,
  }));
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
  const token = await podToken();
  const items = Array.isArray(payload.items)
    ? payload.items.map((item: any) => ({
        inputItemId: Number(item.inputItemId ?? item.input_item_id),
        quantity: Number(item.quantity ?? item.quantityDelivered ?? item.quantity_delivered),
      }))
    : payload.inputItemId != null && payload.quantityDelivered != null
      ? [{ inputItemId: Number(payload.inputItemId), quantity: Number(payload.quantityDelivered) }]
      : undefined;
  const resp = await fetch(apiUrl("/api/pod"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      farmerId: Number(payload.farmerId),
      submissionKey: payload.submissionKey ?? undefined,
      dispatchId: payload.dispatchId ?? undefined,
      campaignId: payload.campaignId ?? undefined,
      inputItemId: payload.inputItemId ?? undefined,
      inputBarcode: payload.inputBarcode ?? undefined,
      quantityDelivered: payload.quantityDelivered != null ? Number(payload.quantityDelivered) : undefined,
      items,
      notes: payload.notes ?? undefined,
      otpVerificationToken: payload.otpVerificationToken ?? undefined,
      faceVerificationToken: payload.faceVerificationToken ?? undefined,
      otpStatus: payload.otpStatus ?? "Pending",
      otpVerified: payload.otpVerified,
      faceStatus: payload.faceStatus ?? "Pending",
      faceSimilarity: payload.faceSimilarity ?? undefined,
      // The server persists the captured portal photo as the face-photo key.
      facePhotoKey: payload.facePhotoKey ?? payload.photoUrl ?? undefined,
      photoKeys: payload.photoKeys ?? undefined,
      photoGpsCoords: payload.photoGpsCoords ?? undefined,
      farmerLatitude: payload.farmerLatitude ?? undefined,
      farmerLongitude: payload.farmerLongitude ?? undefined,
      overrideReason: payload.overrideReason ?? undefined,
      otpCode: payload.otpCode ?? undefined,
      actualGroupSize: payload.actualGroupSize ?? undefined,
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as any).error ?? "Failed to submit PoD");
  }
  return cc(await resp.json());
}

async function getSupabaseAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function apiGet(path: string): Promise<any> {
  const token = await getSupabaseAccessToken();
  const res = await fetch(apiUrl(path), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error ?? json?.message ?? res.statusText ?? "Request failed");
  }
  return res.json();
}

async function apiPost(path: string, body: unknown): Promise<any> {
  const token = await getSupabaseAccessToken();
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    const err = new Error(json?.error ?? json?.message ?? res.statusText ?? "Request failed") as Error & Record<string, unknown>;
    // Preserve any extra fields from the error body (e.g. retryAfterSeconds from 429)
    if (json && typeof json === "object") {
      Object.assign(err, json);
    }
    throw err;
  }
  return res.json();
}

export async function sendOtp(
  farmerId: number,
  opts?: { dispatchId?: number; campaignId?: number },
): Promise<{ sent: boolean; maskedPhone: string; farmerName: string; smsSent?: boolean; whatsappSent?: boolean; devCode?: string }> {
  return apiPost("/api/pod/otp/send", { farmerId, ...opts });
}

export async function listDispatchFarmers(dispatchId: number): Promise<{
  allocationId: number;
  farmerId: number;
  farmerName: string;
  farmerCode: string | null;
  phone: string | null;
  barcodeToken: string | null;
  allocationStatus: string;
}[]> {
  return apiGet(`/api/dispatch/${dispatchId}/farmers`);
}

export async function verifyOtp(farmerId: number, code: string, dispatchId: number): Promise<{ verified: boolean; verificationToken?: string }> {
  return apiPost("/api/pod/otp/verify", { farmerId, code, dispatchId });
}

export async function bypassOtp(
  farmerId: number,
  opts?: { dispatchId?: number; reason?: string },
): Promise<{ bypassed: boolean; reason: string; verificationToken?: string }> {
  return apiPost("/api/pod/otp/bypass", { farmerId, ...opts });
}

export async function notifyFarmers(dispatchId: number): Promise<{
  total: number;
  notified: number;
  noPhone: number;
  failed: number;
  campaignName: string;
}> {
  return apiPost(`/api/dispatches/${dispatchId}/notify-farmers`, {});
}

// ── RECONCILIATION ─────────────────────────────────────────────────────────────────────────
export async function listReconciliations() {
  const { data, error } = await supabase
    .from("reconciliations")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const [dispatchMap, whMap] = await Promise.all([
    lookupMap("dispatches", [...new Set(rows.map((r: any) => r.dispatch_id).filter(Boolean))], "id,manifest_code"),
    lookupMap("warehouses", [...new Set(rows.map((r: any) => r.warehouse_id).filter(Boolean))], "id,name,code"),
  ]);
  return rows.map((r: any) => ({
    ...cc(r),
    manifestCode: dispatchMap[r.dispatch_id]?.manifest_code ?? null,
    warehouseName: whMap[r.warehouse_id]?.name ?? null,
  }));
}

export async function createReconciliation(payload: any) {
  const userId = await intUid();
  const variance = (payload.loadedQuantity ?? 0) - (payload.deliveredQuantity ?? 0)
    - (payload.returnedQuantity ?? 0) - (payload.damagedQuantity ?? 0);
  // generate a unique code (equivalent to server-side randomBytes(3).hex().toUpperCase())
  const raw = new Uint8Array(5);
  crypto.getRandomValues(raw);
  const reconciliationCode = "REC-" + Array.from(raw).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  const { data, error } = await supabase.from("reconciliations").insert({
    reconciliation_code: reconciliationCode,
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
  const userId = await intUid();
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

export async function deleteReconciliation(id: number) {
  const { error } = await supabase.from("reconciliations").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await logAudit("DELETE", "reconciliations", `Deleted reconciliation #${id}`, "reconciliation", id);
}

// ── REPORTS ───────────────────────────────────────────────────────────────────────────
export async function getFarmerBeneficiaryReport() {
  const { data, error } = await supabase
    .from("farmers")
    .select("status, district_id, value_chain_id, gender, beneficiary_type, age_group, farm_size")
    .limit(5000);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const [districtMap, vcMap] = await Promise.all([
    lookupMap("districts", [...new Set(rows.map((r: any) => r.district_id).filter(Boolean))], "id,name"),
    lookupMap("value_chains", [...new Set(rows.map((r: any) => r.value_chain_id).filter(Boolean))], "id,name"),
  ]);

  // District breakdown
  const byDistrict: Record<string, any> = {};
  for (const f of rows) {
    const d = districtMap[(f as any).district_id]?.name ?? "Unknown";
    if (!byDistrict[d]) byDistrict[d] = { district: d, total: 0, approved: 0, pending: 0, female: 0, farmSize: 0 };
    byDistrict[d].total++;
    if ((f as any).status === "approved") byDistrict[d].approved++;
    if ((f as any).status === "pending") byDistrict[d].pending++;
    if ((f as any).gender === "Female") byDistrict[d].female++;
    if ((f as any).farm_size) byDistrict[d].farmSize += (f as any).farm_size;
  }
  const reportRows = Object.values(byDistrict).sort((a, b) => b.total - a.total).map((r: any) => ({
    ...r,
    femalePct: r.total > 0 ? Math.round((r.female / r.total) * 100) : 0,
    farmSize: Math.round(r.farmSize * 10) / 10,
  }));

  // Value chain breakdown
  const byVc: Record<string, any> = {};
  for (const f of rows) {
    const vc = vcMap[(f as any).value_chain_id]?.name ?? "Unknown";
    if (!byVc[vc]) byVc[vc] = { valueChain: vc, total: 0, approved: 0, female: 0 };
    byVc[vc].total++;
    if ((f as any).status === "approved") byVc[vc].approved++;
    if ((f as any).gender === "Female") byVc[vc].female++;
  }
  const vcRows = Object.values(byVc).sort((a, b) => b.total - a.total).map((r: any) => ({
    ...r,
    femalePct: r.total > 0 ? Math.round((r.female / r.total) * 100) : 0,
  }));

  // Age group breakdown
  const byAge: Record<string, number> = {};
  for (const f of rows) {
    const ag = (f as any).age_group ?? "Not Specified";
    byAge[ag] = (byAge[ag] ?? 0) + 1;
  }
  const ageRows = Object.entries(byAge)
    .map(([ageGroup, count]) => ({ ageGroup, count }))
    .sort((a, b) => b.count - a.count);

  // Beneficiary type
  const individual = rows.filter((r: any) => !r.beneficiary_type || r.beneficiary_type === "individual").length;
  const group = rows.filter((r: any) => r.beneficiary_type === "group").length;

  const total = reportRows.reduce((s, r) => s + r.total, 0);
  const approved = reportRows.reduce((s, r) => s + r.approved, 0);
  const female = reportRows.reduce((s, r) => s + r.female, 0);
  const totalFarmSize = Math.round(reportRows.reduce((s, r) => s + (r.farmSize ?? 0), 0) * 10) / 10;
  return {
    rows: reportRows,
    vcRows,
    ageRows,
    summary: {
      total, approved, female,
      pctApproved: total ? Math.round((approved / total) * 100) : 0,
      pctFemale: total ? Math.round((female / total) * 100) : 0,
      individual, group, totalFarmSize,
    },
  };
}

// ── M&E REPORT ──────────────────────────────────────────────────────────────
export async function getMEReport() {
  const [campaignsRes, podsRes] = await Promise.all([
    supabase.from("campaigns")
      .select("id,name,campaign_code,season,total_farmers,allocated_farmers,delivered_count,status")
      .order("created_at", { ascending: false }).limit(200),
    supabase.from("pod")
      .select("farmer_id,campaign_id,otp_status,face_status,gps_status,status,quantity_delivered")
      .limit(5000),
  ]);
  if (campaignsRes.error) throw new Error(campaignsRes.error.message);
  if (podsRes.error) throw new Error(podsRes.error.message);

  const campaigns = campaignsRes.data ?? [];
  const pods = podsRes.data ?? [];

  const farmerIds = [...new Set(pods.map((p: any) => p.farmer_id).filter(Boolean))] as number[];
  const farmerMap: Record<number, any> = farmerIds.length
    ? await lookupMap("farmers", farmerIds, "id,gender,value_chain_id")
    : {};

  const vcIds = [...new Set(Object.values(farmerMap).map((f: any) => f.value_chain_id).filter(Boolean))] as number[];
  const vcMap: Record<number, any> = vcIds.length
    ? await lookupMap("value_chains", vcIds, "id,name")
    : {};

  // Campaign reach table
  const campaignRows = campaigns.map((c: any) => {
    const cPods = pods.filter((p: any) => p.campaign_id === c.id);
    const femalePods = cPods.filter((p: any) => farmerMap[p.farmer_id]?.gender === "Female");
    const allocated = c.allocated_farmers ?? 0;
    const delivered = c.delivered_count ?? 0;
    const target = c.total_farmers ?? 0;
    return {
      id: c.id,
      name: c.name,
      campaignCode: c.campaign_code,
      season: c.season ?? "—",
      status: c.status,
      targetFarmers: target,
      allocatedFarmers: allocated,
      deliveredCount: delivered,
      podCount: cPods.length,
      allocationRate: target > 0 ? Math.round((allocated / target) * 100) : 0,
      deliveryRate: allocated > 0 ? Math.round((delivered / allocated) * 100) : 0,
      femaleDelivered: femalePods.length,
      femalePct: cPods.length > 0 ? Math.round((femalePods.length / cPods.length) * 100) : 0,
    };
  });

  // Overall verification rates
  const podCount = pods.length;
  const otpVerified  = pods.filter((p: any) => p.otp_status === "Verified").length;
  const faceVerified = pods.filter((p: any) => p.face_status === "Verified").length;
  const gpsCaptured  = pods.filter((p: any) => p.gps_status && p.gps_status !== "None" && p.gps_status !== "Pending").length;
  const podVerified  = pods.filter((p: any) => p.status === "Verified" || p.status === "Approved").length;
  const femaleDeliveries = pods.filter((p: any) => farmerMap[p.farmer_id]?.gender === "Female").length;

  // Value chain delivery breakdown
  const byVc: Record<string, any> = {};
  for (const p of pods) {
    const farmer  = farmerMap[p.farmer_id] as any;
    const vcId    = farmer?.value_chain_id;
    const vcName  = vcId ? (vcMap[vcId]?.name ?? "Unknown") : "Unknown";
    if (!byVc[vcName]) byVc[vcName] = { valueChain: vcName, deliveries: 0, female: 0, verified: 0, qty: 0 };
    byVc[vcName].deliveries++;
    if (farmer?.gender === "Female") byVc[vcName].female++;
    if (p.status === "Verified" || p.status === "Approved") byVc[vcName].verified++;
    byVc[vcName].qty += p.quantity_delivered ?? 0;
  }
  const vcDeliveryRows = Object.values(byVc)
    .sort((a, b) => b.deliveries - a.deliveries)
    .map((r: any) => ({
      ...r,
      qty: Math.round(r.qty * 10) / 10,
      femalePct:   r.deliveries > 0 ? Math.round((r.female   / r.deliveries) * 100) : 0,
      verifiedPct: r.deliveries > 0 ? Math.round((r.verified / r.deliveries) * 100) : 0,
    }));

  return {
    campaigns: campaignRows,
    verification: {
      podCount,
      otpVerified,  otpRate:      podCount > 0 ? Math.round((otpVerified  / podCount) * 100) : 0,
      faceVerified, faceRate:     podCount > 0 ? Math.round((faceVerified / podCount) * 100) : 0,
      gpsCaptured,  gpsRate:      podCount > 0 ? Math.round((gpsCaptured  / podCount) * 100) : 0,
      podVerified,  verifiedRate: podCount > 0 ? Math.round((podVerified  / podCount) * 100) : 0,
      femaleDeliveries, femaleRate: podCount > 0 ? Math.round((femaleDeliveries / podCount) * 100) : 0,
    },
    byValueChain: vcDeliveryRows,
  };
}

export async function getStockMovementReport(from?: string, to?: string) {
  let q = supabase.from("stock_ledger").select("*").order("created_at", { ascending: false }).limit(500);
  if (from) q = q.gte("created_at", from);
  if (to) q = q.lte("created_at", to + "T23:59:59");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const [whMap, itemMap] = await Promise.all([
    lookupMap("warehouses", [...new Set(rows.map((r: any) => r.warehouse_id).filter(Boolean))], "id,name"),
    lookupMap("input_items", [...new Set(rows.map((r: any) => r.input_item_id).filter(Boolean))], "id,name,unit"),
  ]);
  return rows.map((r: any) => ({
    ...cc(r),
    warehouseName: whMap[r.warehouse_id]?.name ?? null,
    itemName: itemMap[r.input_item_id]?.name ?? null,
    unit: itemMap[r.input_item_id]?.unit ?? null,
  }));
}

export async function getDistributionReport(from?: string, to?: string) {
  let q = supabase.from("dispatches").select("*").order("created_at", { ascending: false }).limit(500);
  if (from) q = q.gte("created_at", from);
  if (to) q = q.lte("created_at", to + "T23:59:59");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const [campaignMap, whMap] = await Promise.all([
    lookupMap("campaigns", [...new Set(rows.map((r: any) => r.campaign_id).filter(Boolean))], "id,name"),
    lookupMap("warehouses", [...new Set(rows.map((r: any) => r.warehouse_id).filter(Boolean))], "id,name"),
  ]);
  return rows.map((r: any) => ({
    ...cc(r),
    campaignName: campaignMap[r.campaign_id]?.name ?? null,
    warehouseName: whMap[r.warehouse_id]?.name ?? null,
    completionPct: r.total_packages > 0 ? Math.round((r.delivered_packages / r.total_packages) * 100) : 0,
  }));
}

// ── DISTRIBUTION CONSOLIDATION REPORT ──────────────────────────────────────

export type ConsolidatedDispatch = {
  id: number;
  manifestCode: string;
  status: string;
  campaignName: string;
  campaignCode: string;
  season: string;
  warehouseName: string;
  vehiclePlate: string | null;
  vehicleType: string;
  driverName: string | null;
  notes: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  createdAt: string;
  totalPackages: number;
  deliveredPackages: number;
  completionPct: number;
  items: {
    id: number;
    itemName: string;
    unit: string;
    quantityLoaded: number;
    quantityDelivered: number;
    quantityReturned: number;
  }[];
  pods: {
    id: number;
    podCode: string;
    farmerName: string;
    farmerCode: string;
    gender: string;
    phone: string;
    quantityDelivered: number | null;
    status: string;
    otpStatus: string;
    faceStatus: string;
    gpsStatus: string;
    submittedAt: string | null;
    notes: string | null;
  }[];
  stats: {
    totalLoaded: number;
    totalDelivered: number;
    podCount: number;
    verifiedCount: number;
    pendingCount: number;
    exceptionCount: number;
  };
};

export async function getConsolidatedDistributionReport(opts: {
  from?: string;
  to?: string;
  campaignId?: number;
  status?: string;
}): Promise<ConsolidatedDispatch[]> {
  let q = supabase
    .from("dispatches").select("*")
    .order("created_at", { ascending: false }).limit(200);
  if (opts.from)       q = q.gte("created_at", opts.from) as typeof q;
  if (opts.to)         q = q.lte("created_at", opts.to + "T23:59:59") as typeof q;
  if (opts.campaignId) q = q.eq("campaign_id", opts.campaignId) as typeof q;
  if (opts.status)     q = q.eq("status", opts.status) as typeof q;
  const { data: dRows, error: dErr } = await q;
  if (dErr) throw new Error(dErr.message);
  if (!dRows?.length) return [];

  const dispatchIds  = dRows.map((d: any) => d.id);
  const campaignIds  = [...new Set(dRows.map((d: any) => d.campaign_id).filter(Boolean))] as number[];
  const warehouseIds = [...new Set(dRows.map((d: any) => d.warehouse_id).filter(Boolean))] as number[];
  const vehicleIds   = [...new Set(dRows.map((d: any) => d.vehicle_id).filter(Boolean))] as number[];
  const driverIds    = [...new Set(dRows.map((d: any) => d.driver_id).filter(Boolean))] as number[];

  const [itemsRes, podsRes, campaignMap, whMap] = await Promise.all([
    supabase.from("dispatch_items").select("*").in("dispatch_id", dispatchIds),
    supabase.from("pod").select("*").in("dispatch_id", dispatchIds),
    lookupMap("campaigns",  campaignIds,  "id,name,campaign_code,season"),
    lookupMap("warehouses", warehouseIds, "id,name"),
  ]);

  const vehicleMap: Record<number, any> = vehicleIds.length
    ? await lookupMap("vehicles", vehicleIds, "id,plate_number,vehicle_type")
    : {};
  const driverMap: Record<number, any> = driverIds.length
    ? await lookupMap("drivers", driverIds, "id,full_name")
    : {};

  const allItems = (itemsRes.data ?? []) as any[];
  const allPods  = (podsRes.data  ?? []) as any[];

  const inputItemIds = [...new Set(allItems.map((i: any) => i.input_item_id).filter(Boolean))] as number[];
  const farmerIds    = [...new Set(allPods.map((p: any)  => p.farmer_id).filter(Boolean))]     as number[];

  const [inputItemMap, farmerMap] = await Promise.all([
    inputItemIds.length
      ? lookupMap("input_items", inputItemIds, "id,name,unit")
      : Promise.resolve<Record<number, any>>({}),
    farmerIds.length
      ? lookupMap("farmers", farmerIds, "id,farmer_code,first_name,last_name,gender,phone,beneficiary_type,farmer_group")
      : Promise.resolve<Record<number, any>>({}),
  ]);

  const itemsByDispatch: Record<number, any[]> = {};
  for (const it of allItems) {
    if (!itemsByDispatch[it.dispatch_id]) itemsByDispatch[it.dispatch_id] = [];
    itemsByDispatch[it.dispatch_id].push(it);
  }
  const podsByDispatch: Record<number, any[]> = {};
  for (const p of allPods) {
    const did = p.dispatch_id;
    if (!did) continue;
    if (!podsByDispatch[did]) podsByDispatch[did] = [];
    podsByDispatch[did].push(p);
  }

  return dRows.map((d: any) => {
    const items = (itemsByDispatch[d.id] ?? []).map((it: any) => ({
      id: it.id,
      itemName: inputItemMap[it.input_item_id]?.name ?? "—",
      unit: inputItemMap[it.input_item_id]?.unit ?? "",
      quantityLoaded:    it.quantity_loaded    ?? 0,
      quantityDelivered: it.quantity_delivered ?? 0,
      quantityReturned:  it.quantity_returned  ?? 0,
    }));

    const pods = (podsByDispatch[d.id] ?? []).map((p: any) => {
      const farmer = farmerMap[p.farmer_id];
      return {
        id: p.id,
        podCode: p.pod_code,
        farmerName: farmerDisplayName(farmer),
        farmerCode: farmer?.farmer_code ?? "—",
        gender: farmer?.gender ?? "—",
        phone:  farmer?.phone  ?? "—",
        quantityDelivered: p.quantity_delivered,
        status:     p.status,
        otpStatus:  p.otp_status  ?? "Pending",
        faceStatus: p.face_status ?? "Pending",
        gpsStatus:  p.gps_status  ?? "Pending",
        submittedAt: p.submitted_at,
        notes: p.notes,
      };
    });

    const vehicle = vehicleMap[d.vehicle_id];
    const driver  = driverMap[d.driver_id];

    return {
      id: d.id,
      manifestCode: d.manifest_code,
      status: d.status,
      campaignName: campaignMap[d.campaign_id]?.name         ?? "—",
      campaignCode: campaignMap[d.campaign_id]?.campaign_code ?? "—",
      season:       campaignMap[d.campaign_id]?.season        ?? "—",
      warehouseName: whMap[d.warehouse_id]?.name ?? "—",
      vehiclePlate: d.hired_plate || vehicle?.plate_number || null,
      vehicleType:  d.vehicle_type ?? "—",
      driverName:   d.hired_driver_name || driver?.full_name || null,
      notes: d.notes ?? null,
      departedAt: d.departed_at ?? null,
      arrivedAt:  d.arrived_at  ?? null,
      createdAt:  d.created_at,
      totalPackages:     d.total_packages     ?? 0,
      deliveredPackages: d.delivered_packages ?? 0,
      completionPct: d.total_packages > 0
        ? Math.round((d.delivered_packages / d.total_packages) * 100) : 0,
      items,
      pods,
      stats: {
        totalLoaded:    items.reduce((s: number, i: any) => s + i.quantityLoaded,    0),
        totalDelivered: items.reduce((s: number, i: any) => s + i.quantityDelivered, 0),
        podCount:      pods.length,
        verifiedCount: pods.filter((p: any) => p.status === "Verified").length,
        pendingCount:  pods.filter((p: any) => p.status === "Pending").length,
        exceptionCount:pods.filter((p: any) => p.status === "Exception").length,
      },
    };
  });
}

export async function bulkGenerateOtps(campaignId?: number, expiryHours = 24) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const resp = await fetch(apiUrl("/api/pod/otp/bulk-generate"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ campaignId, expiryHours }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).error ?? `HTTP ${resp.status}`);
  }
  return resp.json() as Promise<{
    count: number;
    expiresAt: string;
    expiryHours: number;
    rows: { farmerId: number; farmerName: string; farmerCode: string; phone: string | null; code: string }[];
  }>;
}

export async function listAllCampaigns() {
  const { data, error } = await supabase
    .from("campaigns").select("id,name,campaign_code,season")
    .order("created_at", { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: r.id as number, name: r.name as string, campaignCode: r.campaign_code as string, season: r.season as string }));
}

// ── AUDIT LOGS ─────────────────────────────────────────────────────────────────────
export type AuditFilters = {
  search?:   string;
  action?:   string;
  module?:   string;
  fromDate?: string;
  toDate?:   string;
};

export async function listAuditLogs(page = 1, limit = 50, filters: AuditFilters = {}) {
  let q = supabase
    .from("audit_logs").select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (filters.search)   q = q.ilike("description", `%${filters.search}%`) as typeof q;
  if (filters.action)   q = q.eq("action", filters.action) as typeof q;
  if (filters.module)   q = q.eq("module", filters.module) as typeof q;
  if (filters.fromDate) q = q.gte("created_at", filters.fromDate) as typeof q;
  if (filters.toDate)   q = q.lte("created_at", filters.toDate + "T23:59:59") as typeof q;
  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { data: cc(data ?? []), total: count ?? 0 };
}

export type AuditStats = {
  totalEvents: number;
  uniqueUsers: number;
  byAction: { action: string; count: number }[];
  byModule: { module: string; count: number }[];
  byUser:   { username: string; count: number }[];
  byDay:    { date: string; count: number }[];
};

export async function getAuditStats(days = 30): Promise<AuditStats> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("action, module, username, created_at")
    .gte("created_at", since);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const byAction: Record<string, number> = {};
  const byModule: Record<string, number> = {};
  const byUser:   Record<string, number> = {};
  const byDay:    Record<string, number> = {};
  const users = new Set<string>();
  for (const r of rows) {
    byAction[r.action] = (byAction[r.action] ?? 0) + 1;
    byModule[r.module] = (byModule[r.module] ?? 0) + 1;
    const u = r.username ?? "System";
    byUser[u] = (byUser[u] ?? 0) + 1;
    users.add(u);
    const day = (r.created_at as string).slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
  }
  // fill gaps in day series so chart has continuity
  const allDays: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    allDays.push({ date: d, count: byDay[d] ?? 0 });
  }
  return {
    totalEvents: rows.length,
    uniqueUsers: users.size,
    byAction: Object.entries(byAction).map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count),
    byModule: Object.entries(byModule).map(([module, count]) => ({ module, count })).sort((a, b) => b.count - a.count),
    byUser:   Object.entries(byUser).map(([username, count]) => ({ username, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    byDay:    allDays,
  };
}

// ── USERS (profiles) ───────────────────────────────────────────────────────────
export async function listUsers() {
  const { data, error } = await supabase
    .from("profiles").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return cc(data ?? []);
}

export async function activateUser(id: string) {
  const token = await userApiToken();
  const resp = await fetch(apiUrl(`/api/users/profile/${id}/activate`), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).error ?? "Failed to activate user");
  }
  return resp.json();
}

export async function deactivateUser(id: string) {
  const token = await userApiToken();
  const resp = await fetch(apiUrl(`/api/users/profile/${id}/deactivate`), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).error ?? "Failed to deactivate user");
  }
  return resp.json();
}

export async function createUser(payload: any) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  const resp = await fetch(apiUrl("/api/users/create-profile"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      email: payload.email,
      password: payload.password,
      fullName: payload.fullName,
      userRole: payload.role,
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).error ?? (err as any).message ?? "Failed to create user");
  }
  return resp.json();
}

export async function updateUserRole(id: string, role: string) {
  const token = await userApiToken();
  const resp = await fetch(apiUrl(`/api/users/profile/${id}/role`), {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).error ?? "Failed to update role");
  }
  return resp.json();
}

export async function updateUserFullName(id: string, fullName: string) {
  const token = await userApiToken();
  const resp = await fetch(apiUrl(`/api/users/profile/${id}/name`), {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fullName }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).error ?? "Failed to update name");
  }
  return resp.json();
}

async function userApiToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  return session.access_token;
}

export async function deleteUser(profileId: string): Promise<void> {
  const token = await userApiToken();
  const resp = await fetch(apiUrl(`/api/users/profile/${profileId}`), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).error ?? "Failed to delete user");
  }
  logAudit("DELETE", "Users", `Deleted user ${profileId}`, "user");
}

export async function resetUserPassword(profileId: string, password: string): Promise<void> {
  const token = await userApiToken();
  const resp = await fetch(apiUrl(`/api/users/profile/${profileId}/reset-password`), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).error ?? "Failed to reset password");
  }
}

// ── MASTER DATA ──────────────────────────────────────────────────────────────────────
// ── shared API token helper for master-data mutations ─────────────────────────────────────
async function mdToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  return session.access_token;
}
async function mdFetch<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = await mdToken();
  const res = await fetch(apiUrl(path), {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).error ?? res.statusText); }
  return res.json();
}

// ── Districts ─────────────────────────────────────────────────────────────────────────
export async function listDistricts() {
  const { data, error } = await supabase.from("districts").select("*").order("name");
  if (error) throw new Error(error.message);
  return cc(data ?? []);
}
export async function createDistrict(payload: { name: string; code: string }) {
  return mdFetch("/api/master-data/districts", { method: "POST", body: JSON.stringify(payload) });
}
export async function updateDistrict(id: number, payload: { name: string; code: string }) {
  return mdFetch(`/api/master-data/districts/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}
export async function deleteDistrict(id: number) {
  return mdFetch(`/api/master-data/districts/${id}`, { method: "DELETE" });
}

// ── Chiefdoms ─────────────────────────────────────────────────────────────────────────
export async function listChiefdoms(districtId?: number) {
  const url = districtId ? `/api/master-data/chiefdoms?districtId=${districtId}` : "/api/master-data/chiefdoms";
  return mdFetch(url, { method: "GET" });
}
export async function createChiefdom(payload: { name: string; districtId: number }) {
  return mdFetch("/api/master-data/chiefdoms", { method: "POST", body: JSON.stringify(payload) });
}
export async function updateChiefdom(id: number, payload: { name: string; districtId: number }) {
  return mdFetch(`/api/master-data/chiefdoms/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}
export async function deleteChiefdom(id: number) {
  return mdFetch(`/api/master-data/chiefdoms/${id}`, { method: "DELETE" });
}

// ── Value Chains ─────────────────────────────────────────────────────────────────────
export async function listValueChains() {
  const { data, error } = await supabase.from("value_chains").select("*").order("name");
  if (error) throw new Error(error.message);
  return cc(data ?? []);
}
export async function createValueChain(payload: any) {
  return mdFetch("/api/master-data/value-chains", { method: "POST", body: JSON.stringify(payload) });
}
export async function updateValueChain(id: number, payload: { name: string; description?: string }) {
  return mdFetch(`/api/master-data/value-chains/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}
export async function toggleValueChain(id: number) {
  return mdFetch(`/api/master-data/value-chains/${id}/toggle`, { method: "PATCH" });
}

// ── Warehouses ──────────────────────────────────────────────────────────────────────
export async function listWarehouses() {
  return mdFetch("/api/master-data/warehouses", { method: "GET" });
}
export async function createWarehouse(payload: any) {
  return mdFetch("/api/master-data/warehouses", { method: "POST", body: JSON.stringify(payload) });
}
export async function updateWarehouse(id: number, payload: any) {
  return mdFetch(`/api/master-data/warehouses/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}
export async function toggleWarehouse(id: number) {
  return mdFetch(`/api/master-data/warehouses/${id}/toggle`, { method: "PATCH" });
}
export async function importWarehouses(rows: any[]) {
  return mdFetch("/api/master-data/warehouses/import", { method: "POST", body: JSON.stringify({ rows }) });
}

// ── Distribution Sites ──────────────────────────────────────────────────────────────────
export async function listDistributionSites() {
  return mdFetch("/api/master-data/distribution-sites", { method: "GET" });
}
export async function createDistributionSite(payload: any) {
  return mdFetch("/api/master-data/distribution-sites", { method: "POST", body: JSON.stringify(payload) });
}
export async function updateDistributionSite(id: number, payload: any) {
  return mdFetch(`/api/master-data/distribution-sites/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}
export async function toggleDistributionSite(id: number) {
  return mdFetch(`/api/master-data/distribution-sites/${id}/toggle`, { method: "PATCH" });
}
export async function importDistributionSites(rows: any[]) {
  return mdFetch("/api/master-data/distribution-sites/import", { method: "POST", body: JSON.stringify({ rows }) });
}

// ── Input Items ─────────────────────────────────────────────────────────────────────
export async function listInputItems() {
  return mdFetch<any[]>("/api/master-data/input-items");
}
export async function createInputItem(payload: any) {
  return mdFetch("/api/master-data/input-items", { method: "POST", body: JSON.stringify(payload) });
}
export async function updateInputItem(id: number, payload: any) {
  return mdFetch(`/api/master-data/input-items/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}
export async function toggleInputItem(id: number) {
  return mdFetch(`/api/master-data/input-items/${id}/toggle`, { method: "PATCH" });
}
export async function deleteInputItem(id: number) {
  return mdFetch(`/api/master-data/input-items/${id}`, { method: "DELETE" });
}

// ── System Settings ────────────────────────────────────────────────────────────────────
export async function listSystemSettings(): Promise<{ key: string; value: string; description: string }[]> {
  return mdFetch("/api/master-data/system-settings", { method: "GET" });
}
export async function saveSystemSettings(updates: Record<string, string>) {
  return mdFetch("/api/master-data/system-settings", { method: "PUT", body: JSON.stringify(updates) });
}

// ── Face / Biometric helpers ──────────────────────────────────────────────────

async function getApiToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export async function getFaceUploadUrl(farmerId: number, purpose: "reference" | "delivery"): Promise<{ uploadUrl: string; key: string; bucket: string }> {
  const token = await getApiToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(apiUrl("/api/face/upload-url"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ farmerId, purpose }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).error ?? "Failed to get upload URL"); }
  return res.json();
}

export async function uploadBlobToS3(uploadUrl: string, blob: Blob): Promise<void> {
  const res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
  if (!res.ok) throw new Error(`S3 upload failed: ${res.status}`);
}

export async function saveFaceReference(farmerId: number, key: string): Promise<void> {
  const token = await getApiToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(apiUrl("/api/face/save-reference"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ farmerId, key }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).error ?? "Failed to save reference"); }
}

export async function getFaceViewUrl(key: string): Promise<string> {
  const token = await getApiToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(apiUrl(`/api/face/view-url?key=${encodeURIComponent(key)}`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).error ?? "Failed to get view URL"); }
  const { url } = await res.json();
  return url;
}

export async function getPhotoUrl(key: string): Promise<string | null> {
  try { return await getFaceViewUrl(key); } catch { return null; }
}

export async function analysePhotoLabels(s3Key: string): Promise<{
  labels: { name: string; confidence: number; isAgri: boolean }[];
  hasAgriContent: boolean;
  topAgriLabels: string[];
  confidence: number | null;
}> {
  const token = await getApiToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(apiUrl("/api/face/analyse-labels"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ s3Key }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).error ?? "Label analysis failed"); }
  return res.json();
}

export async function analyseFarmerFace(s3Key: string, farmerId: number): Promise<{
  ageRangeLow: number | null;
  ageRangeHigh: number | null;
  gender: string | null;
  genderConfidence: number | null;
  smile: boolean | null;
  smileConfidence: number | null;
  eyesOpen: boolean | null;
  primaryEmotion: string | null;
  primaryEmotionConfidence: number | null;
  faceQuality: number | null;
  brightness: number | null;
  sharpness: number | null;
  faceCount: number;
}> {
  const token = await getApiToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(apiUrl("/api/face/analyse-farmer"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ s3Key, farmerId }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).error ?? "Face analysis failed"); }
  return res.json();
}

export interface PublicCardData {
  firstName: string;
  lastName: string;
  farmerCode: string;
  barcodeToken: string;
  gender?: string | null;
  phone?: string | null;
  status?: string | null;
  districtName?: string | null;
  chiefdomName?: string | null;
  valueChainName?: string | null;
  photoUrl?: string | null;
}

export async function getPublicCard(token: string): Promise<PublicCardData> {
  const res = await fetch(apiUrl(`/api/cards/${encodeURIComponent(token)}`));
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error((e as any).error ?? "Card not found");
  }
  return res.json();
}

export async function getAlertCounts(): Promise<{ pendingFarmers: number; pendingPod: number; openIncidents: number }> {
  const [farmers, pod, incidents] = await Promise.all([
    supabase.from("farmers").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("pod").select("*", { count: "exact", head: true }).eq("status", "Pending"),
    supabase.from("incidents").select("*", { count: "exact", head: true }).eq("status", "Open"),
  ]);
  return { pendingFarmers: farmers.count ?? 0, pendingPod: pod.count ?? 0, openIncidents: incidents.count ?? 0 };
}

// ── INCIDENTS ─────────────────────────────────────────────────────────────────────────
export async function listIncidents(page = 1, limit = 50, status?: string) {
  let q = supabase
    .from("incidents")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (status) q = q.eq("status", status);
  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const officerIds = [...new Set(rows.map((r: any) => r.field_officer_id).filter(Boolean))];
  const officerMap: Record<number, any> = {};
  if (officerIds.length) {
    const { data: officers } = await supabase.from("users").select("id,full_name").in("id", officerIds);
    for (const o of (officers ?? [])) officerMap[(o as any).id] = o;
  }
  return {
    data: rows.map((r: any) => ({
      ...cc(r),
      officerName: officerMap[r.field_officer_id]?.full_name ?? r.reported_by ?? "Unknown",
    })),
    total: count ?? 0,
  };
}

export async function resolveIncident(id: number, resolutionNotes?: string) {
  const userId = await intUid();
  const { data, error } = await supabase.from("incidents")
    .update({ status: "Resolved", resolved_by: userId, resolved_at: new Date().toISOString(), resolution_notes: resolutionNotes ?? null })
    .eq("id", id).select().single();
  if (error) throw new Error(error.message);
  await logAudit("UPDATE", "incidents", `Resolved incident #${id}`, "incident", id);
  return cc(data);
}

async function podToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  return session.access_token;
}

export async function approvePod(id: number, forceApprove = false): Promise<{ duplicate?: boolean; existingPod?: any }> {
  const token = await podToken();
  const resp = await fetch(apiUrl(`/api/pod/${id}/approve`), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ forceApprove }),
  });
  if (resp.status === 409) {
    const data = await resp.json().catch(() => ({}));
    if ((data as any).duplicate) return { duplicate: true, existingPod: (data as any).existingPod };
  }
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as any).error ?? "Failed to approve PoD");
  }
  return {};
}

export async function flagPodException(id: number, notes?: string): Promise<void> {
  const token = await podToken();
  const resp = await fetch(apiUrl(`/api/pod/${id}/flag-exception`), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ notes }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as any).error ?? "Failed to flag PoD exception");
  }
}

export async function overrideFacePod(id: number, reason: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not authenticated");
  const resp = await fetch(apiUrl(`/api/pod/${id}/override-face`), {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify({ reason }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as any).error ?? "Failed to override face verification");
  }
}

export async function batchApprovePods(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const token = await podToken();
  const resp = await fetch(apiUrl("/api/pod/batch-approve"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ids }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as any).error ?? "Failed to batch approve PoDs");
  }
}

export async function bulkImportFarmers(payload: {
  rows: Array<{
    firstName?: string; lastName?: string; gender?: string; phone?: string;
    beneficiaryType?: string; farmerGroup?: string; groupSize?: number;
  }>;
  districtId?: number;
  valueChainId?: number;
}): Promise<{ created: number; skipped: number; duplicates: Array<{ row: number; name: string; phone: string; matchedFarmerCode: string }>; farmers: any[] }> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not authenticated");
  const resp = await fetch(apiUrl("/api/farmers/bulk-import"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as any).error ?? "Bulk import failed");
  }
  return resp.json();
}

export async function bulkCheckDuplicates(phones: string[]): Promise<Array<{ phone: string; farmerCode: string; name: string }>> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not authenticated");
  const resp = await fetch(apiUrl("/api/farmers/bulk-check-duplicates"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ phones }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as any).error ?? "Duplicate check failed");
  }
  const json = await resp.json();
  return json.duplicates ?? [];
}
