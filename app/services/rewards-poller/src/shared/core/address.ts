export const normalizeAddressNoPrefix = (address: string): string =>
  address.toLowerCase().replace(/^0x/, "");
