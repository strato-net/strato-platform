// What a validator key signs to bind an operator (ValidatorRegistry.operatorAuthorizationDigest).
// The backend recomputes it from live state; `nonce` moves after every consumed consent.
export type AuthorizationDigest = {
  registry: string;
  validator: string;
  operator: string;
  nonce: string;
  digest: string;
};

// The node-side signer. It runs on the validator host with the node's own credentials, asks the
// vault to sign the digest for `operator`, and prints the signature plus a link back here.
export const authorizeOperatorCommand = (operator: string): string => `strato-authorize-operator ${operator}`;

export const isAddressLike = (value: string): boolean => /^(0x)?[0-9a-fA-F]{40}$/.test(value.trim());
export const isSignatureLike = (value: string): boolean => /^0x[0-9a-fA-F]{130}$/.test(value.trim());
export const normalizeAddress = (value: string | null | undefined): string =>
  (value || "").trim().toLowerCase().replace(/^0x/, "");
export const withHexPrefix = (value: string): string => (value.startsWith("0x") ? value : `0x${value}`);

// The backend's error middleware answers `{ error: { message, status, type } }`; some validation
// paths answer `{ error: "text" }`. Never render the object itself.
export const requestErrorMessage = (error: unknown, fallback: string): string => {
  const failure = error as { response?: { data?: { error?: unknown; message?: unknown } }; message?: unknown } | null;
  const data = failure?.response?.data;
  const nested = data?.error as { message?: unknown } | string | undefined;
  const candidates: unknown[] = [
    typeof nested === "object" && nested !== null ? nested.message : nested,
    data?.message,
    failure?.message,
  ];
  const text = candidates.find((value) => typeof value === "string" && value.trim() !== "");
  return typeof text === "string" ? text : fallback;
};
