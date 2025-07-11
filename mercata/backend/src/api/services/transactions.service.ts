import axios from "axios";

/**
 * Fetches the last 100 transactions from Strato for the given address.
 * @param accessToken The user's access token for authorization.
 * @param address The address to filter transactions for (currently not used for filtering).
 * @returns Array of mapped transaction objects.
 */
export const getTransactions = async (
  accessToken: string,
  address: string
): Promise<
  Array<{
    timestamp: string;
    hash: string;
    from: string;
    to: string;
    type: string;
  }>
> => {
  if (!address) {
    throw new Error("Missing or invalid address");
  }
  const stratoUrl = process.env.NODE_URL;
  if (!stratoUrl) {
    throw new Error("NODE_URL environment variable not set");
  }
  const apiUrl = `${stratoUrl}/strato-api/eth/v1.2/transaction/last/100`;

  // Explicitly set the Authorization header as in the original code
  const response = await axios.get(apiUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  // Defensive: ensure response.data is an array
  const txs = (Array.isArray(response.data) ? response.data : []).map((tx: any) => ({
    timestamp: tx.timestamp || tx.time || tx.blockTimestamp || "",
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    type: tx.type || tx.transactionType || "Unknown",
  }));

  return txs;
};
