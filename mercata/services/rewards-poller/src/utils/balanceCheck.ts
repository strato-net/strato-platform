import { cirrus } from "./api";
import { config } from "../config";
import { logError, logInfo } from "./logger";
import { getBAUserAddress } from "../auth";
import { ProtocolEvent } from "../types";

// ---------------------------------------------------------------------------
// Generic token balance queries
// ---------------------------------------------------------------------------

/** Query BlockApps-Token-_balances with flexible params. */
const queryTokenBalances = async (params: Record<string, string>) =>
  cirrus.get("/BlockApps-Token-_balances", { params });

/** Fetch a BlockApps Token balance from Cirrus for any token + user pair. */
export const fetchTokenBalance = async (
  tokenAddress: string,
  userAddress: string
): Promise<bigint> => {
  const response = await queryTokenBalances({
    address: `eq.${tokenAddress}`,
    key: `eq.${userAddress}`,
    select: "balance:value::text",
  });

  return BigInt(response?.[0]?.balance || "0");
};

// ---------------------------------------------------------------------------
// Community token holder cache
// ---------------------------------------------------------------------------

/** tokenAddress -> Set of holder addresses. Built on startup, refreshed each cycle. */
const communityHolders = new Map<string, Set<string>>();

/** Bulk-fetch all holders for all configured community tokens in one query. */
export const refreshCommunityHolders = async (): Promise<void> => {
  const communities = config.communityBonuses;
  if (communities.length === 0) return;

  try {
    const addresses = communities.map((c) => c.tokenAddress);
    const response = await queryTokenBalances({
      address: `in.(${addresses.join(",")})`,
      value: "gt.0",
      select: "address,key",
    });

    // Reset sets
    for (const addr of addresses) {
      communityHolders.set(addr, new Set());
    }

    // Populate from response
    if (Array.isArray(response)) {
      for (const row of response) {
        communityHolders.get(row.address)?.add(row.key);
      }
    }

    for (const c of communities) {
      logInfo("BalanceCheck", `Community ${c.eventName}: ${communityHolders.get(c.tokenAddress)?.size ?? 0} holders`);
    }
  } catch (e) {
    logError("BalanceCheck", e as Error, { message: "Failed to refresh community holders" });
  }
};

/** Sync check — returns true if user is in the pre-fetched holder set. */
const isHolder = (tokenAddress: string, user: string): boolean =>
  communityHolders.get(tokenAddress)?.has(user) ?? false;

/** Offset per community to ensure unique eventIndex values. */
const EVENT_INDEX_OFFSET = 10_000_000;

/** Given a base event, return bonus events for any communities the user holds. */
export const getCommunityBonuses = (base: ProtocolEvent): ProtocolEvent[] => {
  const communities = config.communityBonuses;
  const bonuses: ProtocolEvent[] = [];
  for (const [ci, community] of communities.entries()) {
    if (isHolder(community.tokenAddress, base.transaction_sender)) {
      bonuses.push({
        ...base,
        address: community.tokenAddress,
        event_name: community.eventName,
        event_index: base.event_index + (ci + 1) * EVENT_INDEX_OFFSET,
      });
    }
  }
  return bonuses;
};

// ---------------------------------------------------------------------------
// Poller gas-fee balance checks
// ---------------------------------------------------------------------------

const fetchVoucherBalance = async (): Promise<bigint> => {
  const userAddress = await getBAUserAddress();
  const response = await cirrus.get("/BlockApps-Voucher-_balances", {
    params: {
      address: `eq.${config.voucher.address}`,
      key: `eq.${userAddress}`,
      select: "balance:value::text",
    },
  });

  return BigInt(response?.[0]?.balance || "0");
};

const fetchUSDSTBalance = async (): Promise<bigint> => {
  const userAddress = await getBAUserAddress();
  return fetchTokenBalance(config.usdst.address, userAddress);
};

/** Verify the poller account has enough USDST + Voucher to keep transacting. */
export const checkBalances = async (): Promise<void> => {
  const [voucherBalance, usdstBalance] = await Promise.all([
    fetchVoucherBalance(),
    fetchUSDSTBalance(),
  ]);

  const voucherTxs = voucherBalance / config.balance.gasFeeVoucher;
  const usdstTxs = usdstBalance / config.balance.gasFeeUSDST;
  const totalTxs = voucherTxs + usdstTxs;

  const voucherUSD = Number(voucherBalance) / 1e18;
  const usdstUSD = Number(usdstBalance) / 1e18;

  const summary =
    `Voucher: ${voucherUSD} (${voucherTxs} txs), ` +
    `USDST: ${usdstUSD} (${usdstTxs} txs)`;

  if (totalTxs <= config.balance.minTransactionsThreshold) {
    throw new Error(
      `Total possible transactions (${totalTxs}) below minimum threshold ` +
        `(${config.balance.minTransactionsThreshold}). ${summary}`
    );
  }

  if (totalTxs < config.balance.warningTransactionsThreshold) {
    logError(
      "BalanceCheck",
      new Error(
        `Balance low: Total possible transactions (${totalTxs}) below warning ` +
          `threshold (${config.balance.warningTransactionsThreshold}). ${summary}`
      )
    );
  }
};
