export interface SourceWithdrawalAuthorization {
  notBefore: string;
  deadline: string;
  signerSetVersion: string;
}

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
