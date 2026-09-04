export type DispatchReadScope =
  | { unrestricted: true }
  | { unrestricted: false; fieldOfficerId?: number; campaignIds?: number[] };

/** Pure policy boundary for dispatch, PoD, and biometric authorization. */
export function isDispatchInScope(
  scope: DispatchReadScope,
  dispatch: { field_officer_id?: number | null; campaign_id?: number | null },
): boolean {
  if (scope.unrestricted) return true;
  if (scope.fieldOfficerId !== undefined) return dispatch.field_officer_id === scope.fieldOfficerId;
  return !!dispatch.campaign_id && (scope.campaignIds ?? []).includes(dispatch.campaign_id);
}

/** Whether a farmer's allocated campaigns intersect the actor's allowed scope. */
export function isFarmerInCampaignScope(
  scope: DispatchReadScope,
  farmerCampaignIds: number[],
  fieldOfficerCampaignIds: number[] = [],
): boolean {
  if (scope.unrestricted) return true;
  const allowedCampaignIds = scope.fieldOfficerId !== undefined
    ? fieldOfficerCampaignIds
    : scope.campaignIds ?? [];
  return farmerCampaignIds.some(id => allowedCampaignIds.includes(id));
}