import { BackendClient } from "./backendClient";

/**
 * Snapshot of every token balance touched by a single token-sale iteration.
 *
 * Buyer-side balances are read through the backend's authenticated routes
 * (`GET /api/tokens/balance` filters to the calling user automatically).
 * Cross-account balances (MetalForge contract holdings, total-minted) are
 * read directly from Cirrus, which the backend's services also use:
 *   GET /cirrus/search/BlockApps-Token-_balances?address=eq.<tok>&user=eq.<addr>
 */
export interface BalanceSnapshot {
  ts: number;
  // Buyer (the authenticated user)
  buyerPayToken?: string;          // wei
  buyerMetalToken?: string;        // wei
  buyerVoucher?: string;           // raw voucher count (100 vouchers = 0.01 USDST)
  // Counterparties / intermediaries
  metalForgePayToken?: string;     // payToken sitting in the MetalForge contract
  metalForgeMetalToken?: string;   // any metalToken held by MetalForge (typically 0; tokens are minted to user)
  // Aggregate
  metalTotalMinted?: string;       // cumulative mint of `metalToken` across all users (from /metal-forge/configs)
  // Diagnostics
  errors: string[];                // partial-read failures, captured rather than thrown
}

export interface SnapshotTargets {
  payTokenAddress: string;
  metalTokenAddress: string;
  metalForgeAddress: string;
}

/**
 * Read a token balance for an arbitrary STRATO address via Cirrus.
 *
 * Unlike `/api/tokens/balance` (which auth-filters Cirrus to the calling
 * Keycloak user), this query specifies `key=eq.<holder>` directly so it
 * works for the bridge recipient — which may be a different STRATO account
 * than the user driving the load test.
 *
 * Returns:
 *   - `bigint`         the balance (0n if the token row exists but Cirrus has no row for this holder)
 *   - `null`           on HTTP error or unparseable response
 */
export async function readCirrusBalance(
  client: BackendClient,
  tokenAddress: string,
  holderAddress: string,
): Promise<bigint | null> {
  const tok = tokenAddress.replace(/^0x/i, "").toLowerCase();
  const holder = holderAddress.replace(/^0x/i, "").toLowerCase();
  try {
    const res = await client.request("GET", "/cirrus/search/BlockApps-Token-_balances", {
      auth: true,
      query: {
        address: `eq.${tok}`,
        key: `eq.${holder}`,
        select: "value::text",
      },
    });
    if (res.status < 200 || res.status >= 300) return null;
    const rows = res.data ?? [];
    const v = rows[0]?.value;
    if (v === undefined || v === null) return 0n;
    return BigInt(String(v));
  } catch {
    return null;
  }
}

function pickFirstNumeric(rows: any[], field: string): string | undefined {
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const v = rows[0]?.[field];
  if (v === undefined || v === null) return undefined;
  return String(v);
}

/**
 * Read only the AUTH-FILTERED user-side balances (3 GETs):
 *   - buyerPayToken (USDST balance of the calling Keycloak user)
 *   - buyerMetalToken (GOLDST balance of the calling Keycloak user)
 *   - buyerVoucher (voucher gas balance of the calling Keycloak user)
 *
 * Use this when you have N user accounts and want a per-user snapshot —
 * call once per BackendClient, with each client mapped to its user's bearer.
 * Combine with `takeForgeBalanceSnapshot` (called once total) to get the
 * full set of fields without redundantly re-reading the shared forge state.
 *
 * Failures are collected in `snapshot.errors` rather than thrown so a
 * partial snapshot still surfaces in the test output.
 */
export async function takeUserBalanceSnapshot(
  client: BackendClient,
  targets: Pick<SnapshotTargets, "payTokenAddress" | "metalTokenAddress">,
): Promise<BalanceSnapshot> {
  const snap: BalanceSnapshot = { ts: Date.now(), errors: [] };
  const payTok = targets.payTokenAddress.replace(/^0x/i, "");
  const metalTok = targets.metalTokenAddress.replace(/^0x/i, "");

  // Buyer payToken balance (auth-filtered to calling user).
  try {
    const res = await client.request("GET", "/api/tokens/balance", {
      auth: true,
      query: { address: `eq.${payTok}` },
    });
    if (res.status >= 200 && res.status < 300) {
      snap.buyerPayToken = pickFirstNumeric(res.data ?? [], "balance") ?? "0";
    } else {
      snap.errors.push(`buyerPayToken: HTTP ${res.status} ${res.error ?? ""}`);
    }
  } catch (err: any) {
    snap.errors.push(`buyerPayToken: ${err.message}`);
  }

  // Buyer metalToken balance.
  try {
    const res = await client.request("GET", "/api/tokens/balance", {
      auth: true,
      query: { address: `eq.${metalTok}` },
    });
    if (res.status >= 200 && res.status < 300) {
      snap.buyerMetalToken = pickFirstNumeric(res.data ?? [], "balance") ?? "0";
    } else {
      snap.errors.push(`buyerMetalToken: HTTP ${res.status} ${res.error ?? ""}`);
    }
  } catch (err: any) {
    snap.errors.push(`buyerMetalToken: ${err.message}`);
  }

  // Buyer voucher balance (gas-coverage view).
  try {
    const res = await client.request("GET", "/api/vouchers/balance", { auth: true });
    if (res.status >= 200 && res.status < 300) {
      const data = res.data;
      const v =
        typeof data === "string" || typeof data === "number"
          ? data
          : data?.balance ?? data?._balance ?? data?.[0]?._balance;
      if (v !== undefined) snap.buyerVoucher = String(v);
    } else {
      snap.errors.push(`buyerVoucher: HTTP ${res.status} ${res.error ?? ""}`);
    }
  } catch (err: any) {
    snap.errors.push(`buyerVoucher: ${err.message}`);
  }

  return snap;
}

/**
 * Read only the SHARED (non-user-scoped) balances (3 GETs):
 *   - metalForgePayToken (USDST sitting in the MetalForge contract)
 *   - metalForgeMetalToken (GOLDST in MetalForge — typically 0)
 *   - metalTotalMinted (cumulative metalToken mint counter, global)
 *
 * Identical for every Keycloak user, so call once per snapshot pass and
 * reuse the result alongside per-user snapshots from `takeUserBalanceSnapshot`.
 * Any authenticated client works (the Cirrus + /api/metal-forge/configs reads
 * don't filter by user).
 */
export async function takeForgeBalanceSnapshot(
  client: BackendClient,
  targets: SnapshotTargets,
): Promise<BalanceSnapshot> {
  const snap: BalanceSnapshot = { ts: Date.now(), errors: [] };
  const payTok = targets.payTokenAddress.replace(/^0x/i, "");
  const metalTok = targets.metalTokenAddress.replace(/^0x/i, "");
  const forge = targets.metalForgeAddress.replace(/^0x/i, "");

  // MetalForge payToken holdings (direct Cirrus query — the backend's
  // /api/tokens/balance route only returns the authenticated user's row).
  // Cirrus columns: `address` = token contract, `key` = holder address,
  // `value` = balance. Cast value to text so big integers don't overflow.
  try {
    const res = await client.request(
      "GET",
      "/cirrus/search/BlockApps-Token-_balances",
      {
        auth: true,
        query: {
          address: `eq.${payTok}`,
          key: `eq.${forge}`,
          select: "value::text",
        },
      },
    );
    if (res.status >= 200 && res.status < 300) {
      snap.metalForgePayToken = pickFirstNumeric(res.data ?? [], "value") ?? "0";
    } else {
      snap.errors.push(`metalForgePayToken: HTTP ${res.status} ${res.error ?? ""}`);
    }
  } catch (err: any) {
    snap.errors.push(`metalForgePayToken: ${err.message}`);
  }

  // MetalForge metalToken holdings (typically 0 — metals are minted directly
  // to the buyer — but worth tracking to detect protocol changes).
  try {
    const res = await client.request(
      "GET",
      "/cirrus/search/BlockApps-Token-_balances",
      {
        auth: true,
        query: {
          address: `eq.${metalTok}`,
          key: `eq.${forge}`,
          select: "value::text",
        },
      },
    );
    if (res.status >= 200 && res.status < 300) {
      snap.metalForgeMetalToken = pickFirstNumeric(res.data ?? [], "value") ?? "0";
    } else {
      snap.errors.push(`metalForgeMetalToken: HTTP ${res.status} ${res.error ?? ""}`);
    }
  } catch (err: any) {
    snap.errors.push(`metalForgeMetalToken: ${err.message}`);
  }

  // Aggregate metal supply / mint counter (cheaper than scanning Cirrus —
  // the metal-forge configs endpoint surfaces totalMinted per metal).
  try {
    const res = await client.request("GET", "/api/metal-forge/configs", {
      auth: true,
    });
    if (res.status >= 200 && res.status < 300) {
      const metals: any[] = Array.isArray(res.data?.metals) ? res.data.metals : [];
      const match = metals.find(
        (m) => String(m?.address ?? "").replace(/^0x/i, "").toLowerCase() === metalTok.toLowerCase(),
      );
      if (match) snap.metalTotalMinted = String(match.totalMinted ?? "");
    } else {
      snap.errors.push(`metalTotalMinted: HTTP ${res.status} ${res.error ?? ""}`);
    }
  } catch (err: any) {
    snap.errors.push(`metalTotalMinted: ${err.message}`);
  }

  return snap;
}

/**
 * Combined user + forge snapshot. Backwards-compatible single-shot reader
 * (6 GETs sequentially). Prefer the split form (`takeUserBalanceSnapshot`
 * + `takeForgeBalanceSnapshot`) when you want per-user accuracy across N
 * users — that way the 3 forge reads are issued once instead of N times.
 */
export async function takeBalanceSnapshot(
  client: BackendClient,
  targets: SnapshotTargets,
): Promise<BalanceSnapshot> {
  const userSnap = await takeUserBalanceSnapshot(client, targets);
  const forgeSnap = await takeForgeBalanceSnapshot(client, targets);
  return mergeSnapshots(userSnap, forgeSnap);
}

/**
 * Combine a per-user snapshot and a shared forge snapshot into a single
 * BalanceSnapshot view. The latest `ts` wins; errors are concatenated;
 * fields are taken from whichever side populated them.
 */
export function mergeSnapshots(
  user: BalanceSnapshot,
  forge: BalanceSnapshot,
): BalanceSnapshot {
  return {
    ts: Math.max(user.ts, forge.ts),
    buyerPayToken: user.buyerPayToken,
    buyerMetalToken: user.buyerMetalToken,
    buyerVoucher: user.buyerVoucher,
    metalForgePayToken: forge.metalForgePayToken,
    metalForgeMetalToken: forge.metalForgeMetalToken,
    metalTotalMinted: forge.metalTotalMinted,
    errors: [...user.errors, ...forge.errors],
  };
}

/**
 * Sum two per-user balance snapshots field-wise (buyer.* only — the forge.*
 * and metal.totalMinted fields are global and not meaningful to sum across
 * users). Used to compute aggregate spend / receive across the whole pool
 * for the run-summary line.
 */
export function sumUserSnapshots(
  snaps: BalanceSnapshot[],
): { buyerPayToken?: string; buyerMetalToken?: string; buyerVoucher?: string } {
  const sumField = (key: "buyerPayToken" | "buyerMetalToken" | "buyerVoucher"): string | undefined => {
    let acc = 0n;
    let hadValue = false;
    for (const s of snaps) {
      const v = safeBigInt(s[key]);
      if (v !== null) {
        acc += v;
        hadValue = true;
      }
    }
    return hadValue ? acc.toString() : undefined;
  };
  return {
    buyerPayToken: sumField("buyerPayToken"),
    buyerMetalToken: sumField("buyerMetalToken"),
    buyerVoucher: sumField("buyerVoucher"),
  };
}

/* ----------------------------------------------------------------------- */
/* Pretty-printing helpers                                                 */
/* ----------------------------------------------------------------------- */

function safeBigInt(v: string | undefined): bigint | null {
  if (v === undefined || v === null || v === "") return null;
  try {
    // Accept hex or decimal.
    if (/^0x[0-9a-f]+$/i.test(v)) return BigInt(v);
    return BigInt(v);
  } catch {
    return null;
  }
}

function diffStr(beforeS: string | undefined, afterS: string | undefined): string {
  const a = safeBigInt(beforeS);
  const b = safeBigInt(afterS);
  if (a === null || b === null) return "?";
  const d = b - a;
  const sign = d > 0n ? "+" : d < 0n ? "-" : "";
  const abs = d < 0n ? -d : d;
  return `${sign}${abs.toString()}`;
}

/** One-line representation of a snapshot (use for "before" / "after" prints). */
export function formatSnapshot(label: string, s: BalanceSnapshot): string {
  const parts: string[] = [];
  if (s.buyerPayToken !== undefined) parts.push(`buyer.pay=${s.buyerPayToken}`);
  if (s.buyerMetalToken !== undefined) parts.push(`buyer.metal=${s.buyerMetalToken}`);
  if (s.buyerVoucher !== undefined) parts.push(`buyer.voucher=${s.buyerVoucher}`);
  if (s.metalForgePayToken !== undefined) parts.push(`forge.pay=${s.metalForgePayToken}`);
  if (s.metalForgeMetalToken !== undefined) parts.push(`forge.metal=${s.metalForgeMetalToken}`);
  if (s.metalTotalMinted !== undefined) parts.push(`metal.totalMinted=${s.metalTotalMinted}`);
  let trailer = "";
  if (s.errors.length > 0) {
    trailer = ` (errors: ${s.errors.length} — ${s.errors.slice(0, 3).join(" | ")}${
      s.errors.length > 3 ? " ..." : ""
    })`;
  }
  return `${label}: ${parts.join(" ")}${trailer}`;
}

/** Diff between two snapshots, formatted as a one-liner. Fields that are
 *  absent from BOTH `before` and `after` are skipped — so a per-user-only
 *  snapshot prints just `buyer.*` deltas, and a forge-only snapshot prints
 *  just the forge.* + metal.totalMinted deltas. */
export function formatDiff(before: BalanceSnapshot, after: BalanceSnapshot): string {
  const fields: Array<[string, keyof BalanceSnapshot]> = [
    ["buyer.pay", "buyerPayToken"],
    ["buyer.metal", "buyerMetalToken"],
    ["buyer.voucher", "buyerVoucher"],
    ["forge.pay", "metalForgePayToken"],
    ["forge.metal", "metalForgeMetalToken"],
    ["metal.totalMinted", "metalTotalMinted"],
  ];
  const parts: string[] = [];
  for (const [label, key] of fields) {
    const bv = before[key] as string | undefined;
    const av = after[key] as string | undefined;
    if (bv === undefined && av === undefined) continue;
    parts.push(`${label}=${diffStr(bv, av)}`);
  }
  return `Δ: ${parts.join(" ")}`;
}

/** Aggregate diff for a metric record (numeric form, suitable for JSON). */
export function diffObject(
  before: BalanceSnapshot,
  after: BalanceSnapshot,
): Record<string, string> {
  return {
    buyerPayToken: diffStr(before.buyerPayToken, after.buyerPayToken),
    buyerMetalToken: diffStr(before.buyerMetalToken, after.buyerMetalToken),
    buyerVoucher: diffStr(before.buyerVoucher, after.buyerVoucher),
    metalForgePayToken: diffStr(before.metalForgePayToken, after.metalForgePayToken),
    metalForgeMetalToken: diffStr(before.metalForgeMetalToken, after.metalForgeMetalToken),
    metalTotalMinted: diffStr(before.metalTotalMinted, after.metalTotalMinted),
  };
}
