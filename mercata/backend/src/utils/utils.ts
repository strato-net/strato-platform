export function extractContractName(token: string): string {
  const parts = token.split("-");
  return parts.length ? parts[parts.length - 1] : token;
}

export const safeBigInt = (val: any) => BigInt(val ?? 0);