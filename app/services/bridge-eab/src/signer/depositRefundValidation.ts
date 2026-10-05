import { Contract, Interface, JsonRpcProvider, getAddress } from "ethers";
import { DepositRefundAuthorization } from "../types";
import { DEPOSIT_REFUND_ABI } from "../config/bridgeAbi";
import { DepositSettlementAttestation, validateDepositSettlement } from "./settlementValidation";
import { processingIssue } from "../utils/processingIssues";

const same = (a: string, b: string) => getAddress(`0x${a.replace(/^0x/i, "")}`) === getAddress(`0x${b.replace(/^0x/i, "")}`);

export const validateDepositRefundSource = (
  a: DepositRefundAuthorization, deposit: DepositSettlementAttestation, record: any, refundVault: string,
  sourceChain: bigint, sourceBridge: string, destinationChain: bigint, destinationVault: string,
): void => {
  if (BigInt(a.sourceChainId) !== sourceChain || !same(a.sourceBridge, sourceBridge) ||
      BigInt(a.destinationChainId) !== destinationChain || !same(a.destinationVault, destinationVault) ||
      !same(refundVault, destinationVault) || Number(record?.status) !== 8 ||
      BigInt(deposit.externalChainId) !== destinationChain || !same(a.depositRouter, deposit.depositRouter) ||
      BigInt(a.depositId) !== BigInt(deposit.depositId) || !same(a.recipient, deposit.externalSender) ||
      !same(a.token, deposit.externalToken) || BigInt(a.amount) !== BigInt(deposit.externalTokenAmount) ||
      BigInt(a.amount) <= 0n || !same(record.externalSender, a.recipient) || !same(record.externalToken, a.token) ||
      BigInt(record.externalTokenAmount) !== BigInt(a.amount) || !same(record.stratoRecipient, deposit.stratoRecipient) ||
      !same(record.stratoToken, deposit.stratoToken) ||
      String(record.externalTxHash).toLowerCase().replace(/^0x/, "") !== deposit.externalTxHash.toLowerCase().replace(/^0x/, "")) {
    throw new Error("Deposit refund does not match the irreversible STRATO refund decision");
  }
};

export const validateDepositRefundEvidence = async (
  provider: JsonRpcProvider, a: DepositRefundAuthorization, deposit: DepositSettlementAttestation, confirmations: number,
): Promise<void> => {
  await validateDepositSettlement(provider, deposit, a.destinationVault, [a.depositRouter], confirmations);
  const vault = new Contract(a.destinationVault, DEPOSIT_REFUND_ABI, provider);
  const [version, validity, block] = await Promise.all([vault.signerSetVersion(), vault.maxAuthorizationValiditySeconds(), provider.getBlock("latest")]);
  if (!block || BigInt(a.signerSetVersion) !== BigInt(version) || BigInt(a.deadline) < BigInt(block.timestamp) ||
      BigInt(a.deadline) > BigInt(block.timestamp) + BigInt(validity)) throw new Error("Deposit refund authorization is expired or stale");
};

export const validateDepositRefundCompletion = async (
  provider: JsonRpcProvider, a: DepositRefundAuthorization, hash: string, confirmations: number,
): Promise<void> => {
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error("Invalid deposit refund transaction hash");
  const receipt = await provider.getTransactionReceipt(hash);
  if (!receipt || receipt.status !== 1 || receipt.hash?.toLowerCase() !== hash.toLowerCase() || !/^0x[0-9a-f]{64}$/i.test(receipt.blockHash || "")) throw new Error("Deposit refund receipt is missing or failed");
  const head = await provider.getBlockNumber();
  if (head - receipt.blockNumber < confirmations) throw Object.assign(new Error("Deposit refund awaiting confirmations"), {
    issues: [processingIssue("CONFIRMATIONS_PENDING", { transactionHash: hash,
      observedConfirmations: String(Math.max(0, head - receipt.blockNumber)), requiredConfirmations: String(confirmations) })],
  });
  const vault = new Contract(a.destinationVault, DEPOSIT_REFUND_ABI, provider);
  const refundId = await vault.depositRefundId(a.depositRouter, a.depositId);
  const iface = new Interface(DEPOSIT_REFUND_ABI);
  if (!(await vault.refundedDeposits(refundId)) || !receipt.logs.some(log => {
    if (log.removed || !same(log.address, a.destinationVault)) return false;
    try {
      const event = iface.parseLog(log);
      return event?.name === "DepositRefunded" && event.args.refundId === refundId &&
        same(event.args.depositRouter, a.depositRouter) && BigInt(event.args.depositId) === BigInt(a.depositId) &&
        same(event.args.token, a.token) && same(event.args.recipient, a.recipient) && BigInt(event.args.amount) === BigInt(a.amount);
    } catch { return false; }
  })) throw new Error("Deposit refund event does not match the authorized return of funds");
};
