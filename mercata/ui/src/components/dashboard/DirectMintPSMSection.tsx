import { useEffect, useState, useCallback } from "react";
import { formatUnits } from "ethers";
import { ArrowDownUp, Clock, X, Flame } from "lucide-react";
import { useUser } from "@/context/UserContext";
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
import { psmService, PsmInfo, BurnRequest } from "@/services/psmService";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";
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
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

const DirectMintPSMSection = () => {
  const { isLoggedIn } = useUser();
  const { toast } = useToast();

  const [psmInfo, setPsmInfo] = useState<PsmInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Mint state
  const [mintToken, setMintToken] = useState<string>("");
  const [mintAmount, setMintAmount] = useState("");

  // Redeem (burn request) state
  const [redeemToken, setRedeemToken] = useState<string>("");
  const [redeemAmount, setRedeemAmount] = useState("");

  // Cancel confirmation state: tracks which request ID has the expanded cancel
  const [cancelExpandedId, setCancelExpandedId] = useState<string | null>(null);

  // Complete confirmation modal
  const [completeDialogRequest, setCompleteDialogRequest] =
    useState<BurnRequest | null>(null);

  const refreshData = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      setLoading(true);
      const info = await psmService.getInfo();
      setPsmInfo(info);
      if (!mintToken && info.eligibleTokens.length > 0) {
        setMintToken(info.eligibleTokens[0].address);
      }
      if (!redeemToken && info.eligibleTokens.length > 0) {
        setRedeemToken(info.eligibleTokens[0].address);
      }
    } catch {
      // Errors handled by axios interceptor
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn, mintToken, redeemToken]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Re-check availability every 30s for pending burn requests
  useEffect(() => {
    if (!psmInfo?.burnRequests.some((r) => !r.isAvailable)) return;
    const interval = setInterval(refreshData, 30000);
    return () => clearInterval(interval);
  }, [psmInfo?.burnRequests, refreshData]);

  const selectedMintToken = psmInfo?.eligibleTokens.find(
    (t) => t.address === mintToken
  );
  const selectedRedeemToken = psmInfo?.eligibleTokens.find(
    (t) => t.address === redeemToken
  );

  const isMintValid = () => {
    if (!mintAmount || !selectedMintToken) return false;
    try {
      const amountWei = safeParseUnits(mintAmount, 18);
      const balanceWei = BigInt(selectedMintToken.userBalance);
      return amountWei > 0n && amountWei <= balanceWei;
    } catch {
      return false;
    }
  };

  const isRedeemValid = () => {
    if (!redeemAmount || !selectedRedeemToken || !psmInfo) return false;
    try {
      const amountWei = safeParseUnits(redeemAmount, 18);
      const psmBal = BigInt(selectedRedeemToken.psmBalance);
      return amountWei > 0n && amountWei <= psmBal;
    } catch {
      return false;
    }
  };

  const handleMint = async () => {
    if (!mintToken || !mintAmount) return;
    try {
      setIsProcessing(true);
      await psmService.mint(mintAmount, mintToken);
      toast({
        title: "Mint Successful",
        description: `Minted ${mintAmount} ${psmInfo?.mintableTokenSymbol} against ${selectedMintToken?.symbol}`,
        variant: "success",
      });
      setMintAmount("");
      await refreshData();
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
      await psmService.requestBurn(redeemAmount, redeemToken);
      toast({
        title: "Redeem Requested",
        description: `Requested to redeem ${redeemAmount} ${psmInfo?.mintableTokenSymbol} for ${selectedRedeemToken?.symbol}`,
        variant: "success",
      });
      setRedeemAmount("");
      await refreshData();
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
      await psmService.completeBurn(request.id);
      toast({
        title: "Redemption Complete",
        description: `Burned ${formatUnits(request.amount, 18)} ${psmInfo?.mintableTokenSymbol} and received ${request.redeemTokenSymbol}`,
        variant: "success",
      });
      await refreshData();
    } catch {
      // Errors handled by axios interceptor
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelBurn = async (id: string) => {
    try {
      setIsProcessing(true);
      setCancelExpandedId(null);
      await psmService.cancelBurn(id);
      toast({
        title: "Request Cancelled",
        description: "Your redeem request has been cancelled.",
        variant: "success",
      });
      await refreshData();
    } catch {
      // Errors handled by axios interceptor
    } finally {
      setIsProcessing(false);
    }
  };

  const burnDelaySec = parseInt(psmInfo?.burnDelay || "0");

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
              <div className="bg-card rounded-lg p-4 border border-border">
                <h3 className="font-medium mb-3">
                  Mint {psmInfo?.mintableTokenSymbol || "USDST"}
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Deposit an eligible token 1:1 to mint{" "}
                  {psmInfo?.mintableTokenSymbol || "USDST"}.
                </p>

                <div className="space-y-2">
                  <Select
                    value={mintToken}
                    onValueChange={setMintToken}
                    disabled={
                      !isLoggedIn ||
                      !psmInfo?.eligibleTokens.length ||
                      isProcessing
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select token" />
                    </SelectTrigger>
                    <SelectContent>
                      {(psmInfo?.eligibleTokens || []).map((t) => (
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
                          const bal = BigInt(selectedMintToken.userBalance);
                          if (bal <= 0n) return;
                          const formatted = formatUnits(bal, 18);
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

              {/* Redeem (Request Burn) Section */}
              <div className="bg-card rounded-lg p-4 border border-border">
                <h3 className="font-medium mb-3">
                  Redeem {psmInfo?.mintableTokenSymbol || "USDST"}
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Request to exchange {psmInfo?.mintableTokenSymbol || "USDST"}{" "}
                  1:1 for an eligible token.
                  {burnDelaySec > 0 && (
                    <span className="block mt-1">
                      Redemptions have a{" "}
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
                      !psmInfo?.eligibleTokens.length ||
                      isProcessing
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Token to receive" />
                    </SelectTrigger>
                    <SelectContent>
                      {(psmInfo?.eligibleTokens || []).map((t) => (
                        <SelectItem key={t.address} value={t.address}>
                          {t.symbol || t.address.slice(0, 8)} — PSM:{" "}
                          {formatBalance(t.psmBalance, undefined, 18, 2)}
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
                          const psmBal = BigInt(selectedRedeemToken.psmBalance);
                          if (psmBal <= 0n) return;
                          const formatted = formatUnits(psmBal, 18);
                          const [w, f = ""] = formatted.split(".");
                          setRedeemAmount(`${w}.${f.slice(0, 18)}`);
                        }}
                      >
                        Max
                      </button>
                      PSM reserves:{" "}
                      {formatBalance(
                        selectedRedeemToken.psmBalance,
                        undefined,
                        18,
                        2
                      )}{" "}
                      {selectedRedeemToken.symbol}
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
                    className="border-strato-blue text-strato-blue hover:bg-strato-blue/10 w-full"
                    disabled={!isLoggedIn || isProcessing || !isRedeemValid()}
                  >
                    {isProcessing ? "Processing..." : "Request Redeem"}
                  </Button>
                </div>
              </div>
            </div>

            {/* Right: Burn Requests */}
            <div className="bg-card rounded-lg p-4 border border-border">
              <h3 className="font-medium mb-3 flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Your Redeem Requests
              </h3>

              {loading && !psmInfo && (
                <p className="text-sm text-muted-foreground animate-pulse">
                  Loading...
                </p>
              )}

              {psmInfo &&
                psmInfo.burnRequests.length === 0 &&
                !loading && (
                  <p className="text-sm text-muted-foreground">
                    No pending redeem requests.
                  </p>
                )}

              <div className="space-y-3">
                {(psmInfo?.burnRequests || []).map((req) => {
                  const amountFormatted = formatUnits(req.amount, 18);
                  const nowSec = Math.floor(Date.now() / 1000);
                  const remaining = parseInt(req.availableAt) - nowSec;
                  const isCancelExpanded = cancelExpandedId === req.id;

                  return (
                    <div
                      key={req.id}
                      className={`rounded-lg border p-3 ${
                        req.isAvailable
                          ? "border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20"
                          : "border-yellow-200 dark:border-yellow-900 bg-yellow-50/50 dark:bg-yellow-950/20"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm">
                            {amountFormatted}{" "}
                            {psmInfo?.mintableTokenSymbol || "USDST"} →{" "}
                            {req.redeemTokenSymbol}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {req.isAvailable ? (
                              <span className="text-green-600 dark:text-green-400 font-medium">
                                Available now
                              </span>
                            ) : (
                              <span className="text-yellow-600 dark:text-yellow-400">
                                Available in {formatTimeRemaining(remaining)}
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
                          {/* Complete button */}
                          {req.isAvailable && (
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

                          {/* Cancel: X → Cancel button */}
                          {isCancelExpanded ? (
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-7 text-xs px-2"
                                disabled={isProcessing}
                                onClick={() => handleCancelBurn(req.id)}
                              >
                                Cancel
                              </Button>
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-foreground p-0.5"
                                onClick={() => setCancelExpandedId(null)}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-destructive p-0.5 transition-colors"
                              onClick={() => setCancelExpandedId(req.id)}
                              disabled={isProcessing}
                              title="Cancel request"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Stats */}
              {psmInfo && (
                <div className="mt-4 pt-4 border-t border-border space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Burn Delay</span>
                    <span className="font-medium">
                      {burnDelaySec === 0
                        ? "None (instant)"
                        : formatTimeRemaining(burnDelaySec)}
                    </span>
                  </div>
                  {psmInfo.eligibleTokens.map((t) => (
                    <div key={t.address} className="flex justify-between">
                      <span className="text-muted-foreground">
                        PSM {t.symbol} Reserves
                      </span>
                      <span className="font-medium">
                        {formatBalance(t.psmBalance, undefined, 18, 2)}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Complete Fee</span>
                    <span className="font-medium">
                      {PSM_BURN_COMPLETE_FEE} USDST
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cancel Fee</span>
                    <span className="font-medium">
                      {PSM_BURN_CANCEL_FEE} USDST
                    </span>
                  </div>
                </div>
              )}
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
                  This will burn{" "}
                  <span className="font-semibold text-foreground">
                    {completeDialogRequest &&
                      formatUnits(completeDialogRequest.amount, 18)}{" "}
                    {psmInfo?.mintableTokenSymbol || "USDST"}
                  </span>{" "}
                  from your wallet and transfer{" "}
                  <span className="font-semibold text-foreground">
                    {completeDialogRequest &&
                      formatUnits(completeDialogRequest.amount, 18)}{" "}
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
    </div>
  );
};

export default DirectMintPSMSection;
