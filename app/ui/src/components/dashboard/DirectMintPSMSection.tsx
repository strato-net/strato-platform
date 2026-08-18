import { useEffect, useState, useCallback } from "react";
import { formatUnits } from "ethers";
import { ArrowDownUp } from "lucide-react";
import { useUser } from "@/context/UserContext";
import { useTokenContext } from "@/context/TokenContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useSaveUsdstContext } from "@/context/SaveUsdstContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { psmService, PsmInfo, EligibleToken } from "@/services/psmService";
import { formatBalance, safeBigInt, safeParseUnits } from "@/utils/numberUtils";
import { PSM_MINT_FEE, PSM_REDEEM_FEE } from "@/lib/constants";

const BPS_DENOMINATOR = 10000n;
const WAD = 10n ** 18n;

const applyBpsFee = (amount: bigint, feeBps: string): bigint => {
  const fee = (amount * safeBigInt(feeBps)) / BPS_DENOMINATOR;
  return amount > fee ? amount - fee : 0n;
};

const formatBps = (bps: string): string => {
  const value = Number(bps || "0") / 100;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
};

const getMintCapacity = (token: EligibleToken): bigint | null => {
  const maxBalance = safeBigInt(token.maxBalance);
  if (maxBalance === 0n) return null;
  const psmBalance = safeBigInt(token.psmBalance);
  return psmBalance >= maxBalance ? 0n : maxBalance - psmBalance;
};

const minBigInt = (a: bigint, b: bigint): bigint => (a < b ? a : b);

const DirectMintPSMSection = () => {
  const { isLoggedIn } = useUser();
  const { fetchUsdstBalance } = useTokenContext();
  const { fetchTokens } = useUserTokens();
  const { saveUsdstInfo, refreshSaveUsdst } = useSaveUsdstContext();
  const { toast } = useToast();

  const [psmInfo, setPsmInfo] = useState<PsmInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  // Mint state
  const [mintToken, setMintToken] = useState<string>("");
  const [mintAmount, setMintAmount] = useState("");
  const [mintToSavings, setMintToSavings] = useState(false);

  // Redeem state
  const [redeemToken, setRedeemToken] = useState<string>("");
  const [redeemAmount, setRedeemAmount] = useState("");
  const [redeemDialogOpen, setRedeemDialogOpen] = useState(false);

  const refreshData = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      setLoading(true);
      const info = await psmService.getInfo();
      const mintTokens = info.eligibleTokens.filter((t) => t.mintEnabled);
      const redeemTokens = info.eligibleTokens.filter((t) => t.burnEnabled);
      setPsmInfo(info);
      setMintToken((prev) =>
        mintTokens.some((t) => t.address === prev)
          ? prev
          : mintTokens[0]?.address || ""
      );
      setRedeemToken((prev) =>
        redeemTokens.some((t) => t.address === prev)
          ? prev
          : redeemTokens[0]?.address || ""
      );
    } catch {
      // Errors handled by axios interceptor
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const savingsEnabled = Boolean(psmInfo?.savingsEnabled);

  // Never leave the savings destination selected once the vault stops accepting deposits
  useEffect(() => {
    if (!savingsEnabled) setMintToSavings(false);
  }, [savingsEnabled]);

  const mintTokens = psmInfo?.eligibleTokens.filter((t) => t.mintEnabled) || [];
  const redeemTokens = psmInfo?.eligibleTokens.filter((t) => t.burnEnabled) || [];

  const selectedMintToken = mintTokens.find(
    (t) => t.address === mintToken
  );
  const selectedRedeemToken = redeemTokens.find(
    (t) => t.address === redeemToken
  );

  const shareSymbol = saveUsdstInfo?.shareSymbol || "saveUSDST";
  const savingsApy =
    saveUsdstInfo?.apy && Number(saveUsdstInfo.apy) > 0
      ? `${saveUsdstInfo.apy}%`
      : "";
  const savingsExchangeRate = safeBigInt(
    saveUsdstInfo?.projectedExchangeRate || saveUsdstInfo?.exchangeRate || "0"
  );

  const isMintValid = () => {
    if (!mintAmount || !selectedMintToken || psmInfo?.mintPaused) return false;
    try {
      const amountWei = safeParseUnits(mintAmount, 18);
      const balanceWei = safeBigInt(selectedMintToken.userBalance);
      const capacity = getMintCapacity(selectedMintToken);
      const netMintAmount = applyBpsFee(amountWei, selectedMintToken.mintFeeBps);
      return (
        amountWei > 0n &&
        amountWei <= balanceWei &&
        netMintAmount > 0n &&
        (capacity === null || amountWei <= capacity) &&
        (!mintToSavings || savingsEnabled)
      );
    } catch {
      return false;
    }
  };

  const isRedeemValid = () => {
    if (!redeemAmount || !selectedRedeemToken || !psmInfo || psmInfo.burnPaused) return false;
    try {
      const amountWei = safeParseUnits(redeemAmount, 18);
      const availableLiquidity = safeBigInt(selectedRedeemToken.availableLiquidity);
      const userBal = safeBigInt(psmInfo.userMintableBalance);
      const payoutAmount = applyBpsFee(amountWei, selectedRedeemToken.burnFeeBps);
      return (
        amountWei > 0n &&
        amountWei <= availableLiquidity &&
        amountWei <= userBal &&
        payoutAmount > 0n
      );
    } catch {
      return false;
    }
  };

  const handleMint = async () => {
    if (!mintToken || !mintAmount) return;
    const toSavings = mintToSavings && savingsEnabled;
    try {
      setIsProcessing(true);
      await psmService.mint(mintAmount, mintToken, toSavings);
      const amountWei = safeParseUnits(mintAmount, 18);
      const netMintAmount = selectedMintToken
        ? formatUnits(applyBpsFee(amountWei, selectedMintToken.mintFeeBps), 18)
        : mintAmount;
      toast({
        title: toSavings ? "Mint & Save Successful" : "Mint Successful",
        description: toSavings
          ? `Minted ${netMintAmount} ${psmInfo?.mintableTokenSymbol} against ${selectedMintToken?.symbol} and deposited it into Savings`
          : `Minted ${netMintAmount} ${psmInfo?.mintableTokenSymbol} against ${selectedMintToken?.symbol}`,
        variant: "success",
      });
      setMintAmount("");
      await Promise.all([
        refreshData(),
        fetchUsdstBalance(),
        fetchTokens(),
        ...(toSavings ? [refreshSaveUsdst()] : []),
      ]);
    } catch {
      // Errors handled by axios interceptor
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRedeem = async () => {
    if (!redeemToken || !redeemAmount) return;
    try {
      setIsProcessing(true);
      setRedeemDialogOpen(false);
      const amountWei = safeParseUnits(redeemAmount, 18);
      const payoutAmount = selectedRedeemToken
        ? formatUnits(applyBpsFee(amountWei, selectedRedeemToken.burnFeeBps), 18)
        : redeemAmount;
      await psmService.redeem(redeemAmount, redeemToken);
      toast({
        title: "Redemption Complete",
        description: `Redeemed ${redeemAmount} ${psmInfo?.mintableTokenSymbol} for ${payoutAmount} ${selectedRedeemToken?.symbol}`,
        variant: "success",
      });
      setRedeemAmount("");
      await Promise.all([refreshData(), fetchUsdstBalance(), fetchTokens()]);
    } catch {
      // Errors handled by axios interceptor
    } finally {
      setIsProcessing(false);
    }
  };

  const mintCapacity = selectedMintToken ? getMintCapacity(selectedMintToken) : null;
  const mintMaxAmount = selectedMintToken
    ? mintCapacity === null
      ? safeBigInt(selectedMintToken.userBalance)
      : minBigInt(safeBigInt(selectedMintToken.userBalance), mintCapacity)
    : 0n;
  const redeemMaxAmount = selectedRedeemToken
    ? minBigInt(
        safeBigInt(psmInfo?.userMintableBalance || "0"),
        safeBigInt(selectedRedeemToken.availableLiquidity)
      )
    : 0n;
  const redeemSystemLimit = selectedRedeemToken
    ? safeBigInt(selectedRedeemToken.minReserve) === 0n
      ? selectedRedeemToken.psmBalance
      : selectedRedeemToken.availableLiquidity
    : "0";
  const estimatedMintAmount = selectedMintToken
    ? applyBpsFee(safeParseUnits(mintAmount, 18), selectedMintToken.mintFeeBps)
    : 0n;
  const estimatedShares =
    savingsExchangeRate > 0n ? (estimatedMintAmount * WAD) / savingsExchangeRate : 0n;
  const estimatedRedeemPayout = selectedRedeemToken
    ? applyBpsFee(safeParseUnits(redeemAmount, 18), selectedRedeemToken.burnFeeBps)
    : 0n;
  const mintFeeBps = selectedMintToken ? safeBigInt(selectedMintToken.mintFeeBps) : 0n;
  const noMintTokens = Boolean(isLoggedIn && psmInfo && !mintTokens.length);
  const noRedeemTokens = Boolean(isLoggedIn && psmInfo && !redeemTokens.length);

  return (
    <div>
      <Card className="mb-6 border-0 md:border shadow-none md:shadow-sm">
        <CardHeader className="px-2 py-2 md:px-6 md:py-6">
          <CardTitle className="flex items-center gap-2">
            <ArrowDownUp className="h-5 w-5" />
            Direct Mint PSM
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 py-2 md:px-6 md:py-6">
          {isLoggedIn && loading && !psmInfo ? (
            <p className="py-8 text-center text-sm text-muted-foreground animate-pulse">
              Loading PSM...
            </p>
          ) : (
            <div className="flex flex-col space-y-4 max-w-2xl mx-auto">
            {/* Mint Section */}
            <div className="relative bg-card rounded-lg p-4 border border-border overflow-hidden">
              <div className={noMintTokens ? "opacity-40 pointer-events-none" : ""}>
                <h3 className="font-medium mb-3">
                  Mint {psmInfo?.mintableTokenSymbol || "USDST"}
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Deposit an enabled collateral token to mint{" "}
                  {psmInfo?.mintableTokenSymbol || "USDST"}.
                </p>

                <div className="space-y-2">
                  <Select
                    value={mintToken}
                    onValueChange={setMintToken}
                    disabled={
                      !isLoggedIn ||
                      !mintTokens.length ||
                      isProcessing
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select token" />
                    </SelectTrigger>
                    <SelectContent>
                      {mintTokens.map((t) => (
                        <SelectItem key={t.address} value={t.address}>
                          {t.symbol || t.address.slice(0, 8)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    type="number"
                    placeholder="0.00"
                    value={mintAmount}
                    onChange={(e) => setMintAmount(e.target.value)}
                    disabled={!isLoggedIn || isProcessing}
                  />

                  {isLoggedIn && selectedMintToken && (
                    <div className="text-sm text-muted-foreground">
                      <button
                        type="button"
                        className="text-blue-600 hover:underline mr-2"
                        onClick={() => {
                          if (mintMaxAmount <= 0n) return;
                          const formatted = formatUnits(mintMaxAmount, 18);
                          const [w, f = ""] = formatted.split(".");
                          setMintAmount(`${w}.${f.slice(0, 18)}`);
                        }}
                      >
                        Max
                      </button>
                      Available:{" "}
                      {formatBalance(
                        selectedMintToken.userBalance,
                        undefined,
                        18,
                        2,
                        6
                      )}{" "}
                      {selectedMintToken.symbol}
                      {mintCapacity !== null && (
                        <>
                          {" · "}
                          System Limit:{" "}
                          {formatBalance(mintCapacity, undefined, 18, 2, 6)}{" "}
                          {selectedMintToken.symbol}
                        </>
                      )}
                    </div>
                  )}

                  {isLoggedIn && psmInfo?.savingsVault && (
                    <label className="flex items-start gap-2 pt-1 text-sm cursor-pointer">
                      <Checkbox
                        className="mt-0.5"
                        checked={mintToSavings}
                        onCheckedChange={(checked) =>
                          setMintToSavings(checked === true)
                        }
                        disabled={!savingsEnabled || isProcessing}
                      />
                      <span>
                        Deposit straight into Savings
                        {savingsApy && ` (${savingsApy} APY)`}
                        <span className="block text-xs text-muted-foreground">
                          {savingsEnabled
                            ? `You receive ${shareSymbol} instead of ${psmInfo?.mintableTokenSymbol || "USDST"}, already earning.`
                            : "Savings deposits are unavailable right now."}
                        </span>
                      </span>
                    </label>
                  )}

                {isLoggedIn && selectedMintToken && (mintFeeBps > 0n || mintToSavings) && (
                    <div className="text-sm text-muted-foreground">
                      {mintFeeBps > 0n && (
                        <>
                          PSM Fee: {formatBps(selectedMintToken.mintFeeBps)}
                          {estimatedMintAmount > 0n && " · "}
                        </>
                      )}
                      {estimatedMintAmount > 0n && (
                        <>
                          You receive:{" "}
                          {mintToSavings && estimatedShares > 0n ? (
                            <>
                              ≈{" "}
                              {formatBalance(estimatedShares, undefined, 18, 2, 6)}{" "}
                              {shareSymbol}
                            </>
                          ) : (
                            <>
                              {formatBalance(estimatedMintAmount, undefined, 18, 2, 6)}{" "}
                              {psmInfo?.mintableTokenSymbol || "USDST"}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {isLoggedIn && psmInfo?.mintPaused && (
                    <div className="text-sm text-destructive">
                      Minting is currently paused.
                    </div>
                  )}

                  {isLoggedIn && (
                    <div className="text-sm text-muted-foreground">
                      Transaction Fee: {PSM_MINT_FEE} USDST
                    </div>
                  )}

                  <Button
                    onClick={handleMint}
                    className="bg-strato-blue hover:bg-strato-blue/90 w-full"
                    disabled={!isLoggedIn || isProcessing || !isMintValid()}
                  >
                    {isProcessing
                      ? "Processing..."
                      : mintToSavings
                        ? "Mint & Save"
                        : `Mint ${psmInfo?.mintableTokenSymbol || "USDST"}`}
                  </Button>
                </div>
              </div>

              {noMintTokens && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted/60 px-4 text-center">
                  <p className="text-sm font-medium text-foreground">
                    No tokens available for minting at this time
                  </p>
                </div>
              )}
            </div>

            {/* Redeem Section */}
            <div className="relative bg-card rounded-lg p-4 border border-border overflow-hidden">
              <div className={noRedeemTokens ? "opacity-40 pointer-events-none" : ""}>
                <h3 className="font-medium mb-3">
                  Redeem {psmInfo?.mintableTokenSymbol || "USDST"}
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Exchange {psmInfo?.mintableTokenSymbol || "USDST"} for an
                  enabled redemption token in a single transaction.
                </p>

                <div className="space-y-2">
                <Select
                  value={redeemToken}
                  onValueChange={setRedeemToken}
                  disabled={
                    !isLoggedIn ||
                    !redeemTokens.length ||
                    isProcessing
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Token to receive" />
                  </SelectTrigger>
                  <SelectContent>
                    {redeemTokens.map((t) => (
                      <SelectItem key={t.address} value={t.address}>
                        {t.symbol || t.address.slice(0, 8)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Input
                  type="number"
                  placeholder="0.00"
                  value={redeemAmount}
                  onChange={(e) => setRedeemAmount(e.target.value)}
                  disabled={!isLoggedIn || isProcessing}
                />

                {isLoggedIn && selectedRedeemToken && (
                  <div className="text-sm text-muted-foreground">
                    <button
                      type="button"
                      className="text-blue-600 hover:underline mr-2"
                      onClick={() => {
                        if (redeemMaxAmount <= 0n) return;
                        const formatted = formatUnits(redeemMaxAmount, 18);
                        const [w, f = ""] = formatted.split(".");
                        setRedeemAmount(`${w}.${f.slice(0, 18)}`);
                      }}
                    >
                      Max
                    </button>
                    Your {psmInfo?.mintableTokenSymbol || "USDST"}:{" "}
                    {formatBalance(
                      psmInfo?.userMintableBalance || "0",
                      undefined,
                      18,
                      2,
                      6
                    )}
                    {" · "}
                    System Limit:{" "}
                    {formatBalance(redeemSystemLimit, undefined, 18, 2, 6)}{" "}
                    {selectedRedeemToken.symbol}
                  </div>
                )}

                {isLoggedIn && selectedRedeemToken && safeBigInt(selectedRedeemToken.burnFeeBps) > 0n && (
                  <div className="text-sm text-muted-foreground">
                    PSM Fee: {formatBps(selectedRedeemToken.burnFeeBps)}
                    {estimatedRedeemPayout > 0n && (
                      <>
                        {" · "}
                        You receive:{" "}
                        {formatBalance(estimatedRedeemPayout, undefined, 18, 2, 6)}{" "}
                        {selectedRedeemToken.symbol}
                      </>
                    )}
                  </div>
                )}

                {isLoggedIn && psmInfo?.burnPaused && (
                  <div className="text-sm text-destructive">
                    Redemptions are currently paused.
                  </div>
                )}

                {isLoggedIn && (
                  <div className="text-sm text-muted-foreground">
                    Transaction Fee: {PSM_REDEEM_FEE} USDST
                  </div>
                )}

                <Button
                  onClick={() => setRedeemDialogOpen(true)}
                  variant="outline"
                  className="border-strato-blue text-strato-blue hover:bg-strato-blue/10 dark:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-400/10 w-full"
                  disabled={!isLoggedIn || isProcessing || !isRedeemValid()}
                >
                  {isProcessing
                    ? "Processing..."
                    : `Redeem ${psmInfo?.mintableTokenSymbol || "USDST"}`}
                </Button>
                </div>
              </div>

              {noRedeemTokens && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted/60 px-4 text-center">
                  <p className="text-sm font-medium text-foreground">
                    No tokens available for redemption at this time
                  </p>
                </div>
              )}
            </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Redeem Confirmation Dialog */}
      <AlertDialog
        open={redeemDialogOpen}
        onOpenChange={setRedeemDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Redemption</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This will burn{" "}
                  <span className="font-semibold text-foreground">
                    {redeemAmount} {psmInfo?.mintableTokenSymbol || "USDST"}
                  </span>
                  <br />
                  and transfer{" "}
                  <span className="font-semibold text-foreground">
                    {formatUnits(estimatedRedeemPayout, 18)}{" "}
                    {selectedRedeemToken?.symbol}
                  </span>{" "}
                  to you.
                </p>
                <p className="text-xs">
                  Transaction fee: {PSM_REDEEM_FEE} USDST
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-green-600 hover:bg-green-700"
              onClick={handleRedeem}
            >
              Confirm & Redeem
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default DirectMintPSMSection;
