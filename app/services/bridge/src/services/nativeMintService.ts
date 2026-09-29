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

/**
 * The V2 attestation: V1 plus the solver fee schedule STRATO committed when the
 * user made the request.
 *
 * THE SCHEDULE HAS TO BE ATTESTED. The destination bridge redirects the mint to
 * whoever fronted the recipient automatically, so a solver free to name their
 * own `maxFee` could pay a penny and collect the whole mint. Copying these
 * three fields out of the withdrawal record is what makes a claim checkable --
 * and it is a copy, never a recomputation: `requestedAt` is STRATO's timestamp,
 * and a local clock in its place would hand the solver back the decay the user
 * is owed.
 */
export interface NativeMintAttestationV2 extends NativeMintAttestation {
  maxFee: string;
  requestedAt: string;
  feeHalfLife: string;
}

const isV2 = (
  attestation: NativeMintAttestation | NativeMintAttestationV2,
): attestation is NativeMintAttestationV2 =>
  (attestation as NativeMintAttestationV2).maxFee !== undefined;

export interface NativeMintRequest extends NativeMintAttestation {
  idempotencyKey: string;
  externalChainId: string;
  representationBridge: string;
  attestation: NativeMintAttestation | NativeMintAttestationV2;
}

const NATIVE_MINT_ABI = [
  "function mintRepresentationWithAttestation((uint256 sourceChainId,address sourceBridge,uint256 destinationChainId,address destinationBridge,uint256 sourceWithdrawalId,address stratoToken,address representationToken,address recipient,uint256 amount,uint256 notBefore,uint256 deadline) attestation, bytes[] signatures)",
  "function mintRepresentationWithAttestationV2((uint256 sourceChainId,address sourceBridge,uint256 destinationChainId,address destinationBridge,uint256 sourceWithdrawalId,address stratoToken,address representationToken,address recipient,uint256 amount,uint256 notBefore,uint256 deadline,uint256 maxFee,uint256 requestedAt,uint256 feeHalfLife) attestation, bytes[] signatures)",
  "function maxAttestationValiditySeconds() view returns (uint256)",
  "event RepresentationMinted(uint256 sourceChainId,address indexed sourceBridge,uint256 indexed sourceWithdrawalId,address indexed stratoToken,address representationToken,address recipient,uint256 amount,bytes32 mintId)",
];

const nativeMintInterface = new Interface(NATIVE_MINT_ABI);

const V1_FIELDS = [
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
];

const NATIVE_MINT_ATTESTATION_TYPES = {
  NativeMintAttestation: V1_FIELDS,
};

const NATIVE_MINT_ATTESTATION_V2_TYPES = {
  NativeMintAttestationV2: [
    ...V1_FIELDS,
    { name: "maxFee", type: "uint256" },
    { name: "requestedAt", type: "uint256" },
    { name: "feeHalfLife", type: "uint256" },
  ],
};

/// Which EIP-712 struct to sign, and which entry point to call. A withdrawal
/// that committed a fee schedule MUST go through V2: the V1 mint refuses a
/// claimed withdrawal outright, because it has nothing to check the claim
/// against and would otherwise pay the recipient twice.
const typesFor = (attestation: NativeMintAttestation | NativeMintAttestationV2) =>
  isV2(attestation) ? NATIVE_MINT_ATTESTATION_V2_TYPES : NATIVE_MINT_ATTESTATION_TYPES;

const methodFor = (attestation: NativeMintAttestation | NativeMintAttestationV2) =>
  isV2(attestation)
    ? "mintRepresentationWithAttestationV2"
    : "mintRepresentationWithAttestation";

/**
 * Whether a representation bridge understands the V2 attestation.
 *
 * ASKED ON CHAIN, NEVER INFERRED FROM STRATO'S SIDE. Once STRATO is upgraded it
 * commits a fee schedule to EVERY native withdrawal, including zero-fee ones,
 * but the representation bridges upgrade independently. Building a V2
 * attestation for a bridge that only has V1 fails the mint outright, so every
 * native withdrawal on an un-upgraded chain would stall -- the same hazard as
 * routing a settlement to an un-upgraded DepositRouter, on the other half of
 * the bridge.
 *
 * `maxFeeBps` is the probe: a plain view that exists only on the new
 * implementation. Anything other than a clean answer -- old implementation,
 * unreachable RPC -- reads as "V1 only", which is the behaviour that was
 * correct before the upgrade and stays correct after it.
 *
 * Cached per chain+bridge for the process: an implementation only changes on an
 * upgrade, and a stale "V1" costs a slow withdrawal while a stale "V2" costs a
 * stalled one.
 */
const v2Support = new Map<string, boolean>();

export const representationBridgeSupportsV2 = async (
  chainId: bigint | number,
  bridgeAddress: string,
): Promise<boolean> => {
  const key = `${chainId}:${bridgeAddress.toLowerCase()}`;
  const cached = v2Support.get(key);
  if (cached !== undefined) return cached;

  let supported = false;
  let provider;
  try {
    provider = new JsonRpcProvider(getChainRpcUrl(BigInt(chainId)));
    const probe = new Interface(["function maxFeeBps() view returns (uint16)"]);
    const result = await provider.call({
      to: safeChecksum(bridgeAddress),
      data: probe.encodeFunctionData("maxFeeBps", []),
    });
    // An old implementation has no such selector; a fallback-less contract
    // returns empty rather than a decodable word.
    probe.decodeFunctionResult("maxFeeBps", result);
    supported = true;
  } catch {
    supported = false;
  } finally {
    // Same reason as the router probe: do not leave a poller running.
    provider?.destroy();
  }

  v2Support.set(key, supported);
  return supported;
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

const attestationDomain = (
  attestation: NativeMintAttestation | NativeMintAttestationV2,
) => ({
  name: "StratoNativeRepresentationBridge",
  version: "1",
  chainId: BigInt(attestation.destinationChainId),
  verifyingContract: safeChecksum(attestation.destinationBridge),
});

const normalizeAttestation = (
  attestation: NativeMintAttestation | NativeMintAttestationV2,
): NativeMintAttestation | NativeMintAttestationV2 => {
  const base: NativeMintAttestation = {
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
  };

  if (!isV2(attestation)) return base;

  return {
    ...base,
    maxFee: attestation.maxFee.toString(),
    requestedAt: attestation.requestedAt.toString(),
    feeHalfLife: attestation.feeHalfLife.toString(),
  };
};

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
  const base = {
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
  };

  // A withdrawal that committed a fee schedule is attested with it, so the
  // destination bridge can pay a solver who already delivered. The schedule is
  // COPIED from STRATO's record, never recomputed here.
  const attestation = normalizeAttestation(
    withdrawal.feeTerms
      ? {
          ...base,
          maxFee: withdrawal.feeTerms.maxFee,
          requestedAt: withdrawal.feeTerms.requestedAt,
          feeHalfLife: withdrawal.feeTerms.feeHalfLife,
        }
      : base,
  );

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
  attestation: NativeMintAttestation | NativeMintAttestationV2,
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
        typesFor(normalized),
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
  const tx = await bridge[methodFor(attestation)](attestation, signatures);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Native destination mint failed: ${tx.hash}`);
  }

  return receipt.hash;
};

export const getExistingNativeMintTxHash = async (
  request: NativeMintRequest,
): Promise<string | null> => {
  const attestation = normalizeAttestation(request.attestation);
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
  const logs = await provider.getLogs({
    address: safeChecksum(attestation.destinationBridge),
    topics,
    fromBlock: 0,
    toBlock: "latest",
  });

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

  return null;
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
        data: nativeMintInterface.encodeFunctionData(methodFor(attestation), [
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
