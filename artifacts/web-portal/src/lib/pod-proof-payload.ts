export function buildWebPodProofPayload(otpVerificationToken: string | null): {
  otpVerificationToken?: string;
} {
  return otpVerificationToken ? { otpVerificationToken } : {};
}