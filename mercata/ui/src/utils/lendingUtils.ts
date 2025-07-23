import { CollateralData, NewLoanData } from "@/interface";

export const getMaxSafeWithdrawAmount = (
  asset: CollateralData,
  loanData: NewLoanData
): bigint => {
  const ltvBP = BigInt(asset?.ltv ?? "0");
  const priceAssetUSD = BigInt(asset?.assetPrice ?? "0");
  const userCollatAmt = BigInt(asset?.collateralizedAmount ?? "0");
  const totalBorrowingPowerUSD = BigInt(loanData?.totalBorrowingPowerUSD ?? "0");
  const totalAmountOwed = BigInt(loanData?.totalAmountOwed ?? "0");

  if (ltvBP === 0n || priceAssetUSD === 0n) return 0n;

  const availableBorrowingPower = totalBorrowingPowerUSD - totalAmountOwed;
  if (availableBorrowingPower <= 0n) return 0n;

  const withdrawAmtAsset = (availableBorrowingPower * 10n ** 18n * 10000n) / (priceAssetUSD * ltvBP);
  return withdrawAmtAsset < userCollatAmt ? withdrawAmtAsset : userCollatAmt;
}; 