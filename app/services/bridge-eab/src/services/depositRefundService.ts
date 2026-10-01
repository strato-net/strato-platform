import { withSafeProposalQueue } from "./safeProposalService";
import { Contract, Interface, Wallet, id, verifyTypedData } from "ethers";
import { promises as fs } from "node:fs";
import path from "node:path";
import { OperationType } from "@safe-global/types-kit";
import axios from "axios";
import { config, getNativeBridgePrivateKeys, getDepositConfirmationPolicy, getExternalBridgeExecutorKmsConfig, getExternalBridgeVerifierUrls, getExternalBridgeVerifierApiTokens, VERIFIER_REQUEST_TIMEOUT_MS } from "../config";
import { DEPOSIT_REFUND_ABI, DEPOSIT_REFUND_TYPES, NATIVE_REFUND_ABI, NATIVE_REFUND_TYPES } from "../config/bridgeAbi";
import { DepositRefundAuthorization, NativeDepositInfo, NativeRefundProposal } from "../types";
import { getChainProvider, getTransactionReceiptsBatch, getVerificationBlockNumber } from "./rpcService";
import { getRecordedDepositReviews, getBridgeReviewRecords, getDepositRefundVault, getNativeDepositRefundProposal, getNativeDepositRefundEvidence } from "./cirrusService";
import { recoverDepositObservation } from "./depositEventService";
import { getStratoNetworkId } from "./bridgeService";
import { execute } from "../utils/stratoHelper";
import { safeChecksum, ensureHexPrefix } from "../utils/utils";
import { DigestKmsSigner } from "../utils/kmsSigner";
import { getEventTransactionHash } from "./externalWithdrawalService";
import { requestVerifierQuorum } from "./settlementAttestationService";
import { processingIssueService } from "./processingIssueService";
import { verifierIssues, processingIssue } from "../utils/processingIssues";
import { verifyNativeRedemptionsBatch } from "./nativeVerificationService";

export const recoverNativeDepositRefund = async (d: NativeDepositInfo): Promise<void> => {
  if (Number(d.bridgeStatus) !== 7) throw new Error("Native refund decision is unavailable");
  const verified = await verifyNativeRedemptionsBatch([d]);
  if (verified.get(d.depositId) !== true) throw new Error("Native refund requires verified original burn evidence");
  const chainId = Number(d.externalChainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Invalid native refund chain configuration");
  const provider = getChainProvider(BigInt(chainId));
  const destination = safeChecksum(d.externalBridge);
  const iface = new Interface(NATIVE_REFUND_ABI);
  const bridge = new Contract(destination, NATIVE_REFUND_ABI, provider);
  let hash: string;
  if (await bridge.refundedRedemptions(d.externalRedemptionId)) {
    hash = await getEventTransactionHash(provider, destination, "RedemptionRefunded", String(d.externalRedemptionId), "0", iface);
  } else {
    const block = await provider.getBlock("latest");
    if (!block) throw new Error("Native refund RPC unavailable");
    const validity = BigInt(await bridge.maxAttestationValiditySeconds());
    const deadline = String(BigInt(block.timestamp) + validity);
    const a = { sourceChainId: String(await getStratoNetworkId()), sourceBridge: safeChecksum(config.nativeBridge.address!),
      destinationChainId: String(chainId), destinationBridge: destination, redemptionId: d.externalRedemptionId,
      representationToken: safeChecksum(d.representationToken), recipient: safeChecksum(d.externalSender),
      amount: d.stratoTokenAmount, deadline };
    const domain = { name: "StratoNativeRepresentationBridge", version: "1", chainId, verifyingContract: destination };
    const keys = getNativeBridgePrivateKeys(BigInt(chainId));
    if (!keys.length) throw new Error("Native refund signers are not configured");
    const wallets = keys.map(key => new Wallet(ensureHexPrefix(key.privateKey), provider)).sort((x, y) => x.address.toLowerCase().localeCompare(y.address.toLowerCase()));
    const signatures = await Promise.all(wallets.map(wallet => wallet.signTypedData(domain, NATIVE_REFUND_TYPES, a)));
    const data = iface.encodeFunctionData("refundRedemption", [a, signatures]);
    if (await bridge.hasRole(id("MINT_EXECUTOR_ROLE"), wallets[0].address)) {
      const tx = await wallets[0].sendTransaction({ to: destination, data });
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Error("Native deposit refund failed");
      hash = receipt.hash;
    } else {
      const safe = safeChecksum(config.safe.address!);
      if (!await bridge.hasRole(id("MINT_EXECUTOR_ROLE"), safe)) throw new Error("Native refund Safe is not an authorized mint executor");
      await withSafeProposalQueue(chainId, `refund:${destination}:${d.externalRedemptionId}`, async ({ apiKit, protocolKit }) => {
      const journal = path.join(process.cwd(), "data", "native-refunds", `${chainId}-${destination}-${d.externalRedemptionId}.json`);
      let proposal: NativeRefundProposal | undefined;
      try { proposal = JSON.parse(await fs.readFile(journal, "utf8")); }
      catch (error: any) { if (error.code !== "ENOENT") throw error; }
      let nonce: number | undefined;
      if (proposal) {
        if (!/^0x[0-9a-f]{64}$/i.test(proposal.hash) || !/^\d+$/.test(proposal.deadline) || !Number.isSafeInteger(proposal.nonce) ||
            !proposal.data || proposal.data.to?.toLowerCase() !== destination.toLowerCase() ||
            String(proposal.data.value) !== "0" || Number(proposal.data.operation) !== OperationType.Call ||
            Number(proposal.data.nonce) !== proposal.nonce) throw new Error("Invalid native refund proposal journal");
        const decoded = iface.decodeFunctionData("refundRedemption", proposal.data.data)[0];
        for (const [field, value] of Object.entries({ ...a, deadline: proposal.deadline })) {
          if (String(decoded[field]).toLowerCase() !== String(value).toLowerCase()) throw new Error("Native refund proposal does not match this deposit");
        }
        if (await protocolKit.getTransactionHash({ data: proposal.data } as any) !== proposal.hash) throw new Error("Native refund proposal hash mismatch");
        const currentNonce = Number(await protocolKit.getNonce());
        if (BigInt(proposal.deadline) <= BigInt(block.timestamp) || currentNonce > proposal.nonce) {
          nonce = currentNonce > proposal.nonce ? undefined : proposal.nonce;
          proposal = undefined;
        }
      }
      if (!proposal) {
        nonce ??= Number(await apiKit.getNextNonce(safe));
        const tx = await protocolKit.createTransaction({ transactions: [{ to: destination, value: "0", data, operation: OperationType.Call }], options: { nonce } });
        const safeHash = await protocolKit.getTransactionHash(tx);
        const signature = await protocolKit.signHash(safeHash);
        proposal = { hash: safeHash, nonce, deadline, data: tx.data, signature: signature.data };
        await fs.mkdir(path.dirname(journal), { recursive: true });
        const file = await fs.open(`${journal}.tmp`, "w", 0o600);
        try { await file.writeFile(JSON.stringify(proposal)); await file.sync(); } finally { await file.close(); }
        await fs.rename(`${journal}.tmp`, journal);
      }
      let published = false;
      try { await apiKit.getTransaction(proposal.hash); published = true; }
      catch (error: any) { if (error.status !== 404 && error.response?.status !== 404 && !/not found/i.test(error.message || "")) throw error; }
      if (!published) await apiKit.proposeTransaction({ safeAddress: safe, safeTransactionData: proposal.data, safeTxHash: proposal.hash,
        senderAddress: config.safe.safeProposerAddress!, senderSignature: proposal.signature });
      const recorded = await getNativeDepositRefundProposal(d.depositId);
      if (recorded?.replace(/^0x/i, "").toLowerCase() !== proposal.hash.slice(2).toLowerCase()) {
        await execute({ contractName: "StratoNativeBridge", contractAddress: config.nativeBridge.address!,
          method: "recordDepositRefundProposal", args: { depositId: d.depositId, proposalHash: proposal.hash } });
      }
      });
      return;
    }
  }
  const [receipts, head] = await Promise.all([getTransactionReceiptsBatch(chainId, [hash]), getVerificationBlockNumber(chainId)]);
  const receipt = receipts.get(hash);
  const confirmations = getDepositConfirmationPolicy(chainId);
  if (receipt?.__rpcDisagreement) throw Object.assign(new Error("Native refund RPC disagreement"), {
    issues: [processingIssue("DEPENDENCY_UNAVAILABLE", { transactionHash: hash })],
  });
  if (!receipt || !/^0x[0-9a-f]+$/i.test(receipt.blockNumber || "") ||
      BigInt(receipt.blockNumber) + BigInt(confirmations) > BigInt(head)) throw Object.assign(new Error("Native refund awaiting confirmations"), {
    issues: [processingIssue("CONFIRMATIONS_PENDING", {
      transactionHash: hash, requiredConfirmations: String(confirmations),
      ...(receipt && /^0x[0-9a-f]+$/i.test(receipt.blockNumber || "") ? {
        observedConfirmations: String(BigInt(head) > BigInt(receipt.blockNumber) ? BigInt(head) - BigInt(receipt.blockNumber) : 0n),
      } : {}),
    })],
  });
  if (receipt.status !== "0x1" || receipt.transactionHash?.toLowerCase() !== hash.toLowerCase() ||
      !/^0x[0-9a-f]{64}$/i.test(receipt.blockHash || "") || !receipt.logs.some((log: any) => {
    if (log.removed || safeChecksum(log.address) !== destination) return false;
    try {
      const event = iface.parseLog(log);
      return event?.name === "RedemptionRefunded" && BigInt(event.args.redemptionId) === BigInt(d.externalRedemptionId) &&
        safeChecksum(event.args.representationToken) === safeChecksum(d.representationToken) &&
        safeChecksum(event.args.recipient) === safeChecksum(d.externalSender) && BigInt(event.args.amount) === BigInt(d.stratoTokenAmount);
    } catch { return false; }
  })) throw new Error("Native refund evidence does not match the original redemption");
  const recorded = await getNativeDepositRefundEvidence(d.depositId);
  if (recorded?.replace(/^0x/i, "").toLowerCase() !== hash.replace(/^0x/i, "").toLowerCase()) {
    await execute({ contractName: "StratoNativeBridge", contractAddress: config.nativeBridge.address!,
      method: "recordDepositRefundEvidence", args: { depositId: d.depositId, refundTxHash: hash } });
  }
};

export const recoverExternalDepositRefund = async (chainId: number, router: string, id: string): Promise<void> => {
  const records = await getRecordedDepositReviews(chainId, { depositRouter: router, depositId: id }, "8");
  if (records.length !== 1) throw new Error("Deposit refund decision is unavailable");
  const record = records[0];
  const receipts = await getTransactionReceiptsBatch(chainId, [record.externalTxHash]);
  const observed = recoverDepositObservation(record, receipts.get(record.externalTxHash), true);
  const deposit = { ...observed, stratoToken: observed.targetStratoToken,
    action: "action" in observed ? observed.action : "0", actionToken: "actionToken" in observed ? observed.actionToken : "0x" + "0".repeat(40),
    minFinalOut: "minFinalOut" in observed ? observed.minFinalOut : "0" };
  const provider = getChainProvider(BigInt(chainId));
  const vaultAddress = safeChecksum(await getDepositRefundVault(chainId, router, id));
  const vault = new Contract(vaultAddress, DEPOSIT_REFUND_ABI, provider);
  const [block, version, validity] = await Promise.all([provider.getBlock("latest"), vault.signerSetVersion(), vault.maxAuthorizationValiditySeconds()]);
  if (!block) throw new Error("Refund RPC unavailable");
  const a: DepositRefundAuthorization = {
    sourceChainId: String(await getStratoNetworkId()), sourceBridge: safeChecksum(config.externalAssetBridge.address!),
    destinationChainId: String(chainId), destinationVault: vaultAddress, depositRouter: safeChecksum(router), depositId: id,
    token: safeChecksum(record.externalToken), recipient: safeChecksum(record.externalSender), amount: record.externalTokenAmount,
    deadline: String(BigInt(block.timestamp) + BigInt(validity)), signerSetVersion: String(version),
  };
  const refundId = await vault.depositRefundId(a.depositRouter, id);
  let refundTxHash: string;
  if (await vault.refundedDeposits(refundId)) {
    refundTxHash = await getEventTransactionHash(provider, vaultAddress, "DepositRefunded", refundId, "0", new Interface(DEPOSIT_REFUND_ABI));
  } else {
    const urls = getExternalBridgeVerifierUrls(BigInt(chainId));
    const tokens = getExternalBridgeVerifierApiTokens(BigInt(chainId));
    const threshold = Number(await vault.attestationThreshold());
    if (threshold < 2 || threshold > urls.length || tokens.length !== urls.length) throw new Error("Invalid refund verifier configuration");
    const domain = { name: "ExternalBridgeVault", version: "1", chainId, verifyingContract: vaultAddress };
    const signatures = new Map<string, string>();
    const results = await Promise.allSettled(urls.map(async (url, index) => {
      const { data } = await axios.post(`${url}/v1/sign-deposit-refund`, { authorization: a, deposit }, {
        timeout: VERIFIER_REQUEST_TIMEOUT_MS, headers: { Authorization: `Bearer ${tokens[index]}` },
      });
      const signer = verifyTypedData(domain, DEPOSIT_REFUND_TYPES, a, data.signature).toLowerCase();
      if (!(await vault.attestationSigners(signer))) throw new Error("Unregistered deposit refund signer");
      signatures.set(signer, data.signature);
    }));
    if (signatures.size < threshold) throw Object.assign(new Error("Deposit refund verifier quorum unavailable"), {
      issues: results.flatMap((r, i) => r.status === "rejected" ? verifierIssues(r.reason, i) : []),
    });
    const kms = getExternalBridgeExecutorKmsConfig(BigInt(chainId));
    if (!kms) throw new Error("External refund executor is not configured");
    const signedVault = vault.connect(new DigestKmsSigner(kms, provider)) as Contract;
    const tx = await signedVault.refundDeposit(a, [...signatures].sort(([x], [y]) => x.localeCompare(y)).map(([, signature]) => signature));
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error("External deposit refund failed");
    refundTxHash = receipt.hash;
  }
  await requestVerifierQuorum(chainId, "/v1/attest-deposit-refund", { authorization: a, deposit, refundTxHash });
  await execute({ contractName: "ExternalAssetBridge", contractAddress: config.externalAssetBridge.address!,
    method: "finalizeDepositRefund", args: { externalChainId: chainId, depositRouter: router, depositId: id, refundTxHash } });
};

export const processPendingDepositRefunds = async (): Promise<void> => {
  const records = await getBridgeReviewRecords();
  for (const row of records.deposits.filter(row => Number(row.value.status) === 8)) {
    await processingIssueService.run({ source: "eab", chainId: String(row.key), bridge: config.externalAssetBridge.address!,
      reference: `${row.key2}:${row.key3}`, stage: "deposit-refund", token: row.value.stratoToken }, async () => {
      const chainId = Number(row.key);
      if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Invalid refund chain configuration");
      await recoverExternalDepositRefund(chainId, row.key2!, String(row.key3));
    });
  }
  for (const row of records.nativeDeposits.filter(row => Number(row.value.bridgeStatus) === 7)) {
    const deposit = { ...row.value, depositId: String(row.key) } as NativeDepositInfo;
    await processingIssueService.run({ source: "native", chainId: String(deposit.externalChainId), bridge: config.nativeBridge.address!,
      reference: deposit.depositId, stage: "deposit-refund", token: deposit.stratoToken }, () => recoverNativeDepositRefund(deposit));
  }
};
