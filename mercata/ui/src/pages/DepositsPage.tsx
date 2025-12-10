import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileSidebar from '../components/dashboard/MobileSidebar';
import { 
  Card, 
  CardContent,  
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { Tabs as AntdTabs } from "antd";
import { ArrowRight, Loader2 } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import { useTokenContext } from '@/context/TokenContext';
import BridgeIn from '@/components/bridge/BridgeIn';
import { useBridgeContext } from '@/context/BridgeContext';
import DepositTransactionDetails from '@/components/dashboard/DepositTransactionDetails';
import { formatBalance, ensureHexPrefix } from '@/utils/numberUtils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { EarningAsset, BridgeToken } from '@mercata/shared-types';
import { useAccount, useReadContract, useBalance } from 'wagmi';
import { ERC20_ABI } from '@/lib/bridge/constants';
import { api } from '@/lib/axios';
import { getExplorerUrl } from '@/lib/bridge/utils';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

const DepositsPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { userAddress } = useUser();
  const { earningAssets, getEarningAssets, loadingEarningAssets } = useTokenContext();
  const { loadNetworksAndTokens, setTargetTransactionTab, fetchDepositTransactions, availableNetworks } = useBridgeContext();
  const { address, isConnected } = useAccount();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"easy-savings" | "bridge-in">("easy-savings");
  const [pendingDeposits, setPendingDeposits] = useState(0);
  const [loadingPendingDeposits, setLoadingPendingDeposits] = useState(true);
  const [hasInitialLoad, setHasInitialLoad] = useState(false);
  const pendingDepositsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [expandedSection, setExpandedSection] = useState<'summary' | 'assets'>('assets');
  const [allBridgeableTokens, setAllBridgeableTokens] = useState<BridgeToken[]>([]);
  const [loadingBridgeableTokens, setLoadingBridgeableTokens] = useState(false);
  const [pendingTxs, setPendingTxs] = useState<Array<{txHash: string; chainId: string; timestamp: number}>>([]);
  const [txStatuses, setTxStatuses] = useState<Record<string, number>>({});

  // Filter and sort earning assets - only show assets with balance
  const filteredAndSortedAssets = useMemo(() => {
    const owned = earningAssets.filter((asset) => {
      const balance = parseFloat(asset.balance || "0");
      const collateralBalance = parseFloat(asset.collateralBalance || "0");
      return balance > 0 || collateralBalance > 0;
    });
    
    return owned.sort((a, b) => {
      const valueA = parseFloat(a.value || "0");
      const valueB = parseFloat(b.value || "0");
      return valueB - valueA;
    });
  }, [earningAssets]);

  const paginatedAssets = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredAndSortedAssets.slice(startIndex, endIndex);
  }, [filteredAndSortedAssets, currentPage]);

  const totalPages = Math.ceil(filteredAndSortedAssets.length / itemsPerPage);

  const fetchPendingDeposits = useCallback(async (isInitialLoad = false) => {
    try {
      if (isInitialLoad) {
        setLoadingPendingDeposits(true);
      }
      
      // Just count pending transactions from localStorage
      setPendingDeposits(pendingTxs.length);
      
      if (isInitialLoad) {
        setHasInitialLoad(true);
        setLoadingPendingDeposits(false);
      }
    } catch (error) {
      console.error('Error loading pending deposits:', error);
      setPendingDeposits(pendingTxs.length);
      if (isInitialLoad) {
        setHasInitialLoad(true);
        setLoadingPendingDeposits(false);
      }
    }
  }, [pendingTxs.length]);

  useEffect(() => {
    const hasExistingEarningAssets = earningAssets.length > 0;
    
    getEarningAssets(!hasExistingEarningAssets);
    loadNetworksAndTokens().catch((error) => {
      console.error('Failed to load networks and tokens:', error);
    });
  }, [location.pathname, userAddress, getEarningAssets, loadNetworksAndTokens]);

  const fetchAllBridgeableTokens = useCallback(async () => {
    if (availableNetworks.length === 0) return;
    
    setLoadingBridgeableTokens(true);
    try {
      const tokenPromises = availableNetworks.map(async (network) => {
        try {
          const { data } = await api.get<BridgeToken[]>(`/bridge/bridgeableTokens/${network.chainId}`);
          return Array.isArray(data) ? data : [];
        } catch {
          return [];
        }
      });
      
      const allTokens = (await Promise.all(tokenPromises)).flat();
      setAllBridgeableTokens(allTokens);
    } catch (error) {
      console.error('Error fetching bridgeable tokens:', error);
      setAllBridgeableTokens([]);
    } finally {
      setLoadingBridgeableTokens(false);
    }
  }, [availableNetworks]);

  useEffect(() => {
    if (availableNetworks.length > 0) {
      fetchAllBridgeableTokens();
    }
  }, [availableNetworks, fetchAllBridgeableTokens]);

  useEffect(() => {
    if (activeTab === 'easy-savings' || activeTab === 'bridge-in') {
      setExpandedSection('summary');
    }
  }, [activeTab]);

  useEffect(() => {
    // Initial load with spinner
    fetchPendingDeposits(true);
  }, [fetchPendingDeposits]);

  // Update count whenever pendingTxs changes
  useEffect(() => {
    setPendingDeposits(pendingTxs.length);
  }, [pendingTxs.length]);

  useEffect(() => {
    const loadPendingTxs = () => {
      const pending: Array<{txHash: string; chainId: string; timestamp: number}> = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('pending_deposit_')) {
          try {
            const data = JSON.parse(localStorage.getItem(key) || '{}');
            if (data.txHash && data.chainId) {
              pending.push(data);
            }
          } catch {
            // Invalid data, skip
          }
        }
      }
      setPendingTxs(pending);
    };

    loadPendingTxs();
    const interval = setInterval(loadPendingTxs, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const checkPendingTxs = async () => {
      // Get current pending txs from localStorage to avoid dependency issues
      const currentPendingTxs: Array<{txHash: string; chainId: string; timestamp: number}> = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('pending_deposit_')) {
          try {
            const data = JSON.parse(localStorage.getItem(key) || '{}');
            if (data.txHash && data.chainId) {
              currentPendingTxs.push(data);
            }
          } catch {}
        }
      }

      console.log('[CACHE DEBUG] checkPendingTxs called, pendingTxs.length:', currentPendingTxs.length);
      if (currentPendingTxs.length === 0) {
        console.log('[CACHE DEBUG] No pending transactions, skipping check');
        return;
      }
      
      try {
        console.log('[CACHE DEBUG] Fetching deposit transactions...');
        const params: Record<string, string> = {
          limit: '100',
          offset: '0',
          order: 'block_timestamp.desc',
        };
        
        const result = await fetchDepositTransactions(params);
        console.log('[CACHE DEBUG] Fetched deposit transactions:', result.data?.length || 0, 'transactions');
        
        // Log first transaction structure to see what we're working with
        if (result.data && result.data.length > 0) {
          const firstTx = result.data[0] as any;
          console.log('[CACHE DEBUG] First transaction structure:', JSON.stringify(firstTx, null, 2));
          console.log('[CACHE DEBUG] First transaction keys:', Object.keys(firstTx || {}));
          console.log('[CACHE DEBUG] First transaction externalTxHash:', firstTx?.externalTxHash);
          console.log('[CACHE DEBUG] First transaction DepositInfo:', firstTx?.DepositInfo);
        }
        
        const statusMap: Record<string, number> = {};
        
        result.data.forEach((tx: any) => {
          // externalTxHash is at the top level, not inside DepositInfo
          const txHash = tx?.externalTxHash || tx?.DepositInfo?.externalTxHash || tx?.value?.externalTxHash;
          // bridgeStatus is inside DepositInfo
          const bridgeStatus = tx?.DepositInfo?.bridgeStatus || tx?.value?.bridgeStatus || tx?.bridgeStatus;
          
          if (txHash) {
            const status = parseInt(bridgeStatus || "0");
            statusMap[txHash] = status;
            console.log('[CACHE DEBUG] Found transaction:', { 
              txHash, 
              status, 
              bridgeStatus: bridgeStatus,
              externalChainId: tx?.externalChainId || tx?.key
            });
          } else {
            // Log first few transactions that are missing the hash to debug
            if (Object.keys(statusMap).length < 3) {
              console.log('[CACHE DEBUG] Transaction missing externalTxHash, structure:', {
                hasDepositInfo: !!tx?.DepositInfo,
                hasValue: !!tx?.value,
                hasExternalTxHash: !!tx?.externalTxHash,
                txKeys: Object.keys(tx || {}),
                depositInfoKeys: tx?.DepositInfo ? Object.keys(tx.DepositInfo) : [],
                valueKeys: tx?.value ? Object.keys(tx.value) : []
              });
            }
          }
        });

        setTxStatuses(statusMap);

        const completedHashes = new Set(
          Object.entries(statusMap)
            .filter(([_, status]) => status === 3)
            .map(([txHash]) => txHash)
        );

        console.log('[CACHE DEBUG] Checking pending transactions:', {
          pendingTxs: currentPendingTxs.map(t => ({ txHash: t.txHash, chainId: t.chainId })),
          completedHashes: Array.from(completedHashes),
          statusMap: Object.entries(statusMap).map(([hash, status]) => ({ hash, status }))
        });

        let removedCount = 0;
        currentPendingTxs.forEach(({ txHash, chainId }) => {
          console.log('[CACHE DEBUG] Checking transaction:', { txHash, chainId, inCompletedSet: completedHashes.has(txHash) });
          if (completedHashes.has(txHash)) {
            const key = `pending_deposit_${txHash}_${chainId}`;
            console.log('[CACHE DEBUG] ✓ Removing completed transaction from cache:', key);
            localStorage.removeItem(key);
            removedCount++;
          } else {
            console.log('[CACHE DEBUG] ✗ Transaction NOT in completed set:', { 
              txHash, 
              chainId, 
              inCompleted: completedHashes.has(txHash),
              allCompletedHashes: Array.from(completedHashes)
            });
          }
        });
        
        // Only update state if we removed something or if pendingTxs changed
        if (removedCount > 0 || currentPendingTxs.length !== pendingTxs.length) {
          const updated: Array<{txHash: string; chainId: string; timestamp: number}> = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith('pending_deposit_')) {
              try {
                const data = JSON.parse(localStorage.getItem(key) || '{}');
                if (data.txHash && data.chainId) {
                  updated.push(data);
                }
              } catch {}
            }
          }
          setPendingTxs(updated);
        }
      } catch (error) {
        console.error('[CACHE DEBUG] Error checking pending transactions:', error);
      }
    };

    // Run immediately on mount
    checkPendingTxs();
    
    const checkInterval = setInterval(checkPendingTxs, 10000);
    console.log('[CACHE DEBUG] Interval set up, will run every 10 seconds');
    return () => {
      console.log('[CACHE DEBUG] Clearing interval');
      clearInterval(checkInterval);
    };
  }, [fetchDepositTransactions]);

  const tokensByChain = useMemo(() => {
    const grouped: Record<string, { chainName: string; tokens: BridgeToken[] }> = {};
    
    allBridgeableTokens.forEach(token => {
      const chainId = token.externalChainId;
      if (!grouped[chainId]) {
        const network = availableNetworks.find(n => n.chainId === chainId);
        grouped[chainId] = {
          chainName: network?.chainName || `Chain ${chainId}`,
          tokens: []
        };
      }
      grouped[chainId].tokens.push(token);
    });
    
    return grouped;
  }, [allBridgeableTokens, availableNetworks]);

  return (
    <div className="h-screen bg-background overflow-hidden">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />
      <div className="h-screen flex flex-col transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Deposits" onMenuClick={() => setIsMobileSidebarOpen(true)} />
        <main className="flex-1 p-6 overflow-y-auto">
          <style>{`
            .custom-tabs .ant-tabs-tab {
              justify-content: center !important;
            }
            .custom-tabs .ant-tabs-tab-btn {
              justify-content: center !important;
              text-align: center !important;
              width: 100% !important;
              color: hsl(var(--muted-foreground)) !important;
            }
            .custom-tabs .ant-tabs-tab-active .ant-tabs-tab-btn {
              color: hsl(var(--primary)) !important;
              text-shadow: none !important;
            }
            .custom-tabs .ant-tabs-ink-bar {
              background: hsl(var(--primary)) !important;
            }
          `}</style>
          <div className="mb-8 flex flex-col lg:flex-row gap-6 items-stretch">
            <div className="w-full lg:w-[50%] flex">
              <Card className="shadow-sm flex-1 flex flex-col">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Deposit Assets</CardTitle>
                    <Link
                      to="/bridge-transactions"
                      onClick={() => setTargetTransactionTab('DepositRecorded')}
                      className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      <ArrowRight size={16} />
                      View Transactions
                    </Link>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col min-h-0">
                  <div className="w-full flex-1 flex flex-col min-h-0">
                  <AntdTabs
                    activeKey={activeTab}
                    items={[
                      {
                        key: "easy-savings",
                        label: "Easy Savings",
                      },
                      {
                        key: "bridge-in",
                        label: "Bridge In",
                      },
                    ]}
                    onChange={(value) =>
                      setActiveTab(value as "easy-savings" | "bridge-in")
                    }
                    className="custom-tabs"
                    style={
                      {
                        "--ant-primary-color": "hsl(var(--primary))",
                        "--ant-primary-color-hover": "hsl(var(--primary))",
                      } as React.CSSProperties
                    }
                  />
                    <div className="mt-4 flex-1 min-h-0 overflow-auto">
                      <BridgeIn isConvert={activeTab === "easy-savings"} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="w-full lg:w-[50%] flex flex-col gap-6 flex-1">
              <Card 
                className={`shadow-sm flex flex-col min-h-0 transition-all duration-300 cursor-pointer hover:shadow-md overflow-hidden ${
                  expandedSection === 'summary' 
                    ? 'flex-[4.5] border-2 border-blue-500' 
                    : 'flex-[0.5] hover:border-blue-300'
                }`}
                onClick={() => setExpandedSection(expandedSection === 'summary' ? 'assets' : 'summary')}
              >
                <CardHeader className="flex-shrink-0 overflow-hidden">
                  <div className="flex items-center justify-between w-full min-w-0 gap-2">
                    <CardTitle className="truncate flex-shrink">Deposit Info</CardTitle>
                    {expandedSection !== 'summary' && (
                      <span className="text-xs text-gray-500 whitespace-nowrap flex-shrink-0">
                        Pending: {pendingDeposits}
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className={`w-full min-w-0 ${expandedSection === 'summary' ? 'flex-1 min-h-0 overflow-auto space-y-5' : 'hidden'}`}>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between py-2">
                      <span className="text-sm text-gray-600">
                        Pending Deposits (waiting for STRATO confirmation)
                      </span>
                      {loadingPendingDeposits && !hasInitialLoad ? (
                        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                      ) : (
                        <span className="text-sm font-semibold text-gray-900">
                          {pendingDeposits}
                        </span>
                      )}
                    </div>
                    
                    {pendingTxs.length > 0 && (
                      <div className="space-y-1.5">
                        {pendingTxs.map(({ txHash, chainId }, index) => {
                          const explorerUrl = getExplorerUrl(chainId, txHash);
                          const status = txStatuses[txHash];
                          const isWaitingForStrato = status === 1 || status === 2;
                          
                          return (
                            <div key={index} className="flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-gray-50 transition-colors gap-2 min-w-0">
                              <a
                                href={explorerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-800 underline font-mono truncate"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {txHash}
                              </a>
                              <a
                                href={explorerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-800 underline whitespace-nowrap flex-shrink-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                View →
                              </a>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  
                  <div className="pt-4 border-t border-gray-200">
                    <div className="text-sm font-semibold text-gray-900 mb-3">Deposit Methods</div>
                    <div className="space-y-3">
                      <div 
                        className={`rounded-lg p-3 border transition-all duration-200 cursor-pointer ${
                          activeTab === 'easy-savings' 
                            ? 'bg-blue-50 border-blue-400 shadow-md ring-2 ring-blue-200' 
                            : 'bg-gray-50 border-gray-200 hover:bg-blue-50/50 hover:border-blue-300 hover:shadow-md hover:ring-1 hover:ring-blue-100'
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveTab('easy-savings');
                        }}
                      >
                        <div className="flex items-start gap-2 mb-1.5">
                          <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 transition-colors ${
                            activeTab === 'easy-savings' ? 'bg-blue-600' : 'bg-gray-400 group-hover:bg-blue-500'
                          }`}></div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-xs font-bold mb-1 transition-colors ${
                              activeTab === 'easy-savings' ? 'text-blue-900' : 'text-gray-900'
                            }`}>Easy Savings</div>
                            <div className="text-xs text-gray-600 leading-relaxed">
                              Convert external tokens (USDC and USDT) directly to USDST on STRATO. Optionally enable autosave via checkbox to automatically deposit your funds into the lending pool to earn savings.
                            </div>
                          </div>
                        </div>
                      </div>
                      <div 
                        className={`rounded-lg p-3 border transition-all duration-200 cursor-pointer ${
                          activeTab === 'bridge-in' 
                            ? 'bg-blue-50 border-blue-400 shadow-md ring-2 ring-blue-200' 
                            : 'bg-gray-50 border-gray-200 hover:bg-blue-50/50 hover:border-blue-300 hover:shadow-md hover:ring-1 hover:ring-blue-100'
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveTab('bridge-in');
                        }}
                      >
                        <div className="flex items-start gap-2 mb-1.5">
                          <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 transition-colors ${
                            activeTab === 'bridge-in' ? 'bg-blue-600' : 'bg-gray-400 group-hover:bg-blue-500'
                          }`}></div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-xs font-bold mb-1 transition-colors ${
                              activeTab === 'bridge-in' ? 'text-blue-900' : 'text-gray-900'
                            }`}>Bridge In</div>
                            <div className="text-xs text-gray-600 leading-relaxed">
                              Bridge external tokens to their STRATO equivalents without conversion. You maintain the original token and can use it for other DeFi activities.
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {Object.entries(tokensByChain).length > 0 && (
                    <div className="pt-4 border-t border-gray-200">
                      <div className="text-sm font-semibold text-gray-900 mb-3">Bridgeable Balances</div>
                      {!isConnected ? (
                        <div className="text-xs text-gray-500 italic bg-gray-50 rounded-lg p-3 text-center">
                          Connect wallet to view balances
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {Object.entries(tokensByChain).map(([chainId, { chainName, tokens }]) => (
                            <ChainTokenBalances
                              key={chainId}
                              chainId={parseInt(chainId)}
                              chainName={chainName}
                              tokens={tokens}
                              address={address}
                              isConnected={isConnected}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card 
                className={`shadow-sm flex flex-col min-h-0 transition-all duration-300 cursor-pointer hover:shadow-md overflow-hidden ${
                  expandedSection === 'assets' 
                    ? 'flex-[4.5] border-2 border-blue-500' 
                    : 'flex-[0.5] hover:border-blue-300'
                }`}
                onClick={() => setExpandedSection(expandedSection === 'assets' ? 'summary' : 'assets')}
              >
                <CardHeader className="flex-shrink-0 overflow-hidden">
                  <div className="flex items-center justify-between w-full min-w-0 gap-2">
                    <CardTitle className="truncate flex-shrink">My Assets</CardTitle>
                    {expandedSection !== 'assets' && (
                      <span className="text-xs text-gray-500 whitespace-nowrap flex-shrink-0">
                        {filteredAndSortedAssets.length} asset{filteredAndSortedAssets.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className={`w-full min-w-0 ${expandedSection === 'assets' ? 'flex-1 min-h-0 overflow-hidden flex flex-col' : 'hidden'}`}>
                  {expandedSection === 'assets' && (
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm w-full overflow-hidden flex flex-col flex-1 min-h-0">
                      <div className="w-full overflow-x-auto flex-1 min-h-0" style={{ WebkitOverflowScrolling: 'touch' }}>
                      <table className="h-full" style={{ minWidth: '400px', width: '100%', display: 'table' }}>
                        <thead>
                          <tr className="bg-gray-50">
                            <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4 min-w-[140px]">
                              Asset
                            </th>
                            <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4 min-w-[100px]">
                              Balance
                            </th>
                            <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4 min-w-[100px]">
                              Collateral Balance
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {loadingEarningAssets && filteredAndSortedAssets.length === 0 ? (
                            <tr className="hover:bg-gray-50 transition-colors">
                              <td
                                colSpan={3}
                                className="py-4 px-4 whitespace-nowrap w-full"
                              >
                                <div className="w-full flex justify-center items-center h-16">
                                  <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                                </div>
                              </td>
                            </tr>
                          ) : paginatedAssets.length > 0 ? (
                            <>
                              {paginatedAssets.map(
                                (asset: EarningAsset, index: number) => (
                                  <tr
                                    key={index}
                                    className="hover:bg-gray-50 transition-colors cursor-pointer"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigate(`/dashboard/deposits/${asset?.address || ''}`);
                                    }}
                                  >
                                    <td className="py-4 px-4">
                                      <div className="flex items-center">
                                        {asset?.images?.[0] ? (
                                          <img
                                            src={asset.images[0].value}
                                            alt={asset._name}
                                            className="w-8 h-8 rounded-full object-cover"
                                          />
                                        ) : (
                                          <div
                                            className="w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-medium"
                                            style={{ backgroundColor: "red" }}
                                          >
                                            {asset?._symbol?.slice(0, 2) || "??"}
                                          </div>
                                        )}
                                        <div className="ml-3 min-w-0 flex-1">
                                          <TooltipProvider>
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Link
                                                  to={`/dashboard/deposits/${asset?.address || ''}`}
                                                  className="font-medium text-blue-600 truncate hover:text-blue-800 underline transition-colors"
                                                  onClick={(e) => e.stopPropagation()}
                                                >
                                                  {asset?._name || ""}
                                                </Link>
                                              </TooltipTrigger>
                                              <TooltipContent>
                                                <p>{asset?._name || ""}</p>
                                              </TooltipContent>
                                            </Tooltip>
                                          </TooltipProvider>
                                          <TooltipProvider>
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <p className="text-gray-500 text-xs truncate">
                                                  {asset?._symbol || ""}
                                                </p>
                                              </TooltipTrigger>
                                              <TooltipContent>
                                                <p>{asset?._symbol || ""}</p>
                                              </TooltipContent>
                                            </Tooltip>
                                          </TooltipProvider>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="py-4 px-4 whitespace-nowrap text-right">
                                      <p className="font-medium text-gray-900">
                                        {!asset?.balance || asset.balance === "0"
                                          ? "-"
                                          : formatBalance(asset.balance, undefined, 18, 1, 4)}
                                      </p>
                                    </td>
                                    <td className="py-4 px-4 whitespace-nowrap text-right">
                                      <p className="font-medium text-gray-900">
                                        {!asset?.collateralBalance || asset.collateralBalance === "0"
                                          ? "-"
                                          : formatBalance(asset.collateralBalance, undefined, 18, 1, 4)}
                                      </p>
                                    </td>
                                  </tr>
                                )
                              )}
                              {/* Empty rows to fill remaining space */}
                              {Array.from({ length: Math.max(0, itemsPerPage - paginatedAssets.length) }).map((_, index) => (
                                <tr key={`empty-${index}`} className="h-16">
                                  <td className="py-4 px-4"></td>
                                  <td className="py-4 px-4"></td>
                                  <td className="py-4 px-4"></td>
                                </tr>
                              ))}
                            </>
                          ) : (
                            <tr className="hover:bg-gray-50 transition-colors">
                              <td
                                colSpan={3}
                                className="py-4 px-4 whitespace-nowrap w-full"
                              >
                                <div className="w-full flex justify-center items-center h-16">
                                  <div>No data to show</div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      </div>
                      {totalPages > 1 && (
                        <div className="mt-4 pb-4">
                          <Pagination>
                            <PaginationContent className="flex flex-wrap sm:flex-nowrap justify-center gap-0 sm:gap-1">
                              <PaginationItem>
                                <PaginationPrevious 
                                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                  className={currentPage === 1 || loadingEarningAssets ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                                />
                              </PaginationItem>
                              
                              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                                <PaginationItem key={page}>
                                  <PaginationLink
                                    onClick={() => setCurrentPage(page)}
                                    isActive={currentPage === page}
                                    className={`cursor-pointer px-2 sm:px-3 ${loadingEarningAssets ? 'opacity-50 pointer-events-none' : ''}`}
                                  >
                                    {page}
                                  </PaginationLink>
                                </PaginationItem>
                              ))}
                              
                              <PaginationItem>
                                <PaginationNext 
                                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                  className={currentPage === totalPages || loadingEarningAssets ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                                />
                              </PaginationItem>
                            </PaginationContent>
                          </Pagination>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Deposit History</CardTitle>
            </CardHeader>
            <CardContent>
              <DepositTransactionDetails context="deposits" />
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

interface ChainTokenBalancesProps {
  chainId: number;
  chainName: string;
  tokens: BridgeToken[];
  address: `0x${string}` | undefined;
  isConnected: boolean;
}

const ChainTokenBalances: React.FC<ChainTokenBalancesProps> = ({ chainId, chainName, tokens, address, isConnected }) => {
  return (
    <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
      <div className="text-xs font-semibold text-gray-900 mb-2">{chainName}</div>
      <div className="space-y-1.5">
        {tokens.map((token) => (
          <TokenBalanceRow
            key={token.id}
            token={token}
            chainId={chainId}
            address={address}
            isConnected={isConnected}
          />
        ))}
      </div>
    </div>
  );
};

interface TokenBalanceRowProps {
  token: BridgeToken;
  chainId: number;
  address: `0x${string}` | undefined;
  isConnected: boolean;
}

const TokenBalanceRow: React.FC<TokenBalanceRowProps> = ({ token, chainId, address, isConnected }) => {
  const isNativeToken = BigInt(token.externalToken || "0") === 0n;
  
  const { data: nativeBalance, isLoading: nativeLoading } = useBalance({
    address,
    chainId,
    query: {
      enabled: isConnected && !!address && isNativeToken,
      refetchInterval: 15000,
    },
  });

  const { data: tokenBalance, isLoading: tokenLoading } = useReadContract({
    address: ensureHexPrefix(token.externalToken) as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId,
    query: {
      enabled: isConnected && !!address && !isNativeToken && !!token.externalToken,
      refetchInterval: 15000,
    },
  });

  const isLoading = nativeLoading || tokenLoading;
  const balance = isNativeToken ? nativeBalance?.value : tokenBalance;
  const decimals = parseInt(token.externalDecimals || "18");

  return (
    <div className="flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-white transition-colors">
      <span className="text-gray-600 truncate flex-1 min-w-0 font-medium">
        {token.externalSymbol || token.externalName}
      </span>
      <span className="text-gray-900 font-semibold ml-3 whitespace-nowrap">
        {isLoading ? (
          <Loader2 className="h-3 w-3 animate-spin inline" />
        ) : balance ? (
          formatBalance(balance.toString(), undefined, decimals, 2, 4)
        ) : (
          "0"
        )}
      </span>
    </div>
  );
};

export default DepositsPage;
