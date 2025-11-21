import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { Loader2, ChevronDown } from "lucide-react";
import PercentageButtons from "@/components/ui/PercentageButtons";
import { useAccount, useBalance, useChainId, useSignTypedData, useSwitchChain, useWriteContract } from "wagmi";
import { createPublicClient, http } from "viem";
import { bridgeContractService } from "@/lib/bridge/contractService";
import { DEPOSIT_ROUTER_ABI, ERC20_ABI, PERMIT2_ADDRESS, resolveViemChain } from "@/lib/bridge/constants";
import { useBridgeContext } from "@/context/BridgeContext";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useLendingContext } from "@/context/LendingContext";
import { safeParseUnits, formatBalance, ensureHexPrefix } from "@/utils/numberUtils";
import BridgeWalletStatus from "@/components/bridge/BridgeWalletStatus";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const DECIMAL_PATTERN = /^\d*\.?\d*$/;

const MintWidget: React.FC = () => {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { toast } = useToast();
  const { userAddress } = useUser();
  const { usdstBalance, fetchUsdstBalance } = useUserTokens();
  const { liquidityInfo, depositLiquidity, refreshLiquidity } = useLendingContext();

  const {
    availableNetworks,
    bridgeableTokens,
    selectedNetwork,
    setSelectedNetwork,
    selectedToken,
    setSelectedToken,
    requestAutoSave,
    loadNetworksAndTokens,
  } = useBridgeContext();

  const redeemableTokens = useMemo(() => 
    (bridgeableTokens || []).filter(token => !token.bridgeable),
    [bridgeableTokens]
  );

  // Get external token balance for percentage buttons
  const { data: externalTokenBalance } = useBalance({
    address: address,
    token: ensureHexPrefix(selectedToken?.externalToken),
    chainId: selectedToken ? parseInt(availableNetworks.find(n => n.chainName === selectedNetwork)?.chainId || "0") : undefined,
    query: {
      enabled: !!address && !!selectedToken?.externalToken && !!isConnected,
    },
  });

  const [amount, setAmount] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{ amount?: string; network?: string }>({});
  const [autoDeposit, setAutoDeposit] = useState<boolean>(true);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState<boolean>(false);
  const [minDepositInfo, setMinDepositInfo] = useState<{ 
    amount: string; 
    amountWei: bigint; 
    loading: boolean;
  }>({ amount: "", amountWei: 0n, loading: false });
  const inFlightRef = useRef(false);


  const selectedNetworkConfig = useMemo(() => availableNetworks.find(n => n.chainName === selectedNetwork), [availableNetworks, selectedNetwork]);
  const expectedChainId = selectedNetworkConfig?.chainId ? parseInt(selectedNetworkConfig.chainId) : undefined;
  const isCorrectNetwork = isConnected && expectedChainId && chainId === expectedChainId;

  // Load networks and tokens on mount
  useEffect(() => {
    loadNetworksAndTokens();
  }, [loadNetworksAndTokens]);

  useEffect(() => {
    // When switching networks, choose first redeemable token by default
    if (!selectedToken && redeemableTokens.length > 0) {
      setSelectedToken(redeemableTokens[0]);
    }
  }, [redeemableTokens, selectedToken, setSelectedToken]);

  useEffect(() => {
    const ensureNetwork = async () => {
      if (!selectedNetwork || !isConnected || !expectedChainId) return;
      if (chainId !== expectedChainId) {
        setErrors(e => ({ ...e, network: `Switching to ${selectedNetwork} network...` }));
        try {
          await switchChain({ chainId: expectedChainId });
        } catch {
          setErrors(e => ({ ...e, network: `Please switch to ${selectedNetwork}` }));
        }
      } else {
        setErrors(e => ({ ...e, network: "" }));
      }
    };
    ensureNetwork();
  }, [chainId, expectedChainId, isConnected, selectedNetwork, switchChain]);

  // Min deposit amount for router
  const fetchMinDepositAmount = async (tokenAddress: string, decimals: number) => {
    if (!selectedNetworkConfig) return;
    setMinDepositInfo(prev => ({ ...prev, loading: true }));
    try {
      const validation = await bridgeContractService.validateRouterContract({
        depositRouterAddress: selectedNetworkConfig.depositRouter,
        amount: "0",
        decimals: decimals.toString(),
        chainId: selectedNetworkConfig.chainId,
        tokenAddress
      });
      const formattedMinAmount = validation.minAmount ? (Number(BigInt(validation.minAmount)) / Math.pow(10, decimals)).toString() : "0";
      const amountWei = validation.minAmount ? BigInt(validation.minAmount) : 0n;
      setMinDepositInfo({ amount: formattedMinAmount, amountWei, loading: false });
    } catch {
      setMinDepositInfo({ amount: "0", amountWei: 0n, loading: false });
    }
  };

  useEffect(() => {
    setAmount("");
    if (selectedToken && selectedNetworkConfig) {
      const d = parseInt(selectedToken.externalDecimals || "18");
      fetchMinDepositAmount(selectedToken.externalToken, d);
    }
  }, [selectedToken, selectedNetworkConfig]);

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

    const balanceMatch = externalTokenBalance?.formatted?.match(/^([\d,]+\.?\d*)/);
    const bal = balanceMatch
      ? parseFloat(balanceMatch[1].replace(/,/g, ""))
      : 0;

    if (num > bal) {
      setErrors((e) => ({
        ...e,
        amount: `Insufficient balance. Maximum: ${externalTokenBalance?.formatted || "0"} ${selectedToken?.externalSymbol}`,
      }));
      return false;
    }

    setErrors((e) => ({ ...e, amount: "" }));
    return true;
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (DECIMAL_PATTERN.test(value)) {
      setAmount(value);
      validateAmount(value);
    }
  };

  // Derived displays
  const formattedUsdstBalance = useMemo(() => formatBalance(usdstBalance || "0", undefined, 18, 2, 2), [usdstBalance]);
  const formattedSuppliedBalance = useMemo(() => formatBalance(liquidityInfo?.withdrawable?.userBalance || "0", undefined, 18, 2, 2), [liquidityInfo?.withdrawable?.userBalance]);

  const afterBalance = useMemo(() => {
    try {
      // Use supplied balance if auto-deposit is enabled, wallet balance otherwise
      const currentBalance = autoDeposit ? formattedSuppliedBalance : formattedUsdstBalance;
      const before = parseFloat((currentBalance || "0").replace(/,/g, ""));
      const add = parseFloat(amount || "0");
      const sum = isNaN(before) || isNaN(add) ? 0 : before + add;
      return sum.toLocaleString(undefined, { maximumFractionDigits: 6 });
    } catch {
      return autoDeposit ? formattedSuppliedBalance : formattedUsdstBalance;
    }
  }, [formattedUsdstBalance, formattedSuppliedBalance, amount, autoDeposit]);

  const apr = liquidityInfo?.supplyAPY || liquidityInfo?.maxSupplyAPY || "0";
  const estYearly = useMemo(() => {
    try {
      const amt = parseFloat(amount || "0");
      const apy = parseFloat((apr || "0").toString());
      const earn = (amt * apy) / 100;
      if (!isFinite(earn)) return "0";
      return earn.toFixed(2);
    } catch { return "0"; }
  }, [amount, apr]);

  // Core on-chain flow
  const ensurePermit2Approval = async (tokenAddress: string, amount: bigint, activeChainId: string) => {
    console.log("Checking Permit2 approval for token:", tokenAddress);
    
    const approval = await bridgeContractService.checkPermit2Approval({
      token: tokenAddress,
      owner: address as string,
      amount,
      chainId: activeChainId,
    });
    
    console.log("Permit2 approval status:", approval);
    
    if (!approval.isApproved) {
      console.log("Approving Permit2...");
      const approveTx = await writeContractAsync({
        address: ensureHexPrefix(tokenAddress),
        abi: ERC20_ABI,
        functionName: "approve",
        args: [PERMIT2_ADDRESS as `0x${string}`, BigInt(2) ** BigInt(256) - BigInt(1)],
        chain: await resolveViemChain(activeChainId),
        account: address as `0x${string}`,
      });
      
      await bridgeContractService.waitForTransaction(
        approveTx,
        activeChainId,
      );
      
      console.log("Permit2 approval completed");
    }
  };

  const handleMint = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsLoading(true);
    try {
      if (!selectedToken || !selectedNetworkConfig || !userAddress || !address) throw new Error("Missing configuration");

      // Validate router allows mint
      const validation = await bridgeContractService.validateRouterContract({
        depositRouterAddress: selectedNetworkConfig.depositRouter,
        amount,
        decimals: selectedToken.externalDecimals,
        chainId: selectedNetworkConfig.chainId,
        tokenAddress: selectedToken.externalToken
      });
      if (!validation.isValid) throw new Error(validation.error || "Validation failed");

      // Build permit2
      const depositAmount = safeParseUnits(amount, parseInt(selectedToken.externalDecimals || "18"));
      // Ensure Permit2 approval on external token
      await ensurePermit2Approval(selectedToken.externalToken, depositAmount, selectedNetworkConfig.chainId);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
      const nonce = bridgeContractService.getPermit2Nonce();
      const permitMessage = bridgeContractService.createPermit2Message({
        token: selectedToken.externalToken,
        amount: depositAmount,
        spender: selectedNetworkConfig.depositRouter,
        nonce,
        deadline,
      });
      const signature = await signTypedDataAsync({
        domain: bridgeContractService.getPermit2Domain(selectedNetworkConfig.chainId),
        types: bridgeContractService.getPermit2Types(),
        primaryType: "PermitTransferFrom",
        message: permitMessage,
        account: address as `0x${string}`,
      });

      // Simulate and send
      const client = createPublicClient({ chain: await resolveViemChain(selectedNetworkConfig.chainId), transport: http() });
      await client.simulateContract({
        address: selectedNetworkConfig.depositRouter as `0x${string}`,
        abi: DEPOSIT_ROUTER_ABI,
        functionName: "deposit",
        args: [
          ensureHexPrefix(selectedToken.externalToken),
          depositAmount,
          ensureHexPrefix(userAddress),
          nonce,
          deadline,
          signature as `0x${string}`
        ],
        account: address as `0x${string}`,
      });

      const txHash = await writeContractAsync({
        address: selectedNetworkConfig.depositRouter as `0x${string}`,
        abi: DEPOSIT_ROUTER_ABI,
        functionName: "deposit",
        args: [
          ensureHexPrefix(selectedToken.externalToken),
          depositAmount,
          ensureHexPrefix(userAddress),
          nonce,
          deadline,
          signature as `0x${string}`
        ],
        chain: await resolveViemChain(selectedNetworkConfig.chainId),
        account: address as `0x${string}`,
      });

      toast({ title: "Mint transaction sent", description: `Tx: ${txHash.slice(0,10)}…` });
      // Clear input early to reflect submitted state
      setAmount("");

      // Kick a quick balance refresh for immediate UI update
      await fetchUsdstBalance(userAddress);

      // After mint transaction sent, request auto save if box is checked
      if (autoDeposit) {
        await requestAutoSave({
          externalChainId: selectedNetworkConfig.chainId,
          externalTxHash: txHash,
        });
      }
    } catch (err: any) {
      // Error toast handled by injected hook
    } finally {
      setIsLoading(false);
      inFlightRef.current = false;
    }
  };

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
              {availableNetworks.map(n => (
                <SelectItem key={n.chainId} value={n.chainName}>{n.chainName}</SelectItem>
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
        <Label>Select Stablecoin</Label>
        <Select
          value={selectedToken?.externalToken || ""}
          onValueChange={(v) => setSelectedToken(redeemableTokens.find(t => t.externalToken === v) || null)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Choose token" />
          </SelectTrigger>
          <SelectContent>
            {redeemableTokens.map(t => (
              <SelectItem key={t.id} value={t.externalToken}>
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
          placeholder="0.00"
          className={errors.amount ? "border-red-500" : ""}
          value={amount}
          onChange={handleAmountChange}
          disabled={!isConnected}
        />
        {errors.amount && <p className="text-sm text-red-500">{errors.amount}</p>}
        {selectedToken && (
          <div className="flex justify-between items-center text-xs text-gray-500 mt-1">
            <span>
              {minDepositInfo.loading ? (
                <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Min</span>
              ) : (
                <>Min: {minDepositInfo.amount} {selectedToken.externalSymbol}</>
              )}
            </span>
          </div>
        )}
        {isConnected && selectedToken && (
          <div className="flex justify-between items-center text-xs text-gray-500">
            <span>
              Balance: {externalTokenBalance?.formatted || "0"} {selectedToken.externalSymbol}
            </span>
          </div>
        )}
        <PercentageButtons
          value={amount}
          maxValue={safeParseUnits(
            externalTokenBalance?.formatted || "0",
            parseInt(selectedToken?.externalDecimals || "18")
          ).toString()}
          onChange={setAmount}
          className="mt-2"
          decimals={parseInt(selectedToken?.externalDecimals || "18")}
        />
      </div>

      <div className="rounded-xl border bg-gray-50 p-4 space-y-3">
        <div className="flex items-center justify-between text-gray-600 text-sm">
          <span>USDST {autoDeposit ? "Supplied" : "Balance"}</span>
          <span className="font-medium">{autoDeposit ? formattedSuppliedBalance : formattedUsdstBalance || "0"} → {afterBalance}</span>
        </div>
        <div className="flex items-center justify-between text-gray-600 text-sm">
          <span>Outcome</span>
          <span className="font-medium">{amount || "0.00"} USDST deposited</span>
        </div>
        <div className="flex items-center justify-between text-gray-600 text-sm">
          <span>Current Saving Rate</span>
          <span className="font-medium text-green-600">{apr ? `${apr}%` : "N/A"}</span>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" className="accent-blue-600" checked={autoDeposit} onChange={e => setAutoDeposit(e.target.checked)} />
        Earn saving rate by offering USDST for lending
      </label>

      <Collapsible open={showAdvancedOptions} onOpenChange={setShowAdvancedOptions}>
        <CollapsibleTrigger className="flex items-center justify-between w-full text-sm text-gray-600 hover:text-gray-900 transition-colors">
          <span>See Advanced Options</span>
          <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${showAdvancedOptions ? 'rotate-180' : ''}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-4">
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
                  {availableNetworks.map(n => (
                    <SelectItem key={n.chainId} value={n.chainName}>{n.chainName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1.5">
              <Label>To Network</Label>
              <Input value="STRATO" disabled className="bg-gray-50" />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex justify-end">
        <Button
          onClick={handleMint}
          disabled={isLoading || !selectedToken || !amount || !isConnected || !isCorrectNetwork}
          className="bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90"
        >
          {isLoading ? "Processing..." : "Deposit + Get USDST"}
        </Button>
      </div>

      {errors.network && <p className="text-sm text-red-500">{errors.network}</p>}
    </div>
  );
};

export default MintWidget;
