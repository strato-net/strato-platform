import { MAX_UINT256 } from "../../config/constants";
import { VaultDepositState } from "../../types/types";

export const previewVaultDeposit = (amount: bigint, state: VaultDepositState): bigint => {
  const supply = BigInt(state.totalShares);
  const assets = BigInt(state.pricingAssets);
  const maximum = BigInt(state.maxDeposit);
  if (amount <= 0n || amount > MAX_UINT256 || amount > maximum) {
    throw new Error("Vault deposit exceeds executable limits");
  }
  if (supply < 0n || assets < 0n || supply > MAX_UINT256 || assets > MAX_UINT256) {
    throw new Error("Invalid vault accounting state");
  }
  if (supply === 0n) return amount;
  if (assets === 0n) throw new Error("Vault is insolvent");
  const product = amount * supply;
  if (product > MAX_UINT256) throw new Error("Vault share calculation overflows uint256");
  const shares = product / assets;
  if (shares === 0n) throw new Error("Vault deposit would mint zero shares");
  return shares;
};
