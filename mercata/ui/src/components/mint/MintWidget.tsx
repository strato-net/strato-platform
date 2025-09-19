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
import { Loader2 } from "lucide-react";
import PercentageButtons from "@/components/ui/PercentageButtons";
import { useAccount, useBalance, useChainId, useSignTypedData, useSwitchChain, useWriteContract } from "wagmi";
import { createPublicClient, http } from "viem";
import { bridgeContractService } from "@/lib/bridge/contractService";
import { DEPOSIT_ROUTER_ABI, ERC20_ABI, PERMIT2_ADDRESS, resolveViemChain } from "@/lib/bridge/constants";
import { useBridgeContext } from "@/context/BridgeContext";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useLendingContext } from "@/context/LendingContext";
import { safeParseUnits, formatBalance } from "@/utils/numberUtils";
import BridgeWalletStatus from "@/components/bridge/BridgeWalletStatus";
import { formatUnits } from "ethers";
import { api } from "@/lib/axios";
import { usdstAddress } from "@/lib/constants";

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
    redeemableTokens,
    selectedNetwork,
    setSelectedNetwork,
    selectedMintToken,
    setSelectedMintToken,
    loadNetworksAndTokens,
    fetchRedeemableTokens,
  } = useBridgeContext();

  // Get external token balance for percentage buttons
  const { data: externalTokenBalance } = useBalance({
    address: address,
    token: selectedMintToken?.externalToken as `0x${string}` | undefined,
    chainId: selectedMintToken ? parseInt(availableNetworks.find(n => n.chainName === selectedNetwork)?.chainId || "0") : undefined,
    query: {
      enabled: !!address && !!selectedMintToken?.externalToken && !!isConnected,
    },
  });

  const [amount, setAmount] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{ amount?: string; network?: string }>({});
  const [autoDeposit, setAutoDeposit] = useState<boolean>(false);
  const [minDepositInfo, setMinDepositInfo] = useState<{ amount: string; loading: boolean }>({ amount: "", loading: false });
  const inFlightRef = useRef(false);


  const selectedNetworkConfig = useMemo(() => availableNetworks.find(n => n.chainName === selectedNetwork), [availableNetworks, selectedNetwork]);
  const expectedChainId = selectedNetworkConfig?.chainId ? parseInt(selectedNetworkConfig.chainId) : undefined;
  const isCorrectNetwork = isConnected && expectedChainId && chainId === expectedChainId;

  // Load networks and tokens on mount
  useEffect(() => {
    loadNetworksAndTokens();
  }, [loadNetworksAndTokens]);

  useEffect(() => {
    // When switching networks, choose first token by default
    if (!selectedMintToken && redeemableTokens.length > 0) {
      setSelectedMintToken(redeemableTokens[0]);
    }
  }, [redeemableTokens, selectedMintToken, setSelectedMintToken]);

  // Load mintable tokens when network changes
  useEffect(() => {
    if (!selectedNetwork) return;
    const networkConfig = availableNetworks.find(n => n.chainName === selectedNetwork);
    if (!networkConfig) return;

    fetchRedeemableTokens(networkConfig.chainId);
  }, [selectedNetwork, availableNetworks, fetchRedeemableTokens]);

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

  // Min deposit amount for router with mint=true
  const fetchMinDepositAmount = async (tokenAddress: string, decimals: number) => {
    if (!selectedNetworkConfig) return;
    setMinDepositInfo(prev => ({ ...prev, loading: true }));
    try {
      const validation = await bridgeContractService.validateRouterContract({
        depositRouterAddress: selectedNetworkConfig.depositRouter,
        amount: "0",
        decimals: decimals.toString(),
        chainId: selectedNetworkConfig.chainId,
        tokenAddress,
        mint: true,
      });
      const formattedMinAmount = validation.minAmount ? (Number(BigInt(validation.minAmount)) / Math.pow(10, decimals)).toString() : "0";
      setMinDepositInfo({ amount: formattedMinAmount, loading: false });
    } catch {
      setMinDepositInfo({ amount: "0", loading: false });
    }
  };

  useEffect(() => {
    setAmount("");
    if (selectedMintToken && selectedNetworkConfig) {
      const d = parseInt(selectedMintToken.externalDecimals || "18");
      fetchMinDepositAmount(selectedMintToken.externalToken, d);
    }
  }, [selectedMintToken, selectedNetworkConfig]);

  const validateAmount = (value: string) => {
    if (!value) { setErrors(e => ({ ...e, amount: "" })); return true; }
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0 || num > Number(externalTokenBalance?.formatted)) {
      setErrors(e => ({ ...e, amount: "Enter a valid amount" }));
      return false;
    }
    setErrors(e => ({ ...e, amount: "" }));
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
    const approval = await bridgeContractService.checkPermit2Approval({
      token: tokenAddress,
      owner: address as string,
      amount,
      chainId: activeChainId,
    });
    if (!approval.isApproved) {
      await writeContractAsync({
        address: tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [PERMIT2_ADDRESS as `0x${string}`, BigInt(2) ** BigInt(256) - BigInt(1)],
        chain: await resolveViemChain(activeChainId),
        account: address as `0x${string}`,
      });
    }
  };

  const handleMint = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsLoading(true);
    try {
      if (!selectedMintToken || !selectedNetworkConfig || !userAddress || !address) throw new Error("Missing configuration");

      // Validate router allows mint
      const validation = await bridgeContractService.validateRouterContract({
        depositRouterAddress: selectedNetworkConfig.depositRouter,
        amount,
        decimals: selectedMintToken.externalDecimals,
        chainId: selectedNetworkConfig.chainId,
        tokenAddress: selectedMintToken.externalToken,
        mint: true,
      });
      if (!validation.isValid) throw new Error(validation.error || "Validation failed");

      // Build permit2
      const depositAmount = safeParseUnits(amount, parseInt(selectedMintToken.externalDecimals || "18"));
      // Ensure Permit2 approval on external token
      await ensurePermit2Approval(selectedMintToken.externalToken, depositAmount, selectedNetworkConfig.chainId);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
      const nonce = bridgeContractService.getPermit2Nonce();
      const permitMessage = bridgeContractService.createPermit2Message({
        token: selectedMintToken.externalToken,
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
          bridgeContractService.formatAddress(selectedMintToken.externalToken),
          depositAmount,
          bridgeContractService.formatAddress(userAddress),
          nonce,
          deadline,
          signature as `0x${string}`,
          true,
        ],
        account: address as `0x${string}`,
      });

      const txHash = await writeContractAsync({
        address: selectedNetworkConfig.depositRouter as `0x${string}`,
        abi: DEPOSIT_ROUTER_ABI,
        functionName: "deposit",
        args: [
          bridgeContractService.formatAddress(selectedMintToken.externalToken),
          depositAmount,
          bridgeContractService.formatAddress(userAddress),
          nonce,
          deadline,
          signature as `0x${string}`,
          true,
        ],
        chain: await resolveViemChain(selectedNetworkConfig.chainId),
        account: address as `0x${string}`,
      });

      toast({ title: "Mint transaction sent", description: `Tx: ${txHash.slice(0,10)}…` });
      // Clear input early to reflect submitted state
      setAmount("");

      // Kick a quick balance refresh for immediate UI update
      await fetchUsdstBalance(userAddress);

      // Auto-deposit: poll for USDST balance increase and deposit (TODO this is a really hacky way to do this)
      if (autoDeposit) {
        const beforeWei = BigInt(usdstBalance || "0");
        await fetchUsdstBalance(userAddress)
        const targetIncreaseWei = safeParseUnits(amount, 18);
        const start = Date.now();
        const timeoutMs = 8 * 60 * 1000; // 8 minutes
        let deposited = false;

        while (Date.now() - start < timeoutMs) {
          await new Promise(r => setTimeout(r, 4000));
          await fetchUsdstBalance(userAddress);
          try {
            // Get fresh balance directly from API instead of using React state
            const nowRes = await api.get(`/tokens/balance?address=eq.${usdstAddress}`);
            const nowBalanceFromAPI = nowRes?.data?.[0]?.balance || "0";
            const nowWei = BigInt(nowBalanceFromAPI);

            if (nowWei - beforeWei == targetIncreaseWei) {
              // Deposit the minted amount
              const amtDec = safeParseUnits(amount, 18).toString();
              await depositLiquidity({ amount: amtDec });
              await refreshLiquidity();
              // Also update the React state
              await fetchUsdstBalance(userAddress);
              toast({ title: "Auto-deposit complete", description: `Supplied ${amtDec} USDST to lending pool` });
              deposited = true;
              break;
            }
          } catch (balanceErr) {
            console.error("Error checking balance:", balanceErr);
          }
        }
        if (!deposited) {
          toast({ title: "Auto-deposit pending", description: "We'll deposit after USDST arrives. If it takes too long, deposit from Lending section.", variant: "default" });
        }
      }
    } catch (err: any) {
      const msg = err?.message || "Transaction failed";
      toast({ title: "Mint failed", description: msg, variant: "destructive" });
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
              setSelectedMintToken(null);
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
          value={selectedMintToken?.stratoToken || ""}
          onValueChange={(v) => setSelectedMintToken(redeemableTokens.find(t => t.stratoToken === v) || null)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Choose token" />
          </SelectTrigger>
          <SelectContent>
            {redeemableTokens.map(t => (
              <SelectItem key={t.stratoToken} value={t.stratoToken}>
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
        {selectedMintToken && (
          <div className="flex justify-between items-center text-xs text-gray-500 mt-1">
            <span>
              {minDepositInfo.loading ? (
                <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Min</span>
              ) : (
                <>Min: {minDepositInfo.amount} {selectedMintToken.externalSymbol}</>
              )}
            </span>
          </div>
        )}
        {isConnected && selectedMintToken && (
          <div className="flex justify-between items-center text-xs text-gray-500">
            <span>
              Balance: {externalTokenBalance?.formatted || "0"} {selectedMintToken.externalSymbol}
            </span>
          </div>
        )}
        <PercentageButtons
          value={amount}
          maxValue={safeParseUnits(
            externalTokenBalance?.formatted || "0",
            parseInt(selectedMintToken?.externalDecimals || "18")
          ).toString()}
          onChange={setAmount}
          className="mt-2"
          decimals={parseInt(selectedMintToken?.externalDecimals || "18")}
        />
      </div>

      {/* <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" className="accent-blue-600" checked={autoDeposit} onChange={e => setAutoDeposit(e.target.checked)} />
        Automatically deposit minted USDST into lending pool
      </label> */}

      <div className="rounded-xl border bg-gray-50 p-4 space-y-3">
        {autoDeposit && (
          <div className="flex items-center justify-between text-gray-600 text-sm">
            <span>Current APY</span>
            <span className="font-medium">{apr ? `${apr}%` : "N/A"}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-gray-600 text-sm">
          <span>USDST {autoDeposit ? "Supplied" : "Balance"}</span>
          <span className="font-medium">{autoDeposit ? formattedSuppliedBalance : formattedUsdstBalance || "0"} → {afterBalance}</span>
        </div>
        <div className="flex items-center justify-between text-gray-600 text-sm">
          <span>Outcome</span>
          <span className="font-medium">{amount || "0.00"} USDST deposited {autoDeposit ? "and lent" : ""}</span>
        </div>
      </div>



      <div className="flex justify-end">
        <Button
          onClick={handleMint}
          disabled={isLoading || !selectedMintToken || !amount || !isConnected || !isCorrectNetwork}
          className="bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90"
        >
          {isLoading ? "Processing..." : "Get USDST"}
        </Button>
      </div>

      {errors.network && <p className="text-sm text-red-500">{errors.network}</p>}
    </div>
  );
};

export default MintWidget;

