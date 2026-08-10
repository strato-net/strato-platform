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

// Struct values with array fields are split across /mapping rows: the row keyed
// by the collection's mapping key(s) holds the scalar fields (with a zero
// placeholder where each array field would be), a row with one extra key part
// holds an array's length, and rows with two extra key parts hold one array
// element each (e.g. activities[24] / activities[24].actionableEvents /
// activities[24].actionableEvents[0]). Given all rows of one collection,
// rebuild each struct with its array fields in place. `keyDepth` is the number
// of mapping keys of the collection.
export const reassembleStructArrayRows = (
  rows: any[],
  keyDepth: number = 1
): Map<string, any> => {
  const structs = new Map<string, any>();
  const arrays = new Map<string, Map<string, { idx: number; value: any }[]>>();

  for (const row of rows ?? []) {
    const parts = getMappingRowKeyList(row.key);
    if (parts.length < keyDepth) continue; // array-length marker of an array-keyed collection
    const mapKey = parts.slice(0, keyDepth).join("\0");

    if (parts.length === keyDepth) {
      structs.set(mapKey, { ...(structs.get(mapKey) ?? {}), ...parseMappingRowValue(row.value) });
    } else if (parts.length === keyDepth + 2) {
      const fieldName = parts[keyDepth];
      const idx = Number(parts[keyDepth + 1]);
      if (!Number.isFinite(idx)) continue;
      let element = row.value;
      if (typeof element === "string") {
        try {
          element = JSON.parse(element);
        } catch {
          // raw scalar element (e.g. an address) — keep as-is
        }
      }
      const fields = arrays.get(mapKey) ?? new Map<string, { idx: number; value: any }[]>();
      const elems = fields.get(fieldName) ?? [];
      elems.push({ idx, value: element });
      fields.set(fieldName, elems);
      arrays.set(mapKey, fields);
    }
    // parts.length === keyDepth + 1 is an array-length row: nothing to extract.
    // Deeper rows (arrays nested inside array elements) are not reassembled.
  }

  for (const [mapKey, fields] of arrays) {
    const struct = structs.get(mapKey) ?? {};
    for (const [fieldName, elems] of fields) {
      struct[fieldName] = elems.sort((a, b) => a.idx - b.idx).map((e) => e.value);
    }
    structs.set(mapKey, struct);
  }

  return structs;
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
