import { supa } from "./supabase.js";

export const ALLOCATION_BASES = [
  "per_beneficiary",
  "per_member",
  "per_hectare",
] as const;
export type AllocationBasis = (typeof ALLOCATION_BASES)[number];

export function normaliseBasis(raw: unknown): AllocationBasis | null {
  if (raw === undefined || raw === null || raw === "") return "per_beneficiary";
  const value = String(raw).trim().toLowerCase().replace(/[\s-]/g, "_");
  return (ALLOCATION_BASES as readonly string[]).includes(value)
    ? (value as AllocationBasis)
    : null;
}

export interface EntitlementLine {
  inputItemId: number;
  name: string | null;
  itemCode: string | null;
  unit: string | null;
  basis: string;
  rate: number;
  quantityEntitled: number;
  quantityDelivered: number;
  isOverridden: boolean;
  /** True when derived on the fly because the campaign has no stored lines yet. */
  provisional: boolean;
}

/**
 * Mirrors public.allocation_entitlement. Returns null when the beneficiary is
 * missing the figure the basis depends on, which is the same case the database
 * refuses to reserve stock for.
 */
export function computeEntitlement(
  basis: string,
  rate: number,
  beneficiaryType: string | null,
  groupSize: number | null,
  farmSize: number | null,
): number | null {
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (basis === "per_beneficiary") return rate;
  if (basis === "per_member") {
    const members = beneficiaryType === "group" ? groupSize : 1;
    return members && members > 0 ? rate * members : null;
  }
  if (basis === "per_hectare") {
    return farmSize && farmSize > 0 ? rate * farmSize : null;
  }
  return null;
}

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

/** "Hoe 20 piece, NPK Fertiliser 8 bag" — what the beneficiary is actually owed. */
export function entitlementText(lines: EntitlementLine[]): string {
  return lines
    .filter((line) => line.name)
    .map(
      (line) =>
        `${line.name} ${line.quantityEntitled}${line.unit ? ` ${line.unit}` : ""}`,
    )
    .join(", ");
}
