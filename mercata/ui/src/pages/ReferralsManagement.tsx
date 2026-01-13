import { useEffect, useState, useCallback } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, XCircle, Copy, CopyCheck } from "lucide-react";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/axios";
import { useNavigate } from "react-router-dom";
import { formatUnits } from "@/utils/numberUtils";
import { useTokenContext } from "@/context/TokenContext";

interface UserReferral {
  ephemeralAddress: string;
  sender: string;
  tokens: string[];
  amounts: string[];
  expiry: number;
}

const ReferralsManagement = () => {
  const { userAddress } = useUser();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { getTransferableTokens } = useTokenContext();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
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
    <div className="min-h-screen bg-background">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader 
          title="My Referrals" 
          onMenuClick={() => setIsMobileSidebarOpen(true)}
        />
        <main className="p-6">
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
              <CardHeader>
                <CardTitle>Referral History</CardTitle>
                <CardDescription>
                  View your completed and cancelled referrals
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ReferralHistoryTable 
                  userAddress={userAddress}
                  getTokenInfo={getTokenInfo}
                />
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
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
    return timestamp.toLocaleDateString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
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
            <TableHead>Time</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Ephemeral Address</TableHead>
            <TableHead>Tokens</TableHead>
            <TableHead>Recipient</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.map((entry) => {
            const fieldId = `ephemeral-${entry.id}`;
            return (
              <TableRow key={entry.id}>
                <TableCell className="text-sm">
                  {formatTimestamp(
                    entry.blockTimestamp instanceof Date 
                      ? entry.blockTimestamp 
                      : new Date(entry.blockTimestamp)
                  )}
                </TableCell>
                <TableCell>
                  <Badge 
                    variant={entry.eventName === "Redeemed" ? "default" : "destructive"}
                    className={entry.eventName === "Redeemed" ? "bg-green-500" : ""}
                  >
                    {entry.eventName}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono">
                      {entry.ephemeralAddress?.slice(0, 8)}...{entry.ephemeralAddress?.slice(-6)}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
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
                  <div className="space-y-1">
                    {entry.tokens?.map((tokenAddress: string, index: number) => {
                      const tokenInfo = getTokenInfo(tokenAddress);
                      const amount = formatUnits(entry.amounts?.[index] || "0", 18);
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
                  {entry.recipient ? (
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono">
                        {entry.recipient.slice(0, 8)}...{entry.recipient.slice(-6)}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
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
                    <span className="text-sm text-muted-foreground">—</span>
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

