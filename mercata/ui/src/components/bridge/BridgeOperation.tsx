import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  useAccount,
  useChainId,
  useBalance as useWagmiBalance,
  useWriteContract,
  useSwitchChain,
  useSignTypedData,
} from "wagmi";
import { Modal } from "antd";

// Internal imports
import { bridgeContractService } from "@/lib/bridge/contractService";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/bridge/constants";
import { BridgeContext } from "@/lib/bridge/types";
import { formatTxHash, getExplorerUrl } from "@/lib/bridge/utils";
import { useBridgeContext } from "@/context/BridgeContext";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { computeMaxTransferable } from "@/utils/validationUtils";
import { safeParseUnits, fmt, formatUnits } from "@/utils/numberUtils";
import { BRIDGE_OUT_FEE, usdstAddress, DECIMALS } from "@/lib/constants";

// Components
import TokenInput from "@/components/shared/TokenInput";
import BridgeWalletStatus from "./BridgeWalletStatus";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

type BridgeOperationType =
  | "bridgeWrap"
  | "bridgeUnwrap"
  | "bridgeMint"
  | "bridgeBurn";

interface BridgeOperationProps {
  operation: BridgeOperationType;
}

// ============================================================================
// CUSTOM HOOKS
// ============================================================================

/**
 * Custom hook for bridge direction logic
 * Centralizes all operation-specific state and configuration
 */
const useBridgeDirection = (
  operation: string,
  selectedNetwork: string | null,
  tokens: {
    selectedMintToken: any;
    selectedToken: any;
    setSelectedMintToken: any;
    setSelectedToken: any;
    redeemableTokens: any[];
    bridgeableTokens: any[];
    availableNetworks: any[];
  }
) => {
  return useMemo(() => {
    const inbound = operation === "bridgeWrap" || operation === "bridgeMint";
    const mint = operation === "bridgeMint" || operation === "bridgeBurn";
    const token = mint ? tokens.selectedMintToken : tokens.selectedToken;
    const setToken = mint ? tokens.setSelectedMintToken : tokens.setSelectedToken;
    const list = mint ? tokens.redeemableTokens : tokens.bridgeableTokens;
    const netCfg = tokens.availableNetworks.find((n) => n.chainName === selectedNetwork) || null;
    const expChainId = netCfg ? Number(netCfg.chainId) : null;
    const native = token?.externalToken === NATIVE_TOKEN_ADDRESS;
    const extDec = Number(token?.externalDecimals ?? DECIMALS);
    const stratoDec = DECIMALS;

    return {
      inbound,
      mint,
      token,
      setToken,
      list,
      netCfg,
      expChainId,
      native,
      extDec,
      stratoDec,
    };
  }, [
    operation,
    selectedNetwork,
    tokens.selectedMintToken,
    tokens.selectedToken,
    tokens.setSelectedMintToken,
    tokens.setSelectedToken,
    tokens.redeemableTokens,
    tokens.bridgeableTokens,
    tokens.availableNetworks,
  ]);
};

/**
 * Custom hook for balance logic
 * Handles all balance-related computations and API calls
 */
const useBalances = ({
  op,
  amount,
  operation,
  tokenAddrIn,
  feeUSDST,
  usdstBalance,
  usdstAddress,
  voucherBalance,
  loadingUsdstBalance,
  address,
  useBalance,
}: {
  op: any;
  amount: string;
  operation: string;
  tokenAddrIn: string;
  feeUSDST: string;
  usdstBalance: any;
  usdstAddress: string;
  voucherBalance: any;
  loadingUsdstBalance: boolean;
  address: string;
  useBalance: any;
}) => {
  // Parse amount without memoization - cheap operation with debounced validation
  const parsedAmount = safeParseUnits(amount || "0", op.inbound ? op.extDec : op.stratoDec);

  // External token balance (for inbound operations)
  const {
    data: externalTokenBalance,
    refetch: refetchExternalToken,
    isLoading: externalTokenLoading,
  } = useWagmiBalance({
    address: address as `0x${string}`,
    token: op.native ? undefined : (op.token?.externalToken as `0x${string}`),
    chainId: op.expChainId ?? undefined,
  });

  // STRATO token balance (for outbound operations)
  const {
    data: balanceData,
    isLoading: isBalanceLoading,
    refetch: refetchBalance,
  } = useBalance(op.token?.stratoToken || null);

  // Maximum amount calculation
  const maxAmount = useMemo(() => {
    if (!op.token) return 0n;
    if (op.inbound) return externalTokenBalance?.value ?? 0n;
    if (operation === "bridgeBurn") return BigInt(usdstBalance || "0");
    const wei = balanceData?.balance ? BigInt(balanceData.balance) : 0n;
    return wei;
  }, [
    op.token,
    op.inbound,
    operation,
    externalTokenBalance?.value,
    usdstBalance,
    balanceData?.balance,
    op.stratoDec,
  ]);

  // Maximum transferable amount (after fees)
  const maxTransferable = useMemo(() => {
    if (!op.token) return 0n;
    const tokenAddress = op.inbound
      ? tokenAddrIn
      : operation === "bridgeBurn"
        ? usdstAddress
        : tokenAddrIn;
    return computeMaxTransferable(maxAmount, tokenAddress, feeUSDST, BigInt(voucherBalance), BigInt(usdstBalance));
  }, [op.token, maxAmount, voucherBalance, usdstBalance, op.inbound, tokenAddrIn, feeUSDST, operation]);

  // Precomputed balance view for UI
  const balancesView = useMemo(() => {
    const sideDec = op.inbound ? op.extDec : op.stratoDec;
    
    // For USDST operations, show available balance after fees
    const displayAmount = (operation === "bridgeBurn" && !op.inbound) ? maxTransferable : maxAmount;
    const post = displayAmount > parsedAmount ? displayAmount - parsedAmount : 0n;
    
    const maxTransferableRaw = maxTransferable === 0n ? "0" : fmt(maxTransferable, op.inbound ? op.extDec : op.stratoDec, 0, 4);
    return {
      before: fmt(displayAmount, sideDec, 2, 2),
      after: fmt(post, sideDec, 2, 2),
      receiveHuman: fmt(parsedAmount, op.inbound ? op.extDec : op.stratoDec, 0, 4),
      maxTransferableRaw,
      maxTransferableFormatted: maxTransferableRaw,
    };
  }, [
    op.inbound,
    op.extDec,
    op.stratoDec,
    maxAmount,
    maxTransferable,
    parsedAmount,
    operation,
  ]);

  // Combined loading state
  const isDataLoading = loadingUsdstBalance || (op.inbound ? externalTokenLoading : isBalanceLoading);

  return {
    maxAmount,
    maxTransferable,
    balancesView,
    isDataLoading,
    refetchExternalToken,
    refetchBalance,
    parsedAmount,
    externalTokenLoading,
    isBalanceLoading,
  };
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const BridgeOperation: React.FC<BridgeOperationProps> = ({ operation }) => {
  // ============================================================================
  // HOOKS & CONTEXT
  // ============================================================================

  // Wagmi hooks
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();
  const { switchChain } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();

  // UI hooks
  const { toast } = useToast();

  // Context hooks
  const { userAddress } = useUser();
  const { loadingUsdstBalance, usdstBalance, voucherBalance, fetchUsdstBalance } = useUserTokens();

  const {
    availableNetworks,
    bridgeableTokens,
    redeemableTokens,
    selectedNetwork,
    setSelectedNetwork,
    selectedToken,
    setSelectedToken,
    selectedMintToken,
    setSelectedMintToken,
    loadNetworksAndTokens,
    fetchRedeemableTokens,
    bridgeOut: bridgeOutAPI,
    redeemOut: redeemOutAPI,
    useBalance,
  } = useBridgeContext();

  // ============================================================================
  // STATE
  // ============================================================================

  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const inFlightRef = useRef(false);

  // ============================================================================
  // DERIVED STATE
  // ============================================================================

  // Bridge direction logic
  const op = useBridgeDirection(operation, selectedNetwork, {
    selectedMintToken,
    selectedToken,
    setSelectedMintToken,
    setSelectedToken,
    redeemableTokens,
    bridgeableTokens,
    availableNetworks,
  });

  // Pure labels - computed as locals near render
  const symbolIn = op.inbound ? op.token?.externalSymbol : op.token?.stratoTokenSymbol;
  const symbolOut = op.inbound
    ? op.mint
      ? "USDST"
      : op.token?.stratoTokenSymbol
    : op.token?.externalSymbol;
  const tokenAddrIn = op.inbound ? op.token?.externalToken : op.token?.stratoToken;
  const feeUSDST = op.inbound ? "0" : BRIDGE_OUT_FEE;
  const targetLabel = op.inbound ? "STRATO" : selectedNetwork;

  // Balance logic
  const {
    maxAmount,
    maxTransferable,
    balancesView,
    isDataLoading,
    refetchExternalToken,
    refetchBalance,
    parsedAmount,
    externalTokenLoading,
    isBalanceLoading,
  } = useBalances({
    op,
    amount,
    operation,
    tokenAddrIn,
    feeUSDST,
    usdstBalance,
    usdstAddress,
    voucherBalance,
    loadingUsdstBalance,
    address,
    useBalance,
  });

  // ============================================================================
  // COMPUTED VALUES
  // ============================================================================

  // Fee validation for non-USDST tokens
  const feeError = useMemo(() => {
    if (op.inbound) return ""; // No fee for inbound operations
    
    const tokenAddress = operation === "bridgeBurn" ? usdstAddress : tokenAddrIn;
    
    // For USDST tokens, computeMaxTransferable already handles fee validation
    if (tokenAddress === usdstAddress) return "";
    
    // For non-USDST tokens, check if user can cover the fee
    const fee = safeParseUnits(feeUSDST || "0", 18);
    const totalAvailableForFee = BigInt(usdstBalance) + BigInt(voucherBalance);
    
    if (totalAvailableForFee < fee) {
      return `Insufficient USDST + vouchers for transaction fee (${feeUSDST} USDST required)`;
    }
    
    return "";
  }, [op.inbound, operation, usdstAddress, tokenAddrIn, feeUSDST, usdstBalance, voucherBalance]);

  // Button text with early returns
  const buttonText = (() => {
    if (isLoading)
      return op.inbound
        ? op.mint
          ? "Minting..."
          : "Bridging..."
        : op.mint
          ? "Burning..."
          : "Unwrapping...";
    if (!isConnected) return "Connect Wallet";
    if (!selectedNetwork) return "Select Network";
    if (!op.token) return "Select Asset";
    if (!amount) return "Enter Amount";
    if (op.inbound && chainId !== op.expChainId)
      return `Switch to ${selectedNetwork}`;
    return op.inbound
      ? op.mint
        ? "Get USDST"
        : "Bridge Assets"
      : op.mint
        ? "Burn USDST"
        : "Bridge Assets";
  })();

  // Action button disabled state
  const actionDisabled =
    isLoading ||
    !amount ||
    !op.token ||
    !isConnected ||
    (op.inbound ? chainId !== op.expChainId : !selectedNetwork) ||
    !!amountError ||
    !!feeError ||
    isDataLoading;

  // Voucher calculation (cheap operation - no memoization needed)
  const vouchers = (() => {
    const feeWei = safeParseUnits(feeUSDST ?? "0", DECIMALS);
    return ((feeWei * 100n) / 10n ** BigInt(DECIMALS)).toString();
  })();

  // ============================================================================
  // VALIDATION & INPUT HANDLING
  // ============================================================================
  // Max click handler
  const handleMaxClick = useCallback(() => {
    if (op.token && maxTransferable > 0n) {
      const maxFormatted = formatUnits(maxTransferable, op.inbound ? op.extDec : op.stratoDec);
      setAmount(maxFormatted);
      setAmountError("");
    }
  }, [op.token, maxTransferable, op.inbound, op.extDec, op.stratoDec]);

  // ============================================================================
  // BRIDGE IN FUNCTIONS
  // ============================================================================

  // Preflight validation with specific error messages
  const preflight = useCallback((): BridgeContext => {
    // Guard once with exact missing fields
    if (!op.token) throw new Error("Missing token selection");
    if (!op.netCfg) throw new Error("Missing network configuration");
    if (!userAddress) throw new Error("Missing user address");
    if (!address) throw new Error("Missing wallet address");
    if (!selectedNetwork) throw new Error("Missing selected network");
    if (!amount) throw new Error("Missing amount");
    if (parsedAmount === 0n) throw new Error("Amount must be greater than zero");

    // Type normalization - ensure all values are properly typed
    return {
      selectedToken: op.token,
      selectedNetwork: selectedNetwork,
      amount,
      userAddress,
      address: address as `0x${string}`,
      activeChainId: op.netCfg.chainId,
      depositRouter: op.netCfg.depositRouter,
      depositAmount: parsedAmount,
      isNative: op.native,
      mintUSDST: op.mint,
    };
  }, [
    op.token,
    op.netCfg,
    userAddress,
    address,
    selectedNetwork,
    amount,
    parsedAmount,
    op.native,
    op.mint,
  ]);

  // On-chain validation
  const validateOnChain = useCallback(async (ctx: BridgeContext) => {
    const validation = await bridgeContractService.validateRouterContract({
      depositRouterAddress: ctx.depositRouter,
      amount: ctx.amount,
      decimals: ctx.selectedToken.externalDecimals,
      chainId: ctx.activeChainId,
      tokenAddress: ctx.selectedToken.externalToken,
      mint: ctx.mintUSDST,
    });
    if (!validation.isValid) {
      throw new Error(validation.error || "Validation failed");
    }
  }, []);

  // Transaction execution
  const executeDeposit = useCallback(
    async (ctx: BridgeContext): Promise<`0x${string}`> => {
      if (ctx.isNative) {
        return await bridgeContractService.executeETHDepositTransaction({
          web3Context: {
            address: ctx.address as `0x${string}`,
            writeContractAsync,
          },
          amount: ctx.amount,
          stratoAddress: ctx.userAddress,
          depositRouter: ctx.depositRouter,
          chainId: ctx.activeChainId,
        });
      } else {
        return await bridgeContractService.executeDepositTransaction({
          web3Context: {
            address: ctx.address as `0x${string}`,
            signTypedDataAsync,
            writeContractAsync,
          },
          tokenInfo: {
            externalToken: ctx.selectedToken.externalToken,
            externalDecimals: ctx.selectedToken.externalDecimals,
          },
          amount: ctx.amount,
          stratoAddress: ctx.userAddress,
          depositRouter: ctx.depositRouter,
          chainId: ctx.activeChainId,
          mintUSDST: ctx.mintUSDST,
        });
      }
    },
    [writeContractAsync, signTypedDataAsync],
  );

  // Bridge pipeline - combines all steps into one async function
  const runBridgeIn = useCallback(async () => {
    const ctx = preflight(); // throws if misconfigured
    await validateOnChain(ctx); // throws if invalid
    const txHash = await executeDeposit(ctx); // throws if rejected
    const ok = await bridgeContractService.waitForTransaction(
      txHash,
      ctx.activeChainId,
    );
    if (!ok) throw new Error("Transaction reverted");
    return { ctx, txHash };
  }, [preflight, validateOnChain, executeDeposit]);

  // Main bridge in handler with comprehensive error handling
  const handleBridgeIn = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsLoading(true);
    toast({ title: "Preparing transaction...", description: "Please wait" });

    try {
      const { ctx, txHash } = await runBridgeIn();

      const explorerUrl = getExplorerUrl(ctx.activeChainId, txHash);
      const successMessage = op.mint
        ? "USDST minted successfully! Your tokens are now available."
        : "Bridge initiated successfully! The relayer will process it shortly.";

      toast({
        title: op.mint ? "USDST Minted" : "Bridge Initiated",
        description: (
          <div>
            <p>{successMessage}</p>
            <p className="text-sm text-gray-600 mt-1">
              Transaction: {formatTxHash(txHash)}
            </p>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 underline text-sm"
            >
              View on Explorer →
            </a>
          </div>
        ),
      });

      setAmount("");
      setAmountError("");

      // Refresh external balance and USDST balance in parallel
      await Promise.all([
        refetchExternalToken(),
        fetchUsdstBalance(userAddress),
      ]);
    } catch (error: any) {
      console.error("Bridge operation failed:", error);
      
      // Provide user-friendly error messages based on error type
      let errorTitle = "Transaction Failed";
      let errorDescription = "An unexpected error occurred. Please try again.";
      
      if (error?.message?.includes("Missing")) {
        errorTitle = "Configuration Error";
        errorDescription = error.message;
      } else if (error?.message?.includes("insufficient funds") || error?.message?.includes("balance")) {
        errorTitle = "Insufficient Balance";
        errorDescription = "You don't have enough tokens to complete this transaction.";
      } else if (error?.message?.includes("rejected") || error?.message?.includes("denied")) {
        errorTitle = "Transaction Rejected";
        errorDescription = "You rejected the transaction. Please try again if you want to proceed.";
      } else if (error?.message?.includes("reverted") || error?.message?.includes("failed")) {
        errorTitle = "Transaction Failed";
        errorDescription = "The transaction failed on-chain. Please check your balance and try again.";
      } else if (error?.message?.includes("network") || error?.message?.includes("chain")) {
        errorTitle = "Network Error";
        errorDescription = "Please check your network connection and try again.";
      } else if (error?.message) {
        errorDescription = error.message;
      }
      
      toast({
        title: errorTitle,
        description: errorDescription,
        variant: "destructive",
      });
    } finally {
      inFlightRef.current = false;
      setIsLoading(false);
    }
  }, [
    runBridgeIn,
    op.mint,
    toast,
    refetchExternalToken,
    fetchUsdstBalance,
    userAddress,
  ]);

  // ============================================================================
  // BRIDGE OUT FUNCTIONS
  // ============================================================================

  // Show confirmation modal
  const showConfirmModal = useCallback(() => {
    if (!op.token || !address || !selectedNetwork) {
      toast({
        title: "Error",
        description: "Invalid configuration",
        variant: "destructive",
      });
      return;
    }
    if (amountError) return;
    setIsModalOpen(true);
  }, [op.token, address, selectedNetwork, amountError, toast]);

  // Modal cancel handler
  const handleModalCancel = () => setIsModalOpen(false);

  // Bridge out handler
  const handleBridgeOut = useCallback(async () => {
    if (!op.token || !address || !selectedNetwork) return;
    setIsModalOpen(false);
    setIsLoading(true);
    toast({
      title: "Preparing transaction...",
      description: "Please wait while we prepare your transaction",
    });

    try {
      const amountInSmallestUnit = parsedAmount.toString();
      const externalChainId = op.netCfg?.chainId || "";

      const apiCall = operation === "bridgeBurn" ? redeemOutAPI : bridgeOutAPI;
      const response = await apiCall({
        stratoTokenAmount: amountInSmallestUnit,
        externalRecipient: address,
        stratoToken: op.token.stratoToken,
        externalChainId: String(externalChainId),
      });

      if (response?.success) {
        const operationName = op.mint ? "burned" : "bridged";
        const tokenSymbol = op.token.stratoTokenSymbol;
        toast({
          title: "Transaction Proposed Successfully",
          description: `Your tokens have been ${operationName} and ${amount} ${tokenSymbol} will be transferred to ${address}. Withdrawal is pending approval.`,
        });
        await Promise.all([refetchBalance(), fetchUsdstBalance(userAddress)]);

        setAmount("");
      } else {
        throw new Error("Failed to initiate transfer");
      }
    } catch (error) {
      console.error("Bridge transaction failed:", error);
    } finally {
      setIsLoading(false);
    }
  }, [
    op.token,
    address,
    selectedNetwork,
    parsedAmount,
    op.netCfg,
    operation,
    op.mint,
    amount,
    toast,
    refetchBalance,
    fetchUsdstBalance,
    userAddress,
  ]);

  // ============================================================================
  // EFFECTS
  // ============================================================================

  // Reset form when token or network changes
  useEffect(() => {
    setAmount("");
    setAmountError("");
  }, [op.token, op.netCfg, op.inbound]);

  // Auto-switch network for inbound operations
  useEffect(() => {
    if (!isConnected || !selectedNetwork || !op.expChainId || !chainId) return;
    if (chainId === op.expChainId || inFlightRef.current) return;
    try {
      switchChain({ chainId: op.expChainId });
    } catch (error) {
      toast({
        title: "Network switch failed",
        description: `Switch to ${selectedNetwork}`,
        variant: "destructive",
      });
    }
  }, [
    isConnected,
    selectedNetwork,
    op.expChainId,
    chainId,
    switchChain,
    toast,
  ]);

  // Load networks and tokens on mount
  useEffect(() => {
    loadNetworksAndTokens();
  }, [loadNetworksAndTokens]);

  // Fetch redeemable tokens for mint operations
  useEffect(() => {
    if (op.mint && op.netCfg?.chainId) fetchRedeemableTokens(op.netCfg.chainId);
  }, [op.mint, op.netCfg?.chainId, fetchRedeemableTokens]);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="space-y-6">
      <BridgeWalletStatus />

      {/* Network Selection */}
      <div className="flex items-center gap-4">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="from">From Network</Label>
          {op.inbound ? (
            <Select
              value={selectedNetwork || ""}
              onValueChange={(v) => {
                setSelectedNetwork(v);
                op.setToken(null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select network" />
              </SelectTrigger>
              <SelectContent>
                {availableNetworks.map((n) => (
                  <SelectItem key={n.chainId} value={n.chainName}>
                    {n.chainName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="from-chain"
              value="STRATO"
              disabled
              className="bg-gray-50"
            />
          )}
        </div>

        <div className="flex-1 space-y-1.5">
          <Label htmlFor="to">To Network</Label>
          {op.inbound ? (
            <Input value="STRATO" disabled className="bg-gray-50" />
          ) : (
            <Select
              value={selectedNetwork || ""}
              onValueChange={setSelectedNetwork}
            >
              <SelectTrigger id="to-network">
                <SelectValue placeholder="Select network" />
              </SelectTrigger>
              <SelectContent>
                {availableNetworks.map((n) => (
                  <SelectItem key={n.chainId} value={n.chainName}>
                    {n.chainName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Asset Selection */}
      <div>
        <Label htmlFor="asset">Select Asset</Label>
        <Select
          value={op.token?.externalToken || ""}
          onValueChange={(v) => {
            const newToken = op.list.find((t) => t.externalToken === v) || null;
            op.setToken(newToken);
          }}
          disabled={op.list.length === 0}
        >
          <SelectTrigger id="from-token">
            <SelectValue>
              {op.token
                ? op.inbound
                  ? op.token.externalSymbol
                  : op.token.stratoTokenSymbol
                : "Select asset"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {op.list.map((t) => (
              <SelectItem key={t.externalToken} value={t.externalToken}>
                {op.inbound ? t.externalSymbol : t.stratoTokenSymbol}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        
        {/* You will receive */}
        {op.token && (
          <div className="text-sm text-gray-600 mt-1">
            You will receive{" "}
            {op.inbound
              ? op.mint
                ? `USDST on ${targetLabel}`
                : `${op.token.stratoTokenSymbol} on ${targetLabel}`
              : `${op.token.externalSymbol} on ${targetLabel || "selected"} network`}
          </div>
        )}
      </div>

      {/* Amount Input */}
      {op.token && (
        <div>
          <TokenInput
            value={amount}
            error={feeError ? "" : amountError}
            tokenName={operation === "bridgeBurn" ? "Amount (USDST to withdraw)" : "Amount"}
            tokenSymbol={symbolIn || ""}
            maxTransferable={maxTransferable}
            decimals={op.inbound ? op.extDec : op.stratoDec}
            disabled={!isConnected || maxTransferable === 0n || !!feeError}
            loading={op.inbound ? externalTokenLoading : isBalanceLoading}
            onValueChange={setAmount}
            onErrorChange={setAmountError}
            onMaxClick={handleMaxClick}
            showPercentageButtons={true}
          />

          {/* Fee Error Display */}
          {feeError && <p className="text-sm text-red-500 mt-1">{feeError}</p>}
        </div>
      )}

      {/* Transaction Info */}
      {op.token && (
        <div className="bg-gray-50 p-4 rounded-lg space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Transaction Fee</span>
            <span className="font-medium">
              {op.inbound
                ? "N/A"
                : `${feeUSDST} USDST (${vouchers} vouchers)`}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">
              {operation === "bridgeBurn" ? "USDST" : symbolIn} Balance
            </span>
            <span className="font-medium">
              {`${balancesView.before} → ${balancesView.after}`}{" "}
              {op.inbound
                ? `on ${selectedNetwork || "external chain"}`
                : "on STRATO"}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">{symbolOut} Balance</span>
            <span className="font-medium">
              {amount || "0.00"} {symbolOut}{" "}
              {op.inbound ? "on STRATO" : `on ${selectedNetwork || "selected"}`}
            </span>
          </div>
        </div>
      )}

      {/* Action Button */}
      <div className="flex justify-end">
        <Button
          onClick={op.inbound ? handleBridgeIn : showConfirmModal}
          disabled={actionDisabled}
          className="bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90"
        >
          {buttonText}
        </Button>
      </div>

      {/* BridgeOut Confirmation Modal */}
      {!op.inbound && (
        <Modal
          title="Confirm Bridge Transaction"
          open={isModalOpen}
          onOk={handleBridgeOut}
          onCancel={handleModalCancel}
          okText="Yes, Bridge Assets"
          cancelText="Cancel"
        >
          <div className="space-y-4">
            <p>Are you sure you want to bridge your assets?</p>
            <div className="bg-gray-50 p-4 rounded-md">
              <p className="font-medium">Transaction Details:</p>
              <div className="mt-2 space-y-2">
                <p>From: STRATO</p>
                <p>To: {selectedNetwork || "Not selected"}</p>
                <p>
                  Amount: {op.token ? balancesView.receiveHuman : amount}{" "}
                  {op.token?.stratoTokenSymbol}
                </p>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Transaction Fee</span>
                  <span className="font-medium">
                    {feeUSDST} USDST ({vouchers} vouchers)
                  </span>
                </div>
                {symbolOut && (
                  <p className="text-blue-600">
                    You will receive{" "}
                    {op.token ? balancesView.receiveHuman : amount}{" "}
                    {symbolOut} on {targetLabel || "selected"}{" "}
                    network
                  </p>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default BridgeOperation;