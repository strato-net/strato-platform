import { useEffect, useState, useMemo } from 'react';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileSidebar from '../components/dashboard/MobileSidebar';
import { 
  Card, 
  CardContent,  
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tabs as AntdTabs } from 'antd';
import WithdrawWidget from '@/components/mint/WithdrawWidget';
import BridgeOut from '@/components/bridge/BridgeOut';
import WithdrawTransactionDetails from '@/components/dashboard/WithdrawTransactionDetails';
import { useUserTokens } from '@/context/UserTokensContext';
import { useBridgeContext } from '@/context/BridgeContext';
import { useSearchParams } from 'react-router-dom';
import { useUser } from '@/context/UserContext';
import { formatUnits, ensureHexPrefix } from '@/utils/numberUtils';
import { usdstAddress } from '@/lib/constants';
import { api } from '@/lib/axios';
import { Loader2 } from 'lucide-react';

const WithdrawalsPage = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'from-savings' | 'bridge-out'>('from-savings');
  const { userAddress } = useUser();
  const { usdstBalance, activeTokens, loading: tokensLoading, loadingUsdstBalance } = useUserTokens();
  const { loadNetworksAndTokens, bridgeableTokens, redeemableTokens, fetchWithdrawTransactions, availableNetworks } = useBridgeContext();
  const [searchParams] = useSearchParams();
  const [oraclePrices, setOraclePrices] = useState<Record<string, string>>({});
  const [loadingOraclePrices, setLoadingOraclePrices] = useState(true);
  const [pendingWithdrawalsCount, setPendingWithdrawalsCount] = useState<number>(0);
  const [totalWithdrawn30d, setTotalWithdrawn30d] = useState<string>("0.00");
  const [loadingWithdrawalMetrics, setLoadingWithdrawalMetrics] = useState(true);
  const [allBridgeableTokens, setAllBridgeableTokens] = useState<typeof bridgeableTokens>([]);
  const [loadingBridgeableTokens, setLoadingBridgeableTokens] = useState(true);
  const [bridgeableTokenBalances, setBridgeableTokenBalances] = useState<Record<string, string>>({});

  // Initialize tab from URL params if present
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'bridge-out') {
      setActiveTab('bridge-out');
    }
  }, [searchParams]);

  // Helper function to normalize address for comparison (remove 0x prefix and lowercase)
  const normalizeAddress = (addr: string | undefined | null): string => {
    if (!addr) return '';
    return addr.replace(/^0x/i, '').toLowerCase();
  };

  // Load networks and tokens on mount
  useEffect(() => {
    loadNetworksAndTokens().catch(() => {});
  }, [loadNetworksAndTokens]);

  // Fetch all bridgeable tokens from all networks for comprehensive calculation
  useEffect(() => {
    const fetchAllBridgeableTokens = async () => {
      if (!availableNetworks.length) {
        setLoadingBridgeableTokens(false);
        return;
      }
      
      setLoadingBridgeableTokens(true);
      try {
        // Fetch bridgeable tokens from all enabled networks
        const tokenPromises = availableNetworks.map(network => 
          api.get(`/bridge/bridgeableTokens/${network.chainId}`).catch(() => ({ data: [] }))
        );
        
        const results = await Promise.all(tokenPromises);
        const allTokens: typeof bridgeableTokens = [];
        const seenTokens = new Set<string>();
        
        // Combine tokens from all networks, avoiding duplicates
        results.forEach(result => {
          const tokens = Array.isArray(result.data) ? result.data : [];
          tokens.forEach((token: typeof bridgeableTokens[0]) => {
            if (token.stratoToken && !seenTokens.has(token.stratoToken.toLowerCase())) {
              seenTokens.add(token.stratoToken.toLowerCase());
              allTokens.push(token);
            }
          });
        });
        
        setAllBridgeableTokens(allTokens);
      } catch (error) {
        console.error('Error fetching all bridgeable tokens:', error);
        // Fallback to context bridgeableTokens if available
        setAllBridgeableTokens(bridgeableTokens);
      } finally {
        setLoadingBridgeableTokens(false);
      }
    };

    fetchAllBridgeableTokens();
  }, [availableNetworks, bridgeableTokens]);

  // Fetch balances for bridgeable tokens (same way BridgeOut does via useBalance hook)
  useEffect(() => {
    const fetchBridgeableTokenBalances = async () => {
      const tokensToUse = allBridgeableTokens.length > 0 ? allBridgeableTokens : bridgeableTokens;
      if (tokensToUse.length === 0) return;

      const balancePromises = tokensToUse.map(async (token) => {
        if (!token.stratoToken) return null;
        
        try {
          // Same API call as BridgeOut's fetchBalance: /tokens/balance?address=eq.{addr}
          const addr = token.stratoToken.startsWith("0x")
            ? token.stratoToken.slice(2)
            : token.stratoToken;
          const { data } = await api.get(`/tokens/balance?address=eq.${addr}`);
          
          if (Array.isArray(data) && data[0]?.balance) {
            return {
              address: normalizeAddress(token.stratoToken),
              balance: String(data[0].balance)
            };
          }
          return {
            address: normalizeAddress(token.stratoToken),
            balance: "0"
          };
        } catch (error) {
          return {
            address: normalizeAddress(token.stratoToken),
            balance: "0"
          };
        }
      });

      const balances = await Promise.all(balancePromises);
      const balanceMap: Record<string, string> = {};
      balances.forEach(b => {
        if (b) {
          balanceMap[b.address] = b.balance;
        }
      });
      
      setBridgeableTokenBalances(balanceMap);
    };

    fetchBridgeableTokenBalances();
  }, [allBridgeableTokens, bridgeableTokens]);

  // Fetch oracle prices
  useEffect(() => {
    const fetchOraclePrices = async () => {
      setLoadingOraclePrices(true);
      try {
        const response = await api.get('/oracle/price');
        const allPrices = response.data;
        
        if (Array.isArray(allPrices)) {
          const priceMap = allPrices.reduce((acc: Record<string, string>, item: { asset?: string; price?: string }) => {
            if (item.asset && item.price) {
              // Store with both normalized (no 0x) and with 0x prefix for lookup flexibility
              const normalizedAddr = normalizeAddress(item.asset);
              acc[normalizedAddr] = item.price;
              acc[item.asset.toLowerCase()] = item.price;
              if (!item.asset.toLowerCase().startsWith('0x')) {
                acc[`0x${item.asset.toLowerCase()}`] = item.price;
              }
            }
            return acc;
          }, {});
          
          setOraclePrices(priceMap);
        }
      } catch (error) {
        console.error('Error fetching oracle prices:', error);
        // Continue with empty price map if fetch fails
      } finally {
        setLoadingOraclePrices(false);
      }
    };

    fetchOraclePrices();
  }, []);

  // Comprehensive query: Fetch all withdrawals for the user (to be filtered by different parts)
  // This query fetches completed withdrawals for calculating 30d total, and pending for count
  useEffect(() => {
    const fetchWithdrawalMetrics = async () => {
      if (!userAddress) {
        setPendingWithdrawalsCount(0);
        setTotalWithdrawn30d("0.00");
        setLoadingWithdrawalMetrics(false);
        return;
      }

      setLoadingWithdrawalMetrics(true);
      try {
        // Ensure address has 0x prefix and normalize for API query
        const addressWithPrefix = ensureHexPrefix(userAddress) || userAddress;
        const normalizedUserAddress = addressWithPrefix.toLowerCase();
        
        // Calculate date 30 days ago
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const dateFilter = thirtyDaysAgo.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
        
        // Fetch pending withdrawals (status 2)
        const pendingParams: Record<string, string | undefined> = {
          limit: '1000',
          offset: '0',
          order: 'block_timestamp.desc',
          "value->>bridgeStatus": 'eq.2', // Pending Review
          "value->>stratoSender": `eq.${normalizedUserAddress}`,
        };
        
        // Fetch completed withdrawals from last 30 days (status 3)
        const completedParams: Record<string, string | undefined> = {
          limit: '1000', // Get enough to cover 30 days
          offset: '0',
          order: 'block_timestamp.desc',
          "value->>bridgeStatus": 'eq.3', // Completed
          "value->>stratoSender": `eq.${normalizedUserAddress}`,
          block_timestamp: `gte.${dateFilter}`, // Last 30 days
        };
        
        const [pendingResult, completedResult] = await Promise.all([
          fetchWithdrawTransactions(pendingParams),
          fetchWithdrawTransactions(completedParams),
        ]);
        
        // Set pending count
        setPendingWithdrawalsCount(pendingResult.totalCount || pendingResult.data?.length || 0);
        
        // Calculate total USD value of completed withdrawals
        let totalUSD = 0;
        if (completedResult.data && completedResult.data.length > 0) {
          for (const withdrawal of completedResult.data) {
            try {
              // Access withdrawal data - the structure has WithdrawalInfo nested
              // Type assertion needed because BridgeTransaction type doesn't include WithdrawalInfo
              const withdrawalRecord = withdrawal as { WithdrawalInfo?: { stratoToken?: string; stratoTokenAmount?: string } };
              const stratoToken = withdrawalRecord?.WithdrawalInfo?.stratoToken;
              const stratoTokenAmount = withdrawalRecord?.WithdrawalInfo?.stratoTokenAmount || "0";
              
              if (stratoToken && stratoTokenAmount !== "0") {
                // Normalize token address for oracle price lookup
                const normalizedTokenAddr = normalizeAddress(stratoToken);
                
                // Get oracle price for this token
                let oraclePriceWei = oraclePrices[normalizedTokenAddr] || 
                                   oraclePrices[`0x${normalizedTokenAddr}`] || 
                                   oraclePrices[normalizedTokenAddr.toLowerCase()] ||
                                   null;
                
                // Fallback to token price if oracle price not available
                if (!oraclePriceWei) {
                  const matchingToken = activeTokens.find(
                    (token) => normalizeAddress(token.address) === normalizedTokenAddr
                  );
                  if (matchingToken?.price) {
                    try {
                      if (typeof matchingToken.price === "number" ||
                          (typeof matchingToken.price === "string" && matchingToken.price.includes("e"))) {
                        oraclePriceWei = BigInt(Number(matchingToken.price)).toString();
                      } else {
                        oraclePriceWei = matchingToken.price.toString();
                      }
                    } catch (e) {
                      // Ignore price conversion errors
                    }
                  }
                }
                
                if (oraclePriceWei && oraclePriceWei !== "0") {
                  // Calculate USD value: price * amount (both in 18 decimals)
                  const price = parseFloat(formatUnits(BigInt(oraclePriceWei), 18));
                  const amount = parseFloat(formatUnits(BigInt(stratoTokenAmount), 18));
                  const usdValue = price * amount;
                  
                  if (!isNaN(usdValue) && isFinite(usdValue) && usdValue > 0) {
                    totalUSD += usdValue;
                  }
                }
              }
            } catch (e) {
              // Ignore errors for individual withdrawals
            }
          }
        }
        
        setTotalWithdrawn30d(totalUSD.toFixed(2));
      } catch (error) {
        console.error('Error fetching withdrawal metrics:', error);
        setPendingWithdrawalsCount(0);
        setTotalWithdrawn30d("0.00");
      } finally {
        setLoadingWithdrawalMetrics(false);
      }
    };

    fetchWithdrawalMetrics();
  }, [fetchWithdrawTransactions, userAddress, oraclePrices, activeTokens]);

  // Calculate available to withdraw: Combine assets from "From Savings" (USDST) and "Bridge Out" (bridgeable tokens)
  // Then calculate USD value = oracle price * balance for each asset, then sum
  const availableToWithdraw = useMemo(() => {
    // Return null to indicate loading state - only while actively loading critical data
    // Don't block on bridgeableTokens loading - we can calculate with what we have
    if (tokensLoading || loadingOraclePrices) {
      return null;
    }

    // 1. Build set of eligible asset addresses for quick lookup
    const eligibleAssetsSet = new Set<string>();

    // From "From Savings": USDST (always available)
    const usdstAddrNormalized = normalizeAddress(usdstAddress);
    eligibleAssetsSet.add(usdstAddrNormalized);

    // From "Bridge Out": All bridgeable tokens (use allBridgeableTokens which includes tokens from all networks)
    const tokensToUse = allBridgeableTokens.length > 0 ? allBridgeableTokens : bridgeableTokens;
    tokensToUse.forEach((token) => {
      if (token.stratoToken) {
        const addr = normalizeAddress(token.stratoToken);
        if (addr) {
          eligibleAssetsSet.add(addr);
        }
      }
    });

    // 2. Calculate USD value for eligible assets
    // This matches how BridgeOut calculates max withdrawable: it uses balanceData?.balance from useBalance hook
    // We use token.balance from activeTokens, which comes from the same /tokens/balance API endpoint
    let totalUSDValue = 0;

    // First, handle USDST separately (always eligible, might have balance even if not in activeTokens)
    if (eligibleAssetsSet.has(usdstAddrNormalized)) {
      const usdstBalanceWei = usdstBalance || "0";
      
      if (usdstBalanceWei !== "0" && BigInt(usdstBalanceWei) > 0n) {
        // Get oracle price for USDST
        let oraclePriceWei = oraclePrices[usdstAddrNormalized] || 
                             oraclePrices[`0x${usdstAddrNormalized}`] || 
                             oraclePrices[usdstAddress.toLowerCase()] ||
                             oraclePrices[usdstAddress] ||
                             null;
        
        // USDST price should be ~1, so if not found, use 1e18 (1 USD in wei)
        if (!oraclePriceWei || oraclePriceWei === "0") {
          oraclePriceWei = "1000000000000000000"; // 1 USD in wei
        }
        
        try {
          const price = parseFloat(formatUnits(BigInt(oraclePriceWei), 18));
          const balance = parseFloat(formatUnits(BigInt(usdstBalanceWei), 18));
          const usdstUSDValue = price * balance;
          if (!isNaN(usdstUSDValue) && isFinite(usdstUSDValue) && usdstUSDValue > 0) {
            totalUSDValue += usdstUSDValue;
          }
        } catch (e) {
          // Ignore errors
        }
      }
    }

    // Then process bridgeable tokens that might not be in activeTokens
    // Fetch their balances the same way BridgeOut does
    for (const bridgeableToken of tokensToUse) {
      if (!bridgeableToken.stratoToken) continue;
      
      const tokenAddrNormalized = normalizeAddress(bridgeableToken.stratoToken);
      
      // Skip USDST (already processed above)
      if (tokenAddrNormalized === usdstAddrNormalized) continue;
      
      // Skip if already processed in activeTokens
      const alreadyProcessed = activeTokens.some(t => normalizeAddress(t.address) === tokenAddrNormalized);
      if (alreadyProcessed) continue;

      try {
        // Get balance from bridgeableTokenBalances (fetched via same API as BridgeOut)
        const balanceWei = bridgeableTokenBalances[tokenAddrNormalized] || "0";

        if (balanceWei !== "0" && BigInt(balanceWei) > 0n) {
          // Get oracle price for this asset (check multiple formats)
          const oraclePriceWei = oraclePrices[tokenAddrNormalized] || 
                                 oraclePrices[`0x${tokenAddrNormalized}`] || 
                                 oraclePrices[bridgeableToken.stratoToken.toLowerCase()] ||
                                 oraclePrices[bridgeableToken.stratoToken] ||
                                 null;
          
          if (oraclePriceWei && oraclePriceWei !== "0") {
            try {
              // Calculate USD value: oracle price (wei) * balance (wei)
              const price = parseFloat(formatUnits(BigInt(oraclePriceWei), 18));
              const balance = parseFloat(formatUnits(BigInt(balanceWei), 18));
              const tokenUSDValue = price * balance;
              
              if (!isNaN(tokenUSDValue) && isFinite(tokenUSDValue) && tokenUSDValue > 0) {
                totalUSDValue += tokenUSDValue;
              }
            } catch (e) {
              // Ignore errors
            }
          }
        }
      } catch (e) {
        // Ignore errors
      }
    }

    // Then iterate through activeTokens for other eligible assets
    for (const token of activeTokens) {
      const tokenAddrNormalized = normalizeAddress(token.address);
      
      // Check if this token is eligible for withdrawal (USDST or bridgeable)
      if (!eligibleAssetsSet.has(tokenAddrNormalized)) {
        continue; // Skip tokens that aren't eligible
      }

      // Skip USDST (already processed above)
      if (tokenAddrNormalized === usdstAddrNormalized) {
        continue;
      }

      try {
        // Get balance from token - same source as BridgeOut's useBalance hook
        // BridgeOut: balanceData?.balance from useBalance(tokenAddress) -> fetchBalance -> /tokens/balance?address=eq.{addr}
        // We use: token.balance from activeTokens -> fetchTokens -> /tokens/balance (all tokens)
        const rawBalance = token.balance || "0";
        
        const balanceWei = rawBalance || "0";

        if (balanceWei !== "0" && BigInt(balanceWei) > 0n) {
          // Get oracle price for this asset (check multiple formats)
          let oraclePriceWei = oraclePrices[tokenAddrNormalized] || 
                               oraclePrices[`0x${tokenAddrNormalized}`] || 
                               oraclePrices[token.address.toLowerCase()] ||
                               oraclePrices[token.address] ||
                               null;
          
          // Fallback: use token's price field if oracle price not available
          if (!oraclePriceWei && token.price) {
            try {
              // Handle scientific notation or BigInt-like inputs gracefully
              if (typeof token.price === "number" ||
                  (typeof token.price === "string" && token.price.includes("e"))) {
                oraclePriceWei = BigInt(Number(token.price)).toString();
              } else {
                oraclePriceWei = token.price.toString();
              }
            } catch (e) {
              // Ignore errors
            }
          }
          
          if (oraclePriceWei && oraclePriceWei !== "0") {
            try {
              // Calculate USD value: oracle price (wei) * balance (wei)
              // Both are in 18 decimals, so: (priceWei / 10^18) * (balanceWei / 10^18)
              const price = parseFloat(formatUnits(BigInt(oraclePriceWei), 18));
              const balance = parseFloat(formatUnits(BigInt(balanceWei), 18));

              // Calculate USD value: oracle price * balance
              const tokenUSDValue = price * balance;
              if (!isNaN(tokenUSDValue) && isFinite(tokenUSDValue) && tokenUSDValue > 0) {
                totalUSDValue += tokenUSDValue;
              }
            } catch (e) {
              // Ignore errors
            }
          }
        }
      } catch (e) {
        // Ignore errors for individual tokens
      }
    }

    return totalUSDValue.toFixed(2);
  }, [activeTokens, bridgeableTokens, allBridgeableTokens, oraclePrices, usdstBalance, tokensLoading, loadingOraclePrices, bridgeableTokenBalances]);

  // Calculate withdrawal summary metrics
  const pendingWithdrawals = pendingWithdrawalsCount.toString();

  return (
    <div className="h-screen bg-gray-50 overflow-hidden">
      <style>{`
        .custom-tabs .ant-tabs-tab {
          justify-content: center !important;
        }
        .custom-tabs .ant-tabs-tab-btn {
          justify-content: center !important;
          text-align: center !important;
          width: 100% !important;
        }
      `}</style>
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />
      <div className="h-screen flex flex-col transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Withdrawals" onMenuClick={() => setIsMobileSidebarOpen(true)} />
        <main className="flex-1 p-6 overflow-y-auto">
          {/* Two-column layout */}
          <div className="mb-8 flex flex-col lg:flex-row gap-6 items-start">
            {/* Left column - Withdraw Assets */}
            <div className="w-full lg:w-[60%] lg:min-w-[500px]">
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle>Withdraw Assets</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="w-full bg-white/90 p-1.5 rounded-xl border border-gray-200 shadow-sm">
                    <AntdTabs
                      activeKey={activeTab}
                      items={[
                        {
                          key: 'from-savings',
                          label: 'From Savings',
                        },
                        {
                          key: 'bridge-out',
                          label: 'Bridge Out',
                        },
                      ]}
                      onChange={(value) => setActiveTab(value as 'from-savings' | 'bridge-out')}
                      className="custom-tabs"
                      style={{
                        '--ant-primary-color': '#3b82f6',
                        '--ant-primary-color-hover': '#2563eb',
                      } as React.CSSProperties}
                    />
                    <div className="bg-white rounded-xl p-4 shadow-sm mt-4">
                      {activeTab === 'from-savings' ? (
                        <WithdrawWidget />
                      ) : (
                        <BridgeOut />
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right column - Summary and Notes */}
            <div className="w-full lg:w-[40%] lg:min-w-[300px] lg:max-w-[400px] space-y-6">
              {/* Withdrawal Summary */}
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle>Withdrawal Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Total Withdrawn (30d)</span>
                    {loadingWithdrawalMetrics ? (
                      <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    ) : (
                      <span className="text-sm font-semibold">${totalWithdrawn30d}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Pending Withdrawals</span>
                    {loadingWithdrawalMetrics ? (
                      <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    ) : (
                      <span className="text-sm font-semibold">{pendingWithdrawals}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Available to Withdraw</span>
                    {availableToWithdraw === null ? (
                      <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    ) : (
                      <span className="text-sm font-semibold text-green-600">${parseFloat(availableToWithdraw).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Important Notes */}
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle>Important Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-gray-600 list-disc list-inside">
                    <li>Minimum withdrawal amounts apply per asset</li>
                    <li>Withdrawals typically process within 24-48 hours</li>
                    <li>Network fees are deducted from your withdrawal amount</li>
                    <li>Always double-check the destination address before confirming</li>
                    <li>Bridge withdrawals require approval and may take longer</li>
                    <li>USDST withdrawals incur a transaction fee</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Withdrawal History - Full Width */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Withdrawal History</CardTitle>
            </CardHeader>
            <CardContent>
              <WithdrawTransactionDetails showAll={true} />
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default WithdrawalsPage;

