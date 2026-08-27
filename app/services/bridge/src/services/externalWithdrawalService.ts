import {
  AbiCoder,
  Contract,
  Interface,
  JsonRpcProvider,
  Signature,
  Wallet,
  keccak256,
} from "ethers";
import {
  getChainRpcUrl,
  getExternalBridgeAttestationPrivateKeys,
} from "../config";
import { WithdrawalInfo } from "../types";
import { ensureHexPrefix, safeChecksum } from "../utils/utils";

export interface WithdrawalAuthorization {
  sourceChainId: string;
  sourceBridge: string;
  sourceWithdrawalId: string;
  destinationChainId: string;
  destinationVault: string;
  token: string;
  recipient: string;
  amount: string;
  notBefore: string;
  deadline: string;
  signerSetVersion: string;
}

const EXTERNAL_VAULT_ABI = [
  "function attestationThreshold() view returns (uint8)",
  "function maxAuthorizationValiditySeconds() view returns (uint256)",
  "function signerSetVersion() view returns (uint256)",
  "function reservations(bytes32) view returns (uint8 status,address token,address recipient,uint256 amount,uint256 deadline,bytes32 authorizationDigest)",
  "function reserve((uint256 sourceChainId,address sourceBridge,uint256 sourceWithdrawalId,uint256 destinationChainId,address destinationVault,address token,address recipient,uint256 amount,uint256 notBefore,uint256 deadline,uint256 signerSetVersion) authorization,bytes[] signatures) returns (bytes32)",
  "function release(bytes32 reservationId)",
  "event WithdrawalReserved(bytes32 indexed reservationId,bytes32 indexed authorizationDigest,uint256 indexed sourceWithdrawalId,address token,address recipient,uint256 amount,uint256 deadline)",
  "event WithdrawalReleased(bytes32 indexed reservationId,address indexed token,address indexed recipient,uint256 amount)",
];

const WITHDRAWAL_AUTHORIZATION_TYPES = {
  WithdrawalAuthorization: [
    { name: "sourceChainId", type: "uint256" },
    { name: "sourceBridge", type: "address" },
    { name: "sourceWithdrawalId", type: "uint256" },
    { name: "destinationChainId", type: "uint256" },
    { name: "destinationVault", type: "address" },
    { name: "token", type: "address" },
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "notBefore", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "signerSetVersion", type: "uint256" },
  ],
};

const vaultInterface = new Interface(EXTERNAL_VAULT_ABI);

const normalizePrivateKey = (privateKey: string): string => {
  const prefixed = ensureHexPrefix(privateKey.trim());
  if (!/^0x[a-fA-F0-9]{64}$/.test(prefixed)) {
    throw new Error("Invalid external bridge attestation private key format");
  }
  return prefixed;
};

const authorizationDomain = (authorization: WithdrawalAuthorization) => ({
  name: "ExternalBridgeVault",
  version: "1",
  chainId: BigInt(authorization.destinationChainId),
  verifyingContract: authorization.destinationVault,
});

export const signWithdrawalAuthorization = async (
  authorization: WithdrawalAuthorization,
): Promise<string[]> => {
  const keys = getExternalBridgeAttestationPrivateKeys(
    BigInt(authorization.destinationChainId),
  );
  if (keys.length === 0) {
    throw new Error(
      `CHAIN_${authorization.destinationChainId}_EXTERNAL_BRIDGE_ATTESTATION_PRIVATE_KEY is not configured`,
    );
  }

  const signatures = await Promise.all(
    keys.map(async ({ privateKey }) => {
      const wallet = new Wallet(normalizePrivateKey(privateKey));
      const signature = await wallet.signTypedData(
        authorizationDomain(authorization),
        WITHDRAWAL_AUTHORIZATION_TYPES,
        authorization,
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

export const buildWithdrawalAuthorization = async (
  withdrawal: WithdrawalInfo,
  sourceChainId: bigint,
  sourceBridgeAddress: string,
): Promise<WithdrawalAuthorization> => {
  if (!withdrawal.vault) {
    throw new Error(`Withdrawal ${withdrawal.withdrawalId} is missing its vault`);
  }

  const destinationChainId = BigInt(withdrawal.externalChainId);
  const provider = new JsonRpcProvider(getChainRpcUrl(destinationChainId));
  const vault = new Contract(
    safeChecksum(withdrawal.vault),
    EXTERNAL_VAULT_ABI,
    provider,
  );
  const [latestBlock, validity, signerSetVersion] = await Promise.all([
    provider.getBlock("latest"),
    vault.maxAuthorizationValiditySeconds(),
    vault.signerSetVersion(),
  ]);
  if (!latestBlock) {
    throw new Error(`Latest block not found for chain ${destinationChainId}`);
  }

  const validitySeconds = BigInt(validity.toString());
  const hasStoredAuthorization = withdrawal.authorizationDeadline != null;
  if (
    hasStoredAuthorization &&
    (!withdrawal.authorizationNotBefore || !withdrawal.signerSetVersion)
  ) {
    throw new Error(
      `Withdrawal ${withdrawal.withdrawalId} has incomplete authorization state`,
    );
  }
  const notBefore = hasStoredAuthorization
    ? BigInt(withdrawal.authorizationNotBefore!)
    : BigInt(latestBlock.timestamp);
  const deadline = hasStoredAuthorization
    ? BigInt(withdrawal.authorizationDeadline!)
    : notBefore + validitySeconds;
  if (validitySeconds <= 0n || deadline <= BigInt(latestBlock.timestamp)) {
    throw new Error(`Withdrawal ${withdrawal.withdrawalId} authorization expired`);
  }

  return {
    sourceChainId: sourceChainId.toString(),
    sourceBridge: safeChecksum(sourceBridgeAddress),
    sourceWithdrawalId: withdrawal.withdrawalId,
    destinationChainId: destinationChainId.toString(),
    destinationVault: safeChecksum(withdrawal.vault),
    token: safeChecksum(withdrawal.externalToken),
    recipient: safeChecksum(withdrawal.externalRecipient),
    amount: withdrawal.externalTokenAmount,
    notBefore: notBefore.toString(),
    deadline: deadline.toString(),
    signerSetVersion:
      withdrawal.signerSetVersion || signerSetVersion.toString(),
  };
};

export const getReservationId = (
  authorization: WithdrawalAuthorization,
): string =>
  keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "uint256"],
      [
        authorization.sourceChainId,
        authorization.sourceBridge,
        authorization.sourceWithdrawalId,
      ],
    ),
  );

const getEventTransactionHash = async (
  provider: JsonRpcProvider,
  vaultAddress: string,
  eventName: "WithdrawalReserved" | "WithdrawalReleased",
  reservationId: string,
): Promise<string> => {
  const logs = await provider.getLogs({
    address: vaultAddress,
    topics: vaultInterface.encodeFilterTopics(eventName, [reservationId]),
    fromBlock: 0,
    toBlock: "latest",
  });
  const transactionHash = logs.at(-1)?.transactionHash;
  if (!transactionHash) {
    throw new Error(`${eventName} event not found for ${reservationId}`);
  }
  return transactionHash;
};

const getVaultWithSigner = (
  authorization: WithdrawalAuthorization,
): {
  provider: JsonRpcProvider;
  vault: Contract;
} => {
  const chainId = BigInt(authorization.destinationChainId);
  const privateKey = getExternalBridgeAttestationPrivateKeys(chainId)[0]?.privateKey;
  if (!privateKey) {
    throw new Error(
      `CHAIN_${chainId}_EXTERNAL_BRIDGE_ATTESTATION_PRIVATE_KEY is not configured`,
    );
  }
  const provider = new JsonRpcProvider(getChainRpcUrl(chainId));
  const wallet = new Wallet(normalizePrivateKey(privateKey), provider);
  return {
    provider,
    vault: new Contract(authorization.destinationVault, EXTERNAL_VAULT_ABI, wallet),
  };
};

export const reserveWithdrawal = async (
  authorization: WithdrawalAuthorization,
): Promise<{ reservationId: string; transactionHash: string }> => {
  const { provider, vault } = getVaultWithSigner(authorization);
  const reservationId = getReservationId(authorization);
  const reservation = await vault.reservations(reservationId);
  const status = Number(reservation.status ?? reservation[0]);

  if (status === 0) {
    const signatures = await signWithdrawalAuthorization(authorization);
    const threshold = Number(await vault.attestationThreshold());
    if (signatures.length < threshold) {
      throw new Error(
        `External bridge attestation threshold requires ${threshold} signatures; configured ${signatures.length}`,
      );
    }
    const transaction = await vault.reserve(authorization, signatures);
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error(`Vault reservation failed: ${transaction.hash}`);
    }
    return { reservationId, transactionHash: receipt.hash };
  }
  if (status !== 1) {
    throw new Error(`Reservation ${reservationId} is not reservable`);
  }

  return {
    reservationId,
    transactionHash: await getEventTransactionHash(
      provider,
      authorization.destinationVault,
      "WithdrawalReserved",
      reservationId,
    ),
  };
};

export const releaseWithdrawal = async (
  authorization: WithdrawalAuthorization,
  reservationId: string,
): Promise<string> => {
  const { provider, vault } = getVaultWithSigner(authorization);
  const reservation = await vault.reservations(reservationId);
  const status = Number(reservation.status ?? reservation[0]);

  if (status === 1) {
    const transaction = await vault.release(reservationId);
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error(`Vault release failed: ${transaction.hash}`);
    }
    return receipt.hash;
  }
  if (status !== 2) {
    throw new Error(`Reservation ${reservationId} is not releasable`);
  }

  return getEventTransactionHash(
    provider,
    authorization.destinationVault,
    "WithdrawalReleased",
    reservationId,
  );
};
