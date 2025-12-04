import { cirrus } from "./api";
import { config } from "../config";
import { logError } from "./logger";
import { getBAUserAddress } from "../auth";

const fetchVoucherBalance = async (): Promise<bigint> => {
  const userAddress = await getBAUserAddress();
  const response = await cirrus.get("/BlockApps-Voucher-_balances", {
    params: {
      key: `eq.${userAddress}`,
      select: "balance:value::text",
    },
  });

  return BigInt(response?.[0]?.balance || "0");
};

const fetchUSDSTBalance = async (): Promise<bigint> => {
  const userAddress = await getBAUserAddress();
  const response = await cirrus.get("/BlockApps-Token-_balances", {
    params: {
      address: `eq.${config.usdst.address}`,
      key: `eq.${userAddress}`,
      select: "balance:value::text",
    },
  });

  return BigInt(response?.[0]?.balance || "0");
};

export const checkBalances = async (): Promise<void> => {
  const [voucherBalance, usdstBalance] = await Promise.all([
    fetchVoucherBalance(),
    fetchUSDSTBalance(),
  ]);

  const voucherTransactions = voucherBalance / config.balance.gasFeeVoucher;
  const usdstTransactions = usdstBalance / config.balance.gasFeeUSDST;
  const totalTransactions = voucherTransactions + usdstTransactions;

  const voucherBalanceUSD = Number(voucherBalance) / 1e18;
  const usdstBalanceUSD = Number(usdstBalance) / 1e18;

  if (totalTransactions < config.balance.minTransactionsThreshold) {
    throw new Error(
      `Total possible transactions (${totalTransactions}) below minimum threshold (${config.balance.minTransactionsThreshold}). Voucher: ${voucherBalanceUSD} (${voucherTransactions} txs), USDST: ${usdstBalanceUSD} (${usdstTransactions} txs)`
    );
  }

  if (totalTransactions < config.balance.warningTransactionsThreshold) {
    logError(
      "BalanceChecker",
      new Error(
        `Balance low: Total possible transactions (${totalTransactions}) below warning threshold (${config.balance.warningTransactionsThreshold}). Voucher: ${voucherBalanceUSD} (${voucherTransactions} txs), USDST: ${usdstBalanceUSD} (${usdstTransactions} txs)`
      )
    );
  }
};
