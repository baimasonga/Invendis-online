export const CAMPAIGN_EDITABLE_STATUSES = ["Draft", "Rejected"] as const;
export const CAMPAIGN_DISPATCHABLE_STATUSES = ["Approved", "Active"] as const;

export interface CampaignInput {
  name?: unknown;
  season?: unknown;
  districtId?: unknown;
  valueChainId?: unknown;
  distributionSiteId?: unknown;
  sourceWarehouseId?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  totalFarmers?: unknown;
  notes?: unknown;
}

export function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function validateCampaignInput(input: CampaignInput): string[] {
  const errors: string[] = [];
  if (typeof input.name !== "string" || !input.name.trim())
    errors.push("Campaign name is required.");
  if (typeof input.season !== "string" || !input.season.trim())
    errors.push("Season is required.");
  if (!positiveInteger(input.districtId)) errors.push("District is required.");
  if (!positiveInteger(input.valueChainId))
    errors.push("Value chain is required.");
  if (!positiveInteger(input.distributionSiteId))
    errors.push("Distribution site is required.");
  if (!positiveInteger(input.sourceWarehouseId))
    errors.push("Source warehouse is required.");

  const startMs =
    typeof input.startDate === "string"
      ? Date.parse(input.startDate)
      : Number.NaN;
  const endMs =
    typeof input.endDate === "string" ? Date.parse(input.endDate) : Number.NaN;
  if (!Number.isFinite(startMs)) errors.push("A valid start date is required.");
  if (!Number.isFinite(endMs)) errors.push("A valid end date is required.");
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs < startMs) {
    errors.push("End date cannot be before start date.");
  }
  if (input.totalFarmers != null && input.totalFarmers !== "") {
    const target = Number(input.totalFarmers);
    if (!Number.isInteger(target) || target < 0)
      errors.push("Target farmers must be a whole number of zero or more.");
  }
  return errors;
}

export function canEditCampaign(status: unknown): boolean {
  return CAMPAIGN_EDITABLE_STATUSES.includes(
    String(status) as (typeof CAMPAIGN_EDITABLE_STATUSES)[number],
  );
}

export function canDispatchCampaign(status: unknown): boolean {
  return CAMPAIGN_DISPATCHABLE_STATUSES.includes(
    String(status) as (typeof CAMPAIGN_DISPATCHABLE_STATUSES)[number],
  );
}
