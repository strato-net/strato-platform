import { cirrus, fetch } from "../../infra/http/api";
import { config } from "../../infra/config/runtimeConfig";
import { logError } from "../../infra/observability/logger";
import { getBAUserAddress } from "../../infra/auth/tokenProvider";
import { retryWithBackoff } from "../../infra/http/retry.policy";

const BALANCE_RETRY_OPTS = { maxAttempts: 3, initialDelay: 5000, maxDelay: 5000 };

const DECIDER_STATE = "0x00000000000000000000000000000000dec1de02";
const GET_IMPL_CONTRACT = "0x56557016"; // getImplContract()
const STRATO_FEE_QUOTE = "0x462d073f"; // stratoFeeQuote() -> (fee, priceVersion, valid)
const ACTIVATION_BLOCK = "0x80faa3d2"; // activationBlock(): legacy USDST fee before it

const rpc = (method: string, params: unknown[]) => retryWithBackoff(
  () => fetch.post<any>(`${config.api.nodeUrl}/rpc`, { jsonrpc: "2.0", id: 1, method, params }),
  `BalanceCheck-${method}`,
  BALANCE_RETRY_OPTS
);

/** Returns the call's ABI words, or null when the contract has no such function. */
const ethCall = async (to: string, data: string): Promise<bigint[] | null> => {
  const res = await rpc("eth_call", [{ to, data }, "latest"]);
  if (res?.error) {
    if (/no function for selector/.test(res.error.message || "")) return null;
    throw new Error(`eth_call ${data} failed: ${res.error.message}`);
  }
  const hex = String(res.result || "").replace(/^0x/, "");
  return (hex.match(/.{64}/g) || []).map((w) => BigInt(`0x${w}`));
};

/** The installed fee router's STRATO charge per call, or null while the router still charges USDST. */
const stratoFee = async (): Promise<{ fee: bigint; valid: boolean } | null> => {
  const impl = await ethCall(DECIDER_STATE, GET_IMPL_CONTRACT);
  if (!impl?.length) return null;
  const router = `0x${impl[0].toString(16).padStart(40, "0")}`;
  const activation = await ethCall(router, ACTIVATION_BLOCK);
  if (activation?.length && activation[0] > BigInt((await rpc("eth_blockNumber", [])).result || "0")) return null;
  const words = await ethCall(router, STRATO_FEE_QUOTE);
  return words && words.length >= 3 ? { fee: words[0], valid: words[2] !== 0n } : null;
};

const balanceOf = async (table: string, contract: string): Promise<bigint> => {
  const userAddress = await getBAUserAddress();
  const response = await retryWithBackoff(
    () => cirrus.get<any[]>(`/${table}`, {
      params: {
        address: `eq.${contract}`,
        key: `eq.${userAddress}`,
        select: "balance:value::text",
      },
    }),
    `BalanceCheck-${table}`,
    BALANCE_RETRY_OPTS
  );

  return BigInt(response?.[0]?.balance || "0");
};

/**
 * Throws when the service account can pay for too few contract calls (vouchers, then
 * STRATO, then USDST buying STRATO) and logs when it is merely running low.
 */
export const checkBalances = async (): Promise<void> => {
  const [quote, voucherBalance, usdstBalance, stratoBalance] = await Promise.all([
    stratoFee(),
    balanceOf("BlockApps-Voucher-_balances", config.voucher.address),
    balanceOf("BlockApps-Token-_balances", config.usdst.address),
    config.strato.tokenAddress ? balanceOf("BlockApps-Token-_balances", config.strato.tokenAddress) : 0n,
  ]);

  // Under the STRATO router USDST buys the missing STRATO at up to twice the call's value.
  const voucherTransactions = voucherBalance / config.balance.gasFeeVoucher;
  const stratoTransactions = quote?.valid && quote.fee > 0n ? stratoBalance / quote.fee : 0n;
  const usdstTransactions = usdstBalance / (quote ? config.balance.gasFeeUSDST * 2n : config.balance.gasFeeUSDST);
  const totalTransactions = voucherTransactions + stratoTransactions + usdstTransactions;

  const stratoBalanceUnits = Number(stratoBalance) / 1e18;
  const usdstBalanceUSD = Number(usdstBalance) / 1e18;
  const detail = `Vouchers: ${voucherTransactions}, STRATO: ${stratoBalanceUnits} (${stratoTransactions} txs), USDST: ${usdstBalanceUSD} (${usdstTransactions} txs)`;

  if (totalTransactions <= config.balance.minTransactionsThreshold) {
    throw new Error(
      `Total possible transactions (${totalTransactions}) below minimum threshold (${config.balance.minTransactionsThreshold}). ${detail}`
    );
  }

  if (totalTransactions < config.balance.warningTransactionsThreshold) {
    logError(
      "BalanceChecker",
      new Error(
        `Balance low: Total possible transactions (${totalTransactions}) below warning threshold (${config.balance.warningTransactionsThreshold}). ${detail}`
      )
    );
  }
};
