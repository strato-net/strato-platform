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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTokenContext } from '@/context/TokenContext';
import { useLendingContext } from '@/context/LendingContext';
import { Loader2, MoreVertical } from 'lucide-react';
import SetCollateralRatioModal from './SetCollateralRatioModal';
import SetInterestRateModal from './SetInterestRateModal';
import SetLiquidationBonusModal from './SetLiquidationBonusModal';

const TokenConfigTable = () => {
  const { activeTokens, loading, error, getActiveTokens } = useTokenContext();
  const { getLend } = useLendingContext();
  const [lendData, setLendData] = useState<any>(null);
  const [lendLoading, setLendLoading] = useState(false);
  const [collateralRatioModalOpen, setCollateralRatioModalOpen] = useState(false);
  const [interestRateModalOpen, setInterestRateModalOpen] = useState(false);
  const [liquidationBonusModalOpen, setLiquidationBonusModalOpen] = useState(false);
  const [selectedToken, setSelectedToken] = useState<{address: string; symbol: string; name: string} | null>(null);

  const fetchActiveTokens = useCallback(async () => {
    try {
      await getActiveTokens();
    } catch (error: any) {
      console.error('Error fetching active tokens:', error);
    }
  }, [getActiveTokens]);

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

  const refreshAllData = useCallback(async () => {
    try {
      // Small delay to prevent flickering
      await new Promise(resolve => setTimeout(resolve, 150));
      // Only refresh lending data since that's what contains the rates/ratios/bonuses
      await fetchLendData();
    } catch (error) {
      console.error('Error refreshing data:', error);
    }
  }, [fetchLendData]);

  useEffect(() => {
    fetchActiveTokens();
    fetchLendData();
  }, [fetchActiveTokens, fetchLendData]);

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

  if (loading || lendLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Token Configs</CardTitle>
          <CardDescription>
            Configure active tokens with collateral ratios, interest rates, and liquidation bonuses
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="ml-2">Loading active tokens...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Token Configs</CardTitle>
          <CardDescription>
            Configure active tokens with collateral ratios, interest rates, and liquidation bonuses
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-red-600">Error loading active tokens: {error}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Token Configs</CardTitle>
        <CardDescription>
          Configure active tokens with collateral ratios, interest rates, and liquidation bonuses
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <span className="text-sm text-gray-500">
            Showing {activeTokens?.length || 0} active tokens
          </span>
        </div>
        
        {(activeTokens?.length || 0) === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">No active tokens found</p>
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
                {(activeTokens || []).map((token, index) => {
                  const tokenData = token as any;
                  const name = tokenData.name || token._name || token.token?._name || token["BlockApps-Mercata-ERC20"]?._name || 'Unknown';
                  const symbol = tokenData.symbol || token._symbol || token.token?._symbol || token["BlockApps-Mercata-ERC20"]?._symbol || 'Unknown';
                  const address = tokenData.address || token.address || token.token?.address || token["BlockApps-Mercata-ERC20"]?.address || 'Unknown';

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
                        <Badge variant="default" className="text-xs">
                          ACTIVE
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
      
      <SetCollateralRatioModal
        open={collateralRatioModalOpen}
        onOpenChange={setCollateralRatioModalOpen}
        token={selectedToken}
        currentRatio={selectedToken ? getCollateralRatio(selectedToken.address) : undefined}
        onSuccess={refreshAllData}
      />
      
      <SetInterestRateModal
        open={interestRateModalOpen}
        onOpenChange={setInterestRateModalOpen}
        token={selectedToken}
        currentRate={selectedToken ? getInterestRate(selectedToken.address) : undefined}
        onSuccess={refreshAllData}
      />
      
      <SetLiquidationBonusModal
        open={liquidationBonusModalOpen}
        onOpenChange={setLiquidationBonusModalOpen}
        token={selectedToken}
        currentBonus={selectedToken ? getLiquidationBonus(selectedToken.address) : undefined}
        onSuccess={refreshAllData}
      />
    </Card>
  );
};

export default TokenConfigTable;