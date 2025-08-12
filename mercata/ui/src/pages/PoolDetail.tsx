import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ArrowLeft, TrendingUp, DollarSign, Activity, Info, ToggleLeft, ToggleRight, HelpCircle } from "lucide-react";
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useSwapContext } from '@/context/SwapContext';
import { useUser } from '@/context/UserContext';
import { useUserTokens } from '@/context/UserTokensContext';
import { useToast } from '@/hooks/use-toast';
import { LiquidityPool } from '@/interface';
import { formatBalance, safeParseUnits } from '@/utils/numberUtils';
import { formatUnits } from 'ethers';
import { usdstAddress, DEPOSIT_FEE, WITHDRAW_FEE } from "@/lib/constants";
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileSidebar from '../components/dashboard/MobileSidebar';

const PoolDetail = () => {
  const { poolAddress } = useParams<{ poolAddress: string }>();
  const navigate = useNavigate();
  const [pool, setPool] = useState<LiquidityPool | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const operationInProgressRef = useRef(false);
  const poolPollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Deposit state
  const [token1Amount, setToken1Amount] = useState('');
  const [token2Amount, setToken2Amount] = useState('');
  const [depositLoading, setDepositLoading] = useState(false);
  const [tokenABalance, setTokenABalance] = useState('');
  const [tokenBBalance, setTokenBBalance] = useState('');
  const [usdstBalance, setUsdstBalance] = useState('');
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [singleTokenDeposit, setSingleTokenDeposit] = useState(false);

  // Withdraw state
  const [withdrawPercent, setWithdrawPercent] = useState('');
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [singleTokenWithdraw, setSingleTokenWithdraw] = useState(false);
  const [withdrawTokenChoice, setWithdrawTokenChoice] = useState<'tokenA' | 'tokenB'>('tokenA');

  const { getPoolByAddress, enrichPools, addLiquidity, removeLiquidity, fetchTokenBalances } = useSwapContext();
  const { userAddress } = useUser();
  const { fetchUsdstBalance } = useUserTokens();
  const { toast } = useToast();

  useEffect(() => {
    if (poolAddress) {
      fetchPoolData();
    }
  }, [poolAddress]);

  // Fetch token balances when pool loads or tab changes
  useEffect(() => {
    if (pool && userAddress) {
      const fetchBalances = async () => {
        try {
          setBalanceLoading(true);
          const balances = await fetchTokenBalances(pool, userAddress, usdstAddress);
          setTokenABalance(balances.tokenABalance);
          setTokenBBalance(balances.tokenBBalance);
          setUsdstBalance(balances.usdstBalance);
          setBalanceLoading(false);
        } catch (error) {
          console.error('Failed to fetch token balances:', error);
          setBalanceLoading(false);
        }
      };

      fetchBalances();
    }
  }, [pool, userAddress, fetchTokenBalances]);

  useEffect(() => {
    if (pool && activeTab !== 'withdraw') {
      const pollPool = async () => {
        try {
          const updatedPool = await getPoolByAddress(pool.address);
          if (updatedPool) {
            const enriched = enrichPools([updatedPool])[0];
            setPool(enriched);
          }
        } catch (error) {
          console.error('Error polling pool:', error);
        }
      };

      poolPollIntervalRef.current = setInterval(pollPool, 10000);

      return () => {
        if (poolPollIntervalRef.current) {
          clearInterval(poolPollIntervalRef.current);
        }
      };
    }
  }, [pool?.address, activeTab, getPoolByAddress]);

  const fetchPoolData = async () => {
    try {
      setLoading(true);
      const poolData = await getPoolByAddress(poolAddress!);
      if (poolData) {
        const enriched = enrichPools([poolData])[0];
        setPool(enriched);
      }
    } catch (error) {
      console.error('Error fetching pool:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (value: string | number): string => {
    try {
      const weiValue = safeParseUnits(value.toString(), 18);
      return formatUnits(weiValue, 18);
    } catch (error) {
      console.error('Error formatting number:', error);
      return '0';
    }
  };

  const handleInputChange = (value: string, token: 'token1' | 'token2') => {
    try {
      if (token === 'token1') {
        setToken1Amount(value);
        if (!singleTokenDeposit) {
          if (
            value &&
            pool?.aToBRatio &&
            BigInt(safeParseUnits(pool.aToBRatio, 18)) > BigInt(0)
          ) {
            const token1Wei = safeParseUnits(value, 18);
            const ratioWei = safeParseUnits(pool.aToBRatio, 18);
            const token2Wei = (token1Wei * ratioWei) / BigInt(10 ** 18);
            setToken2Amount(formatUnits(token2Wei.toString(), 18));
          }
        }
      } else {
        setToken2Amount(value);
        if (
          value &&
          pool?.bToARatio &&
          BigInt(safeParseUnits(pool.bToARatio, 18)) > BigInt(0)
        ) {
          const token2Wei = safeParseUnits(value, 18);
          const ratioWei = safeParseUnits(pool.bToARatio, 18);
          const token1Wei = (token2Wei * ratioWei) / BigInt(10 ** 18);
          setToken1Amount(formatUnits(token1Wei.toString(), 18));
        }
      }
    } catch (error) {
      console.error('Error handling input change:', error);
      if (value === '' || /^\d*\.?\d*$/.test(value)) {
        if (token === 'token1') {
          setToken1Amount(value);
        } else {
          setToken2Amount(value);
        }
      }
    }
  };

  const handleMaxClick = (isFirstToken: boolean) => {
    const balance = isFirstToken ? tokenABalance : tokenBBalance;
    const token = isFirstToken ? pool?.tokenA : pool?.tokenB;
    const isUSDST = token?.address.toLowerCase() === usdstAddress.toLowerCase();

    let maxBigInt = BigInt(balance || "0");

    if (isUSDST) {
      const fee = safeParseUnits(DEPOSIT_FEE, 18);
      if (maxBigInt > fee) {
        maxBigInt = maxBigInt - fee;
      } else {
        maxBigInt = BigInt(0);
      }
    }

    const maxVal = formatUnits(maxBigInt, 18);

    if (isFirstToken) {
      setToken1Amount(maxVal);
      handleInputChange(maxVal, 'token1');
    } else {
      setToken2Amount(maxVal);
      handleInputChange(maxVal, 'token2');
    }
  };

  const handleDepositSubmit = async () => {
    if (!pool || operationInProgressRef.current) return;

    const decimals = 18;
    const token1AmountWei = safeParseUnits(token1Amount, decimals);
    const token2AmountWei = singleTokenDeposit ? BigInt(0) : safeParseUnits(token2Amount, decimals);
    const token1Balance = BigInt(tokenABalance || "0");
    const token2Balance = BigInt(tokenBBalance || "0");

    if (token1AmountWei > token1Balance || (!singleTokenDeposit && token2AmountWei > token2Balance)) {
      toast({
        title: "Error",
        description: "Insufficient balance",
        variant: "destructive",
      });
      return;
    }

    try {
      operationInProgressRef.current = true;
      setDepositLoading(true);
      
      const isInitialLiquidity = BigInt(pool.lpToken._totalSupply) === BigInt(0);
      
      if (singleTokenDeposit) {
        // For single token deposit, we only provide token A
        // The smart contract should handle the swap internally
        await addLiquidity({
          poolAddress: pool.address,
          maxTokenAAmount: token1AmountWei.toString(),
          tokenBAmount: "0",
        });
      } else {
        const tokenAAmount = isInitialLiquidity 
          ? safeParseUnits(token1Amount, 18)
          : safeParseUnits((parseFloat(token1Amount) * 1.02).toFixed(18), 18);
        const tokenBAmount = safeParseUnits(token2Amount, 18);

        await addLiquidity({
          poolAddress: pool.address,
          maxTokenAAmount: tokenAAmount.toString(),
          tokenBAmount: tokenBAmount.toString(),
        });
      }

      await new Promise(resolve => setTimeout(resolve, 2000));

      setToken1Amount('');
      setToken2Amount('');
      await fetchPoolData();
      if (userAddress) {
        await fetchUsdstBalance(userAddress);
      }
      
      toast({
        title: "Success",
        description: `${pool._name} deposited successfully.`,
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: `Something went wrong - ${error}`,
        variant: "destructive",
      });
    } finally {
      setDepositLoading(false);
      operationInProgressRef.current = false;
    }
  };

  // Mock data for charts - in production, this would come from historical data
  const volumeData = [
    { name: '7d ago', volume: 125000 },
    { name: '6d ago', volume: 150000 },
    { name: '5d ago', volume: 130000 },
    { name: '4d ago', volume: 180000 },
    { name: '3d ago', volume: 165000 },
    { name: '2d ago', volume: 190000 },
    { name: '1d ago', volume: 175000 },
    { name: 'Today', volume: 195000 },
  ];

  const liquidityData = [
    { name: '7d ago', liquidity: 2100000 },
    { name: '6d ago', liquidity: 2150000 },
    { name: '5d ago', liquidity: 2180000 },
    { name: '4d ago', liquidity: 2200000 },
    { name: '3d ago', liquidity: 2250000 },
    { name: '2d ago', liquidity: 2280000 },
    { name: '1d ago', liquidity: 2320000 },
    { name: 'Today', liquidity: parseFloat(pool?.totalLiquidityUSD || '0') },
  ];

  const handleWithdrawSubmit = async () => {
    if (!pool || operationInProgressRef.current) return;

    try {
      operationInProgressRef.current = true;
      setWithdrawLoading(true);
      
      const value = BigInt(pool.lpToken.balances?.[0]?.balance || "0");
      const percent = withdrawPercent ? parseFloat(withdrawPercent) : 0;
      const percentScaled = BigInt(Math.round(percent * 100));
      const calculatedAmount = (value * percentScaled) / BigInt(10000);

      if (singleTokenWithdraw) {
        // For single token withdrawal, specify which token to receive
        // The smart contract should handle converting all LP tokens to the specified token
        await removeLiquidity({
          poolAddress: pool.address,
          lpTokenAmount: calculatedAmount.toString(),
          singleToken: withdrawTokenChoice === 'tokenA' ? pool.tokenA.address : pool.tokenB.address,
        });
      } else {
        await removeLiquidity({
          poolAddress: pool.address,
          lpTokenAmount: calculatedAmount.toString(),
        });
      }

      await new Promise(resolve => setTimeout(resolve, 2000));

      setWithdrawPercent('');
      setSingleTokenWithdraw(false);
      setWithdrawTokenChoice('tokenA');
      await fetchPoolData();
      if (userAddress) {
        await fetchUsdstBalance(userAddress);
      }

      toast({
        title: "Success",
        description: `${pool._name} withdrawn successfully.`,
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: `Something went wrong - ${error}`,
        variant: "destructive",
      });
    } finally {
      setWithdrawLoading(false);
      operationInProgressRef.current = false;
    }
  };



  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <DashboardSidebar />
        <div className="transition-all duration-300 md:pl-64">
          <DashboardHeader title="Pool Details" onMenuClick={() => setIsMobileSidebarOpen(true)} />
          <main className="p-6">
            <div className="flex justify-center items-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (!pool) {
    return (
      <div className="min-h-screen bg-gray-50">
        <DashboardSidebar />
        <div className="transition-all duration-300 md:pl-64">
          <DashboardHeader title="Pool Details" onMenuClick={() => setIsMobileSidebarOpen(true)} />
          <main className="p-6">
            <Card>
              <CardContent className="p-6">
                <p className="text-center">Pool not found</p>
                <div className="flex justify-center mt-4">
                  <Button onClick={() => navigate('/dashboard/pools')}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Pools
                  </Button>
                </div>
              </CardContent>
            </Card>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Pool Details" onMenuClick={() => setIsMobileSidebarOpen(true)} />
        
        <main className="p-6">
          {/* Back Button and Pool Header */}
          <div className="mb-6">
            <Button 
              variant="ghost" 
              onClick={() => navigate('/dashboard/pools')}
              className="mb-4"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Pools
            </Button>

            <Card>
              <CardContent className="p-6">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div className="flex items-center">
                    <div className="flex items-center -space-x-2 mr-4">
                      {pool.tokenA?.images?.[0]?.value ? (
                        <img
                          src={pool.tokenA.images[0].value}
                          alt={pool.tokenA.name}
                          className="w-12 h-12 rounded-full z-10 border-2 border-white object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-medium z-10 border-2 border-white bg-blue-500">
                          {pool._symbol?.split('/')[0]?.slice(0, 2)}
                        </div>
                      )}
                      {pool.tokenB?.images?.[0]?.value ? (
                        <img
                          src={pool.tokenB.images[0].value}
                          alt={pool.tokenB.name}
                          className="w-12 h-12 rounded-full border-2 border-white object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-medium border-2 border-white bg-green-500">
                          {pool._symbol?.split('/')[1]?.slice(0, 2)}
                        </div>
                      )}
                    </div>
                    <div>
                      <h1 className="text-2xl font-bold">{pool._name}</h1>
                      <p className="text-gray-500">{pool._symbol}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-500">
                  <div className="flex items-center">
                    <DollarSign className="mr-2 h-4 w-4" />
                    Total Liquidity
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  ${formatBalance(pool.totalLiquidityUSD || '0', undefined, 18, 1, 2)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-500">
                  <div className="flex items-center">
                    <TrendingUp className="mr-2 h-4 w-4" />
                    APY
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{pool.apy || 'N/A'}%</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-500">
                  <div className="flex items-center">
                    <Activity className="mr-2 h-4 w-4" />
                    24h Volume
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">$195,000</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-500">
                  <div className="flex items-center">
                    <Info className="mr-2 h-4 w-4" />
                    Swap Fee
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{pool.swapFeeRate}%</p>
              </CardContent>
            </Card>
          </div>


          {/* Deposit/Withdraw Section */}
          <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{activeTab === 'deposit' ? 'Deposit Liquidity' : 'Withdraw Liquidity'}</CardTitle>
                  <div className="flex rounded-lg bg-gray-100 p-1">
                    <Button
                      size="sm"
                      variant={activeTab === 'deposit' ? 'default' : 'ghost'}
                      className={`px-3 py-1 text-xs ${
                        activeTab === 'deposit' 
                          ? 'bg-strato-blue text-white' 
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                      onClick={() => {
                        setActiveTab('deposit');
                        setSingleTokenDeposit(false);
                        setToken2Amount('');
                      }}
                    >
                      Deposit
                    </Button>
                    <Button
                      size="sm"
                      variant={activeTab === 'withdraw' ? 'default' : 'ghost'}
                      className={`px-3 py-1 text-xs ${
                        activeTab === 'withdraw' 
                          ? 'bg-strato-blue text-white' 
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                      onClick={() => {
                        setActiveTab('withdraw');
                        setSingleTokenWithdraw(false);
                        setWithdrawTokenChoice('tokenA');
                      }}
                      disabled={!pool?.lpToken.balances?.length}
                    >
                      Withdraw
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {activeTab === 'deposit' ? (
                  <div className="space-y-4">
                    {/* First Token Input */}
                    <div className="rounded-lg border p-3">
                      <span className="text-sm text-gray-500">Amount</span>
                      <div className="flex items-center gap-2">
                        <Input
                          disabled={balanceLoading}
                          placeholder="0.0"
                          className={`flex-1 border-none text-xl font-medium p-0 h-auto focus-visible:ring-0 ${
                            safeParseUnits(token1Amount, 18) > BigInt(tokenABalance || "0") ? "text-red-500" : ""
                          }`}
                          value={token1Amount}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === '' || /^\d*\.?\d*$/.test(value)) {
                              if (value === '.') {
                                handleInputChange('0.', 'token1');
                              } else {
                                handleInputChange(value, 'token1');
                              }
                            }
                          }}
                        />
                        <div className="flex items-center space-x-2 bg-gray-100 rounded-md px-2 py-1 flex-shrink-0">
                          {pool && (
                            <>
                              {pool.tokenA?.images?.[0]?.value ? (
                                <img
                                  src={pool.tokenA.images[0].value}
                                  alt={pool.tokenA.name || pool._name?.split('/')[0]}
                                  className="w-6 h-6 rounded-full object-cover"
                                />
                              ) : (
                                <div
                                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-medium"
                                  style={{ backgroundColor: "red" }}
                                >
                                  {pool._name?.split('/')[0]?.slice(0, 2)}
                                </div>
                              )}
                              <span className="font-medium text-sm">{pool._name?.split('/')[0]}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className='flex items-center justify-between'>
                        <span className="text-sm text-gray-500">
                          Balance: {balanceLoading ?
                              <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-primary inline-block"></div>
                            : formatUnits(tokenABalance || "0", 18)}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-xs text-blue-500"
                          onClick={() => handleMaxClick(true)}
                          disabled={balanceLoading}
                        >
                          Max
                        </Button>
                      </div>
                      {safeParseUnits(token1Amount, 18) > BigInt(tokenABalance || "0") && (
                        <p className="text-red-600 text-sm mt-1">Insufficient balance</p>
                      )}
                    </div>

                    {/* Single Token Toggle */}
                    <div className="flex justify-end">
                      <TooltipProvider>
                        <UITooltip>
                          <TooltipTrigger asChild>
                            <div 
                              className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg cursor-pointer hover:bg-blue-100 transition-colors"
                              onClick={() => {
                                setSingleTokenDeposit(!singleTokenDeposit);
                                if (!singleTokenDeposit) {
                                  setToken2Amount('');
                                } else if (token1Amount) {
                                  // Re-calculate token2 amount when disabling single token mode
                                  handleInputChange(token1Amount, 'token1');
                                }
                              }}>
                              {singleTokenDeposit ? (
                                <ToggleRight className="h-4 w-4 text-strato-blue" />
                              ) : (
                                <ToggleLeft className="h-4 w-4 text-gray-500" />
                              )}
                              <span className="text-xs font-medium">
                                Single Token
                              </span>
                              <HelpCircle className="h-3 w-3 text-gray-400" />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p className="text-sm">
                              <strong>Single-Sided Liquidity Provision</strong>
                            </p>
                            <p className="text-xs mt-1">
                              Deposit only one token type. The protocol will automatically swap half of your deposit to the other token at the current pool rate to maintain balance. This may result in slippage depending on pool size.
                            </p>
                          </TooltipContent>
                        </UITooltip>
                      </TooltipProvider>
                    </div>

                    {/* Second Token Input */}
                    <div className={`rounded-lg border p-3 ${singleTokenDeposit ? 'opacity-50 pointer-events-none' : ''}`}>
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-gray-500">Amount {singleTokenDeposit && '(Not Required)'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          disabled={balanceLoading || singleTokenDeposit}
                          placeholder="0.0"
                          className={`flex-1 border-none text-xl font-medium p-0 h-auto focus-visible:ring-0 ${
                            safeParseUnits(token2Amount, 18) > BigInt(tokenBBalance || "0") ? "text-red-500" : ""
                          }`}
                          value={token2Amount}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === '' || /^\d*\.?\d*$/.test(value)) {
                              if (value === '.') {
                                handleInputChange('0.', 'token2');
                              } else {
                                handleInputChange(value, 'token2');
                              }
                            }
                          }}
                        />
                        <div className="flex items-center space-x-2 bg-gray-100 rounded-md px-2 py-1 flex-shrink-0">
                          {pool && (
                            <>
                              {pool.tokenB?.images?.[0]?.value ? (
                                <img
                                  src={pool.tokenB.images[0].value}
                                  alt={pool.tokenB.name || pool._name?.split('/')[1]}
                                  className="w-6 h-6 rounded-full object-cover"
                                />
                              ) : (
                                <div
                                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-medium"
                                  style={{ backgroundColor: "red" }}
                                >
                                  {pool._name?.split('/')[1]?.slice(0, 2)}
                                </div>
                              )}
                              <span className="font-medium text-sm">{pool._name?.split('/')[1]}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className='flex items-center justify-between'>
                        <span className="text-sm text-gray-500">
                          Balance: {balanceLoading ?
                            <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-primary inline-block"></div>
                            : formatUnits(tokenBBalance || "0", 18)}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-xs text-blue-500"
                          onClick={() => handleMaxClick(false)}
                          disabled={balanceLoading}
                        >
                          Max
                        </Button>
                      </div>
                      {safeParseUnits(token2Amount, 18) > BigInt(tokenBBalance || "0") && (
                        <p className="text-red-600 text-sm mt-1">Insufficient balance</p>
                      )}
                    </div>

                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="flex justify-between items-center text-sm text-gray-500">
                        <span>APY</span>
                        <span className="font-medium">{pool?.apy ? `${pool.apy}%` : "N/A"}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm mt-2 text-gray-500">
                        <span>Current pool ratio</span>
                        <span className="font-medium">
                          {pool && `1 ${pool._name?.split('/')[0]} = ${formatNumber(pool.aToBRatio)} ${pool._name?.split('/')[1]}`}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-sm mt-2 text-gray-500">
                        <span>Transaction fee</span>
                        <span>{DEPOSIT_FEE} USDST</span>
                      </div>
                    </div>

                    <Button 
                      disabled={
                        depositLoading || 
                        !token1Amount || 
                        (!singleTokenDeposit && !token2Amount) || 
                        safeParseUnits(token1Amount, 18) > BigInt(tokenABalance || "0") ||
                        (!singleTokenDeposit && safeParseUnits(token2Amount, 18) > BigInt(tokenBBalance || "0")) ||
                        BigInt(usdstBalance || "0") < safeParseUnits("0.3", 18)
                      } 
                      onClick={handleDepositSubmit}
                      className="w-full bg-strato-blue hover:bg-strato-blue/90"
                    >
                      {depositLoading ? (
                        <div className="flex justify-center items-center">
                          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white"></div>
                        </div>
                      ) : (
                        "Confirm Deposit"
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Withdraw Percentage Input */}
                    <div className="rounded-lg border p-3">
                      <span className="text-sm text-gray-500">Withdraw Percentage</span>
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="0"
                          className="flex-1 border-none text-xl font-medium p-0 h-auto focus-visible:ring-0"
                          value={withdrawPercent}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === '' || (/^\d*\.?\d*$/.test(value) && parseFloat(value) <= 100)) {
                              setWithdrawPercent(value);
                            }
                          }}
                        />
                        <span className="text-lg font-medium">%</span>
                      </div>
                      <div className="flex gap-2 mt-2">
                        {[25, 50, 75, 100].map((percent) => (
                          <Button
                            key={percent}
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => setWithdrawPercent(percent.toString())}
                          >
                            {percent}%
                          </Button>
                        ))}
                      </div>
                    </div>

                    {/* Single Token Withdraw Toggle */}
                    <div className="flex justify-end">
                      <TooltipProvider>
                        <UITooltip>
                          <TooltipTrigger asChild>
                            <div 
                              className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg cursor-pointer hover:bg-blue-100 transition-colors"
                              onClick={() => {
                                setSingleTokenWithdraw(!singleTokenWithdraw);
                                setWithdrawTokenChoice('tokenA');
                              }}>
                              {singleTokenWithdraw ? (
                                <ToggleRight className="h-4 w-4 text-strato-blue" />
                              ) : (
                                <ToggleLeft className="h-4 w-4 text-gray-500" />
                              )}
                              <span className="text-xs font-medium">
                                Single Token
                              </span>
                              <HelpCircle className="h-3 w-3 text-gray-400" />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p className="text-sm">
                              <strong>Single Token Withdrawal</strong>
                            </p>
                            <p className="text-xs mt-1">
                              Withdraw your liquidity as a single token type. The protocol will automatically swap your share of the other token at the current pool rate. This may result in slippage depending on the withdrawal size and pool liquidity.
                            </p>
                          </TooltipContent>
                        </UITooltip>
                      </TooltipProvider>
                    </div>

                    {/* Token Selection for Single Token Withdraw */}
                    {singleTokenWithdraw && (
                      <div className="rounded-lg border p-3 bg-blue-50">
                        <span className="text-sm text-gray-600 mb-2 block">Receive token as:</span>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            variant={withdrawTokenChoice === 'tokenA' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setWithdrawTokenChoice('tokenA')}
                            className={withdrawTokenChoice === 'tokenA' ? 'bg-strato-blue' : ''}
                          >
                            <div className="flex items-center gap-2">
                              {pool?.tokenA?.images?.[0]?.value ? (
                                <img
                                  src={pool.tokenA.images[0].value}
                                  alt={pool.tokenA.name}
                                  className="w-4 h-4 rounded-full"
                                />
                              ) : (
                                <div className="w-4 h-4 rounded-full flex items-center justify-center text-white text-xs font-medium bg-blue-500">
                                  {pool?.tokenA?.symbol?.slice(0, 2)}
                                </div>
                              )}
                              {pool?.tokenA?.symbol}
                            </div>
                          </Button>
                          <Button
                            type="button"
                            variant={withdrawTokenChoice === 'tokenB' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setWithdrawTokenChoice('tokenB')}
                            className={withdrawTokenChoice === 'tokenB' ? 'bg-strato-blue' : ''}
                          >
                            <div className="flex items-center gap-2">
                              {pool?.tokenB?.images?.[0]?.value ? (
                                <img
                                  src={pool.tokenB.images[0].value}
                                  alt={pool.tokenB.name}
                                  className="w-4 h-4 rounded-full"
                                />
                              ) : (
                                <div className="w-4 h-4 rounded-full flex items-center justify-center text-white text-xs font-medium bg-green-500">
                                  {pool?.tokenB?.symbol?.slice(0, 2)}
                                </div>
                              )}
                              {pool?.tokenB?.symbol}
                            </div>
                          </Button>
                        </div>
                      </div>
                    )}

                    {pool?.lpToken.balances?.[0] && (
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="flex justify-between items-center text-sm text-gray-500">
                          <span>Your LP Balance</span>
                          <span className="font-medium">{formatUnits(pool.lpToken.balances[0].balance, 18)} {pool.lpToken._symbol}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm mt-2 text-gray-500">
                          <span>Withdraw Amount</span>
                          <span className="font-medium">
                            {withdrawPercent ? formatUnits(
                              (BigInt(pool.lpToken.balances[0].balance) * BigInt(Math.round(parseFloat(withdrawPercent) * 100))) / BigInt(10000),
                              18
                            ) : '0'} {pool.lpToken._symbol}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-sm mt-2 text-gray-500">
                          <span>Transaction fee</span>
                          <span>{WITHDRAW_FEE} USDST</span>
                        </div>
                      </div>
                    )}

                    <Button 
                      disabled={
                        withdrawLoading || 
                        !withdrawPercent || 
                        parseFloat(withdrawPercent) <= 0 ||
                        !pool?.lpToken.balances?.[0] ||
                        BigInt(usdstBalance || "0") < safeParseUnits(WITHDRAW_FEE, 18)
                      } 
                      onClick={handleWithdrawSubmit}
                      className="w-full bg-strato-blue hover:bg-strato-blue/90"
                    >
                      {withdrawLoading ? (
                        <div className="flex justify-center items-center">
                          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white"></div>
                        </div>
                      ) : (
                        "Confirm Withdraw"
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
            
            {/* Right column with both cards */}
            <div className="flex flex-col gap-6">
              {/* Pool Composition */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Pool Composition</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-2 bg-gray-50 rounded-lg">
                      <div className="flex items-center">
                        {pool?.tokenA?.images?.[0]?.value ? (
                          <img
                            src={pool.tokenA.images[0].value}
                            alt={pool.tokenA.name}
                            className="w-6 h-6 rounded-full mr-2"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium mr-2 bg-blue-500">
                            {pool?.tokenA?.symbol?.slice(0, 2)}
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-sm">{pool?.tokenA?.symbol}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-sm">{formatBalance(pool?.tokenABalance || '0', undefined, 18, 1, 4)}</p>
                        <p className="text-xs text-gray-500">${formatBalance(pool?.tokenAPrice || '0', undefined, 18, 1, 2)}</p>
                      </div>
                    </div>

                    <div className="flex justify-between items-center p-2 bg-gray-50 rounded-lg">
                      <div className="flex items-center">
                        {pool?.tokenB?.images?.[0]?.value ? (
                          <img
                            src={pool.tokenB.images[0].value}
                            alt={pool.tokenB.name}
                            className="w-6 h-6 rounded-full mr-2"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium mr-2 bg-green-500">
                            {pool?.tokenB?.symbol?.slice(0, 2)}
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-sm">{pool?.tokenB?.symbol}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-sm">{formatBalance(pool?.tokenBBalance || '0', undefined, 18, 1, 4)}</p>
                        <p className="text-xs text-gray-500">${formatBalance(pool?.tokenBPrice || '0', undefined, 18, 1, 2)}</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Pool Information */}
              <Card className="h-full">
                <CardHeader className="pb-4">
                  <CardTitle className="text-base">Pool Information</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-4 text-sm">
                    <div className="flex justify-between py-1">
                      <span className="text-gray-500">LP Token</span>
                      <span className="font-medium">{pool?.lpToken._symbol}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-gray-500">Total Supply</span>
                      <span className="font-medium">{formatBalance(pool?.lpToken._totalSupply || '0', undefined, 18, 1, 6)}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-gray-500">LP Share %</span>
                      <span className="font-medium">{pool?.lpSharePercent}%</span>
                    </div>
                    
                    <div className="border-t pt-4">
                      <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Exchange Rates</p>
                      <div className="space-y-3">
                        <div className="flex justify-between py-1">
                          <span className="text-gray-500">1 {pool?._name?.split('/')[0]}</span>
                          <span className="font-medium">{formatBalance(pool?.aToBRatio || '0', undefined, 18, 1, 4)} {pool?._name?.split('/')[1]}</span>
                        </div>
                        <div className="flex justify-between py-1">
                          <span className="text-gray-500">1 {pool?._name?.split('/')[1]}</span>
                          <span className="font-medium">{formatBalance(pool?.bToARatio || '0', undefined, 18, 1, 4)} {pool?._name?.split('/')[0]}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="border-t pt-4">
                      <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Additional Info</p>
                      <div className="space-y-3">
                        <div className="flex justify-between py-1">
                          <span className="text-gray-500">Swap Fee</span>
                          <span className="font-medium">{pool?.swapFeeRate}%</span>
                        </div>
                        <div className="flex justify-between py-1">
                          <span className="text-gray-500">Pool Address</span>
                          <span className="font-mono text-xs">{pool?.address.slice(0, 6)}...{pool?.address.slice(-4)}</span>
                        </div>
                        {pool?.lpToken.balances?.[0] && (
                          <div className="flex justify-between py-1">
                            <span className="text-gray-500">Your LP Balance</span>
                            <span className="font-medium text-strato-blue">
                              {formatUnits(pool.lpToken.balances[0].balance, 18).slice(0, 8)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Liquidity Over Time</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={liquidityData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip formatter={(value: any) => `$${value.toLocaleString()}`} />
                    <Area type="monotone" dataKey="liquidity" stroke="#3B82F6" fill="#3B82F6" fillOpacity={0.2} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Volume (7 Days)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={volumeData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip formatter={(value: any) => `$${value.toLocaleString()}`} />
                    <Line type="monotone" dataKey="volume" stroke="#10B981" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

        </main>
      </div>

    </div>
  );
};

export default PoolDetail;