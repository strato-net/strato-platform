export interface SourceWithdrawalAuthorization {
  notBefore: string;
  deadline: string;
  signerSetVersion: string;
}

export const validateSignerKmsUrl = (
  url: string,
  production: boolean,
): string => {
  if (!production) return url;
  try {
    if (new URL(url).protocol === "https:") return url;
  } catch {
    // Use the same configuration error for malformed and insecure URLs.
  }
  throw new Error("KMS_SIGNER_URL must use HTTPS in production");
};

export const matchesSourceWithdrawalAuthorization = (
  source: Partial<SourceWithdrawalAuthorization> | undefined,
  requested: SourceWithdrawalAuthorization,
): boolean => {
  try {
    return (
      source != null &&
      BigInt(source.notBefore!) === BigInt(requested.notBefore) &&
      BigInt(source.deadline!) === BigInt(requested.deadline) &&
      BigInt(source.signerSetVersion!) === BigInt(requested.signerSetVersion)
    );
  } catch {
    return false;
  }
};
