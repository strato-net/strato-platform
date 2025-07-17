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
import ConfigureAssetModal from './ConfigureAssetModal';
import { Token, LendingPoolResponse } from '@/interface';


const TokenConfigTable = () => {
  const { activeTokens, loading, error, getActiveTokens } = useTokenContext();
  const { getLend } = useLendingContext();
  const [lendData, setLendData] = useState<LendingPoolResponse | null>(null);
  const [lendLoading, setLendLoading] = useState(false);
  const [configureAssetModalOpen, setConfigureAssetModalOpen] = useState(false);
  const [selectedToken, setSelectedToken] = useState<{address: string; symbol: string; name: string} | null>(null);

  const fetchActiveTokens = useCallback(async () => {
    try {
      await getActiveTokens();
    } catch (error) {
      console.error('Error fetching active tokens:', error);
    }
  }, [getActiveTokens]);

  const fetchLendData = useCallback(async () => {
    try {
      setLendLoading(true);
      const data = await getLend();
      const responseData = data as unknown as LendingPoolResponse;
      if (responseData?.registry) {
        console.log('Registry data present:', responseData.registry);
      }
      if (responseData?.pool) {
        console.log('Pool data present:', responseData.pool);
      }
      setLendData(responseData);
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

  const getAssetConfig = (address: string) => {
    if (!lendData) {
      console.log('getAssetConfig: No lendData available');
      return null;
    }
    
    console.log(`Getting asset config for ${address}`);
    
    // Check if data is under 'pool' key (backend might return this)
    const poolData = lendData.pool || lendData.lendingPool;
    
    if (poolData?.assetConfigs) {
      // Handle array structure
      if (Array.isArray(poolData.assetConfigs)) {
        const config = poolData.assetConfigs.find(
          (item) => item.asset?.toLowerCase() === address.toLowerCase()
        );
        if (config) {
          console.log(`Found config for ${address}:`, config.AssetConfig);
          return config.AssetConfig;
        }
      }
      // Handle object/record structure
      else if (typeof poolData.assetConfigs === 'object') {
        const config = poolData.assetConfigs[address.toLowerCase()] || 
                      poolData.assetConfigs[address];
        if (config) {
          console.log(`Found config for ${address}:`, config);
          return config;
        }
      }
    }
    
    console.log(`No config found for ${address}`);
    return null;
  };

  const getCollateralRatio = (address: string) => {
    const assetConfig = getAssetConfig(address);
    if (!assetConfig?.ltv) return '-';
    // Convert from basis points to percentage
    const percentage = (parseInt(assetConfig.ltv) / 100).toFixed(1);
    return `${percentage}%`;
  };

  const getInterestRate = (address: string) => {
    const assetConfig = getAssetConfig(address);
    if (!assetConfig?.interestRate) return '-';
    // Convert from basis points to percentage
    const percentage = (parseInt(assetConfig.interestRate) / 100).toFixed(1);
    return `${percentage}%`;
  };

  const getLiquidationBonus = (address: string) => {
    const assetConfig = getAssetConfig(address);
    if (!assetConfig?.liquidationBonus) return '-';
    // Convert from basis points to percentage
    const percentage = (parseInt(assetConfig.liquidationBonus) / 100).toFixed(1);
    return `${percentage}%`;
  };

  const getLiquidationThreshold = (address: string) => {
    const assetConfig = getAssetConfig(address);
    if (!assetConfig?.liquidationThreshold) return '-';
    // Convert from basis points to percentage
    const percentage = (parseInt(assetConfig.liquidationThreshold) / 100).toFixed(1);
    return `${percentage}%`;
  };

  const getReserveFactor = (address: string) => {
    const assetConfig = getAssetConfig(address);
    if (!assetConfig?.reserveFactor) return '-';
    // Convert from basis points to percentage
    const percentage = (parseInt(assetConfig.reserveFactor) / 100).toFixed(1);
    return `${percentage}%`;
  };

  // Helper functions to get raw values for the modal (not formatted strings)
  const getRawCollateralRatio = (address: string) => {
    const assetConfig = getAssetConfig(address);
    if (!assetConfig?.ltv) return '';
    // Convert from basis points to percentage
    return (parseInt(assetConfig.ltv) / 100).toFixed(1);
  };

  const getRawInterestRate = (address: string) => {
    const assetConfig = getAssetConfig(address);
    if (!assetConfig?.interestRate) return '';
    // Convert from basis points to percentage
    return (parseInt(assetConfig.interestRate) / 100).toFixed(1);
  };

  const getRawLiquidationBonus = (address: string) => {
    const assetConfig = getAssetConfig(address);
    if (!assetConfig?.liquidationBonus) return '';
    // Convert from basis points to percentage
    return (parseInt(assetConfig.liquidationBonus) / 100).toFixed(1);
  };

  const getRawLiquidationThreshold = (address: string) => {
    const assetConfig = getAssetConfig(address);
    if (!assetConfig?.liquidationThreshold) return '';
    // Convert from basis points to percentage
    return (parseInt(assetConfig.liquidationThreshold) / 100).toFixed(1);
  };

  const getRawReserveFactor = (address: string) => {
    const assetConfig = getAssetConfig(address);
    if (!assetConfig?.reserveFactor) return '';
    // Convert from basis points to percentage
    return (parseInt(assetConfig.reserveFactor) / 100).toFixed(1);
  };

  const handleConfigureAsset = (token: {address: string; symbol: string; name: string}) => {
    setSelectedToken(token);
    setConfigureAssetModalOpen(true);
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
          Configure active tokens with comprehensive lending parameters including LTV, liquidation thresholds, bonuses, interest rates, and reserve factors
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
                  <TableHead className="w-[80px]">Symbol</TableHead>
                  <TableHead className="w-[150px]">Name</TableHead>
                  <TableHead className="w-[120px]">Address</TableHead>
                  <TableHead className="w-[70px]">Status</TableHead>
                  <TableHead className="w-[90px]">LTV</TableHead>
                  <TableHead className="w-[110px]">Liq. Threshold</TableHead>
                  <TableHead className="w-[100px]">Liq. Bonus</TableHead>
                  <TableHead className="w-[80px]">Interest</TableHead>
                  <TableHead className="w-[90px]">Reserve</TableHead>
                  <TableHead className="w-[60px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(activeTokens || []).map((token, index) => {
                  const tokenData = token as Token;
                  const name = tokenData.name || token._name || token.token?._name || token["BlockApps-Mercata-ERC20"]?._name || 'Unknown';
                  const symbol = tokenData.symbol || token._symbol || token.token?._symbol || token["BlockApps-Mercata-ERC20"]?._symbol || 'Unknown';
                  const address = tokenData.address || token.address || token.token?.address || token["BlockApps-Mercata-ERC20"]?.address || 'Unknown';

                  return (
                    <TableRow key={`${address}-${index}`}>
                      <TableCell className="font-medium text-sm max-w-[80px] truncate">{symbol}</TableCell>
                      <TableCell className="text-sm max-w-[150px] truncate" title={name}>{name}</TableCell>
                      <TableCell className="font-mono text-xs max-w-[120px]">
                        {address && address !== 'Unknown' 
                          ? `${address.slice(0, 6)}...${address.slice(-4)}`
                          : address
                        }
                      </TableCell>
                      <TableCell className="max-w-[70px]">
                        <Badge variant="default" className="text-xs">
                          ACTIVE
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm max-w-[90px]">
                        {getCollateralRatio(address)}
                      </TableCell>
                      <TableCell className="text-sm max-w-[110px]">
                        {getLiquidationThreshold(address)}
                      </TableCell>
                      <TableCell className="text-sm max-w-[100px]">
                        {getLiquidationBonus(address)}
                      </TableCell>
                      <TableCell className="text-sm max-w-[80px]">
                        {getInterestRate(address)}
                      </TableCell>
                      <TableCell className="text-sm max-w-[90px]">
                        {getReserveFactor(address)}
                      </TableCell>
                      <TableCell className="max-w-[60px]">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleConfigureAsset({address, symbol, name})}>
                              Configure Asset
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
      
      <ConfigureAssetModal
        open={configureAssetModalOpen}
        onOpenChange={setConfigureAssetModalOpen}
        token={selectedToken}
        currentConfig={selectedToken ? {
          ltv: getRawCollateralRatio(selectedToken.address),
          liquidationThreshold: getRawLiquidationThreshold(selectedToken.address),
          liquidationBonus: getRawLiquidationBonus(selectedToken.address),
          interestRate: getRawInterestRate(selectedToken.address),
          reserveFactor: getRawReserveFactor(selectedToken.address),
        } : undefined}
        onSuccess={refreshAllData}
      />
    </Card>
  );
};

export default TokenConfigTable;