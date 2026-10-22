import axios from "axios";
import { FeeQuote } from "@strato/shared-types";
import { constants } from "../../config/constants";
import { nodeUrl } from "../../config/config";
import { cirrus } from "../../utils/appApiHelper";

const DECIDER_STATE = "0x00000000000000000000000000000000dec1de02";
const GET_IMPL_CONTRACT = "0x56557016"; // getImplContract()
const STRATO_FEE_QUOTE = "0x462d073f"; // stratoFeeQuote() -> (fee, priceVersion, valid)
const USD_FEE_WEI = 10n ** 16n; // 0.01 USDST, what every call is worth
const VOUCHER_WEI = 10n ** 18n; // one whole voucher
// The router buys a STRATO shortfall with the signer's USDST at up to twice the
// call's value (FeeRouter._maxSwapPremiumBps = 10000); anything dearer is rejected.
const USDST_FALLBACK_MAX_WEI = 2n * USD_FEE_WEI;

/** Returns the call's ABI words, or null when the contract has no such function. */
const ethCall = async (to: string, data: string): Promise<bigint[] | null> => {
  const { data: res } = await axios.post(
    `${nodeUrl}/rpc`,
    { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] },
    { timeout: 10_000 }
  );
  if (res?.error) {
    if (/no function for selector/.test(res.error.message || "")) return null;
    throw new Error(`eth_call ${data} failed: ${res.error.message}`);
  }
  const hex = String(res.result || "").replace(/^0x/, "");
  return (hex.match(/.{64}/g) || []).map((w) => BigInt(`0x${w}`));
};

const balanceOf = async (accessToken: string, table: string, contract: string, user: string): Promise<bigint> => {
  const { data } = await cirrus.get(accessToken, `/${table}`, {
    params: { address: `eq.${contract}`, key: `eq.${user}`, select: "value::text" },
  });
  return BigInt(data?.[0]?.value ?? "0");
};

/** The installed fee router's STRATO quote, or null while the router still charges USDST. */
const stratoQuote = async (): Promise<{ fee: bigint; version: bigint; valid: boolean } | null> => {
  const impl = await ethCall(DECIDER_STATE, GET_IMPL_CONTRACT);
  if (!impl?.length) return null;
  const words = await ethCall(`0x${impl[0].toString(16).padStart(40, "0")}`, STRATO_FEE_QUOTE);
  if (!words || words.length < 3) return null;
  return { fee: words[0], version: words[1], valid: words[2] !== 0n };
};

export const getFeeQuote = async (accessToken: string, userAddress: string): Promise<FeeQuote> => {
  const quote = await stratoQuote();
  const currency = quote ? "STRATO" : "USDST";
  const currencyAddress = quote ? constants.stratoToken : constants.USDST;
  const [vouchers, balance, usdst] = await Promise.all([
    balanceOf(accessToken, `${constants.Voucher}-_balances`, constants.voucher, userAddress),
    balanceOf(accessToken, `${constants.Token}-_balances`, currencyAddress, userAddress),
    balanceOf(accessToken, `${constants.Token}-_balances`, constants.USDST, userAddress),
  ]);
  return {
    currency,
    currencyAddress,
    feeWei: (quote ? quote.fee : USD_FEE_WEI).toString(),
    usdFeeWei: USD_FEE_WEI.toString(),
    priceVersion: (quote ? quote.version : 0n).toString(),
    valid: quote ? quote.valid : true,
    vouchers: (vouchers / VOUCHER_WEI).toString(),
    balanceWei: balance.toString(),
    ...(quote && {
      fallback: { address: constants.USDST, maxWei: USDST_FALLBACK_MAX_WEI.toString(), balanceWei: usdst.toString() },
    }),
  };
};

/** Throws when `calls` contract calls cannot be paid for from vouchers, the fee currency and the USDST fallback. */
export const ensureFeeCoverage = async (calls: number, accessToken: string, userAddress: string): Promise<void> => {
  if (calls <= 0) return;
  const quote = await getFeeQuote(accessToken, userAddress);
  const uncovered = BigInt(calls) - BigInt(quote.vouchers);
  if (uncovered <= 0n) return;
  if (!quote.valid) throw new Error("Network fee price unavailable: only vouchers can pay right now");
  const feeWei = BigInt(quote.feeWei);
  const short = feeWei * uncovered - BigInt(quote.balanceWei);
  if (short <= 0n) return;
  if (!quote.fallback) throw new Error(`Insufficient ${quote.currency} for network fees`);
  // What the router may spend buying the missing STRATO, rounded up like it does.
  const usdstNeeded = (short * BigInt(quote.fallback.maxWei) + feeWei - 1n) / feeWei;
  if (usdstNeeded > BigInt(quote.fallback.balanceWei)) {
    throw new Error(`Insufficient ${quote.currency} and USDST for network fees`);
  }
};
