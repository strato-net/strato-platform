import { useEffect, useState } from "react";
import { useUser } from "@/context/UserContext";

type Tx = {
  hash: string;
  type: string;
  timestamp: string;
  from?: string;
  to?: string;
};

const fetchTransactions = async (address: string): Promise<Tx[]> => {
  if (!address) return [];
  const res = await fetch(`/api/transactions?address=${address}`);
  if (!res.ok) return [];
  const data = await res.json();
  // TEMP: Log the raw data array for diagnostics
  if (Array.isArray(data) && data.length > 0) {
    // eslint-disable-next-line no-console
    console.log("[HistorySection] Raw data from backend:", data[0]);
  }
  // Map to Tx[]
  return (Array.isArray(data) ? data : []).map((tx: any) => ({
    hash: tx.hash,
    type: tx.type || tx.transactionType || "Unknown",
    timestamp: tx.timestamp || "",
    from: tx.from || "",
    to: tx.to || "",
  }));
};

const HistorySection = () => {
  const { userAddress } = useUser();
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userAddress) return;
    setLoading(true);
    fetchTransactions(userAddress)
      .then((txs) => {
        if (txs.length > 0) {
          // eslint-disable-next-line no-console
          console.log("[HistorySection] First tx from backend:", txs[0]);
        }
        setTxs(txs);
      })
      .finally(() => setLoading(false));
  }, [userAddress]);

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">Transaction History</h2>
      {loading ? (
        <div>Loading...</div>
      ) : (
        <table className="bg-white border border-gray-200">
          <thead>
            <tr>
              <th className="px-2 py-1 border-b border-r text-left">Date/Time</th>
              <th className="px-2 py-1 border-b border-r text-left">Hash</th>
              <th className="px-2 py-1 border-b border-r text-left">From</th>
              <th className="px-2 py-1 border-b border-r text-left">To</th>
              <th className="px-2 py-1 border-b text-left">Type</th>
            </tr>
          </thead>
          <tbody>
            {txs.map((tx) => (
              <tr key={tx.hash}>
                <td className="px-2 py-1 border-b border-r">{new Date(tx.timestamp).toLocaleString()}</td>
                <td className="px-2 py-1 border-b border-r font-mono">
                  {tx.hash && tx.hash.length > 16
                    ? `${tx.hash.slice(0, 8)}...${tx.hash.slice(-8)}`
                    : tx.hash}
                </td>
                <td className="px-2 py-1 border-b border-r font-mono">
                  {tx.from && tx.from.toLowerCase() === userAddress?.toLowerCase() ? (
                    <span className="text-red-600 font-bold">
                      {tx.from.length > 16
                        ? `${tx.from.slice(0, 8)}...${tx.from.slice(-8)}`
                        : tx.from}
                    </span>
                  ) : (
                    tx.from && tx.from.length > 16
                      ? `${tx.from.slice(0, 8)}...${tx.from.slice(-8)}`
                      : tx.from
                  )}
                </td>
                <td className="px-2 py-1 border-b border-r font-mono">
                  {tx.to && tx.to.toLowerCase() === userAddress?.toLowerCase() ? (
                    <span className="text-red-600 font-bold">
                      {tx.to.length > 16
                        ? `${tx.to.slice(0, 8)}...${tx.to.slice(-8)}`
                        : tx.to}
                    </span>
                  ) : (
                    tx.to && tx.to.length > 16
                      ? `${tx.to.slice(0, 8)}...${tx.to.slice(-8)}`
                      : tx.to
                  )}
                </td>
                <td className="px-2 py-1 border-b">{tx.type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(!loading && txs.length === 0) && (
        <div className="mt-4 text-gray-500">No transactions found.</div>
      )}
    </div>
  );
};

export default HistorySection;
