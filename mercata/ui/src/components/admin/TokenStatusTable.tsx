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
import { Token } from '@/interface';
import CopyButton from '../ui/copy';

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
    const tokenData = token as Token;
    const name = tokenData.name || token._name || token.token?._name || token["BlockApps-ERC20"]?._name || 'Unknown';
    const symbol = tokenData.symbol || token._symbol || token.token?._symbol || token["BlockApps-ERC20"]?._symbol || 'Unknown';
    const address = tokenData.address || token.address || token.token?.address || token["BlockApps-ERC20"]?.address || 'Unknown';
    
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
      <Card className="dark:bg-card rounded-none md:rounded-xl border-x-0 md:border-x">
        <CardHeader className="px-3 md:px-6">
          <CardTitle className="dark:text-foreground text-base md:text-lg">Token Status</CardTitle>
          <CardDescription className="dark:text-muted-foreground text-xs md:text-sm">
            Manage token status and configurations for all tokens
          </CardDescription>
        </CardHeader>
        <CardContent className="px-3 md:px-6">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 md:h-6 md:w-6 animate-spin dark:text-primary" />
            <span className="ml-2 text-sm dark:text-muted-foreground">Loading tokens...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="dark:bg-card rounded-none md:rounded-xl border-x-0 md:border-x">
        <CardHeader className="px-3 md:px-6">
          <CardTitle className="dark:text-foreground text-base md:text-lg">Token Status</CardTitle>
          <CardDescription className="dark:text-muted-foreground text-xs md:text-sm">
            Manage token status and configurations for all tokens
          </CardDescription>
        </CardHeader>
        <CardContent className="px-3 md:px-6">
          <div className="text-center py-8">
            <p className="text-red-600 dark:text-red-400 text-sm">Error loading tokens: {error}</p>
            <Button 
              variant="outline" 
              size="sm"
              onClick={refreshAllData}
              className="mt-4 dark:border-border dark:text-foreground dark:hover:bg-accent"
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
    <Card className="dark:bg-card rounded-none md:rounded-xl border-x-0 md:border-x overflow-hidden">
      <CardHeader className="px-3 md:px-6">
        <CardTitle className="dark:text-foreground text-base md:text-lg">Token Status</CardTitle>
        <CardDescription className="dark:text-muted-foreground text-xs md:text-sm">
          Manage token status and configurations for all tokens
        </CardDescription>
      </CardHeader>
      <CardContent className="px-3 md:px-6">
        <div className="mb-4 md:mb-6 space-y-3 md:space-y-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
            <div className="relative flex-1 md:max-w-sm">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tokens..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 text-sm dark:bg-background dark:text-foreground dark:border-input"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 dark:text-muted-foreground shrink-0" />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full md:w-[180px] text-sm dark:bg-background dark:text-foreground dark:border-input">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent className="dark:bg-card dark:border-border">
                  <SelectItem value="all" className="dark:text-foreground dark:focus:bg-accent">All Statuses</SelectItem>
                  <SelectItem value="1" className="dark:text-foreground dark:focus:bg-accent">PENDING</SelectItem>
                  <SelectItem value="2" className="dark:text-foreground dark:focus:bg-accent">ACTIVE</SelectItem>
                  <SelectItem value="3" className="dark:text-foreground dark:focus:bg-accent">LEGACY</SelectItem>
                  <SelectItem value="unknown" className="dark:text-foreground dark:focus:bg-accent">UNKNOWN</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={refreshAllData} className="dark:border-border dark:text-foreground dark:hover:bg-accent shrink-0">
                <RefreshCw className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Refresh</span>
              </Button>
            </div>
          </div>
          <div className="text-xs md:text-sm text-muted-foreground">
            Showing {filteredTokens.length} of {tokens.length} tokens
            {searchQuery && ` matching "${searchQuery}"`}
            {statusFilter !== 'all' && ` with ${getStatusLabel(statusFilter).label} status`}
          </div>
        </div>
        
        {filteredTokens.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground text-sm">
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
                className="mt-2 dark:text-primary dark:hover:bg-accent/50"
              >
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <div className="-mx-3 md:mx-0 overflow-x-auto">
            <Table className="min-w-[500px]">
              <TableHeader>
                <TableRow className="dark:border-border dark:hover:bg-transparent">
                  <TableHead className="w-[70px] md:w-[100px] text-xs dark:text-muted-foreground">Symbol</TableHead>
                  <TableHead className="w-[100px] md:w-[200px] text-xs dark:text-muted-foreground">Name</TableHead>
                  <TableHead className="w-[100px] md:w-[140px] text-xs dark:text-muted-foreground">Address</TableHead>
                  <TableHead className="w-[60px] md:w-[80px] text-xs dark:text-muted-foreground">Status</TableHead>
                  <TableHead className="w-[70px] md:w-[60px] text-xs dark:text-muted-foreground">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTokens.map((token, index) => {
                  const tokenData = token as Token;
                  const name = tokenData.name || token._name || token.token?._name || token["BlockApps-ERC20"]?._name || 'Unknown';
                  const symbol = tokenData.symbol || token._symbol || token.token?._symbol || token["BlockApps-ERC20"]?._symbol || 'Unknown';
                  const address = tokenData.address || token.address || token.token?.address || token["BlockApps-ERC20"]?.address || 'Unknown';
                  const status = getStatusLabel(tokenData.status);

                  return (
                    <TableRow key={`${address}-${index}`} className="dark:border-border dark:hover:bg-muted/50">
                      <TableCell className="font-medium text-xs md:text-sm max-w-[70px] md:max-w-[100px] truncate dark:text-foreground">{symbol}</TableCell>
                      <TableCell className="text-xs md:text-sm max-w-[100px] md:max-w-[200px] truncate dark:text-foreground" title={name}>{name}</TableCell>
                      <TableCell className="font-mono text-[10px] md:text-xs max-w-[100px] md:max-w-[140px] dark:text-foreground">
                        <div className="flex items-center gap-1">
                          <span className="truncate">
                            {address && address !== 'Unknown' 
                              ? `${address.slice(0, 4)}...${address.slice(-3)}`
                              : address
                            }
                          </span>
                          {address && address !== 'Unknown' && (
                            <CopyButton address={address} />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[60px] md:max-w-[80px]">
                        <Badge variant={status.variant} className="text-[10px] md:text-xs px-1.5 md:px-2">
                          {status.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[70px] md:max-w-[60px]">
                        <Button 
                          size="sm" 
                          onClick={() => handleSetTokenStatus({address, symbol, name})}
                          className="bg-strato-blue hover:bg-strato-blue/90 text-[10px] md:text-xs px-2 md:px-3 h-7 md:h-8 dark:text-white whitespace-nowrap"
                        >
                          Set
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