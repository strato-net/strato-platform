import { config } from "../config";
import { contractCall } from "./contractCall";

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

  console.log(`🎫 Minting ${voucherCount} vouchers for user: ${userAddress}`);

  try {
    const result = await contractCall(
      "Voucher",
      voucherContractAddress,
      "mint",
      {
        to: userAddress,
        amount: voucherAmount,
      }
    );

    if (result.status === "Success") {
      console.log(`Successfully minted ${voucherCount} vouchers for ${userAddress}, tx: ${result.hash}`);
      return result;
    } else {
      console.error(`Failed to mint vouchers for ${userAddress}:`, result.status);
      throw new Error(`Voucher minting failed: ${result.status}`);
    }
  } catch (error) {
    console.error(`Error minting vouchers for ${userAddress}:`, error);
    throw error;
  }
};

/**
 * Mint vouchers for multiple users after successful bridge-in operations
 * @param deposits - Array of deposit objects with mercataUser addresses
 */
export const mintVouchersForDeposits = async (deposits: any[]) => {
  console.log(`Minting vouchers for ${deposits.length} successful bridge-in deposits`);

  const mintPromises = deposits.map(async (deposit) => {
    try {
      await mintVouchers(deposit.mercataUser, 10);
      console.log(`Vouchers minted for deposit ${deposit.txHash}`);
    } catch (error) {
      console.error(`Failed to mint vouchers for deposit ${deposit.txHash}:`, error);
    }
  });

  await Promise.allSettled(mintPromises);
  console.log(`🎉 Voucher minting completed for all deposits`);
}; 