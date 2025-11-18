import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { ensureHexPrefix } from "@/utils/numberUtils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useAccount,
  useChainId,
  useBalance,
  useWriteContract,
  useSwitchChain,
  useSignTypedData,
} from "wagmi";
import { createPublicClient, http } from "viem";
import {
  NATIVE_TOKEN_ADDRESS,
  resolveViemChain,
  DEPOSIT_ROUTER_ABI,
  ERC20_ABI,
  PERMIT2_ADDRESS,
} from "@/lib/bridge/constants";
import { bridgeContractService } from "@/lib/bridge/contractService";
import { safeParseUnits, formatBalance } from "@/utils/numberUtils";
import { useBridgeContext } from "@/context/BridgeContext";
import { useUser } from "@/context/UserContext";
import BridgeWalletStatus from "./BridgeWalletStatus";
import PercentageButtons from "@/components/ui/PercentageButtons";
import { BridgeContext } from "@/lib/bridge/types";
import {
  normalizeError,
  formatTxHash,
  getExplorerUrl,
} from "@/lib/bridge/utils";
import { DECIMAL_PATTERN } from "@/lib/constants";

const BridgeIn: React.FC = () => {
  // ============================================
  // Hooks & Context
  // ============================================
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();
  const { switchChain } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const { toast } = useToast();
  const { userAddress } = useUser();
  const {
    availableNetworks,
    bridgeableTokens,
    selectedNetwork,
    setSelectedNetwork,
    selectedToken,
    setSelectedToken,
  } = useBridgeContext();

  // ============================================
  // State Management
  // ============================================
  const [amount, setAmount] = useState("");
  const [tokenBalance, setTokenBalance] = useState("0");
  const [isLoading, setIsLoading] = useState(false);
  const [approvalState, setApprovalState] = useState<"idle" | "approving" | "approved">("idle");
  const [errors, setErrors] = useState({ amount: "", network: "" });
  const inFlightRef = useRef(false);

  // State for minimum deposit amount
  const [minDepositInfo, setMinDepositInfo] = useState<{ 
    amount: string; 
    amountWei: bigint; 
    loading: boolean;
  }>({ 
    amount: "", 
    amountWei: 0n,
    loading: false
  });
  
  // State for token permission status
  const [isTokenPermitted, setIsTokenPermitted] = useState(true);

  // ============================================
  // Derived State & Computed Values
  // ============================================
  const selectedNetworkConfig = availableNetworks.find(
    (n) => n.chainName === selectedNetwork,
  );
  const activeChainId = selectedNetworkConfig?.chainId;
  const expectedChainId = activeChainId ? parseInt(activeChainId) : null;
  const isCorrectNetwork = isConnected && chainId && expectedChainId && chainId === expectedChainId;
  const isNativeToken = BigInt(selectedToken?.externalToken || "0") === 0n ? true : false;

  // ============================================
  // Balance Hooks
  // ============================================
  const {
    data: nativeBalance,
    refetch: refetchNative,
    isError: nativeError,
    isLoading: nativeLoading,
  } = useBalance({
    address,
    chainId: expectedChainId || undefined,
    query: {
      enabled: isConnected && !!address && !!expectedChainId && isNativeToken,
    },
  });

  const {
    data: tokenBalanceData,
    refetch: refetchToken,
    isError: tokenError,
    isLoading: tokenLoading,
  } = useBalance({
    address,
    token: ensureHexPrefix(selectedToken?.externalToken),
    chainId: expectedChainId || undefined,
    query: {
      enabled:
        isConnected &&
        !!address &&
        !!expectedChainId &&
        !!selectedToken &&
        !isNativeToken,
    },
  });

  const isBalanceLoading =
    isConnected &&
    !!address &&
    !!expectedChainId &&
    (nativeLoading || tokenLoading);

  // ============================================
  // Utility Functions
  // ============================================
  
  /**
   * Fetches minimum deposit amount from router contract
   */
  const fetchMinDepositAmount = async (tokenAddress: string, decimals: number) => {
    if (!tokenAddress || !selectedNetworkConfig) return;
    
    setMinDepositInfo(prev => ({ ...prev, loading: true }));
    
    try {
      const tokenConfig = await bridgeContractService.getTokenConfig({
        tokenAddress,
        chainId: parseInt(selectedNetworkConfig.chainId),
        depositRouterAddress: selectedNetworkConfig.depositRouter,
      });

      // Store both formatted amount and wei value
      const minAmountWei = tokenConfig.minAmount ? BigInt(tokenConfig.minAmount) : 0n;
      const formattedMinAmount = minAmountWei > 0n ? 
        formatBalance(minAmountWei, undefined, decimals) : "0";
      
      setMinDepositInfo({ 
        amount: formattedMinAmount, 
        amountWei: minAmountWei,
        loading: false
      });
      setIsTokenPermitted(tokenConfig.isPermitted);
    } catch (error) {
      console.error("Error fetching min deposit amount:", error);
      setMinDepositInfo({ 
        amount: "0", 
        amountWei: 0n,
        loading: false
      });
      setIsTokenPermitted(true);
    }
  };

  useEffect(() => {
    setAmount("");
    setErrors((e) => ({ ...e, amount: "" }));
    setApprovalState("idle");
    
    // Fetch minimum deposit amount for selected token
    if (selectedToken && selectedNetworkConfig) {
      fetchMinDepositAmount(selectedToken.externalToken, parseInt(selectedToken.externalDecimals || "18"));
    }
  }, [selectedToken, selectedNetworkConfig]);

  useEffect(() => {
    const handleNetworkSwitch = async () => {
      if (
        isConnected &&
        selectedNetwork &&
        expectedChainId &&
        chainId !== expectedChainId
      ) {
        setErrors((e) => ({
          ...e,
          network: `Switching to ${selectedNetwork} network...`,
        }));
        try {
          await switchChain({ chainId: expectedChainId });
        } catch {
          setErrors((e) => ({
            ...e,
            network: `Please manually switch to ${selectedNetwork} network`,
          }));
        }
      } else {
        setErrors((e) => ({
          ...e,
          network:
            isConnected && !selectedNetwork ? "Please select a network" : "",
        }));
      }
    };
    handleNetworkSwitch();
  }, [chainId, isConnected, selectedNetwork, expectedChainId, switchChain]);

  useEffect(() => {
    const balance = isNativeToken ? nativeBalance : tokenBalanceData;

    if (balance) {
      setTokenBalance(
        formatBalance(balance.value, undefined, balance.decimals),
      );
    }
  }, [isNativeToken, nativeBalance, tokenBalanceData]);

  /**
   * Validates user input amount against balance and minimum requirements
   */
  const validateAmount = (value: string): boolean => {
    if (!value) {
      setErrors((e) => ({ ...e, amount: "" }));
      return true;
    }

    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) {
      setErrors((e) => ({
        ...e,
        amount:
          num <= 0
            ? "Amount must be greater than 0"
            : "Please enter a valid number",
      }));
      return false;
    }

    // Check minimum amount using stored wei value
    if (minDepositInfo.amountWei > 0n) {
      const inputAmountWei = safeParseUnits(value, parseInt(selectedToken?.externalDecimals || "18"));
      
      if (inputAmountWei < minDepositInfo.amountWei) {
        setErrors((e) => ({
          ...e,
          amount: `Amount must be at least ${minDepositInfo.amount} ${selectedToken?.externalSymbol}`,
        }));
        return false;
      }
    }

    const tokenDecimals = parseInt(selectedToken?.externalDecimals || "18");
    const decimalIndex = value.indexOf('.');
    
    if (decimalIndex !== -1) {
      const decimalPlaces = value.length - decimalIndex - 1;
      if (decimalPlaces > tokenDecimals) {
        setErrors(e => ({ ...e, amount: `Maximum ${tokenDecimals} decimal places allowed` }));
        return false;
      }
    }

    const balanceMatch = tokenBalance.match(/^([\d,]+\.?\d*)/);
    const bal = balanceMatch
      ? parseFloat(balanceMatch[1].replace(/,/g, ""))
      : 0;

    if (num > bal) {
      setErrors((e) => ({
        ...e,
        amount: `Insufficient balance. Maximum: ${tokenBalance} ${selectedToken?.externalSymbol}`,
      }));
      return false;
    }

    setErrors((e) => ({ ...e, amount: "" }));
    return true;
  };

  // ============================================
  // Event Handlers
  // ============================================
  
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (DECIMAL_PATTERN.test(value)) {
      setAmount(value);
      validateAmount(value);
    }
  };

  // ============================================
  // Bridge Flow Functions
  // ============================================
  
  /**
   * Validates configuration and prepares bridge context
   */
  const preflight = (): BridgeContext => {
    if (
      !selectedToken ||
      !amount ||
      !isConnected ||
      !isCorrectNetwork ||
      !address ||
      !userAddress
    ) {
      throw new Error(
        !userAddress ? "User address not available" : "Invalid configuration",
      );
    }

    if (!selectedNetworkConfig) {
      throw new Error("Selected network configuration not found");
    }

    const depositAmount = safeParseUnits(
      amount,
      parseInt(selectedToken.externalDecimals || "18"),
    );
    const isNative = BigInt(selectedToken?.externalToken || "0") === 0n ? true : false;

    return {
      selectedToken,
      selectedNetwork,
      amount,
      userAddress,
      address,
      activeChainId,
      depositRouter: selectedNetworkConfig.depositRouter,
      depositAmount,
      isNative,
    };
  };

  const validateOnChain = async (ctx: BridgeContext) => {
    const validation = await bridgeContractService.validateRouterContract({
      depositRouterAddress: ctx.depositRouter,
      amount: ctx.amount,
      decimals: ctx.selectedToken.externalDecimals,
      chainId: ctx.activeChainId,
      tokenAddress: ctx.isNative ? NATIVE_TOKEN_ADDRESS : ensureHexPrefix(ctx.selectedToken.externalToken)
    });

    if (!validation.isValid) {
      throw new Error(validation.error || "Validation failed");
    }
  };

  const ensureAllowanceOrPermit = async (ctx: BridgeContext) => {
    const approval = await bridgeContractService.checkPermit2Approval({
      token: ctx.selectedToken.externalToken,
      owner: ctx.address,
      amount: ctx.depositAmount,
      chainId: ctx.activeChainId,
    });

    if (!approval.isApproved) {
      setApprovalState("approving");
      toast({
        title: "Approval Required",
        description: "Approving Permit2 to spend your tokens...",
      });

      try {
        const approveTx = await writeContractAsync({
          address: ensureHexPrefix(ctx.selectedToken.externalToken),
          abi: ERC20_ABI,
          functionName: "approve",
          args: [
            PERMIT2_ADDRESS as `0x${string}`,
            BigInt(2) ** BigInt(256) - BigInt(1),
          ],
          chain: await resolveViemChain(ctx.activeChainId),
          account: ctx.address as `0x${string}`,
        });

        await bridgeContractService.waitForTransaction(
          approveTx,
          ctx.activeChainId,
        );

        setApprovalState("approved");
        const approvalExplorerUrl = getExplorerUrl(
          ctx.activeChainId,
          approveTx,
        );
        toast({
          title: "Approval Successful",
          description: (
            <div>
              <p>Now processing your bridge transaction...</p>
              <a
                href={approvalExplorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 underline text-sm"
              >
                View Approval on Explorer →
              </a>
            </div>
          ),
        });
      } catch (error) {
        setApprovalState("idle");
        throw error;
      }
    }
  };

  const buildPermit = async (ctx: BridgeContext) => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 900); // 15 minutes
    const nonce = bridgeContractService.getPermit2Nonce();
    const permitMessage = bridgeContractService.createPermit2Message({
      token: ctx.selectedToken.externalToken,
      amount: ctx.depositAmount,
      spender: ctx.depositRouter,
      nonce,
      deadline,
    });

    const signature = await signTypedDataAsync({
      domain: bridgeContractService.getPermit2Domain(ctx.activeChainId),
      types: bridgeContractService.getPermit2Types(),
      primaryType: "PermitTransferFrom",
      message: permitMessage,
      account: ctx.address as `0x${string}`,
    });

    return { signature, nonce, deadline };
  };

  const simulateAndSend = async (
    ctx: BridgeContext,
    permitData?: { signature: string; nonce: bigint; deadline: bigint },
  ): Promise<`0x${string}`> => {
    const chain = await resolveViemChain(ctx.activeChainId);
    const client = createPublicClient({ chain, transport: http() });

    if (ctx.isNative) {
      // Simulate ETH deposit
      await client.simulateContract({
        address: ctx.depositRouter as `0x${string}`,
        abi: DEPOSIT_ROUTER_ABI,
        functionName: "depositETH",
        args: [ensureHexPrefix(ctx.userAddress)],
        value: ctx.depositAmount,
        account: ctx.address as `0x${string}`,
      });

      // Send ETH deposit
      const txHash = await writeContractAsync({
        address: ctx.depositRouter as `0x${string}`,
        abi: DEPOSIT_ROUTER_ABI,
        functionName: "depositETH",
        args: [ensureHexPrefix(ctx.userAddress)],
        value: ctx.depositAmount,
        chain,
        account: ctx.address as `0x${string}`,
      });
      return txHash as `0x${string}`;
    } else {
      if (!permitData) {
        throw new Error("Permit data is required for ERC20 deposits");
      }

      // Simulate ERC20 deposit
      await client.simulateContract({
        address: ctx.depositRouter as `0x${string}`,
        abi: DEPOSIT_ROUTER_ABI,
        functionName: "deposit",
        args: [
          ensureHexPrefix(ctx.selectedToken.externalToken),  
          ctx.depositAmount,
          ensureHexPrefix(ctx.userAddress),
          false,
          permitData!.nonce,
          permitData!.deadline,
          permitData!.signature as `0x${string}`
        ],
        account: ctx.address as `0x${string}`,
      });

      // Send ERC20 deposit
      const txHash = await writeContractAsync({
        address: ctx.depositRouter as `0x${string}`,
        abi: DEPOSIT_ROUTER_ABI,
        functionName: "deposit",
        args: [
          ensureHexPrefix(ctx.selectedToken.externalToken),
          ctx.depositAmount,
          ensureHexPrefix(ctx.userAddress),
          false,
          permitData!.nonce,
          permitData!.deadline,
          permitData!.signature as `0x${string}`
        ],
        chain,
        account: ctx.address as `0x${string}`,
      });
      return txHash as `0x${string}`;
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

  // ============================================
  // Main Bridge Handler
  // ============================================
  
  const handleBridge = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsLoading(true);
    toast({ title: "Preparing transaction...", description: "Please wait" });

    try {
      // Validate
      const ctx = preflight();
      await validateOnChain(ctx);
      let permitData:
        | { signature: string; nonce: bigint; deadline: bigint }
        | undefined;
      if (!ctx.isNative) {
        await ensureAllowanceOrPermit(ctx);
        permitData = await buildPermit(ctx);
      }

      const txHash = await simulateAndSend(ctx, permitData);
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

      toast({
        title: "Bridge Initiated",
        description:
          "Your deposit has been submitted successfully. The relayer will process it shortly.",
      });

      // Trigger wagmi balance refetch
      if (ctx.isNative) {
        refetchNative();
      } else {
        refetchToken();
      }
    } catch (error: any) {
      const bridgeError = normalizeError(error);
      toast({
        title: "Transaction Failed",
        description: bridgeError.userMessage,
        variant: "destructive",
      });
    } finally {
      inFlightRef.current = false;
      setIsLoading(false);
      setApprovalState("idle");
    }
  };

  // ============================================
  // Render
  // ============================================
  
  return (
    <div className="space-y-6">
      <BridgeWalletStatus />

      <div className="flex items-center gap-4">
        <div className="flex-1 space-y-1.5">
          <Label>From Network</Label>
          <Select
            value={selectedNetwork || ""}
            onValueChange={(v) => {
              setSelectedNetwork(v);
              setSelectedToken(null);
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
        </div>
        <div className="flex-1 space-y-1.5">
          <Label>To Network</Label>
          <Input value="STRATO" disabled className="bg-gray-50" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Select Asset</Label>
        <Select
          value={selectedToken?.externalSymbol || ""}
          onValueChange={(v) =>
            setSelectedToken(
              bridgeableTokens.find((t) => t.externalSymbol === v) || null,
            )
          }
          disabled={bridgeableTokens.length === 0}
        >
          <SelectTrigger>
            <SelectValue>
              {selectedToken
                ? `${selectedToken.externalName} (${selectedToken.externalSymbol})`
                : "Select asset"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {bridgeableTokens.map((t) => (
              <SelectItem key={t.id} value={t.externalSymbol}>
                {t.externalName} ({t.externalSymbol})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Amount</Label>
        <Input
          type="text"
          inputMode="decimal"
          pattern="[0-9]*\.?[0-9]*"
          placeholder={
            isConnected
              ? isBalanceLoading
                ? "Loading..."
                : "0.00"
              : "Connect wallet"
          }
          className={errors.amount ? "border-red-500" : ""}
          value={amount}
          onChange={handleAmountChange}
          disabled={!isConnected || isBalanceLoading}
        />
        
        {errors.amount && (
          <p className="text-sm text-red-500">{errors.amount}</p>
        )}
        {isConnected && !isBalanceLoading && tokenBalance !== "0" && (
          <PercentageButtons
            value={amount}
            maxValue={safeParseUnits(
              tokenBalance,
              parseInt(selectedToken?.externalDecimals || "18"),
            ).toString()}
            onChange={(v) => {
              setAmount(v);
              validateAmount(v);
            }}
            className="mt-2"
            decimals={parseInt(selectedToken?.externalDecimals || "18")}
          />
        )}

        {isConnected &&
          (isBalanceLoading ? (
            <div className="flex items-center gap-2 mt-1">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <span className="text-sm text-gray-500">Fetching balance...</span>
            </div>
          ) : tokenBalance ? (
            <div className="space-y-2 mt-1">
              <div className="flex justify-between items-center">
                <p className="text-sm text-gray-500">
                  Balance: {tokenBalance} {selectedToken?.externalSymbol}
                </p>
                {selectedToken && selectedNetworkConfig && (
                  <div className="flex items-center gap-1">
                    {minDepositInfo.loading ? (
                      <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                    ) : (
                      <span className="text-xs text-gray-500">
                        Min: {minDepositInfo.amount} {selectedToken.externalSymbol}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : null)}
      </div>

      <div className="text-sm text-gray-500 space-y-1">
        {[
          "Transaction time varies by network congestion",
        ].map((text, i) => (
          <p key={i}>• {text}</p>
        ))}
      </div>

      <div className="flex justify-end">
        <Button
          onClick={handleBridge}
          disabled={
            isLoading ||
            !amount ||
            !selectedToken ||
            !isConnected ||
            !isCorrectNetwork ||
            !isTokenPermitted
          }
          className="bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90"
        >
          {isLoading && approvalState === "approving" && "Approving..."}
          {isLoading && approvalState === "approved" && "Bridging..."}
          {isLoading && approvalState === "idle" && "Processing..."}
          {!isLoading && !isConnected && "Connect Wallet"}
          {!isLoading && isConnected && !selectedNetwork && "Select Network"}
          {!isLoading &&
            isConnected &&
            selectedNetwork &&
            !selectedToken &&
            "Select Asset"}
          {!isLoading &&
            isConnected &&
            selectedToken &&
            !amount &&
            "Enter Amount"}
          {!isLoading &&
            isConnected &&
            selectedToken &&
            amount &&
            !isCorrectNetwork &&
            `Switch to ${selectedNetwork}`}
          {!isLoading &&
            isConnected &&
            selectedToken &&
            amount &&
            isCorrectNetwork &&
            !isTokenPermitted &&
            "Token Not Permitted"}
          {!isLoading &&
            isConnected &&
            selectedToken &&
            amount &&
            isCorrectNetwork &&
            isTokenPermitted &&
            "Bridge Assets"}
        </Button>
      </div>

      {errors.network && (
        <p className="text-sm text-red-500">{errors.network}</p>
      )}
    </div>
  );
};

export default BridgeIn;
