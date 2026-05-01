import {
  Contract,
  Interface,
  JsonRpcProvider,
  Signature,
  Wallet,
} from "ethers";
import { OperationType } from "@safe-global/types-kit";
import {
  config,
  getChainRpcUrl,
  getNativeBridgePrivateKeys,
} from "../config";
import { NativeWithdrawalInfo } from "../types";
import {
  ensureHexPrefix,
  safeChecksum,
} from "../utils/utils";
import {
  initializeSafeForChain,
} from "../utils/safeHelper";
import { retry } from "../utils/api";

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
}

export interface NativeMintRequest extends NativeMintAttestation {
  idempotencyKey: string;
  externalChainId: string;
  representationBridge: string;
  attestation: NativeMintAttestation;
}

const NATIVE_MINT_ABI = [
  "function mintRepresentationWithAttestation((uint256 sourceChainId,address sourceBridge,uint256 destinationChainId,address destinationBridge,uint256 sourceWithdrawalId,address stratoToken,address representationToken,address recipient,uint256 amount,uint256 notBefore,uint256 deadline) attestation, bytes[] signatures)",
  "function maxAttestationValiditySeconds() view returns (uint256)",
];

const nativeMintInterface = new Interface(NATIVE_MINT_ABI);

const NATIVE_MINT_ATTESTATION_TYPES = {
  NativeMintAttestation: [
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
  ],
};

const normalizePrivateKey = (privateKey: string): string => {
  const prefixed = ensureHexPrefix(privateKey.trim());
  if (!/^0x[a-fA-F0-9]{64}$/.test(prefixed)) {
    throw new Error("Invalid native mint private key format");
  }
  return prefixed;
};

const toSafeNumberChainId = (chainId: string): number => {
  const parsed = Number(chainId);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Unsupported destination chain id for Safe API: ${chainId}`);
  }
  return parsed;
};

const attestationDomain = (attestation: NativeMintAttestation) => ({
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
});

const getMaxAttestationValiditySeconds = async (
  destinationChainId: bigint,
  destinationBridgeAddress: string,
): Promise<bigint> => {
  const provider = new JsonRpcProvider(getChainRpcUrl(destinationChainId));
  const bridge = new Contract(
    safeChecksum(destinationBridgeAddress),
    NATIVE_MINT_ABI,
    provider,
  );
  const validitySeconds = await bridge.maxAttestationValiditySeconds();
  return BigInt(validitySeconds.toString());
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
  const validitySeconds = await getMaxAttestationValiditySeconds(
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
  };
};

export const signNativeMintAttestation = async (
  attestation: NativeMintAttestation,
): Promise<string[]> => {
  const normalized = normalizeAttestation(attestation);
  const destinationChainId = BigInt(normalized.destinationChainId);
  const bridgeKeys = getNativeBridgePrivateKeys(destinationChainId);
  if (bridgeKeys.length === 0) {
    throw new Error(
      `CHAIN_${destinationChainId}_NATIVE_BRIDGE_PRIVATE_KEY is not configured`,
    );
  }

  const signatures = await Promise.all(
    bridgeKeys.map(async ({ privateKey }) => {
      const wallet = new Wallet(normalizePrivateKey(privateKey));
      const signature = await wallet.signTypedData(
        attestationDomain(normalized),
        NATIVE_MINT_ATTESTATION_TYPES,
        normalized,
      );
      return {
        signer: wallet.address.toLowerCase(),
        signature: Signature.from(signature).serialized,
      };
    }),
  );

  return signatures
    .sort((a, b) => a.signer.localeCompare(b.signer))
    .map(({ signature }) => signature);
};

export const executeNativeMint = async (
  request: NativeMintRequest,
): Promise<string> => {
  const attestation = normalizeAttestation(request.attestation);
  const destinationChainId = BigInt(attestation.destinationChainId);
  const bridgeKey = getNativeBridgePrivateKeys(destinationChainId)[0]?.privateKey;
  if (!bridgeKey) {
    throw new Error(
      `CHAIN_${destinationChainId}_NATIVE_BRIDGE_PRIVATE_KEY is not configured`,
    );
  }

  const signatures = await signNativeMintAttestation(attestation);
  const provider = new JsonRpcProvider(
    getChainRpcUrl(destinationChainId),
  );
  const wallet = new Wallet(
    normalizePrivateKey(bridgeKey),
    provider,
  );
  const bridge = new Contract(
    attestation.destinationBridge,
    NATIVE_MINT_ABI,
    wallet,
  );
  const tx = await bridge.mintRepresentationWithAttestation(
    attestation,
    signatures,
  );
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Native destination mint failed: ${tx.hash}`);
  }

  return receipt.hash;
};

export const proposeNativeMint = async (
  request: NativeMintRequest,
): Promise<string> => {
  const attestation = normalizeAttestation(request.attestation);
  const signatures = await signNativeMintAttestation(attestation);
  const chainId = toSafeNumberChainId(attestation.destinationChainId);
  const safeAddress = config.safe.address || "";
  const relayer = config.safe.safeProposerAddress || "";
  const { protocolKit, apiKit } = await initializeSafeForChain(chainId, safeAddress);
  const nonce = Number(await retry(
    () => apiKit.getNextNonce(safeAddress),
    { logPrefix: "NativeMintService" },
  ));
  const safeTransaction = await protocolKit.createTransaction({
    transactions: [
      {
        to: safeChecksum(attestation.destinationBridge),
        value: "0",
        data: nativeMintInterface.encodeFunctionData(
          "mintRepresentationWithAttestation",
          [attestation, signatures],
        ),
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
