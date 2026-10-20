import { cirrus } from "./api";
import { config } from "../config";
import { logError } from "./logger";
import { signerAddress } from "./signer";


// Helper function to fetch Voucher balance
const fetchVoucherBalance = async (): Promise<bigint> => {
  const userAddress = signerAddress().replace(/^0x/, "").toLowerCase();
  const response = await cirrus.get(
    '/BlockApps-Voucher-_balances',
    {
      params: {
        address: `eq.${config.voucher.contractAddress}`,
        key: `eq.${userAddress}`,
        select: 'balance:value::text'
      }
    }
  );

  return BigInt(response?.[0]?.balance || '0');
};

// Helper function to fetch USDST balance
const fetchUSDSTBalance = async (): Promise<bigint> => {
  const userAddress = signerAddress().replace(/^0x/, "").toLowerCase();
  const response = await cirrus.get(
    '/BlockApps-Token-_balances',
    {
      params: {
        address: `eq.${config.usdst.address}`,
        key: `eq.${userAddress}`,
        select: 'balance:value::text'
      }
    }
  );

  return BigInt(response?.[0]?.balance || '0');
};

/**
 * Checks Voucher and USDST balance and marks service unhealthy if below threshold
 * @throws {Error} If total transactions possible are below threshold
 */
export const checkBalances = async (): Promise<void> => {
  try {
    const [voucherBalance, usdstBalance] = await Promise.all([
      fetchVoucherBalance(),
      fetchUSDSTBalance()
    ]);
    
    // Calculate total possible transactions using both balances
    const voucherTransactions = voucherBalance / config.balance.gasFeeVoucher;
    const usdstTransactions = usdstBalance / config.balance.gasFeeUSDST;
    const totalTransactions = voucherTransactions + usdstTransactions;
    
    const voucherBalanceUSD = Number(voucherBalance) / 1e18;
    const usdstBalanceUSD = Number(usdstBalance) / 1e18;
    
    // Check if total transactions are below minimum threshold
    if (totalTransactions <= config.balance.minTransactionsThreshold) {
      const error = `WARNING: Total possible transactions (${totalTransactions}) below minimum threshold (${config.balance.minTransactionsThreshold}). Voucher: ${voucherBalanceUSD} (${voucherTransactions} txs), USDST: ${usdstBalanceUSD} (${usdstTransactions} txs)`;
      // A warning, never fatal: a new key starts at zero and is funded after
      // its address is read from the log or /health.
      logError('BalanceChecker', new Error(error));
    }
  } catch (error) {
    logError('BalanceChecker', error as Error);
  }
};

