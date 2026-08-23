import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "antd";
import { CheckCircle2, Loader2, Clock, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUser } from "@/context/UserContext";
import { api } from "@/lib/axios";
import { formatBalance } from "@/utils/numberUtils";
import { formatTxHash } from "@/lib/bridge/utils";
import {
  claimTrustlessDeposit,
  fetchConfiguredChains,
  fetchFinalizedHead,
  fetchPendingDeposits,
  type ConfiguredChain,
  type FinalizedHead,
  type PendingDeposit,
  type TrustlessClaimStep,
  type TrustlessClaimResult,
} from "@/lib/bridge/trustlessClaim";
import type { WalletTxProgressEvent } from "@/lib/axios";
import type { BridgeToken } from "@strato/shared-types";

/**
 * Trustless deposit-claim modal. Two phases:
 *
 *   1. Picker — choose a configured source chain (button row), see the
 *      list of unclaimed deposits for the user's wallet(s) on that
 *      chain, and pick one to claim. Each row is badged Ready vs
 *      Waiting based on the live finalized head (polled every 5s).
 *   2. Claim — once a row is clicked, the existing build_proof →
 *      submit_strato → complete progress UI takes over.
 */
type ModalPhase = "picker" | "claim";

interface TrustlessClaimModalProps {
  open: boolean;
  onClose: () => void;
  /** Optional pre-selected chainId — used to default-select in the picker. */
  initialChainId?: string | number;
  walletAuth?: any;
  walletTxProgress?: (e: WalletTxProgressEvent) => void;
  onClaimed?: (result: TrustlessClaimResult) => void;
}

const FINALIZED_HEAD_POLL_MS = 5_000;
const PENDING_DEPOSITS_POLL_MS = 60_000;

/**
 * Local error boundary for the modal body. Without this, a render
 * crash inside the modal (e.g. an unexpected response shape after a
 * failed claim) unmounts the whole BridgeIn page tree — the user
 * sees a blank screen instead of a recoverable error. Catching here
 * keeps the rest of the app intact and gives the user a way out.
 *
 * The `resetKey` prop is consumed via getDerivedStateFromProps so that
 * closing + reopening the modal (or starting a fresh claim) clears any
 * cached error state — otherwise the boundary stays stuck on the
 * fallback UI until the user reloads the whole page.
 */
class ModalErrorBoundary extends React.Component<
  { children: React.ReactNode; onClose: () => void; resetKey: string | number },
  { error?: Error; lastResetKey: string | number }
> {
  constructor(props: { children: React.ReactNode; onClose: () => void; resetKey: string | number }) {
    super(props);
    this.state = { lastResetKey: props.resetKey };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  static getDerivedStateFromProps(
    props: { resetKey: string | number },
    state: { error?: Error; lastResetKey: string | number },
  ) {
    if (props.resetKey !== state.lastResetKey) {
      return { error: undefined, lastResetKey: props.resetKey };
    }
    return null;
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[TrustlessClaimModal] render crash:", error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="space-y-4">
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-red-500" />
            <p className="text-sm font-medium text-red-500">
              Something went wrong displaying this dialog.
            </p>
          </div>
          <p className="text-xs text-muted-foreground font-mono break-all">
            {this.state.error.message || String(this.state.error)}
          </p>
        </div>
        <Button onClick={this.props.onClose} variant="outline" className="w-full">
          Close
        </Button>
      </div>
    );
  }
}

/**
 * Best-effort coercion of any error-y value to a flat user-readable
 * string. Backend error bodies for failed claims can come back as
 * `{ message, status, type }` (StratoError) or `{ error: "..." }`
 * (validation errors) or just a bare string; the modal renders this
 * verbatim, so if anything but a string slips through we hit React
 * error #31 ("Objects are not valid as a React child"). Centralised
 * here so every entry point gets the same treatment.
 */
function describeErrorForUI(err: any): string {
  if (!err) return "trustless claim failed";
  if (typeof err === "string") return err;
  const data = err?.response?.data;
  if (data) {
    if (typeof data === "string") return data;
    if (typeof data.error === "string") return data.error;
    if (typeof data.message === "string") return data.message;
    // Some upstream errors are JSON-stringified objects in
    // `data.error`; surface a compact form rather than [object Object].
    if (data.error) {
      try { return JSON.stringify(data.error); } catch { /* fall through */ }
    }
    try { return JSON.stringify(data); } catch { /* fall through */ }
  }
  if (typeof err.message === "string") return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

const TrustlessClaimModal: React.FC<TrustlessClaimModalProps> = ({
  open,
  onClose,
  initialChainId,
  walletAuth,
  walletTxProgress,
  onClaimed,
}) => {
  const { userAddress, externalEvmWalletAddress } = useUser();

  // ─── Picker state ─────────────────────────────────────────────────
  const [phase, setPhase] = useState<ModalPhase>("picker");
  const [chains, setChains] = useState<ConfiguredChain[] | undefined>(undefined);
  const [chainsError, setChainsError] = useState<string | undefined>();
  const [selectedChainId, setSelectedChainId] = useState<string | undefined>(
    initialChainId !== undefined ? String(initialChainId) : undefined,
  );
  const [finalizedHead, setFinalizedHead] = useState<FinalizedHead | undefined>();
  const [deposits, setDeposits] = useState<PendingDeposit[] | undefined>();
  const [depositsLoading, setDepositsLoading] = useState(false);
  const [depositsError, setDepositsError] = useState<string | undefined>();
  /** Cache of bridgeable-token metadata per chain so we can render
   *  amounts with the right symbol + decimals. */
  const [tokensByChain, setTokensByChain] = useState<Record<string, BridgeToken[]>>({});

  // ─── Claim state (phase 2) ───────────────────────────────────────
  const [claimingTxHash, setClaimingTxHash] = useState<string | undefined>();
  /** The row currently being claimed. Retry replays it verbatim — the
   *  tx hash alone isn't enough because the claim needs the row's
   *  routeType to pick the standard vs native path. */
  const [claimingDeposit, setClaimingDeposit] = useState<PendingDeposit | undefined>();
  const [step, setStep] = useState<TrustlessClaimStep | "idle">("idle");
  const [error, setError] = useState<string | undefined>();
  const [waiting, setWaiting] = useState<
    | {
        /** "finality" = Eth beacon-finality lag (deterministic ETA).
         *  "anchor"  = Base/Cannon proposer hasn't anchored the deposit's
         *  L2 block on L1 yet (no ETA — proposer cadence varies). */
        kind: "finality" | "anchor";
        etaSeconds?: number;
        receivedAt: number;
        depositBlockNumber?: string;
        finalizedBlockNumber?: string;
        finalityLagSeconds?: number;
      }
    | undefined
  >();
  const [now, setNow] = useState<number>(() => Date.now());
  const [result, setResult] = useState<TrustlessClaimResult | undefined>();
  const [collapsedSteps, setCollapsedSteps] = useState<Set<number>>(new Set());
  const lastActiveStepRef = useRef<number>(-1);

  // ─── Wallet list — both connected wallets, deduped ────────────────
  // STRATO `userAddress` from cirrus arrives bare (no 0x); MetaMask's
  // `externalEvmWalletAddress` always has it. Canonicalize so the
  // backend can topic-filter cleanly.
  const wallets = useMemo(() => {
    const ensure0x = (a: string) =>
      a.toLowerCase().startsWith("0x") ? a.toLowerCase() : `0x${a.toLowerCase()}`;
    const out: string[] = [];
    if (externalEvmWalletAddress) out.push(ensure0x(externalEvmWalletAddress));
    if (userAddress) {
      const u = ensure0x(userAddress);
      if (!out.includes(u)) out.push(u);
    }
    return out;
  }, [userAddress, externalEvmWalletAddress]);

  // ─── On-open / re-open: reset transient state, fetch chains ───────
  useEffect(() => {
    if (!open) return;
    setPhase("picker");
    setStep("idle");
    setError(undefined);
    setWaiting(undefined);
    setResult(undefined);
    setClaimingTxHash(undefined);
    setClaimingDeposit(undefined);
    setChainsError(undefined);
    fetchConfiguredChains()
      .then((c) => setChains(c))
      .catch((err: any) => {
        setChainsError(err?.message ?? "failed to load chains");
        setChains([]);
      });
  }, [open]);

  // Default-select the first chain (or initialChainId) once chains load.
  useEffect(() => {
    if (!chains) return;
    if (chains.length === 0) {
      setSelectedChainId(undefined);
      return;
    }
    if (selectedChainId && chains.some((c) => c.chainId === selectedChainId)) return;
    const initial =
      initialChainId !== undefined
        ? chains.find((c) => c.chainId === String(initialChainId))
        : undefined;
    setSelectedChainId((initial ?? chains[0]).chainId);
  }, [chains, initialChainId, selectedChainId]);

  const selectedChain = useMemo(
    () => chains?.find((c) => c.chainId === selectedChainId),
    [chains, selectedChainId],
  );

  // ─── Token-metadata cache per chain (for symbol + decimals) ───────
  useEffect(() => {
    if (!selectedChainId || tokensByChain[selectedChainId]) return;
    api
      .get<BridgeToken[]>(`/bridge/bridgeableTokens/${selectedChainId}`)
      .then(({ data }) => {
        if (!Array.isArray(data)) return;
        setTokensByChain((prev) => ({ ...prev, [selectedChainId]: data }));
      })
      .catch(() => {
        setTokensByChain((prev) => ({ ...prev, [selectedChainId]: [] }));
      });
  }, [selectedChainId, tokensByChain]);

  // ─── Pending-deposits load + 60s refresh ──────────────────────────
  useEffect(() => {
    if (phase !== "picker" || !selectedChainId || wallets.length === 0) return;
    let cancelled = false;
    const load = async () => {
      setDepositsLoading(true);
      setDepositsError(undefined);
      try {
        const list = await fetchPendingDeposits(selectedChainId, wallets);
        if (!cancelled) setDeposits(list);
      } catch (err: any) {
        if (!cancelled) setDepositsError(err?.message ?? "failed to load deposits");
      } finally {
        if (!cancelled) setDepositsLoading(false);
      }
    };
    load();
    const id = setInterval(load, PENDING_DEPOSITS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, selectedChainId, wallets.join(",")]);

  // ─── Finalized-head poll (5s) ─────────────────────────────────────
  useEffect(() => {
    if (phase !== "picker" || !selectedChainId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const head = await fetchFinalizedHead(selectedChainId);
        if (!cancelled) setFinalizedHead(head);
      } catch {
        /* swallow; UI shows previous head until next poll */
      }
    };
    load();
    const id = setInterval(load, FINALIZED_HEAD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, selectedChainId]);

  // Reset deposits when the chain changes so we don't render stale rows.
  useEffect(() => {
    setDeposits(undefined);
    setFinalizedHead(undefined);
  }, [selectedChainId]);

  // ─── ETA countdown tick ───────────────────────────────────────────
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waiting]);

  const remainingSec =
    waiting && waiting.etaSeconds !== undefined
      ? Math.max(0, waiting.etaSeconds - Math.floor((now - waiting.receivedAt) / 1000))
      : undefined;
  const formatMmSs = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // ─── Phase 2 (claim): step list + UI scaffolding ──────────────────
  const flavor = result?.flavor ?? selectedChain?.flavor;
  const isBase = flavor === "base";
  const isLinea = flavor === "linea";
  const isL2 = isBase || isLinea;

  const submitDescription = (() => {
    if (result?.anchorSkipped && result?.l1AnchorSkipped) {
      return "All anchors already on-chain — only the claim transaction needs your signature.";
    }
    if (result?.anchorSkipped) {
      return "Block already anchored — only the claim transaction needs your signature.";
    }
    if (isL2) {
      const l2Name = isBase ? "Base" : "Linea";
      return result?.l1AnchorSkipped
        ? `Sign the ${l2Name} anchor + claim transactions in your wallet.`
        : `Sign the L1 anchor + ${l2Name} anchor + claim transactions in your wallet.`;
    }
    return "Sign the anchorBlockHeader + claim transactions in your wallet.";
  })();

  const buildProofDescription = isBase
    ? "Backend locates a covering dispute game on L1, walks Base headers from the anchor down to your deposit, and assembles the receipts MPT proof."
    : isLinea
    ? "Backend locates a covering finalization (DataFinalizedV3) on L1, walks Linea headers from the anchor down to your deposit, and assembles the receipts MPT proof."
    : "Backend assembles the finality update + receipts MPT proof for your deposit.";

  const steps: { key: TrustlessClaimStep; label: string; description: string }[] = [
    { key: "build_proof", label: "Build Inclusion Proof", description: buildProofDescription },
    { key: "submit_strato", label: "Submit on STRATO", description: submitDescription },
    { key: "complete", label: "Claim Complete", description: "Funds have been credited to your STRATO wallet." },
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

  // ─── Click handler — kick off the claim ───────────────────────────
  const onClickDeposit = async (deposit: PendingDeposit) => {
    if (!selectedChainId) return;
    setPhase("claim");
    setClaimingTxHash(deposit.txHash);
    setClaimingDeposit(deposit);
    setStep("idle");
    setError(undefined);
    setWaiting(undefined);
    setResult(undefined);
    try {
      const r = await claimTrustlessDeposit({
        externalChainId: selectedChainId,
        externalTxHash: deposit.txHash,
        routeType: deposit.routeType,
        walletAuth,
        walletTxProgress,
        onProgress: (s) => setStep(s),
      });
      setResult(r);
      onClaimed?.(r);
      // Refresh deposit list so the now-claimed row drops out.
      try {
        const list = await fetchPendingDeposits(selectedChainId, wallets);
        setDeposits(list);
      } catch {
        /* ignore */
      }
    } catch (err: any) {
      const code = err?.response?.data?.code;
      if (code === "NOT_FINALIZED_YET") {
        const details = err?.response?.data?.details;
        setWaiting({
          kind: "finality",
          etaSeconds:
            typeof details?.etaSeconds === "number" ? details.etaSeconds : undefined,
          receivedAt: Date.now(),
          depositBlockNumber: details?.depositBlockNumber,
          finalizedBlockNumber: details?.finalizedBlockNumber,
          finalityLagSeconds: details?.finalityLagSeconds,
        });
        setStep("error");
        return;
      }
      if (code === "NO_MATCHING_DISPUTE_GAME" || code === "NO_MATCHING_FINALIZATION") {
        // L2 deposit not yet anchored on L1 — Base: no covering DGC;
        // Linea: no covering DataFinalizedV3. Same UX: surface as a
        // wait-state with no concrete ETA (proposers/aggregators anchor
        // on their own cadence) so the user can retry once an anchor
        // lands.
        setWaiting({
          kind: "anchor",
          etaSeconds: undefined,
          receivedAt: Date.now(),
          depositBlockNumber: undefined,
          finalizedBlockNumber: undefined,
          finalityLagSeconds: undefined,
        });
        setStep("error");
        return;
      }
      const msg = describeErrorForUI(err);
      setError(code ? `${msg} [${code}]` : msg);
      setStep("error");
    }
  };

  const onRetry = async () => {
    if (!claimingDeposit || !selectedChainId) return;
    return onClickDeposit(claimingDeposit);
  };

  const onBackToPicker = () => {
    setPhase("picker");
    setStep("idle");
    setError(undefined);
    setWaiting(undefined);
    setResult(undefined);
    setClaimingTxHash(undefined);
    setClaimingDeposit(undefined);
  };

  const refreshDeposits = async () => {
    if (!selectedChainId || wallets.length === 0) return;
    setDepositsLoading(true);
    setDepositsError(undefined);
    try {
      const list = await fetchPendingDeposits(selectedChainId, wallets);
      setDeposits(list);
    } catch (err: any) {
      setDepositsError(err?.message ?? "failed to load deposits");
    } finally {
      setDepositsLoading(false);
    }
  };

  // ─── Token-symbol/decimals lookup for the deposit row ─────────────
  const tokenInfo = (deposit: PendingDeposit) => {
    if (!selectedChainId) return undefined;
    const list = tokensByChain[selectedChainId] ?? [];
    const lower = deposit.ethToken.toLowerCase();
    return list.find((t) => t.externalToken?.toLowerCase() === lower);
  };

  const formatAmount = (deposit: PendingDeposit) => {
    const info = tokenInfo(deposit);
    const decimals = info ? Number(info.externalDecimals) : 18;
    const symbol = info?.externalSymbol ?? "TOKENS";
    const formatted = formatBalance(deposit.amount, undefined, decimals, undefined, 6);
    return `${formatted} ${symbol}`;
  };

  const isReadyToClaim = (deposit: PendingDeposit): boolean => {
    if (!finalizedHead) return false;
    return BigInt(deposit.blockNumber) <= BigInt(finalizedHead.blockNumber);
  };

  // ─── Modal chrome ─────────────────────────────────────────────────
  const inClaim = phase === "claim";
  const canClose = !inClaim || step === "idle" || step === "complete" || step === "error";

  const titleText = inClaim
    ? waiting
      ? waiting.kind === "anchor"
        ? flavor === "linea"
          ? "Waiting for L1 finalization"
          : "Waiting for L1 anchor"
        : "Waiting for Ethereum finality"
      : isError
      ? "Claim Failed"
      : step === "complete"
      ? "Claim Complete"
      : "Processing Claim"
    : "Claim Deposit Trustlessly";

  const titleIcon = inClaim
    ? waiting
      ? <Clock className="w-5 h-5 text-blue-500" />
      : isError
      ? <AlertCircle className="w-5 h-5 text-red-500" />
      : step === "complete"
      ? <CheckCircle2 className="w-5 h-5 text-green-500" />
      : <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
    : <Clock className="w-5 h-5 text-blue-500" />;

  const getStepIcon = (idx: number) => {
    if (effectiveStepIndex === -1) return <Clock className="w-5 h-5 text-muted-foreground" />;
    if (idx < effectiveStepIndex) return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    if (idx === effectiveStepIndex) {
      if (waiting) return <Clock className="w-5 h-5 text-blue-500" />;
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
      width={620}
      className="[&_.ant-modal-content]:rounded-xl [&_.ant-modal-content]:bg-card [&_.ant-modal-content]:text-foreground [&_.ant-modal-header]:border-b [&_.ant-modal-header]:border-border [&_.ant-modal-header]:bg-card [&_.ant-modal-body]:p-6 [&_.ant-modal-body]:text-foreground [&_.ant-modal-title]:text-foreground [&_.ant-modal-footer]:bg-card [&_.ant-modal-footer]:border-border [&_.ant-modal-close]:text-muted-foreground"
    >
      <ModalErrorBoundary
        // `key` is React-special: when it changes, React fully unmounts
        // and remounts the boundary, clearing any cached error. We
        // change it whenever the user closes/reopens the modal or kicks
        // off a different claim attempt. This is more robust than
        // getDerivedStateFromProps (which had a render-order race
        // against the on-open useEffect that resets phase + txHash).
        key={`${open ? "o" : "c"}|${phase}|${claimingTxHash ?? ""}`}
        onClose={onClose}
        resetKey={`${open ? "o" : "c"}|${phase}|${claimingTxHash ?? ""}`}
      >
      {!inClaim && (
        <PickerView
          chains={chains}
          chainsError={chainsError}
          selectedChainId={selectedChainId}
          setSelectedChainId={setSelectedChainId}
          finalizedHead={finalizedHead}
          deposits={deposits}
          depositsLoading={depositsLoading}
          depositsError={depositsError}
          wallets={wallets}
          formatAmount={formatAmount}
          isReadyToClaim={isReadyToClaim}
          onClickDeposit={onClickDeposit}
          onRefresh={refreshDeposits}
        />
      )}

      {inClaim && (
        <div className="space-y-6">
          {claimingTxHash && (
            <div className="text-xs text-muted-foreground">
              Claiming tx <span className="font-mono">{formatTxHash(claimingTxHash)}</span>
            </div>
          )}

          {waiting && waiting.kind === "finality" && (
            <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <p className="text-sm text-blue-500 font-medium">
                Your deposit hasn't reached Ethereum finality yet.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Trustless claims require the deposit's block to be finalized on
                the beacon chain — typically about{" "}
                {waiting.finalityLagSeconds
                  ? `${Math.round(waiting.finalityLagSeconds / 60)} minutes`
                  : "13 minutes"}{" "}
                after inclusion. Try again once the timer below reaches zero.
              </p>
              {remainingSec !== undefined && (
                <p className="mt-3 text-sm font-mono text-foreground">
                  ETA: {remainingSec === 0 ? "ready — retry now" : formatMmSs(remainingSec)}
                </p>
              )}
              {(waiting.depositBlockNumber || waiting.finalizedBlockNumber) && (
                <p className="mt-2 text-[11px] font-mono text-muted-foreground">
                  deposit block {waiting.depositBlockNumber} · finalized{" "}
                  {waiting.finalizedBlockNumber}
                </p>
              )}
              <div className="mt-3">
                <Button onClick={onRetry} variant="outline" className="w-full">
                  Retry now
                </Button>
              </div>
            </div>
          )}

          {waiting && waiting.kind === "anchor" && (
            <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <p className="text-sm text-blue-500 font-medium">
                {flavor === "linea"
                  ? "Waiting for L1 finalization of your Linea block."
                  : "Waiting for an L1 anchor for your Base block."}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {flavor === "linea"
                  ? "Linea claims require a DataFinalizedV3 event on L1 " +
                    "whose endBlock covers your deposit's L2 block. The " +
                    "Linea aggregator submits these on its own cadence " +
                    "(typically every hour or so). Try again once a " +
                    "covering finalization has landed."
                  : "Base claims require a DisputeGameCreated event on L1 that " +
                    "anchors your deposit's L2 block. Proposers submit these on " +
                    "their own cadence (typically every few minutes on mainnet, " +
                    "up to an hour or two on testnet). Try again once a covering " +
                    "dispute game has been posted."}
              </p>
              <div className="mt-3">
                <Button onClick={onRetry} variant="outline" className="w-full">
                  Retry now
                </Button>
              </div>
            </div>
          )}

          {(isError || error) && !waiting && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="text-sm text-red-500">
                {error || "Trustless claim failed. See console for details."}
              </p>
            </div>
          )}

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
                    <span className="text-sm font-medium text-foreground">{s.label}</span>
                  </div>
                  {!collapsed && (
                    <p className="mt-1 text-xs text-muted-foreground pl-8">{s.description}</p>
                  )}
                </div>
              );
            })}
          </div>

          {step === "complete" && result && (
            <div className="text-xs text-muted-foreground space-y-1">
              <div>
                {result.flavor === "base"
                  ? "Base block"
                  : result.flavor === "linea"
                  ? "Linea block"
                  : "Block"} anchored: {result.blockNumber}
              </div>
              {result.hashes.map((h, i) => (
                <div key={i} className="font-mono">
                  tx {i + 1}: {formatTxHash(h)}
                </div>
              ))}
            </div>
          )}

          {(step === "complete" || step === "error") && (
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={onBackToPicker} variant="outline">
                Back to deposits
              </Button>
              <Button onClick={onClose} variant="outline">
                Close
              </Button>
            </div>
          )}
        </div>
      )}
      </ModalErrorBoundary>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────
// Picker subview — chain buttons + deposit rows.
// Extracted to keep the parent component readable; pure presentational.
// ─────────────────────────────────────────────────────────────────────

interface PickerViewProps {
  chains: ConfiguredChain[] | undefined;
  chainsError: string | undefined;
  selectedChainId: string | undefined;
  setSelectedChainId: (id: string) => void;
  finalizedHead: FinalizedHead | undefined;
  deposits: PendingDeposit[] | undefined;
  depositsLoading: boolean;
  depositsError: string | undefined;
  wallets: string[];
  formatAmount: (d: PendingDeposit) => string;
  isReadyToClaim: (d: PendingDeposit) => boolean;
  onClickDeposit: (d: PendingDeposit) => void;
  onRefresh: () => void;
}

const PickerView: React.FC<PickerViewProps> = ({
  chains,
  chainsError,
  selectedChainId,
  setSelectedChainId,
  finalizedHead,
  deposits,
  depositsLoading,
  depositsError,
  wallets,
  formatAmount,
  isReadyToClaim,
  onClickDeposit,
  onRefresh,
}) => {
  if (chainsError) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
        <p className="text-sm text-red-500">Failed to load chains: {chainsError}</p>
      </div>
    );
  }
  if (!chains) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading source chains…
      </div>
    );
  }
  if (chains.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No source chains are currently configured for trustless bridging.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">Source chain</p>
        <div className="flex flex-wrap gap-2">
          {
            // Dedupe by chainId — a chain registered for both standard
            // and native routes returns two rows from /configuredChains
            // (one per route), but the picker is keyed by chain. The
            // pending-deposit list shows both routes together per chain.
            Array.from(
              new Map(chains.map((c) => [c.chainId, c])).values(),
            ).map((c) => {
              const active = c.chainId === selectedChainId;
              return (
                <button
                  key={c.chainId}
                  type="button"
                  onClick={() => setSelectedChainId(c.chainId)}
                  className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                    active
                      ? "border-blue-500 bg-blue-500/10 text-foreground"
                      : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/30"
                  }`}
                >
                  {c.name}
                </button>
              );
            })
          }
        </div>
        {finalizedHead && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {finalizedHead.flavor === "base"
              ? "Latest L1-anchored block: "
              : finalizedHead.flavor === "linea"
              ? "Latest L1-finalized block: "
              : "Finalized block: "}
            {finalizedHead.blockNumber}
          </p>
        )}
      </div>

      {wallets.length === 0 && (
        <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <p className="text-xs text-yellow-600">
            Connect a wallet to discover unclaimed deposits sent to your address.
          </p>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-muted-foreground">Pending deposits</p>
          <button
            type="button"
            onClick={onRefresh}
            disabled={depositsLoading}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${depositsLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {depositsError ? (
          <p className="text-xs text-red-500">{depositsError}</p>
        ) : depositsLoading && !deposits ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" /> Scanning recent deposits…
          </div>
        ) : deposits && deposits.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No unclaimed deposits found for your wallet
            {wallets.length > 1 ? "s" : ""} on this chain.
          </p>
        ) : (
          <div className="space-y-2">
            {(deposits ?? []).map((d) => {
              const ready = isReadyToClaim(d);
              return (
                <button
                  key={`${d.routeType}-${d.txHash}-${d.logIndex}`}
                  type="button"
                  onClick={() => onClickDeposit(d)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    ready
                      ? "border-green-500/40 bg-green-500/5 hover:bg-green-500/10"
                      : "border-border bg-muted/20 hover:bg-muted/30"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium text-foreground truncate">
                          {formatAmount(d)}
                        </div>
                        {d.routeType === "native" && (
                          <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-600 uppercase tracking-wide">
                            Native
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-muted-foreground truncate">
                        {formatTxHash(d.txHash)} · block {d.blockNumber}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                        ready
                          ? "bg-green-500/20 text-green-600"
                          : "bg-blue-500/20 text-blue-500"
                      }`}
                    >
                      {ready
                        ? "Ready"
                        : finalizedHead?.flavor === "base"
                        ? "Waiting for L1 anchor"
                        : finalizedHead?.flavor === "linea"
                        ? "Waiting for L1 finalization"
                        : "Waiting for finality"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        The backend builds the cryptographic proof and packages a 1-, 2-, or
        3-transaction batch for your wallet to sign on STRATO. Only the
        on-chain verifiers determine validity — no relayer trust is involved.
      </p>
    </div>
  );
};

export default TrustlessClaimModal;
