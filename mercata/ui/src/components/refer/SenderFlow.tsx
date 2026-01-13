import React, { useMemo, useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { splitPrivateKey } from "./keyUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Calendar } from "@/components/ui/calendar";
import { Copy, CopyCheck, Loader2, ChevronDown, Plus, X, CalendarIcon, ArrowLeft, AlertTriangle, Share2, Mail, MessageSquare, Smartphone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTokenContext } from "@/context/TokenContext";
import { Token } from "@/interface";
import { sortTokensCompareFn } from "@/lib/tokenPriority";
import { api } from "@/lib/axios";
import { safeParseUnits, roundToDecimals, addCommasToInput, formatBalance, formatUnits } from "@/utils/numberUtils";
import { handleAmountInputChange } from "@/utils/transferValidation";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

type Props = {
  senderUsername: string;
  // Where to deep-link into your app
  claimPath?: string; // default "/claim"
};

export function SenderFlow(props: Props) {
  const claimPath = props.claimPath ?? "/claim";
  const { getTransferableTokens } = useTokenContext();
  const { toast } = useToast();
  const navigate = useNavigate();

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
  
  // Date picker state - default to 7 days from now
  const defaultExpiryDate = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return date;
  }, []);
  const [expiryDate, setExpiryDate] = useState<Date>(defaultExpiryDate);
  const [expiryTime, setExpiryTime] = useState<string>(() => {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  });
  const [datePickerOpen, setDatePickerOpen] = useState(false);

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
      url.searchParams.set("e", eAddr); // Ephemeral address
      
      // Add token symbols and amounts to URL
      const tokenSymbols = validEntries.map(e => {
        const symbol = e.token!.token?._symbol || e.token!.token?._name || "TOKEN";
        return symbol;
      });
      const tokenAmounts = validEntries.map(e => e.amount);
      
      url.searchParams.set("tokens", tokenSymbols.join(","));
      url.searchParams.set("amounts", tokenAmounts.join(","));

      // Step 3: Prepare token addresses and amounts arrays
      const tokenAddresses = validEntries.map(e => {
        const addr = e.token!.address;
        return normalizeAddress(addr);
      });

      const amounts = validEntries.map(e => {
        return ethers.parseUnits(e.amount, 18).toString();
      });

      // Calculate expiry in seconds from the selected date/time
      // Combine the selected date with the selected time
      const expiryDateTime = new Date(expiryDate);
      const [hours, minutes] = expiryTime.split(':').map(Number);
      expiryDateTime.setHours(hours, minutes, 0, 0);
      
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const expiryTimestamp = Math.floor(expiryDateTime.getTime() / 1000);
      const expirySeconds = expiryTimestamp - currentTimestamp;
      
      if (expirySeconds <= 0) {
        throw new Error("Expiry date and time must be in the future");
      }

      // Step 4: Submit deposit transaction
      const response = await api.post("/refer/deposit", {
        tokens: tokenAddresses,
        amounts: amounts,
        ephemeralAddress: eAddr,
        expiry: expirySeconds,
      });

      // Step 4: Store generated information for message display
      setEphemeralAddress(eAddr);
      setHiB64Url(hiB64Url);
      setRedemptionCode(loBase36);
      setSignupUrl(url.toString());
      setStatus(""); // Clear any previous status messages
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

  // Generate QR code data URL
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>("");
  
  useEffect(() => {
    if (signupUrl) {
      // Dynamically import qrcode library
      import('qrcode').then((QRCodeModule) => {
        const QRCode = QRCodeModule.default || QRCodeModule;
        QRCode.toDataURL(signupUrl, {
          width: 300,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        }).then((url: string) => {
          setQrCodeDataUrl(url);
        }).catch((err: any) => {
          console.error("Failed to generate QR code:", err);
        });
      }).catch((err) => {
        console.error("Failed to load QR code library:", err);
      });
    }
  }, [signupUrl]);

  // Share functions
  const handleShareSMS = () => {
    const smsBody = encodeURIComponent(messageText);
    window.location.href = `sms:?body=${smsBody}`;
  };

  const handleShareEmail = () => {
    // Generate HTML email template
    const htmlContent = generateEmailHTML();
    
    // Copy HTML to clipboard for easy pasting
    navigator.clipboard.writeText(htmlContent).then(() => {
      // Create a blob with the HTML content for download as backup
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      
      // Create a temporary download link
      const link = document.createElement('a');
      link.href = url;
      link.download = `strato-referral-${redemptionCode}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up the blob URL after a short delay
      setTimeout(() => URL.revokeObjectURL(url), 100);
      
      // Open email client with subject and instructions
      const validEntries = entries.filter(e => e.token && e.amount && !e.amountError);
      const tokenList = validEntries.map(e => {
        const symbol = e.token!.token?._symbol || e.token!.token?._name || "TOKEN";
        return `${e.amount} ${symbol}`;
      }).join(", ");
      
      const emailSubject = encodeURIComponent(`${props.senderUsername} sent you tokens on STRATO!`);
      const emailBody = encodeURIComponent(
        `The HTML email template has been copied to your clipboard and downloaded as a file.\n\n` +
        `To use the HTML template:\n` +
        `1. Switch to HTML/rich text mode in your email client\n` +
        `2. Paste the HTML content (already in your clipboard)\n\n` +
        `Or attach the downloaded HTML file to your email.\n\n` +
        `Plain text version:\n` +
        `${props.senderUsername} just sent you ${tokenList} on STRATO!\n` +
        `Sign up here: ${signupUrl}\n` +
        `Redeem your tokens with code: ${redemptionCode}`
      );
      
      window.location.href = `mailto:?subject=${emailSubject}&body=${emailBody}`;
    }).catch((err) => {
      console.error("Failed to copy to clipboard:", err);
      // Fallback: just download the file
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `strato-referral-${redemptionCode}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 100);
    });
  };

  const handleShareApp = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${props.senderUsername} sent you tokens on STRATO!`,
          text: messageText,
          url: signupUrl,
        });
      } catch (err) {
        // User cancelled or error occurred
        console.log("Share cancelled or failed:", err);
      }
    } else {
      // Fallback: copy to clipboard
      copyToClipboard(messageText, "message");
      toast({
        title: "Copied",
        description: "Message copied to clipboard (Web Share API not available)",
      });
    }
  };

  // Generate email HTML template
  const generateEmailHTML = useCallback(() => {
    const validEntries = entries.filter(e => e.token && e.amount && !e.amountError);
    const tokenList = validEntries.map(e => {
      const symbol = e.token!.token?._symbol || e.token!.token?._name || "TOKEN";
      return `${e.amount} ${symbol}`;
    }).join(", ");

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You've Received Tokens on STRATO!</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background-color: #ffffff;
      border-radius: 12px;
      padding: 40px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
    }
    h1 {
      color: #1a1a1a;
      font-size: 28px;
      font-weight: bold;
      margin: 0 0 10px 0;
    }
    .subtitle {
      color: #666;
      font-size: 16px;
      margin-bottom: 30px;
    }
    .tokens-section {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
      margin: 30px 0;
    }
    .tokens-section h2 {
      margin: 0 0 10px 0;
      font-size: 18px;
      font-weight: 600;
    }
    .tokens-list {
      font-size: 24px;
      font-weight: bold;
      margin: 10px 0;
    }
    .qr-section {
      text-align: center;
      margin: 30px 0;
      padding: 20px;
      background-color: #f9f9f9;
      border-radius: 8px;
    }
    .qr-code {
      max-width: 300px;
      width: 100%;
      height: auto;
      margin: 20px auto;
      display: block;
      border: 4px solid white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .redemption-code {
      background-color: #1a1a1a;
      color: #ffffff;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
      margin: 30px 0;
    }
    .redemption-code-label {
      font-size: 14px;
      color: #999;
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .redemption-code-value {
      font-size: 36px;
      font-weight: bold;
      letter-spacing: 4px;
      font-family: 'Courier New', monospace;
    }
    .link-section {
      margin: 30px 0;
      padding: 20px;
      background-color: #f0f0f0;
      border-radius: 8px;
    }
    .link-section a {
      color: #667eea;
      text-decoration: none;
      word-break: break-all;
      font-size: 14px;
    }
    .link-section a:hover {
      text-decoration: underline;
    }
    .footer {
      text-align: center;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
      color: #999;
      font-size: 12px;
    }
    .button {
      display: inline-block;
      background-color: #667eea;
      color: white;
      padding: 12px 24px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 600;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 You've Received Tokens!</h1>
      <p class="subtitle">${props.senderUsername} just sent you tokens on STRATO</p>
    </div>

    <div class="tokens-section">
      <h2>Tokens Received</h2>
      <div class="tokens-list">${tokenList}</div>
    </div>

    <div class="qr-section">
      <h2 style="margin-top: 0;">Scan to Claim</h2>
      <p style="color: #666; margin-bottom: 20px;">Scan this QR code with your phone to access your tokens</p>
      ${qrCodeDataUrl ? `<img src="${qrCodeDataUrl}" alt="QR Code" class="qr-code" />` : ''}
    </div>

    <div class="redemption-code">
      <div class="redemption-code-label">Redemption Code</div>
      <div class="redemption-code-value">${redemptionCode}</div>
    </div>

    <div class="link-section">
      <p style="margin-top: 0; font-weight: 600;">Or click this link to claim:</p>
      <a href="${signupUrl}">${signupUrl}</a>
    </div>

    <div style="text-align: center;">
      <a href="${signupUrl}" class="button">Claim Your Tokens</a>
    </div>

    <div class="footer">
      <p>This is an automated message from STRATO</p>
      <p>If you have any questions, please contact the sender</p>
    </div>
  </div>
</body>
</html>
    `.trim();
  }, [props.senderUsername, entries, signupUrl, redemptionCode, qrCodeDataUrl]);


  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back Button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate("/dashboard/referrals")}
        className="flex items-center gap-2 mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        My Referrals
      </Button>

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

          {/* Expiry Date and Time Picker */}
          <div className="space-y-4">
            <Label>Expiry Date & Time</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="expiry-date">Date</Label>
                <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !expiryDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {expiryDate ? format(expiryDate, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={expiryDate}
                      onSelect={(date) => {
                        if (date) {
                          // Preserve the time when changing the date
                          const newDate = new Date(date);
                          const [hours, minutes] = expiryTime.split(':').map(Number);
                          newDate.setHours(hours, minutes, 0, 0);
                          setExpiryDate(newDate);
                          setDatePickerOpen(false);
                        }
                      }}
                      disabled={(date) => {
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        return date < today;
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label htmlFor="expiry-time">Time</Label>
                <Input
                  id="expiry-time"
                  type="time"
                  value={expiryTime}
                  onChange={(e) => {
                    const newTime = e.target.value;
                    setExpiryTime(newTime);
                    // Update expiryDate to reflect the new time
                    const [hours, minutes] = newTime.split(':').map(Number);
                    const updatedDate = new Date(expiryDate);
                    updatedDate.setHours(hours, minutes, 0, 0);
                    setExpiryDate(updatedDate);
                  }}
                  className="w-full"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              The referral will expire on {format(expiryDate, "PPP")} at {expiryTime}. 
              After expiry, you can cancel the referral to recover your tokens.
            </p>
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
                {/* Warning Alert */}
                <div className="flex items-start gap-3 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                      Important: Copy this message before leaving the page
                    </p>
                    <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                      The referral link and redemption code cannot be regenerated. Make sure to save this information before navigating away.
                    </p>
                  </div>
                </div>
                <Textarea
                  readOnly
                  value={messageText}
                  className="min-h-[120px] font-mono text-sm"
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(messageText, "message")}
                    className="flex-1"
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
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="flex items-center gap-2">
                        <Share2 className="h-4 w-4" />
                        Share
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={handleShareSMS}>
                        <MessageSquare className="h-4 w-4 mr-2" />
                        Share via SMS
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleShareEmail}>
                        <Mail className="h-4 w-4 mr-2" />
                        Share via Email
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleShareApp}>
                        <Smartphone className="h-4 w-4 mr-2" />
                        Share via App
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
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
