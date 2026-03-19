import { useEffect, useState, useCallback } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, XCircle, Copy, CopyCheck, Gift, Users, Clock, CheckCircle } from "lucide-react";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/axios";
import { useNavigate } from "react-router-dom";
import { formatUnits } from "@/utils/numberUtils";
import { useTokenContext } from "@/context/TokenContext";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";

// Guest View Component - Static informational page for non-logged-in users
const GuestReferralsView = () => {
  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="My Referrals" />
        <main className="p-4 md:p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            <GuestSignInBanner message="Sign in to create referral deposits and gift tokens to friends" />
            {/* Hero Section */}
            <Card className="border-2 border-dashed bg-gradient-to-br from-pink-50/50 to-purple-50/50 dark:from-pink-950/20 dark:to-purple-950/20">
              <CardHeader className="text-center pb-2">
                <div className="mx-auto w-20 h-20 bg-gradient-to-br from-pink-500 to-purple-600 rounded-full flex items-center justify-center mb-4 shadow-lg">
                  <Gift className="w-10 h-10 text-white" />
                </div>
                <CardTitle className="text-2xl">Refer Friends & Gift Tokens</CardTitle>
                <CardDescription className="text-base max-w-lg mx-auto">
                  Create referral deposits to onboard new users to STRATO. 
                  Gift tokens to friends and help grow the community.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center space-y-6">
                {/* Key Features */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
                  <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-card border">
                    <Gift className="w-8 h-8 text-pink-500" />
                    <span className="font-medium">Token Gifting</span>
                    <span className="text-sm text-muted-foreground">Gift tokens to new users</span>
                  </div>
                  <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-card border">
                    <Users className="w-8 h-8 text-purple-500" />
                    <span className="font-medium">Grow Community</span>
                    <span className="text-sm text-muted-foreground">Help onboard new members</span>
                  </div>
                  <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-card border">
                    <Clock className="w-8 h-8 text-blue-500" />
                    <span className="font-medium">Expiry Control</span>
                    <span className="text-sm text-muted-foreground">Set expiration dates</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Key Features */}
            <Card>
              <CardHeader>
                <CardTitle>Referral Features</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
                      <div>
                        <h4 className="font-medium">Multiple Tokens</h4>
                        <p className="text-sm text-muted-foreground">
                          Bundle multiple token types (USDST, etc.) in a single referral deposit
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
                      <div>
                        <h4 className="font-medium">Quantity Control</h4>
                        <p className="text-sm text-muted-foreground">
                          Set how many redemptions a single deposit supports
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
                      <div>
                        <h4 className="font-medium">Easy Sharing</h4>
                        <p className="text-sm text-muted-foreground">
                          Share via SMS, email, or any messaging app with one click
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
                      <div>
                        <h4 className="font-medium">Expiration Control</h4>
                        <p className="text-sm text-muted-foreground">
                          Set date and time for when referrals expire (default: 7 days)
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
                      <div>
                        <h4 className="font-medium">Secure Redemption</h4>
                        <p className="text-sm text-muted-foreground">
                          Private key split ensures only the recipient with the code can claim
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
                      <div>
                        <h4 className="font-medium">Token Recovery</h4>
                        <p className="text-sm text-muted-foreground">
                          Cancel expired or unclaimed referrals to recover your tokens
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

          </div>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

interface UserReferral {
  ephemeralAddress: string;
  sender: string;
  tokens: string[];
  amounts: string[];
  expiry: number;
  quantity: number;
}

const ReferralsManagement = () => {
  const { userAddress, isLoggedIn } = useUser();
  
  // Show guest view for non-logged-in users
  if (!isLoggedIn) {
    return <GuestReferralsView />;
  }
  const { toast } = useToast();
  const navigate = useNavigate();
  const { getTransferableTokens } = useTokenContext();
  const [referrals, setReferrals] = useState<UserReferral[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [allTokens, setAllTokens] = useState<any[]>([]);

  useEffect(() => {
    document.title = "My Referrals | STRATO";
  }, []);

  // Fetch all tokens for display
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
  const getTokenInfo = useCallback((address: string) => {
    const token = allTokens.find(t =>
      t.address.toLowerCase() === address.toLowerCase() ||
      t.address.toLowerCase() === `0x${address.toLowerCase()}`
    );
    return {
      symbol: token?.token?._symbol || token?.token?._name || "UNKNOWN",
      name: token?.token?._name || "Unknown Token",
    };
  }, [allTokens]);

  // Fetch referrals
  const fetchReferrals = useCallback(async () => {
    if (!userAddress) return;

    try {
      setLoading(true);
      const response = await api.get("/refer/referrals");
      if (response.data.success) {
        setReferrals(response.data.data || []);
      }
    } catch (error: any) {
      const errorMsg = error?.response?.data?.error || error?.message || "Failed to fetch referrals";
      toast({
        title: "Error",
        description: errorMsg,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [userAddress, toast]);

  useEffect(() => {
    fetchReferrals();
  }, [fetchReferrals]);

  // Cancel a referral
  const handleCancel = async (ephemeralAddress: string) => {
    try {
      setCancellingId(ephemeralAddress);
      const response = await api.post("/refer/cancel", {
        ephemeralAddress,
      });

      if (response.data.success) {
        toast({
          title: "Success",
          description: "Referral cancelled successfully. Your tokens have been returned.",
        });
        // Refresh the list
        await fetchReferrals();
      }
    } catch (error: any) {
      const errorMsg = error?.response?.data?.error || error?.message || "Failed to cancel referral";
      toast({
        title: "Error",
        description: errorMsg,
        variant: "destructive",
      });
    } finally {
      setCancellingId(null);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
    toast({
      title: "Copied",
      description: "Copied to clipboard",
    });
  };

  const isExpired = (expiry: number) => {
    if (expiry === 0) return false; // No expiry
    return Date.now() / 1000 >= expiry;
  };

  const canCancel = (expiry: number) => {
    return expiry !== 0 && isExpired(expiry);
  };

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="My Referrals" />
        <main className="p-4 md:p-6">
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold">My Referrals</h1>
                <p className="text-muted-foreground mt-1">
                  Manage your active referral deposits
                </p>
              </div>
              <Button
                onClick={() => navigate("/dashboard/refer")}
                className="flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Create New Referral
              </Button>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Active Referrals</CardTitle>
                <CardDescription>
                  View and manage your referral deposits. Expired referrals can be cancelled to recover your tokens.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : referrals.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-lg mb-2">No active referrals</p>
                    <p className="text-sm">Create your first referral to get started</p>
                    <Button
                      onClick={() => navigate("/dashboard/refer")}
                      className="mt-4"
                      variant="outline"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Create Referral
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Ephemeral Address</TableHead>
                          <TableHead>Tokens</TableHead>
                          <TableHead>Quantity</TableHead>
                          <TableHead>Expiry</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {referrals.map((referral) => {
                          const expired = isExpired(referral.expiry);
                          const canCancelThis = canCancel(referral.expiry);
                          const fieldId = `ephemeral-${referral.ephemeralAddress}`;

                          return (
                            <TableRow key={referral.ephemeralAddress}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <code className="text-xs font-mono">
                                    {referral.ephemeralAddress.slice(0, 8)}...{referral.ephemeralAddress.slice(-6)}
                                  </code>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                    onClick={() => copyToClipboard(referral.ephemeralAddress, fieldId)}
                                  >
                                    {copiedField === fieldId ? (
                                      <CopyCheck className="h-3 w-3" />
                                    ) : (
                                      <Copy className="h-3 w-3" />
                                    )}
                                  </Button>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="space-y-1">
                                  {referral.tokens.map((tokenAddress, index) => {
                                    const tokenInfo = getTokenInfo(tokenAddress);
                                    const amount = formatUnits(referral.amounts[index] || "0", 18);
                                    return (
                                      <div key={index} className="text-sm">
                                        <span className="font-medium">{amount}</span>{" "}
                                        <span className="text-muted-foreground">{tokenInfo.symbol}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </TableCell>
                              <TableCell>
                                <span className="text-sm font-medium">{referral.quantity || 1}</span>
                              </TableCell>
                              <TableCell>
                                {referral.expiry === 0 ? (
                                  <span className="text-sm text-muted-foreground">No Expiry</span>
                                ) : (
                                  <div className="text-sm">
                                    <div>{new Date(referral.expiry * 1000).toLocaleDateString()}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {new Date(referral.expiry * 1000).toLocaleTimeString()}
                                    </div>
                                  </div>
                                )}
                              </TableCell>
                              <TableCell>
                                {expired ? (
                                  <Badge variant="destructive">Expired</Badge>
                                ) : (
                                  <Badge variant="default" className="bg-blue-500">Active</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                {canCancelThis ? (
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => handleCancel(referral.ephemeralAddress)}
                                    disabled={cancellingId === referral.ephemeralAddress}
                                  >
                                    {cancellingId === referral.ephemeralAddress ? (
                                      <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Cancelling...
                                      </>
                                    ) : (
                                      <>
                                        <XCircle className="h-4 w-4 mr-2" />
                                        Cancel
                                      </>
                                    )}
                                  </Button>
                                ) : (
                                  <span className="text-sm text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Referral History */}
            <Card>
              <CardHeader className="px-4 md:px-6 pb-2 md:pb-4">
                <CardTitle className="text-base md:text-xl">Referral History</CardTitle>
                <CardDescription className="text-xs md:text-sm">
                  View your completed and cancelled referrals
                </CardDescription>
              </CardHeader>
              <CardContent className="px-2 md:px-6">
                <ReferralHistoryTable 
                  userAddress={userAddress}
                  getTokenInfo={getTokenInfo}
                />
              </CardContent>
            </Card>
          </div>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

// Referral History Table Component
interface ReferralHistoryTableProps {
  userAddress?: string;
  getTokenInfo: (address: string) => { symbol: string; name: string };
}

const ReferralHistoryTable = ({ userAddress, getTokenInfo }: ReferralHistoryTableProps) => {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!userAddress) {
      setLoading(false);
      return;
    }

    const fetchHistory = async () => {
      try {
        setLoading(true);
        const response = await api.get("/refer/history");
        if (response.data.success) {
          // Convert date strings back to Date objects
          const historyData = (response.data.data || []).map((entry: any) => ({
            ...entry,
            blockTimestamp: entry.blockTimestamp 
              ? (entry.blockTimestamp instanceof Date 
                  ? entry.blockTimestamp 
                  : new Date(entry.blockTimestamp))
              : new Date(),
          }));
          setHistory(historyData);
        }
      } catch (error: any) {
        console.error("Failed to fetch referral history:", error);
        toast({
          title: "Error",
          description: error?.response?.data?.error || error?.message || "Failed to fetch referral history",
          variant: "destructive",
        });
        setHistory([]);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [userAddress]);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
    toast({
      title: "Copied",
      description: "Copied to clipboard",
    });
  };

  const formatTimestamp = (timestamp: Date) => {
    const date = timestamp.toLocaleDateString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const time = timestamp.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    return { date, time };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-sm">No referral history found</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs md:text-sm whitespace-nowrap">Time</TableHead>
            <TableHead className="text-xs md:text-sm">Event</TableHead>
            <TableHead className="text-xs md:text-sm whitespace-nowrap">Ephemeral Address</TableHead>
            <TableHead className="text-xs md:text-sm">Tokens</TableHead>
            <TableHead className="text-xs md:text-sm">Qty</TableHead>
            <TableHead className="text-xs md:text-sm">Recipient</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.map((entry) => {
            const fieldId = `ephemeral-${entry.id}`;
            const timestamp = formatTimestamp(
              entry.blockTimestamp instanceof Date 
                ? entry.blockTimestamp 
                : new Date(entry.blockTimestamp)
            );
            return (
              <TableRow key={entry.id}>
                <TableCell className="text-xs md:text-sm">
                  <div className="whitespace-nowrap">{timestamp.date}</div>
                  <div className="text-muted-foreground whitespace-nowrap">{timestamp.time}</div>
                </TableCell>
                <TableCell>
                  <Badge 
                    variant={entry.eventName === "Redeemed" ? "default" : "destructive"}
                    className={`text-[10px] md:text-xs ${entry.eventName === "Redeemed" ? "bg-green-500" : ""}`}
                  >
                    {entry.eventName}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <code className="text-[10px] md:text-xs font-mono">
                      {entry.ephemeralAddress?.slice(0, 6)}...{entry.ephemeralAddress?.slice(-4)}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0"
                      onClick={() => copyToClipboard(entry.ephemeralAddress, fieldId)}
                    >
                      {copiedField === fieldId ? (
                        <CopyCheck className="h-3 w-3" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-0.5">
                    {entry.tokens?.map((tokenAddress: string, index: number) => {
                      const tokenInfo = getTokenInfo(tokenAddress);
                      const amount = formatUnits(entry.amounts?.[index] || "0", 18);
                      return (
                        <div key={index} className="text-[10px] md:text-xs whitespace-nowrap">
                          <span className="font-medium">{parseFloat(amount).toFixed(2)}</span>{" "}
                          <span className="text-muted-foreground">{tokenInfo.symbol}</span>
                        </div>
                      );
                    })}
                  </div>
                </TableCell>
                <TableCell className="text-xs md:text-sm">
                  <span className="font-medium">{entry.quantity || 1}</span>
                </TableCell>
                <TableCell>
                  {entry.recipient ? (
                    <div className="flex items-center gap-1">
                      <code className="text-[10px] md:text-xs font-mono">
                        {entry.recipient.slice(0, 4)}...{entry.recipient.slice(-4)}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0"
                        onClick={() => copyToClipboard(entry.recipient, `recipient-${entry.id}`)}
                      >
                        {copiedField === `recipient-${entry.id}` ? (
                          <CopyCheck className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

export default ReferralsManagement;

