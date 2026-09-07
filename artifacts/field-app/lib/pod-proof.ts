/**
 * Small, platform-independent rules used when a delivery is queued or sent.
 * Keeping these separate from the screen makes proof handling testable without
 * loading Expo or React Native.
 */
export type ProofPayload = {
  otpVerificationToken?: string;
  faceVerificationToken?: string;
};

export function buildVerificationProofPayload(
  otpVerificationToken: string | null,
  faceVerificationToken: string | null,
): ProofPayload {
  return {
    ...(otpVerificationToken ? { otpVerificationToken } : {}),
    ...(faceVerificationToken ? { faceVerificationToken } : {}),
  };
}

export function shouldSaveFirstReference(
  faceStatus: string | undefined,
  deliveryKey: string | null,
  dispatchId: string | undefined,
): boolean {
  return faceStatus === "NoReference" && !!deliveryKey && !!dispatchId;
}

export async function saveFirstReferenceIfNeeded({
  faceStatus,
  deliveryKey,
  dispatchId,
  saveReference,
}: {
  faceStatus: string | undefined;
  deliveryKey: string | null;
  dispatchId: string | undefined;
  saveReference: () => Promise<unknown>;
}): Promise<boolean> {
  if (!shouldSaveFirstReference(faceStatus, deliveryKey, dispatchId)) return false;
  await saveReference();
  return true;
}