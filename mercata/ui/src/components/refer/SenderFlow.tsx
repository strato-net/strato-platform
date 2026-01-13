import React, { useMemo, useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { splitPrivateKey } from "./keyUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Copy, CopyCheck, Loader2, ChevronDown, Plus, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTokenContext } from "@/context/TokenContext";
import { Token } from "@/interface";
import { sortTokensCompareFn } from "@/lib/tokenPriority";
import { api } from "@/lib/axios";
import { safeParseUnits, roundToDecimals, addCommasToInput, formatBalance, formatUnits } from "@/utils/numberUtils";
import { handleAmountInputChange } from "@/utils/transferValidation";

type Props = {
  senderUsername: string;
  // Where to deep-link into your app
  claimPath?: string; // default "/claim"
};

export function SenderFlow(props: Props) {
  const claimPath = props.claimPath ?? "/claim";
  const { getTransferableTokens } = useTokenContext();
  const { toast } = useToast();

  type TokenAmountEntry = {
    id: string;
    token: Token | undefined;
    amount: string;
    amountError: string;
  };

  const [tokens, setTokens] = useState<Token[]>([]);
  const [entries, setEntries] = useState<TokenAmountEntry[]>([
    { id: "1", token: undefined, amount: "", amountError: "" }
  ]);

  const [ephemeralAddress, setEphemeralAddress] = useState("");
  const [hiB64Url, setHiB64Url] = useState("");
  const [redemptionCode, setRedemptionCode] = useState("");
  const [signupUrl, setSignupUrl] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [popoverStates, setPopoverStates] = useState<Record<string, { open: boolean; showInactive: boolean }>>({});

  // Fetch tokens on mount
  const fetchUserTokens = useCallback(async () => {
    try {
      const fetchedTokens = await getTransferableTokens();
      setTokens(fetchedTokens);
      return fetchedTokens;
    } catch (err) {
      console.error("Failed to fetch tokens:", err);
      return [];
    }
  }, [getTransferableTokens]);

  useEffect(() => {
    fetchUserTokens();
  }, [fetchUserTokens]);

  // Sort and separate tokens with configurable priority order
  const { activeTokens, inactiveTokens } = useMemo(() => {
    const active = tokens.filter(token => token.token?.status === '2');
    const inactive = tokens.filter(token => token.token?.status !== '2');

    active.sort(sortTokensCompareFn);
    inactive.sort(sortTokensCompareFn);

    return { activeTokens: active, inactiveTokens: inactive };
  }, [tokens]);

  // Get max amount for a specific token
  const getMaxAmount = (token: Token | undefined): string => {
    if (!token || !token.balance) return "0";
    return token.balance;
  };

  // Add a new entry
  const addEntry = () => {
    setEntries([...entries, { 
      id: Date.now().toString(), 
      token: undefined, 
      amount: "", 
      amountError: "" 
    }]);
  };

  // Remove an entry
  const removeEntry = (id: string) => {
    if (entries.length > 1) {
      setEntries(entries.filter(e => e.id !== id));
    }
  };

  // Update entry token
  const updateEntryToken = (id: string, token: Token | undefined) => {
    setEntries(entries.map(e => 
      e.id === id 
        ? { ...e, token, amount: "", amountError: "" } 
        : e
    ));
  };

  // Update entry amount
  const updateEntryAmount = (id: string, amountInput: string) => {
    const entry = entries.find(e => e.id === id);
    if (!entry) return;

    const maxAmount = getMaxAmount(entry.token);
    
    handleAmountInputChange(
      amountInput,
      (newAmount: string) => {
        setEntries(prevEntries => 
          prevEntries.map(e => 
            e.id === id ? { ...e, amount: newAmount } : e
          )
        );
      },
      (error: string) => {
        setEntries(prevEntries => 
          prevEntries.map(e => 
            e.id === id ? { ...e, amountError: error } : e
          )
        );
      },
      maxAmount,
      18
    );
  };

  function normalizeAddress(input: string): string {
    const s = input.trim().toLowerCase();
    return s.startsWith("0x") ? s.slice(2) : s;
  }

  async function generateAndSubmitDeposit() {
    try {
      setIsSubmitting(true);
      setStatus("Generating link and submitting deposit...");

      // Validate inputs
      if (entries.length === 0) {
        throw new Error("Please add at least one token and amount.");
      }

      const validEntries = entries.filter(e => e.token && e.amount && !e.amountError);
      if (validEntries.length === 0) {
        throw new Error("Please add at least one valid token and amount.");
      }

      // Step 1: Generate ephemeral wallet and split key
      const w = ethers.Wallet.createRandom();
      const privHex = w.privateKey.startsWith("0x") ? w.privateKey.slice(2) : w.privateKey;
      const eAddr = (await w.getAddress()).toLowerCase().replace(/^0x/, "");

      const { hiB64Url, loBase36 } = splitPrivateKey(privHex);

      // Step 2: Build URL with query parameters
      const url = new URL(window.location.origin + claimPath);
      url.searchParams.set("k", hiB64Url);

      // Step 3: Prepare token addresses and amounts arrays
      const tokenAddresses = validEntries.map(e => {
        const addr = e.token!.address;
        return normalizeAddress(addr);
      });

      const amounts = validEntries.map(e => {
        return ethers.parseUnits(e.amount, 18).toString();
      });

      // Step 4: Submit deposit transaction
      const response = await api.post("/refer/deposit", {
        tokens: tokenAddresses,
        amounts: amounts,
        ephemeralAddress: eAddr,
      });

      // Step 4: Store generated information for message display
      setEphemeralAddress(eAddr);
      setHiB64Url(hiB64Url);
      setRedemptionCode(loBase36);
      setSignupUrl(url.toString());
      setStatus(`Deposit submitted successfully. Transaction hash: ${response.data.data?.hash || "pending"}`);
      
      toast({
        title: "Success",
        description: `Deposit transaction submitted successfully.`,
      });
    } catch (e: any) {
      const errorMsg = e?.response?.data?.error || e?.message || String(e);
      setStatus(`Error: ${errorMsg}`);
      toast({
        title: "Error",
        description: errorMsg,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
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

  const messageText = useMemo(() => {
    if (!signupUrl || !redemptionCode || entries.length === 0) return "";
    
    const validEntries = entries.filter(e => e.token && e.amount && !e.amountError);
    if (validEntries.length === 0) return "";

    const tokenList = validEntries.map(e => {
      const symbol = e.token!.token?._symbol || e.token!.token?._name || "TOKEN";
      return `${e.amount} ${symbol}`;
    }).join(", ");

    return `${props.senderUsername} just sent you ${tokenList} on STRATO!\n` +
           `Sign up here:\n${signupUrl}\n` +
           `Redeem your tokens with code ${redemptionCode}`;
  }, [props.senderUsername, entries, signupUrl, redemptionCode]);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Send Tokens to a Friend</CardTitle>
          <CardDescription>
            Generate a referral link to send tokens to someone who hasn't signed up yet
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Token and Amount Entries */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Tokens and Amounts</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addEntry}
                className="flex items-center gap-1"
              >
                <Plus className="h-4 w-4" />
                Add Token
              </Button>
            </div>

            {entries.map((entry, index) => {
              const maxAmount = getMaxAmount(entry.token);
              const popoverState = popoverStates[entry.id] || { open: false, showInactive: false };

              const setPopoverOpen = (open: boolean) => {
                setPopoverStates(prev => ({
                  ...prev,
                  [entry.id]: {
                    open,
                    showInactive: open ? prev[entry.id]?.showInactive || false : false
                  }
                }));
              };

              const setShowInactive = (show: boolean) => {
                setPopoverStates(prev => ({
                  ...prev,
                  [entry.id]: {
                    ...prev[entry.id],
                    showInactive: show
                  }
                }));
              };

              return (
                <Card key={entry.id} className="p-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-muted-foreground">
                        Token {index + 1}
                      </span>
                      {entries.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            removeEntry(entry.id);
                            // Clean up popover state when entry is removed
                            setPopoverStates(prev => {
                              const newState = { ...prev };
                              delete newState[entry.id];
                              return newState;
                            });
                          }}
                          className="h-6 w-6"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    {/* Token selector */}
                    <div className="space-y-2">
                      <Label>Token</Label>
                      <Popover
                        open={popoverState.open}
                        onOpenChange={(open) => {
                          setPopoverOpen(open);
                        }}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className="w-full flex justify-between items-center"
                          >
                            <span>
                              {entry.token
                                ? entry.token?.token?._symbol || entry.token?.token?._name
                                : "Select Token"}
                            </span>
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-full p-0">
                          <div className="flex flex-col max-h-72 overflow-y-auto">
                            {tokens.length > 0 ? (
                              <>
                                {/* Active tokens */}
                                {activeTokens.map((token) => (
                                  <Button
                                    key={token.address}
                                    variant="ghost"
                                    className="justify-start"
                                    onClick={() => {
                                      updateEntryToken(entry.id, token);
                                      setPopoverOpen(false);
                                    }}
                                  >
                                    {token?.token?._symbol || token?.token?._name}
                                  </Button>
                                ))}
                                
                                {/* Show More button if there are inactive tokens */}
                                {inactiveTokens.length > 0 && !popoverState.showInactive && (
                                  <Button
                                    variant="ghost"
                                    className="justify-center text-muted-foreground hover:text-foreground border-t"
                                    onClick={() => setShowInactive(true)}
                                  >
                                    Show More ({inactiveTokens.length})
                                  </Button>
                                )}
                                
                                {/* Inactive tokens (shown when expanded) */}
                                {popoverState.showInactive && inactiveTokens.map((token) => (
                                  <Button
                                    key={token.address}
                                    variant="ghost"
                                    className="justify-start text-muted-foreground"
                                    onClick={() => {
                                      updateEntryToken(entry.id, token);
                                      setPopoverOpen(false);
                                    }}
                                  >
                                    {token?.token?._symbol || token?.token?._name}
                                  </Button>
                                ))}
                                
                                {/* Show Less button */}
                                {popoverState.showInactive && inactiveTokens.length > 0 && (
                                  <Button
                                    variant="ghost"
                                    className="justify-center text-muted-foreground hover:text-foreground border-t"
                                    onClick={() => setShowInactive(false)}
                                  >
                                    Show Less
                                  </Button>
                                )}
                              </>
                            ) : (
                              <span className="p-2 text-sm text-muted-foreground">
                                No tokens available
                              </span>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>

                    {/* Amount input */}
                    <div className="space-y-2">
                      <Label htmlFor={`amount-${entry.id}`}>
                        Amount
                        {entry.token && (
                          <>{" ("}
                            <button
                              type="button"
                              onClick={() => {
                                try {
                                  const raw = formatUnits(maxAmount);
                                  const clampedAmount = roundToDecimals(raw, 18);
                                  updateEntryAmount(entry.id, clampedAmount);
                                } catch (error) {
                                  console.error("Error setting max amount:", error);
                                }
                              }}
                              className="font-medium text-blue-600 hover:underline focus:outline-none"
                            >
                              Max: {formatBalance(maxAmount, undefined, 18, 0, 4)}
                            </button>
                            {")"}</>
                        )}
                      </Label>
                      <Input
                        id={`amount-${entry.id}`}
                        type="text"
                        inputMode="decimal"
                        value={addCommasToInput(entry.amount)}
                        onChange={(e) => updateEntryAmount(entry.id, e.target.value)}
                        placeholder="0.00"
                        className={entry.amountError ? "border-red-500" : ""}
                      />
                      {entry.amountError && (
                        <p className="text-red-600 text-sm">
                          {entry.amountError}
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          <Button
            onClick={generateAndSubmitDeposit}
            disabled={
              entries.every(e => !e.token || !e.amount || !!e.amountError) || 
              isSubmitting
            }
            className="w-full"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              "Send Tokens"
            )}
          </Button>

          {messageText && signupUrl && redemptionCode && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Message to Send</CardTitle>
                <CardDescription>
                  Copy this message to send via SMS or email
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Textarea
                  readOnly
                  value={messageText}
                  className="min-h-[120px] font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(messageText, "message")}
                  className="w-full"
                >
                  {copiedField === "message" ? (
                    <>
                      <CopyCheck className="h-4 w-4 mr-2" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy Message
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}

          {status && (
            <div className={`p-4 rounded-lg ${
              status.startsWith("Error") 
                ? "bg-destructive/10 text-destructive border border-destructive/20" 
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
