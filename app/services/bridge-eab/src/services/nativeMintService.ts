import { ExternalBridgeStatus } from "@strato/shared-types";
import { AbiCoder, keccak256, id } from "ethers";
import { NATIVE_CANCELLATION_ABI } from "../config/bridgeAbi";
import { getChainProvider, getTransactionReceiptsBatch, getVerificationBlockNumber } from "./rpcService";
import { getDepositConfirmationPolicy } from "../config";
import { getEventTransactionHash } from "./externalWithdrawalService";
import { execute, executeAsRelayer } from "../utils/stratoHelper";
import { processingIssue } from "../utils/processingIssues";
import { withSafeProposalQueue } from "./safeProposalService";
import {
  Contract,
  Interface,
  JsonRpcProvider,
  verifyTypedData,
} from "ethers";
import axios from "axios";
import { OperationType } from "@safe-global/types-kit";
import {
  config,
  EXTERNAL_BRIDGE_LOG_BLOCK_RANGE,
  getChainRpcUrl,
  getNativeMintExecutorKmsConfig,
  getNativeVerifierApiTokens,
  getNativeVerifierUrls,
  NATIVE_VERIFIER_REQUEST_TIMEOUT_MS,
} from "../config";
import { NativeWithdrawalInfo } from "../types";
import {
  ensureHexPrefix,
  safeChecksum,
} from "../utils/utils";
import {
  initializeSafeForChain,
} from "../utils/safeHelper";
import { attestNativeCancellation } from "./settlementAttestationService";
import { retry } from "../utils/api";
import { DigestKmsSigner } from "../utils/kmsSigner";
import { NATIVE_MINT_EVENT_ABI } from "../config/bridgeAbi";

export interface NativeMintAttestation {
  sourceChainId: string;
  sourceBridge: string;
  destinationChainId: string;
  destinationBridge: string;
  sourceWithdrawalId: string;
  stratoToken: string;
  representationToken: string;
  recipient: string;
  amount: string;
  notBefore: string;
  deadline: string;
  useInstantPath: boolean;
  signerSetVersion: string;
}

export interface NativeMintRequest extends NativeMintAttestation {
  idempotencyKey: string;
  externalChainId: string;
  representationBridge: string;
  attestation: NativeMintAttestation;
  useInstantPath: boolean;
}

const NATIVE_MINT_ABI = [
  "function mintRepresentationWithAttestationV2((uint256 sourceChainId,address sourceBridge,uint256 destinationChainId,address destinationBridge,uint256 sourceWithdrawalId,address stratoToken,address representationToken,address recipient,uint256 amount,uint256 notBefore,uint256 deadline,bool useInstantPath,uint256 signerSetVersion) attestation, bytes[] signatures)",
  "function maxAttestationValiditySeconds() view returns (uint256)",
  "function attestationThreshold() view returns (uint8)",
  "function attestationSigners(address) view returns (bool)",
  "function signerSetVersion() view returns (uint256)",
  ...NATIVE_MINT_EVENT_ABI,
];

const nativeMintInterface = new Interface(NATIVE_MINT_ABI);

const NATIVE_MINT_ATTESTATION_TYPES = {
  NativeMintAttestationV2: [
    { name: "sourceChainId", type: "uint256" },
    { name: "sourceBridge", type: "address" },
    { name: "destinationChainId", type: "uint256" },
    { name: "destinationBridge", type: "address" },
    { name: "sourceWithdrawalId", type: "uint256" },
    { name: "stratoToken", type: "address" },
    { name: "representationToken", type: "address" },
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "notBefore", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "useInstantPath", type: "bool" },
    { name: "signerSetVersion", type: "uint256" },
  ],
};

const toSafeNumberChainId = (chainId: string): number => {
  const parsed = Number(chainId);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Unsupported destination chain id for Safe API: ${chainId}`);
  }
  return parsed;
};

const attestationDomain = (
  attestation: NativeMintAttestation,
) => ({
  name: "StratoNativeRepresentationBridge",
  version: "1",
  chainId: BigInt(attestation.destinationChainId),
  verifyingContract: safeChecksum(attestation.destinationBridge),
});

const normalizeAttestation = (
  attestation: NativeMintAttestation,
): NativeMintAttestation => ({
    sourceChainId: attestation.sourceChainId.toString(),
    sourceBridge: safeChecksum(attestation.sourceBridge),
    destinationChainId: attestation.destinationChainId.toString(),
    destinationBridge: safeChecksum(attestation.destinationBridge),
    sourceWithdrawalId: attestation.sourceWithdrawalId.toString(),
    stratoToken: safeChecksum(attestation.stratoToken),
    representationToken: safeChecksum(attestation.representationToken),
    recipient: safeChecksum(attestation.recipient),
    amount: attestation.amount.toString(),
    notBefore: attestation.notBefore.toString(),
    deadline: attestation.deadline.toString(),
    useInstantPath: attestation.useInstantPath === true,
    signerSetVersion: attestation.signerSetVersion.toString(),
  });

const getAttestationConfiguration = async (
  destinationChainId: bigint,
  destinationBridgeAddress: string,
): Promise<{ validitySeconds: bigint; signerSetVersion: bigint }> => {
  const provider = new JsonRpcProvider(getChainRpcUrl(destinationChainId));
  const bridge = new Contract(
    safeChecksum(destinationBridgeAddress),
    NATIVE_MINT_ABI,
    provider,
  );
  const [validitySeconds, signerSetVersion] = await Promise.all([
    bridge.maxAttestationValiditySeconds(),
    bridge.signerSetVersion(),
  ]);
  return {
    validitySeconds: BigInt(validitySeconds.toString()),
    signerSetVersion: BigInt(signerSetVersion.toString()),
  };
};

export const buildNativeMintRequest = async (
  withdrawal: NativeWithdrawalInfo,
  sourceChainId: bigint,
  sourceBridgeAddress: string,
  destinationBridgeAddress: string,
): Promise<NativeMintRequest> => {
  const destinationChainId = String(withdrawal.externalChainId);
  const destinationBridge = safeChecksum(destinationBridgeAddress);
  const sourceBridge = safeChecksum(sourceBridgeAddress);
  const notBefore = BigInt(withdrawal.nativeMintNotBefore || 0);
  if (notBefore <= 0n) {
    throw new Error(
      `Native withdrawal ${withdrawal.withdrawalId} is missing nativeMintNotBefore`,
    );
  }
  const { validitySeconds, signerSetVersion } = await getAttestationConfiguration(
    BigInt(destinationChainId),
    destinationBridge,
  );
  if (validitySeconds <= 0n) {
    throw new Error(
      `Native destination bridge ${destinationBridge} has invalid maxAttestationValiditySeconds`,
    );
  }
  const attestation = normalizeAttestation({
    sourceChainId: sourceChainId.toString(),
    sourceBridge,
    destinationChainId,
    destinationBridge,
    sourceWithdrawalId: withdrawal.withdrawalId,
    stratoToken: ensureHexPrefix(withdrawal.stratoToken),
    representationToken: ensureHexPrefix(withdrawal.representationToken),
    recipient: ensureHexPrefix(withdrawal.externalRecipient),
    amount: String(withdrawal.externalTokenAmount),
    notBefore: notBefore.toString(),
    deadline: (notBefore + validitySeconds).toString(),
    useInstantPath: withdrawal.useInstantPath === true,
    signerSetVersion: signerSetVersion.toString(),
  });

  return {
    idempotencyKey: [
      sourceChainId,
      sourceBridge,
      withdrawal.withdrawalId,
    ].join(":"),
    ...attestation,
    externalChainId: destinationChainId,
    representationBridge: destinationBridge,
    attestation,
    useInstantPath: withdrawal.useInstantPath === true,
  };
};

export const signNativeMintAttestation = async (
  attestation: NativeMintAttestation,
): Promise<string[]> => {
  const normalized = normalizeAttestation(attestation);
  const destinationChainId = BigInt(normalized.destinationChainId);
  const urls = getNativeVerifierUrls(destinationChainId);
  const tokens = getNativeVerifierApiTokens(destinationChainId);
  if (urls.length === 0 || urls.length !== tokens.length) {
    throw new Error(
      `Native verifier URLs and API tokens are not configured for chain ${destinationChainId}`,
    );
  }
  const provider = new JsonRpcProvider(getChainRpcUrl(destinationChainId));
  const bridge = new Contract(normalized.destinationBridge, NATIVE_MINT_ABI, provider);
  const threshold = Number(await bridge.attestationThreshold());
  if (!Number.isSafeInteger(threshold) || threshold < 2 || urls.length < threshold) {
    throw new Error("Native verifier count does not satisfy the on-chain threshold");
  }
  const responses = await Promise.allSettled(
    urls.map((url, index) =>
      axios.post(
        `${url}/v1/sign-native-mint`,
        { attestation: normalized },
        {
          headers: { Authorization: `Bearer ${tokens[index]}` },
          timeout: NATIVE_VERIFIER_REQUEST_TIMEOUT_MS,
          maxRedirects: 0,
        },
      ),
    ),
  );
  const signatures: Array<{
    signer: string;
    signature: string;
  }> = [];
  const seen = new Set<string>();
  for (const response of responses) {
    if (response.status !== "fulfilled") continue;
    try {
      const signature = String(response.value.data?.signature || "");
      const claimed = safeChecksum(response.value.data?.attestationSigner);
      const recovered = safeChecksum(
        verifyTypedData(
          attestationDomain(normalized),
          NATIVE_MINT_ATTESTATION_TYPES,
          normalized,
          signature,
        ),
      );
      if (claimed !== recovered || seen.has(recovered.toLowerCase())) continue;
      if (!(await bridge.attestationSigners(recovered))) continue;
      seen.add(recovered.toLowerCase());
      signatures.push({
        signer: recovered.toLowerCase(),
        signature,
      });
    } catch {
      continue;
    }
  }
  if (signatures.length < threshold) {
    throw new Error(
      `Native verifier quorum unavailable: received ${signatures.length}, require ${threshold}`,
    );
  }
  return signatures
    .sort((a, b) => a.signer.localeCompare(b.signer))
    .slice(0, threshold)
    .map(({ signature }) => signature);
};

export const executeNativeMint = async (
  request: NativeMintRequest,
): Promise<string> => {
  const attestation = normalizeAttestation(request.attestation);
  const destinationChainId = BigInt(attestation.destinationChainId);
  const kms = getNativeMintExecutorKmsConfig(destinationChainId);
  if (!kms) {
    throw new Error(
      `CHAIN_${destinationChainId}_NATIVE_MINT_EXECUTOR KMS is not configured`,
    );
  }

  if (!attestation.useInstantPath || !request.useInstantPath) {
    throw new Error("Direct native mint execution requires an instant withdrawal");
  }
  const signatures = await signNativeMintAttestation(attestation);
  const provider = new JsonRpcProvider(
    getChainRpcUrl(destinationChainId),
  );
  const wallet = new DigestKmsSigner(kms, provider);
  const bridge = new Contract(
    attestation.destinationBridge,
    NATIVE_MINT_ABI,
    wallet,
  );
  const tx = await bridge.mintRepresentationWithAttestationV2(
    attestation,
    signatures,
  );
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Native destination mint failed: ${tx.hash}`);
  }

  return receipt.hash;
};

export const getExistingNativeMintTxHash = async (
  withdrawal: NativeWithdrawalInfo, sourceChainId: bigint, sourceBridge: string,
): Promise<string | null> => {
  const attestation = {
    sourceChainId: sourceChainId.toString(), sourceBridge: safeChecksum(sourceBridge),
    destinationChainId: String(withdrawal.externalChainId), destinationBridge: safeChecksum(withdrawal.externalBridge),
    sourceWithdrawalId: withdrawal.withdrawalId, stratoToken: safeChecksum(withdrawal.stratoToken),
    representationToken: safeChecksum(withdrawal.representationToken), recipient: safeChecksum(withdrawal.externalRecipient),
    amount: withdrawal.externalTokenAmount,
  };
  const provider = new JsonRpcProvider(
    getChainRpcUrl(BigInt(attestation.destinationChainId)),
  );
  const topics = nativeMintInterface.encodeFilterTopics(
    "RepresentationMinted",
    [
      null,
      attestation.sourceBridge,
      BigInt(attestation.sourceWithdrawalId),
      attestation.stratoToken,
      null,
      null,
      null,
      null,
    ],
  );
  const latest = await provider.getBlock("latest");
  if (!latest) throw new Error("Latest block unavailable for native mint recovery");
  // Include a clock-skew margin between STRATO and the destination chain.
  const notBefore = BigInt(withdrawal.requestedAt) > 3600n ? BigInt(withdrawal.requestedAt) - 3600n : 0n;
  let lower = 0, upper = latest.number;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    const block = await provider.getBlock(middle);
    if (!block) throw new Error(`Block ${middle} unavailable for native mint recovery`);
    if (BigInt(block.timestamp) < notBefore) lower = middle + 1;
    else upper = middle;
  }
  let toBlock = latest.number;
  let range = EXTERNAL_BRIDGE_LOG_BLOCK_RANGE;
  while (toBlock >= lower) {
    const fromBlock = Math.max(lower, toBlock - range + 1);
    let logs;
    try {
      logs = await provider.getLogs({ address: safeChecksum(attestation.destinationBridge), topics, fromBlock, toBlock });
    } catch (error) {
      if (range === 1) throw error;
      range = Math.max(1, Math.floor(range / 2));
      continue;
    }
    for (const log of logs.reverse()) {
      const parsed = nativeMintInterface.parseLog(log);
      if (!parsed) continue;
      const args = parsed.args;
      if (
        BigInt(args.sourceChainId.toString()) === BigInt(attestation.sourceChainId) &&
        safeChecksum(args.representationToken) === safeChecksum(attestation.representationToken) &&
        safeChecksum(args.recipient) === safeChecksum(attestation.recipient) &&
        BigInt(args.amount.toString()) === BigInt(attestation.amount)
      ) {
        return log.transactionHash;
      }
    }
    toBlock = fromBlock - 1;
  }

  return null;
};

export const proposeNativeMint = async (
  request: NativeMintRequest,
): Promise<string> => {
  const attestation = normalizeAttestation(request.attestation);
  if (attestation.useInstantPath || request.useInstantPath) {
    throw new Error("Safe native mint proposal requires a manual withdrawal");
  }
  const signatures = await signNativeMintAttestation(attestation);
  const chainId = toSafeNumberChainId(attestation.destinationChainId);
  const safeAddress = config.safe.address || "";
  const relayer = config.safe.safeProposerAddress || "";
  return withSafeProposalQueue(chainId, `mint:${request.idempotencyKey}`, async ({ protocolKit, apiKit }, saved) => {
  if (saved) {
    try {
      await apiKit.getTransaction(saved.safeTxHash);
      return saved.safeTxHash;
    }
    catch (error: any) {
      if (error.statusCode !== 404 && error.status !== 404 && error.response?.status !== 404) throw error;
      const savedNonce = Number(saved.safeTransactionData?.nonce);
      const currentNonce = Number(await protocolKit.getNonce());
      if (!Number.isSafeInteger(savedNonce) || savedNonce < 0 ||
          !Number.isSafeInteger(currentNonce) || currentNonce < 0) {
        throw new Error("Invalid persisted or current Safe nonce");
      }
      if (currentNonce <= savedNonce) {
        await apiKit.proposeTransaction(saved);
        return saved.safeTxHash;
      }
    }
  }
  const nonce = Number(await retry(
    () => apiKit.getNextNonce(safeAddress),
    { logPrefix: "NativeMintService" },
  ));
  const safeTransaction = await protocolKit.createTransaction({
    transactions: [
      {
        to: safeChecksum(attestation.destinationBridge),
        value: "0",
        data: nativeMintInterface.encodeFunctionData("mintRepresentationWithAttestationV2", [
          attestation,
          signatures,
        ]),
        operation: OperationType.Call,
      },
    ],
    options: { nonce },
  });
  const safeTxHash = await protocolKit.getTransactionHash(safeTransaction);
  const signature = await protocolKit.signHash(safeTxHash);

  await retry(
    () => apiKit.proposeTransaction({
      safeAddress,
      safeTransactionData: safeTransaction.data,
      safeTxHash,
      senderAddress: relayer,
      senderSignature: signature.data,
    }),
    { logPrefix: "NativeMintService" },
  );

  return safeTxHash;
  });
};

export const getNativeMintProposalExecution = async (
  safeTxHash: string,
  chainId: number | string,
): Promise<{
  status: "executed" | "rejected" | "pending";
  txHash?: string;
}> => {
  const { apiKit } = await initializeSafeForChain(toSafeNumberChainId(String(chainId)));
  const tx = await retry(
    () => apiKit.getTransaction(ensureHexPrefix(safeTxHash)),
    { logPrefix: "NativeMintService" },
  );

  if (tx.isExecuted && tx.isSuccessful) {
    const txHash = (tx as any).transactionHash;
    return txHash
      ? { status: "executed", txHash }
      : { status: "pending" };
  }
  if (tx.isExecuted && !tx.isSuccessful) {
    return { status: "rejected" };
  }

  const safeAddress = (tx as any).safe || config.safe.address || "";
  const allTxs = await retry(
    () => apiKit.getMultisigTransactions(safeAddress, {
      nonce: tx.nonce,
    } as any),
    { logPrefix: "NativeMintService" },
  );
  const conflictingExecution = (allTxs as any)?.results?.find(
    (candidate: any) =>
      candidate?.nonce === tx.nonce &&
      candidate?.isExecuted &&
      candidate?.safeTxHash !== tx.safeTxHash,
  );

  if (conflictingExecution) {
    return { status: "rejected" };
  }

  return { status: "pending" };
};

export const processNativeMintCancellation = async (w: NativeWithdrawalInfo, sourceChainId: string): Promise<void> => {
  if (String(w.bridgeStatus) !== String(ExternalBridgeStatus.CANCELLATION_PENDING)) throw new Error("Native withdrawal cancellation is not requested");
  const chainId = toSafeNumberChainId(String(w.externalChainId));
  const destination = safeChecksum(w.externalBridge);
  const source = safeChecksum(config.nativeBridge.address!);
  const provider = getChainProvider(BigInt(chainId));
  const iface = new Interface(NATIVE_CANCELLATION_ABI);
  const bridge = new Contract(destination, NATIVE_CANCELLATION_ABI, provider);
  const mintId = keccak256(AbiCoder.defaultAbiCoder().encode(["uint256", "address", "uint256"], [sourceChainId, source, w.withdrawalId]));
  if (!await bridge.canceledMints(mintId)) {
    if (await bridge.processedMints(mintId)) throw new Error("Native mint already executed; finalize the withdrawal instead of refunding");
    const safe = safeChecksum(config.safe.address!);
    if (!await bridge.hasRole(id("MINT_CANCELLER_ROLE"), safe)) throw new Error("Native cancellation requires the configured Safe to hold MINT_CANCELLER_ROLE");
    const proposalHash = await withSafeProposalQueue(chainId, `cancel-mint:${destination}:${mintId}`, async ({ apiKit, protocolKit }, saved) => {
      const currentNonce = Number(await protocolKit.getNonce());
      if (saved && (saved.safeTransactionData.to.toLowerCase() !== destination.toLowerCase() ||
          saved.safeTransactionData.data !== iface.encodeFunctionData("cancelMint", [sourceChainId, source, w.withdrawalId]) ||
          String(saved.safeTransactionData.value) !== "0" || Number(saved.safeTransactionData.operation) !== OperationType.Call)) {
        throw new Error("Persisted native cancellation proposal does not match the withdrawal");
      }
      if (saved && currentNonce <= saved.safeTransactionData.nonce) {
        try { await apiKit.getTransaction(saved.safeTxHash); }
        catch (error: any) {
          if (error.statusCode !== 404 && error.status !== 404 && error.response?.status !== 404) throw error;
          await apiKit.proposeTransaction(saved);
        }
        return saved.safeTxHash;
      }
      const nonce = Number(await apiKit.getNextNonce(safe));
      const tx = await protocolKit.createTransaction({ transactions: [{ to: destination, value: "0",
        data: iface.encodeFunctionData("cancelMint", [sourceChainId, source, w.withdrawalId]), operation: OperationType.Call }], options: { nonce } });
      const safeTxHash = await protocolKit.getTransactionHash(tx);
      const signature = await protocolKit.signHash(safeTxHash);
      await apiKit.proposeTransaction({ safeAddress: safe, safeTransactionData: tx.data, safeTxHash,
        senderAddress: config.safe.safeProposerAddress!, senderSignature: signature.data });
      return safeTxHash;
    });
    if (w.cancellationProposalHash?.replace(/^0x/i, "").toLowerCase() !== proposalHash.slice(2).toLowerCase()) {
      await execute({ contractName: "StratoNativeBridge", contractAddress: config.nativeBridge.address!,
        method: "recordWithdrawalCancellationProposal", args: { id: w.withdrawalId, proposalHash } });
    }
    return;
  }
  const hash = await getEventTransactionHash(provider, destination, "NativeMintCanceled", mintId, w.requestedAt, iface);
  const [receipts, head] = await Promise.all([getTransactionReceiptsBatch(chainId, [hash]), getVerificationBlockNumber(chainId)]);
  const receipt = receipts.get(hash);
  if (receipt?.__rpcDisagreement) throw new Error("Native cancellation RPC disagreement");
  const requiredConfirmations = getDepositConfirmationPolicy(chainId);
  if (!receipt || !/^0x[0-9a-f]+$/i.test(receipt.blockNumber || "") ||
      BigInt(receipt.blockNumber) + BigInt(requiredConfirmations) > BigInt(head)) {
    throw Object.assign(new Error("Native cancellation awaits confirmations"), { issues: [processingIssue("CONFIRMATIONS_PENDING", { transactionHash: hash, requiredConfirmations: String(requiredConfirmations),
      ...(receipt && /^0x[0-9a-f]+$/i.test(receipt.blockNumber || "") ? { observedConfirmations: String(BigInt(head) > BigInt(receipt.blockNumber) ? BigInt(head) - BigInt(receipt.blockNumber) : 0n) } : {}),
    })] });
  }
  if (receipt.status !== "0x1" || receipt.transactionHash?.toLowerCase() !== hash.toLowerCase() ||
      !/^0x[0-9a-f]{64}$/i.test(receipt.blockHash || "") || !receipt.logs.some((log: any) => {
        if (log.removed || safeChecksum(log.address) !== destination) return false;
        try {
          const event = iface.parseLog(log);
          return event?.name === "NativeMintCanceled" && event.args.mintId === mintId &&
            String(event.args.sourceChainId) === sourceChainId && safeChecksum(event.args.sourceBridge) === source &&
            String(event.args.sourceWithdrawalId) === w.withdrawalId;
        } catch { return false; }
      })) throw new Error("Native mint cancellation evidence mismatch");
  if (w.cancellationTxHash?.replace(/^0x/i, "").toLowerCase() !== hash.replace(/^0x/i, "").toLowerCase()) {
    await execute({ contractName: "StratoNativeBridge", contractAddress: config.nativeBridge.address!,
      method: "recordWithdrawalCancellationEvidence", args: { id: w.withdrawalId, txHash: hash } });
    return;
  }
  await attestNativeCancellation(w, hash);
  await executeAsRelayer({
    contractName: "StratoNativeBridge",
    contractAddress: config.nativeBridge.address!,
    method: "refundCanceledWithdrawal",
    args: { id: w.withdrawalId, cancellationTxHash: hash },
  });
};
