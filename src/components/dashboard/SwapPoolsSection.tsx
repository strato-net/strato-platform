
import { useEffect, useState } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BanknoteIcon, CircleArrowDown, Search } from "lucide-react";
import { api } from '@/lib/axios';
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { useUserTokens } from '@/context/UserTokensContext';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/context/UserContext';
import { formatUnits, parseUnits } from 'ethers';

interface SwapPool {
  id: string;
  name: string;
  token1: string;
  token2: string;
  liquidity: string;
  volume24h: string;
  apy: string;
  token1Color: string;
  token2Color: string;
  token1Logo: string;
  token2Logo: string;
}

interface DepositFormValues {
  amount: string;
  token: string;
}

const SwapPoolsSection = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPool, setSelectedPool] = useState<any | null>(null);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [token1Amount, setToken1Amount] = useState<any>('');
  const [token2Amount, setToken2Amount] = useState<any>('');
  const [withdrawPercent, setWithdrawPercent] = useState();
  const [withdrawLoading, setWithdrawLoading] = useState(false)
  const [pools, setPools] = useState<any>()
  const [loading, setLoading] = useState(false)
  const [depositLoading, setDepositLoading] = useState(false)
  const { tokens } = useUserTokens()
  const { toast } = useToast()
  const { userAddress } = useUser()
  const [tokenABalance, setTokenABalance] = useState('')
  const [tokenBBalance, setTokenBBalance] = useState('')

  const form = useForm<DepositFormValues>({
    defaultValues: {
      amount: '',
      token: 'token1'
    },
  });

  useEffect(() => {
  }, [pools, tokenABalance, tokenBBalance])

  console.log(tokenABalance, tokenBBalance, 'balance');


  useEffect(() => {
    const fetchUserPools = async () => {
      try {
        setLoading(true)
        const res = await api.get(`/lpToken/`);
        const tempPools = res.data;
        const enrichedPools = tempPools.map(
          (pool: { data: { tokenA: string; tokenB: string } }) => {
            const tokenAInfo =
              tokens && tokens.find((t) => t.address === pool.data.tokenA);
            const tokenBInfo =
              tokens && tokens.find((t) => t.address === pool.data.tokenB);

            return {
              ...pool,
              _name: `${tokenAInfo?.['BlockApps-Mercata-ERC20']?._name}/${tokenBInfo?.['BlockApps-Mercata-ERC20']?._name}`,
              _symbol: `${tokenAInfo?.['BlockApps-Mercata-ERC20']?._symbol}/${tokenBInfo?.['BlockApps-Mercata-ERC20']?._symbol}`,
            };
          }
        );
        setPools(enrichedPools);
        setLoading(false)
      } catch (err) {
        console.error(err);
        setLoading(false)
      }
    };
    fetchUserPools();
  }, [tokens]);

  const handleOpenDepositModal = async (pool: any) => {
    setSelectedPool(pool);
    setIsDepositModalOpen(true);
    console.log(pool, "data");

    try {
      getTokenBalance(pool?.data?.tokenA, true)
      getTokenBalance(pool?.data?.tokenB)
    } catch (error) {
      console.error("Failed to fetch token ratios", error);
    }

    setToken1Amount('');
    setToken2Amount('');
  };

  const handleOpenWithdrawModal = async (pool: any) => {
    setSelectedPool(pool);
    setIsWithdrawModalOpen(true)
  }

  const handleCloseWithdrawModal = () => {
    setIsWithdrawModalOpen(false)
    setSelectedPool(null);
  };

  const handleCloseDepositModal = () => {
    setIsDepositModalOpen(false);
    setSelectedPool(null);
  };

  const handleDepositSubmit = async (values: DepositFormValues) => {
    if (!selectedPool) return;

    try {
      setDepositLoading(true)
      const maxTokenAAmount = parseUnits(
        (parseFloat(token1Amount) * 1.01).toFixed(18),
        18
      );
      const tokenBAmount = parseUnits(token2Amount, 18);

      const response = await api.post("/swap/addLiquidity", {
        address: selectedPool.address,
        max_tokenA_amount: maxTokenAAmount.toString(),
        tokenB_amount: tokenBAmount.toString(),
      });
      console.log(response, "add liquidity response");

      setDepositLoading(false)
      handleCloseDepositModal();
      toast({
        title: "Success",
        description: `${selectedPool?._name} deposited successfully.`,
        variant: "success",
      });
    } catch (error) {
      setDepositLoading(false)
      console.error("Deposit failed:", error);
      toast({
        title: "Error",
        description: `Something went wrong - ${error}`,
        variant: "destructive",
      });
      // You might want to show a toast or alert here
    }
  };


  const handleWithdrawSubmit = async () => {
    try {
      setWithdrawLoading(true)
      const value = BigInt(selectedPool?.value || "0");
      const percent = parseFloat(withdrawPercent ? withdrawPercent : "0");

      const percentScaled = BigInt(Math.round(percent * 100));
      const calculatedAmount = (value * percentScaled) / BigInt(10000); // using 10000 for 2 decimal precision

      const response = await api.post("/swap/removeLiquidity", {
        address: selectedPool.address,
        amount: calculatedAmount.toString(), // convert BigInt to string for API
      });
      console.log(response, "res>>");
      setWithdrawLoading(false)
      handleCloseWithdrawModal()
      toast({
        title: "Success",
        description: `${calculatedAmount.toString() + " " + selectedPool?._name} withdraw successfully.`,
        variant: "success",
      });
    } catch (error) {
      console.log(error);
      setWithdrawLoading(false)
      toast({
        title: "Error",
        description: `Something went wrong - ${error}`,
        variant: "destructive",
      });
    }
  }

  const getTokenBalance = async (
    address: string,
    firstToken: boolean = false,
  ) => {
    console.log(address, userAddress, "address");

    try {
      const res = await api.get(
        `/tokens/table/balance?key=eq.${userAddress}&address=eq.${address}`,
      );
      console.log(res?.data[0]?.value, "token response");
      if (firstToken) {
        setTokenABalance(res?.data[0]?.value || 0);
      } else {
        setTokenBBalance(res?.data[0]?.value || 0);
      }
    } catch (err) {
      console.log(err);
    }
  };

  const handleMaxClick = (firstToken: boolean = false, pool: any) => {
    if (firstToken) {
      const maxVal = formatUnits(tokenABalance || "0", 18); // converts wei to ETH string
      setToken1Amount(maxVal);
      handleInputChange(maxVal, 'token1');
    } else {
      const maxVal = formatUnits(tokenBBalance || "0", 18);
      setToken2Amount(maxVal);
      handleInputChange(maxVal, 'token2');
    }
  };

  const handleInputChange = (
    value: string,
    token: 'token1' | 'token2'
  ) => {
    const floatVal = parseFloat(value);

    if (token === 'token1') {
      setToken1Amount(value);
      if (!isNaN(floatVal) && selectedPool?.data?.aToBRatio) {
        setToken2Amount((floatVal * selectedPool.data.aToBRatio).toString());
      } else {
        setToken2Amount('');
      }
    }

    if (token === 'token2') {
      setToken2Amount(value);
      if (!isNaN(floatVal) && selectedPool?.data?.bToARatio) {
        setToken1Amount((floatVal * selectedPool.data.bToARatio).toString());
      } else {
        setToken1Amount('');
      }
    }
  };

  return (
    <div>
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search pairs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {loading ?
          <div className="flex justify-center items-center h-12">
            <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
          </div>
          : !pools ?
            <div className="flex justify-center items-center h-12">
              <div>No data to show</div>
            </div>
            : pools.map((pool, id) => (
              <Card key={id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <div className="flex items-center -space-x-2 mr-3">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-medium z-10 border-2 border-white"
                          style={{ backgroundColor: "red" }}
                        >
                          {pool?._name?.slice(0, 2)}
                        </div>
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-medium"
                          style={{ backgroundColor: "red" }}
                        >
                          {pool?._name?.split('/')[1].slice(0, 2)}
                        </div>
                      </div>
                      <div>
                        <h3 className="font-medium">{pool?._name}</h3>
                        <div className="flex items-center text-xs text-gray-500 mt-1">
                          <span>Liquidity: {pool?._totalSupply}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-4">
                      <div className="text-right">
                        <span className="bg-green-100 text-green-700 text-sm px-2 py-1 rounded-md font-medium">
                          APY: {pool?._totalSupply || ""}
                        </span>
                      </div>
                      <div className="flex space-x-2">
                        <Button
                          size="sm"
                          className="bg-strato-purple hover:bg-strato-purple/90"
                          onClick={() => handleOpenDepositModal(pool)}
                        >
                          <CircleArrowDown className="mr-1 h-4 w-4" />
                          Deposit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-strato-purple text-strato-purple hover:bg-strato-purple/10"
                          onClick={() => handleOpenWithdrawModal(pool)}
                        >
                          <BanknoteIcon className="mr-1 h-4 w-4" />
                          Withdraw
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
      </div>

      {/* Deposit Modal */}
      <Dialog open={isDepositModalOpen} onOpenChange={setIsDepositModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deposit Liquidity</DialogTitle>
            <DialogDescription>
              Add liquidity to the {selectedPool?._name} pool to earn {selectedPool?.apy} APY.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(handleDepositSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
              {/* First Token */}
              <div className="rounded-lg border p-2">
                <div className="flex justify-between mb-2">
                </div>
                <span className="text-sm text-gray-500">Amount</span>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="0.0"
                    className="border-none text-xl font-medium p-0 h-auto focus-visible:ring-0"
                    value={token1Amount}
                    onChange={(e) => handleInputChange(e.target.value, 'token1')}
                  />
                  <div className="flex items-center space-x-2 bg-gray-100 rounded-md px-2 py-1">
                    {selectedPool && (
                      <>
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-medium"
                          style={{ backgroundColor: "red" }}
                        >
                          {selectedPool?._name?.split('/')[0]?.slice(0, 2)}
                        </div>
                        <span className="font-medium">{selectedPool?._name?.split('/')[0]}</span>
                      </>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-sm text-gray-500">
                    Balance: {formatUnits(tokenABalance || 0, 18)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs text-gray-500 mt-1"
                    onClick={() => handleMaxClick(true, selectedPool)}
                  >
                    Max
                  </Button>
                </div>
              </div>

              {/* Second Token */}
              <div className="rounded-lg border p-3">
                <div className="flex justify-between mb-2">
                  <span className="text-sm text-gray-500">Amount</span>
                </div>
                <div className="flex items-center">
                  <Input
                    placeholder="0.0"
                    className="border-none text-xl font-medium p-0 h-auto focus-visible:ring-0"
                    value={token2Amount}
                    onChange={(e) => handleInputChange(e.target.value, 'token2')}
                  />
                  <div className="flex items-center space-x-2 bg-gray-100 rounded-md px-2 py-1">
                    {selectedPool && (
                      <>
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-medium"
                          style={{ backgroundColor: "red" }}
                        >
                          {selectedPool?._name?.split('/')[1]?.slice(0, 2)}
                        </div>
                        <span className="font-medium">{selectedPool?._name?.split('/')[1]}</span>
                      </>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-sm text-gray-500">
                    Balance: {formatUnits(tokenBBalance || 0, 18)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs text-gray-500 mt-1"
                    onClick={() => handleMaxClick(false, selectedPool)}
                  >
                    Max
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-gray-50 p-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Exchange rate</span>
                <span className="font-medium">
                  {selectedPool && `1 ${selectedPool?._name?.split('/')[0]} = ${selectedPool?.data?.aToBRatio} ${selectedPool?._name?.split('/')[1]}`}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm mt-1">
                <span className="text-gray-500">Share of pool</span>
                <span className="font-medium">0.00%</span>
              </div>
            </div>

            <div className="pt-2">
              <Button disabled={depositLoading} type="submit" className="w-full bg-strato-purple hover:bg-strato-purple/90">
                {depositLoading && <div className="flex justify-center items-center h-12">
                  <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                </div>}
                Confirm Deposit
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Withdraw Modal */}
      <Dialog open={isWithdrawModalOpen} onOpenChange={setIsWithdrawModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw Liquidity</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(handleWithdrawSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
              {/* First Token */}
              <div className="rounded-lg border p-3">
                <div className="flex justify-between mb-2">
                  <span className="text-sm text-gray-500">Percent</span>
                </div>
                <div className="flex items-center">
                  <Input
                    placeholder="0.0"
                    className="border-none text-xl font-medium p-0 pl-2 h-auto focus-visible:ring-0"
                    value={withdrawPercent}
                    onChange={(e) => {
                      const value = e.target.value;
                      const percentRegex = /^(100|[0-9]{1,2})(\.[0-9]{0,2})?$/;

                      if (value === '' || percentRegex.test(value)) {
                        setWithdrawPercent(value);
                      }
                    }}
                  />
                  <div className="flex items-center space-x-2 bg-gray-100 rounded-md px-2 py-1">
                    {selectedPool && (
                      <>
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-medium"
                          style={{ backgroundColor: "red" }}
                        >
                          {selectedPool?._symbol?.slice(0, 2)}
                        </div>
                        <span className="font-medium">{selectedPool?._symbol}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-gray-50 p-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">{selectedPool?._name.split('/')[0]} position</span>
                <span className="font-medium">
                  {(Number((BigInt(selectedPool?.value || "0") * BigInt(selectedPool?.data?.tokenABalance || "0")) / BigInt(selectedPool?._totalSupply || "1")) / 1e18).toFixed(10)}

                </span>
              </div>
              <div className="flex justify-between items-center text-sm mt-1">
                <span className="text-gray-500">{selectedPool?._name.split('/')[1]} position</span>
                <span className="font-medium">
                  {(Number((BigInt(selectedPool?.value || "0") * BigInt(selectedPool?.data?.tokenBBalance || "0")) / BigInt(selectedPool?._totalSupply || "1")) / 1e18).toFixed(10)}
                </span>
              </div>
              {selectedPool && withdrawPercent && (
                <div className="w-full flex justify-between">
                  <span className='text-gray-500'>
                    New {selectedPool?._name?.split("/")[0]} position
                  </span>
                  <span>
                    {(
                      Number(
                        (
                          (BigInt(selectedPool?.value || "0") *
                            BigInt(selectedPool?.data?.tokenABalance || "0") *
                            (BigInt(10000) - BigInt((withdrawPercent * 100 || 0)))) /
                          (BigInt(selectedPool?._totalSupply || "1") * BigInt(10000))
                        )
                      ) / 1e18
                    ).toFixed(10)}
                  </span>
                </div>
              )}
              {selectedPool && withdrawPercent && (
                <div className="w-full flex justify-between">
                  <span className='text-gray-500'>
                    New {selectedPool?._name?.split("/")[1]} position
                  </span>
                  <span>
                    {(
                      Number(
                        (
                          (BigInt(selectedPool?.value || "0") *
                            BigInt(selectedPool?.data?.tokenBBalance || "0") *
                            (BigInt(10000) - BigInt((withdrawPercent || 0) * 100))) /
                          (BigInt(selectedPool?._totalSupply || "1") * BigInt(10000))
                        )
                      ) / 1e18
                    ).toFixed(10)}
                  </span>
                </div>
              )}
            </div>

            <div className="pt-2">
              <Button disabled={withdrawLoading} type="submit" className="w-full bg-strato-purple hover:bg-strato-purple/90">
                {withdrawLoading && <div className="flex justify-center items-center h-12">
                  <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                </div>}
                Confirm Withdraw
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SwapPoolsSection;
