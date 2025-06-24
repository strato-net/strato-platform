import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTokenContext } from '@/context/TokenContext';
import { useLendingContext } from '@/context/LendingContext';
import { Loader2, Filter, MoreVertical } from 'lucide-react';
import SetTokenStatusModal from './SetTokenStatusForm';
import SetCollateralRatioModal from './SetCollateralRatioModal';
import SetInterestRateModal from './SetInterestRateModal';
import SetLiquidationBonusModal from './SetLiquidationBonusModal';

const getStatusLabel = (status?: string | number) => {
  switch (String(status)) {
    case "1":
      return { label: 'PENDING', variant: 'secondary' as const };
    case "2":
      return { label: 'ACTIVE', variant: 'default' as const };
    case "3":
      return { label: 'LEGACY', variant: 'outline' as const };
    default:
      return { label: 'UNKNOWN', variant: 'destructive' as const };
  }
};

const AllTokensTable = () => {
  const { tokens, loading, error, getAllTokens } = useTokenContext();
  const { getLend } = useLendingContext();
  const [statusFilter, setStatusFilter] = useState<string>('2');
  const [lendData, setLendData] = useState<any>(null);
  const [lendLoading, setLendLoading] = useState(false);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [collateralRatioModalOpen, setCollateralRatioModalOpen] = useState(false);
  const [interestRateModalOpen, setInterestRateModalOpen] = useState(false);
  const [liquidationBonusModalOpen, setLiquidationBonusModalOpen] = useState(false);
  const [selectedToken, setSelectedToken] = useState<{address: string; symbol: string; name: string} | null>(null);

  const fetchLendData = useCallback(async () => {
    try {
      setLendLoading(true);
      const data = await getLend();
      setLendData(data);
    } catch (error) {
      console.error('Error fetching lend data:', error);
    } finally {
      setLendLoading(false);
    }
  }, [getLend]);

  useEffect(() => {
    getAllTokens();
    fetchLendData();
  }, [getAllTokens, fetchLendData]);

  const getCollateralRatio = (address: string) => {
    if (!lendData?.lendingPool?.collateralRatio) return '-';
    const collateralData = lendData.lendingPool.collateralRatio.find(
      (item: any) => item.asset.toLowerCase() === address.toLowerCase()
    );
    return collateralData ? `${collateralData.ratio}%` : '-';
  };

  const getInterestRate = (address: string) => {
    if (!lendData?.lendingPool?.interestRate) return '-';
    const interestData = lendData.lendingPool.interestRate.find(
      (item: any) => item.asset.toLowerCase() === address.toLowerCase()
    );
    return interestData ? `${interestData.rate}%` : '-';
  };

  const getLiquidationBonus = (address: string) => {
    if (!lendData?.lendingPool?.liquidationBonus) return '-';
    const bonusData = lendData.lendingPool.liquidationBonus.find(
      (item: any) => item.asset.toLowerCase() === address.toLowerCase()
    );
    return bonusData ? `${bonusData.bonus}%` : '-';
  };

  const handleSetTokenStatus = (token: {address: string; symbol: string; name: string}) => {
    setSelectedToken(token);
    setStatusModalOpen(true);
  };

  const handleSetCollateralRatio = (token: {address: string; symbol: string; name: string}) => {
    setSelectedToken(token);
    setCollateralRatioModalOpen(true);
  };

  const handleSetInterestRate = (token: {address: string; symbol: string; name: string}) => {
    setSelectedToken(token);
    setInterestRateModalOpen(true);
  };

  const handleSetLiquidationBonus = (token: {address: string; symbol: string; name: string}) => {
    setSelectedToken(token);
    setLiquidationBonusModalOpen(true);
  };

  const filteredTokens = tokens.filter(token => {
    if (statusFilter === 'all') return true;
    const tokenData = token as any;
    const tokenStatus = String(tokenData.status || '');
    if (statusFilter === 'unknown') {
      return !tokenStatus || !['1', '2', '3'].includes(tokenStatus);
    }
    return tokenStatus === statusFilter;
  });

  console.log('Rendering AllTokensTable', tokens);

  if (loading || lendLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>All Tokens</CardTitle>
          <CardDescription>
            View all tokens with their name, symbol, address, and status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="ml-2">Loading tokens...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>All Tokens</CardTitle>
          <CardDescription>
            View all tokens with their name, symbol, address, and status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-red-600">Error loading tokens: {error}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>All Tokens</CardTitle>
        <CardDescription>
          View all tokens with their name, symbol, address, and status
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center gap-2">
          <Filter className="h-4 w-4" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="1">PENDING</SelectItem>
              <SelectItem value="2">ACTIVE</SelectItem>
              <SelectItem value="3">LEGACY</SelectItem>
              <SelectItem value="unknown">UNKNOWN</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-gray-500">
            Showing {filteredTokens.length} of {tokens.length} tokens
          </span>
        </div>
        
        {filteredTokens.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">
              {tokens.length === 0 ? "No tokens found" : `No tokens with ${statusFilter === 'all' ? 'any' : getStatusLabel(statusFilter).label} status`}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Symbol</TableHead>
                  <TableHead className="w-[200px]">Name</TableHead>
                  <TableHead className="w-[140px]">Address</TableHead>
                  <TableHead className="w-[80px]">Status</TableHead>
                  <TableHead className="w-[120px]">Collateral Ratio</TableHead>
                  <TableHead className="w-[100px]">Interest</TableHead>
                  <TableHead className="w-[120px]">Liquidation Bonus</TableHead>
                  <TableHead className="w-[60px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTokens.map((token, index) => {
                  const tokenData = token as any;
                  const name = tokenData.name || token._name || token.token?._name || token["BlockApps-Mercata-ERC20"]?._name || 'Unknown';
                  const symbol = tokenData.symbol || token._symbol || token.token?._symbol || token["BlockApps-Mercata-ERC20"]?._symbol || 'Unknown';
                  const address = tokenData.address || token.address || token.token?.address || token["BlockApps-Mercata-ERC20"]?.address || 'Unknown';
                  const status = getStatusLabel(tokenData.status);

                  return (
                    <TableRow key={`${address}-${index}`}>
                      <TableCell className="font-medium text-sm max-w-[100px] truncate">{symbol}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate" title={name}>{name}</TableCell>
                      <TableCell className="font-mono text-xs max-w-[140px]">
                        {address && address !== 'Unknown' 
                          ? `${address.slice(0, 6)}...${address.slice(-4)}`
                          : address
                        }
                      </TableCell>
                      <TableCell className="max-w-[80px]">
                        <Badge variant={status.variant} className="text-xs">
                          {status.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm max-w-[120px]">
                        {getCollateralRatio(address)}
                      </TableCell>
                      <TableCell className="text-sm max-w-[100px]">
                        {getInterestRate(address)}
                      </TableCell>
                      <TableCell className="text-sm max-w-[120px]">
                        {getLiquidationBonus(address)}
                      </TableCell>
                      <TableCell className="max-w-[60px]">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleSetTokenStatus({address, symbol, name})}>
                              Set Token Status
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleSetInterestRate({address, symbol, name})}>
                              Set Interest Rate
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleSetCollateralRatio({address, symbol, name})}>
                              Set Collateral Ratio
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleSetLiquidationBonus({address, symbol, name})}>
                              Set Liquidation Bonus
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      
      <SetTokenStatusModal
        open={statusModalOpen}
        onOpenChange={setStatusModalOpen}
        token={selectedToken}
      />
      
      <SetCollateralRatioModal
        open={collateralRatioModalOpen}
        onOpenChange={setCollateralRatioModalOpen}
        token={selectedToken}
        currentRatio={selectedToken ? getCollateralRatio(selectedToken.address) : undefined}
      />
      
      <SetInterestRateModal
        open={interestRateModalOpen}
        onOpenChange={setInterestRateModalOpen}
        token={selectedToken}
        currentRate={selectedToken ? getInterestRate(selectedToken.address) : undefined}
      />
      
      <SetLiquidationBonusModal
        open={liquidationBonusModalOpen}
        onOpenChange={setLiquidationBonusModalOpen}
        token={selectedToken}
        currentBonus={selectedToken ? getLiquidationBonus(selectedToken.address) : undefined}
      />
    </Card>
  );
};

export default AllTokensTable;