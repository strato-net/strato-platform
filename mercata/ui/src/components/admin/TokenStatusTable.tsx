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
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTokenContext } from '@/context/TokenContext';
import { Loader2, Filter, Search, RefreshCw } from 'lucide-react';
import SetTokenStatusModal from './SetTokenStatusForm';

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

const TokenStatusTable = () => {
  const { tokens, loading, error, getAllTokens } = useTokenContext();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [selectedToken, setSelectedToken] = useState<{address: string; symbol: string; name: string} | null>(null);

  const refreshAllData = useCallback(async () => {
    try {
      await getAllTokens();
    } catch (error) {
      console.error('Error refreshing data:', error);
    }
  }, [getAllTokens]);

  useEffect(() => {
    getAllTokens();
  }, [getAllTokens]);

  const handleSetTokenStatus = (token: {address: string; symbol: string; name: string}) => {
    setSelectedToken(token);
    setStatusModalOpen(true);
  };

  const filteredTokens = tokens.filter(token => {
    const tokenData = token as any;
    const name = tokenData.name || token._name || token.token?._name || token["BlockApps-Mercata-ERC20"]?._name || 'Unknown';
    const symbol = tokenData.symbol || token._symbol || token.token?._symbol || token["BlockApps-Mercata-ERC20"]?._symbol || 'Unknown';
    const address = tokenData.address || token.address || token.token?.address || token["BlockApps-Mercata-ERC20"]?.address || 'Unknown';
    
    // Filter by search query (name, symbol, or address)
    const matchesSearch = searchQuery === '' || 
      name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      address.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (!matchesSearch) return false;
    
    // Filter by status
    if (statusFilter === 'all') return true;
    const tokenStatus = String(tokenData.status || '');
    if (statusFilter === 'unknown') {
      return !tokenStatus || !['1', '2', '3'].includes(tokenStatus);
    }
    return tokenStatus === statusFilter;
  });

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Token Status</CardTitle>
          <CardDescription>
            Manage token status and configurations for all tokens
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
          <CardTitle>Token Status</CardTitle>
          <CardDescription>
            Manage token status and configurations for all tokens
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-red-600">Error loading tokens: {error}</p>
            <Button 
              variant="outline" 
              onClick={refreshAllData}
              className="mt-4"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Token Status</CardTitle>
        <CardDescription>
          Manage token status and configurations for all tokens
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-6 space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search by name, symbol, or address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex items-center gap-2">
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
            </div>
            <Button variant="outline" onClick={refreshAllData}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
          <div className="text-sm text-gray-500">
            Showing {filteredTokens.length} of {tokens.length} tokens
            {searchQuery && ` matching "${searchQuery}"`}
            {statusFilter !== 'all' && ` with ${getStatusLabel(statusFilter).label} status`}
          </div>
        </div>
        
        {filteredTokens.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">
              {tokens.length === 0 
                ? "No tokens found" 
                : searchQuery 
                  ? `No tokens found matching "${searchQuery}"` 
                  : `No tokens with ${statusFilter === 'all' ? 'any' : getStatusLabel(statusFilter).label} status`
              }
            </p>
            {(searchQuery || statusFilter !== 'all') && (
              <Button 
                variant="ghost" 
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('all');
                }}
                className="mt-2"
              >
                Clear filters
              </Button>
            )}
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
                      <TableCell className="max-w-[60px]">
                        <Button 
                          size="sm" 
                          onClick={() => handleSetTokenStatus({address, symbol, name})}
                          className="bg-strato-blue hover:bg-strato-blue/90 text-xs"
                        >
                          Set Status
                        </Button>
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
    </Card>
  );
};

export default TokenStatusTable;