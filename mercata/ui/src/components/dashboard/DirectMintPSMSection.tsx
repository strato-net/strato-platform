import { useEffect, useState, useCallback, useMemo } from "react";
import { formatUnits } from "ethers";
import { ArrowDownUp, Clock, Flame, BarChart3 } from "lucide-react";
import { useUser } from "@/context/UserContext";
import { useTokenContext } from "@/context/TokenContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { psmService, PsmInfo, BurnRequest, EligibleToken } from "@/services/psmService";
import { formatBalance, safeBigInt, safeParseUnits } from "@/utils/numberUtils";
import {
  PSM_MINT_FEE,
  PSM_BURN_REQUEST_FEE,
  PSM_BURN_COMPLETE_FEE,
  PSM_BURN_CANCEL_FEE,
} from "@/lib/constants";

const formatTimeRemaining = (seconds: number): string => {
  if (seconds <= 0) return "Available now";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
};

const BPS_DENOMINATOR = 10000n;

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
  const { isLoggedIn, isAppAuthenticated, isExternalEvmWalletConnected } = useUser();
  const { fetchUsdstBalance } = useTokenContext();
  const { fetchTokens } = useUserTokens();
  const { toast } = useToast();
  const psmRequestOptions = useMemo(
    () => isExternalEvmWalletConnected && !isAppAuthenticated
      ? { walletAuth: true }
      : undefined,
    [isExternalEvmWalletConnected, isAppAuthenticated]
  );

  const [psmInfo, setPsmInfo] = useState<PsmInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Mint state
  const [mintToken, setMintToken] = useState<string>("");
  const [mintAmount, setMintAmount] = useState("");

  // Redeem (burn request) state
  const [redeemToken, setRedeemToken] = useState<string>("");
  const [redeemAmount, setRedeemAmount] = useState("");

  // Cancel confirmation modal
  const [cancelDialogRequest, setCancelDialogRequest] =
    useState<BurnRequest | null>(null);

  // Complete confirmation modal
  const [completeDialogRequest, setCompleteDialogRequest] =
    useState<BurnRequest | null>(null);

  const refreshData = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      setLoading(true);
      const info = await psmService.getInfo(psmRequestOptions);
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
  }, [isLoggedIn, psmRequestOptions]);

  const refreshAfterPsmAction = useCallback(async () => {
    const refreshes: Promise<unknown>[] = [refreshData()];
    if (!isExternalEvmWalletConnected || !isAppAuthenticated) {
      refreshes.push(fetchUsdstBalance(), fetchTokens());
    }
    await Promise.all(refreshes);
  }, [fetchTokens, fetchUsdstBalance, isAppAuthenticated, isExternalEvmWalletConnected, refreshData]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Live countdown ticker — ticks every second while any request is pending
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const hasPending = psmInfo?.burnRequests.some(
    (r) => parseInt(r.availableAt) > nowSec
  );

  useEffect(() => {
    if (!hasPending) return;
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, [hasPending]);

  // Re-fetch data every 30s while there are pending requests
  useEffect(() => {
    if (!hasPending) return;
    const interval = setInterval(refreshData, 30000);
    return () => clearInterval(interval);
  }, [hasPending, refreshData]);

  const mintTokens = psmInfo?.eligibleTokens.filter((t) => t.mintEnabled) || [];
  const redeemTokens = psmInfo?.eligibleTokens.filter((t) => t.burnEnabled) || [];

  const selectedMintToken = mintTokens.find(
    (t) => t.address === mintToken
  );
  const selectedRedeemToken = redeemTokens.find(
    (t) => t.address === redeemToken
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
        (capacity === null || amountWei <= capacity)
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
    try {
      setIsProcessing(true);
      await psmService.mint(mintAmount, mintToken, psmRequestOptions);
      const amountWei = safeParseUnits(mintAmount, 18);
      const netMintAmount = selectedMintToken
        ? formatUnits(applyBpsFee(amountWei, selectedMintToken.mintFeeBps), 18)
        : mintAmount;
      toast({
        title: "Mint Successful",
        description: `Minted ${netMintAmount} ${psmInfo?.mintableTokenSymbol} against ${selectedMintToken?.symbol}`,
        variant: "success",
      });
      setMintAmount("");
      await refreshAfterPsmAction();
    } catch {
      // Errors handled by axios interceptor
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRequestBurn = async () => {
    if (!redeemToken || !redeemAmount) return;
    try {
      setIsProcessing(true);
      await psmService.requestBurn(redeemAmount, redeemToken, psmRequestOptions);
      const amountWei = safeParseUnits(redeemAmount, 18);
      const payoutAmount = selectedRedeemToken
        ? formatUnits(applyBpsFee(amountWei, selectedRedeemToken.burnFeeBps), 18)
        : redeemAmount;
      toast({
        title: "Redeem Requested",
        description: `Requested to redeem ${redeemAmount} ${psmInfo?.mintableTokenSymbol} for ${payoutAmount} ${selectedRedeemToken?.symbol}`,
        variant: "success",
      });
      setRedeemAmount("");
      await refreshAfterPsmAction();
    } catch {
      // Errors handled by axios interceptor
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCompleteBurn = async (request: BurnRequest) => {
    try {
      setIsProcessing(true);
      setCompleteDialogRequest(null);
      await psmService.completeBurn(request.id, psmRequestOptions);
      toast({
        title: "Redemption Complete",
        description: `Redeemed ${formatUnits(request.amount, 18)} ${psmInfo?.mintableTokenSymbol} for ${formatUnits(request.payoutAmount || request.amount, 18)} ${request.redeemTokenSymbol}`,
        variant: "success",
      });
      await refreshAfterPsmAction();
    } catch {
      // Errors handled by axios interceptor
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelBurn = async (id: string) => {
    try {
      setIsProcessing(true);
      setCancelDialogRequest(null);
      await psmService.cancelBurn(id, psmRequestOptions);
      toast({
        title: "Request Cancelled",
        description: "Your redeem request has been cancelled.",
        variant: "success",
      });
      await refreshAfterPsmAction();
    } catch {
      // Errors handled by axios interceptor
    } finally {
      setIsProcessing(false);
    }
  };

  const burnDelaySec = parseInt(selectedRedeemToken?.burnDelay || "0");
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
  const estimatedRedeemPayout = selectedRedeemToken
    ? applyBpsFee(safeParseUnits(redeemAmount, 18), selectedRedeemToken.burnFeeBps)
    : 0n;
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Mint + Redeem forms */}
            <div className="flex flex-col space-y-4">
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
                          2
                        )}{" "}
                        {selectedMintToken.symbol}
                        {mintCapacity !== null && (
                          <>
                            {" · "}
                            System Limit:{" "}
                            {formatBalance(mintCapacity, undefined, 18, 2)}{" "}
                            {selectedMintToken.symbol}
                          </>
                        )}
                      </div>
                    )}

                  {isLoggedIn && selectedMintToken && safeBigInt(selectedMintToken.mintFeeBps) > 0n && (
                      <div className="text-sm text-muted-foreground">
                        PSM Fee: {formatBps(selectedMintToken.mintFeeBps)}
                        {estimatedMintAmount > 0n && (
                          <>
                            {" · "}
                            You receive:{" "}
                            {formatBalance(estimatedMintAmount, undefined, 18, 2, 6)}{" "}
                            {psmInfo?.mintableTokenSymbol || "USDST"}
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

              {/* Redeem (Request Burn) Section */}
              <div className="relative bg-card rounded-lg p-4 border border-border overflow-hidden">
                <div className={noRedeemTokens ? "opacity-40 pointer-events-none" : ""}>
                  <h3 className="font-medium mb-3">
                    Redeem {psmInfo?.mintableTokenSymbol || "USDST"}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Request to exchange {psmInfo?.mintableTokenSymbol || "USDST"}{" "}
                    for an enabled redemption token.
                    {selectedRedeemToken && burnDelaySec > 0 && (
                      <span className="block mt-1">
                        {selectedRedeemToken.symbol} redemptions have a{" "}
                        {formatTimeRemaining(burnDelaySec)} delay
                        before they can be completed.
                      </span>
                    )}
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
                        2
                      )}
                      {" · "}
                      System Limit:{" "}
                      {formatBalance(redeemSystemLimit, undefined, 18, 2)}{" "}
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
                      Transaction Fee: {PSM_BURN_REQUEST_FEE} USDST
                    </div>
                  )}

                  <Button
                    onClick={handleRequestBurn}
                    variant="outline"
                    className="border-strato-blue text-strato-blue hover:bg-strato-blue/10 dark:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-400/10 w-full"
                    disabled={!isLoggedIn || isProcessing || !isRedeemValid()}
                  >
                    {isProcessing ? "Processing..." : "Request Redeem"}
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

            {/* Right: PSM Info + Burn Requests */}
            <div className="bg-card rounded-lg p-4 border border-border">
              <h3 className="font-medium mb-3 flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                PSM Info
              </h3>

              {loading && !psmInfo && (
                <p className="text-sm text-muted-foreground animate-pulse">
                  Loading...
                </p>
              )}

              {psmInfo && (
                <div className="space-y-2 text-sm">
                  {psmInfo.eligibleTokens.map((t) => (
                    <div key={t.address} className="rounded-md border border-border p-2">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {t.symbol} Reserves
                        </span>
                        <span className="font-medium">
                          {formatBalance(t.psmBalance, undefined, 18, 2)}
                        </span>
                      </div>
                      {t.burnEnabled && (
                        <div className="flex justify-between text-xs text-muted-foreground mt-1">
                          <span>Redeem Available</span>
                          <span>
                            {formatBalance(t.availableLiquidity, undefined, 18, 2)}{" "}
                            {t.symbol}
                          </span>
                        </div>
                      )}
                      {t.burnEnabled && (
                        <div className="flex justify-between text-xs text-muted-foreground mt-1">
                          <span>Redeem Delay</span>
                          <span>
                            {parseInt(t.burnDelay) === 0
                              ? "None"
                              : formatTimeRemaining(parseInt(t.burnDelay))}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-border">
                <h3 className="font-medium mb-3 flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Your Redeem Requests
                </h3>

                {psmInfo && psmInfo.burnRequests.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No pending redeem requests.
                  </p>
                )}

                <div className="space-y-3">
                  {(psmInfo?.burnRequests || []).map((req) => {
                    const amountFormatted = formatUnits(req.amount, 18);
                    const payoutFormatted = formatUnits(req.payoutAmount || req.amount, 18);
                    const remaining = parseInt(req.availableAt) - nowSec;
                    const available = remaining <= 0;
                    const redeemTokenInfo = psmInfo?.eligibleTokens.find(
                      (t) => t.address === req.redeemToken
                    );
                    const insufficientReserves =
                      BigInt(req.amount) >
                      BigInt(redeemTokenInfo?.psmBalance || "0");
                    const completionDisabled = Boolean(
                      psmInfo?.burnPaused || !redeemTokenInfo?.burnEnabled
                    );
                    const canComplete =
                      available && !insufficientReserves && !completionDisabled;

                    return (
                      <div
                        key={req.id}
                        className={`rounded-lg border p-3 ${
                          !available
                            ? "border-yellow-200 dark:border-yellow-900 bg-yellow-50/50 dark:bg-yellow-950/20"
                            : insufficientReserves || completionDisabled
                              ? "border-border bg-muted/50 opacity-60"
                              : "border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-sm">
                              {amountFormatted}{" "}
                              {psmInfo?.mintableTokenSymbol || "USDST"} →{" "}
                              {payoutFormatted}{" "}
                              {req.redeemTokenSymbol}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {!available ? (
                                <span className="text-yellow-600 dark:text-yellow-400">
                                  Available in {formatTimeRemaining(remaining)}
                                </span>
                              ) : psmInfo?.burnPaused ? (
                                <span className="text-muted-foreground">
                                  Redemptions are paused
                                </span>
                              ) : !redeemTokenInfo?.burnEnabled ? (
                                <span className="text-muted-foreground">
                                  Redemption token disabled
                                </span>
                              ) : insufficientReserves ? (
                                <span className="text-muted-foreground">
                                  Insufficient PSM reserves
                                </span>
                              ) : (
                                <span className="text-green-600 dark:text-green-400 font-medium">
                                  Available now
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {new Date(
                                parseInt(req.availableAt) * 1000
                              ).toLocaleString()}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {canComplete && (
                              <Button
                                size="sm"
                                className="bg-green-600 hover:bg-green-700 text-white h-7 text-xs px-2"
                                disabled={isProcessing}
                                onClick={() => setCompleteDialogRequest(req)}
                              >
                                <Flame className="h-3 w-3 mr-1" />
                                Complete
                              </Button>
                            )}

                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-7 text-xs px-2"
                              disabled={isProcessing}
                              onClick={() => setCancelDialogRequest(req)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Complete Burn Confirmation Dialog */}
      <AlertDialog
        open={!!completeDialogRequest}
        onOpenChange={(open) => {
          if (!open) setCompleteDialogRequest(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Redemption</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This will burn your escrowed{" "}
                  <span className="font-semibold text-foreground">
                    {completeDialogRequest &&
                      formatUnits(completeDialogRequest.amount, 18)}{" "}
                    {psmInfo?.mintableTokenSymbol || "USDST"}
                  </span>
                  <br />
                  and transfer{" "}
                  <span className="font-semibold text-foreground">
                    {completeDialogRequest &&
                      formatUnits(
                        completeDialogRequest.payoutAmount ||
                          completeDialogRequest.amount,
                        18
                      )}{" "}
                    {completeDialogRequest?.redeemTokenSymbol}
                  </span>{" "}
                  to you.
                </p>
                <p className="text-xs">
                  Transaction fee: {PSM_BURN_COMPLETE_FEE} USDST
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-green-600 hover:bg-green-700"
              onClick={() => {
                if (completeDialogRequest)
                  handleCompleteBurn(completeDialogRequest);
              }}
            >
              Confirm & Complete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Burn Confirmation Dialog */}
      <AlertDialog
        open={!!cancelDialogRequest}
        onOpenChange={(open) => {
          if (!open) setCancelDialogRequest(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Redemption Request</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This will cancel your request to redeem{" "}
                  <span className="font-semibold text-foreground">
                    {cancelDialogRequest &&
                      formatUnits(cancelDialogRequest.amount, 18)}{" "}
                    {psmInfo?.mintableTokenSymbol || "USDST"}
                  </span>{" "}
                  for{" "}
                  <span className="font-semibold text-foreground">
                    {cancelDialogRequest &&
                      formatUnits(
                        cancelDialogRequest.payoutAmount ||
                          cancelDialogRequest.amount,
                        18
                      )}{" "}
                    {cancelDialogRequest?.redeemTokenSymbol}
                  </span>
                  .
                </p>
                <p className="text-xs">
                  Transaction fee: {PSM_BURN_CANCEL_FEE} USDST
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Request</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (cancelDialogRequest)
                  handleCancelBurn(cancelDialogRequest.id);
              }}
            >
              Confirm Cancel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default DirectMintPSMSection;
