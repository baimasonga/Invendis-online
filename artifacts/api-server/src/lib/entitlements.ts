import { supa } from "./supabase.js";
import { computeEntitlement, type EntitlementLine } from "./entitlement-rules.js";

// The decision rules live next door, free of any database import, so they can
// be unit tested; re-exported here so callers still need only one module.
export * from "./entitlement-rules.js";

async function inputItemMap(ids: number[]) {
  if (!ids.length) return {} as Record<number, any>;
  const { data } = await supa
    .from("input_items")
    .select("id,name,item_code,unit")
    .in("id", ids);
  return Object.fromEntries((data ?? []).map((row: any) => [row.id, row]));
}

/** Stored entitlement lines for a set of allocations, keyed by allocation id. */
export async function entitlementsByAllocation(
  allocationIds: number[],
): Promise<Record<number, EntitlementLine[]>> {
  const ids = [...new Set(allocationIds.filter(Boolean))];
  if (!ids.length) return {};
  const { data } = await supa
    .from("allocation_items")
    .select(
      "allocation_id,input_item_id,basis,rate,quantity_entitled,quantity_delivered,is_overridden",
    )
    .in("allocation_id", ids);
  const rows = data ?? [];
  const inputs = await inputItemMap(
    rows.map((row: any) => row.input_item_id).filter(Boolean),
  );
  const grouped: Record<number, EntitlementLine[]> = {};
  for (const row of rows as any[]) {
    const input = inputs[row.input_item_id];
    (grouped[row.allocation_id] ??= []).push({
      inputItemId: row.input_item_id,
      name: input?.name ?? null,
      itemCode: input?.item_code ?? null,
      unit: input?.unit ?? null,
      basis: row.basis,
      rate: Number(row.rate),
      quantityEntitled: Number(row.quantity_entitled),
      quantityDelivered: Number(row.quantity_delivered ?? 0),
      isOverridden: Boolean(row.is_overridden),
      provisional: false,
    });
  }
  for (const lines of Object.values(grouped))
    lines.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  return grouped;
}

/**
 * What one beneficiary is owed on a campaign. Prefers the stored lines; a
 * campaign still in Draft has none, so the package rules are applied directly
 * against the beneficiary so the figure quoted to them is never the bare rate.
 */
export async function beneficiaryEntitlement(
  campaignId: number,
  farmerId: number,
): Promise<EntitlementLine[]> {
  const { data: allocation } = await supa
    .from("allocations")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("farmer_id", farmerId)
    .neq("status", "Cancelled")
    .maybeSingle();
  if (allocation) {
    const stored = await entitlementsByAllocation([(allocation as any).id]);
    const lines = stored[(allocation as any).id];
    if (lines?.length) return lines;
  }

  const [{ data: items }, { data: farmer }] = await Promise.all([
    supa
      .from("campaign_items")
      .select("input_item_id,quantity_per_farmer,basis")
      .eq("campaign_id", campaignId),
    supa
      .from("farmers")
      .select("beneficiary_type,group_size,farm_size")
      .eq("id", farmerId)
      .maybeSingle(),
  ]);
  const rows = items ?? [];
  const inputs = await inputItemMap(
    rows.map((row: any) => row.input_item_id).filter(Boolean),
  );
  const f = farmer as any;
  const lines: EntitlementLine[] = [];
  for (const row of rows as any[]) {
    const input = inputs[row.input_item_id];
    const rate = Number(row.quantity_per_farmer ?? 1);
    const basis = row.basis ?? "per_beneficiary";
    const quantity = computeEntitlement(
      basis,
      rate,
      f?.beneficiary_type ?? null,
      f?.group_size ?? null,
      f?.farm_size ?? null,
    );
    if (quantity == null) continue;
    lines.push({
      inputItemId: row.input_item_id,
      name: input?.name ?? null,
      itemCode: input?.item_code ?? null,
      unit: input?.unit ?? null,
      basis,
      rate,
      quantityEntitled: quantity,
      quantityDelivered: 0,
      isOverridden: false,
      provisional: true,
    });
  }
  return lines.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

/** True when the beneficiary's allocation carries materialised entitlement lines. */
export async function hasTrackedEntitlement(
  campaignId: number,
  farmerId: number,
): Promise<boolean> {
  const { data: allocation } = await supa
    .from("allocations")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("farmer_id", farmerId)
    .neq("status", "Cancelled")
    .limit(1)
    .maybeSingle();
  if (!allocation) return false;
  const { count } = await supa
    .from("allocation_items")
    .select("id", { count: "exact", head: true })
    .eq("allocation_id", (allocation as any).id);
  return (count ?? 0) > 0;
}
