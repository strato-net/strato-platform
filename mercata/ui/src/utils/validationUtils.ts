import { isAddress } from "ethers";

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