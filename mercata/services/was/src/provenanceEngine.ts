import {
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

const compareAmounts = (left: string, right: string): number => {
  const leftAmount = BigInt(left || "0");
  const rightAmount = BigInt(right || "0");
  if (leftAmount > rightAmount) return 1;
  if (leftAmount < rightAmount) return -1;
  return 0;
};

const subtractAmounts = (left: string, right: string): string =>
  (BigInt(left || "0") - BigInt(right || "0")).toString();

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
    const from = makeInputLot(
      lot,
      eventAttribute(lot, "from"),
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
  node: WithdrawalAuditTraceNode;
}

const traceLotsBackward = async (
  context: TraceContext,
  withdrawalEvent: TraceCursor["beforeEvent"],
  repository: WithdrawalCandidateRepository,
): Promise<ProvenanceTraceResult> => {
  const coverage = zeroCoverage("0");
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
    "unknown",
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
      node: traceTree,
    },
  ];
  let stoppedEarly = false;

  while (queue.length) {
    const { cursor, node } = queue.shift()!;

    if (context.maxDepth !== undefined && cursor.depth >= context.maxDepth) {
      stoppedEarly = true;
      addCoverage(coverage, "unknown", cursor.amount);
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

    const fundingLots = await repository.fetchFundingLots(cursor);

    if (!fundingLots.length) {
      addCoverage(coverage, "unknown", cursor.amount);
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
    for (const lot of fundingLots) {
      coveredByLots = addAmounts(coveredByLots, lot.amount);
      const lotNode = createNode(
        "lot",
        lot.source,
        "unknown",
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

      const edge = await resolveTraceEdge(lot);
      const trustAnchor = await repository.fetchTrustAnchor(edge);

      if (trustAnchor) {
        addCoverage(coverage, "clean", lot.amount);
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
        addCoverage(coverage, "tainted", lot.amount);
        continue;
      }

      if (edge.from && edge.result !== "unknown") {
        const cursorNode = createNode(
          "cursor",
          "TraceCursor",
          "unknown",
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
          node: cursorNode,
        });
        continue;
      }

      addCoverage(coverage, "unknown", lot.amount);
    }

    if (compareAmounts(coveredByLots, cursor.amount) < 0) {
      const unknownRemainder = subtractAmounts(cursor.amount, coveredByLots);
      addCoverage(coverage, "unknown", unknownRemainder);
      node.children.push(
        createNode(
          "unknown",
          "FundingRemainderUnknown",
          "unknown",
          "Funding lots did not fully cover this trace cursor.",
          {
            actor: cursor.owner,
            token: cursor.token,
            amount: unknownRemainder,
            evidence: {
              requiredAmount: cursor.amount,
              coveredAmount: coveredByLots,
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

    return {
      status: "complete",
      decision: "MANUAL_REVIEW",
      riskLevel: "medium",
      withdrawal: context.withdrawal,
      maxDepth: context.maxDepth,
      stoppedEarly: traceResult.stoppedEarly,
      coverage: traceResult.coverage,
      summary: traceResult.summary,
      traceTree: traceResult.traceTree,
      updatedAt: new Date().toISOString(),
    };
  },

  classifyCoverage: (_lots: TraceLot[], requestedAmount: string) =>
    zeroCoverage(requestedAmount),

  resolveTraceEdge,
});
