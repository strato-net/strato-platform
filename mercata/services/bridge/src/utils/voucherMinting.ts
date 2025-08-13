import { config } from "../config";
import { execute } from "./stratoHelper";
import { logInfo, logError } from "./logger";

/**
 * Mint vouchers for a user address
 * @param userAddress - The address to mint vouchers to
 * @param voucherCount - Number of vouchers to mint (default 10)
 * @returns Transaction result
 */
export const mintVouchers = async (userAddress: string, voucherCount: number = 10) => {
  const voucherContractAddress = config.voucher.contractAddress;
  
  if (!voucherContractAddress) {
    throw new Error("Voucher contract address not configured");
  }

  const voucherAmount = (voucherCount * Math.pow(10, 18)).toString();

  try {
    const result = await execute({
      contractName: "Voucher",
      contractAddress: voucherContractAddress,
      method: "mint",
      args: {
        to: userAddress,
        amount: voucherAmount,
      }
    });

    if (result.status === "Success") {
      logInfo('VoucherMinting', `Successfully minted ${voucherCount} vouchers for ${userAddress}, tx: ${result.hash}`);
      return result;
    } else {
      throw new Error(`Voucher minting failed: ${result.status}`);
    }
  } catch (error) {
    throw error; // Let the caller handle logging
  }
};

/**
 * Mint vouchers for multiple users after successful bridge-in operations
 * @param deposits - Array of deposit objects with mercataUser addresses
 */
export const mintVouchersForDeposits = async (deposits: any[]) => {
  logInfo('VoucherMinting', `Minting vouchers for ${deposits.length} successful bridge-in deposits`);

  const mintPromises = deposits.map(async (deposit) => {
    try {
      await mintVouchers(deposit.mercataUser, 10);
    } catch (error) {
      // Don't fail the whole operation for individual voucher minting errors
      logError('VoucherMinting', error as Error, { depositTxHash: deposit.txHash });
    }
  });

  await Promise.allSettled(mintPromises);
  logInfo('VoucherMinting', `Voucher minting completed for all deposits`);
}; 