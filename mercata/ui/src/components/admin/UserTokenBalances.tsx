import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Search, Loader2, Wallet } from 'lucide-react';
import { api } from '@/lib/axios';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatUnits } from 'ethers';

interface TokenBalance {
  address: string;
  user: string;
  balance: string;
  collateralBalance: string;
  price: string;
  token: {
    _name: string;
    _symbol: string;
    customDecimals: number;
    status: number;
    _paused: boolean;
  };
}

const UserTokenBalances = () => {
  const [userAddress, setUserAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [searched, setSearched] = useState(false);
  const { toast } = useToast();

  const handleLookup = async () => {
    if (!userAddress.trim()) {
      toast({
        title: 'Invalid Input',
        description: 'Please enter a valid user address',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    setSearched(true);
    try {
      const response = await api.get<TokenBalance[]>('/tokens/admin/balance', {
        params: { address: userAddress.trim() }
      });

      setBalances(response.data || []);

      if (!response.data || response.data.length === 0) {
        toast({
          title: 'No Tokens Found',
          description: `No token balances found for address ${userAddress.substring(0, 10)}...`,
        });
      }
    } catch (error: any) {
      toast({
        title: 'Lookup Failed',
        description: error.response?.data?.error || 'Failed to fetch token balances',
        variant: 'destructive',
      });
      setBalances([]);
    } finally {
      setLoading(false);
    }
  };

  const formatBalance = (balance: string, decimals: number) => {
    try {
      return parseFloat(formatUnits(balance, decimals)).toLocaleString(undefined, {
        maximumFractionDigits: 6
      });
    } catch {
      return '0';
    }
  };

  const calculateValue = (balance: string, price: string, decimals: number) => {
    try {
      const balanceFloat = parseFloat(formatUnits(balance, decimals));
      // Price is stored with 18 decimals in the oracle
      const priceFloat = parseFloat(formatUnits(price, 18));
      const value = balanceFloat * priceFloat;
      return '$' + value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    } catch {
      return '$0.00';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Wallet className="h-5 w-5" />
          <span>User Token Balances Lookup</span>
        </CardTitle>
        <CardDescription>
          View all token balances for any user address
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <Label htmlFor="userAddress">User Address</Label>
            <Input
              id="userAddress"
              placeholder="0x..."
              value={userAddress}
              onChange={(e) => setUserAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
              className="font-mono"
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={handleLookup}
              disabled={loading || !userAddress.trim()}
              className="w-full sm:w-auto"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Searching...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Lookup
                </>
              )}
            </Button>
          </div>
        </div>

        {searched && !loading && (
          <div className="space-y-4">
            {balances.length > 0 ? (
              <>
                <div className="text-sm text-gray-600">
                  Found {balances.length} token{balances.length !== 1 ? 's' : ''} for{' '}
                  <span className="font-mono font-semibold">{userAddress}</span>
                </div>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Token</TableHead>
                        <TableHead>Symbol</TableHead>
                        <TableHead className="text-right">Wallet Balance</TableHead>
                        <TableHead className="text-right">Collateral Balance</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-right">Total Value</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {balances.map((tokenBalance) => {
                        const totalBalance = BigInt(tokenBalance.balance) + BigInt(tokenBalance.collateralBalance);
                        const totalBalanceStr = totalBalance.toString();

                        return (
                          <TableRow key={tokenBalance.address}>
                            <TableCell className="font-medium">
                              {tokenBalance.token?._name || 'Unknown'}
                            </TableCell>
                            <TableCell className="font-mono">
                              {tokenBalance.token?._symbol || 'N/A'}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatBalance(tokenBalance.balance, tokenBalance.token?.customDecimals || 18)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatBalance(tokenBalance.collateralBalance, tokenBalance.token?.customDecimals || 18)}
                            </TableCell>
                            <TableCell className="text-right">
                              ${parseFloat(formatUnits(tokenBalance.price, 18)).toFixed(4)}
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              {calculateValue(totalBalanceStr, tokenBalance.price, tokenBalance.token?.customDecimals || 18)}
                            </TableCell>
                            <TableCell>
                              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                tokenBalance.token?._paused
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-green-100 text-green-800'
                              }`}>
                                {tokenBalance.token?._paused ? 'Paused' : 'Active'}
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <Wallet className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p>No token balances found for this address</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default UserTokenBalances;
