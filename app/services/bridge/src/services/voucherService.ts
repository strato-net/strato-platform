import { config, STRATO_DECIMALS } from "../config";
import { execute } from "../utils/stratoHelper";
import { logInfo, logError } from "../utils/logger";

export const mintVouchersForDeposits = async (stratoRecipients: string[]) => {
  const voucherContractAddress = config.voucher.contractAddress;
  const voucherCount = config.voucher.mintCount;
  
  const voucherAmount = (voucherCount * Math.pow(10, STRATO_DECIMALS)).toString();

  logInfo("VoucherService", `Minting vouchers for ${stratoRecipients.length} successful bridge-in deposits`);

  try {
    const mintTransactions = stratoRecipients.map((stratoRecipient) => ({
      contractName: "Voucher",
      contractAddress: voucherContractAddress,
      method: "mint",
      args: {
        to: stratoRecipient,
        amount: voucherAmount,
      }
    }));

    const result = await execute(mintTransactions);

    logInfo("VoucherService", `Successfully minted ${voucherCount} vouchers for ${stratoRecipients.length} users, tx: ${result.hash}`);
  } catch (error) {
    logError("VoucherService", error as Error, { 
      stratoRecipientsCount: stratoRecipients.length
    });
  }
};
