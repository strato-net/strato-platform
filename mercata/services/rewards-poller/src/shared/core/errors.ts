const CONTRACT_FAILURE_PATTERNS = [
  "Error running the transaction",
  "solidity",
  "Transaction failed",
  "require failed",
];

export const isContractExecutionFailure = (error: unknown): boolean => {
  const message =
    error instanceof Error
      ? error.message
      : String((error as { message?: unknown } | undefined)?.message ?? error ?? "");

  return CONTRACT_FAILURE_PATTERNS.some((pattern) => message.includes(pattern));
};
