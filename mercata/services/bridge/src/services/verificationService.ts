import { config, ZERO_ADDRESS, TRANSFER_EVENT_SIGNATURE } from "../config";
import { getTransactionReceipt, getTransactionByHash } from "./rpcService";
import { normalizeAddress, safeToBigInt } from "../utils/utils";

export const verifyDepositTransferEvents = async (deposit: {
  srcChainId: number | string;
  srcTxHash: string;
  token: string;
  amount: string;
}) => {
  const chainId = typeof deposit.srcChainId === "number" 
    ? deposit.srcChainId 
    : Number(deposit.srcChainId);

  if (!Number.isFinite(chainId)) {
    throw new Error(`Invalid chainId: ${deposit.srcChainId}`);
  }

  const receipt = await getTransactionReceipt(chainId, deposit.srcTxHash);
  if (!receipt) {
    throw new Error(`No receipt found for tx ${deposit.srcTxHash} on chain ${deposit.srcChainId}`);
  }

  const ok = receipt.status === 1 ||
    receipt.status === true ||
    (typeof receipt.status === "string" && receipt.status.toLowerCase() === "0x1");

  if (!ok) {
    throw new Error(`Deposit transaction failed: ${deposit.srcTxHash}`);
  }

  const gnosisSafe = normalizeAddress(config?.safe?.address ?? "");
  if (!gnosisSafe) {
    throw new Error("Gnosis Safe address not configured");
  }

  const expectedAmount = safeToBigInt(deposit.amount);
  const normalizedToken = normalizeAddress(deposit.token);
  const isETH = normalizedToken === ZERO_ADDRESS;

  if (isETH) {
    const tx = await getTransactionByHash(chainId, deposit.srcTxHash);
    if (!tx) {
      throw new Error(`No transaction found for tx ${deposit.srcTxHash} on chain ${deposit.srcChainId}`);
    }

    const to = tx.to ? normalizeAddress(tx.to) : "";
    if (to !== gnosisSafe) {
      throw new Error(
        `ETH receiver mismatch for ${deposit.srcTxHash}. Expected: ${gnosisSafe}, Got: ${to || "null"}`
      );
    }

    const value = safeToBigInt(tx.value);
    if (value !== expectedAmount) {
      throw new Error(
        `ETH amount mismatch for ${deposit.srcTxHash}. Expected: ${expectedAmount}, Got: ${value}`
      );
    }
    return;
  }

  const tokenAddr = normalizedToken;
  const sig = TRANSFER_EVENT_SIGNATURE.toLowerCase();

  const decodeTopicAddr = (t: string) => normalizeAddress("0x" + t.slice(-40));
  const parseUint256 = (data: string) => {
    const hex = (data.startsWith("0x") ? data.slice(2) : data)
      .padStart(64, "0")
      .slice(0, 64);
    return BigInt("0x" + hex);
  };

  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
  for (const log of logs) {
    if (!log?.topics || log.topics.length < 3) continue;
    if (typeof log.topics[0] !== "string" || log.topics[0].toLowerCase() !== sig) continue;
    if (normalizeAddress(log.address) !== tokenAddr) continue;

    const to = decodeTopicAddr(log.topics[2]);
    if (to !== gnosisSafe) continue;

    const amount = parseUint256(log.data ?? "0x");
    if (amount !== expectedAmount) {
      throw new Error(
        `ERC20 amount mismatch for ${deposit.srcTxHash}. Expected: ${expectedAmount}, Got: ${amount}`
      );
    }
    return;
  }

  throw new Error(
    `No ERC20 Transfer to Safe ${gnosisSafe} in ${deposit.srcTxHash} for token ${tokenAddr}`
  );
};