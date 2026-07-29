import React, { useEffect, useRef, useState } from "react";
import { Modal } from "antd";
import { CheckCircle2, Loader2, Clock, AlertCircle } from "lucide-react";
import { formatTxHash, getExplorerUrl } from "@/lib/bridge/utils";

/**
 * Step progression for the proof-based withdrawal flow. The hot and cold
 * paths share the first three steps (STRATO-side); only "Withdrawal" events
 * proceed past `fetch_proof` to the on-chain claim. Cold-path withdrawals
 * land in `complete_pending` instead, since admin approval is required
 * before funds release.
 */
export type WithdrawalStep =
  | "submit_strato"     // Signing + submitting the approve + requestWithdrawalProof batch on STRATO
  | "fetch_proof"       // Backend fetches inclusion proof for the requestWithdrawalProof tx
  | "switch_chain"      // Wallet network switch to the external chain
  | "catch_up"          // User's seq is ahead of the vault; submitting predecessor proofs first
  | "submit_header"     // Submit STRATO header to STRATOLightClient (skipped if tip already covers the block)
  | "claim_external"    // Call BridgeVault.claimWithdrawal
  | "complete"          // Hot path success
  | "complete_pending"  // Cold path: proof returned but admin approval required
  | "error";

interface WithdrawalProgressModalProps {
  open: boolean;
  currentStep: WithdrawalStep;
  /** External chain id for explorer links + the network name shown to the user. */
  chainId?: number;
  chainName?: string;
  /** Hash of the on-chain claim tx (when present). */
  claimTxHash?: string;
  /** Hash of the submit_header tx (when present, only if header had to be submitted). */
  headerTxHash?: string;
  /** True once the light-client tip already covered the proof block, so the submit_header step was skipped. */
  headerAlreadyKnown?: boolean;
  /**
   * Per-iteration progress for the catch-up step. `index` is 0 while
   * walking predecessors backwards (still planning), then 1..total while
   * submitting them oldest-first. Driven by claimWithdrawalOnExternalChain's
   * onProgress callback.
   */
  catchUpInfo?: { index: number; total: number; seq: number };
  error?: string;
  onClose?: () => void;
}

const WithdrawalProgressModal: React.FC<WithdrawalProgressModalProps> = ({
  open,
  currentStep,
  chainId,
  chainName,
  claimTxHash,
  headerTxHash,
  headerAlreadyKnown = false,
  catchUpInfo,
  error,
  onClose,
}) => {
  const [collapsedSteps, setCollapsedSteps] = useState<Set<number>>(new Set());
  const lastActiveStepRef = useRef<number>(-1);

  const networkLabel = chainName || (chainId ? `chain ${chainId}` : "external chain");
  const isPending = currentStep === "complete_pending";

  const steps: { key: WithdrawalStep; label: string; description: string }[] = [
    {
      key: "submit_strato",
      label: "Submit on STRATO",
      description: "Sign the approve + withdrawal transactions in your wallet.",
    },
    {
      key: "fetch_proof",
      label: "Generate Inclusion Proof",
      description: "STRATO is producing the cryptographic proof of your withdrawal.",
    },
    {
      key: "switch_chain",
      label: `Switch to ${networkLabel}`,
      description: `Switch your wallet's network to ${networkLabel} to complete the claim.`,
    },
    {
      key: "catch_up",
      label: "Catch Up Earlier Withdrawals",
      description: catchUpInfo
        ? catchUpInfo.index === 0
          ? `Found ${catchUpInfo.total} earlier withdrawal${catchUpInfo.total === 1 ? "" : "s"} that must be submitted first. Fetching proofs...`
          : `Submitting predecessor ${catchUpInfo.index} of ${catchUpInfo.total} (seq ${catchUpInfo.seq}). Each one needs a wallet signature.`
        : "Submitting earlier queued withdrawals so yours can release.",
    },
    {
      key: "submit_header",
      label: "Anchor STRATO Header",
      description: headerAlreadyKnown
        ? "Header already anchored on-chain — skipped."
        : `Submitting the signed STRATO header to the light client on ${networkLabel}.`,
    },
    {
      key: "claim_external",
      label: `Claim on ${networkLabel}`,
      description: `Submitting the proof and releasing funds via BridgeVault on ${networkLabel}.`,
    },
    {
      key: "complete",
      label: "Withdrawal Complete",
      description: `Funds have been released on ${networkLabel}.`,
    },
  ];

  const pendingSteps: { key: WithdrawalStep; label: string; description: string }[] = [
    steps[0],
    steps[1],
    {
      key: "complete_pending",
      label: "Pending Admin Approval",
      description:
        "Withdrawal recorded on STRATO. The amount exceeds the instant-claim threshold and requires admin approval before being released on the external chain.",
    },
  ];

  // Pick the step list based on whether we know we're in the cold path. Until
  // fetch_proof completes we use the hot list (it shows the optimistic path);
  // once we land on `complete_pending` we swap to the trimmed pending list.
  const stepsToShow = isPending ? pendingSteps : steps;

  const rawStepIndex = stepsToShow.findIndex((s) => s.key === currentStep);
  const isError = currentStep === "error";

  if (rawStepIndex >= 0) {
    lastActiveStepRef.current = rawStepIndex;
  }
  const effectiveStepIndex = isError ? lastActiveStepRef.current : rawStepIndex;

  useEffect(() => {
    if (effectiveStepIndex >= 0) {
      const next = new Set<number>();
      for (let i = 0; i < stepsToShow.length; i++) {
        if (i !== effectiveStepIndex) next.add(i);
      }
      setCollapsedSteps(next);
    }
  }, [effectiveStepIndex, stepsToShow.length]);

  const getStepIcon = (stepIndex: number) => {
    const step = stepsToShow[stepIndex];
    const isTerminal = step?.key === "complete" || step?.key === "complete_pending";

    if (effectiveStepIndex === -1) {
      return <Clock className="w-5 h-5 text-muted-foreground" />;
    }
    if (stepIndex < effectiveStepIndex) {
      return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    }
    if (stepIndex === effectiveStepIndex) {
      if (isError) return <AlertCircle className="w-5 h-5 text-red-500" />;
      if (isTerminal && step?.key === "complete") return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      if (isTerminal && step?.key === "complete_pending") return <Clock className="w-5 h-5 text-yellow-500" />;
      // Skipped submit_header still shows a green check.
      if (step?.key === "submit_header" && headerAlreadyKnown) {
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      }
      return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
    }
    return <Clock className="w-5 h-5 text-muted-foreground" />;
  };

  const getStepStatus = (stepIndex: number) => {
    if (effectiveStepIndex === -1) return "pending";
    if (stepIndex < effectiveStepIndex) return "completed";
    if (stepIndex === effectiveStepIndex) {
      if (isError) return "error";
      const step = stepsToShow[stepIndex];
      if (step?.key === "complete") return "completed";
      if (step?.key === "complete_pending") return "pending_approval";
      return "active";
    }
    return "pending";
  };

  const canClose =
    currentStep === "complete" || currentStep === "complete_pending" || currentStep === "error";

  const titleText = isError
    ? "Withdrawal Failed"
    : currentStep === "complete"
    ? "Withdrawal Complete"
    : currentStep === "complete_pending"
    ? "Pending Admin Approval"
    : "Processing Withdrawal";

  const titleIcon = isError ? (
    <AlertCircle className="w-5 h-5 text-red-500" />
  ) : currentStep === "complete" ? (
    <CheckCircle2 className="w-5 h-5 text-green-500" />
  ) : currentStep === "complete_pending" ? (
    <Clock className="w-5 h-5 text-yellow-500" />
  ) : (
    <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
  );

  return (
    <Modal
      title={
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
            {titleIcon}
          </div>
          <span className="text-lg font-semibold text-foreground">{titleText}</span>
        </div>
      }
      open={open}
      onCancel={canClose ? onClose : undefined}
      footer={
        canClose ? (
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Close
          </button>
        ) : null
      }
      closable={canClose}
      maskClosable={canClose}
      width={550}
      className="[&_.ant-modal-content]:rounded-xl [&_.ant-modal-content]:bg-card [&_.ant-modal-content]:text-foreground [&_.ant-modal-header]:border-b [&_.ant-modal-header]:border-border [&_.ant-modal-header]:bg-card [&_.ant-modal-body]:p-6 [&_.ant-modal-body]:text-foreground [&_.ant-modal-title]:text-foreground [&_.ant-modal-footer]:bg-card [&_.ant-modal-footer]:border-border [&_.ant-modal-close]:text-muted-foreground"
    >
      <div className="space-y-6">
        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        <div className="space-y-2">
          {stepsToShow.map((step, index) => {
            const status = getStepStatus(index);
            const isActive = status === "active";
            const isCompleted = status === "completed";
            const isStepError = status === "error";
            const isPendingApproval = status === "pending_approval";
            const isCurrentStep = index === effectiveStepIndex;
            const isCollapsed = collapsedSteps.has(index);

            const txForStep =
              step.key === "submit_header" ? headerTxHash : step.key === "claim_external" ? claimTxHash : undefined;

            return (
              <div
                key={step.key}
                className={`rounded-lg transition-all ${
                  isActive
                    ? "bg-blue-500/10 border-2 border-blue-500/30"
                    : isCompleted
                    ? "bg-green-500/10 border border-green-500/30"
                    : isPendingApproval
                    ? "bg-yellow-500/10 border border-yellow-500/30"
                    : isStepError
                    ? "bg-red-500/10 border border-red-500/30"
                    : "bg-muted/30 border border-border"
                }`}
              >
                {isCollapsed ? (
                  <div
                    className={`flex items-center gap-3 px-4 py-2 transition-colors cursor-pointer ${
                      isPendingApproval
                        ? "hover:bg-yellow-500/20"
                        : isCompleted
                        ? "hover:bg-green-500/20"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() =>
                      setCollapsedSteps((prev) => {
                        const next = new Set(prev);
                        next.delete(index);
                        return next;
                      })
                    }
                  >
                    <div className="flex-shrink-0">{getStepIcon(index)}</div>
                    <div className="flex-1 min-w-0">
                      <h4
                        className={`font-medium text-sm ${
                          isPendingApproval
                            ? "text-yellow-500"
                            : isCompleted
                            ? "text-green-500"
                            : "text-muted-foreground"
                        }`}
                      >
                        {step.label}
                      </h4>
                    </div>
                    <span
                      className={`text-xs ${
                        isPendingApproval
                          ? "text-yellow-500"
                          : isCompleted
                          ? "text-green-500"
                          : "text-muted-foreground"
                      }`}
                    >
                      Click to expand
                    </span>
                  </div>
                ) : (
                  <div className="flex items-start gap-4 p-4">
                    <div className="flex-shrink-0 mt-0.5">{getStepIcon(index)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h4
                          className={`font-medium ${
                            isActive
                              ? "text-blue-500"
                              : isPendingApproval
                              ? "text-yellow-500"
                              : isCompleted
                              ? "text-green-500"
                              : isStepError
                              ? "text-red-500"
                              : "text-muted-foreground"
                          }`}
                        >
                          {step.label}
                        </h4>
                        <div className="flex items-center gap-2">
                          {isActive && (
                            <span className="text-xs text-blue-500 font-medium">In Progress</span>
                          )}
                          <button
                            onClick={() =>
                              setCollapsedSteps((prev) => new Set(prev).add(index))
                            }
                            className={`text-xs underline ${
                              isPendingApproval
                                ? "text-yellow-500 hover:text-yellow-600"
                                : isCompleted
                                ? "text-green-500 hover:text-green-600"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            Collapse
                          </button>
                        </div>
                      </div>
                      <p
                        className={`text-sm mt-1 ${
                          isActive
                            ? "text-blue-500/80"
                            : isPendingApproval
                            ? "text-yellow-500/80"
                            : isCompleted
                            ? "text-green-500/80"
                            : isStepError
                            ? "text-red-500/80"
                            : "text-muted-foreground"
                        }`}
                      >
                        {step.description}
                      </p>
                      {txForStep && chainId && (
                        <div className="mt-2">
                          <a
                            href={getExplorerUrl(chainId.toString(), txForStep)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:text-blue-800 underline"
                          >
                            View Transaction: {formatTxHash(txForStep)} →
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
};

export default WithdrawalProgressModal;
