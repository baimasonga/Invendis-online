// Pure allocation-entitlement rules. Deliberately free of any database or
// Supabase import so every decision here can be unit tested directly.

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

/**
 * Allocation statuses that may still receive a delivery. A partially delivered
 * allocation still has something owed, so it must stay eligible for the
 * follow-up that closes it. ("Approved" predates the status constraint and is
 * kept so any legacy row keeps working.)
 */
export const DELIVERABLE_ALLOCATION_STATUSES = [
  "Approved",
  "Pending",
  "Partially Delivered",
] as const;

/** Float slack for comparing fractional quantities such as fertiliser bags. */
export const QUANTITY_EPSILON = 1e-9;

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

/**
 * Decides whether a newly submitted PoD is a duplicate delivery.
 *
 * The old rule was "the beneficiary already has a Verified or Pending PoD on
 * this campaign". Once a short delivery can leave an allocation open, that rule
 * condemns the legitimate follow-up: it would be flagged, and a flagged PoD can
 * never be approved, so the balance could be submitted but never accepted and
 * the allocation would sit Partially Delivered forever.
 *
 * Where entitlements are tracked the database has already ruled on whether this
 * delivery is allowed — the pod trigger refuses one once the package is
 * complete, and the unique index refuses a second open one — so a PoD that got
 * as far as being inserted is legitimate. The old rule stays for allocations
 * with no materialised lines, which predate entitlement tracking.
 */
export function classifyDuplicateDelivery(args: {
  entitlementTracked: boolean;
  hasOtherActivePod: boolean;
}): boolean {
  if (args.entitlementTracked) return false;
  return args.hasOtherActivePod;
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
