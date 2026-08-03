export const parseMappingRowValue = (value: any): any => {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  return {};
};

export const getMappingRowKeyParts = (key: any): { key1: string; key2: string } => {
  if (key && typeof key === "object") {
    const key1 = String((key as any).key ?? "");
    const key2 = String((key as any).key2 ?? "");
    return { key1, key2 };
  }

  return { key1: String(key ?? ""), key2: "" };
};

// The /mapping key column is a JSON object {key, key2, key3, ...}; return the
// parts as an ordered list.
export const getMappingRowKeyList = (key: any): string[] => {
  if (key && typeof key === "object") {
    const parts: string[] = [];
    for (let i = 1; ; i++) {
      const part = (key as any)[i === 1 ? "key" : `key${i}`];
      if (part === undefined || part === null) break;
      parts.push(String(part));
    }
    return parts;
  }
  const single = String(key ?? "");
  return single.length > 0 ? [single] : [];
};

// Zero values come back from Cirrus in several spellings ("0", or the 40-zero
// placeholder an unset SolidVM slot renders as); treat any all-zero string as
// zero.
export const isZeroCirrusValue = (value: unknown): boolean => {
  const s = String(value ?? "").trim();
  return s === "" || /^0+$/.test(s);
};

export const toBigIntOrZero = (value: any): bigint => {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
};
