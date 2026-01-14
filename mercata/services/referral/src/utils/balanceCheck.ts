import { cirrus } from "./api";
import { config } from "../config";
import { logError } from "./logger";
import { getBAUserAddress } from "../auth";


// Helper function to fetch Voucher balance
const fetchVoucherBalance = async (): Promise<bigint> => {
  const userAddress = await getBAUserAddress();
  const response = await cirrus.get(
    '/BlockApps-Voucher-_balances',
    {
      params: {
        key: `eq.${userAddress}`,
        select: 'balance:value::text'
      }
    }
  );

  return BigInt(response?.[0]?.balance || '0');
};

// Helper function to fetch USDST balance
const fetchUSDSTBalance = async (): Promise<bigint> => {
  const userAddress = await getBAUserAddress();
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
    if (totalTransactions < config.balance.minTransactionsThreshold) {
      const error = `WARNING: Total possible transactions (${totalTransactions}) below minimum threshold (${config.balance.minTransactionsThreshold}). Voucher: ${voucherBalanceUSD} (${voucherTransactions} txs), USDST: ${usdstBalanceUSD} (${usdstTransactions} txs)`;
      logError('BalanceChecker', new Error(error));
      
      // Exit if critically low (less than 1 transaction possible)
      if (totalTransactions < BigInt(1)) {
        process.exit(1);
      }
    }
  } catch (error) {
    logError('BalanceChecker', error as Error);
  }
};

