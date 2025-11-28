export function extractContractName(token: string): string {
  const parts = token.split("-");
  return parts.length ? parts[parts.length - 1] : token;
}

export function ensureHexPrefix(address: string): string {
  if (!address) return address;
  return address.startsWith('0x') ? address : `0x${address}`;
}

export const ensure = (ok: boolean, msg: string) => {
  if (!ok) throw new Error(msg);
};