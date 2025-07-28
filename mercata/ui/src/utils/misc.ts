import { isAddress } from "ethers";
  
// Calculate health factor color based on value
export const getHealthFactorColor = (healthFactor: number) => {
  if (healthFactor >= 1.5) return "text-green-600";
  if (healthFactor >= 1.2) return "text-yellow-600";
  if (healthFactor >= 1.0) return "text-orange-600";
  return "text-red-600";
};

export const validateRecipientAddress = (
  value: string,
  userAddress: string
): string => {
  const trimmed = value.trim();

  if (!trimmed) return ""; // No error for empty input
  if (!isAddress(trimmed)) return "Invalid address";
  if (trimmed.toLowerCase() === userAddress.toLowerCase())
    return "You cannot transfer to your own address.";

  return ""; // No error
};
