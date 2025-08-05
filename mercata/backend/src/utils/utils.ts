export function extractContractName(token: string): string {
  const parts = token.split("-");
  return parts.length ? parts[parts.length - 1] : token;
}

export function normalizeAddress(addr: string | undefined | null): string {
  if (typeof addr !== "string" || addr.length === 0) {
    throw new Error("Invalid address input");
  }
  return addr.startsWith("0x") ? addr : "0x" + addr;
}