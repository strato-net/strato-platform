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

export const toBigIntOrZero = (value: any): bigint => {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
};
