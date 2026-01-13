import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { joinPrivateKey } from "./keyUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy, CopyCheck, Loader2, CheckCircle2, XCircle, AlertCircle, LogIn } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatUnits } from "@/utils/numberUtils";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "@/lib/axios";
import { useTokenContext } from "@/context/TokenContext";

type CirrusRow = {
  key: string;   // ephemeral address (no 0x)
  value: {
    sender: string;   // likely no 0x in Cirrus
    tokens: string[];
    amounts: string[];
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

  const [hiPart, setHiPart] = useState("");
  const [ephemeralAddressNo0x, setEphemeralAddressNo0x] = useState("");
  const [tokenAddressNo0x, setTokenAddressNo0x] = useState("");

  const [row, setRow] = useState<CirrusRow | null>(null);
  const [code, setCode] = useState(""); // base36 10 chars
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const { toast } = useToast();
  const { getTransferableTokens } = useTokenContext();
  const [allTokens, setAllTokens] = useState<any[]>([]);
  const navigate = useNavigate();

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

  // Get hiPart from URL on mount
  useEffect(() => {
    const url = new URL(window.location.href);
    setHiPart(url.searchParams.get("k") || "");
  }, []);

  // Reconstruct ephemeral address when code changes (if code is 10 chars)
  useEffect(() => {
    (async () => {
      if (!hiPart || !code || code.trim().length !== 10) {
        setEphemeralAddressNo0x("");
        setRow(null);
        return;
      }

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
    })();
  }, [hiPart, code]);

  // Lookup deposit when ephemeral address is reconstructed
  useEffect(() => {
    (async () => {
      try {
        if (!ephemeralAddressNo0x || !/^[0-9a-f]{40}$/.test(ephemeralAddressNo0x)) {
          setRow(null);
          return;
        }
        
        setIsLoading(true);
        setStatus("Looking up deposit...");
        
        // Query backend API for escrow deposit (tokenAddress is optional now)
        const response = await api.get("/refer/deposit", {
          params: {
            ephemeralAddress: ephemeralAddressNo0x,
          },
        });

        if (response.data.success && response.data.data) {
          const deposit = response.data.data;
          setTokenAddressNo0x(deposit.token || "");
          setRow({
            key: ephemeralAddressNo0x,
            value: {
              sender: deposit.sender,
              tokens: deposit.tokens || [],
              amounts: deposit.amounts || [],
            },
          });
          setStatus("Deposit found successfully.");
        } else {
          setRow(null);
          setStatus("");
        }
      } catch (e: any) {
        // Handle 404 as "not found" rather than error
        if (e?.response?.status === 404) {
          setRow(null);
          setStatus("");
        } else {
          const errorMsg = e?.response?.data?.error || e?.message || String(e);
          setStatus(`Error: ${errorMsg}`);
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
  }, [ephemeralAddressNo0x, toast]);

  async function redeem() {
    try {
      if (!row) throw new Error("No claim loaded");
      if (!hiPart) throw new Error("Missing URL key part (k)");
      if (!code) throw new Error("Enter redemption code");
      if (!props.currentRecipientAddressNo0x || !/^[0-9a-f]{40}$/.test(props.currentRecipientAddressNo0x)) {
        throw new Error("Recipient address not available (finish signup first).");
      }

      setIsRedeeming(true);
      setStatus("Reconstructing ephemeral key...");

      const privHex = joinPrivateKey(hiPart, code.trim().toLowerCase()); // 64 hex chars, no 0x
      const wallet = new ethers.Wallet("0x" + privHex);

      const reconstructedEph = (await wallet.getAddress()).toLowerCase().replace(/^0x/, "");
      if (reconstructedEph !== ephemeralAddressNo0x) {
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

      setStatus('Submitting redemption request to server...');

      // Call backend endpoint instead of redemption server directly
      const response = await api.post("/refer/redeem", {
        r: rHex,
        s: sHex,
        v: v,
        recipient: props.currentRecipientAddressNo0x
      });

      setStatus(`Redemption submitted successfully.`);
      
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
      setStatus(`Error: ${errorMsg}`);
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

  // Format all amounts
  const formattedAmounts = row 
    ? row.value.amounts.map(amt => formatUnits(String(amt), 18))
    : [];

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
          {/* Redemption Code Input */}
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
              placeholder="Enter 10 character code"
              className="font-mono text-center text-lg tracking-wider"
              maxLength={10}
            />
            <p className="text-xs text-muted-foreground">
              Enter the redemption code you received (via SMS or email)
            </p>
          </div>

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
          ) : code.length === 10 && !row ? (
            <Card className="bg-muted/50">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <XCircle className="h-4 w-4" />
                  <span className="text-sm">No deposits found for that redemption code.</span>
                </div>
              </CardContent>
            </Card>
          ) : row ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  { <>
                      <AlertCircle className="h-5 w-5 text-blue-500" />
                      Claim Information
                    </>
                  }
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 p-2 bg-background rounded border text-sm break-all">
                      {row.value.sender}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyToClipboard(row.value.sender, "sender")}
                    >
                      {copiedField === "sender" ? (
                        <CopyCheck className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Tokens</Label>
                  <div className="space-y-2">
                    {row.value.tokens.map((tokenAddress, index) => {
                      const tokenInfo = getTokenInfo(tokenAddress);
                      const amount = formattedAmounts[index] || "0";
                      return (
                        <div key={index} className="p-3 bg-background rounded border">
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{tokenInfo.symbol}</span>
                                <code className="text-xs text-muted-foreground">
                                  {tokenAddress.slice(0, 8)}...{tokenAddress.slice(-6)}
                                </code>
                              </div>
                              <p className="text-sm font-semibold mt-1">{amount}</p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => copyToClipboard(tokenAddress, `token-${index}`)}
                            >
                              {copiedField === `token-${index}` ? (
                                <CopyCheck className="h-4 w-4" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center gap-2 p-2 bg-background rounded border">
                  <span className="text-sm text-muted-foreground">Status:</span>
                  <span className="text-sm font-medium text-blue-600">Pending</span>
                </div>
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

          {/* Recipient Address / Sign Up */}
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

          {/* Redeem Button */}
          {row && (
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

          {/* Status Message */}
          {status && (
            <div className={`p-4 rounded-lg ${
              status.startsWith("Error") 
                ? "bg-destructive/10 text-destructive border border-destructive/20" 
                : status.includes("successfully") || status.includes("loaded")
                ? "bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20"
                : "bg-muted/50 text-foreground"
            }`}>
              <p className="text-sm font-medium">{status}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
