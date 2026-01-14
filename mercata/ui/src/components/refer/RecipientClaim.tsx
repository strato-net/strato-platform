import React, { useEffect, useMemo, useState, useCallback } from "react";
import { ethers } from "ethers";
import { joinPrivateKey } from "./keyUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy, CopyCheck, Loader2, CheckCircle2, XCircle, AlertCircle, LogIn } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatUnits } from "@/utils/numberUtils";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/axios";
import { useTokenContext } from "@/context/TokenContext";

type CirrusRow = {
  key: string;   // ephemeral address (no 0x)
  value: {
    sender: string;   // likely no 0x in Cirrus
    tokens: string[];
    amounts: string[];
    expiry: number;
  };
};

type Props = {
  // Your app should provide this after signup
  currentRecipientAddressNo0x?: string;
  // where to submit redemption request
  redemptionServerUrl: string; // e.g. "https://your-redemption-server/redeem"
  // Cirrus base (if needed)
  cirrusBaseUrl?: string; // default "" -> same origin
  // Whether user is logged in
  isLoggedIn?: boolean;
};

export function RecipientClaim(props: Props) {
  const cirrusBase = props.cirrusBaseUrl ?? "";
  const [searchParams] = useSearchParams();

  const [hiPart, setHiPart] = useState("");
  const [ephemeralAddressNo0x, setEphemeralAddressNo0x] = useState("");
  const [tokenAddressNo0x, setTokenAddressNo0x] = useState("");

  const [row, setRow] = useState<CirrusRow | null>(null);
  const [code, setCode] = useState(""); // base36 10 chars
  const [isLoading, setIsLoading] = useState(false);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [referralStatus, setReferralStatus] = useState<'active' | 'redeemed' | 'cancelled' | null>(null);
  const { toast } = useToast();
  const { getTransferableTokens } = useTokenContext();
  const [allTokens, setAllTokens] = useState<any[]>([]);
  const navigate = useNavigate();

  // URL params for logged-out display
  const urlEphemeralAddress = searchParams.get("e") || "";
  const urlTokenSymbols = searchParams.get("tokens")?.split(",") || [];
  const urlTokenAmounts = searchParams.get("amounts")?.split(",") || [];

  // Fetch all tokens to get symbol/name for display
  useEffect(() => {
    (async () => {
      try {
        const tokens = await getTransferableTokens();
        setAllTokens(tokens);
      } catch (error) {
        console.error("Failed to fetch tokens:", error);
      }
    })();
  }, [getTransferableTokens]);

  // Helper to get token info
  const getTokenInfo = (address: string) => {
    const token = allTokens.find(t => 
      t.address.toLowerCase() === address.toLowerCase() ||
      t.address.toLowerCase() === `0x${address.toLowerCase()}`
    );
    return {
      symbol: token?.token?._symbol || token?.token?._name || "TOKEN",
      name: token?.token?._name || address.slice(0, 8) + "..."
    };
  };

  // Helper to normalize amounts/tokens from object to array (handles Cirrus format after redemption)
  const normalizeToArray = (value: any): any[] => {
    if (Array.isArray(value)) {
      return value;
    }
    if (value && typeof value === 'object') {
      // Convert object like { '0': 'value1', '1': 'value2' } to array
      const keys = Object.keys(value).sort((a, b) => parseInt(a) - parseInt(b));
      return keys.map(key => value[key]);
    }
    return [];
  };

  // Check if referral is redeemed or cancelled (using status from API or fallback to checking row data)
  const isRedeemedOrCancelled = (): boolean => {
    // First check the API status if available
    if (referralStatus === 'redeemed' || referralStatus === 'cancelled') {
      return true;
    }
    // Fallback: check row data structure
    if (!row) return false;
    const amounts = row.value.amounts;
    const tokens = row.value.tokens;
    // If amounts or tokens are objects (not arrays), it's likely redeemed
    if (amounts && typeof amounts === 'object' && !Array.isArray(amounts)) {
      return true;
    }
    if (tokens && typeof tokens === 'object' && !Array.isArray(tokens)) {
      return true;
    }
    // If arrays are empty, it might be redeemed
    if (Array.isArray(amounts) && amounts.length === 0) {
      return true;
    }
    if (Array.isArray(tokens) && tokens.length === 0) {
      return true;
    }
    return false;
  };

  // Get hiPart from URL on mount
  useEffect(() => {
    const url = new URL(window.location.href);
    setHiPart(url.searchParams.get("k") || "");
  }, []);

  // Determine ephemeral address: from code if entered, otherwise from URL if logged in
  useEffect(() => {
    (async () => {
      // If code is entered, reconstruct ephemeral address from code + k
      if (hiPart && code && code.trim().length === 10) {
        try {
          const privHex = joinPrivateKey(hiPart, code.trim().toLowerCase()); // 64 hex chars, no 0x
          const wallet = new ethers.Wallet("0x" + privHex);
          const reconstructed = await wallet.getAddress();
          const reconstructedNo0x = reconstructed.toLowerCase().replace(/^0x/, "");
          setEphemeralAddressNo0x(reconstructedNo0x);
        } catch (error) {
          console.error("Error reconstructing ephemeral address:", error);
          setEphemeralAddressNo0x("");
          setRow(null);
        }
      } else if (urlEphemeralAddress && props.isLoggedIn && !code) {
        // If no code but logged in and URL has ephemeral address, use it
        setEphemeralAddressNo0x(urlEphemeralAddress);
      } else if (!code) {
        // No code and no URL address (or not logged in), clear it
        setEphemeralAddressNo0x("");
        setRow(null);
      }
    })();
  }, [hiPart, code, urlEphemeralAddress, props.isLoggedIn]);

  // Check referral status (redeemed/cancelled) when user is logged in and we have ephemeral address
  const checkReferralStatus = useCallback(async (ephemeralAddress: string) => {
    try {
      // Only check status if user is logged in
      if (!props.isLoggedIn) {
        return;
      }
      
      if (!ephemeralAddress || !/^[0-9a-f]{40}$/.test(ephemeralAddress)) {
        setReferralStatus(null);
        return;
      }
      
      // Query backend API for referral status
      const response = await api.get("/refer/status", {
        params: {
          ephemeralAddress: ephemeralAddress,
        },
      });

      if (response.data.success && response.data.data) {
        const statusData = response.data.data;
        setReferralStatus(statusData.status);
      } else {
        setReferralStatus('active');
      }
    } catch (e: any) {
      // If status check fails, assume active
      console.error("Failed to check referral status:", e);
      setReferralStatus('active');
    }
  }, [props.isLoggedIn]);

  // Check status when page loads (using URL ephemeral address)
  useEffect(() => {
    if (urlEphemeralAddress && props.isLoggedIn) {
      checkReferralStatus(urlEphemeralAddress);
    }
  }, [urlEphemeralAddress, props.isLoggedIn, checkReferralStatus]);

  // Re-check status when redemption code is entered and ephemeral address is reconstructed
  useEffect(() => {
    if (code.length === 10 && ephemeralAddressNo0x && props.isLoggedIn) {
      checkReferralStatus(ephemeralAddressNo0x);
    }
  }, [code, ephemeralAddressNo0x, props.isLoggedIn, checkReferralStatus]);

  // Lookup deposit when ephemeral address is available (from URL or reconstructed from code)
  useEffect(() => {
    (async () => {
      try {
        // Only fetch if user is logged in
        if (!props.isLoggedIn) {
          return;
        }

        if (!ephemeralAddressNo0x || !/^[0-9a-f]{40}$/.test(ephemeralAddressNo0x)) {
          setRow(null);
          return;
        }
        
        setIsLoading(true);
        
        // Query backend API for escrow deposit
        const response = await api.get("/refer/deposit", {
          params: {
            ephemeralAddress: ephemeralAddressNo0x,
          },
        });

        if (response.data.success && response.data.data) {
          const deposit = response.data.data;
          // Normalize tokens and amounts to arrays (handle object format from Cirrus)
          const normalizedTokens = normalizeToArray(deposit.tokens);
          const normalizedAmounts = normalizeToArray(deposit.amounts);
          
          setTokenAddressNo0x(normalizedTokens[0] || "");
          setRow({
            key: ephemeralAddressNo0x,
            value: {
              sender: deposit.sender,
              tokens: normalizedTokens,
              amounts: normalizedAmounts,
              expiry: deposit.expiry || 0,
            },
          });
        } else {
          setRow(null);
        }
      } catch (e: any) {
        // Handle 404 as "not found" rather than error
        if (e?.response?.status === 404) {
          setRow(null);
        } else {
          const errorMsg = e?.response?.data?.error || e?.message || String(e);
          toast({
            title: "Error",
            description: errorMsg,
            variant: "destructive",
          });
          setRow(null);
        }
      } finally {
        setIsLoading(false);
      }
    })();
  }, [ephemeralAddressNo0x, props.isLoggedIn, toast]);

  async function redeem() {
    try {
      if (!row) throw new Error("No claim loaded");
      if (!hiPart) throw new Error("Missing URL key part (k)");
      if (!code) throw new Error("Enter redemption code");
      if (!props.currentRecipientAddressNo0x || !/^[0-9a-f]{40}$/.test(props.currentRecipientAddressNo0x)) {
        throw new Error("Recipient address not available (finish signup first).");
      }

      setIsRedeeming(true);

      const privHex = joinPrivateKey(hiPart, code.trim().toLowerCase()); // 64 hex chars, no 0x
      const wallet = new ethers.Wallet("0x" + privHex);

      const reconstructedEph = (await wallet.getAddress()).toLowerCase().replace(/^0x/, "");
      if (reconstructedEph !== ephemeralAddressNo0x || reconstructedEph !== row.key) {
        throw new Error("Code does not match this link (ephemeral address mismatch).");
      }

      // Build the message that the server/contract will verify.
      // IMPORTANT: must match contract.redemptionHash(...) logic.
      // Because the contract uses:
      // keccak256(abi.encodePacked("STRATO_ESCROW_REDEEM_V1", contract, chainid, eph, token, amount, sender, recipient))
      //
      // We cannot reproduce chainid client-side safely without a trusted source.
      // The clean pattern is:
      // - Client sends unsigned fields + signature over a *server-provided digest*, OR
      // - Server computes the digest using the chainid and contract address (recommended).
      //
      // Here: we will sign a "canonical JSON payload hash" on the client,
      // and the server will recompute the contract digest and verify by ecrecover off-chain.
      //
      // So client signs: keccak256(utf8("STRATO_REDEEM_REQ_V1") || JSON.stringify(fields))
      // and server maps to on-chain redeem() args.
      
      // Convert address from hex string (40 chars = 20 bytes) to byte array
      const prefixBytes = ethers.getBytes("0xed97");
      const ethersBytes = ethers.toUtf8Bytes("STRATO_ESCROW_REDEEM_V1");
      const addressBytes = ethers.getBytes("0x94" + props.currentRecipientAddressNo0x);
      
      // Combine canonical bytes with address bytes
      const combinedBytes = new Uint8Array([...prefixBytes, ...ethersBytes, ...addressBytes]);
      
      const digest32 = ethers.keccak256(combinedBytes);

      // Sign digest32 as personal_sign over 32 bytes
      const h = ethers.getBytes(digest32);
      const sk = wallet.signingKey;
      const { r, s, v } = sk.sign(h);

      // Extract r, s, v as hex strings for debugging and backend
      const rHex = ethers.hexlify(r);
      const sHex = ethers.hexlify(s);

      // Format debugging info
      const debugInfo = {
        digest32: digest32,
        signature: {
          r: rHex,
          s: sHex,
          v: v
        }
      };

      // Call backend endpoint instead of redemption server directly
      const response = await api.post("/refer/redeem", {
        r: rHex,
        s: sHex,
        v: v,
        recipient: props.currentRecipientAddressNo0x
      });

      toast({
        title: "Success",
        description: "Redemption request submitted successfully.",
      });

      // Clear redemption URL from localStorage
      localStorage.removeItem("claimReturnUrl");
      
      // Redirect to dashboard after a short delay
      setTimeout(() => {
        navigate("/dashboard");
      }, 1500);
    } catch (e: any) {
      const errorMsg = e?.message ?? String(e);
      toast({
        title: "Error",
        description: errorMsg,
        variant: "destructive",
      });
    } finally {
      setIsRedeeming(false);
    }
  }

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
    toast({
      title: "Copied",
      description: "Copied to clipboard",
    });
  };

  const location = useLocation();
  
  const handleSignUp = () => {
    // Store current URL with all query params for redirect after login
    const returnUrl = location.pathname + location.search;
    localStorage.setItem("claimReturnUrl", returnUrl);
    
    // Redirect to login
    const theme = localStorage.getItem('theme') || 'light';
    window.location.href = `/login?theme=${theme}`;
  };

  // Format all amounts (normalize to array first)
  const formattedAmounts = row 
    ? normalizeToArray(row.value.amounts).map(amt => formatUnits(String(amt), 18))
    : [];

  // Create display data from URL params or fetched row
  const displayData = useMemo(() => {
    // If we have row data (from backend), use that
    if (row) {
      const normalizedTokens = normalizeToArray(row.value.tokens);
      return {
        tokens: normalizedTokens.map((tokenAddress, index) => ({
          address: tokenAddress,
          symbol: getTokenInfo(tokenAddress).symbol,
          amount: formattedAmounts[index] || "0",
        })),
        sender: row.value.sender,
        expiry: row.value.expiry || 0,
      };
    }
    
    // Otherwise, if we have URL params, use those (for logged-out users)
    if (urlEphemeralAddress && urlTokenSymbols.length > 0 && urlTokenAmounts.length > 0) {
      return {
        tokens: urlTokenSymbols.map((symbol, index) => ({
          address: "", // No address from URL
          symbol: symbol,
          amount: urlTokenAmounts[index] || "0",
        })),
        sender: "",
        expiry: 0,
      };
    }
    
    return null;
  }, [row, formattedAmounts, urlEphemeralAddress, urlTokenSymbols, urlTokenAmounts, getTokenInfo]);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Claim Your Tokens</CardTitle>
          <CardDescription>
            Enter your redemption code to claim tokens sent to you
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Check if redeemed/cancelled early to show simple message */}
          {props.isLoggedIn && isRedeemedOrCancelled() ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-destructive" />
                  Referral No Longer Available
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <p className="text-sm font-medium text-destructive">
                    {referralStatus === 'redeemed' 
                      ? "This referral has already been redeemed. The tokens have been claimed."
                      : referralStatus === 'cancelled'
                      ? "This referral has been cancelled. The tokens have been returned to the sender."
                      : "This referral is no longer available."}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Redemption Code Input */}
              {props.isLoggedIn && (
                <div className="space-y-2">
                  <Label htmlFor="redemptionCode">Redemption Code</Label>
                  <Input
                    id="redemptionCode"
                    value={code}
                    onChange={(e) => {
                      const value = e.target.value.trim();
                      // Only allow alphanumeric and limit to 10 characters
                      if (value === "" || /^[a-z0-9]{0,10}$/i.test(value)) {
                        setCode(value);
                      }
                    }}
                    placeholder="Enter redemption code"
                    className="font-mono text-center text-lg tracking-wider"
                    maxLength={10}
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter the redemption code you received (via SMS or email)
                  </p>
                </div>
              )}

              {/* Deposit Information */}
              {isLoading ? (
                <Card className="bg-muted/50">
                  <CardContent className="p-6">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Looking up deposit...</span>
                    </div>
                  </CardContent>
                </Card>
              ) : code.length === 10 && !row && !displayData ? (
                <Card className="bg-muted/50">
                  <CardContent className="p-6">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <XCircle className="h-4 w-4" />
                      <span className="text-sm">No deposits found for that redemption code.</span>
                    </div>
                  </CardContent>
                </Card>
              ) : displayData ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-blue-500" />
                  Claim Information
                  {!row && displayData && (
                    <span className="text-xs text-muted-foreground font-normal ml-2">
                      (Preview - Sign up to claim)
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {displayData.sender && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">From</Label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 p-2 bg-background rounded border text-sm break-all">
                        {displayData.sender}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => copyToClipboard(displayData.sender, "sender")}
                      >
                        {copiedField === "sender" ? (
                          <CopyCheck className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {displayData.expiry !== undefined && displayData.expiry !== 0 && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Expiry</Label>
                    <p className="p-2 bg-background rounded border text-sm font-medium">
                      {displayData.expiry === 0 ? "No Expiry" : new Date(displayData.expiry * 1000).toLocaleString()}
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Tokens</Label>
                  <div className="space-y-2">
                    {displayData.tokens.map((token, index) => (
                      <div key={index} className="p-3 bg-background rounded border">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">Token: {token.symbol}</span>
                              {token.address && (
                                <code className="text-xs text-muted-foreground">
                                  {token.address.slice(0, 8)}...{token.address.slice(-6)}
                                </code>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">Amount: {token.amount}</span>
                            </div>
                          </div>
                          {token.address && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => copyToClipboard(token.address, `token-${index}`)}
                            >
                              {copiedField === `token-${index}` ? (
                                <CopyCheck className="h-4 w-4" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {row && (
                  <div className="flex items-center gap-2 p-2 bg-background rounded border">
                    <span className="text-sm text-muted-foreground">Status:</span>
                    {displayData.expiry !== 0 && displayData.expiry < Date.now() / 1000 ? (
                      <span className="text-sm font-medium text-destructive flex items-center gap-1">
                        <XCircle className="h-4 w-4" />
                        Expired
                      </span>
                    ) : (
                      <span className="text-sm font-medium text-blue-600">Pending</span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-muted/50">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <XCircle className="h-4 w-4" />
                  <span className="text-sm">No claim found for this link.</span>
                </div>
              </CardContent>
            </Card>
          )}

              {/* Redeem Button */}
              {row && !isRedeemedOrCancelled() && (
                <Button
                  onClick={redeem}
                  disabled={!row || !code || code.length !== 10 || isRedeeming || !props.currentRecipientAddressNo0x}
                  className="w-full"
                  size="lg"
                >
                  {isRedeeming ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    "Redeem Tokens"
                  )}
                </Button>
              )}

              {/* Recipient Address / Sign Up */}
              {!isRedeemedOrCancelled() && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Your Address</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {props.currentRecipientAddressNo0x ? (
                      <div className="flex items-center gap-2">
                        <code className="flex-1 p-2 bg-muted rounded border text-sm break-all">
                          {props.currentRecipientAddressNo0x}
                        </code>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => copyToClipboard(props.currentRecipientAddressNo0x!, "recipient")}
                        >
                          {copiedField === "recipient" ? (
                            <CopyCheck className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                          You need to sign up for STRATO to claim your tokens.
                        </p>
                        <Button
                          onClick={handleSignUp}
                          className="w-full"
                          size="lg"
                        >
                          <LogIn className="h-4 w-4 mr-2" />
                          Sign Up for STRATO
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
