import React, { useState, useEffect, useRef, useMemo } from "react";
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
import { bridgeContractService } from "@/lib/bridge/contractService";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/bridge/constants";
import { useBridgeContext } from "@/context/BridgeContext";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useAmountValidation } from "@/utils/validationUtils";
import { safeParseUnits, formatBalance, addCommasToInput, formatWeiAmount } from "@/utils/numberUtils";
import PercentageButtons from "@/components/ui/PercentageButtons";
import BridgeWalletStatus from "./BridgeWalletStatus";
import { BridgeContext } from "@/lib/bridge/types";
import {
  formatTxHash,
  getExplorerUrl,
} from "@/lib/bridge/utils";
import { Modal } from "antd";
import { BRIDGE_OUT_FEE, usdstAddress } from "@/lib/constants";

type BridgeOperationType = "bridgeWrap" | "bridgeUnwrap" | "bridgeMint" | "bridgeBurn";

interface BridgeOperationProps {
  operation: BridgeOperationType;
}

const BridgeOperation: React.FC<BridgeOperationProps> = ({ operation }) => {
  // Hooks
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();
  const { switchChain } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const { toast } = useToast();
  const { userAddress } = useUser();
  const { loadingUsdstBalance, usdstBalance, fetchUsdstBalance } = useUserTokens();
  const { handleInput, getMaxTransferable } = useAmountValidation();
  
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

  // State
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [approvalState, setApprovalState] = useState<"idle" | "approving" | "approved">("idle");
  const [networkError, setNetworkError] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const inFlightRef = useRef(false);


  // Determine operation characteristics
  const isInbound = operation === "bridgeWrap" || operation === "bridgeMint";
  const isMint = operation === "bridgeMint" || operation === "bridgeBurn";
  const isWrap = operation === "bridgeWrap" || operation === "bridgeUnwrap";

  // Get the current token based on operation
  const currentToken = isMint ? selectedMintToken : selectedToken;
  const setCurrentToken = isMint ? setSelectedMintToken : setSelectedToken;
  const tokenList = isMint ? redeemableTokens : bridgeableTokens;

  // Computed values
  const selectedNetworkConfig = availableNetworks.find(
    (n) => n.chainName === selectedNetwork,
  );
  const activeChainId = selectedNetworkConfig?.chainId;
  const expectedChainId = activeChainId ? parseInt(activeChainId) : null;
  const isCorrectNetwork = isConnected && chainId && expectedChainId && chainId === expectedChainId;
  const isNativeToken = currentToken?.externalToken === NATIVE_TOKEN_ADDRESS;

  // Balance hooks
  const {
    data: nativeBalance,
    refetch: refetchNative,
    isError: nativeError,
    isLoading: nativeLoading,
  } = useWagmiBalance({
    address: address as `0x${string}`,
    chainId: expectedChainId,
  });

  const {
    data: tokenBalanceData,
    refetch: refetchToken,
    isError: tokenError,
    isLoading: tokenLoading,
  } = useWagmiBalance({
    address: address as `0x${string}`,
    token: currentToken?.externalToken as `0x${string}`,
    chainId: expectedChainId,
  });

  // BridgeOut balance hook (for unwrap operations)
  const {
    data: balanceData,
    isLoading: isBalanceLoading,
    refetch: refetchBalance,
  } = useBalance(currentToken?.stratoToken || null);

  // Computed values
  const maxAmount = isInbound 
    ? (currentToken ? BigInt(safeParseUnits(tokenBalanceData?.formatted || "0", 18).toString()) : 0n)
    : operation === "bridgeBurn"
      ? BigInt(usdstBalance)
      : (currentToken ? BigInt(safeParseUnits(balanceData?.formatted || "0", 18).toString()) : 0n);
  
  const maxTransferable = useMemo(() => {
    if (!currentToken) return 0n;
    const tokenAddress = isInbound 
      ? currentToken.externalToken 
      : operation === "bridgeBurn" 
        ? usdstAddress 
        : currentToken.stratoToken;
    const fee = isInbound ? "0" : BRIDGE_OUT_FEE;
    return getMaxTransferable(maxAmount, tokenAddress, fee);
  }, [currentToken, maxAmount, getMaxTransferable, isInbound, operation]);

  const isDataLoading = loadingUsdstBalance || (isInbound ? tokenLoading : isBalanceLoading);

  // Functions
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const symbol = isInbound 
      ? currentToken?.externalSymbol || ""
      : currentToken?.stratoTokenSymbol || "";
    const tokenAddress = isInbound
      ? currentToken?.externalToken || ""
      : currentToken?.stratoToken || "";
    const fee = isInbound ? "0" : BRIDGE_OUT_FEE;

    handleInput(
      value,
      setAmount,
      setAmountError,
      {
        maxAmount,
        symbol,
        tokenAddress,
        transactionFee: fee
      }
    );
  };


  // BridgeIn specific functions
  const preflight = (): BridgeContext => {
    if (!currentToken || !selectedNetworkConfig || !userAddress || !address) {
      throw new Error("Missing configuration");
    }
    return {
      selectedToken: currentToken,
      selectedNetwork: selectedNetwork,
      amount,
      userAddress,
      address: address as `0x${string}`,
      activeChainId: selectedNetworkConfig.chainId,
      depositRouter: selectedNetworkConfig.depositRouter,
      depositAmount: safeParseUnits(amount, parseInt(currentToken.externalDecimals || "18")),
      isNative: isNativeToken,
    };
  };

  const validateOnChain = async (ctx: BridgeContext) => {
    const validation = await bridgeContractService.validateRouterContract({
      depositRouterAddress: ctx.depositRouter,
      amount: ctx.amount,
      decimals: ctx.selectedToken.externalDecimals,
      chainId: ctx.activeChainId,
      tokenAddress: ctx.selectedToken.externalToken,
      mint: isMint,
    });
    if (!validation.isValid) {
      throw new Error(validation.error || "Validation failed");
    }
  };

  const executeDeposit = async (ctx: BridgeContext): Promise<`0x${string}`> => {
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
        mintUSDST: isMint,
      });
    }
  };

  const waitAndFinalize = async (ctx: BridgeContext, txHash: `0x${string}`) => {
    const success = await bridgeContractService.waitForTransaction(
      txHash,
      ctx.activeChainId,
    );
    if (!success) {
      throw new Error("Transaction reverted");
    }
  };

  const handleBridgeIn = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsLoading(true);
    toast({ title: "Preparing transaction...", description: "Please wait" });

    try {
      const ctx = preflight();
      await validateOnChain(ctx);
      const txHash = await executeDeposit(ctx);

      const explorerUrl = getExplorerUrl(ctx.activeChainId, txHash);
      toast({
        title: "Transaction Sent",
        description: (
          <div>
            <p>Transaction submitted: {formatTxHash(txHash)}</p>
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

      await waitAndFinalize(ctx, txHash);

      const successMessage = isMint 
        ? "USDST minted successfully! Your tokens are now available."
        : "Bridge initiated successfully! The relayer will process it shortly.";

      toast({
        title: isMint ? "USDST Minted" : "Bridge Initiated",
        description: successMessage,
      });

      setAmount("");
      setAmountError("");

      // Refresh balances
      if (ctx.isNative) {
        refetchNative();
      } else {
        refetchToken();
      }

      // Refresh USDST balance after all operations since transaction fees are paid in USDST
      await fetchUsdstBalance(userAddress);
    } catch (error: any) {
      // Error handling is done by global axios interceptor
    } finally {
      inFlightRef.current = false;
      setIsLoading(false);
      setApprovalState("idle");
    }
  };

  // BridgeOut specific functions
  const showConfirmModal = () => {
    if (!currentToken || !address || !selectedNetwork) {
      toast({
        title: "Error",
        description: "Invalid configuration",
        variant: "destructive",
      });
      return;
    }
    if (!selectedNetwork) {
      toast({
        title: "Select Network",
        description: "Please choose a destination network.",
        variant: "destructive",
      });
      return;
    }
    if (amountError) return;
    setIsModalOpen(true);
  };

  const handleModalCancel = () => setIsModalOpen(false);

  const handleBridgeOut = async () => {
    if (!currentToken || !address || !selectedNetwork) return;
    setIsModalOpen(false);
    setIsLoading(true);
    toast({
      title: "Preparing transaction...",
      description: "Please wait while we prepare your transaction",
    });

    try {
      const amountInSmallestUnit = safeParseUnits(amount || "0", 18).toString();
      const selectedNetworkConfig = availableNetworks.find(
        (n) => n.chainName === selectedNetwork,
      );
      const externalChainId = selectedNetworkConfig?.chainId || "";

      const apiCall = operation === "bridgeBurn" ? redeemOutAPI : bridgeOutAPI;
      const response = await apiCall({
        stratoTokenAmount: amountInSmallestUnit,
        externalRecipient: address,
        stratoToken: currentToken.stratoToken,
        externalChainId: String(externalChainId),
      });

      if (response?.success) {
        const operationName = isMint ? "burned" : "bridged";
        const tokenSymbol = currentToken.stratoTokenSymbol;
        toast({
          title: "Transaction Proposed Successfully",
          description: `Your tokens have been ${operationName} and ${amount} ${tokenSymbol} will be transferred to ${address}. Withdrawal is pending approval.`,
        });
        await refetchBalance();
        
        // Refresh USDST balance after all operations since transaction fees are paid in USDST
        await fetchUsdstBalance(userAddress);
        
        setAmount("");
      } else {
        throw new Error("Failed to initiate transfer");
      }
    } catch (error) {
      console.error("Bridge transaction failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Effects
  useEffect(() => {
    setAmount("");
    setAmountError("");
    setApprovalState("idle");
  }, [currentToken, selectedNetworkConfig, isInbound]);

  useEffect(() => {
    const handleNetworkSwitch = async () => {
      if (
        isConnected &&
        selectedNetwork &&
        expectedChainId &&
        chainId &&
        chainId !== expectedChainId
      ) {
        try {
          await switchChain({ chainId: expectedChainId });
        } catch (error) {
          setNetworkError("Failed to switch network");
        }
      }
    };

    handleNetworkSwitch();
  }, [isConnected, selectedNetwork, expectedChainId, chainId, switchChain]);


  // Load networks and tokens on mount
  useEffect(() => {
    loadNetworksAndTokens();
    if (isMint && selectedNetworkConfig) {
      fetchRedeemableTokens(selectedNetworkConfig.chainId);
    }
  }, [loadNetworksAndTokens, fetchRedeemableTokens, isMint, selectedNetworkConfig]);

  // Get operation display names
  const getOperationName = () => {
    switch (operation) {
      case "bridgeWrap": return "Bridge Wrap";
      case "bridgeUnwrap": return "Bridge Unwrap";
      case "bridgeMint": return "Bridge Mint";
      case "bridgeBurn": return "Bridge Burn";
      default: return "Bridge Operation";
    }
  };

  const getButtonText = () => {
    if (isLoading) {
      if (approvalState === "approving") return "Approving...";
      if (approvalState === "approved") return isInbound ? (isMint ? "Minting..." : "Bridging...") : (isMint ? "Burning..." : "Unwrapping...");
      return "Processing...";
    }
    if (!isConnected) return "Connect Wallet";
    if (isConnected && !selectedNetwork) return "Select Network";
    if (isConnected && selectedNetwork && !currentToken) return "Select Asset";
    if (isConnected && currentToken && !amount) return "Enter Amount";
    if (isConnected && currentToken && amount && !isCorrectNetwork) return `Switch to ${selectedNetwork}`;
    if (isConnected && currentToken && amount && isCorrectNetwork) {
      if (isInbound) return isMint ? "Get USDST" : "Bridge Assets";
      return isMint ? "Burn USDST" : "Bridge Assets";
    }
    return getOperationName();
  };

  // Render
  return (
    <div className="space-y-6">
      <BridgeWalletStatus />

      {/* Network Selection */}
      <div className="flex items-center gap-4">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="from">From Network</Label>
          {isInbound ? (
            <Select
              value={selectedNetwork || ""}
              onValueChange={(v) => {
                setSelectedNetwork(v);
                setCurrentToken(null);
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
          {isInbound ? (
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
          value={currentToken?.externalSymbol || ""}
          onValueChange={(v) => {
            const newToken = tokenList.find((t) => t.externalSymbol === v) || null;
            setCurrentToken(newToken);
          }}
          disabled={tokenList.length === 0}
        >
          <SelectTrigger id="from-token">
            <SelectValue>
              {currentToken
                ? isInbound 
                  ? currentToken.externalSymbol
                  : currentToken.stratoTokenSymbol
                : "Select asset"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {tokenList.map((t) => (
              <SelectItem key={t.externalSymbol} value={t.externalSymbol}>
                {isInbound ? t.externalSymbol : t.stratoTokenSymbol}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* You will receive */}
        {currentToken && (
          <div className="text-sm text-gray-600 mt-1">
            You will receive {isInbound 
              ? isMint 
                ? `USDST on Mercata network`
                : `${currentToken.stratoTokenSymbol} on Mercata network`
              : `${currentToken.externalSymbol} on ${selectedNetwork || "selected"} network`
            }
          </div>
        )}
      </div>

      {/* Amount Input */}
      <div className="space-y-1.5">
        <label className="text-sm text-gray-600">
          {operation === "bridgeBurn" ? "Amount (USDST to withdraw)" : "Amount"}
          {currentToken && (
            <>{" ("}
              <button
                type="button"
                onClick={() => {
                  const maxFormatted = formatWeiAmount(maxTransferable.toString());
                  
                  const symbol = isInbound 
                    ? currentToken?.externalSymbol || ""
                    : currentToken?.stratoTokenSymbol || "";
                  const tokenAddress = isInbound
                    ? currentToken?.externalToken || ""
                    : currentToken?.stratoToken || "";
                  const fee = isInbound ? "0" : BRIDGE_OUT_FEE;

                  handleInput(
                    maxFormatted,
                    setAmount,
                    setAmountError,
                    {
                      maxAmount,
                      symbol,
                      tokenAddress,
                      transactionFee: fee
                    }
                  );
                }}
                disabled={!isConnected || !currentToken || maxTransferable === 0n}
                className={`font-medium focus:outline-none ${
                  !isConnected || !currentToken || maxTransferable === 0n
                    ? "text-gray-400 cursor-not-allowed" 
                    : "text-blue-600 hover:underline"
                }`}
              >
                Max: {maxTransferable === 0n ? "0" : formatBalance(maxTransferable, undefined, 18, 0, 4)}
              </button>
              {")"}</>
          )}
        </label>
        <Input
          id="amount"
          type="text"
          inputMode="decimal"
          pattern="[0-9]*\.?[0-9]*"
          placeholder={
            isInbound
              ? isConnected
                ? tokenLoading
                  ? "Loading..."
                  : "0.00"
                : "Connect wallet"
              : isConnected ? "0.00" : "Connect wallet to enter amount"
          }
          className={amountError ? "border-red-500" : ""}
          value={addCommasToInput(amount)}
          onChange={handleAmountChange}
          disabled={!isConnected || (isInbound ? tokenLoading : isBalanceLoading)}
        />
        
        {amountError && (
          <p className="text-sm text-red-500">{amountError}</p>
        )}
        
        {/* Percentage Buttons */}
        {currentToken && (
          <PercentageButtons
            value={amount}
            maxValue={formatBalance(maxTransferable, undefined, 18, 0, 4)}
            onChange={(val) => {
              const symbol = isInbound 
                ? currentToken?.externalSymbol || ""
                : currentToken?.stratoTokenSymbol || "";
              const tokenAddress = isInbound
                ? currentToken?.externalToken || ""
                : currentToken?.stratoToken || "";
              const fee = isInbound ? "0" : BRIDGE_OUT_FEE;

              handleInput(
                val,
                setAmount,
                setAmountError,
                {
                  maxAmount,
                  symbol,
                  tokenAddress,
                  transactionFee: fee
                }
              );
            }}
            className="mt-2"
          />
        )}
      </div>



      {/* Transaction Info */}
      {currentToken && (
        <div className="bg-gray-50 p-4 rounded-lg space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Transaction Fee</span>
            <span className="font-medium">
              {isInbound ? "N/A" : `${BRIDGE_OUT_FEE} USDST (${parseFloat(BRIDGE_OUT_FEE) * 100} vouchers)`}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">
              {operation === "bridgeBurn" 
                ? "USDST" 
                : isInbound 
                  ? currentToken.externalSymbol 
                  : currentToken.stratoTokenSymbol} Balance
            </span>
            <span className="font-medium">
              {formatBalance(maxAmount, undefined, 18, 2, 2)} → {formatBalance(maxAmount - BigInt(safeParseUnits(amount || "0", 18)), undefined, 18, 2, 2)} {isInbound ? `on ${selectedNetwork || "external chain"}` : "on STRATO"}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">{isInbound 
              ? isMint 
                ? "USDST" 
                : currentToken.stratoTokenSymbol
              : currentToken.externalSymbol
            } Balance</span>
            <span className="font-medium">
              {amount || "0.00"} {isInbound 
                ? isMint 
                  ? "USDST" 
                  : currentToken.stratoTokenSymbol
                : currentToken.externalSymbol
              } {isInbound ? "to STRATO" : `to ${selectedNetwork || "selected"}`}
            </span>
          </div>
        </div>
      )}

      {/* Action Button */}
      <div className="flex justify-end">
        <Button
          onClick={isInbound ? handleBridgeIn : showConfirmModal}
          disabled={
            isLoading ||
            !amount ||
            !currentToken ||
            !isConnected ||
            (isInbound ? !isCorrectNetwork : !selectedNetwork) ||
            !!amountError ||
            isDataLoading
          }
          className="bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90"
        >
          {getButtonText()}
        </Button>
      </div>

      {/* Network Error */}
      {networkError && (
        <p className="text-sm text-red-500">{networkError}</p>
      )}

      {/* BridgeOut Confirmation Modal */}
      {!isInbound && (
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
                  Amount: {currentToken ? formatBalance(safeParseUnits(amount, 18), undefined, 18, 0, 4) : amount}{" "}
                  {currentToken?.stratoTokenSymbol}
                </p>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Transaction Fee</span>
                  <span className="font-medium">{BRIDGE_OUT_FEE} USDST ({parseFloat(BRIDGE_OUT_FEE) * 100} vouchers)</span>
                </div>
                {currentToken?.externalSymbol && (
                  <p className="text-blue-600">
                    You will receive{" "}
                    {currentToken
                      ? formatBalance(safeParseUnits(amount, 18), undefined, 18, 0, 4)
                      : amount}{" "}
                    {currentToken?.externalSymbol} on{" "}
                    {selectedNetwork || "selected"} network
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
