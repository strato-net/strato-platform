export const normalizeTxStatus = (status?: string | null): string =>
  (status || "").toLowerCase();

export const isTxSubmitted = (status?: string | null): boolean => {
  const normalized = normalizeTxStatus(status);
  return normalized === "success" || normalized === "pending";
};

export const isTxPending = (status?: string | null): boolean =>
  normalizeTxStatus(status) === "pending";
