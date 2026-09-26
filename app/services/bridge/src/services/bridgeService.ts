import { decideRejectedWithdrawal } from "./externalSettlementService";
import {
  config,
  getChainRpcUrl,
  getNativeRepresentationBridgeAddress,
} from "../config";
import { JsonRpcProvider } from "ethers";
import { execute } from "../utils/stratoHelper";
import sendEmail from "./emailService";
import { NonEmptyArray, WithdrawalInfo, NativeWithdrawalInfo, NativeDepositArgs, ConfirmDepositArgs, ConfirmNativeDepositArgs, SafeTransactionData, WithdrawalClaimArgs } from "../types";
import {
  createSafeTransactions,
  findWithdrawalPayouts,
  getSafeOnChainNonce,
  proposeSafeTransactions,
  WithdrawalPayout,
} from "./safeService";
import { groupByChain, routerSupportsSettlement } from "../utils/safeHelper";
import { withdrawalProposalJournal } from "./withdrawalProposalJournal";
import {
  getEnabledChains,
  getWithdrawalFeeTerms,
  getNativeWithdrawalFeeTerms,
} from "./cirrusService";
import { logInfo, logError } from "../utils/logger";
import { mintVouchersForDeposits } from "./voucherService";
import { eth } from "../utils/api";
import {
  buildNativeMintRequest,
  executeNativeMint,
  getExistingNativeMintTxHash,
  getNativeMintProposalExecution,
  proposeNativeMint,
  representationBridgeSupportsV2,
} from "./nativeMintService";

let cachedStratoNetworkId: bigint | null = null;
const announcedManualNativeWithdrawals = new Map<string, string | null>();
const pendingNativeInstantWithdrawalTxHashes = new Map<string, string>();
const inFlightSafeProposalWithdrawals = new Set<string>();

const normalizeOptionalHash = (value?: string | null): string | null => {
  const normalized = value?.trim();
  if (!normalized) return null;
  const withoutPrefix = normalized.replace(/^0x/i, "");
  return /^0+$/.test(withoutPrefix) ? null : normalized;
};

const getStratoNetworkId = async (): Promise<bigint> => {
  if (cachedStratoNetworkId != null) {
    return cachedStratoNetworkId;
  }

  const metadata: any = await eth.get("/metadata");
  const networkId = metadata?.networkID;
  if (networkId == null) {
    throw new Error("Network ID not found in STRATO metadata");
  }

  cachedStratoNetworkId = BigInt(networkId.toString());
  return cachedStratoNetworkId;
};

const getNativeMintRequest = async (
  withdrawal: NativeWithdrawalInfo,
  sourceChainId: bigint,
) => {
  const bridgeAddress = getNativeRepresentationBridgeAddress(
    Number(withdrawal.externalChainId),
  );
  if (!bridgeAddress) {
    throw new Error(
      `CHAIN_${Number(withdrawal.externalChainId)}_NATIVE_REPRESENTATION_BRIDGE_ADDRESS is not configured`,
    );
  }
  return buildNativeMintRequest(
    withdrawal,
    sourceChainId,
    config.nativeBridge.address!,
    bridgeAddress,
  );
};

const submitNativeMint = async (
  withdrawal: NativeWithdrawalInfo,
  sourceChainId: bigint,
): Promise<string> => {
  const payload = await getNativeMintRequest(withdrawal, sourceChainId);
  return executeNativeMint(payload);
};

const getDestinationChainLatestTimestamp = async (
  externalChainId: string | number,
): Promise<bigint | null> => {
  const provider = new JsonRpcProvider(getChainRpcUrl(BigInt(externalChainId)));
  const latestBlock = await provider.getBlock("latest");
  return latestBlock ? BigInt(latestBlock.timestamp) : null;
};

const isDestinationMintReady = async (
  withdrawal: NativeWithdrawalInfo,
): Promise<boolean> => {
  const notBefore = BigInt(withdrawal.nativeMintNotBefore || 0);
  if (notBefore <= 0n) {
    return true;
  }

  const latestTimestamp = await getDestinationChainLatestTimestamp(
    withdrawal.externalChainId,
  );
  if (latestTimestamp == null || latestTimestamp >= notBefore) {
    return true;
  }

  logInfo(
    "BridgeService",
    `Native withdrawal ${withdrawal.withdrawalId} destination chain is not ready for mint; latest block timestamp ${latestTimestamp.toString()} is before notBefore ${notBefore.toString()}`,
  );
  return false;
};

const findExistingNativeMint = async (
  withdrawal: NativeWithdrawalInfo,
  sourceChainId: bigint,
): Promise<string | null> => {
  const payload = await getNativeMintRequest(withdrawal, sourceChainId);
  return getExistingNativeMintTxHash(payload);
};

const proposeManualNativeMint = async (
  withdrawal: NativeWithdrawalInfo,
  sourceChainId: bigint,
): Promise<string> => {
  const payload = await getNativeMintRequest(withdrawal, sourceChainId);
  return proposeNativeMint(payload);
};

const syncManualNativeMintProposal = async (
  withdrawal: NativeWithdrawalInfo,
  proposalReference: string | null,
): Promise<boolean> => {
  if (!proposalReference) {
    return false;
  }

  const result = await getNativeMintProposalExecution(
    proposalReference,
    withdrawal.externalChainId,
  );

  if (result.status === "pending") {
    return true;
  }

  if (result.status === "rejected") {
    // "Rejected" only means OUR proposal did not execute. Whether the mint
    // happened is a separate question with an on-chain answer, and aborting
    // without asking it returns the escrow for tokens that already exist.
    const { decision, state } = await decideRejectedWithdrawal(
      `native withdrawal ${withdrawal.withdrawalId}`,
      {
        kind: "native",
        chainId: Number(withdrawal.externalChainId),
        contract: withdrawal.externalBridge,
        sourceChainId: await getStratoNetworkId(),
        sourceBridge: config.nativeBridge.address!,
        withdrawalId: withdrawal.withdrawalId,
      },
    );
    if (decision === "hold") return true;
    if (decision === "finalize") {
      const done = await execute({
        contractName: "StratoNativeBridge",
        contractAddress: config.nativeBridge.address!,
        method: "finalizeWithdrawal",
        args: {
          id: Number(withdrawal.withdrawalId),
          externalTxHash: (state as { txHash: string }).txHash,
          nativeMintProposalHash: "",
        },
      });
      if (done.status === "Success") {
        announcedManualNativeWithdrawals.delete(withdrawal.withdrawalId);
      }
      return true;
    }
    await execute({
      contractName: "StratoNativeBridge",
      contractAddress: config.nativeBridge.address!,
      method: "abortWithdrawal",
      args: {
        id: Number(withdrawal.withdrawalId),
      },
    });
    announcedManualNativeWithdrawals.delete(withdrawal.withdrawalId);
    return true;
  }

  if (!result.txHash) {
    return true;
  }

  await execute({
    contractName: "StratoNativeBridge",
    contractAddress: config.nativeBridge.address!,
    method: "finalizeWithdrawal",
    args: {
      id: Number(withdrawal.withdrawalId),
      externalTxHash: result.txHash,
      nativeMintProposalHash: proposalReference,
    },
  });
  announcedManualNativeWithdrawals.delete(withdrawal.withdrawalId);
  return true;
};

const recordNativeWithdrawalProposal = async (
  withdrawalId: string,
  proposalReference: string,
) => {
  await execute({
    contractName: "StratoNativeBridge",
    contractAddress: config.nativeBridge.address!,
    method: "recordWithdrawalProposal",
    args: {
      id: Number(withdrawalId),
      nativeMintProposalHash: proposalReference,
    },
  });
};

/**
 * Mirror a solver's claim on an outbound withdrawal back onto STRATO.
 *
 * This does NOT pay the solver -- the external chain's own settlement does
 * that. It makes the claim visible on the chain holding the escrow, and it
 * closes the user's 48-hour abort hatch: without it a user could take a
 * solver's tokens on one chain and their own escrow back on the other.
 *
 * STRATO re-checks the arithmetic (that a rung-zero fee sits inside the
 * committed schedule at `claimedAt`, and that `netPaid` is the remainder), so a
 * wrong report is refused rather than recorded.
 */
export const recordWithdrawalClaim = async (
  claim: WithdrawalClaimArgs,
  contractName: "MercataBridge" | "StratoNativeBridge",
) => {
  const contractAddress =
    contractName === "MercataBridge"
      ? config.bridge.address!
      : config.nativeBridge.address!;

  try {
    await execute({
      contractName,
      contractAddress,
      method: "recordWithdrawalClaim",
      args: {
        id: Number(claim.withdrawalId),
        claimant: claim.claimant,
        claimIndex: claim.claimIndex,
        feeCharged: claim.feeCharged,
        netPaid: claim.netPaid,
        claimedAt: claim.claimedAt,
        externalFillTxHash: claim.externalFillTxHash,
      },
    });
    logInfo(
      "BridgeService",
      `Recorded solver claim on withdrawal ${claim.withdrawalId} at rung ${claim.claimIndex}`,
    );
  } catch (error) {
    const message = (error as Error).message;
    // Another relayer got there first, or the withdrawal has already left the
    // state where a claim can be recorded. Both are ordinary races.
    if (
      message.includes("claim index not advancing") ||
      message.includes("bad state")
    ) {
      logInfo(
        "BridgeService",
        `Claim on withdrawal ${claim.withdrawalId} already recorded or no longer recordable`,
      );
      return;
    }
    throw error;
  }
};

/**
 * Reject an announced deposit governance has ruled fake, slashing its bond.
 *
 * The ONLY path that takes an announcer's money, and the relayer reaches for it
 * only when the claimed origin transaction provably does not contain the
 * deposit -- a receipt that exists and says something else. An announcement
 * that merely disagrees with the relayer's numbers is superseded when the real
 * record lands, and its bond stays reclaimable; the honest reasons to differ
 * are real (a rebase adjustment, a race with a reorg), and a relayer that
 * cannot reach an RPC must never mistake its own blindness for fraud.
 */
export const rejectAnnouncedDeposit = async (
  externalChainId: string | number,
  externalTxHash: string,
) => {
  try {
    await execute({
      contractName: "MercataBridge",
      contractAddress: config.bridge.address!,
      method: "rejectAnnouncement",
      args: { externalChainId, externalTxHash },
    });
    logInfo(
      "BridgeService",
      `Rejected fake announcement ${externalTxHash} on chain ${externalChainId}`,
    );
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes("bond already resolved")) {
      logInfo(
        "BridgeService",
        `Announcement ${externalTxHash} already resolved by another server`,
      );
      return;
    }
    throw error;
  }
};

export const recordNativeDepositBatch = async (
  depositArgs: NonEmptyArray<NativeDepositArgs>
) => {
  if (!config.nativeBridge.address) {
    throw new Error("Native bridge address not configured");
  }

  try {
    await execute(
      depositArgs.map((deposit) => {
        const base = {
          externalChainId: deposit.externalChainId,
          externalBridge: deposit.externalBridge,
          externalRedemptionId: deposit.externalRedemptionId,
          externalSender: deposit.externalSender,
          externalTxHash: deposit.externalTxHash,
          representationToken: deposit.representationToken,
          stratoRecipient: deposit.stratoRecipient,
          stratoTokenAmount: deposit.stratoTokenAmount,
        };

        // A redemption that offered a solver fee goes through the fee-bearing
        // entry point, carrying the ORIGIN chain's timestamp so STRATO starts
        // the decay from when the user asked rather than from now.
        if (!deposit.feeTerms) {
          return {
            contractName: "StratoNativeBridge",
            contractAddress: config.nativeBridge.address!,
            method: "recordDeposit",
            args: base,
          };
        }

        return {
          contractName: "StratoNativeBridge",
          contractAddress: config.nativeBridge.address!,
          method: "recordDepositWithFee",
          args: {
            ...base,
            maxFee: deposit.feeTerms.maxFee,
            requestedAt: deposit.feeTerms.requestedAt,
          },
        };
      })
    );

    logInfo(
      "BridgeService",
      `Successfully recorded ${depositArgs.length} native deposits`,
    );
  } catch (error) {
    const errorMessage = (error as Error).message;

    if (
      errorMessage.includes("SNB: duplicate deposit")
    ) {
      logInfo(
        "BridgeService",
        `Native deposits already processed by another server: ${depositArgs.length} deposits (${depositArgs.map((d) => `${d.externalBridge}:${d.externalRedemptionId}`).join(", ")})`,
      );
      return;
    }

    throw error;
  }
};

export const confirmDepositBatch = async (deposits: NonEmptyArray<ConfirmDepositArgs>) => {
  const externalChainIds = deposits.map((deposit) => deposit.externalChainId);
  const externalTxHashes = deposits.map((deposit) => deposit.externalTxHash);
  const stratoRecipients = deposits.map((deposit) => deposit.stratoRecipient);

  try {
    await execute({
      contractName: "MercataBridge",
      contractAddress: config.bridge.address!,
      method: "confirmDepositBatch",
      args: {
        externalChainIds,
        externalTxHashes,
      },
    });

    logInfo(
      "BridgeService",
      `Successfully confirmed ${deposits.length} deposits`,
    );

    await mintVouchersForDeposits(stratoRecipients);
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    // Check if this is a bad state error (expected when multiple servers confirm same deposits)
    if (errorMessage.includes("MB: bad state")) {
      logInfo(
        "BridgeService",
        `Deposits already confirmed by another server: ${deposits.length} deposits (${externalTxHashes.join(", ")})`,
      );
      return; // Gracefully handle already confirmed deposits
    }
    
    // Re-throw other errors
    throw error;
  }
};

export const confirmNativeDepositBatch = async (
  deposits: NonEmptyArray<ConfirmNativeDepositArgs>
) => {
  if (!config.nativeBridge.address) {
    throw new Error("Native bridge address not configured");
  }

  const depositIds = deposits.map((deposit) => deposit.depositId);
  const stratoRecipients = deposits.map((deposit) => deposit.stratoRecipient);

  try {
    await execute(
      deposits.map((deposit) => ({
        contractName: "StratoNativeBridge",
        contractAddress: config.nativeBridge.address!,
        method: "confirmDeposit",
        args: {
          externalChainId: deposit.externalChainId,
          externalBridge: deposit.externalBridge,
          externalRedemptionId: deposit.externalRedemptionId,
        },
      }))
    );

    logInfo(
      "BridgeService",
      `Successfully confirmed ${deposits.length} native deposits`,
    );

    await mintVouchersForDeposits(stratoRecipients);
  } catch (error) {
    const errorMessage = (error as Error).message;

    if (errorMessage.includes("SNB: bad state")) {
      logInfo(
        "BridgeService",
        `Native deposits already confirmed by another server: ${deposits.length} deposits (${depositIds.join(", ")})`,
      );
      return;
    }

    throw error;
  }
};

export const reviewDepositBatch = async (deposits: NonEmptyArray<ConfirmDepositArgs>) => {
  const externalChainIds = deposits.map((deposit) => deposit.externalChainId);
  const externalTxHashes = deposits.map((deposit) => deposit.externalTxHash);

  try {
    await execute({
      contractName: "MercataBridge",
      contractAddress: config.bridge.address!,
      method: "reviewDepositBatch",
      args: {
        externalChainIds,
        externalTxHashes,
      },
    });

    logInfo(
      "BridgeService",
      `Successfully set ${deposits.length} deposits to pending review`,
    );
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    // Check if this is a bad state error (expected when multiple servers review same deposits)
    if (errorMessage.includes("MB: bad state")) {
      logInfo(
        "BridgeService",
        `Deposits already reviewed by another server: ${deposits.length} deposits (${externalTxHashes.join(", ")})`,
      );
      return; // Gracefully handle already reviewed deposits
    }
    
    // Re-throw other errors
    throw error;
  }
};

export const reviewNativeDepositBatch = async (
  deposits: NonEmptyArray<ConfirmNativeDepositArgs>
) => {
  if (!config.nativeBridge.address) {
    throw new Error("Native bridge address not configured");
  }

  const depositIds = deposits.map((deposit) => deposit.depositId);

  try {
    await execute(
      deposits.map((deposit) => ({
        contractName: "StratoNativeBridge",
        contractAddress: config.nativeBridge.address!,
        method: "reviewDeposit",
        args: {
          externalChainId: deposit.externalChainId,
          externalBridge: deposit.externalBridge,
          externalRedemptionId: deposit.externalRedemptionId,
        },
      }))
    );

    logInfo(
      "BridgeService",
      `Successfully set ${deposits.length} native deposits to pending review`,
    );
  } catch (error) {
    const errorMessage = (error as Error).message;

    if (errorMessage.includes("SNB: bad state")) {
      logInfo(
        "BridgeService",
        `Native deposits already reviewed by another server: ${deposits.length} deposits (${depositIds.join(", ")})`,
      );
      return;
    }

    throw error;
  }
};

export const confirmWithdrawalBatch = async (
  withdrawals: NonEmptyArray<WithdrawalInfo>,
) => {
  const eligibleWithdrawals = withdrawals.filter((withdrawal) => {
    const withdrawalId = String(withdrawal.withdrawalId);
    if (inFlightSafeProposalWithdrawals.has(withdrawalId)) {
      logInfo(
        "BridgeService",
        `Skipping withdrawal ${withdrawalId}; Safe proposal is already in progress`,
      );
      return false;
    }
    inFlightSafeProposalWithdrawals.add(withdrawalId);
    return true;
  });

  if (eligibleWithdrawals.length === 0) return;

  try {
    await confirmEligibleWithdrawalBatch(
      eligibleWithdrawals as NonEmptyArray<WithdrawalInfo>,
    );
  } finally {
    for (const withdrawal of eligibleWithdrawals) {
      inFlightSafeProposalWithdrawals.delete(String(withdrawal.withdrawalId));
    }
  }
};

/**
 * Attach the context a withdrawal needs to be settled through the router.
 *
 * Without this the proposal falls back to a direct transfer to the recipient,
 * which is exactly right for a withdrawal requested before the fast-path
 * upgrade -- it has no committed fee schedule, so no solver can have claimed
 * it -- and exactly wrong for one that can be claimed. Attaching it here, once,
 * is what keeps that decision in a single place.
 */
const attachSettlementContext = async (
  withdrawals: WithdrawalInfo[],
): Promise<void> => {
  const feeTerms = await getWithdrawalFeeTerms(withdrawals.map((w) => String(w.withdrawalId)));
  // Nothing here can be claimed, so nothing needs routing: the direct transfer is right for all
  if (feeTerms.size === 0) return;

  const [sourceChainId, chains] = await Promise.all([getStratoNetworkId(), getEnabledChains()]);

  for (const withdrawal of withdrawals) {
    const terms = feeTerms.get(String(withdrawal.withdrawalId));
    const chain = chains.get(Number(withdrawal.externalChainId));
    if (!terms || !chain?.depositRouter) continue;

    // The wallet that will execute this payout is the one whose settler rights
    // matter: a hot-wallet withdrawal is proposed from the hot Safe.
    const settler = withdrawal.useHotWallet
      ? config.safe.hotWalletAddress
      : config.safe.address;
    if (!settler) continue;

    // Probed on chain, not assumed. STRATO commits a schedule to every
    // withdrawal once upgraded, but the external routers upgrade on their own
    // schedule; routing to one that cannot settle would stall the withdrawal.
    if (
      !(await routerSupportsSettlement(
        Number(withdrawal.externalChainId),
        chain.depositRouter,
        settler,
      ))
    ) {
      continue;
    }

    withdrawal.feeTerms = terms;
    withdrawal.sourceChainId = sourceChainId.toString();
    withdrawal.sourceBridge = config.bridge.address!;
    withdrawal.settlementRouter = chain.depositRouter;
  }
};

const payoutSafes = () => [config.safe.address, config.safe.hotWalletAddress];

// Payouts the Safes already hold for these withdrawals, looked up on each withdrawal's own chain
const findExistingPayouts = async (
  withdrawals: WithdrawalInfo[],
): Promise<Map<string, WithdrawalPayout[]>> => {
  const existing = new Map<string, WithdrawalPayout[]>();
  for (const [chainId, chainWithdrawals] of groupByChain(withdrawals)) {
    const payouts = await findWithdrawalPayouts(chainId, payoutSafes());
    for (const withdrawal of chainWithdrawals) {
      const found = payouts.get(String(withdrawal.withdrawalId));
      if (found?.length) existing.set(String(withdrawal.withdrawalId), found);
    }
  }
  return existing;
};

/**
 * A withdrawal still INITIATED on STRATO whose payout is already in a Safe is never given a
 * second payout. With exactly one payout, record that one on STRATO; with more, a human must
 * reject the extras first.
 */
const adoptExistingPayouts = async (existing: Map<string, WithdrawalPayout[]>) => {
  for (const [withdrawalId, payouts] of existing) {
    const hashes = payouts.map((payout) => payout.safeTxHash);
    if (payouts.length > 1) {
      logError(
        "BridgeService",
        new Error(
          `Withdrawal ${withdrawalId} has ${payouts.length} payouts in the Safe (${hashes.join(", ")}); reject all but one before it can proceed`,
        ),
      );
      continue;
    }

    logInfo(
      "BridgeService",
      `Withdrawal ${withdrawalId} already has Safe payout ${hashes[0]}; recording it instead of proposing another`,
    );
    try {
      await execute({
        contractName: "MercataBridge",
        contractAddress: config.bridge.address!,
        method: "confirmWithdrawalBatch",
        args: { ids: [withdrawalId], custodyTxHashes: hashes },
      });
    } catch (error) {
      // Usually Cirrus had not caught up with a confirmation that already landed
      if ((error as Error).message.includes("MB: bad state")) continue;
      throw error;
    }
    logError(
      "BridgeService",
      new Error(
        `Withdrawal ${withdrawalId} had Safe payout ${hashes[0]} without a STRATO confirmation; it is now recorded`,
      ),
    );
  }
};

const confirmEligibleWithdrawalBatch = async (
  withdrawals: NonEmptyArray<WithdrawalInfo>,
) => {
  const existing = await findExistingPayouts(withdrawals);
  await adoptExistingPayouts(existing);
  const unpaid = withdrawals.filter((w) => !existing.has(String(w.withdrawalId)));
  if (unpaid.length === 0) return;

  await attachSettlementContext(unpaid);
  const transactionProposals = await createSafeTransactions(unpaid as NonEmptyArray<WithdrawalInfo>);
  if (!transactionProposals || transactionProposals.length === 0) return;

  // Proposals come back grouped by chain, so pair ids and hashes from the proposals themselves
  const withdrawalIds = transactionProposals.map((tx) => tx.withdrawalId);
  const custodyTxHashes = transactionProposals.map((tx) => tx.safeTxHash);

  // Keep the signed payouts before STRATO can point at them: if the confirmation lands but
  // proposing fails, the withdrawal-tx poller proposes exactly this transaction later
  await withdrawalProposalJournal.record(
    transactionProposals.map((proposal) => ({
      withdrawalId: proposal.withdrawalId,
      proposal,
    })),
  );

  try {
    logInfo("BridgeService", "Confirming non-native withdrawals on STRATO", {
      withdrawalIds,
      custodyTxHashes,
    });
    // Resolves only on success; a pending or failed confirmation throws before any payout is proposed
    await execute({
      contractName: "MercataBridge",
      contractAddress: config.bridge.address!,
      method: "confirmWithdrawalBatch",
      args: {
        ids: withdrawalIds,
        custodyTxHashes,
      },
    });
  } catch (executeError) {
    const errorMessage = (executeError as Error).message;
    if (errorMessage.includes("MB: bad state")) {
      logInfo(
        "BridgeService",
        `Withdrawals already confirmed: ${withdrawalIds.join(", ")}; only the custody tx recorded on STRATO will be proposed`,
      );
      return;
    }
    throw executeError;
  }

  const proposed = new Set(
    await proposeSafeTransactions(transactionProposals as NonEmptyArray<SafeTransactionData>),
  );
  await withdrawalProposalJournal.markProposed([...proposed]);

  const emailPromises = transactionProposals
    .filter((proposal) => proposed.has(proposal.safeTxHash))
    .map(async (proposal) => {
      try {
        await sendEmail(proposal.safeTxHash, proposal.externalChainId);
        return "success";
      } catch (emailError) {
        logError("BridgeService", emailError as Error, {
          operation: "sendEmail",
          safeTxHash: proposal.safeTxHash,
        });
        return "failed";
      }
    });

  const emailResults = await Promise.all(emailPromises);
  const successCount = emailResults.filter((r) => r === "success").length;
  const failureCount = emailResults.filter((r) => r === "failed").length;
  logInfo(
    "BridgeService",
    `Email notifications: ${successCount} sent, ${failureCount} failed for batch of ${withdrawals.length} withdrawals`,
  );
};

/**
 * Propose custody transactions that STRATO recorded but the Safe service never received,
 * using the relayer's saved copy. Returns the withdrawals whose saved transaction can never
 * execute because its Safe nonce was used by something else; those must be aborted.
 */
export const proposeRecordedCustodyTxs = async (
  withdrawals: Array<{ id: Number; safeTxHash: string }>,
  externalChainId: number,
): Promise<Number[]> => {
  const unexecutable: Number[] = [];
  const toPropose: SafeTransactionData[] = [];
  const onChainNonces = new Map<string, number>();
  const existingPayouts = await findWithdrawalPayouts(externalChainId, payoutSafes());

  for (const { id, safeTxHash } of withdrawals) {
    const entry = await withdrawalProposalJournal.get(safeTxHash);
    if (!entry) {
      logError(
        "BridgeService",
        new Error(
          `Withdrawal ${id} points at Safe transaction ${safeTxHash}, which the Safe service does not have and this relayer has no copy of; resolve it manually`,
        ),
      );
      continue;
    }

    // Neither propose nor abort while the Safe holds any payout for this withdrawal
    const existing = existingPayouts.get(String(id)) ?? [];
    if (existing.length > 0) {
      logError(
        "BridgeService",
        new Error(
          `Withdrawal ${id} records custody tx ${safeTxHash}, but the Safe holds payout(s) ${existing.map((p) => p.safeTxHash).join(", ")} for it; resolve it manually`,
        ),
      );
      continue;
    }

    const { safeAddress, nonce } = entry.proposal;
    if (!onChainNonces.has(safeAddress)) {
      onChainNonces.set(safeAddress, await getSafeOnChainNonce(externalChainId, safeAddress));
    }
    // It was never proposed, so nobody else could have signed or executed it: a used nonce
    // means another transaction took the slot and this payout can never happen
    if (nonce < onChainNonces.get(safeAddress)!) {
      logInfo(
        "BridgeService",
        `Withdrawal ${id} custody tx ${safeTxHash} was never proposed and Safe nonce ${nonce} is already used; aborting so the escrow is refunded`,
      );
      unexecutable.push(id);
      continue;
    }
    logInfo(
      "BridgeService",
      `Withdrawal ${id} custody tx ${safeTxHash} was recorded on STRATO but never proposed; proposing the saved transaction`,
    );
    toPropose.push(entry.proposal);
  }

  if (toPropose.length > 0) {
    const proposed = await proposeSafeTransactions(toPropose as NonEmptyArray<SafeTransactionData>);
    await withdrawalProposalJournal.markProposed(proposed);
  }
  return unexecutable;
};

export const finaliseWithdrawalBatch = async (
  ids: NonEmptyArray<Number>,
) => {
  try {
    await execute({
      contractName: "MercataBridge",
      contractAddress: config.bridge.address!,
      method: "finaliseWithdrawalBatch",
      args: {
        ids,
      },
    });

    logInfo(
      "BridgeService",
      `Successfully finalized ${ids.length} withdrawals`,
    );
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    // Check if this is a bad state error (expected when multiple servers finalize same withdrawals)
    if (errorMessage.includes("MB: bad state")) {
      logInfo(
        "BridgeService",
        `Withdrawals already finalized by another server: ${ids.length} withdrawals (${ids.join(", ")})`,
      );
      return; // Gracefully handle already finalized withdrawals
    }
    
    // Re-throw other errors
    throw error;
  }
};

/**
 * Split rejected Mercata withdrawals into those safe to abort and those the
 * external chain says were already paid (finalize instead). Anything that
 * cannot be determined is held: it appears in neither list and is looked at
 * again on the next poll.
 */
export const triageRejectedWithdrawals = async (
  rejected: WithdrawalInfo[],
): Promise<{ abort: Number[]; finalize: Number[] }> => {
  const out = { abort: [] as Number[], finalize: [] as Number[] };
  if (rejected.length === 0) return out;
  const [sourceChainId, chains] = await Promise.all([
    getStratoNetworkId(),
    getEnabledChains(),
  ]);
  for (const w of rejected) {
    const id = Number(w.withdrawalId);
    const router = chains.get(Number(w.externalChainId))?.depositRouter;
    // No router means a chain that settles by plain Safe transfer, which has
    // no on-chain flag to consult: the pre-fast-path behaviour applies.
    if (!router) { out.abort.push(id); continue; }
    const { decision } = await decideRejectedWithdrawal(`withdrawal ${id}`, {
      kind: "mercata",
      chainId: Number(w.externalChainId),
      contract: router,
      sourceChainId,
      sourceBridge: config.bridge.address!,
      withdrawalId: id,
    });
    if (decision === "abort") out.abort.push(id);
    else if (decision === "finalize") out.finalize.push(id);
  }
  return out;
};

export const handleRejectedWithdrawalBatch = async (
  ids: NonEmptyArray<Number>,
) => {

  try {
    await execute({
      contractName: "MercataBridge",
      contractAddress: config.bridge.address!,
      method: "abortWithdrawalBatch",
      args: {
        ids,
      },
    });

    logInfo(
      "BridgeService",
      `Successfully aborted ${ids.length} rejected withdrawals`,
    );
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    // Check if this is a not abortable error (expected when multiple servers abort same withdrawals)
    if (errorMessage.includes("MB: not abortable")) {
      logInfo(
        "BridgeService",
        `Withdrawals already aborted by another server: ${ids.length} withdrawals (${ids.join(", ")})`,
      );
      return; // Gracefully handle already aborted withdrawals
    }
    
    // Re-throw other errors
    throw error;
  }
};

/**
 * Attach the committed fee schedule to native withdrawals, so the mint
 * attestation can carry it.
 *
 * A withdrawal WITHOUT a schedule stays on the V1 attestation and behaves
 * exactly as before. One WITH a schedule must go through V2: the V1 mint
 * refuses a claimed withdrawal outright rather than paying the recipient a
 * second time, so skipping this would strand every fast-path withdrawal at the
 * mint step.
 */
const attachNativeFeeTerms = async (
  withdrawals: NativeWithdrawalInfo[],
): Promise<void> => {
  const terms = await getNativeWithdrawalFeeTerms(
    withdrawals.map((w) => String(w.withdrawalId)),
  );

  for (const withdrawal of withdrawals) {
    const feeTerms = terms.get(String(withdrawal.withdrawalId));
    if (!feeTerms) continue;

    // Only attach the schedule to a bridge that can actually honour it.
    // Attaching it selects the V2 attestation, and a V1-only bridge has no such
    // entry point -- so on an un-upgraded chain this would turn every native
    // withdrawal into a failed mint. Probed rather than assumed, because STRATO
    // writes a schedule for every withdrawal the moment it is upgraded while
    // the destination bridges upgrade on their own schedule.
    const bridgeAddress = getNativeRepresentationBridgeAddress(
      Number(withdrawal.externalChainId),
    );
    if (!bridgeAddress) continue;
    if (!(await representationBridgeSupportsV2(
      Number(withdrawal.externalChainId),
      bridgeAddress,
    ))) {
      logInfo(
        "BridgeService",
        `Representation bridge on chain ${withdrawal.externalChainId} is V1 only; ` +
          `native withdrawal ${withdrawal.withdrawalId} keeps the V1 attestation`,
      );
      continue;
    }

    withdrawal.feeTerms = feeTerms;
  }
};

const ensureNativeWithdrawalPending = async (
  withdrawal: NativeWithdrawalInfo,
): Promise<boolean> => {
  if (String(withdrawal.bridgeStatus) === "2") {
    return true;
  }

  await execute({
    contractName: "StratoNativeBridge",
    contractAddress: config.nativeBridge.address!,
    method: "markWithdrawalPending",
    args: {
      id: Number(withdrawal.withdrawalId),
    },
  });
  return false;
};

const getNativeInstantWithdrawalDelayRemaining = (
  withdrawal: NativeWithdrawalInfo,
): number => {
  const notBefore = BigInt(withdrawal.nativeMintNotBefore || 0);
  if (notBefore <= 0n) {
    return 0;
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  return notBefore > now ? Number(notBefore - now) : 0;
};

export const finalizeNativeWithdrawalBatch = async (
  withdrawals: NonEmptyArray<NativeWithdrawalInfo>,
) => {
  if (!config.nativeBridge.address) {
    throw new Error("Native bridge address not configured");
  }

  await attachNativeFeeTerms(withdrawals);
  const sourceChainId = await getStratoNetworkId();
  const failures: Array<{ withdrawalId: string; message: string }> = [];
  let successful = 0;

  for (const withdrawal of withdrawals) {
    if (!withdrawal.useInstantPath) {
      failures.push({
        withdrawalId: withdrawal.withdrawalId,
        message: "native withdrawal is not instant-eligible",
      });
      continue;
    }

    try {
      const alreadyPending = await ensureNativeWithdrawalPending(withdrawal);
      if (!alreadyPending) {
        logInfo(
          "BridgeService",
          `Native instant withdrawal ${withdrawal.withdrawalId} moved to pending review`,
        );
        continue;
      }

      const delayRemaining = getNativeInstantWithdrawalDelayRemaining(withdrawal);
      if (delayRemaining > 0) {
        logInfo(
          "BridgeService",
          `Native instant withdrawal ${withdrawal.withdrawalId} is pending review for ${delayRemaining}s before destination mint`,
        );
        continue;
      }

      if (!(await isDestinationMintReady(withdrawal))) {
        continue;
      }

      let externalTxHash =
        pendingNativeInstantWithdrawalTxHashes.get(withdrawal.withdrawalId) ||
        await findExistingNativeMint(withdrawal, sourceChainId);
      if (!externalTxHash) {
        externalTxHash = await submitNativeMint(withdrawal, sourceChainId);
      }
      pendingNativeInstantWithdrawalTxHashes.set(
        withdrawal.withdrawalId,
        externalTxHash,
      );

      // A pending finalize throws; the mint hash stays cached so the retry reuses it
      await execute({
        contractName: "StratoNativeBridge",
        contractAddress: config.nativeBridge.address!,
        method: "finalizeWithdrawal",
        args: {
          id: Number(withdrawal.withdrawalId),
          externalTxHash,
          nativeMintProposalHash: "",
        },
      });

      pendingNativeInstantWithdrawalTxHashes.delete(withdrawal.withdrawalId);
      successful += 1;
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (
        errorMessage.includes("SNB: bad state") ||
        errorMessage.includes("SNB: tx hash already set")
      ) {
        pendingNativeInstantWithdrawalTxHashes.delete(withdrawal.withdrawalId);
        logInfo(
          "BridgeService",
          `Native withdrawal already finalized by another server: ${withdrawal.withdrawalId}`,
        );
        continue;
      }

      failures.push({
        withdrawalId: withdrawal.withdrawalId,
        message: errorMessage,
      });
      logError("BridgeService", error as Error, {
        operation: "finalizeNativeWithdrawalBatch",
        withdrawalId: withdrawal.withdrawalId,
        externalChainId: withdrawal.externalChainId,
      });
    }
  }

  if (successful > 0) {
    logInfo(
      "BridgeService",
      `Successfully finalized ${successful} native withdrawals`,
    );
  }

  if (failures.length > 0) {
    throw new Error(
      `Failed to finalize ${failures.length} native withdrawals: ${failures
        .map((failure) => `${failure.withdrawalId} (${failure.message})`)
        .join(", ")}`,
    );
  }
};

export const queueManualNativeWithdrawalBatch = async (
  withdrawals: NonEmptyArray<NativeWithdrawalInfo>,
) => {
  if (!config.nativeBridge.address) {
    throw new Error("Native bridge address not configured");
  }

  await attachNativeFeeTerms(withdrawals);
  const sourceChainId = await getStratoNetworkId();

  for (const withdrawal of withdrawals) {
    // No `useInstantPath` skip: the hot-key mint lane is gone, so an
    // instant-flagged withdrawal is proposed to the Safe like any other.
    const recordedProposalReference = normalizeOptionalHash(
      withdrawal.nativeMintProposalHash,
    );
    const existingProposalReference =
      recordedProposalReference ||
      normalizeOptionalHash(
        announcedManualNativeWithdrawals.get(withdrawal.withdrawalId),
      );

    if (existingProposalReference) {
      try {
        if (!recordedProposalReference) {
          await recordNativeWithdrawalProposal(
            withdrawal.withdrawalId,
            existingProposalReference,
          );
        }
        await syncManualNativeMintProposal(
          withdrawal,
          existingProposalReference,
        );
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (
          errorMessage.includes("SNB: bad state") ||
          errorMessage.includes("SNB: tx hash already set")
        ) {
          announcedManualNativeWithdrawals.delete(withdrawal.withdrawalId);
          continue;
        }
        logError("BridgeService", error as Error, {
          operation: "syncManualNativeMintProposal",
          withdrawalId: withdrawal.withdrawalId,
          externalChainId: withdrawal.externalChainId,
        });
      }
      continue;
    }

    try {
      const alreadyPending = await ensureNativeWithdrawalPending(withdrawal);
      if (!alreadyPending) {
        logInfo(
          "BridgeService",
          `Native withdrawal ${withdrawal.withdrawalId} moved to pending review before manual proposal`,
        );
        continue;
      }
      const proposalReference = await proposeManualNativeMint(
        withdrawal,
        sourceChainId,
      );
      announcedManualNativeWithdrawals.set(
        withdrawal.withdrawalId,
        proposalReference,
      );
      await recordNativeWithdrawalProposal(withdrawal.withdrawalId, proposalReference);

      try {
        await sendEmail(proposalReference, withdrawal.externalChainId);
      } catch (emailError) {
        logError("BridgeService", emailError as Error, {
          operation: "sendEmail",
          safeTxHash: proposalReference,
          withdrawalId: withdrawal.withdrawalId,
        });
      }

      const baseMessage =
        `Native withdrawal ${withdrawal.withdrawalId} exceeds the instant threshold and remains pending manual approval/execution`;
      const suffix = proposalReference
        ? ` (reference: ${proposalReference})`
        : "";
      logInfo("BridgeService", `${baseMessage}${suffix}`);
    } catch (error) {
      logError("BridgeService", error as Error, {
        operation: "queueManualNativeWithdrawalBatch",
        withdrawalId: withdrawal.withdrawalId,
        externalChainId: withdrawal.externalChainId,
      });
    }
  }
};
