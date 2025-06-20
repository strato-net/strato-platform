import { useEffect, useState } from 'react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTokenContext } from '@/context/TokenContext';
import { Loader2, Filter } from 'lucide-react';

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
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    getAllTokens();
  }, [getAllTokens]);

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

  if (loading) {
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
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AllTokensTable;