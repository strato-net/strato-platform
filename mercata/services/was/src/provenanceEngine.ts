import {
  WithdrawalAuditDecision,
  WithdrawalAuditRiskLevel,
  WithdrawalAuditTrace,
  WithdrawalAuditTraceNode,
} from "@mercata/shared-types";
import {
  ProvenanceEngine,
  ProvenanceTraceResult,
  TraceContext,
  TraceCoverage,
  TraceCursor,
  TraceEdge,
  TraceLot,
  WithdrawalCandidateRepository,
} from "./types";
import { logInfo } from "./logger";
import { createTraceOperationLogger } from "./traceOperationLogger";

const zeroCoverage = (unknown: string): TraceCoverage => ({
  clean: "0",
  tainted: "0",
  unknown,
});

const addAmounts = (left: string, right: string): string =>
  (BigInt(left || "0") + BigInt(right || "0")).toString();

const addCoverage = (
  coverage: TraceCoverage,
  result: TraceEdge["result"],
  amount: string,
) => {
  if (result === "clean") {
    coverage.clean = addAmounts(coverage.clean, amount);
  } else if (result === "tainted") {
    coverage.tainted = addAmounts(coverage.tainted, amount);
  } else {
    coverage.unknown = addAmounts(coverage.unknown, amount);
  }
};

export const classifyTraceCoverage = (
  coverage: TraceCoverage,
): {
  decision: WithdrawalAuditDecision;
  riskLevel: WithdrawalAuditRiskLevel;
  summary: string;
} => {
  if (BigInt(coverage.tainted || "0") > 0n) {
    return {
      decision: "REJECT",
      riskLevel: "high",
      summary: "Trace found tainted provenance and should be rejected.",
    };
  }

  if (BigInt(coverage.unknown || "0") > 0n) {
    return {
      decision: "MANUAL_REVIEW",
      riskLevel: "medium",
      summary: "Trace has unknown provenance and requires manual review.",
    };
  }

  return {
    decision: "APPROVE",
    riskLevel: "low",
    summary: "Trace reached verified trust anchors for all covered value.",
  };
};

const compareAmounts = (left: string, right: string): number => {
  const leftAmount = BigInt(left || "0");
  const rightAmount = BigInt(right || "0");
  if (leftAmount > rightAmount) return 1;
  if (leftAmount < rightAmount) return -1;
  return 0;
};

const subtractAmounts = (left: string, right: string): string =>
  (BigInt(left || "0") - BigInt(right || "0")).toString();

const normalizeAddress = (address: string): string =>
  address.toLowerCase().replace(/^0x/, "");

const ZERO_ADDRESS = "0000000000000000000000000000000000000000";

const eventAttribute = (lot: TraceLot, key: string): string | undefined => {
  const value = lot.event?.attributes[key];
  return value === undefined ? undefined : String(value);
};

const edgeUnknown = (lot: TraceLot, explanation: string): TraceEdge => ({
  type: lot.source === "unknown" ? "unsupported" : lot.source,
  to: lot,
  event: lot.event,
  result: "unknown",
  explanation,
});

const makeInputLot = (
  lot: TraceLot,
  owner: string | undefined,
  token: string | undefined,
  amount: string | undefined,
  source: TraceLot["source"],
): TraceLot | undefined => {
  if (!owner || !token || !amount) return undefined;
  return {
    owner,
    token,
    amount,
    transactionHash: lot.event?.transaction_hash || lot.transactionHash,
    blockNumber: lot.event?.block_number || lot.blockNumber,
    source,
    event: lot.event,
  };
};

const resolveTraceEdge = async (lot: TraceLot): Promise<TraceEdge> => {
  if (!lot.event) {
    return edgeUnknown(lot, "Lot has no event evidence to resolve.");
  }

  if (lot.source === "transfer") {
    const fromAddress = eventAttribute(lot, "from");
    if (fromAddress && normalizeAddress(fromAddress) === ZERO_ADDRESS) {
      return {
        type: "transfer",
        to: lot,
        event: lot.event,
        result: "tainted",
        explanation: "Transfer lot is an unverified mint from the zero address.",
      };
    }

    const from = makeInputLot(
      lot,
      fromAddress,
      lot.token,
      lot.amount,
      "transfer",
    );
    if (!from) {
      return edgeUnknown(lot, "Transfer event is missing sender evidence.");
    }

    return {
      type: "transfer",
      from,
      to: lot,
      event: lot.event,
      result: "info",
      explanation: "Transfer lot traces backward to the sender.",
    };
  }

  if (lot.source === "swap") {
    const from = makeInputLot(
      lot,
      eventAttribute(lot, "sender"),
      eventAttribute(lot, "tokenIn"),
      eventAttribute(lot, "amountIn"),
      "transfer",
    );
    if (!from) {
      return edgeUnknown(lot, "Swap event is missing input token or amount.");
    }

    return {
      type: "swap",
      from,
      to: lot,
      event: lot.event,
      result: "info",
      explanation: "Swap output traces backward to the swap input.",
    };
  }

  if (lot.source === "metal_mint") {
    const from = makeInputLot(
      lot,
      eventAttribute(lot, "buyer"),
      eventAttribute(lot, "payToken"),
      eventAttribute(lot, "payAmount"),
      "transfer",
    );
    if (!from) {
      return edgeUnknown(lot, "Metal mint event is missing payment evidence.");
    }

    return {
      type: "metal_mint",
      from,
      to: lot,
      event: lot.event,
      result: "info",
      explanation: "Metal mint output traces backward to the payment token.",
    };
  }

  if (lot.source === "psm") {
    const from = makeInputLot(
      lot,
      eventAttribute(lot, "user"),
      eventAttribute(lot, "againstToken"),
      eventAttribute(lot, "depositAmount"),
      "transfer",
    );
    if (!from) {
      return edgeUnknown(lot, "PSM mint event is missing deposited token evidence.");
    }

    return {
      type: "psm",
      from,
      to: lot,
      event: lot.event,
      result: "info",
      explanation: "PSM mint output traces backward to the deposited token.",
    };
  }

  if (lot.source === "cdp_mint") {
    return edgeUnknown(
      lot,
      "CDP mint collateral provenance is not enabled until collateral semantics are verified.",
    );
  }

  if (lot.source === "rewards") {
    return edgeUnknown(
      lot,
      "Rewards funding provenance is not enabled until reward source semantics are verified.",
    );
  }

  return edgeUnknown(lot, "Unsupported funding lot source.");
};

interface TraceQueueItem {
  cursor: TraceCursor;
  coverageAmount: string;
  node: WithdrawalAuditTraceNode;
}

const traceLotsBackward = async (
  context: TraceContext,
  withdrawalEvent: TraceCursor["beforeEvent"],
  repository: WithdrawalCandidateRepository,
): Promise<ProvenanceTraceResult> => {
  const traceId = `${context.withdrawal.routeType}:${context.withdrawal.withdrawalId}`;
  const traceOperationLogger = createTraceOperationLogger(traceId);
  const logTraceOperation = (
    operation: string,
    data: Record<string, unknown> = {},
  ) => {
    logInfo("ProvenanceEngine", operation, data);
    traceOperationLogger.log(operation, data);
  };
  const coverage = zeroCoverage("0");
  const trustedProtocolAddresses = new Set(
    (context.trustedProtocolAddresses || []).map(normalizeAddress),
  );
  const skipAddresses = new Set(
    (context.skipAddresses || []).map(normalizeAddress),
  );
  const summary: string[] = [];
  let nextNodeId = 0;
  const createNode = (
    type: WithdrawalAuditTraceNode["type"],
    label: string,
    result: WithdrawalAuditTraceNode["result"],
    explanation: string,
    fields: Partial<Omit<WithdrawalAuditTraceNode, "id" | "type" | "label" | "result" | "explanation" | "children">> = {},
  ): WithdrawalAuditTraceNode => ({
    id: `trace-node-${nextNodeId++}`,
    type,
    label,
    result,
    explanation,
    actor: fields.actor,
    token: fields.token,
    amount: fields.amount,
    evidence: fields.evidence || {},
    children: [],
  });
  const traceTree = createNode(
    "withdrawal",
    context.withdrawal.routeType === "native"
      ? "NativeWithdrawalRequested"
      : "WithdrawalRequested",
    "info",
    "Withdrawal request located; provenance classification awaits trace edge implementation.",
    {
      actor: context.withdrawal.stratoSender,
      token: context.withdrawal.stratoToken,
      amount: context.withdrawal.stratoTokenAmount,
      evidence: {
        routeType: context.withdrawal.routeType,
        withdrawalId: context.withdrawal.withdrawalId,
        transactionHash: withdrawalEvent?.transaction_hash || "",
      },
    },
  );
  const queue: TraceQueueItem[] = [
    {
      cursor: {
        owner: context.withdrawal.stratoSender,
        token: context.withdrawal.stratoToken,
        amount: context.withdrawal.stratoTokenAmount,
        depth: 0,
        beforeEvent: withdrawalEvent,
      },
      coverageAmount: context.withdrawal.stratoTokenAmount,
      node: traceTree,
    },
  ];
  let stoppedEarly = false;

  logTraceOperation("Trace loop started", {
    traceId,
    owner: context.withdrawal.stratoSender,
    token: context.withdrawal.stratoToken,
    amount: context.withdrawal.stratoTokenAmount,
    maxDepth: context.maxDepth ?? "none",
  });

  while (queue.length) {
    const { cursor, coverageAmount, node } = queue.shift()!;
    logTraceOperation("Trace cursor started", {
      traceId,
      depth: cursor.depth,
      queueRemaining: queue.length,
      owner: cursor.owner,
      token: cursor.token,
      evidenceAmount: cursor.amount,
      coverageAmount,
      beforeBlock: cursor.beforeEvent?.block_number || "",
      beforeTx: cursor.beforeEvent?.transaction_hash || "",
    });

    if (context.maxDepth !== undefined && cursor.depth >= context.maxDepth) {
      stoppedEarly = true;
      logTraceOperation("Trace cursor stopped at max depth", {
        traceId,
        depth: cursor.depth,
        maxDepth: context.maxDepth,
        coverageAmount,
      });
      addCoverage(coverage, "unknown", coverageAmount);
      node.children.push(
        createNode(
          "max_depth",
          "MaxDepthReached",
          "unknown",
          "Trace stopped before this cursor reached a trust anchor.",
          {
            actor: cursor.owner,
            token: cursor.token,
            amount: cursor.amount,
            evidence: {
              maxDepth: String(context.maxDepth),
              depth: String(cursor.depth),
              transactionHash: cursor.beforeEvent?.transaction_hash || "",
            },
          },
        ),
      );
      continue;
    }

    if (trustedProtocolAddresses.has(normalizeAddress(cursor.owner))) {
      logTraceOperation("Trace cursor reached trusted protocol address", {
        traceId,
        depth: cursor.depth,
        owner: cursor.owner,
        token: cursor.token,
        evidenceAmount: cursor.amount,
        coverageAmount,
      });
      addCoverage(coverage, "clean", coverageAmount);
      node.children.push(
        createNode(
          "trust_anchor",
          "TrustedProtocolAddress",
          "clean",
          "Trace stopped at a configured trusted protocol address.",
          {
            actor: cursor.owner,
            token: cursor.token,
            amount: cursor.amount,
            evidence: {
              depth: String(cursor.depth),
              trustedProtocolAddress: cursor.owner,
            },
          },
        ),
      );
      continue;
    }

    if (skipAddresses.has(normalizeAddress(cursor.owner))) {
      logTraceOperation("Trace cursor skipped by address", {
        traceId,
        depth: cursor.depth,
        owner: cursor.owner,
        token: cursor.token,
        evidenceAmount: cursor.amount,
        coverageAmount,
      });
      addCoverage(coverage, "unknown", coverageAmount);
      node.children.push(
        createNode(
          "unknown",
          "SkippedAddress",
          "unknown",
          "Trace stopped because this address is configured to be skipped.",
          {
            actor: cursor.owner,
            token: cursor.token,
            amount: cursor.amount,
            evidence: {
              depth: String(cursor.depth),
              skippedAddress: cursor.owner,
            },
          },
        ),
      );
      continue;
    }

    logTraceOperation("Fetching funding lots", {
      traceId,
      depth: cursor.depth,
      owner: cursor.owner,
      token: cursor.token,
      amount: cursor.amount,
    });
    const fundingLots = await repository.fetchFundingLots(cursor);
    logTraceOperation("Funding lots fetched", {
      traceId,
      depth: cursor.depth,
      count: fundingLots.length,
      totalAmount: fundingLots
        .reduce((total, lot) => total + BigInt(lot.amount || "0"), 0n)
        .toString(),
    });

    if (!fundingLots.length) {
      logTraceOperation("No funding lots found", {
        traceId,
        depth: cursor.depth,
        coverageAmount,
      });
      addCoverage(coverage, "unknown", coverageAmount);
      node.children.push(
        createNode(
          "unknown",
          "FundingLotsMissing",
          "unknown",
          "No funding lots found for this trace cursor.",
          {
            actor: cursor.owner,
            token: cursor.token,
            amount: cursor.amount,
            evidence: {
              depth: String(cursor.depth),
              transactionHash: cursor.beforeEvent?.transaction_hash || "",
            },
          },
        ),
      );
      continue;
    }

    let coveredByLots = "0";
    let coveredByLotsCoverage = "0";
    const cursorAmount = BigInt(cursor.amount || "0");
    const cursorCoverageAmount = BigInt(coverageAmount || "0");
    const totalFundingAmount = fundingLots.reduce(
      (total, lot) => total + BigInt(lot.amount || "0"),
      0n,
    );

    for (const [index, lot] of fundingLots.entries()) {
      coveredByLots = addAmounts(coveredByLots, lot.amount);
      const lotAmount = BigInt(lot.amount || "0");
      const isLastLot = index === fundingLots.length - 1;
      const lotCoverageAmount =
        cursorAmount > 0n && isLastLot && totalFundingAmount >= cursorAmount
          ? cursorCoverageAmount - BigInt(coveredByLotsCoverage || "0")
          : (cursorCoverageAmount * lotAmount) / (cursorAmount || 1n);
      const lotCoverageAmountString = lotCoverageAmount.toString();
      coveredByLotsCoverage = addAmounts(
        coveredByLotsCoverage,
        lotCoverageAmountString,
      );
      const lotNode = createNode(
        "lot",
        lot.source,
        "info",
        "Funding lot found for this trace cursor.",
        {
          actor: lot.owner,
          token: lot.token,
          amount: lot.amount,
          evidence: {
            transactionHash: lot.transactionHash || "",
            blockNumber: String(lot.blockNumber || ""),
          },
        },
      );
      node.children.push(lotNode);

      logTraceOperation("Resolving funding lot", {
        traceId,
        depth: cursor.depth,
        lotIndex: index,
        source: lot.source,
        owner: lot.owner,
        token: lot.token,
        evidenceAmount: lot.amount,
        coverageAmount: lotCoverageAmountString,
        tx: lot.transactionHash || "",
        block: lot.blockNumber || "",
      });
      const edge = await resolveTraceEdge(lot);
      logTraceOperation("Trace edge resolved", {
        traceId,
        depth: cursor.depth,
        lotIndex: index,
        edgeType: edge.type,
        result: edge.result,
        hasPredecessor: !!edge.from,
        predecessorOwner: edge.from?.owner || "",
        predecessorToken: edge.from?.token || "",
        predecessorAmount: edge.from?.amount || "",
      });

      logTraceOperation("Checking trust anchor", {
        traceId,
        depth: cursor.depth,
        lotIndex: index,
        edgeType: edge.type,
        tx: edge.event?.transaction_hash || lot.transactionHash || "",
        block: edge.event?.block_number || lot.blockNumber || "",
      });
      const trustAnchor = await repository.fetchTrustAnchor(edge);

      if (trustAnchor) {
        logTraceOperation("Trust anchor found", {
          traceId,
          depth: cursor.depth,
          lotIndex: index,
          trustAnchorType: trustAnchor.type,
          coverageAmount: lotCoverageAmountString,
          tx: trustAnchor.event.transaction_hash || "",
          block: trustAnchor.event.block_number || "",
        });
        addCoverage(coverage, "clean", lotCoverageAmountString);
        lotNode.children.push(
          createNode(
            "trust_anchor",
            trustAnchor.type,
            "clean",
            "Lot reached a verified bridge deposit trust anchor.",
            {
              actor: trustAnchor.owner,
              token: trustAnchor.token,
              amount: trustAnchor.amount,
              evidence: {
                transactionHash: trustAnchor.event.transaction_hash || "",
                blockNumber: String(trustAnchor.event.block_number || ""),
              },
            },
          ),
        );
        continue;
      }

      const edgeNode = createNode(
        "edge",
        edge.type,
        edge.result,
        edge.explanation,
        {
          actor: edge.from?.owner || edge.to.owner,
          token: edge.to.token,
          amount: edge.to.amount,
          evidence: {
            transactionHash:
              edge.event?.transaction_hash || lot.transactionHash || "",
            blockNumber: String(edge.event?.block_number || lot.blockNumber || ""),
          },
        },
      );
      lotNode.children.push(edgeNode);

      if (edge.result === "tainted") {
        logTraceOperation("Tainted terminal edge found", {
          traceId,
          depth: cursor.depth,
          lotIndex: index,
          coverageAmount: lotCoverageAmountString,
        });
        addCoverage(coverage, "tainted", lotCoverageAmountString);
        continue;
      }

      if (edge.from && edge.result !== "unknown") {
        logTraceOperation("Queueing predecessor cursor", {
          traceId,
          nextDepth: cursor.depth + 1,
          owner: edge.from.owner,
          token: edge.from.token,
          evidenceAmount: edge.from.amount,
          coverageAmount: lotCoverageAmountString,
          queueSizeBeforePush: queue.length,
        });
        const cursorNode = createNode(
          "cursor",
          "TraceCursor",
          "info",
          "Tracing the predecessor amount required by this edge.",
          {
            actor: edge.from.owner,
            token: edge.from.token,
            amount: edge.from.amount,
            evidence: {
              depth: String(cursor.depth + 1),
              transactionHash: edge.event?.transaction_hash || "",
            },
          },
        );
        edgeNode.children.push(cursorNode);
        queue.push({
          cursor: {
            owner: edge.from.owner,
            token: edge.from.token,
            amount: edge.from.amount,
            depth: cursor.depth + 1,
            beforeEvent: edge.event,
            sourceLot: edge.from,
          },
          coverageAmount: lotCoverageAmountString,
          node: cursorNode,
        });
        continue;
      }

      logTraceOperation("Unknown terminal edge", {
        traceId,
        depth: cursor.depth,
        lotIndex: index,
        edgeType: edge.type,
        coverageAmount: lotCoverageAmountString,
        explanation: edge.explanation,
      });
      addCoverage(coverage, "unknown", lotCoverageAmountString);
    }

    if (compareAmounts(coveredByLots, cursor.amount) < 0) {
      const unknownRemainder = subtractAmounts(cursor.amount, coveredByLots);
      const unknownCoverageRemainder = subtractAmounts(
        coverageAmount,
        coveredByLotsCoverage,
      );
      logTraceOperation("Funding remainder unknown", {
        traceId,
        depth: cursor.depth,
        requiredAmount: cursor.amount,
        coveredAmount: coveredByLots,
        missingEvidenceAmount: unknownRemainder,
        unknownCoverageAmount: unknownCoverageRemainder,
      });
      addCoverage(coverage, "unknown", unknownCoverageRemainder);
      node.children.push(
        createNode(
          "unknown",
          "FundingRemainderUnknown",
          "unknown",
          "Funding lots did not fully cover this trace cursor.",
          {
            actor: cursor.owner,
            token: cursor.token,
            amount: unknownCoverageRemainder,
            evidence: {
              requiredAmount: cursor.amount,
              coveredAmount: coveredByLots,
              missingEvidenceAmount: unknownRemainder,
              depth: String(cursor.depth),
            },
          },
        ),
      );
    }
  }

  summary.push(
    `Trace coverage: ${coverage.clean} clean, ${coverage.tainted} tainted, ${coverage.unknown} unknown.`,
  );
  if (stoppedEarly) {
    summary.push("Trace stopped before all lots reached terminal evidence.");
  }

  logTraceOperation("Trace loop completed", {
    traceId,
    clean: coverage.clean,
    tainted: coverage.tainted,
    unknown: coverage.unknown,
    stoppedEarly,
  });

  return {
    coverage,
    summary,
    traceTree,
    stoppedEarly,
  };
};

export const createProvenanceEngine = (
  repository: WithdrawalCandidateRepository,
): ProvenanceEngine => ({
  traceWithdrawal: async (
    context: TraceContext,
  ): Promise<WithdrawalAuditTrace> => {
    const withdrawalEvent = await repository.fetchCanonicalWithdrawalEvent(
      context.withdrawal,
    );
    const traceResult = await traceLotsBackward(
      context,
      withdrawalEvent || undefined,
      repository,
    );
    const classification = classifyTraceCoverage(traceResult.coverage);

    return {
      status: "complete",
      decision: classification.decision,
      riskLevel: classification.riskLevel,
      withdrawal: context.withdrawal,
      maxDepth: context.maxDepth,
      stoppedEarly: traceResult.stoppedEarly,
      coverage: traceResult.coverage,
      summary: [...traceResult.summary, classification.summary],
      traceTree: traceResult.traceTree,
      updatedAt: new Date().toISOString(),
    };
  },

  classifyCoverage: (_lots: TraceLot[], requestedAmount: string) =>
    zeroCoverage(requestedAmount),

  resolveTraceEdge,
});
