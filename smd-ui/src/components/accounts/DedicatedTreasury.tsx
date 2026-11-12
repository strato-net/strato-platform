import { useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useUser } from "@/context/UserContext";
import { useSubmitTransaction } from "@/hooks/useSubmitTransaction";
import { parseJsonExact } from "@/lib/args";
import { shortenHex } from "@/lib/utils";
import {
  buildDedicatedProtocolWorkflow,
  type DedicatedProtocolAction,
  useDedicatedHistory,
  useDedicatedMultisigActions,
} from "@/services/dedicatedMultisig";
import {
  useCDPMetadata,
  useDeployedPositions,
  usePoolMetadata,
  useStakingMetadata,
  useV3AllowanceMetadata,
} from "@/services/protocolMetadata";
import {
  useMyTokens,
  useTokenAllowances,
  type TokenBalance,
} from "@/services/tokens";
import { strip0x, type UserWallet } from "@/services/userWallets";

const PERCENTS = [25, 50, 75, 100] as const;
const validAddress = (value: string) => /^[0-9a-f]{40}$/i.test(strip0x(value.trim()));
const positiveInteger = (value: string) => /^\d+$/.test(value.trim()) && BigInt(value.trim()) > 0n;
const nonNegativeInteger = (value: string) => /^\d+$/.test(value.trim());
const toRawUnits = (value: string, decimals: number): string => {
  try {
    return parseUnits(value, decimals).toString();
  } catch {
    return "";
  }
};

const ACTION_LABELS: Record<DedicatedProtocolAction, string> = {
  stake: "Stake",
  unstake: "Unstake",
  cdpDeposit: "CDP deposit",
  cdpBorrow: "CDP borrow",
  addLiquidity: "Add V2 liquidity",
  addLiquidityStable: "Add stable liquidity",
  removeLiquidity: "Remove V2 liquidity",
  removeLiquidityStable: "Remove stable liquidity",
  removeLiquidityOneCoin: "Remove stable liquidity as one coin",
  v3Mint: "Create V3 position",
  v3Increase: "Increase V3 position",
  v3Decrease: "Decrease V3 position",
  v3Collect: "Collect V3 position",
};

const humanBalance = (token: TokenBalance) => {
  try {
    return formatUnits(BigInt(token.balance), token.decimals);
  } catch {
    return token.balance;
  }
};

function TokenAmount({
  tokens,
  tokenAddress,
  setTokenAddress,
  amount,
  setAmount,
}: {
  tokens: TokenBalance[];
  tokenAddress: string;
  setTokenAddress: (value: string) => void;
  amount: string;
  setAmount: (value: string) => void;
}) {
  const token = tokens.find((item) => item.address === tokenAddress) ?? tokens[0];
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Select value={token?.address ?? ""} onValueChange={setTokenAddress}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Token" /></SelectTrigger>
          <SelectContent>
            {tokens.map((item) => (
              <SelectItem key={item.address} value={item.address}>{item.symbol}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="Amount" />
      </div>
      {token ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Balance: {humanBalance(token)} {token.symbol}</span>
          <div className="flex gap-1">
            {PERCENTS.map((percent) => (
              <Button
                key={percent}
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setAmount(formatUnits(
                  (BigInt(token.balance) * BigInt(percent)) / 100n,
                  token.decimals
                ))}
              >
                {percent === 100 ? "Max" : `${percent}%`}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DedicatedTreasuryTab({ wallet, disabled }: { wallet: UserWallet; disabled: boolean }) {
  const { userAddress } = useUser();
  const { submit, canSubmit } = useSubmitTransaction();
  const queryClient = useQueryClient();
  const actions = useDedicatedMultisigActions(wallet.address);
  const { data: sourceTokens = [] } = useMyTokens(userAddress);
  const { data: treasury = [] } = useMyTokens(wallet.address);
  const { data: deployed, isLoading: positionsLoading } = useDeployedPositions(wallet.address);
  const [depositToken, setDepositToken] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [transferToken, setTransferToken] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState<"deposit" | "transfer" | "">("");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["my-tokens", userAddress] });
    queryClient.invalidateQueries({ queryKey: ["my-tokens", wallet.address] });
    queryClient.invalidateQueries({ queryKey: ["deployed-positions", strip0x(wallet.address)] });
    queryClient.invalidateQueries({ queryKey: ["dedicated-multisig-issues", wallet.address] });
  };

  const deposit = async () => {
    const token = sourceTokens.find((item) => item.address === depositToken) ?? sourceTokens[0];
    if (!token) return toast.error("Select a token to deposit");
    let raw: bigint;
    try {
      raw = parseUnits(depositAmount, token.decimals);
      if (raw <= 0n || raw > BigInt(token.balance)) throw new Error();
    } catch {
      return toast.error("Enter a positive amount within your balance");
    }
    setBusy("deposit");
    try {
      await submit("FUNCTION", {
        contractName: token.symbol,
        contractAddress: token.address,
        value: 0,
        method: "transfer",
        args: { to: strip0x(wallet.address), value: raw.toString() },
        metadata: {},
      });
      setDepositAmount("");
      refresh();
      toast.success(`Deposited ${depositAmount} ${token.symbol}`);
    } catch (error: any) {
      toast.error(error?.message || "Deposit failed");
    } finally {
      setBusy("");
    }
  };

  const proposeTransfer = async () => {
    const token = treasury.find((item) => item.address === transferToken) ?? treasury[0];
    if (!token || !validAddress(recipient)) return toast.error("Select a token and enter a valid recipient");
    let raw: bigint;
    try {
      raw = parseUnits(transferAmount, token.decimals);
      if (raw <= 0n || raw > BigInt(token.balance)) throw new Error();
    } catch {
      return toast.error("Enter a positive amount within the treasury balance");
    }
    setBusy("transfer");
    try {
      await actions.proposeIssue(
        token.address,
        "transfer",
        ["address", "uint256"],
        [
          { type: "address", value: strip0x(recipient) },
          { type: "uint256", value: raw.toString() },
        ],
        wallet.signerUsername || undefined
      );
      setTransferAmount("");
      setRecipient("");
      refresh();
      toast.success("Transfer issue created");
    } catch (error: any) {
      toast.error(error?.message || "Could not create transfer issue");
    } finally {
      setBusy("");
    }
  };

  const hasStaking = (() => {
    try {
      return BigInt(deployed?.staking.stakedAmount ?? "0") > 0n ||
        BigInt(deployed?.staking.unbondingAmount ?? "0") > 0n;
    } catch {
      return false;
    }
  })();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>Available holdings</Label>
        {treasury.length ? treasury.map((token) => (
          <div key={token.address} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
            <span className="font-medium">{token.symbol}</span>
            <span className="font-mono text-xs">{humanBalance(token)}</span>
          </div>
        )) : <p className="text-sm text-muted-foreground">This multisig holds no tokens yet.</p>}
      </div>

      <div className="space-y-2">
        <Label>Deployed positions</Label>
        {positionsLoading ? <p className="text-sm text-muted-foreground">Loading positions…</p> : (
          <>
            {hasStaking ? (
              <div className="rounded-md border px-3 py-2 text-sm">
                <div className="font-medium">Staking</div>
                <div className="text-xs text-muted-foreground">
                  {formatUnits(BigInt(deployed?.staking.stakedAmount ?? "0"), deployed?.staking.tokenDecimals ?? 18)} staked ·{" "}
                  {formatUnits(BigInt(deployed?.staking.unbondingAmount ?? "0"), deployed?.staking.tokenDecimals ?? 18)} unbonding
                </div>
              </div>
            ) : null}
            {deployed?.collateral.map((position) => (
              <div key={position.asset} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span className="font-medium">{position.symbol} collateral</span>
                <span className="font-mono text-xs">{formatUnits(BigInt(position.amount), position.decimals)}</span>
              </div>
            ))}
            {!hasStaking && !deployed?.collateral.length ? (
              <p className="text-sm text-muted-foreground">No staked tokens or supplied collateral.</p>
            ) : null}
          </>
        )}
      </div>

      <Separator />
      <div className="space-y-3">
        <div className="font-medium">Deposit into treasury</div>
        <TokenAmount
          tokens={sourceTokens}
          tokenAddress={depositToken}
          setTokenAddress={setDepositToken}
          amount={depositAmount}
          setAmount={setDepositAmount}
        />
        <Button disabled={disabled || !canSubmit || busy !== "" || !sourceTokens.length} onClick={() => void deposit()}>
          {busy === "deposit" ? "Depositing…" : "Deposit"}
        </Button>
      </div>

      <Separator />
      <div className="space-y-3">
        <div className="font-medium">Propose transfer</div>
        <TokenAmount
          tokens={treasury}
          tokenAddress={transferToken}
          setTokenAddress={setTransferToken}
          amount={transferAmount}
          setAmount={setTransferAmount}
        />
        <Label>Recipient</Label>
        <Input value={recipient} onChange={(event) => setRecipient(event.target.value)} className="font-mono text-xs" />
        <Button disabled={disabled || !canSubmit || busy !== "" || !treasury.length} onClick={() => void proposeTransfer()}>
          {busy === "transfer" ? "Creating issue…" : "Create transfer issue"}
        </Button>
      </div>
    </div>
  );
}

const amountField = (
  label: string,
  value: string,
  setValue: (value: string) => void,
  placeholder = "Amount"
) => (
  <div className="space-y-1">
    <Label>{label}</Label>
    <Input value={value} onChange={(event) => setValue(event.target.value)} inputMode="numeric" placeholder={placeholder} />
  </div>
);

export function DedicatedProtocolActionsTab({ wallet, disabled }: { wallet: UserWallet; disabled: boolean }) {
  const actions = useDedicatedMultisigActions(wallet.address);
  const staking = useStakingMetadata();
  const cdp = useCDPMetadata();
  const pools = usePoolMetadata();
  const v3 = useV3AllowanceMetadata(wallet.address);
  const [action, setAction] = useState<DedicatedProtocolAction | "">("");
  const [poolAddress, setPoolAddress] = useState("");
  const [validator, setValidator] = useState("");
  const [asset, setAsset] = useState("");
  const [v3Pool, setV3Pool] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [amount, setAmount] = useState("");
  const [amount2, setAmount2] = useState("");
  const [amount3, setAmount3] = useState("");
  const [amount4, setAmount4] = useState("");
  const [tickLower, setTickLower] = useState("");
  const [tickUpper, setTickUpper] = useState("");
  const [liquidity, setLiquidity] = useState("");
  const [coinIndex, setCoinIndex] = useState("");
  const [amountsText, setAmountsText] = useState("[]");
  const [busy, setBusy] = useState(false);

  const stableAction = action === "addLiquidityStable" ||
    action === "removeLiquidityStable" || action === "removeLiquidityOneCoin";
  const standardPoolAction = action === "addLiquidity" || action === "removeLiquidity";
  const selectedPool = (pools.data ?? []).find((pool) => pool.address === poolAddress);
  const effectiveAction: DedicatedProtocolAction | "" =
    action === "addLiquidityStable" && !selectedPool?.coins?.length ? "addLiquidity"
      : action === "removeLiquidityStable" && !selectedPool?.coins?.length ? "removeLiquidity"
        : action;
  const compatiblePools = (pools.data ?? []).filter((pool) =>
    !pool.isDisabled &&
    (!pool.isPaused || action === "removeLiquidity" || action === "removeLiquidityStable") &&
    (stableAction ? pool.isStable : standardPoolAction ? !pool.isStable : false)
  );
  const selectedPosition = v3.data?.positions.find((position) => position.tokenId === tokenId);
  const selectedV3Pool = v3.data?.pools.find((pool) =>
    pool.address === (action === "v3Mint" ? v3Pool : selectedPosition?.poolAddress)
  );
  const selectedAsset = cdp.data?.assets.find((item) => item.asset === asset);
  const selectedValidator = staking.data?.validators.find((item) => item.address === validator);
  const stableAmounts = useMemo(() => {
    try {
      const parsed = parseJsonExact(amountsText);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }, [amountsText]);
  const stableRawAmounts = stableAmounts.map((value, index) =>
    toRawUnits(value, selectedPool?.coins?.[index]?.customDecimals ?? 18)
  );
  const selectedStableCoin = selectedPool?.coins?.[Number(coinIndex)];
  let callAmount = amount;
  let callAmount2 = amount2;
  let callAmount3 = amount3;
  let callAmount4 = amount4;
  if (action === "stake" || action === "unstake") {
    callAmount = toRawUnits(amount, staking.data?.tokenDecimals ?? 18);
  } else if (action === "cdpDeposit") {
    callAmount = toRawUnits(amount, selectedAsset?.decimals ?? 18);
  } else if (action === "cdpBorrow") {
    callAmount = toRawUnits(amount, 18);
  } else if (effectiveAction === "addLiquidity") {
    callAmount = toRawUnits(amount, selectedPool?.tokenB.customDecimals ?? 18);
    callAmount2 = toRawUnits(amount2, selectedPool?.tokenA.customDecimals ?? 18);
  } else if (effectiveAction === "removeLiquidity") {
    callAmount = toRawUnits(amount, selectedPool?.lpToken?.customDecimals ?? 18);
    callAmount2 = toRawUnits(amount2, selectedPool?.tokenB.customDecimals ?? 18);
    callAmount3 = toRawUnits(amount3, selectedPool?.tokenA.customDecimals ?? 18);
  } else if (effectiveAction === "addLiquidityStable") {
    callAmount2 = toRawUnits(amount2, selectedPool?.lpToken?.customDecimals ?? 18);
  } else if (effectiveAction === "removeLiquidityStable") {
    callAmount = toRawUnits(amount, selectedPool?.lpToken?.customDecimals ?? 18);
  } else if (effectiveAction === "removeLiquidityOneCoin") {
    callAmount = toRawUnits(amount, selectedPool?.lpToken?.customDecimals ?? 18);
    callAmount2 = toRawUnits(amount2, selectedStableCoin?.customDecimals ?? 18);
  } else if (action === "v3Mint" || action === "v3Increase") {
    callAmount = toRawUnits(amount, selectedV3Pool?.token0.customDecimals ?? 18);
    callAmount2 = toRawUnits(amount2, selectedV3Pool?.token1.customDecimals ?? 18);
    callAmount3 = toRawUnits(amount3, selectedV3Pool?.token0.customDecimals ?? 18);
    callAmount4 = toRawUnits(amount4, selectedV3Pool?.token1.customDecimals ?? 18);
  } else if (action === "v3Decrease" || action === "v3Collect") {
    callAmount = toRawUnits(amount, selectedV3Pool?.token0.customDecimals ?? 18);
    callAmount2 = toRawUnits(amount2, selectedV3Pool?.token1.customDecimals ?? 18);
  }

  const target = action === "stake" || action === "unstake"
    ? staking.data?.stakingAddress ?? ""
    : action === "cdpDeposit" || action === "cdpBorrow"
      ? cdp.data?.engineAddress ?? ""
      : action.startsWith("v3")
        ? v3.data?.positionManagerAddress ?? ""
        : poolAddress;
  const approvalSpender = action === "stake" ? target
    : action === "cdpDeposit" ? cdp.data?.vaultAddress ?? ""
      : effectiveAction === "addLiquidity" || effectiveAction === "addLiquidityStable" ? poolAddress
        : action === "v3Mint" || action === "v3Increase" ? v3.data?.positionManagerAddress ?? ""
          : "";
  const approvalSpecs = action === "stake"
    ? [{ token: staking.data?.stratoTokenAddress ?? "", amount: callAmount }]
    : action === "cdpDeposit"
      ? [{ token: asset, amount: callAmount }]
      : effectiveAction === "addLiquidity"
        ? [
            { token: selectedPool?.tokenA.address ?? "", amount: callAmount2 },
            { token: selectedPool?.tokenB.address ?? "", amount: callAmount },
          ]
        : effectiveAction === "addLiquidityStable"
          ? (selectedPool?.coins ?? []).map((coin, index) => ({ token: coin.address, amount: stableRawAmounts[index] ?? "" }))
            .filter((item) => positiveInteger(item.amount))
          : action === "v3Mint" || action === "v3Increase"
            ? [
                { token: selectedV3Pool?.token0.address ?? "", amount: callAmount },
                { token: selectedV3Pool?.token1.address ?? "", amount: callAmount2 },
              ].filter((item) => positiveInteger(item.amount))
            : [];
  const allowances = useTokenAllowances(
    approvalSpecs.map((item) => item.token),
    wallet.address,
    validAddress(approvalSpender) ? approvalSpender : null
  );
  const missingApprovals = approvalSpecs.filter((item, index) => {
    try {
      return BigInt(allowances.data?.[index] ?? "0") < BigInt(item.amount);
    } catch {
      return true;
    }
  });

  const resetAction = (value: DedicatedProtocolAction) => {
    setAction(value);
    setPoolAddress("");
    setValidator("");
    setAsset("");
    setV3Pool("");
    setTokenId("");
    setAmount("");
    setAmount2("");
    setAmount3("");
    setAmount4("");
    setTickLower("");
    setTickUpper("");
    setLiquidity("");
    setCoinIndex("");
    setAmountsText("[]");
  };

  const validate = () => {
    if (!action || !validAddress(target)) throw new Error("Select an operation and valid protocol target");
    if (action === "stake" || action === "unstake") {
      if (!selectedValidator || (action === "stake" && !selectedValidator.active)) throw new Error("Select an eligible validator");
      if (!positiveInteger(callAmount)) throw new Error("Enter a positive amount");
    } else if (action === "cdpDeposit" || action === "cdpBorrow") {
      if (!selectedAsset || !selectedAsset.isSupported || selectedAsset.isPaused) throw new Error("Select an active collateral asset");
      if (!positiveInteger(callAmount)) throw new Error("Enter a positive amount");
    } else if (effectiveAction === "addLiquidity") {
      if (!selectedPool || !positiveInteger(callAmount) || !positiveInteger(callAmount2)) throw new Error("Select a pool and enter both token amounts");
    } else if (effectiveAction === "removeLiquidity") {
      if (!selectedPool || ![callAmount, callAmount2, callAmount3].every(positiveInteger)) throw new Error("Enter LP and minimum token amounts");
    } else if (effectiveAction === "addLiquidityStable") {
      if (!selectedPool?.coins?.length || stableRawAmounts.length !== selectedPool.coins.length ||
          !stableRawAmounts.every(nonNegativeInteger) || !stableRawAmounts.some(positiveInteger) || !positiveInteger(callAmount2)) {
        throw new Error("Enter one amount per pool coin and a positive minimum LP amount");
      }
    } else if (effectiveAction === "removeLiquidityStable") {
      if (!selectedPool?.coins?.length || !positiveInteger(callAmount) ||
          stableRawAmounts.length !== selectedPool.coins.length || !stableRawAmounts.every(nonNegativeInteger)) {
        throw new Error("Enter the LP amount and one minimum per pool coin");
      }
    } else if (action === "removeLiquidityOneCoin") {
      if (!selectedPool?.coins?.length || !positiveInteger(callAmount) || !nonNegativeInteger(coinIndex) ||
          Number(coinIndex) >= selectedPool.coins.length || !positiveInteger(callAmount2)) {
        throw new Error("Enter an LP amount, pool coin, and minimum received amount");
      }
    } else if (action === "v3Mint") {
      if (!selectedV3Pool) throw new Error("Select an indexed V3 pool");
      if (!/^-?\d+$/.test(tickLower) || !/^-?\d+$/.test(tickUpper) || BigInt(tickLower) >= BigInt(tickUpper)) {
        throw new Error("Enter ordered lower and upper ticks");
      }
      if (![callAmount, callAmount2, callAmount3, callAmount4].every(nonNegativeInteger) ||
          !(positiveInteger(callAmount) || positiveInteger(callAmount2))) throw new Error("Enter valid desired and minimum amounts");
    } else if (action === "v3Increase") {
      if (!selectedPosition || !selectedV3Pool) throw new Error("Select an owned indexed V3 position");
      if (![callAmount, callAmount2, callAmount3, callAmount4].every(nonNegativeInteger) ||
          !(positiveInteger(callAmount) || positiveInteger(callAmount2))) throw new Error("Enter valid desired and minimum amounts");
    } else if (action === "v3Decrease") {
      if (!selectedPosition || !selectedV3Pool || !positiveInteger(liquidity) ||
          ![callAmount, callAmount2].every(nonNegativeInteger)) {
        throw new Error("Select an owned position and enter liquidity and minimum amounts");
      }
    } else if (action === "v3Collect") {
      if (!selectedPosition || !selectedV3Pool || ![callAmount, callAmount2].every(nonNegativeInteger) ||
          !(positiveInteger(callAmount) || positiveInteger(callAmount2))) throw new Error("Select an owned position and collection maximums");
    }
    if (approvalSpecs.length && (!validAddress(approvalSpender) ||
        approvalSpecs.some((item) => !validAddress(item.token) || !positiveInteger(item.amount)) ||
        !allowances.isSuccess)) throw new Error("Token allowances are not ready");
  };

  const propose = async () => {
    try {
      validate();
      const workflow = buildDedicatedProtocolWorkflow(effectiveAction as DedicatedProtocolAction, {
        target,
        validator: selectedValidator?.address,
        asset: selectedAsset?.asset,
        amount: callAmount,
        amount2: callAmount2,
        amount3: callAmount3,
        amounts: action.startsWith("v3") ? [callAmount4] : stableRawAmounts,
        receiver: strip0x(wallet.address),
        coinIndex,
        pool: selectedV3Pool?.address,
        tokenId,
        tickLower,
        tickUpper,
        liquidity,
      }, missingApprovals.map((item) => ({
        token: item.token,
        spender: approvalSpender,
        amount: item.amount,
      })));
      setBusy(true);
      for (const call of workflow) await actions.proposeCall(call, wallet.signerUsername || undefined);
      toast.success(`${ACTION_LABELS[action as DedicatedProtocolAction]} workflow created`, {
        description: missingApprovals.length
          ? "Approval issues were created before the protocol action."
          : "The protocol action is ready for signer review.",
      });
    } catch (error: any) {
      toast.error(error?.message || "Could not create protocol workflow");
    } finally {
      setBusy(false);
    }
  };

  const v3Action = action.startsWith("v3");
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Protocol operation</Label>
        <Select value={action} onValueChange={(value) => resetAction(value as DedicatedProtocolAction)}>
          <SelectTrigger><SelectValue placeholder="Select an operation" /></SelectTrigger>
          <SelectContent>
            {(Object.keys(ACTION_LABELS) as DedicatedProtocolAction[]).map((value) => (
              <SelectItem key={value} value={value}>{ACTION_LABELS[value]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {(standardPoolAction || stableAction) ? (
        <div className="space-y-1">
          <Label>Indexed pool</Label>
          <Select value={poolAddress} onValueChange={setPoolAddress}>
            <SelectTrigger><SelectValue placeholder="Select a pool" /></SelectTrigger>
            <SelectContent>
              {compatiblePools.map((pool) => (
                <SelectItem key={pool.address} value={pool.address}>{pool.poolName} · {shortenHex(pool.address, 6, 4)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {(action === "stake" || action === "unstake") ? (
        <>
          <Label>Validator</Label>
          <Select value={validator} onValueChange={setValidator}>
            <SelectTrigger><SelectValue placeholder="Select a validator" /></SelectTrigger>
            <SelectContent>
              {(staking.data?.validators ?? []).filter((item) => action === "unstake" || item.active).map((item) => (
                <SelectItem key={item.address} value={item.address}>{item.name || shortenHex(item.address, 6, 4)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {amountField(`Amount (${staking.data?.tokenSymbol ?? "token"})`, amount, setAmount)}
        </>
      ) : null}

      {(action === "cdpDeposit" || action === "cdpBorrow") ? (
        <>
          <Label>Collateral asset</Label>
          <Select value={asset} onValueChange={setAsset}>
            <SelectTrigger><SelectValue placeholder="Select collateral" /></SelectTrigger>
            <SelectContent>
              {(cdp.data?.assets ?? []).filter((item) => item.isSupported && !item.isPaused).map((item) => (
                <SelectItem key={item.asset} value={item.asset}>{item.symbol}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {amountField(action === "cdpDeposit" ? `Collateral amount (${selectedAsset?.symbol ?? "token"})` : "USDST amount", amount, setAmount)}
        </>
      ) : null}

      {effectiveAction === "addLiquidity" ? (
        <>
          {amountField(`${selectedPool?.tokenB._symbol ?? "Token B"} amount`, amount, setAmount)}
          {amountField(`Maximum ${selectedPool?.tokenA._symbol ?? "Token A"} amount`, amount2, setAmount2)}
        </>
      ) : null}
      {effectiveAction === "removeLiquidity" ? (
        <>
          {amountField("LP token amount", amount, setAmount)}
          {amountField(`Minimum ${selectedPool?.tokenB._symbol ?? "Token B"}`, amount2, setAmount2)}
          {amountField(`Minimum ${selectedPool?.tokenA._symbol ?? "Token A"}`, amount3, setAmount3)}
        </>
      ) : null}
      {effectiveAction === "addLiquidityStable" || effectiveAction === "removeLiquidityStable" ? (
        <>
          {effectiveAction === "removeLiquidityStable" ? amountField("LP token amount", amount, setAmount) : null}
          <Label>{effectiveAction === "addLiquidityStable" ? "Coin amounts" : "Minimum coin amounts"} (decimal units, pool order)</Label>
          <Textarea
            value={amountsText}
            onChange={(event) => setAmountsText(event.target.value)}
            placeholder={JSON.stringify((selectedPool?.coins ?? []).map(() => "0"))}
            className="font-mono text-xs"
          />
          {effectiveAction === "addLiquidityStable" ? amountField("Minimum LP tokens minted", amount2, setAmount2) : null}
        </>
      ) : null}
      {action === "removeLiquidityOneCoin" ? (
        <>
          {amountField("LP token amount", amount, setAmount)}
          <Label>Coin</Label>
          <Select value={coinIndex} onValueChange={setCoinIndex}>
            <SelectTrigger><SelectValue placeholder="Select coin" /></SelectTrigger>
            <SelectContent>
              {(selectedPool?.coins ?? []).map((coin, index) => (
                <SelectItem key={coin.address} value={String(index)}>{coin._symbol}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {amountField("Minimum amount received", amount2, setAmount2)}
        </>
      ) : null}

      {v3Action ? (
        <>
          <p className="break-all font-mono text-xs text-muted-foreground">
            PositionManagerV3: {v3.data?.positionManagerAddress || "Loading…"}
          </p>
          {action === "v3Mint" ? (
            <>
              <Label>Indexed V3 pool</Label>
              <Select value={v3Pool} onValueChange={setV3Pool}>
                <SelectTrigger><SelectValue placeholder="Select V3 pool" /></SelectTrigger>
                <SelectContent>
                  {(v3.data?.pools ?? []).map((pool) => (
                    <SelectItem key={pool.address} value={pool.address}>
                      {pool.token0._symbol}/{pool.token1._symbol} · {shortenHex(pool.address, 6, 4)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="grid grid-cols-2 gap-2">
                {amountField("Lower tick", tickLower, setTickLower)}
                {amountField("Upper tick", tickUpper, setTickUpper)}
              </div>
            </>
          ) : (
            <>
              <Label>Owned V3 position</Label>
              <Select value={tokenId} onValueChange={setTokenId}>
                <SelectTrigger><SelectValue placeholder="Select position" /></SelectTrigger>
                <SelectContent>
                  {(v3.data?.positions ?? []).map((position) => (
                    <SelectItem key={position.tokenId} value={position.tokenId}>
                      #{position.tokenId} · {shortenHex(position.poolAddress, 6, 4)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          {action === "v3Mint" || action === "v3Increase" ? (
            <>
              {amountField("Token 0 desired", amount, setAmount)}
              {amountField("Token 1 desired", amount2, setAmount2)}
              {amountField("Token 0 minimum", amount3, setAmount3)}
              {amountField("Token 1 minimum", amount4, setAmount4)}
            </>
          ) : null}
          {action === "v3Decrease" ? (
            <>
              {amountField("Liquidity units", liquidity, setLiquidity)}
              {amountField("Token 0 minimum", amount, setAmount)}
              {amountField("Token 1 minimum", amount2, setAmount2)}
            </>
          ) : null}
          {action === "v3Collect" ? (
            <>
              {amountField("Token 0 maximum", amount, setAmount)}
              {amountField("Token 1 maximum", amount2, setAmount2)}
            </>
          ) : null}
        </>
      ) : null}

      {approvalSpecs.length ? (
        <div className="rounded-md border p-3 text-sm">
          <div className="flex justify-between gap-2">
            <span>Prerequisite allowances</span>
            <Badge variant={missingApprovals.length ? "outline" : "secondary"}>
              {allowances.isSuccess ? `${missingApprovals.length} required` : "Checking…"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Missing approval issues are created before the protocol action.
          </p>
        </div>
      ) : null}
      {(staking.isError || cdp.isError || pools.isError || (v3Action && v3.isError)) ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>Required protocol metadata could not be loaded. No issue will be created.</AlertDescription>
        </Alert>
      ) : null}
      <Button className="w-full" disabled={disabled || !action || busy} onClick={() => void propose()}>
        {busy ? "Creating workflow…" : action ? `Create ${ACTION_LABELS[action]} workflow` : "Select an operation"}
      </Button>
    </div>
  );
}

export function DedicatedHistoryTab({ wallet }: { wallet: UserWallet }) {
  const { data: history = [], isLoading } = useDedicatedHistory(wallet.address, 30);
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading history…</p>;
  return (
    <div className="space-y-2">
      {history.map((item) => (
        <div key={`${item.transactionHash}:${item.issueId}`} className="rounded-md border p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{item.functionName}</span>
            <span className="text-xs text-muted-foreground">{item.timestamp ? new Date(item.timestamp).toLocaleString() : ""}</span>
          </div>
          <div className="font-mono text-xs break-all">Target: {item.target}</div>
          <div className="font-mono text-xs break-all">Arguments: {JSON.stringify(item.arguments)}</div>
          <div className="text-xs text-muted-foreground">Issue {item.issueId}</div>
        </div>
      ))}
      {!history.length ? <p className="text-sm text-muted-foreground">No executed issues.</p> : null}
    </div>
  );
}
