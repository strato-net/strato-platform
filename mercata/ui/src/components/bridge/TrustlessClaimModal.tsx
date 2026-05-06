import React, { useEffect, useRef, useState } from "react";
import { Modal } from "antd";
import { CheckCircle2, Loader2, Clock, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatTxHash } from "@/lib/bridge/utils";
import {
  claimTrustlessDeposit,
  type TrustlessClaimStep,
  type TrustlessClaimResult,
} from "@/lib/bridge/trustlessClaim";
import type { WalletTxProgressEvent } from "@/lib/axios";

/**
 * Step progression for the trustless deposit-claim flow. Strict
 * subset of WithdrawalStep — there's no chain switch (STRATO is the
 * destination) and no catch-up (anchorBlockHeader is per-block, not
 * per-seq).
 */

interface TrustlessClaimModalProps {
  open: boolean;
  onClose: () => void;
  /** Source-chain id and tx hash. When omitted the modal collects them via inputs. */
  initialChainId?: string | number;
  initialTxHash?: string;
  /** Pass-through so the caller's wallet auth ↔ axios interceptor wiring works. */
  walletAuth?: any;
  walletTxProgress?: (e: WalletTxProgressEvent) => void;
  /** Notify the parent so it can refresh balances / recent transactions. */
  onClaimed?: (result: TrustlessClaimResult) => void;
}

const TrustlessClaimModal: React.FC<TrustlessClaimModalProps> = ({
  open,
  onClose,
  initialChainId,
  initialTxHash,
  walletAuth,
  walletTxProgress,
  onClaimed,
}) => {
  const [chainId, setChainId] = useState<string>(
    initialChainId === undefined ? "" : String(initialChainId),
  );
  const [txHash, setTxHash] = useState<string>(initialTxHash ?? "");
  const [step, setStep] = useState<TrustlessClaimStep | "idle">("idle");
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<TrustlessClaimResult | undefined>();
  const [collapsedSteps, setCollapsedSteps] = useState<Set<number>>(new Set());
  const lastActiveStepRef = useRef<number>(-1);

  useEffect(() => {
    if (open) {
      // Reset transient state on open. Inputs persist if the parent
      // explicitly threaded them through (initialChainId/initialTxHash).
      setStep("idle");
      setError(undefined);
      setResult(undefined);
      if (initialChainId !== undefined) setChainId(String(initialChainId));
      if (initialTxHash) setTxHash(initialTxHash);
    }
  }, [open, initialChainId, initialTxHash]);

  // Phase copy depends on which flow ran. The Cannon path involves a
  // dispute-game search + parent-chain walk under the build_proof
  // phase; Eth-flavor is just a finality update + receipts proof.
  // We only know the flavor once the result lands, so the build_proof
  // copy is intentionally generic before that.
  const flavor = result?.flavor;
  const isBase = flavor === "base";

  const submitDescription = (() => {
    if (result?.anchorSkipped && result?.l1AnchorSkipped) {
      return "All anchors already on-chain — only the claim transaction needs your signature.";
    }
    if (result?.anchorSkipped) {
      return "Block already anchored — only the claim transaction needs your signature.";
    }
    if (isBase) {
      return result?.l1AnchorSkipped
        ? "Sign the Base anchor + claim transactions in your wallet."
        : "Sign the L1 anchor + Base anchor + claim transactions in your wallet.";
    }
    return "Sign the anchorBlockHeader + claim transactions in your wallet.";
  })();

  const buildProofDescription = isBase
    ? "Backend locates a covering dispute game on L1, walks Base headers from the anchor down to your deposit, and assembles the receipts MPT proof."
    : "Backend assembles the finality update + receipts MPT proof for your deposit.";

  const steps: { key: TrustlessClaimStep; label: string; description: string }[] = [
    {
      key: "build_proof",
      label: "Build Inclusion Proof",
      description: buildProofDescription,
    },
    {
      key: "submit_strato",
      label: "Submit on STRATO",
      description: submitDescription,
    },
    {
      key: "complete",
      label: "Claim Complete",
      description: "Funds have been credited to your STRATO wallet.",
    },
  ];

  const isError = step === "error";
  const rawStepIndex = steps.findIndex((s) => s.key === step);
  if (rawStepIndex >= 0) lastActiveStepRef.current = rawStepIndex;
  const effectiveStepIndex = isError ? lastActiveStepRef.current : rawStepIndex;

  useEffect(() => {
    if (effectiveStepIndex >= 0) {
      const next = new Set<number>();
      for (let i = 0; i < steps.length; i++) {
        if (i !== effectiveStepIndex) next.add(i);
      }
      setCollapsedSteps(next);
    }
  }, [effectiveStepIndex, steps.length]);

  const validInputs =
    /^[0-9]+$/.test(chainId.trim()) &&
    /^0x[0-9a-fA-F]{64}$/.test(txHash.trim());

  const canClose = step === "idle" || step === "complete" || step === "error";

  const onClaim = async () => {
    setStep("idle");
    setError(undefined);
    setResult(undefined);
    try {
      const r = await claimTrustlessDeposit({
        externalChainId: chainId.trim(),
        externalTxHash: txHash.trim(),
        walletAuth,
        walletTxProgress,
        onProgress: (s) => setStep(s),
      });
      setResult(r);
      onClaimed?.(r);
    } catch (err: any) {
      const code = err?.response?.data?.code;
      const msg =
        err?.response?.data?.error ||
        err?.message ||
        "trustless claim failed";
      setError(code ? `${msg} [${code}]` : msg);
      setStep("error");
    }
  };

  const titleText = isError
    ? "Claim Failed"
    : step === "complete"
    ? "Claim Complete"
    : step === "idle"
    ? "Claim Deposit Trustlessly"
    : "Processing Claim";

  const titleIcon = isError ? (
    <AlertCircle className="w-5 h-5 text-red-500" />
  ) : step === "complete" ? (
    <CheckCircle2 className="w-5 h-5 text-green-500" />
  ) : step === "idle" ? (
    <Clock className="w-5 h-5 text-blue-500" />
  ) : (
    <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
  );

  const getStepIcon = (idx: number) => {
    if (effectiveStepIndex === -1) return <Clock className="w-5 h-5 text-muted-foreground" />;
    if (idx < effectiveStepIndex) return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    if (idx === effectiveStepIndex) {
      if (isError) return <AlertCircle className="w-5 h-5 text-red-500" />;
      if (steps[idx]?.key === "complete") return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
    }
    return <Clock className="w-5 h-5 text-muted-foreground" />;
  };

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
      footer={null}
      closable={canClose}
      maskClosable={canClose}
      width={550}
      className="[&_.ant-modal-content]:rounded-xl [&_.ant-modal-content]:bg-card [&_.ant-modal-content]:text-foreground [&_.ant-modal-header]:border-b [&_.ant-modal-header]:border-border [&_.ant-modal-header]:bg-card [&_.ant-modal-body]:p-6 [&_.ant-modal-body]:text-foreground [&_.ant-modal-title]:text-foreground [&_.ant-modal-footer]:bg-card [&_.ant-modal-footer]:border-border [&_.ant-modal-close]:text-muted-foreground"
    >
      <div className="space-y-6">
        {step === "idle" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Source chain ID
              </label>
              <Input
                value={chainId}
                onChange={(e) => setChainId(e.target.value)}
                placeholder="e.g. 11155111 for Sepolia"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Source transaction hash
              </label>
              <Input
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                placeholder="0x..."
              />
            </div>
            <Button onClick={onClaim} disabled={!validInputs} className="w-full">
              Claim Deposit
            </Button>
            <p className="text-xs text-muted-foreground">
              The backend builds the cryptographic proof and packages a 1- or
              2-transaction batch for your wallet to sign on STRATO. Only the
              on-chain verifiers determine validity — no relayer trust is
              involved.
            </p>
          </div>
        )}

        {step !== "idle" && error && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {step !== "idle" && (
          <div className="space-y-2">
            {steps.map((s, idx) => {
              const isActive = idx === effectiveStepIndex && !isError;
              const isCompleted = idx < effectiveStepIndex;
              const collapsed = collapsedSteps.has(idx);
              return (
                <div
                  key={s.key}
                  className={`p-3 rounded-lg border ${
                    isActive
                      ? "border-blue-500/40 bg-blue-500/5"
                      : isCompleted
                      ? "border-green-500/30 bg-green-500/5"
                      : "border-border bg-muted/20"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {getStepIcon(idx)}
                    <span className="text-sm font-medium text-foreground">
                      {s.label}
                    </span>
                  </div>
                  {!collapsed && (
                    <p className="mt-1 text-xs text-muted-foreground pl-8">
                      {s.description}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {step === "complete" && result && (
          <div className="text-xs text-muted-foreground space-y-1">
            <div>
              {result.flavor === "base" ? "Base block" : "Block"} anchored: {result.blockNumber}
            </div>
            {result.hashes.map((h, i) => (
              <div key={i} className="font-mono">
                tx {i + 1}: {formatTxHash(h)}
              </div>
            ))}
          </div>
        )}

        {(step === "complete" || step === "error") && (
          <Button onClick={onClose} className="w-full" variant="outline">
            Close
          </Button>
        )}
      </div>
    </Modal>
  );
};

export default TrustlessClaimModal;
